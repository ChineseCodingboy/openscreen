import type { CursorTelemetryPoint, Rotation3D, ZoomFocus, ZoomRegion } from "../types";
import { DEFAULT_ROTATION_3D, getRotation3D, getZoomScale, lerpRotation3D } from "../types";
import { TRANSITION_WINDOW_MS, ZOOM_IN_TRANSITION_WINDOW_MS } from "./constants";
import { interpolateCursorAt } from "./cursorFollowUtils";
import { clampFocusToScale } from "./focusUtils";
import { clamp01, cubicBezier, easeOutScreenStudio } from "./mathUtils";

const CHAINED_ZOOM_PAN_GAP_MS = 1500;
const CONNECTED_ZOOM_PAN_DURATION_MS = 1000;
const ZOOM_IN_OVERLAP_MS = 500;

type DominantRegionOptions = {
	connectZooms?: boolean;
	cursorTelemetry?: CursorTelemetryPoint[];
	/** Optional processed cursor path shared with the visible cursor renderer. */
	cursorFocusSampler?: (timeMs: number) => ZoomFocus | null;
	/** Stable identity of the sampler's underlying path, used to invalidate paused-frame caches. */
	cursorFocusSamplerKey?: unknown;
	/** Source-media time used to sample cursor-driven focus; defaults to timeline `timeMs`. */
	cursorTimeMs?: number;
	viewportRatio?: ViewportRatio;
};

type ConnectedRegionPair = {
	currentRegion: ZoomRegion;
	nextRegion: ZoomRegion;
	transitionStart: number;
	transitionEnd: number;
};

type ConnectedRegionIndex = {
	pairs: ConnectedRegionPair[];
	outgoingByRegion: WeakMap<ZoomRegion, ConnectedRegionPair>;
	incomingByRegion: WeakMap<ZoomRegion, ConnectedRegionPair>;
};

type ConnectedPanTransition = {
	progress: number;
	startFocus: ZoomFocus;
	endFocus: ZoomFocus;
	startScale: number;
	endScale: number;
};

function lerp(start: number, end: number, amount: number) {
	return start + (end - start) * amount;
}

function easeConnectedPan(value: number) {
	return cubicBezier(0.1, 0.0, 0.2, 1.0, value);
}

/** Quintic smoothstep has zero velocity and acceleration at both ends. */
export function professionalSmoothstep(value: number) {
	const t = clamp01(value);
	return t * t * t * (t * (t * 6 - 15) + 10);
}

export function computeRegionStrength(region: ZoomRegion, timeMs: number) {
	if (region.motionProfile === "professional-v2") {
		const zoomInDurationMs = Math.max(1, region.zoomInDurationMs ?? 500);
		const zoomOutDurationMs = Math.max(1, region.zoomOutDurationMs ?? 620);
		const zoomInEnd = region.startMs + zoomInDurationMs;
		const zoomOutEnd = region.endMs + zoomOutDurationMs;
		if (timeMs < region.startMs || timeMs > zoomOutEnd) return 0;
		if (timeMs < zoomInEnd) {
			return professionalSmoothstep((timeMs - region.startMs) / zoomInDurationMs);
		}
		if (timeMs <= region.endMs) return 1;
		return 1 - professionalSmoothstep((timeMs - region.endMs) / zoomOutDurationMs);
	}
	if (Number.isFinite(region.zoomInDurationMs) && (region.zoomInDurationMs ?? 0) > 0) {
		const zoomInDurationMs = Math.min(
			Math.max(1, region.zoomInDurationMs ?? 1),
			Math.max(1, region.endMs - region.startMs),
		);
		const zoomInEnd = region.startMs + zoomInDurationMs;
		const leadOutEnd = region.endMs + TRANSITION_WINDOW_MS;

		if (timeMs < region.startMs || timeMs > leadOutEnd) {
			return 0;
		}

		if (timeMs < zoomInEnd) {
			return easeOutScreenStudio((timeMs - region.startMs) / zoomInDurationMs);
		}

		if (timeMs <= region.endMs) {
			return 1;
		}

		const progress = clamp01((timeMs - region.endMs) / TRANSITION_WINDOW_MS);
		return 1 - easeOutScreenStudio(progress);
	}

	const zoomInEnd = region.startMs + ZOOM_IN_OVERLAP_MS;
	const leadInStart = zoomInEnd - ZOOM_IN_TRANSITION_WINDOW_MS;
	const leadOutEnd = region.endMs + TRANSITION_WINDOW_MS;

	if (timeMs < leadInStart || timeMs > leadOutEnd) {
		return 0;
	}

	if (timeMs < zoomInEnd) {
		const progress = (timeMs - leadInStart) / ZOOM_IN_TRANSITION_WINDOW_MS;
		return easeOutScreenStudio(progress);
	}

	if (timeMs <= region.endMs) {
		return 1;
	}

	const progress = clamp01((timeMs - region.endMs) / TRANSITION_WINDOW_MS);
	return 1 - easeOutScreenStudio(progress);
}

function getLinearFocus(start: ZoomFocus, end: ZoomFocus, amount: number): ZoomFocus {
	return {
		cx: lerp(start.cx, end.cx, amount),
		cy: lerp(start.cy, end.cy, amount),
	};
}

interface ViewportRatio {
	widthRatio: number;
	heightRatio: number;
}

function getResolvedFocus(
	region: ZoomRegion,
	zoomScale: number,
	timeMs?: number,
	cursorTelemetry?: CursorTelemetryPoint[],
	cursorFocusSampler?: (timeMs: number) => ZoomFocus | null,
	viewportRatio?: ViewportRatio,
): ZoomFocus {
	let focus = region.focus;
	if (
		region.motionProfile === "professional-v2" &&
		region.focusEnd &&
		region.triggerTimeMs !== undefined &&
		timeMs !== undefined
	) {
		const panStart = region.triggerTimeMs + 80;
		const panProgress = professionalSmoothstep(
			(timeMs - panStart) / Math.max(1, region.endMs - panStart),
		);
		focus = getLinearFocus(region.focus, region.focusEnd, panProgress);
	}

	if (region.focusMode === "auto" && timeMs !== undefined) {
		const cursorFocus = cursorFocusSampler
			? cursorFocusSampler(timeMs)
			: cursorTelemetry && cursorTelemetry.length > 0
				? interpolateCursorAt(cursorTelemetry, timeMs)
				: null;
		if (cursorFocus) {
			focus = cursorFocus;
		}
	}

	return region.focusSpace === "source"
		? focus
		: clampFocusToScale(focus, zoomScale, viewportRatio);
}

// Zoom edits replace the regions array and region objects instead of mutating them in place. Cache
// the sorted pairs and both lookup directions by that immutable array identity so the 60fps path
// never searches the pair list once per region.
const connectedRegionIndexCache = new WeakMap<ZoomRegion[], ConnectedRegionIndex>();

function getConnectedRegionIndex(regions: ZoomRegion[]) {
	const cached = connectedRegionIndexCache.get(regions);
	if (cached) return cached;
	const sortedRegions = [...regions].sort((a, b) => a.startMs - b.startMs);
	const pairs: ConnectedRegionPair[] = [];
	const outgoingByRegion = new WeakMap<ZoomRegion, ConnectedRegionPair>();
	const incomingByRegion = new WeakMap<ZoomRegion, ConnectedRegionPair>();

	for (let index = 0; index < sortedRegions.length - 1; index += 1) {
		const currentRegion = sortedRegions[index];
		const nextRegion = sortedRegions[index + 1];
		const gapMs = nextRegion.startMs - currentRegion.endMs;

		if (
			currentRegion.motionProfile === "professional-v2" ||
			nextRegion.motionProfile === "professional-v2" ||
			gapMs > CHAINED_ZOOM_PAN_GAP_MS
		) {
			continue;
		}

		const pair = {
			currentRegion,
			nextRegion,
			transitionStart: currentRegion.endMs,
			transitionEnd: currentRegion.endMs + CONNECTED_ZOOM_PAN_DURATION_MS,
		};
		pairs.push(pair);
		outgoingByRegion.set(currentRegion, pair);
		incomingByRegion.set(nextRegion, pair);
	}

	const regionIndex = { pairs, outgoingByRegion, incomingByRegion };
	connectedRegionIndexCache.set(regions, regionIndex);
	return regionIndex;
}

function getActiveRegion(
	regions: ZoomRegion[],
	timeMs: number,
	cursorTimeMs: number,
	connectedIndex: ConnectedRegionIndex | null,
	cursorTelemetry?: CursorTelemetryPoint[],
	cursorFocusSampler?: (timeMs: number) => ZoomFocus | null,
	viewportRatio?: ViewportRatio,
) {
	let activeRegion: ZoomRegion | null = null;
	let activeStrength = 0;

	for (const region of regions) {
		const outgoingPair = connectedIndex?.outgoingByRegion.get(region);
		if (outgoingPair && timeMs > outgoingPair.currentRegion.endMs) continue;

		const incomingPair = connectedIndex?.incomingByRegion.get(region);
		if (incomingPair && timeMs < incomingPair.transitionEnd) continue;

		const strength = computeRegionStrength(region, timeMs);
		if (strength <= 0) continue;

		if (
			!activeRegion ||
			strength > activeStrength ||
			(strength === activeStrength && region.startMs > activeRegion.startMs)
		) {
			activeRegion = region;
			activeStrength = strength;
		}
	}

	if (!activeRegion) return null;

	const activeScale = getZoomScale(activeRegion);

	return {
		region: {
			...activeRegion,
			focus: getResolvedFocus(
				activeRegion,
				activeScale,
				cursorTimeMs,
				cursorTelemetry,
				cursorFocusSampler,
				viewportRatio,
			),
		},
		strength: activeStrength,
		blendedScale: null,
		rotation3D: getRotation3D(activeRegion),
	};
}

function getConnectedRegionHold(
	timeMs: number,
	cursorTimeMs: number,
	connectedPairs: ConnectedRegionPair[],
	cursorTelemetry?: CursorTelemetryPoint[],
	cursorFocusSampler?: (timeMs: number) => ZoomFocus | null,
	viewportRatio?: ViewportRatio,
) {
	for (const pair of connectedPairs) {
		if (timeMs > pair.transitionEnd && timeMs < pair.nextRegion.startMs) {
			const nextScale = getZoomScale(pair.nextRegion);
			return {
				region: {
					...pair.nextRegion,
					focus: getResolvedFocus(
						pair.nextRegion,
						nextScale,
						cursorTimeMs,
						cursorTelemetry,
						cursorFocusSampler,
						viewportRatio,
					),
				},
				strength: 1,
				blendedScale: null,
				rotation3D: getRotation3D(pair.nextRegion),
			};
		}
	}

	return null;
}

function getConnectedRegionTransition(
	connectedPairs: ConnectedRegionPair[],
	timeMs: number,
	cursorTimeMs: number,
	cursorTelemetry?: CursorTelemetryPoint[],
	cursorFocusSampler?: (timeMs: number) => ZoomFocus | null,
	viewportRatio?: ViewportRatio,
) {
	for (const pair of connectedPairs) {
		const { currentRegion, nextRegion, transitionStart, transitionEnd } = pair;

		if (timeMs < transitionStart || timeMs > transitionEnd) {
			continue;
		}

		const transitionProgress = easeConnectedPan(
			clamp01((timeMs - transitionStart) / Math.max(1, transitionEnd - transitionStart)),
		);
		const currentScale = getZoomScale(currentRegion);
		const nextScale = getZoomScale(nextRegion);
		const transitionScale = lerp(currentScale, nextScale, transitionProgress);
		// Both regions share one source cursor time, so interpolate once and reuse while the
		// transition progress itself remains timeline-driven.
		const sharedCursorFocus = cursorFocusSampler
			? cursorFocusSampler(cursorTimeMs)
			: cursorTelemetry && cursorTelemetry.length > 0
				? interpolateCursorAt(cursorTelemetry, cursorTimeMs)
				: null;
		const currentFocus = clampFocusToScale(
			currentRegion.focusMode === "auto" && sharedCursorFocus
				? sharedCursorFocus
				: currentRegion.focus,
			currentScale,
			viewportRatio,
		);
		const nextFocus = clampFocusToScale(
			nextRegion.focusMode === "auto" && sharedCursorFocus ? sharedCursorFocus : nextRegion.focus,
			nextScale,
			viewportRatio,
		);
		const transitionFocus = getLinearFocus(currentFocus, nextFocus, transitionProgress);
		const transitionRotation = lerpRotation3D(
			getRotation3D(currentRegion),
			getRotation3D(nextRegion),
			transitionProgress,
		);

		return {
			region: {
				...nextRegion,
				focus: transitionFocus,
			},
			strength: 1,
			blendedScale: transitionScale,
			rotation3D: transitionRotation,
			transition: {
				progress: transitionProgress,
				startFocus: currentFocus,
				endFocus: nextFocus,
				startScale: currentScale,
				endScale: nextScale,
			},
		};
	}

	return null;
}

type DominantRegionResult = {
	region: ZoomRegion | null;
	strength: number;
	blendedScale: number | null;
	rotation3D: Rotation3D;
	transition: ConnectedPanTransition | null;
};

// Single-slot cache: the ticker calls findDominantRegion at 60fps with mostly
// unchanged inputs (especially while paused), so reusing the last result skips
// the per-frame O(N) scan and allocations.
let dominantRegionCache: {
	regions: ZoomRegion[];
	timeMsKey: number;
	cursorTimeMsKey: number;
	telemetry: CursorTelemetryPoint[] | undefined;
	cursorFocusSampler: DominantRegionOptions["cursorFocusSampler"];
	cursorFocusSamplerKey: unknown;
	connectZooms: boolean;
	viewportRatio: ViewportRatio | undefined;
	result: DominantRegionResult;
} | null = null;

export function findDominantRegion(
	regions: ZoomRegion[],
	timeMs: number,
	options: DominantRegionOptions = {},
): DominantRegionResult {
	const connectZooms = !!options.connectZooms;
	const telemetry = options.cursorTelemetry;
	const cursorFocusSampler = options.cursorFocusSampler;
	const cursorFocusSamplerKey = options.cursorFocusSamplerKey;
	const vr = options.viewportRatio;
	const timeMsKey = Math.round(timeMs);
	const cursorTimeMs = options.cursorTimeMs ?? timeMs;
	const cursorTimeMsKey = Math.round(cursorTimeMs);

	if (
		dominantRegionCache &&
		dominantRegionCache.regions === regions &&
		dominantRegionCache.timeMsKey === timeMsKey &&
		dominantRegionCache.cursorTimeMsKey === cursorTimeMsKey &&
		dominantRegionCache.telemetry === telemetry &&
		dominantRegionCache.cursorFocusSampler === cursorFocusSampler &&
		dominantRegionCache.cursorFocusSamplerKey === cursorFocusSamplerKey &&
		dominantRegionCache.connectZooms === connectZooms &&
		dominantRegionCache.viewportRatio === vr
	) {
		return dominantRegionCache.result;
	}

	const connectedIndex = connectZooms ? getConnectedRegionIndex(regions) : null;

	let result: DominantRegionResult;
	if (connectedIndex) {
		const connectedPairs = connectedIndex.pairs;
		const connectedTransition = getConnectedRegionTransition(
			connectedPairs,
			timeMs,
			cursorTimeMs,
			telemetry,
			cursorFocusSampler,
			vr,
		);
		if (connectedTransition) {
			result = connectedTransition;
		} else {
			const connectedHold = getConnectedRegionHold(
				timeMs,
				cursorTimeMs,
				connectedPairs,
				telemetry,
				cursorFocusSampler,
				vr,
			);
			if (connectedHold) {
				result = { ...connectedHold, transition: null };
			} else {
				const activeRegion = getActiveRegion(
					regions,
					timeMs,
					cursorTimeMs,
					connectedIndex,
					telemetry,
					cursorFocusSampler,
					vr,
				);
				result = activeRegion
					? { ...activeRegion, transition: null }
					: {
							region: null,
							strength: 0,
							blendedScale: null,
							rotation3D: DEFAULT_ROTATION_3D,
							transition: null,
						};
			}
		}
	} else {
		const activeRegion = getActiveRegion(
			regions,
			timeMs,
			cursorTimeMs,
			connectedIndex,
			telemetry,
			cursorFocusSampler,
			vr,
		);
		result = activeRegion
			? { ...activeRegion, transition: null }
			: {
					region: null,
					strength: 0,
					blendedScale: null,
					rotation3D: DEFAULT_ROTATION_3D,
					transition: null,
				};
	}

	dominantRegionCache = {
		regions,
		timeMsKey,
		cursorTimeMsKey,
		telemetry,
		cursorFocusSampler,
		cursorFocusSamplerKey,
		connectZooms,
		viewportRatio: vr,
		result,
	};

	return result;
}
