import {
	VOICEOVER_MAX_COMPRESSION,
	VOICEOVER_TRIM_FADE_MS,
	VOICEOVER_WINDOW_TOLERANCE,
} from "./constants";

/** Linear-interpolation resampler; adequate for speech and fully deterministic. */
export function resampleLinear(
	samples: Float32Array,
	sourceRate: number,
	targetRate: number,
): Float32Array {
	if (sourceRate === targetRate || samples.length === 0) return samples;
	const targetLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
	const output = new Float32Array(targetLength);
	const step = (samples.length - 1) / Math.max(1, targetLength - 1);
	for (let index = 0; index < targetLength; index++) {
		const position = index * step;
		const low = Math.floor(position);
		const high = Math.min(samples.length - 1, low + 1);
		const fraction = position - low;
		output[index] = samples[low] * (1 - fraction) + samples[high] * fraction;
	}
	return output;
}

export interface FitResult {
	samples: Float32Array;
	compressed: boolean;
	trimmed: boolean;
}

/**
 * Fits one utterance's audio into its timeline window: small overflows play as-is,
 * larger ones are sped up (resampled) up to `maxCompression`, and anything beyond
 * that is hard-trimmed with a short fade so the next utterance still starts on time.
 */
export function fitSamplesToWindow(
	samples: Float32Array,
	sampleRate: number,
	windowMs: number,
	options?: { tolerance?: number; maxCompression?: number; fadeMs?: number },
): FitResult {
	const tolerance = options?.tolerance ?? VOICEOVER_WINDOW_TOLERANCE;
	const maxCompression = options?.maxCompression ?? VOICEOVER_MAX_COMPRESSION;
	const fadeMs = options?.fadeMs ?? VOICEOVER_TRIM_FADE_MS;

	const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
	if (samples.length <= windowSamples * tolerance) {
		return { samples, compressed: false, trimmed: false };
	}

	const neededCompression = samples.length / windowSamples;
	const compression = Math.min(neededCompression, maxCompression);
	let fitted = resampleLinear(samples, sampleRate * compression, sampleRate);

	let trimmed = false;
	if (fitted.length > windowSamples) {
		fitted = fitted.slice(0, windowSamples);
		const fadeSamples = Math.min(fitted.length, Math.round((fadeMs / 1000) * sampleRate));
		for (let index = 0; index < fadeSamples; index++) {
			const position = fitted.length - fadeSamples + index;
			fitted[position] *= 1 - (index + 1) / fadeSamples;
		}
		trimmed = true;
	}
	return { samples: fitted, compressed: true, trimmed };
}

export interface PlacedUtteranceAudio {
	startMs: number;
	samples: Float32Array;
}

/** Lays fitted utterance audio onto one silent full-length mono buffer. */
export function assembleVoiceoverTimeline(
	placed: PlacedUtteranceAudio[],
	durationMs: number,
	sampleRate: number,
): Float32Array {
	const totalSamples = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
	const output = new Float32Array(totalSamples);
	for (const utterance of placed) {
		const offset = Math.max(0, Math.round((utterance.startMs / 1000) * sampleRate));
		const copyLength = Math.min(utterance.samples.length, totalSamples - offset);
		for (let index = 0; index < copyLength; index++) {
			output[offset + index] += utterance.samples[index];
		}
	}
	return output;
}
