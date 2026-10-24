export interface CutGuideState {
	targetId: string | null;
	rawTimeMs: number;
	snappedTimeMs: number;
	offsetPx: number;
	valid: boolean;
}

export function snapCutTime({
	rawTimeMs,
	durationMs,
	frameRate,
	magneticTargets,
	magneticThresholdMs,
	disableMagnet = false,
}: {
	rawTimeMs: number;
	durationMs: number;
	frameRate: number;
	magneticTargets: number[];
	magneticThresholdMs: number;
	disableMagnet?: boolean;
}): number {
	const safeFrameRate = Math.max(1, Math.min(240, frameRate));
	const frameDurationMs = 1000 / safeFrameRate;
	let snappedTimeMs = Math.round(rawTimeMs / frameDurationMs) * frameDurationMs;
	if (!disableMagnet) {
		const nearest = magneticTargets.reduce<number | null>((best, candidate) => {
			if (Math.abs(candidate - rawTimeMs) > magneticThresholdMs) return best;
			if (best === null || Math.abs(candidate - rawTimeMs) < Math.abs(best - rawTimeMs)) {
				return candidate;
			}
			return best;
		}, null);
		if (nearest !== null) snappedTimeMs = nearest;
	}
	return Math.max(0, Math.min(durationMs, snappedTimeMs));
}
