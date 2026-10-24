import type { VoiceoverUtterance } from "@/components/video-editor/types";
import {
	resolveVoiceoverStyle,
	VOICEOVER_MAX_TTS_INPUT_CHARS,
	VOICEOVER_SAMPLE_RATE,
} from "./constants";
import { assembleVoiceoverTimeline, fitSamplesToWindow, resampleLinear } from "./timelineFit";
import { decodeWavPcm16, encodeWavPcm16Mono } from "./wav";

export interface SynthesizeVoiceoverOptions {
	utterances: VoiceoverUtterance[];
	voice: string;
	styleId: string;
	polish: boolean;
	/** "hd" (gpt-audio chat models) or "standard" (gpt-4o-mini-tts). */
	quality: string;
	/** Length of the recording; the rendered WAV spans exactly this range. */
	durationMs: number;
	signal?: AbortSignal;
	onProgress?: (completed: number, total: number) => void;
}

export interface SynthesizeVoiceoverResult {
	wavData: ArrayBuffer;
	/** Utterances actually voiced (texts may differ from input when polish is on). */
	utterances: VoiceoverUtterance[];
	compressedCount: number;
	trimmedCount: number;
}

/** Splits text that exceeds the TTS input limit at punctuation/space boundaries. */
export function splitLongUtteranceText(
	text: string,
	maxChars = VOICEOVER_MAX_TTS_INPUT_CHARS,
): string[] {
	if (text.length <= maxChars) return [text];
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > maxChars) {
		const window = remaining.slice(0, maxChars);
		let cut = -1;
		for (let index = window.length - 1; index > maxChars * 0.5; index--) {
			if ("。.!?！?？;;,，、 ".includes(window[index])) {
				cut = index + 1;
				break;
			}
		}
		if (cut <= 0) cut = maxChars;
		chunks.push(remaining.slice(0, cut).trim());
		remaining = remaining.slice(cut).trim();
	}
	if (remaining) chunks.push(remaining);
	return chunks.filter((chunk) => chunk.length > 0);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("cancelled");
}

async function synthesizeUtteranceSamples(
	text: string,
	voice: string,
	instructions: string,
	quality: string,
	signal?: AbortSignal,
): Promise<Float32Array> {
	const pieces: Float32Array[] = [];
	let totalLength = 0;
	for (const chunk of splitLongUtteranceText(text)) {
		throwIfAborted(signal);
		const result = await window.electronAPI.synthesizeVoiceoverSpeech(
			chunk,
			voice,
			instructions,
			quality,
		);
		if (!result.success || !result.data) {
			throw new Error(result.message || result.code || "OpenAI speech synthesis failed");
		}
		const decoded = decodeWavPcm16(result.data);
		const resampled = resampleLinear(decoded.samples, decoded.sampleRate, VOICEOVER_SAMPLE_RATE);
		pieces.push(resampled);
		totalLength += resampled.length;
	}
	if (pieces.length === 1) return pieces[0];
	const joined = new Float32Array(totalLength);
	let offset = 0;
	for (const piece of pieces) {
		joined.set(piece, offset);
		offset += piece.length;
	}
	return joined;
}

async function polishUtteranceTexts(
	utterances: VoiceoverUtterance[],
	signal?: AbortSignal,
): Promise<VoiceoverUtterance[]> {
	throwIfAborted(signal);
	try {
		const result = await window.electronAPI.polishVoiceoverText(
			utterances.map((utterance) => utterance.text),
		);
		if (!result.success || !Array.isArray(result.texts)) return utterances;
		if (result.texts.length !== utterances.length) return utterances;
		return utterances.map((utterance, index) => {
			const polished = typeof result.texts?.[index] === "string" ? result.texts[index].trim() : "";
			return polished ? { ...utterance, text: polished } : utterance;
		});
	} catch {
		// Polish is best-effort; the original transcript is always a valid script.
		return utterances;
	}
}

/**
 * Turns the utterance script into one full-length mono WAV: per-utterance TTS,
 * per-utterance window fitting (so the next line never starts late), then placement
 * at the utterances' timeline offsets.
 */
export async function synthesizeVoiceover(
	options: SynthesizeVoiceoverOptions,
): Promise<SynthesizeVoiceoverResult> {
	const style = resolveVoiceoverStyle(options.styleId);
	let utterances = options.utterances.filter((utterance) => utterance.text.trim().length > 0);
	if (utterances.length === 0) throw new Error("No speech to synthesize");

	if (options.polish) {
		utterances = await polishUtteranceTexts(utterances, options.signal);
	}

	let compressedCount = 0;
	let trimmedCount = 0;
	const placed: Array<{ startMs: number; samples: Float32Array }> = [];
	for (let index = 0; index < utterances.length; index++) {
		throwIfAborted(options.signal);
		const utterance = utterances[index];
		const samples = await synthesizeUtteranceSamples(
			utterance.text,
			options.voice,
			style.instructions,
			options.quality,
			options.signal,
		);
		const windowEndMs =
			utterances[index + 1]?.startMs ?? Math.max(options.durationMs, utterance.startMs + 1);
		const fitted = fitSamplesToWindow(
			samples,
			VOICEOVER_SAMPLE_RATE,
			Math.max(250, windowEndMs - utterance.startMs),
		);
		if (fitted.compressed) compressedCount++;
		if (fitted.trimmed) trimmedCount++;
		placed.push({ startMs: utterance.startMs, samples: fitted.samples });
		options.onProgress?.(index + 1, utterances.length);
	}

	const timeline = assembleVoiceoverTimeline(placed, options.durationMs, VOICEOVER_SAMPLE_RATE);
	return {
		wavData: encodeWavPcm16Mono(timeline, VOICEOVER_SAMPLE_RATE),
		utterances,
		compressedCount,
		trimmedCount,
	};
}
