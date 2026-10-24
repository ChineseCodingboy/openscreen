import { AVMediaType, type WebAVStream, WebDemuxer } from "web-demuxer";
import {
	type AudioTrackClip,
	isFileBackedAudioClip,
	type SpeedRegion,
	type TrimRegion,
} from "@/components/video-editor/types";
import {
	getAudioTrackOrdinal,
	listAudioStreams,
	resolveAudioStreamByOrdinal,
} from "@/lib/audioTrackOrdinals";
import type { ExportAudioMuxerCodec, VideoMuxer } from "./muxer";
import { loadFileAsArrayBuffer } from "./streamingDecoder";

const AUDIO_BITRATE = 128_000;
const DECODE_BACKPRESSURE_LIMIT = 20;
const MIN_SPEED_REGION_DELTA_MS = 0.0001;
const SEEK_TIMEOUT_MS = 5_000;
const AUDIO_RENDER_QUANTUM_FRAMES = 1_024;

export interface SpeedAdjustedAudioSegment {
	sourceStartSec: number;
	sourceDurationSec: number;
	playbackRate: number;
	outputStartSec: number;
}

export interface AudioClipSchedule {
	trackOrdinal: number;
	sourceStartSec: number;
	sourceDurationSec: number;
	outputStartSec: number;
	playbackRate: number;
	gain: number;
	/** Standalone audio file backing the clip (voice-over); decoded instead of a source stream. */
	sourcePath?: string;
}

export interface ExportAudioCodec {
	encoderCodec: string;
	muxerCodec: ExportAudioMuxerCodec;
	label: string;
	sampleRate: number;
	numberOfChannels: number;
	/** False when the codec is available only through source packet passthrough. */
	encodingSupported?: boolean;
}

export type PreferredAudioStream = Pick<
	WebAVStream,
	"index" | "bit_rate" | "channels" | "sample_rate" | "codec_type_string" | "codec_name"
>;

type ExportAudioCodecCandidate = Omit<ExportAudioCodec, "sampleRate" | "numberOfChannels">;

const EXPORT_AUDIO_CODECS: ExportAudioCodecCandidate[] = [
	{ encoderCodec: "mp4a.40.2", muxerCodec: "aac", label: "AAC" },
];

function parseBitRate(value: string | undefined) {
	const bitRate = Number.parseInt(value ?? "", 10);
	return Number.isFinite(bitRate) && bitRate > 0 ? bitRate : 0;
}

/**
 * ScreenCaptureKit can write system and microphone audio as separate tracks.
 * Prefer the most substantial track: a disabled/silent system track is often a
 * tiny AAC stream, while the microphone track carries the actual recording.
 */
export function selectPreferredAudioStream<T extends PreferredAudioStream>(streams: T[]): T | null {
	return streams.reduce<T | null>((selected, stream) => {
		if (stream.codec_type_string !== "audio") return selected;
		if (!selected || parseBitRate(stream.bit_rate) > parseBitRate(selected.bit_rate)) {
			return stream;
		}
		return selected;
	}, null);
}

function averageChannels(sourcePlanes: Float32Array[], frame: number) {
	let mixed = 0;
	for (const plane of sourcePlanes) {
		mixed += plane[frame] ?? 0;
	}
	return mixed / Math.max(1, sourcePlanes.length);
}

function weightedSample(
	sourcePlanes: Float32Array[],
	frame: number,
	weights: Array<[channel: number, weight: number]>,
) {
	let mixed = 0;
	let weightSum = 0;
	for (const [channel, weight] of weights) {
		const sample = sourcePlanes[channel]?.[frame];
		if (typeof sample !== "number") {
			continue;
		}
		mixed += sample * weight;
		weightSum += weight;
	}
	return weightSum > 0 ? mixed / weightSum : averageChannels(sourcePlanes, frame);
}

function getStereoDownmixWeights(sourceChannels: number) {
	const centerWeight = Math.SQRT1_2;
	const surroundWeight = Math.SQRT1_2;
	const lfeWeight = 0.5;

	if (sourceChannels >= 8) {
		// Windows 7.1 order: FL, FR, FC, LFE, BL, BR, SL, SR.
		return {
			left: [
				[0, 1],
				[2, centerWeight],
				[3, lfeWeight],
				[4, surroundWeight],
				[6, surroundWeight],
			] satisfies Array<[number, number]>,
			right: [
				[1, 1],
				[2, centerWeight],
				[3, lfeWeight],
				[5, surroundWeight],
				[7, surroundWeight],
			] satisfies Array<[number, number]>,
		};
	}

	if (sourceChannels >= 6) {
		// Windows 5.1 order: FL, FR, FC, LFE, BL, BR.
		return {
			left: [
				[0, 1],
				[2, centerWeight],
				[3, lfeWeight],
				[4, surroundWeight],
			] satisfies Array<[number, number]>,
			right: [
				[1, 1],
				[2, centerWeight],
				[3, lfeWeight],
				[5, surroundWeight],
			] satisfies Array<[number, number]>,
		};
	}

	if (sourceChannels >= 4) {
		return {
			left: [
				[0, 1],
				[2, surroundWeight],
			] satisfies Array<[number, number]>,
			right: [
				[1, 1],
				[3, surroundWeight],
			] satisfies Array<[number, number]>,
		};
	}

	return {
		left: [
			[0, 1],
			[2, centerWeight],
		] satisfies Array<[number, number]>,
		right: [
			[1, 1],
			[2, centerWeight],
		] satisfies Array<[number, number]>,
	};
}

export function downmixPlanarChannelsForExport(
	sourcePlanes: Float32Array[],
	targetChannels: number,
): Float32Array {
	const frameCount = sourcePlanes[0]?.length ?? 0;
	const output = new Float32Array(frameCount * targetChannels);

	if (targetChannels === 1) {
		for (let frame = 0; frame < frameCount; frame++) {
			output[frame] = averageChannels(sourcePlanes, frame);
		}
		return output;
	}

	if (targetChannels !== 2) {
		throw new Error(`Unsupported target channel count: ${targetChannels}`);
	}

	if (sourcePlanes.length === 1) {
		output.set(sourcePlanes[0], 0);
		output.set(sourcePlanes[0], frameCount);
		return output;
	}

	if (sourcePlanes.length === 2) {
		output.set(sourcePlanes[0], 0);
		output.set(sourcePlanes[1], frameCount);
		return output;
	}

	const weights = getStereoDownmixWeights(sourcePlanes.length);
	for (let frame = 0; frame < frameCount; frame++) {
		output[frame] = weightedSample(sourcePlanes, frame, weights.left);
		output[frameCount + frame] = weightedSample(sourcePlanes, frame, weights.right);
	}
	return output;
}

/**
 * Split the source timeline wherever a trim or speed region begins/ends. The
 * resulting pieces can be scheduled directly in an OfflineAudioContext.
 */
export function buildSpeedAdjustedAudioSegments(
	durationSec: number,
	trimRegions: TrimRegion[],
	speedRegions: SpeedRegion[],
): SpeedAdjustedAudioSegment[] {
	const durationMs = Math.max(0, durationSec * 1000);
	const boundaries = new Set<number>([0, durationMs]);

	for (const region of [...trimRegions, ...speedRegions]) {
		boundaries.add(Math.min(durationMs, Math.max(0, region.startMs)));
		boundaries.add(Math.min(durationMs, Math.max(0, region.endMs)));
	}

	const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
	const segments: SpeedAdjustedAudioSegment[] = [];
	let outputStartSec = 0;

	for (let index = 0; index < sortedBoundaries.length - 1; index++) {
		const startMs = sortedBoundaries[index];
		const endMs = sortedBoundaries[index + 1];
		if (endMs - startMs <= MIN_SPEED_REGION_DELTA_MS) continue;

		const middleMs = (startMs + endMs) / 2;
		if (trimRegions.some((trim) => middleMs >= trim.startMs && middleMs < trim.endMs)) {
			continue;
		}

		const activeSpeed = speedRegions.find(
			(region) => middleMs >= region.startMs && middleMs < region.endMs,
		);
		const playbackRate = activeSpeed?.speed ?? 1;
		if (!Number.isFinite(playbackRate) || playbackRate <= 0) continue;

		const sourceDurationSec = (endMs - startMs) / 1000;
		segments.push({
			sourceStartSec: startMs / 1000,
			sourceDurationSec,
			playbackRate,
			outputStartSec,
		});
		outputStartSec += sourceDurationSec / playbackRate;
	}

	return segments;
}

/** Maps editable audio clips through the same trim/speed time transform as video. */
export function buildAudioClipSchedules(
	durationSec: number,
	clips: AudioTrackClip[],
	trimRegions: TrimRegion[],
	speedRegions: SpeedRegion[],
): AudioClipSchedule[] {
	const schedules: AudioClipSchedule[] = [];
	const timelineSegments = buildSpeedAdjustedAudioSegments(durationSec, trimRegions, speedRegions);

	for (const clip of clips) {
		if (clip.muted || clip.gain <= 0 || clip.endMs <= clip.startMs) continue;
		for (const segment of timelineSegments) {
			const segmentStartMs = segment.sourceStartSec * 1000;
			const segmentEndMs = segmentStartMs + segment.sourceDurationSec * 1000;
			const startMs = Math.max(clip.startMs, segmentStartMs);
			const endMs = Math.min(clip.endMs, segmentEndMs);
			if (endMs <= startMs) continue;

			schedules.push({
				trackOrdinal: clip.trackOrdinal,
				sourceStartSec: (clip.sourceStartMs + startMs - clip.startMs) / 1000,
				sourceDurationSec: (endMs - startMs) / 1000,
				outputStartSec:
					segment.outputStartSec + (startMs - segmentStartMs) / 1000 / segment.playbackRate,
				playbackRate: segment.playbackRate,
				gain: Math.min(4, Math.max(0, clip.gain)),
				sourcePath: clip.sourcePath,
			});
		}
	}
	return schedules;
}

export function getPacketCopyTrackOrdinal(
	clips: AudioTrackClip[] | undefined,
	trimRegions: TrimRegion[],
	speedRegions: SpeedRegion[],
	durationSec: number,
): number | null | undefined {
	if (trimRegions.length > 0 || speedRegions.some((region) => region.speed !== 1)) return null;
	if (!clips?.length) return undefined;
	const audible = clips.filter((clip) => !clip.muted && clip.gain > 0);
	if (audible.length !== 1) return null;
	const clip = audible[0];
	// A file-backed clip's audio is not a source stream, so packets cannot be copied.
	if (isFileBackedAudioClip(clip)) return null;
	const durationMs = Math.max(0, durationSec * 1000);
	if (
		clip.gain !== 1 ||
		clip.startMs > 1 ||
		clip.sourceStartMs > 1 ||
		clip.endMs < durationMs - 100
	) {
		return null;
	}
	return clip.trackOrdinal;
}

export class AudioProcessor {
	private cancelled = false;

	static async selectSupportedExportCodec(
		sampleRate: number,
		numberOfChannels: number,
	): Promise<ExportAudioCodec | null> {
		const channelOptions = [numberOfChannels];
		if (numberOfChannels > 2) {
			channelOptions.push(2);
		}

		if (!channelOptions.includes(1)) {
			channelOptions.push(1);
		}

		for (const codec of EXPORT_AUDIO_CODECS) {
			for (const channels of channelOptions) {
				const support = await AudioEncoder.isConfigSupported({
					codec: codec.encoderCodec,
					sampleRate,
					numberOfChannels: channels,
					bitrate: AUDIO_BITRATE,
				});
				if (support.supported) {
					return { ...codec, sampleRate, numberOfChannels: channels };
				}
			}
		}

		return null;
	}

	static async selectSupportedExportCodecForSource(
		demuxer: WebDemuxer,
	): Promise<ExportAudioCodec | null> {
		const track = await AudioProcessor.getPreferredAudioTrack(demuxer);
		if (!track) {
			return null;
		}

		const { audioConfig, stream } = track;
		const isAac = stream.codec_name === "aac" || /^mp4a/i.test(audioConfig.codec);
		const encodable =
			typeof AudioEncoder === "undefined"
				? null
				: await AudioProcessor.selectSupportedExportCodec(
						audioConfig.sampleRate || 48_000,
						audioConfig.numberOfChannels || 2,
					);
		if (encodable) return encodable;
		if (isAac) {
			// Full-span AAC can be copied packet-for-packet. This deliberately does
			// not require AudioDecoder/AudioEncoder support. Mark the fallback so an
			// edited/mixed path fails clearly instead of configuring an unsupported
			// encoder after video rendering has completed.
			return {
				encoderCodec: "mp4a.40.2",
				muxerCodec: "aac",
				label: "AAC",
				sampleRate: audioConfig.sampleRate || 48_000,
				numberOfChannels: audioConfig.numberOfChannels || 2,
				encodingSupported: false,
			};
		}

		return null;
	}

	private static async getPreferredAudioTrack(demuxer: WebDemuxer): Promise<{
		audioConfig: AudioDecoderConfig;
		stream: PreferredAudioStream;
		trackOrdinal: number;
	} | null> {
		try {
			const mediaInfo = await demuxer.getMediaInfo();
			const stream = selectPreferredAudioStream(mediaInfo.streams);
			if (!stream) return null;
			const trackOrdinal = getAudioTrackOrdinal(mediaInfo.streams, stream.index);
			if (trackOrdinal === null) return null;

			const audioConfig = demuxer.genDecoderConfig("audio", stream);
			return { audioConfig, stream, trackOrdinal };
		} catch {
			return null;
		}
	}

	/**
	 * Two modes: no speed regions uses the fast WebCodecs trim-only pipeline; speed
	 * regions use the pitch-preserving rendered timeline pipeline.
	 */
	async process(
		demuxer: WebDemuxer,
		muxer: VideoMuxer,
		videoUrl: string,
		trimRegions: TrimRegion[] | undefined,
		speedRegions: SpeedRegion[] | undefined,
		validatedDurationSec: number,
		exportCodec: ExportAudioCodec,
		audioTrackClips?: AudioTrackClip[],
		timelineDurationSec = validatedDurationSec,
	): Promise<void> {
		const sortedTrims = trimRegions ? [...trimRegions].sort((a, b) => a.startMs - b.startMs) : [];
		const sortedSpeedRegions = speedRegions
			? [...speedRegions]
					.filter((region) => region.endMs - region.startMs > MIN_SPEED_REGION_DELTA_MS)
					.sort((a, b) => a.startMs - b.startMs)
			: [];

		const mediaInfo = await demuxer.getMediaInfo();
		const sourceAudioStreams = listAudioStreams(mediaInfo.streams);
		let copyOrdinal = getPacketCopyTrackOrdinal(
			audioTrackClips,
			sortedTrims,
			sortedSpeedRegions,
			validatedDurationSec,
		);
		// With no explicit timeline, copy is only lossless when the file contains one
		// physical track. Multiple source tracks must be mixed so none disappear.
		if (copyOrdinal === undefined && sourceAudioStreams.length !== 1) copyOrdinal = null;
		if (copyOrdinal !== null) {
			const copied = await this.copyUneditedAudioTrack(
				demuxer,
				muxer,
				copyOrdinal,
				validatedDurationSec + 0.5,
			);
			if (copied) return;
		}

		let clips = audioTrackClips;
		if (!clips?.length) {
			if (sourceAudioStreams.length === 0) {
				throw new Error("The source reports audio, but no audio track was found.");
			}
			clips = sourceAudioStreams.map((_, trackOrdinal) => ({
				id: `audio-export-default-${trackOrdinal}`,
				role: "unknown",
				trackOrdinal,
				startMs: 0,
				endMs: Math.max(1, Math.round(validatedDurationSec * 1000)),
				sourceStartMs: 0,
				muted: false,
				gain: 1,
			}));
		}
		if (exportCodec.encodingSupported === false) {
			throw new Error(
				"This audio edit requires AAC encoding, which is unavailable in this environment. Unedited AAC can still be exported losslessly.",
			);
		}

		try {
			await this.processAudioTrackClips(
				demuxer,
				muxer,
				videoUrl,
				clips,
				sortedTrims,
				sortedSpeedRegions,
				validatedDurationSec,
				timelineDurationSec,
				exportCodec,
			);
		} catch (error) {
			if (audioTrackClips?.length || muxer.getAudioChunkCount() > 0 || !sortedSpeedRegions.length) {
				throw error;
			}
			console.warn("[AudioProcessor] Offline audio mix failed, using legacy fallback", error);
			await this.processSpeedAdjustedAudio(
				demuxer,
				muxer,
				sortedTrims,
				sortedSpeedRegions,
				validatedDurationSec,
				exportCodec,
			);
			if (muxer.getAudioChunkCount() === 0) {
				const blob = await this.renderPitchPreservedTimelineAudio(
					videoUrl,
					sortedTrims,
					sortedSpeedRegions,
					validatedDurationSec,
				);
				if (blob.size > 0) await this.muxRenderedAudioBlob(blob, muxer, exportCodec);
			}
			if (muxer.getAudioChunkCount() === 0) throw error;
		}
	}

	private async copyUneditedAudioTrack(
		demuxer: WebDemuxer,
		muxer: VideoMuxer,
		trackOrdinal: number | undefined,
		readEndSec: number,
	): Promise<boolean> {
		const mediaInfo = await demuxer.getMediaInfo();
		const preferred =
			typeof trackOrdinal === "number"
				? resolveAudioStreamByOrdinal(mediaInfo.streams, trackOrdinal)
				: selectPreferredAudioStream(mediaInfo.streams);
		if (!preferred) throw new Error("The source reports audio, but no audio track was found.");
		const audioConfig = demuxer.genDecoderConfig("audio", preferred);
		if (preferred.codec_name !== "aac" && !/^mp4a/i.test(audioConfig.codec)) return false;

		const reader = demuxer
			.readAVPacket(0, readEndSec, AVMediaType.AVMEDIA_TYPE_AUDIO, preferred.index)
			.getReader();
		let packetCount = 0;
		let firstTimestampUs: number | null = null;
		try {
			while (!this.cancelled) {
				const { done, value } = await reader.read();
				if (done || !value) break;
				const chunk = demuxer.genEncodedChunk("audio", value);
				firstTimestampUs ??= chunk.timestamp;
				const data = new Uint8Array(chunk.byteLength);
				chunk.copyTo(data);
				const rewritten = new EncodedAudioChunk({
					type: chunk.type,
					timestamp: Math.max(0, chunk.timestamp - firstTimestampUs),
					duration: chunk.duration ?? undefined,
					data,
				});
				await muxer.addAudioChunk(
					rewritten,
					packetCount === 0 ? { decoderConfig: audioConfig } : undefined,
				);
				packetCount++;
			}
		} finally {
			await reader.cancel().catch(() => undefined);
		}

		if (!this.cancelled && packetCount === 0) {
			throw new Error("The source audio track contained no encoded packets.");
		}
		return packetCount > 0;
	}

	/** Decodes a standalone audio file (e.g. the generated voice-over WAV) to a buffer. */
	private async decodeExternalAudioFile(sourcePath: string): Promise<AudioBuffer | null> {
		if (this.cancelled) return null;
		const { data } = await loadFileAsArrayBuffer(sourcePath);
		const context = new AudioContext();
		try {
			return await context.decodeAudioData(data.slice(0));
		} finally {
			await context.close();
		}
	}

	private async decodePreparedAudioTrack(
		videoUrl: string,
		trackOrdinal: number,
	): Promise<AudioBuffer | null> {
		if (this.cancelled) return null;
		const prepare = window.electronAPI?.preparePreviewAudioTrack;
		if (!prepare) {
			throw new Error(`Audio track ${trackOrdinal} uses a codec that cannot be decoded.`);
		}
		const prepared = await prepare(videoUrl, trackOrdinal);
		if (!prepared.success || !prepared.path) {
			throw new Error(
				prepared.message ?? `Audio track ${trackOrdinal} could not be prepared for export.`,
			);
		}
		const { data } = await loadFileAsArrayBuffer(prepared.path);
		const context = new AudioContext();
		try {
			return await context.decodeAudioData(data.slice(0));
		} finally {
			await context.close();
		}
	}

	private async processAudioTrackClips(
		demuxer: WebDemuxer,
		muxer: VideoMuxer,
		videoUrl: string,
		clips: AudioTrackClip[],
		trimRegions: TrimRegion[],
		speedRegions: SpeedRegion[],
		sourceDurationSec: number,
		timelineDurationSec: number,
		exportCodec: ExportAudioCodec,
	): Promise<void> {
		const schedules = buildAudioClipSchedules(
			timelineDurationSec,
			clips,
			trimRegions,
			speedRegions,
		);
		if (!schedules.length || this.cancelled) return;

		const buffers = new Map<number, AudioBuffer>();
		for (const trackOrdinal of new Set(schedules.map((schedule) => schedule.trackOrdinal))) {
			const externalPath = schedules.find(
				(schedule) => schedule.trackOrdinal === trackOrdinal && schedule.sourcePath,
			)?.sourcePath;
			const buffer = externalPath
				? await this.decodeExternalAudioFile(externalPath)
				: await this.decodeAudioStreamToBuffer(
						demuxer,
						trackOrdinal,
						sourceDurationSec + 0.5,
						videoUrl,
					);
			if (buffer) buffers.set(trackOrdinal, buffer);
		}
		if (!buffers.size || this.cancelled) {
			throw new Error("Audio tracks were selected, but none could be decoded.");
		}

		const outputDurationSec = Math.max(
			...schedules.map(
				(schedule) => schedule.outputStartSec + schedule.sourceDurationSec / schedule.playbackRate,
			),
		);
		const context = new OfflineAudioContext(
			exportCodec.numberOfChannels,
			Math.max(1, Math.ceil(outputDurationSec * exportCodec.sampleRate)),
			exportCodec.sampleRate,
		);

		for (const schedule of schedules) {
			const buffer = buffers.get(schedule.trackOrdinal);
			if (!buffer || this.cancelled) continue;
			const source = context.createBufferSource();
			const gain = context.createGain();
			source.buffer = buffer;
			source.playbackRate.value = schedule.playbackRate;
			gain.gain.value = schedule.gain;
			source.connect(gain).connect(context.destination);
			source.start(schedule.outputStartSec, schedule.sourceStartSec, schedule.sourceDurationSec);
		}

		const rendered = await context.startRendering();
		if (!this.cancelled) await this.encodeRenderedAudioBuffer(rendered, muxer, exportCodec);
	}

	private async decodeAudioStreamToBuffer(
		demuxer: WebDemuxer,
		trackOrdinal: number,
		readEndSec: number,
		videoUrl: string,
	): Promise<AudioBuffer | null> {
		const mediaInfo = await demuxer.getMediaInfo();
		const stream = resolveAudioStreamByOrdinal(mediaInfo.streams, trackOrdinal);
		if (!stream) throw new Error(`Audio track ordinal ${trackOrdinal} was not found.`);
		const audioConfig = demuxer.genDecoderConfig("audio", stream);
		if (!(await AudioDecoder.isConfigSupported(audioConfig)).supported) {
			return this.decodePreparedAudioTrack(videoUrl, trackOrdinal);
		}

		const frames: AudioData[] = [];
		const decoder = new AudioDecoder({
			output: (frame) => frames.push(frame),
			error: (error) => console.warn("[AudioProcessor] Audio track decode error:", error),
		});
		decoder.configure(audioConfig);
		const reader = demuxer
			.readAVPacket(0, readEndSec, AVMediaType.AVMEDIA_TYPE_AUDIO, stream.index)
			.getReader();
		try {
			while (!this.cancelled) {
				const { done, value } = await reader.read();
				if (done || !value) break;
				decoder.decode(demuxer.genEncodedChunk("audio", value));
				while (decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT && !this.cancelled) {
					await new Promise((resolve) => setTimeout(resolve, 1));
				}
			}
		} finally {
			await reader.cancel().catch(() => undefined);
		}
		if (decoder.state === "configured") {
			await decoder.flush();
			decoder.close();
		}
		if (!frames.length || this.cancelled) {
			frames.forEach((frame) => frame.close());
			return this.cancelled ? null : this.decodePreparedAudioTrack(videoUrl, trackOrdinal);
		}

		const sampleRate = audioConfig.sampleRate || 48_000;
		const channels = audioConfig.numberOfChannels || 2;
		const length = Math.max(
			1,
			...frames.map(
				(frame) => Math.ceil((frame.timestamp / 1_000_000) * sampleRate) + frame.numberOfFrames,
			),
		);
		const buffer = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
		for (const frame of frames) {
			const offset = Math.max(0, Math.round((frame.timestamp / 1_000_000) * sampleRate));
			const copyLength = Math.min(frame.numberOfFrames, length - offset);
			for (let channel = 0; channel < channels && copyLength > 0; channel++) {
				const samples = new Float32Array(frame.numberOfFrames);
				frame.copyTo(samples, { format: "f32-planar", planeIndex: channel });
				buffer.getChannelData(channel).set(samples.subarray(0, copyLength), offset);
			}
			frame.close();
		}
		return buffer;
	}

	// Trim-only path, used for projects without speed regions.
	private async processTrimOnlyAudio(
		demuxer: WebDemuxer,
		muxer: VideoMuxer,
		sortedTrims: TrimRegion[],
		readEndSec?: number,
		exportCodec?: ExportAudioCodec,
	): Promise<void> {
		const track = await AudioProcessor.getPreferredAudioTrack(demuxer);
		if (!track) {
			console.warn("[AudioProcessor] No audio track found, skipping");
			return;
		}
		const { audioConfig, stream: audioStreamInfo } = track;

		const codecCheck = await AudioDecoder.isConfigSupported(audioConfig);
		if (!codecCheck.supported) {
			console.warn("[AudioProcessor] Audio codec not supported:", audioConfig.codec);
			return;
		}

		// Phase 1: decode, skipping trimmed regions.
		const decodedFrames: AudioData[] = [];

		const decoder = new AudioDecoder({
			output: (data: AudioData) => decodedFrames.push(data),
			error: (e: DOMException) => console.error("[AudioProcessor] Decode error:", e),
		});
		decoder.configure(audioConfig);

		const safeReadEndSec =
			typeof readEndSec === "number" && Number.isFinite(readEndSec)
				? Math.max(0, readEndSec)
				: undefined;
		const audioStream = demuxer.readAVPacket(
			0,
			safeReadEndSec,
			AVMediaType.AVMEDIA_TYPE_AUDIO,
			audioStreamInfo.index,
		);
		const reader = audioStream.getReader();

		try {
			while (!this.cancelled) {
				const { done, value: packet } = await reader.read();
				if (done || !packet) break;
				const chunk = demuxer.genEncodedChunk("audio", packet);

				const timestampMs = chunk.timestamp / 1000;
				if (this.isInTrimRegion(timestampMs, sortedTrims)) continue;

				decoder.decode(chunk);

				while (decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT && !this.cancelled) {
					await new Promise((resolve) => setTimeout(resolve, 1));
				}
			}
		} finally {
			try {
				await reader.cancel();
			} catch {
				/* reader already closed */
			}
		}

		if (decoder.state === "configured") {
			await decoder.flush();
			decoder.close();
		}

		if (this.cancelled || decodedFrames.length === 0) {
			for (const frame of decodedFrames) frame.close();
			return;
		}

		// Phase 2: re-encode with timestamps adjusted for trim gaps.
		const encodedChunks: { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }[] = [];

		const encoder = new AudioEncoder({
			output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
				encodedChunks.push({ chunk, meta });
			},
			error: (e: DOMException) => console.error("[AudioProcessor] Encode error:", e),
		});

		const sampleRate = audioConfig.sampleRate || 48000;
		const channels = audioConfig.numberOfChannels || 2;
		const selectedCodec =
			exportCodec ?? (await AudioProcessor.selectSupportedExportCodec(sampleRate, channels));
		if (!selectedCodec) {
			console.warn("[AudioProcessor] No supported audio export codec, skipping audio");
			for (const frame of decodedFrames) frame.close();
			return;
		}

		const outputSampleRate = selectedCodec.sampleRate || sampleRate;
		const outputChannels = selectedCodec.numberOfChannels || channels;
		const encodeConfig: AudioEncoderConfig = {
			codec: selectedCodec.encoderCodec,
			sampleRate: outputSampleRate,
			numberOfChannels: outputChannels,
			bitrate: AUDIO_BITRATE,
		};

		const encodeSupport = await AudioEncoder.isConfigSupported(encodeConfig);
		if (!encodeSupport.supported) {
			console.warn(
				`[AudioProcessor] ${selectedCodec.label} encoding not supported, skipping audio`,
			);
			for (const frame of decodedFrames) frame.close();
			return;
		}

		encoder.configure(encodeConfig);

		for (const audioData of decodedFrames) {
			if (this.cancelled) {
				audioData.close();
				continue;
			}

			const timestampMs = audioData.timestamp / 1000;
			const trimOffsetMs = this.computeTrimOffset(timestampMs, sortedTrims);
			const adjustedTimestampUs = audioData.timestamp - trimOffsetMs * 1000;

			const adjusted = this.cloneForEncoding(
				audioData,
				Math.max(0, adjustedTimestampUs),
				outputChannels,
			);
			audioData.close();

			encoder.encode(adjusted);
			adjusted.close();
		}

		if (encoder.state === "configured") {
			await encoder.flush();
			encoder.close();
		}

		// Phase 3: flush encoded chunks to muxer.
		for (const { chunk, meta } of encodedChunks) {
			if (this.cancelled) break;
			await muxer.addAudioChunk(chunk, meta);
		}

		console.log(
			`[AudioProcessor] Processed ${decodedFrames.length} audio frames, encoded ${encodedChunks.length} chunks`,
		);
	}

	private async processSpeedAdjustedAudio(
		demuxer: WebDemuxer,
		muxer: VideoMuxer,
		trimRegions: TrimRegion[],
		speedRegions: SpeedRegion[],
		validatedDurationSec: number,
		exportCodec: ExportAudioCodec,
	): Promise<void> {
		const track = await AudioProcessor.getPreferredAudioTrack(demuxer);
		if (!track) {
			console.warn("[AudioProcessor] No audio track found, skipping");
			return;
		}
		const { audioConfig, stream: audioStreamInfo } = track;

		const decodeSupport = await AudioDecoder.isConfigSupported(audioConfig);
		if (!decodeSupport.supported) {
			console.warn("[AudioProcessor] Audio codec not supported:", audioConfig.codec);
			return;
		}

		const decodedFrames: AudioData[] = [];
		const decoder = new AudioDecoder({
			output: (data: AudioData) => decodedFrames.push(data),
			error: (error: DOMException) => console.error("[AudioProcessor] Decode error:", error),
		});
		decoder.configure(audioConfig);

		const reader = demuxer
			.readAVPacket(
				0,
				validatedDurationSec + 0.5,
				AVMediaType.AVMEDIA_TYPE_AUDIO,
				audioStreamInfo.index,
			)
			.getReader();
		try {
			while (!this.cancelled) {
				const { done, value: packet } = await reader.read();
				if (done || !packet) break;
				const chunk = demuxer.genEncodedChunk("audio", packet);
				decoder.decode(chunk);
				while (decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT && !this.cancelled) {
					await new Promise((resolve) => setTimeout(resolve, 1));
				}
			}
		} finally {
			try {
				await reader.cancel();
			} catch {
				/* reader already closed */
			}
		}

		if (decoder.state === "configured") {
			await decoder.flush();
			decoder.close();
		}

		if (this.cancelled || decodedFrames.length === 0) {
			for (const frame of decodedFrames) frame.close();
			return;
		}

		try {
			const sourceSampleRate = audioConfig.sampleRate || 48_000;
			const sourceChannels = audioConfig.numberOfChannels || 2;
			const sourceLength = Math.max(
				1,
				...decodedFrames.map(
					(frame) =>
						Math.ceil((frame.timestamp / 1_000_000) * sourceSampleRate) + frame.numberOfFrames,
				),
			);
			const sourceBuffer = new AudioBuffer({
				length: sourceLength,
				numberOfChannels: sourceChannels,
				sampleRate: sourceSampleRate,
			});

			for (const frame of decodedFrames) {
				const offset = Math.max(0, Math.round((frame.timestamp / 1_000_000) * sourceSampleRate));
				const copyLength = Math.min(frame.numberOfFrames, sourceLength - offset);
				for (let channel = 0; channel < sourceChannels && copyLength > 0; channel++) {
					const plane = new Float32Array(frame.numberOfFrames);
					frame.copyTo(plane, { format: "f32-planar", planeIndex: channel });
					sourceBuffer.getChannelData(channel).set(plane.subarray(0, copyLength), offset);
				}
				frame.close();
			}

			const segments = buildSpeedAdjustedAudioSegments(
				validatedDurationSec,
				trimRegions,
				speedRegions,
			);
			if (segments.length === 0 || this.cancelled) return;

			const outputDurationSec = Math.max(
				...segments.map(
					(segment) => segment.outputStartSec + segment.sourceDurationSec / segment.playbackRate,
				),
			);
			const outputLength = Math.max(1, Math.ceil(outputDurationSec * exportCodec.sampleRate));
			const offlineContext = new OfflineAudioContext(
				exportCodec.numberOfChannels,
				outputLength,
				exportCodec.sampleRate,
			);

			for (const segment of segments) {
				const source = offlineContext.createBufferSource();
				source.buffer = sourceBuffer;
				source.playbackRate.value = segment.playbackRate;
				source.connect(offlineContext.destination);
				source.start(segment.outputStartSec, segment.sourceStartSec, segment.sourceDurationSec);
			}

			const rendered = await offlineContext.startRendering();
			if (!this.cancelled) {
				await this.encodeRenderedAudioBuffer(rendered, muxer, exportCodec);
			}
		} finally {
			for (const frame of decodedFrames) {
				try {
					frame.close();
				} catch {
					/* already closed */
				}
			}
		}
	}

	private async encodeRenderedAudioBuffer(
		buffer: AudioBuffer,
		muxer: VideoMuxer,
		exportCodec: ExportAudioCodec,
	): Promise<void> {
		const encodedChunks: { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }[] = [];
		const encoder = new AudioEncoder({
			output: (chunk, meta) => encodedChunks.push({ chunk, meta }),
			error: (error: DOMException) => console.error("[AudioProcessor] Encode error:", error),
		});
		encoder.configure({
			codec: exportCodec.encoderCodec,
			sampleRate: buffer.sampleRate,
			numberOfChannels: buffer.numberOfChannels,
			bitrate: AUDIO_BITRATE,
		});

		for (
			let offset = 0;
			offset < buffer.length && !this.cancelled;
			offset += AUDIO_RENDER_QUANTUM_FRAMES
		) {
			const frameCount = Math.min(AUDIO_RENDER_QUANTUM_FRAMES, buffer.length - offset);
			const planarData = new Float32Array(frameCount * buffer.numberOfChannels);
			for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
				planarData.set(
					buffer.getChannelData(channel).subarray(offset, offset + frameCount),
					channel * frameCount,
				);
			}

			const audioData = new AudioData({
				format: "f32-planar",
				sampleRate: buffer.sampleRate,
				numberOfFrames: frameCount,
				numberOfChannels: buffer.numberOfChannels,
				timestamp: Math.round((offset * 1_000_000) / buffer.sampleRate),
				data: planarData,
			});
			encoder.encode(audioData);
			audioData.close();
		}

		if (encoder.state === "configured") {
			await encoder.flush();
			encoder.close();
		}
		if (!this.cancelled && encodedChunks.length === 0) {
			throw new Error("Audio encoding completed without producing any packets.");
		}

		for (const { chunk, meta } of encodedChunks) {
			if (this.cancelled) break;
			await muxer.addAudioChunk(chunk, meta);
		}
	}

	// Speed-aware path mirroring preview semantics (trim skipping + playbackRate). Relies on
	// browser media playback to preserve pitch and avoid the chipmunk effect.
	private async renderPitchPreservedTimelineAudio(
		videoUrl: string,
		trimRegions: TrimRegion[],
		speedRegions: SpeedRegion[],
		validatedDurationSec: number,
	): Promise<Blob> {
		const media = document.createElement("audio");
		media.src = videoUrl;
		media.preload = "auto";

		const pitchMedia = media as HTMLMediaElement & {
			preservesPitch?: boolean;
			mozPreservesPitch?: boolean;
			webkitPreservesPitch?: boolean;
		};
		pitchMedia.preservesPitch = true;
		pitchMedia.mozPreservesPitch = true;
		pitchMedia.webkitPreservesPitch = true;

		await this.waitForLoadedMetadata(media);
		if (this.cancelled) {
			throw new Error("Export cancelled");
		}

		const audioContext = new AudioContext();
		const sourceNode = audioContext.createMediaElementSource(media);
		const destinationNode = audioContext.createMediaStreamDestination();
		sourceNode.connect(destinationNode);

		let rafId: number | null = null;
		let recorder: MediaRecorder | null = null;
		let recordedBlobPromise: Promise<Blob> | null = null;

		try {
			if (audioContext.state === "suspended") {
				await audioContext.resume();
			}

			// Skip initial trim region(s) before recording so the first rAF frames don't
			// capture trimmed audio. Loops to handle back-to-back/overlapping trims at t=0.
			const effectiveEnd = validatedDurationSec;
			let startPosition = 0;
			for (let i = 0; i <= trimRegions.length; i++) {
				const activeTrim = this.findActiveTrimRegion(startPosition * 1000, trimRegions);
				if (!activeTrim) break;
				startPosition = activeTrim.endMs / 1000;
				if (startPosition >= effectiveEnd) break;
			}

			if (startPosition >= effectiveEnd) {
				// Everything is trimmed; return a silent blob.
				return new Blob([], { type: "audio/webm" });
			}

			await this.seekTo(media, startPosition);

			// Set initial playback rate for the starting position.
			const initialSpeedRegion = this.findActiveSpeedRegion(startPosition * 1000, speedRegions);
			if (initialSpeedRegion) {
				media.playbackRate = initialSpeedRegion.speed;
			}

			// Start recording only after seeking past trims.
			const recording = this.startAudioRecording(destinationNode.stream);
			recorder = recording.recorder;
			recordedBlobPromise = recording.recordedBlobPromise;
			await media.play();

			await new Promise<void>((resolve, reject) => {
				const cleanup = () => {
					if (rafId !== null) {
						cancelAnimationFrame(rafId);
						rafId = null;
					}
					media.removeEventListener("error", onError);
					media.removeEventListener("ended", onEnded);
				};

				const onError = () => {
					cleanup();
					reject(new Error("Failed while rendering speed-adjusted audio timeline"));
				};

				const onEnded = () => {
					cleanup();
					resolve();
				};

				const tick = () => {
					if (this.cancelled) {
						cleanup();
						resolve();
						return;
					}

					// Stop at validated duration; media.duration can be inflated by bad
					// container metadata.
					if (media.currentTime >= validatedDurationSec) {
						media.pause();
						cleanup();
						resolve();
						return;
					}

					const currentTimeMs = media.currentTime * 1000;
					const activeTrimRegion = this.findActiveTrimRegion(currentTimeMs, trimRegions);

					if (activeTrimRegion && !media.paused && !media.ended) {
						const skipToTime = activeTrimRegion.endMs / 1000;
						if (skipToTime >= media.duration || skipToTime >= validatedDurationSec) {
							media.pause();
							cleanup();
							resolve();
							return;
						}
						// Pause recording during the seek so we don't capture silence/noise.
						media.pause();
						if (recorder?.state === "recording") recorder.pause();
						const onSeeked = () => {
							clearTimeout(seekTimer);
							if (this.cancelled) {
								cleanup();
								resolve();
								return;
							}
							if (recorder?.state === "paused") recorder.resume();
							media
								.play()
								.then(() => {
									if (!this.cancelled) rafId = requestAnimationFrame(tick);
								})
								.catch((err) => {
									cleanup();
									reject(
										new Error(
											`Failed to resume playback after trim seek: ${err instanceof Error ? err.message : String(err)}`,
										),
									);
								});
						};
						const seekTimer = window.setTimeout(() => {
							media.removeEventListener("seeked", onSeeked);
							cleanup();
							reject(new Error("Audio seek timed out while skipping trim region"));
						}, SEEK_TIMEOUT_MS);
						media.addEventListener("seeked", onSeeked, { once: true });
						media.currentTime = skipToTime;
						return;
					}

					const activeSpeedRegion = this.findActiveSpeedRegion(currentTimeMs, speedRegions);
					const playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
					if (Math.abs(media.playbackRate - playbackRate) > 0.0001) {
						media.playbackRate = playbackRate;
					}

					if (!media.paused && !media.ended) {
						rafId = requestAnimationFrame(tick);
					} else {
						cleanup();
						resolve();
					}
				};

				media.addEventListener("error", onError, { once: true });
				media.addEventListener("ended", onEnded, { once: true });
				rafId = requestAnimationFrame(tick);
			});
		} finally {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
			}
			media.pause();
			if (recorder && recorder.state !== "inactive") {
				recorder.stop();
			}
			destinationNode.stream.getTracks().forEach((track) => track.stop());
			sourceNode.disconnect();
			destinationNode.disconnect();
			await audioContext.close();
			media.src = "";
			media.load();
		}

		if (!recordedBlobPromise) {
			// Either an early return fired or startAudioRecording set this before playback
			// resolved. Reaching here means that broke; fail loud rather than return silence.
			throw new Error("Audio recorder finished without assigning recordedBlobPromise");
		}
		const recordedBlob = await recordedBlobPromise;
		if (this.cancelled) {
			throw new Error("Export cancelled");
		}
		return recordedBlob;
	}

	// Demux the rendered speed-adjusted blob and feed its chunks into the MP4 muxer.
	private async muxRenderedAudioBlob(
		blob: Blob,
		muxer: VideoMuxer,
		exportCodec: ExportAudioCodec,
	): Promise<void> {
		if (this.cancelled) return;

		const file = new File([blob], "speed-audio.webm", { type: blob.type || "audio/webm" });
		const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
		const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });

		try {
			await demuxer.load(file);
			await this.processTrimOnlyAudio(demuxer, muxer, [], undefined, exportCodec);
		} finally {
			try {
				demuxer.destroy();
			} catch {
				/* ignore */
			}
		}
	}

	private startAudioRecording(stream: MediaStream): {
		recorder: MediaRecorder;
		recordedBlobPromise: Promise<Blob>;
	} {
		const mimeType = this.getSupportedAudioMimeType();
		const options: MediaRecorderOptions = {
			audioBitsPerSecond: AUDIO_BITRATE,
			...(mimeType ? { mimeType } : {}),
		};

		const recorder = new MediaRecorder(stream, options);
		const chunks: Blob[] = [];

		const recordedBlobPromise = new Promise<Blob>((resolve, reject) => {
			recorder.ondataavailable = (event: BlobEvent) => {
				if (event.data && event.data.size > 0) {
					chunks.push(event.data);
				}
			};
			recorder.onerror = () => {
				reject(new Error("MediaRecorder failed while capturing speed-adjusted audio"));
			};
			recorder.onstop = () => {
				const type = mimeType || chunks[0]?.type || "audio/webm";
				resolve(new Blob(chunks, { type }));
			};
		});

		recorder.start();
		return { recorder, recordedBlobPromise };
	}

	private getSupportedAudioMimeType(): string | undefined {
		const candidates = ["audio/webm;codecs=opus", "audio/webm"];
		for (const candidate of candidates) {
			if (MediaRecorder.isTypeSupported(candidate)) {
				return candidate;
			}
		}
		return undefined;
	}

	private waitForLoadedMetadata(media: HTMLMediaElement): Promise<void> {
		if (Number.isFinite(media.duration) && media.readyState >= HTMLMediaElement.HAVE_METADATA) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			const onLoaded = () => {
				cleanup();
				resolve();
			};
			const onError = () => {
				cleanup();
				reject(new Error("Failed to load media metadata for speed-adjusted audio"));
			};
			const cleanup = () => {
				media.removeEventListener("loadedmetadata", onLoaded);
				media.removeEventListener("error", onError);
			};

			media.addEventListener("loadedmetadata", onLoaded);
			media.addEventListener("error", onError, { once: true });
		});
	}

	private seekTo(media: HTMLMediaElement, targetSec: number): Promise<void> {
		if (Math.abs(media.currentTime - targetSec) < 0.0001) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			const onSeeked = () => {
				cleanup();
				resolve();
			};
			const onError = () => {
				cleanup();
				reject(new Error("Failed to seek media for speed-adjusted audio"));
			};
			const cleanup = () => {
				media.removeEventListener("seeked", onSeeked);
				media.removeEventListener("error", onError);
			};

			media.addEventListener("seeked", onSeeked, { once: true });
			media.addEventListener("error", onError, { once: true });
			media.currentTime = targetSec;
		});
	}

	private findActiveTrimRegion(
		currentTimeMs: number,
		trimRegions: TrimRegion[],
	): TrimRegion | null {
		return (
			trimRegions.find(
				(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	}

	private findActiveSpeedRegion(
		currentTimeMs: number,
		speedRegions: SpeedRegion[],
	): SpeedRegion | null {
		return (
			speedRegions.find(
				(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	}

	private cloneForEncoding(
		src: AudioData,
		newTimestamp: number,
		targetChannels: number,
	): AudioData {
		if (targetChannels !== src.numberOfChannels) {
			return this.downmixWithTimestamp(src, newTimestamp, targetChannels);
		}

		if (!src.format) {
			throw new Error("AudioData format is required for cloning");
		}
		const isPlanar = src.format.includes("planar");
		const numPlanes = isPlanar ? src.numberOfChannels : 1;

		let totalSize = 0;
		for (let planeIndex = 0; planeIndex < numPlanes; planeIndex++) {
			totalSize += src.allocationSize({ planeIndex });
		}

		const buffer = new ArrayBuffer(totalSize);
		let offset = 0;
		for (let planeIndex = 0; planeIndex < numPlanes; planeIndex++) {
			const planeSize = src.allocationSize({ planeIndex });
			src.copyTo(new Uint8Array(buffer, offset, planeSize), { planeIndex });
			offset += planeSize;
		}

		return new AudioData({
			format: src.format,
			sampleRate: src.sampleRate,
			numberOfFrames: src.numberOfFrames,
			numberOfChannels: src.numberOfChannels,
			timestamp: newTimestamp,
			data: buffer,
		});
	}

	private downmixWithTimestamp(
		src: AudioData,
		newTimestamp: number,
		targetChannels: number,
	): AudioData {
		const sourceChannels = src.numberOfChannels;
		const frameCount = src.numberOfFrames;
		if (targetChannels < 1 || targetChannels > 2) {
			throw new Error(`Unsupported target channel count: ${targetChannels}`);
		}

		const sourcePlanes = Array.from({ length: sourceChannels }, () => new Float32Array(frameCount));
		for (let channel = 0; channel < sourceChannels; channel++) {
			src.copyTo(sourcePlanes[channel], {
				format: "f32-planar",
				planeIndex: channel,
			});
		}

		const output = downmixPlanarChannelsForExport(sourcePlanes, targetChannels);

		return new AudioData({
			format: "f32-planar",
			sampleRate: src.sampleRate,
			numberOfFrames: frameCount,
			numberOfChannels: targetChannels,
			timestamp: newTimestamp,
			data: output.buffer instanceof ArrayBuffer ? output.buffer : output.slice().buffer,
		});
	}

	private isInTrimRegion(timestampMs: number, trims: TrimRegion[]): boolean {
		return trims.some((trim) => timestampMs >= trim.startMs && timestampMs < trim.endMs);
	}

	private computeTrimOffset(timestampMs: number, trims: TrimRegion[]): number {
		let offset = 0;
		for (const trim of trims) {
			if (trim.endMs <= timestampMs) {
				offset += trim.endMs - trim.startMs;
			}
		}
		return offset;
	}

	cancel(): void {
		this.cancelled = true;
	}
}
