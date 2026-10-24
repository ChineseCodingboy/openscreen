import { useEffect, useRef, useState } from "react";
import { AVMediaType, WebDemuxer } from "web-demuxer";
import { resolveAudioStreamByOrdinal } from "@/lib/audioTrackOrdinals";
import { loadFileAsArrayBuffer } from "@/lib/exporter/streamingDecoder";

let _audioCtx: AudioContext | null = null;
/** Returns the shared AudioContext, creating it lazily on first call. */
function getAudioCtx(): AudioContext {
	if (!_audioCtx) _audioCtx = new AudioContext();
	return _audioCtx;
}

async function decodeSelectedAudioStream(
	arrayBuffer: ArrayBuffer,
	trackOrdinal: number,
): Promise<AudioBuffer> {
	const file = new File([arrayBuffer], "waveform-source.mp4", { type: "video/mp4" });
	const demuxer = new WebDemuxer({
		wasmFilePath: new URL("../lib/exporter/wasm/web-demuxer.wasm", window.location.href).href,
	});
	const frames: AudioData[] = [];
	try {
		await demuxer.load(file);
		const mediaInfo = await demuxer.getMediaInfo();
		const stream = resolveAudioStreamByOrdinal(mediaInfo.streams, trackOrdinal);
		if (!stream) throw new Error(`Audio track ${trackOrdinal} was not found`);
		const config = demuxer.genDecoderConfig("audio", stream);
		if (!(await AudioDecoder.isConfigSupported(config)).supported) {
			throw new Error(`Audio track ${trackOrdinal} uses an unsupported codec`);
		}
		const decoder = new AudioDecoder({
			output: (frame) => frames.push(frame),
			error: (error) => console.warn("useAudioPeaks: stream decode failed", error),
		});
		decoder.configure(config);
		const readEnd =
			Number.isFinite(mediaInfo.duration) && mediaInfo.duration > 0
				? mediaInfo.duration + 0.5
				: 4 * 60 * 60;
		const reader = demuxer
			.readAVPacket(0, readEnd, AVMediaType.AVMEDIA_TYPE_AUDIO, stream.index)
			.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done || !value) break;
				decoder.decode(demuxer.genEncodedChunk("audio", value));
				while (decoder.decodeQueueSize > 20) {
					await new Promise((resolve) => setTimeout(resolve, 1));
				}
			}
		} finally {
			await reader.cancel().catch(() => undefined);
		}
		await decoder.flush();
		decoder.close();
		if (!frames.length) throw new Error(`Audio track ${trackOrdinal} decoded no samples`);

		const sampleRate = config.sampleRate || 48_000;
		const channels = config.numberOfChannels || 2;
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
	} finally {
		for (const frame of frames) {
			try {
				frame.close();
			} catch {
				// Already closed after copying.
			}
		}
		demuxer.destroy();
	}
}

/**
 * Offloads peak computation to a Web Worker (zero-copy via Transferable).
 * On abort, the worker is terminated and the promise rejects with AbortError.
 */
function computePeaksInWorker(
	audioBuffer: AudioBuffer,
	signal?: AbortSignal,
): Promise<Float32Array> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}

		const worker = new Worker(new URL("./audioPeaksWorker.ts", import.meta.url), {
			type: "module",
		});

		const onAbort = () => {
			worker.terminate();
			reject(new DOMException("Aborted", "AbortError"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		// slice() creates an owned copy so the transfer is safe and the
		// AudioBuffer remains valid if anything else holds a reference.
		const channels: Float32Array[] = [];
		for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
			channels.push(audioBuffer.getChannelData(c).slice());
		}

		worker.onmessage = (e: MessageEvent<Float32Array>) => {
			signal?.removeEventListener("abort", onAbort);
			worker.terminate();
			resolve(e.data);
		};

		worker.onerror = (e) => {
			signal?.removeEventListener("abort", onAbort);
			worker.terminate();
			reject(e);
		};

		worker.postMessage(
			{ channels, duration: audioBuffer.duration },
			channels.map((ch) => ch.buffer),
		);
	});
}

/**
 * Decodes audio from `videoUrl` into paired [min, max] peaks (length = 2 * N
 * blocks). Returns `null` while decoding, and stays `null` on no audio track or
 * decode failure (silent degradation). Results are cached in a ref scoped to the
 * hook instance, so they survive re-renders and waveform toggles but not unmount.
 */
export function useAudioPeaks(videoUrl?: string, trackOrdinal?: number): Float32Array | null {
	const cacheKey = videoUrl ? `${videoUrl}#audio-track-${trackOrdinal ?? "default"}` : undefined;
	const cacheRef = useRef<Map<string, Float32Array>>(new Map());
	const [peaks, setPeaks] = useState<Float32Array | null>(() =>
		cacheKey ? (cacheRef.current.get(cacheKey) ?? null) : null,
	);

	useEffect(() => {
		if (!videoUrl) {
			setPeaks(null);
			return;
		}

		const key = `${videoUrl}#audio-track-${trackOrdinal ?? "default"}`;
		const cached = cacheRef.current.get(key);
		if (cached) {
			setPeaks(cached);
			return;
		}

		setPeaks(null);
		let cancelled = false;
		const controller = new AbortController();

		(async () => {
			try {
				const { data: arrayBuffer } = await loadFileAsArrayBuffer(videoUrl);
				if (cancelled) return;
				const audioBuffer =
					typeof trackOrdinal === "number"
						? await decodeSelectedAudioStream(arrayBuffer, trackOrdinal)
						: await getAudioCtx().decodeAudioData(arrayBuffer);
				if (cancelled) return;
				const p = await computePeaksInWorker(audioBuffer, controller.signal);
				if (cancelled) return;
				cacheRef.current.set(key, p);
				setPeaks(p);
			} catch (err) {
				// AbortError means the effect cleaned up, so no state update needed.
				if (err instanceof DOMException && err.name === "AbortError") return;
				// No audio track or unsupported format: degrade to no waveform, but log
				// so an unexpectedly-missing waveform is diagnosable.
				console.warn("useAudioPeaks: could not decode audio for waveform:", err);
				if (!cancelled) setPeaks(null);
			}
		})();

		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [videoUrl, trackOrdinal]);

	return peaks;
}
