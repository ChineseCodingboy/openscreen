import type { CursorRecordingData, CursorRecordingSample } from "@/native/contracts";
import {
	buildSerializedSmoothedCursorPath,
	createSmoothedCursorPath,
	type SmoothedCursorPath,
	type SmoothedCursorPosition,
} from "./cursorPathSmoothing";

/** Minimum time the cursor must remain inside the dwell radius. */
export const SEMANTIC_DWELL_DURATION_MS = 350;
/** Normalized recording-space radius used to recognize a dwell and its arrival/departure. */
export const SEMANTIC_DWELL_RADIUS = 0.012;
/** Nearby event/dwell candidates inside this time window describe one semantic anchor. */
export const SEMANTIC_ANCHOR_MERGE_WINDOW_MS = 300;
/** Nearby event/dwell candidates inside this distance describe one semantic anchor. */
export const SEMANTIC_ANCHOR_MERGE_DISTANCE = 0.03;
/** A non-click anchor must move the camera by at least this normalized distance. */
export const SEMANTIC_NON_CLICK_DISPLACEMENT = 0.03;
/** Very fast recorded moves still get enough screen time to read as an intentional camera pan. */
export const SEMANTIC_MIN_TRANSITION_MS = 180;
/** Additional desired transition time per unit of normalized travel distance. */
export const SEMANTIC_TRANSITION_MS_PER_UNIT = 270;

export type SemanticCursorAnchorKind = "click" | "mouseup" | "dwell";

export interface SemanticCursorAnchor extends SmoothedCursorPosition {
	id: string;
	runIndex: number;
	timeMs: number;
	kind: SemanticCursorAnchorKind;
	/** Present for dwell anchors; useful for diagnostics and future timeline affordances. */
	dwellStartTimeMs?: number;
	dwellEndTimeMs?: number;
}

export interface SemanticCursorTransition {
	runIndex: number;
	/** Null denotes the visible run's boundary control point, not a semantic anchor. */
	fromAnchorId: string | null;
	/** Null denotes the visible run's boundary control point, not a semantic anchor. */
	toAnchorId: string | null;
	from: SmoothedCursorPosition;
	to: SmoothedCursorPosition;
	/** First recorded sample that actually leaves A's dwell radius. */
	departureTimeMs: number;
	/** First recorded sample in the final contiguous approach inside B's dwell radius. */
	arrivalTimeMs: number;
	/** Effective, non-overlapping playback interval used by sampleAt. */
	startTimeMs: number;
	/** Never later than the target anchor's recorded time, so clicks land exactly on time. */
	endTimeMs: number;
	/** "follow" replays the recorded path (drags); "synthetic" eases directly from A to B. */
	kind?: "synthetic" | "follow";
}

export interface SemanticCursorVisibleRun {
	index: number;
	startTimeMs: number;
	endTimeMs: number;
	mode: "semantic" | "fallback";
	anchorIds: string[];
}

export interface SemanticCursorPath extends SmoothedCursorPath {
	/**
	 * Camera-oriented sample with a bell-shaped temporal lag inside semantic transitions. The lag
	 * is zero at both endpoints, so cursor and camera still depart and arrive together.
	 */
	cameraSampleAt(timeMs: number, lagMs?: number): SmoothedCursorPosition | null;
	/** Semantic when at least one visible run has two usable anchors. */
	mode: "semantic" | "fallback";
	anchors: SemanticCursorAnchor[];
	transitions: SemanticCursorTransition[];
	visibleRuns: SemanticCursorVisibleRun[];
}

export type SemanticCursorPathMetadata = Pick<
	SemanticCursorPath,
	"mode" | "anchors" | "transitions" | "visibleRuns"
>;

/**
 * Lightweight semantic analysis shared by the editor and preview. Creating the final path needs
 * an injected fallback only when at least one visible run lacks enough semantic anchors.
 */
export interface PreparedSemanticCursorPath {
	metadata: SemanticCursorPathMetadata;
	requiresFallbackPath: boolean;
	/** Normalized fallback-only runs, separated by hidden samples for the smoothing worker. */
	fallbackSamples: CursorRecordingSample[];
	createPath(fallbackPath?: SmoothedCursorPath | null): SemanticCursorPath;
}

type NormalizedSample = CursorRecordingSample & { timeMs: number; cx: number; cy: number };

interface Candidate extends SmoothedCursorPosition {
	timeMs: number;
	kind: SemanticCursorAnchorKind;
	dwellStartTimeMs?: number;
	dwellEndTimeMs?: number;
}

interface ControlPoint extends SmoothedCursorPosition {
	timeMs: number;
	anchorId: string | null;
	anchorKind: SemanticCursorAnchorKind | null;
}

interface RuntimeRun {
	descriptor: SemanticCursorVisibleRun;
	initial: SmoothedCursorPosition | null;
	transitions: SemanticCursorTransition[];
	/** Present only when the run has follow transitions that replay the recorded path. */
	samples: NormalizedSample[] | null;
}

function clamp01(value: number) {
	return Math.min(1, Math.max(0, value));
}

function distance(a: SmoothedCursorPosition, b: SmoothedCursorPosition) {
	return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

function normalizeSamples(samples: CursorRecordingSample[]): NormalizedSample[] {
	return samples
		.map((sample, originalIndex) => ({ sample, originalIndex }))
		.filter(
			({ sample }) =>
				Number.isFinite(sample.timeMs) && Number.isFinite(sample.cx) && Number.isFinite(sample.cy),
		)
		.sort(
			(left, right) =>
				left.sample.timeMs - right.sample.timeMs || left.originalIndex - right.originalIndex,
		)
		.map(({ sample }) => ({
			...sample,
			timeMs: Math.max(0, sample.timeMs),
			cx: clamp01(sample.cx),
			cy: clamp01(sample.cy),
		}));
}

/** Hidden samples delimit independent runs; no anchor or transition may cross the gap. */
function splitVisibleRuns(samples: NormalizedSample[]): NormalizedSample[][] {
	const runs: NormalizedSample[][] = [];
	let current: NormalizedSample[] = [];
	for (const sample of samples) {
		if (sample.visible === false) {
			if (current.length > 0) runs.push(current);
			current = [];
			continue;
		}
		current.push(sample);
	}
	if (current.length > 0) runs.push(current);
	return runs;
}

function interactionCandidates(samples: NormalizedSample[]): Candidate[] {
	return samples.flatMap((sample): Candidate[] => {
		if (sample.interactionType !== "click" && sample.interactionType !== "mouseup") return [];
		return [
			{
				timeMs: sample.timeMs,
				cx: sample.cx,
				cy: sample.cy,
				kind: sample.interactionType,
			},
		];
	});
}

/**
 * Detect maximal-enough stationary spans around their first sample. A successful span is consumed
 * as one dwell, so a long pause never emits a stream of duplicate anchors.
 */
function dwellCandidates(samples: NormalizedSample[], events: Candidate[]): Candidate[] {
	const candidates: Candidate[] = [];
	let startIndex = 0;

	while (startIndex < samples.length - 1) {
		const origin = samples[startIndex];
		let endIndexExclusive = startIndex + 1;
		while (
			endIndexExclusive < samples.length &&
			distance(origin, samples[endIndexExclusive]) <= SEMANTIC_DWELL_RADIUS
		) {
			endIndexExclusive += 1;
		}

		const end = samples[endIndexExclusive - 1];
		const durationMs = end.timeMs - origin.timeMs;
		if (durationMs >= SEMANTIC_DWELL_DURATION_MS) {
			// A click or mouseup anywhere in the stationary span is the stronger semantic signal.
			const containsInteraction = events.some(
				(event) => event.timeMs >= origin.timeMs && event.timeMs <= end.timeMs,
			);
			if (!containsInteraction) {
				let sumX = 0;
				let sumY = 0;
				for (let index = startIndex; index < endIndexExclusive; index += 1) {
					sumX += samples[index].cx;
					sumY += samples[index].cy;
				}
				const count = endIndexExclusive - startIndex;
				candidates.push({
					timeMs: origin.timeMs + durationMs / 2,
					cx: sumX / count,
					cy: sumY / count,
					kind: "dwell",
					dwellStartTimeMs: origin.timeMs,
					dwellEndTimeMs: end.timeMs,
				});
			}
			startIndex = endIndexExclusive;
		} else {
			startIndex += 1;
		}
	}

	return candidates;
}

function candidatePriority(kind: SemanticCursorAnchorKind) {
	if (kind === "click") return 3;
	if (kind === "mouseup") return 2;
	return 1;
}

function mergeNearbyCandidates(candidates: Candidate[]): Candidate[] {
	const sorted = [...candidates].sort(
		(left, right) =>
			left.timeMs - right.timeMs || candidatePriority(right.kind) - candidatePriority(left.kind),
	);
	const merged: Candidate[] = [];

	for (const candidate of sorted) {
		const previous = merged[merged.length - 1];
		const isNearby =
			previous !== undefined &&
			candidate.timeMs - previous.timeMs <= SEMANTIC_ANCHOR_MERGE_WINDOW_MS &&
			distance(candidate, previous) <= SEMANTIC_ANCHOR_MERGE_DISTANCE;
		// Distinct clicks are ground truth the content reacts to; never merge one away.
		if (!isNearby || (candidate.kind === "click" && previous.kind === "click")) {
			merged.push(candidate);
			continue;
		}

		// Keep the strongest semantic evidence. Equal-priority candidates retain the earlier sample.
		if (candidatePriority(candidate.kind) > candidatePriority(previous.kind)) {
			merged[merged.length - 1] = candidate;
		}
	}

	return merged;
}

function filterMinorNonClickMoves(candidates: Candidate[]): Candidate[] {
	const accepted: Candidate[] = [];
	for (const candidate of candidates) {
		const previous = accepted[accepted.length - 1];
		if (
			candidate.kind === "dwell" &&
			previous &&
			distance(candidate, previous) < SEMANTIC_NON_CLICK_DISPLACEMENT
		) {
			continue;
		}
		accepted.push(candidate);
	}
	return accepted;
}

function detectRunAnchors(samples: NormalizedSample[], runIndex: number): SemanticCursorAnchor[] {
	const events = interactionCandidates(samples);
	const candidates = filterMinorNonClickMoves(
		mergeNearbyCandidates([...events, ...dwellCandidates(samples, events)]),
	);
	return candidates.map((candidate, index) => ({
		...candidate,
		id: `cursor-anchor-${runIndex}-${index}`,
		runIndex,
	}));
}

function lowerBound(samples: NormalizedSample[], timeMs: number) {
	let low = 0;
	let high = samples.length;
	while (low < high) {
		const mid = low + ((high - low) >> 1);
		if (samples[mid].timeMs < timeMs) low = mid + 1;
		else high = mid;
	}
	return low;
}

function upperBound(samples: NormalizedSample[], timeMs: number) {
	let low = 0;
	let high = samples.length;
	while (low < high) {
		const mid = low + ((high - low) >> 1);
		if (samples[mid].timeMs <= timeMs) low = mid + 1;
		else high = mid;
	}
	return low;
}

function findDepartureAndArrival(
	samples: NormalizedSample[],
	from: ControlPoint,
	to: ControlPoint,
): { departureTimeMs: number; arrivalTimeMs: number } {
	const firstIndex = lowerBound(samples, from.timeMs);
	const afterLastIndex = upperBound(samples, to.timeMs);
	let departureTimeMs = from.timeMs;
	for (let index = firstIndex; index < afterLastIndex; index += 1) {
		if (distance(samples[index], from) > SEMANTIC_DWELL_RADIUS) {
			departureTimeMs = samples[index].timeMs;
			break;
		}
	}

	let arrivalTimeMs = to.timeMs;
	let foundArrivalSample = false;
	for (let index = afterLastIndex - 1; index >= firstIndex; index -= 1) {
		if (distance(samples[index], to) <= SEMANTIC_DWELL_RADIUS) {
			arrivalTimeMs = samples[index].timeMs;
			foundArrivalSample = true;
		} else if (foundArrivalSample) {
			break;
		}
	}

	if (arrivalTimeMs < departureTimeMs) arrivalTimeMs = departureTimeMs;
	return { departureTimeMs, arrivalTimeMs };
}

function addControlPoint(points: ControlPoint[], point: ControlPoint) {
	const previous = points[points.length - 1];
	if (previous && previous.timeMs === point.timeMs && distance(previous, point) === 0) {
		// Prefer the semantic anchor over an identical boundary control point.
		if (point.anchorId) points[points.length - 1] = point;
		return;
	}
	points.push(point);
}

function buildRunTransitions(
	samples: NormalizedSample[],
	anchors: SemanticCursorAnchor[],
	runIndex: number,
): {
	initial: SmoothedCursorPosition;
	transitions: SemanticCursorTransition[];
	samples: NormalizedSample[] | null;
} {
	const controls: ControlPoint[] = [];
	const first = samples[0];
	const last = samples[samples.length - 1];
	addControlPoint(controls, {
		timeMs: first.timeMs,
		cx: first.cx,
		cy: first.cy,
		anchorId: null,
		anchorKind: null,
	});
	for (const anchor of anchors) {
		addControlPoint(controls, {
			timeMs: anchor.timeMs,
			cx: anchor.cx,
			cy: anchor.cy,
			anchorId: anchor.id,
			anchorKind: anchor.kind,
		});
	}
	addControlPoint(controls, {
		timeMs: last.timeMs,
		cx: last.cx,
		cy: last.cy,
		anchorId: null,
		anchorKind: null,
	});

	const transitions: SemanticCursorTransition[] = [];
	let hasFollowTransition = false;
	let previousEffectiveEnd = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < controls.length - 1; index += 1) {
		const from = controls[index];
		const to = controls[index + 1];
		if (distance(from, to) <= Number.EPSILON) continue;
		const { departureTimeMs, arrivalTimeMs } = findDepartureAndArrival(samples, from, to);
		// During a drag the recorded content moves with the real pointer, so a synthesized
		// straight line visibly diverges from it — replay the recorded path instead.
		const isFollow =
			from.anchorKind === "click" &&
			to.anchorKind === "mouseup" &&
			distance(from, to) > SEMANTIC_DWELL_RADIUS;
		let startTimeMs: number;
		let endTimeMs: number;
		if (isFollow) {
			startTimeMs = Math.max(previousEffectiveEnd, from.timeMs);
			endTimeMs = Math.max(to.timeMs, startTimeMs);
			hasFollowTransition = true;
		} else {
			// Leaving A early is invisible in the content; arriving at B after the recorded
			// interaction is not. Extend the window backwards to fit the desired duration and
			// pin the arrival, so the cursor sits on B no later than the content reacts to it.
			const desiredMs =
				SEMANTIC_MIN_TRANSITION_MS + SEMANTIC_TRANSITION_MS_PER_UNIT * distance(from, to);
			startTimeMs = Math.max(
				previousEffectiveEnd,
				from.timeMs,
				Math.min(departureTimeMs, arrivalTimeMs - desiredMs),
			);
			endTimeMs = Math.max(arrivalTimeMs, startTimeMs);
		}
		transitions.push({
			runIndex,
			fromAnchorId: from.anchorId,
			toAnchorId: to.anchorId,
			from: { cx: from.cx, cy: from.cy },
			to: { cx: to.cx, cy: to.cy },
			departureTimeMs,
			arrivalTimeMs,
			startTimeMs,
			endTimeMs,
			kind: isFollow ? "follow" : "synthetic",
		});
		previousEffectiveEnd = endTimeMs;
	}

	return {
		initial: { cx: controls[0].cx, cy: controls[0].cy },
		transitions,
		samples: hasFollowTransition ? samples : null,
	};
}

function findRuntimeRun(runs: RuntimeRun[], timeMs: number): RuntimeRun | null {
	let low = 0;
	let high = runs.length - 1;
	let candidate = -1;
	while (low <= high) {
		const mid = low + ((high - low) >> 1);
		if (runs[mid].descriptor.startTimeMs <= timeMs) {
			candidate = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	if (candidate < 0 || timeMs > runs[candidate].descriptor.endTimeMs) return null;
	return runs[candidate];
}

function findTransitionAtOrBefore(
	transitions: SemanticCursorTransition[],
	timeMs: number,
): SemanticCursorTransition | null {
	let low = 0;
	let high = transitions.length - 1;
	let candidate = -1;
	while (low <= high) {
		const mid = low + ((high - low) >> 1);
		if (transitions[mid].startTimeMs <= timeMs) {
			candidate = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return candidate < 0 ? null : transitions[candidate];
}

function findTransitionAtTime(
	transitions: SemanticCursorTransition[],
	timeMs: number,
): SemanticCursorTransition | null {
	const transition = findTransitionAtOrBefore(transitions, timeMs);
	return transition && timeMs <= transition.endTimeMs ? transition : null;
}

/** Linear interpolation over the recorded samples of a run at an exact timestamp. */
function interpolateRunSample(samples: NormalizedSample[], timeMs: number): SmoothedCursorPosition {
	const index = lowerBound(samples, timeMs);
	const after = samples[Math.min(index, samples.length - 1)];
	const before = samples[Math.max(0, index - 1)];
	if (after.timeMs <= before.timeMs) return { cx: after.cx, cy: after.cy };
	const t = clamp01((timeMs - before.timeMs) / (after.timeMs - before.timeMs));
	return {
		cx: before.cx + (after.cx - before.cx) * t,
		cy: before.cy + (after.cy - before.cy) * t,
	};
}

function sampleSemanticRun(run: RuntimeRun, timeMs: number): SmoothedCursorPosition | null {
	if (!run.initial) return null;
	const previousTransition = findTransitionAtOrBefore(run.transitions, timeMs);
	if (previousTransition && timeMs <= previousTransition.endTimeMs) {
		if (previousTransition.kind === "follow" && run.samples) {
			return interpolateRunSample(run.samples, timeMs);
		}
		const linear =
			(timeMs - previousTransition.startTimeMs) /
			Math.max(1, previousTransition.endTimeMs - previousTransition.startTimeMs);
		// Quintic smootherstep: zero velocity AND acceleration at both endpoints keeps
		// hold↔move boundaries C2-continuous instead of snapping.
		const eased = linear * linear * linear * (linear * (linear * 6 - 15) + 10);
		return {
			cx:
				previousTransition.from.cx +
				(previousTransition.to.cx - previousTransition.from.cx) * eased,
			cy:
				previousTransition.from.cy +
				(previousTransition.to.cy - previousTransition.from.cy) * eased,
		};
	}
	return previousTransition ? { ...previousTransition.to } : { ...run.initial };
}

function collectFallbackSamples(
	sampleRuns: NormalizedSample[][],
	runtimeRuns: RuntimeRun[],
): CursorRecordingSample[] {
	const fallbackSamples: CursorRecordingSample[] = [];
	for (const run of runtimeRuns) {
		if (run.descriptor.mode !== "fallback") continue;
		const samples = sampleRuns[run.descriptor.index];
		if (fallbackSamples.length > 0) {
			const first = samples[0];
			fallbackSamples.push({ timeMs: first.timeMs, cx: first.cx, cy: first.cy, visible: false });
		}
		for (const sample of samples) fallbackSamples.push(sample);
	}
	return fallbackSamples;
}

const semanticPreparationCache = new WeakMap<CursorRecordingData, PreparedSemanticCursorPath>();

/**
 * Analyze anchors and transitions without building the duration-proportional 240 Hz fallback.
 * Preview uses this result to decide whether it needs the smoothing worker at all.
 */
export function prepareSemanticCursorPath(
	recordingData: CursorRecordingData,
): PreparedSemanticCursorPath {
	const cached = semanticPreparationCache.get(recordingData);
	if (cached) return cached;

	const samples = normalizeSamples(recordingData.samples);
	const sampleRuns = splitVisibleRuns(samples);
	const anchors: SemanticCursorAnchor[] = [];
	const transitions: SemanticCursorTransition[] = [];
	const runtimeRuns: RuntimeRun[] = [];

	for (let runIndex = 0; runIndex < sampleRuns.length; runIndex += 1) {
		const runSamples = sampleRuns[runIndex];
		const runAnchors = detectRunAnchors(runSamples, runIndex);
		for (const anchor of runAnchors) anchors.push(anchor);
		const usesSemanticPath = runAnchors.length >= 2;
		const descriptor: SemanticCursorVisibleRun = {
			index: runIndex,
			startTimeMs: runSamples[0].timeMs,
			endTimeMs: runSamples[runSamples.length - 1].timeMs,
			mode: usesSemanticPath ? "semantic" : "fallback",
			anchorIds: runAnchors.map((anchor) => anchor.id),
		};
		if (usesSemanticPath) {
			const built = buildRunTransitions(runSamples, runAnchors, runIndex);
			for (const transition of built.transitions) transitions.push(transition);
			runtimeRuns.push({ descriptor, ...built });
		} else {
			runtimeRuns.push({ descriptor, initial: null, transitions: [], samples: null });
		}
	}

	const mode = runtimeRuns.some((run) => run.descriptor.mode === "semantic")
		? "semantic"
		: "fallback";
	const metadata: SemanticCursorPathMetadata = {
		mode,
		anchors,
		transitions,
		visibleRuns: runtimeRuns.map((run) => run.descriptor),
	};
	const fallbackSamples = collectFallbackSamples(sampleRuns, runtimeRuns);
	const requiresFallbackPath = fallbackSamples.length > 0;
	const prepared: PreparedSemanticCursorPath = {
		metadata,
		requiresFallbackPath,
		fallbackSamples,
		createPath(fallbackPath = null) {
			if (requiresFallbackPath && !fallbackPath) {
				throw new Error("A precomputed fallback cursor path is required");
			}
			const sampleAt = (timeMs: number): SmoothedCursorPosition | null => {
				if (!Number.isFinite(timeMs)) return null;
				const run = findRuntimeRun(runtimeRuns, timeMs);
				if (!run) return null;
				return run.descriptor.mode === "semantic"
					? sampleSemanticRun(run, timeMs)
					: (fallbackPath?.sampleAt(timeMs) ?? null);
			};
			return {
				...metadata,
				sampleAt,
				cameraSampleAt(timeMs, lagMs = 150) {
					if (!Number.isFinite(timeMs)) return null;
					const run = findRuntimeRun(runtimeRuns, timeMs);
					if (!run) return null;
					const transition = findTransitionAtTime(run.transitions, timeMs);
					if (!transition || run.descriptor.mode !== "semantic") return sampleAt(timeMs);
					const durationMs = Math.max(1, transition.endTimeMs - transition.startTimeMs);
					const progress = clamp01((timeMs - transition.startTimeMs) / durationMs);
					const requestedLagMs = Number.isFinite(lagMs) ? Math.max(0, lagMs) : 0;
					const boundedLagMs = Math.min(requestedLagMs, durationMs * 0.2);
					const offsetMs = boundedLagMs * Math.sin(Math.PI * progress);
					return sampleAt(timeMs - offsetMs);
				},
			};
		},
	};
	semanticPreparationCache.set(recordingData, prepared);
	return prepared;
}

/** Returns semantic metadata without constructing a fallback spring path. */
export function getSemanticCursorPathMetadata(
	recordingData: CursorRecordingData | null | undefined,
): SemanticCursorPathMetadata | null {
	if (!recordingData || recordingData.samples.length === 0) return null;
	return prepareSemanticCursorPath(recordingData).metadata;
}

/**
 * Build a deterministic semantic camera path. Supplying a fallback created by the smoothing
 * worker keeps preview construction off the main thread. Without one, export precomputes it here
 * so the first render sample can never trigger duration-proportional work.
 */
export function buildSemanticCursorPath(
	recordingData: CursorRecordingData,
	fallbackSmoothing01 = 0.67,
	precomputedFallbackPath?: SmoothedCursorPath,
): SemanticCursorPath {
	const prepared = prepareSemanticCursorPath(recordingData);
	let fallbackPath = precomputedFallbackPath;
	if (prepared.requiresFallbackPath && !fallbackPath) {
		const smoothing = Number.isFinite(fallbackSmoothing01) ? clamp01(fallbackSmoothing01) : 0;
		fallbackPath = createSmoothedCursorPath(
			buildSerializedSmoothedCursorPath({ samples: prepared.fallbackSamples }, smoothing),
		);
	}
	return prepared.createPath(fallbackPath);
}

const semanticPathCache = new WeakMap<CursorRecordingData, Map<string, SemanticCursorPath>>();
const MAX_CACHED_FALLBACK_STRENGTHS = 4;

/** Memoized entry point intended to be shared by preview and export. */
export function getSemanticCursorPath(
	recordingData: CursorRecordingData | null | undefined,
	fallbackSmoothing01 = 0.67,
	precomputedFallbackPath?: SmoothedCursorPath,
): SemanticCursorPath | null {
	if (!recordingData || recordingData.samples.length === 0) return null;
	const smoothing = Number.isFinite(fallbackSmoothing01) ? clamp01(fallbackSmoothing01) : 0;
	// Smoothing only shapes anchor-poor fallback runs. Without any, every strength yields the
	// same path — a stable key keeps the object identity stable across slider changes.
	const key = prepareSemanticCursorPath(recordingData).requiresFallbackPath
		? smoothing.toFixed(2)
		: "semantic-only";
	let byStrength = semanticPathCache.get(recordingData);
	if (!byStrength) {
		byStrength = new Map();
		semanticPathCache.set(recordingData, byStrength);
	}
	let path = byStrength.get(key);
	if (path) {
		byStrength.delete(key);
		byStrength.set(key, path);
		return path;
	}

	path = buildSemanticCursorPath(
		recordingData,
		Number.parseFloat(smoothing.toFixed(2)),
		precomputedFallbackPath,
	);
	byStrength.set(key, path);
	while (byStrength.size > MAX_CACHED_FALLBACK_STRENGTHS) {
		const oldestKey = byStrength.keys().next().value;
		if (oldestKey === undefined) break;
		byStrength.delete(oldestKey);
	}
	return path;
}
