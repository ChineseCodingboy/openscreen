import { MAX_CAPTION_AUDIO_SEC } from "./captionConstants";
import { extractMonoPcmViaWebDemuxer } from "./extractMono16kWebDemuxer";

export { MAX_CAPTION_AUDIO_SEC };

const FETCH_TIMEOUT_MS = 120_000;

async function fetchWithTimeout(url: string, signal?: AbortSignal): Promise<Response> {
	const ctrl = new AbortController();
	const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
	const onAbort = () => ctrl.abort();
	if (signal) {
		if (signal.aborted) ctrl.abort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	try {
		return await fetch(url, { signal: ctrl.signal });
	} finally {
		window.clearTimeout(timer);
		if (signal) signal.removeEventListener("abort", onAbort);
	}
}

/**
 * Load the editor video like `StreamingVideoDecoder`: Electron `readBinaryFile`
 * for local paths (fetch(file://) is unreliable in the renderer), otherwise
 * HTTP/blob/data URLs via fetch.
 */
async function loadSourceVideoFile(videoUrl: string, signal?: AbortSignal): Promise<File> {
	const isRemoteUrl = /^(https?:|blob:|data:)/i.test(videoUrl);

	if (!isRemoteUrl && window.electronAPI?.readBinaryFile) {
		const result = await window.electronAPI.readBinaryFile(videoUrl);
		if (!result.success || !result.data) {
			throw new Error(result.message || result.error || "Failed to read source video");
		}
		const filename = (result.path || videoUrl).split(/[\\/]/).pop() || "video";
		return new File([result.data], filename, { type: "video/webm" });
	}

	const response = await fetchWithTimeout(videoUrl, signal);
	if (!response.ok) {
		throw new Error(`Failed to load video for captions: ${response.status} ${response.statusText}`);
	}
	const blob = await response.blob();
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	const filename = videoUrl.split("/").pop() || "video";
	return new File([blob], filename, { type: blob.type || "video/webm" });
}

async function resampleMono(
	mono: Float32Array,
	fromRate: number,
	toRate: number,
	signal?: AbortSignal,
): Promise<Float32Array> {
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	if (fromRate === toRate) return mono;
	const durationSec = mono.length / fromRate;
	const outLength = Math.max(1, Math.ceil(durationSec * toRate));
	const offline = new OfflineAudioContext(1, outLength, toRate);
	const buf = offline.createBuffer(1, mono.length, fromRate);
	buf.copyToChannel(Float32Array.from(mono), 0);
	const src = offline.createBufferSource();
	src.buffer = buf;
	src.connect(offline.destination);
	src.start(0);
	const rendered = await offline.startRendering();
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	return rendered.getChannelData(0).slice();
}

async function truncateAndResampleTo16k(
	mono: Float32Array,
	fromRate: number,
	durationSec: number,
	signal?: AbortSignal,
): Promise<{ samples: Float32Array; truncated: boolean; durationSec: number }> {
	let truncated = false;
	let work = mono;
	if (durationSec > MAX_CAPTION_AUDIO_SEC) {
		const maxSamples = Math.floor(MAX_CAPTION_AUDIO_SEC * fromRate);
		work = mono.subarray(0, Math.min(mono.length, maxSamples));
		truncated = true;
	}

	const samples = await resampleMono(work, fromRate, 16_000, signal);
	return { samples, truncated, durationSec: samples.length / 16_000 };
}

/**
 * Decode the video's audio track to mono 16 kHz float samples (Whisper input).
 * Prefers `decodeAudioData` when the container is supported, else the same
 * web-demuxer + AudioDecoder path as export.
 */
export async function extractMono16kFromVideoUrl(
	videoUrl: string,
	options?: { signal?: AbortSignal },
): Promise<{ samples: Float32Array; truncated: boolean; durationSec: number }> {
	const file = await loadSourceVideoFile(videoUrl, options?.signal);
	// ScreenCaptureKit writes system and microphone audio into separate tracks. The
	// browser decoder silently picks the first one on macOS, which is often the
	// near-empty system stream; the demuxer below explicitly chooses the substantive track.
	const preferredPcm = await extractMonoPcmViaWebDemuxer(file, options?.signal);
	return truncateAndResampleTo16k(
		preferredPcm.mono,
		preferredPcm.sampleRate,
		preferredPcm.durationSec,
		options?.signal,
	);
}
