const WINDOW_DURATION_MS = 1_000;
const SWITCH_COOLDOWN_MS = 3_000;
const STABLE_DURATION_TO_PROMOTE_MS = 5_000;
const DEGRADED_WINDOWS_TO_DEMOTE = 2;
const DEGRADED_DROPPED_RATE = 0.02;
const STABLE_DROPPED_RATE = 0.005;
const DEGRADED_P95_FRAME_TIME_MS = 22;
const STABLE_P95_FRAME_TIME_MS = 16;
const DEFAULT_PLAYBACK_RESOLUTION = 1.5;

export interface PreviewPlaybackQualitySample {
	droppedVideoFrames: number;
	totalVideoFrames: number;
}

export interface PreviewResolutionSample {
	nowMs: number;
	frameTimeMs: number;
	playbackQuality?: PreviewPlaybackQualitySample;
}

export interface PreviewResolutionWindowResult {
	p95FrameTimeMs: number | null;
	droppedRate: number | null;
	classification: "degraded" | "stable" | "neutral";
}

interface PlaybackQualityBaseline {
	droppedVideoFrames: number;
	totalVideoFrames: number;
}

export interface PreviewResolutionControllerState {
	active: boolean;
	devicePixelRatio: number;
	candidates: number[];
	levelIndex: number;
	resolution: number;
	windowStartedAtMs: number;
	frameTimesMs: number[];
	qualityBaseline: PlaybackQualityBaseline | null;
	consecutiveDegradedWindows: number;
	stableDurationMs: number;
	lastAdaptiveChangeAtMs: number;
	lastWindow: PreviewResolutionWindowResult | null;
}

function normalizeDevicePixelRatio(devicePixelRatio: number): number {
	return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

export function getPreviewResolutionCandidates(devicePixelRatio: number): number[] {
	const normalizedDpr = normalizeDevicePixelRatio(devicePixelRatio);
	return [...new Set([1, 1.25, DEFAULT_PLAYBACK_RESOLUTION, normalizedDpr])]
		.filter((resolution) => resolution <= normalizedDpr)
		.sort((left, right) => left - right);
}

function getDefaultLevelIndex(candidates: readonly number[]): number {
	for (let index = candidates.length - 1; index >= 0; index--) {
		if (candidates[index] <= DEFAULT_PLAYBACK_RESOLUTION) return index;
	}
	return 0;
}

function resetWindow(
	state: PreviewResolutionControllerState,
	nowMs: number,
): PreviewResolutionControllerState {
	return {
		...state,
		windowStartedAtMs: nowMs,
		frameTimesMs: [],
		qualityBaseline: null,
	};
}

export function createPreviewResolutionControllerState({
	devicePixelRatio,
	active = false,
	nowMs = 0,
}: {
	devicePixelRatio: number;
	active?: boolean;
	nowMs?: number;
}): PreviewResolutionControllerState {
	const normalizedDpr = normalizeDevicePixelRatio(devicePixelRatio);
	const candidates = getPreviewResolutionCandidates(normalizedDpr);
	const levelIndex = getDefaultLevelIndex(candidates);

	return {
		active,
		devicePixelRatio: normalizedDpr,
		candidates,
		levelIndex,
		resolution: active ? candidates[levelIndex] : normalizedDpr,
		windowStartedAtMs: nowMs,
		frameTimesMs: [],
		qualityBaseline: null,
		consecutiveDegradedWindows: 0,
		stableDurationMs: 0,
		lastAdaptiveChangeAtMs: Number.NEGATIVE_INFINITY,
		lastWindow: null,
	};
}

export function setPreviewResolutionPlaybackActive(
	state: PreviewResolutionControllerState,
	{ active, devicePixelRatio, nowMs }: { active: boolean; devicePixelRatio: number; nowMs: number },
): PreviewResolutionControllerState {
	const normalizedDpr = normalizeDevicePixelRatio(devicePixelRatio);
	if (state.active === active && state.devicePixelRatio === normalizedDpr) return state;

	const candidates = getPreviewResolutionCandidates(normalizedDpr);
	const levelIndex = getDefaultLevelIndex(candidates);
	return {
		...state,
		active,
		devicePixelRatio: normalizedDpr,
		candidates,
		levelIndex,
		resolution: active ? candidates[levelIndex] : normalizedDpr,
		windowStartedAtMs: nowMs,
		frameTimesMs: [],
		qualityBaseline: null,
		consecutiveDegradedWindows: 0,
		stableDurationMs: 0,
		lastAdaptiveChangeAtMs: Number.NEGATIVE_INFINITY,
		lastWindow: null,
	};
}

function percentile95(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function resolveDroppedRate(
	baseline: PlaybackQualityBaseline | null,
	current: PreviewPlaybackQualitySample | undefined,
): number | null {
	if (!baseline || !current) return null;
	const totalDelta = current.totalVideoFrames - baseline.totalVideoFrames;
	const droppedDelta = current.droppedVideoFrames - baseline.droppedVideoFrames;
	if (totalDelta <= 0 || droppedDelta < 0) return null;
	return droppedDelta / totalDelta;
}

function classifyWindow(
	p95FrameTimeMs: number | null,
	droppedRate: number | null,
): PreviewResolutionWindowResult["classification"] {
	if (
		(p95FrameTimeMs !== null && p95FrameTimeMs > DEGRADED_P95_FRAME_TIME_MS) ||
		(droppedRate !== null && droppedRate > DEGRADED_DROPPED_RATE)
	) {
		return "degraded";
	}

	if (
		p95FrameTimeMs !== null &&
		p95FrameTimeMs < STABLE_P95_FRAME_TIME_MS &&
		(droppedRate === null || droppedRate < STABLE_DROPPED_RATE)
	) {
		return "stable";
	}

	return "neutral";
}

export function samplePreviewResolutionPerformance(
	state: PreviewResolutionControllerState,
	sample: PreviewResolutionSample,
): PreviewResolutionControllerState {
	if (!state.active) return state;

	const frameTimesMs =
		Number.isFinite(sample.frameTimeMs) && sample.frameTimeMs >= 0
			? [...state.frameTimesMs, sample.frameTimeMs]
			: state.frameTimesMs;
	const qualityBaseline =
		state.qualityBaseline ??
		(sample.playbackQuality
			? {
					droppedVideoFrames: sample.playbackQuality.droppedVideoFrames,
					totalVideoFrames: sample.playbackQuality.totalVideoFrames,
				}
			: null);
	const sampledState = { ...state, frameTimesMs, qualityBaseline };
	if (sample.nowMs - state.windowStartedAtMs < WINDOW_DURATION_MS) return sampledState;

	const p95FrameTimeMs = percentile95(frameTimesMs);
	const droppedRate = resolveDroppedRate(qualityBaseline, sample.playbackQuality);
	const classification = classifyWindow(p95FrameTimeMs, droppedRate);
	let consecutiveDegradedWindows =
		classification === "degraded" ? state.consecutiveDegradedWindows + 1 : 0;
	let stableDurationMs =
		classification === "stable" ? state.stableDurationMs + WINDOW_DURATION_MS : 0;
	let levelIndex = state.levelIndex;
	let lastAdaptiveChangeAtMs = state.lastAdaptiveChangeAtMs;
	const cooldownElapsed = sample.nowMs - lastAdaptiveChangeAtMs >= SWITCH_COOLDOWN_MS;

	if (
		consecutiveDegradedWindows >= DEGRADED_WINDOWS_TO_DEMOTE &&
		levelIndex > 0 &&
		cooldownElapsed
	) {
		levelIndex--;
		lastAdaptiveChangeAtMs = sample.nowMs;
		consecutiveDegradedWindows = 0;
		stableDurationMs = 0;
	} else if (
		stableDurationMs >= STABLE_DURATION_TO_PROMOTE_MS &&
		levelIndex < state.candidates.length - 1 &&
		cooldownElapsed
	) {
		levelIndex++;
		lastAdaptiveChangeAtMs = sample.nowMs;
		consecutiveDegradedWindows = 0;
		stableDurationMs = 0;
	}

	return resetWindow(
		{
			...sampledState,
			levelIndex,
			resolution: state.candidates[levelIndex],
			consecutiveDegradedWindows,
			stableDurationMs,
			lastAdaptiveChangeAtMs,
			lastWindow: { p95FrameTimeMs, droppedRate, classification },
		},
		sample.nowMs,
	);
}
