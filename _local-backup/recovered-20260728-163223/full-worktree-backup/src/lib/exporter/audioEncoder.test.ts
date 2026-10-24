import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AudioProcessor,
	buildAudioClipSchedules,
	buildSpeedAdjustedAudioSegments,
	downmixPlanarChannelsForExport,
	getPacketCopyTrackOrdinal,
	selectPreferredAudioStream,
} from "./audioEncoder";

describe("AudioProcessor.selectSupportedExportCodec", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("falls back to stereo when the source channel count cannot be encoded", async () => {
		const isConfigSupported = vi.fn(async (config: AudioEncoderConfig) => ({
			config,
			supported:
				config.codec === "mp4a.40.2" &&
				config.sampleRate === 44100 &&
				config.numberOfChannels === 2,
		}));
		vi.stubGlobal("AudioEncoder", { isConfigSupported });

		const codec = await AudioProcessor.selectSupportedExportCodec(44100, 8);

		expect(codec).toMatchObject({
			encoderCodec: "mp4a.40.2",
			muxerCodec: "aac",
			sampleRate: 44100,
			numberOfChannels: 2,
		});
		expect(isConfigSupported).toHaveBeenCalledWith({
			codec: "mp4a.40.2",
			sampleRate: 44100,
			numberOfChannels: 8,
			bitrate: 128000,
		});
		expect(isConfigSupported).toHaveBeenCalledWith({
			codec: "mp4a.40.2",
			sampleRate: 44100,
			numberOfChannels: 2,
			bitrate: 128000,
		});
	});

	it("marks AAC as packet-copy-only when AAC encoding is unavailable", async () => {
		vi.stubGlobal("AudioEncoder", {
			isConfigSupported: vi.fn(async (config: AudioEncoderConfig) => ({
				config,
				supported: false,
			})),
		});
		const demuxer = {
			getMediaInfo: vi.fn(async () => ({
				streams: [
					{
						index: 1,
						codec_type_string: "audio",
						codec_name: "aac",
						bit_rate: "128000",
						channels: 2,
						sample_rate: "48000",
					},
				],
			})),
			genDecoderConfig: vi.fn(() => ({
				codec: "mp4a.40.2",
				sampleRate: 48_000,
				numberOfChannels: 2,
			})),
		};

		const codec = await AudioProcessor.selectSupportedExportCodecForSource(demuxer as never);

		expect(codec).toMatchObject({
			muxerCodec: "aac",
			encodingSupported: false,
		});
	});
});

describe("downmixPlanarChannelsForExport", () => {
	it("preserves non-front Windows system audio channels when exporting stereo", () => {
		const sourcePlanes = Array.from({ length: 8 }, (_, channel) => {
			const plane = new Float32Array(2);
			if (channel === 2) {
				plane[0] = 0.8;
				plane[1] = 0.4;
			}
			if (channel === 6) {
				plane[0] = 0.2;
				plane[1] = 0.1;
			}
			return plane;
		});

		const stereo = downmixPlanarChannelsForExport(sourcePlanes, 2);

		expect(stereo[0]).toBeGreaterThan(0);
		expect(stereo[1]).toBeGreaterThan(0);
		expect(stereo[2]).toBeGreaterThan(0);
		expect(stereo[3]).toBeGreaterThan(0);
	});

	it("duplicates mono microphone audio when exporting stereo", () => {
		const mono = new Float32Array([0.25, -0.5]);

		const stereo = downmixPlanarChannelsForExport([mono], 2);

		expect(Array.from(stereo)).toEqual([0.25, -0.5, 0.25, -0.5]);
	});
});

describe("buildSpeedAdjustedAudioSegments", () => {
	it("keeps source order while applying trims and speed-adjusted output timing", () => {
		const segments = buildSpeedAdjustedAudioSegments(
			10,
			[{ id: "trim", startMs: 3000, endMs: 4000 }],
			[
				{ id: "fast", startMs: 1000, endMs: 3000, speed: 2 },
				{ id: "slow", startMs: 4000, endMs: 6000, speed: 0.5 },
			],
		);

		expect(segments).toEqual([
			{ sourceStartSec: 0, sourceDurationSec: 1, playbackRate: 1, outputStartSec: 0 },
			{ sourceStartSec: 1, sourceDurationSec: 2, playbackRate: 2, outputStartSec: 1 },
			{ sourceStartSec: 4, sourceDurationSec: 2, playbackRate: 0.5, outputStartSec: 2 },
			{ sourceStartSec: 6, sourceDurationSec: 4, playbackRate: 1, outputStartSec: 6 },
		]);
	});

	it("drops invalid speed regions instead of scheduling invalid audio", () => {
		const segments = buildSpeedAdjustedAudioSegments(
			2,
			[],
			[{ id: "invalid", startMs: 500, endMs: 1500, speed: 0 }],
		);

		expect(segments).toEqual([
			{ sourceStartSec: 0, sourceDurationSec: 0.5, playbackRate: 1, outputStartSec: 0 },
			{ sourceStartSec: 1.5, sourceDurationSec: 0.5, playbackRate: 1, outputStartSec: 0.5 },
		]);
	});
});

describe("buildAudioClipSchedules", () => {
	it("keeps a large source offset when the edited timeline is shorter than the source", () => {
		const schedules = buildAudioClipSchedules(
			1,
			[
				{
					id: "late-source",
					role: "mixed",
					trackOrdinal: 0,
					startMs: 0,
					endMs: 1000,
					sourceStartMs: 9000,
					muted: false,
					gain: 1,
				},
			],
			[],
			[],
		);

		expect(schedules).toEqual([
			{
				trackOrdinal: 0,
				sourceStartSec: 9,
				sourceDurationSec: 1,
				outputStartSec: 0,
				playbackRate: 1,
				gain: 1,
			},
		]);
	});

	it("keeps system and microphone clips independent while mapping their source offsets", () => {
		const schedules = buildAudioClipSchedules(
			5,
			[
				{
					id: "system",
					role: "system",
					trackOrdinal: 0,
					startMs: 0,
					endMs: 2000,
					sourceStartMs: 0,
					muted: false,
					gain: 0.5,
				},
				{
					id: "microphone",
					role: "microphone",
					trackOrdinal: 1,
					startMs: 1000,
					endMs: 3000,
					sourceStartMs: 500,
					muted: false,
					gain: 1,
				},
			],
			[],
			[],
		);

		expect(schedules).toEqual([
			{
				trackOrdinal: 0,
				sourceStartSec: 0,
				sourceDurationSec: 2,
				outputStartSec: 0,
				playbackRate: 1,
				gain: 0.5,
			},
			{
				trackOrdinal: 1,
				sourceStartSec: 0.5,
				sourceDurationSec: 2,
				outputStartSec: 1,
				playbackRate: 1,
				gain: 1,
			},
		]);
	});

	it("schedules a microphone-only recording from the first audio track", () => {
		const schedules = buildAudioClipSchedules(
			5,
			[
				{
					id: "microphone",
					role: "microphone",
					trackOrdinal: 0,
					startMs: 0,
					endMs: 5000,
					sourceStartMs: 0,
					muted: false,
					gain: 1,
				},
			],
			[],
			[],
		);

		expect(schedules).toEqual([
			{
				trackOrdinal: 0,
				sourceStartSec: 0,
				sourceDurationSec: 5,
				outputStartSec: 0,
				playbackRate: 1,
				gain: 1,
			},
		]);
	});
});

describe("getPacketCopyTrackOrdinal", () => {
	it("allows a full-span neutral mixed track to bypass audio decoding", () => {
		expect(
			getPacketCopyTrackOrdinal(
				[
					{
						id: "mixed",
						role: "mixed",
						trackOrdinal: 0,
						startMs: 0,
						endMs: 5000,
						sourceStartMs: 0,
						muted: false,
						gain: 1,
					},
				],
				[],
				[],
				5,
			),
		).toBe(0);
	});

	it("requires decoding when gain, trim, or multiple audible tracks change the mix", () => {
		const clip = {
			id: "mixed",
			role: "mixed" as const,
			trackOrdinal: 0,
			startMs: 0,
			endMs: 5000,
			sourceStartMs: 0,
			muted: false,
			gain: 0.5,
		};
		expect(getPacketCopyTrackOrdinal([clip], [], [], 5)).toBeNull();
		expect(
			getPacketCopyTrackOrdinal(
				[{ ...clip, gain: 1 }],
				[{ id: "cut", startMs: 1, endMs: 2 }],
				[],
				5,
			),
		).toBeNull();
	});
});

describe("selectPreferredAudioStream", () => {
	it("prefers the substantive microphone track over a tiny silent system track", () => {
		const stream = selectPreferredAudioStream([
			{
				index: 1,
				codec_type_string: "audio",
				bit_rate: "2250",
				channels: 2,
				sample_rate: 48000,
			},
			{
				index: 2,
				codec_type_string: "audio",
				bit_rate: "108606",
				channels: 2,
				sample_rate: 48000,
			},
		]);

		expect(stream?.index).toBe(2);
	});
});
