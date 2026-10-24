import { getCursorSpringConfig } from "@/components/video-editor/videoPlayback/motionSmoothing";
import type { CursorRecordingData, CursorRecordingSample } from "@/native/contracts";

/**
 * Offline cursor-path smoothing for native recordings.
 *
 * We have the whole path up front, so instead of a per-frame causal filter we precompute once:
 * resample to a fixed high rate, then run a spring-damper over it. The spring gives the motion
 * inertia (it trails the real cursor) and is deterministic, so preview and export match exactly.
 */

export interface SmoothedCursorPosition {
	cx: number;
	cy: number;
}

export interface SmoothedCursorPath {
	/** Smoothed normalized position at a time, or null when the cursor is hidden there. */
	sampleAt(timeMs: number): SmoothedCursorPosition | null;
}

/** 240 steps/sec keeps the spring stable and crisp at any playback fps. */
const STEP_MS = 1000 / 240;
const STEP_S = STEP_MS / 1000;

export interface SerializedSmoothedCursorRun {
	start: number;
	end: number;
	times: Float32Array | Float64Array;
	xs: Float32Array | Float64Array;
	ys: Float32Array | Float64Array;
}

export interface SerializedSmoothedCursorPath {
	runs: SerializedSmoothedCursorRun[];
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function binarySearchAtOrBefore(
	times: Float32Array | Float64Array | number[],
	timeMs: number,
	hi: number,
): number {
	let low = 0;
	let high = hi;
	let result = -1;
	while (low <= high) {
		const mid = low + ((high - low) >> 1);
		if (times[mid] <= timeMs) {
			result = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return result;
}

/** Linear interpolation of a sample run's position at an arbitrary time. */
function interpolateRun(
	samples: CursorRecordingSample[],
	timeMs: number,
	knownIndex?: number,
): SmoothedCursorPosition {
	const last = samples.length - 1;
	if (timeMs <= samples[0].timeMs) return { cx: samples[0].cx, cy: samples[0].cy };
	if (timeMs >= samples[last].timeMs) return { cx: samples[last].cx, cy: samples[last].cy };
	let i = knownIndex;
	if (i === undefined) {
		let low = 0;
		let high = last;
		i = 0;
		while (low <= high) {
			const mid = low + ((high - low) >> 1);
			if (samples[mid].timeMs <= timeMs) {
				i = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
	}
	const a = samples[i];
	const b = samples[i + 1] ?? a;
	const span = b.timeMs - a.timeMs;
	if (span <= 0) return { cx: a.cx, cy: a.cy };
	const t = (timeMs - a.timeMs) / span;
	return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
}

/**
 * Drive a spring across `targets`, returning the smoothed series. Semi-implicit
 * (symplectic) Euler, stable for these stiffness values at the 240Hz grid.
 */
function springSmooth(
	targets: Float32Array,
	stiffness: number,
	damping: number,
	mass: number,
): Float32Array {
	const out = new Float32Array(targets.length);
	if (targets.length === 0) return out;
	let x = targets[0];
	let v = 0;
	out[0] = x;
	for (let i = 1; i < targets.length; i++) {
		const accel = (-stiffness * (x - targets[i]) - damping * v) / mass;
		v += accel * STEP_S;
		x += v * STEP_S;
		out[i] = x;
	}
	return out;
}

/** Maximal runs of visible samples, so we never smooth across a hidden gap. */
function splitVisibleRuns(samples: CursorRecordingSample[]): CursorRecordingSample[][] {
	const runs: CursorRecordingSample[][] = [];
	let current: CursorRecordingSample[] = [];
	for (const sample of samples) {
		if (sample.visible === false) {
			if (current.length) runs.push(current);
			current = [];
			continue;
		}
		current.push(sample);
	}
	if (current.length) runs.push(current);
	return runs;
}

function buildSmoothedRun(
	samples: CursorRecordingSample[],
	stiffness: number,
	damping: number,
	mass: number,
): SerializedSmoothedCursorRun {
	const start = samples[0].timeMs;
	const end = samples[samples.length - 1].timeMs;
	const stepCount = Math.max(1, Math.round((end - start) / STEP_MS));
	const n = stepCount + 1;
	const times = new Float32Array(n);
	const rawX = new Float32Array(n);
	const rawY = new Float32Array(n);
	// The target times are monotonic, so walk the source run once instead of allocating and
	// searching its full time array for every 240 Hz output step.
	let sampleIndex = 0;
	for (let i = 0; i < n; i++) {
		const t = i === n - 1 ? end : start + i * STEP_MS;
		times[i] = t;
		while (sampleIndex + 1 < samples.length - 1 && samples[sampleIndex + 1].timeMs <= t) {
			sampleIndex++;
		}
		const p = interpolateRun(samples, t, sampleIndex);
		rawX[i] = p.cx;
		rawY[i] = p.cy;
	}
	// The spring is itself a strong low-pass (~3Hz cutoff), so it removes capture tremor without a
	// separate denoise pass. Chasing the raw target keeps the cursor accurate near sharp stops (no
	// acausal pull toward neighbouring samples that would offset clicks/dwells).
	return {
		start,
		end,
		times,
		xs: springSmooth(rawX, stiffness, damping, mass),
		ys: springSmooth(rawY, stiffness, damping, mass),
	};
}

function findRunAtTime<T extends { start: number; end: number }>(
	runs: T[],
	timeMs: number,
): T | null {
	let low = 0;
	let high = runs.length - 1;
	let candidate = -1;
	while (low <= high) {
		const mid = low + ((high - low) >> 1);
		if (runs[mid].start <= timeMs) {
			candidate = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	if (candidate < 0 || timeMs > runs[candidate].end) return null;
	return runs[candidate];
}

function sampleRun(run: SerializedSmoothedCursorRun, timeMs: number): SmoothedCursorPosition {
	const last = run.times.length - 1;
	if (timeMs <= run.times[0]) return { cx: run.xs[0], cy: run.ys[0] };
	if (timeMs >= run.times[last]) return { cx: run.xs[last], cy: run.ys[last] };
	const i = binarySearchAtOrBefore(run.times, timeMs, last);
	const span = run.times[i + 1] - run.times[i];
	if (span <= 0) return { cx: run.xs[i], cy: run.ys[i] };
	const t = (timeMs - run.times[i]) / span;
	return {
		cx: run.xs[i] + (run.xs[i + 1] - run.xs[i]) * t,
		cy: run.ys[i] + (run.ys[i + 1] - run.ys[i]) * t,
	};
}

export function createSmoothedCursorPath(
	serialized: SerializedSmoothedCursorPath,
): SmoothedCursorPath {
	return {
		sampleAt(timeMs) {
			const run = findRunAtTime(serialized.runs, timeMs);
			return run ? sampleRun(run, timeMs) : null;
		},
	};
}

/** Builds a transferable representation suitable for a Web Worker. */
export function buildSerializedSmoothedCursorPath(
	recordingData: Pick<CursorRecordingData, "samples">,
	smoothing01: number,
): SerializedSmoothedCursorPath {
	const runs = splitVisibleRuns(recordingData.samples).filter((run) => run.length > 0);
	if (runs.length === 0) {
		return { runs: [] };
	}
	if (smoothing01 <= 0) {
		return {
			runs: runs.map((run) => ({
				start: run[0].timeMs,
				end: run[run.length - 1].timeMs,
				times: Float64Array.from(run, (sample) => sample.timeMs),
				xs: Float64Array.from(run, (sample) => sample.cx),
				ys: Float64Array.from(run, (sample) => sample.cy),
			})),
		};
	}

	// Use the slider value directly to match the live overlay's spring strength so both cursor
	// systems lag identically (an extra multiplier here over-smoothed, causing a visible offset).
	const config = getCursorSpringConfig(clamp(smoothing01, 0, 1));

	return {
		runs: runs.map((run) =>
			run.length < 2
				? {
						start: run[0].timeMs,
						end: run[0].timeMs,
						times: new Float32Array([run[0].timeMs]),
						xs: new Float32Array([run[0].cx]),
						ys: new Float32Array([run[0].cy]),
					}
				: buildSmoothedRun(run, config.stiffness, config.damping, config.mass),
		),
	};
}

function buildSmoothedPath(
	recordingData: CursorRecordingData,
	smoothing01: number,
): SmoothedCursorPath {
	return createSmoothedCursorPath(buildSerializedSmoothedCursorPath(recordingData, smoothing01));
}

const pathCache = new WeakMap<CursorRecordingData, Map<string, SmoothedCursorPath>>();
const MAX_CACHED_STRENGTHS_PER_RECORDING = 4;

/**
 * Returns the smoothed cursor path for a recording at a given strength, memoized per
 * (recordingData, strength) so it's built once and shared by preview and export.
 */
export function getSmoothedCursorPath(
	recordingData: CursorRecordingData | null | undefined,
	smoothing01: number,
): SmoothedCursorPath | null {
	if (!recordingData || recordingData.samples.length === 0) return null;
	const key = (Number.isFinite(smoothing01) ? clamp(smoothing01, 0, 1) : 0).toFixed(2);
	let byStrength = pathCache.get(recordingData);
	if (!byStrength) {
		byStrength = new Map();
		pathCache.set(recordingData, byStrength);
	}
	let path = byStrength.get(key);
	if (path) {
		// Refresh insertion order so the small map acts as an LRU while the smoothing slider moves.
		byStrength.delete(key);
		byStrength.set(key, path);
	} else {
		path = buildSmoothedPath(recordingData, Number.parseFloat(key));
		byStrength.set(key, path);
		while (byStrength.size > MAX_CACHED_STRENGTHS_PER_RECORDING) {
			const oldestKey = byStrength.keys().next().value;
			if (oldestKey === undefined) break;
			byStrength.delete(oldestKey);
		}
	}
	return path;
}
