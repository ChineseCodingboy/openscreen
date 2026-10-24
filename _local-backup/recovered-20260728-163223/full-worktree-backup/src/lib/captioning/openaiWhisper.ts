import { encodeWavPcm16Mono } from "@/lib/voiceover/wav";
import type { CaptionSegment, TranscribeMono16kResult } from "./transcribe";

const SAMPLE_RATE = 16_000;
const CHUNK_SECONDS = 10 * 60;
const OVERLAP_SECONDS = 0.5;

interface WhisperWord {
	word?: unknown;
	start?: unknown;
	end?: unknown;
}

interface WhisperSegment {
	text?: unknown;
	start?: unknown;
	end?: unknown;
}

interface WhisperResponse {
	words?: unknown;
	segments?: unknown;
}

function createWav(samples: Float32Array): ArrayBuffer {
	return encodeWavPcm16Mono(samples, SAMPLE_RATE);
}

function toSegments(response: WhisperResponse, offsetSec: number): TranscribeMono16kResult {
	const words = Array.isArray(response.words) ? response.words : [];
	const wordSegments: CaptionSegment[] = words.flatMap((candidate: WhisperWord) => {
		if (
			typeof candidate.word !== "string" ||
			typeof candidate.start !== "number" ||
			typeof candidate.end !== "number" ||
			candidate.end <= candidate.start
		) {
			return [];
		}
		return [
			{
				startSec: candidate.start + offsetSec,
				endSec: candidate.end + offsetSec,
				text: candidate.word,
			},
		];
	});
	if (wordSegments.length) return { segments: wordSegments, granularity: "word" };

	const segments = Array.isArray(response.segments) ? response.segments : [];
	return {
		segments: segments.flatMap((candidate: WhisperSegment) => {
			if (
				typeof candidate.text !== "string" ||
				typeof candidate.start !== "number" ||
				typeof candidate.end !== "number" ||
				candidate.end <= candidate.start
			) {
				return [];
			}
			return [
				{
					startSec: candidate.start + offsetSec,
					endSec: candidate.end + offsetSec,
					text: candidate.text,
				},
			];
		}),
		granularity: "phrase",
	};
}

/** Calls OpenAI from Electron's main process; the renderer never receives the API key. */
export async function transcribeMono16kWithOpenAI(
	samples: Float32Array,
	options?: { language?: string; onProgress?: (completed: number, total: number) => void },
): Promise<TranscribeMono16kResult> {
	const chunkSize = CHUNK_SECONDS * SAMPLE_RATE;
	const overlap = OVERLAP_SECONDS * SAMPLE_RATE;
	const all: CaptionSegment[] = [];
	let granularity: TranscribeMono16kResult["granularity"] = "phrase";
	const total = Math.max(1, Math.ceil(samples.length / chunkSize));

	for (let start = 0, chunk = 0; start < samples.length; start += chunkSize - overlap, chunk++) {
		const end = Math.min(samples.length, start + chunkSize);
		const result = await window.electronAPI.transcribeWithOpenAIWhisper(
			createWav(samples.subarray(start, end)),
			options?.language,
		);
		if (!result.success)
			throw new Error(result.message || result.code || "OpenAI transcription failed");
		const parsed = toSegments((result.data ?? {}) as WhisperResponse, start / SAMPLE_RATE);
		granularity = parsed.granularity === "word" ? "word" : granularity;
		for (const segment of parsed.segments) {
			const duplicate = all.some(
				(existing) =>
					Math.abs(existing.startSec - segment.startSec) < 0.08 &&
					existing.text.trim() === segment.text.trim(),
			);
			if (!duplicate) all.push(segment);
		}
		options?.onProgress?.(Math.min(chunk + 1, total), total);
		if (end === samples.length) break;
	}

	return { segments: all.sort((left, right) => left.startSec - right.startSec), granularity };
}
