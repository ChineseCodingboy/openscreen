import { describe, expect, it } from "vitest";
import {
	createPreviewResolutionControllerState,
	getPreviewResolutionCandidates,
	type PreviewResolutionControllerState,
	samplePreviewResolutionPerformance,
	setPreviewResolutionPlaybackActive,
} from "./previewResolution";

function sampleWindow(
	state: PreviewResolutionControllerState,
	{
		endMs,
		frameTimeMs,
		droppedVideoFrames,
		totalVideoFrames,
	}: {
		endMs: number;
		frameTimeMs: number;
		droppedVideoFrames?: number;
		totalVideoFrames?: number;
	},
): PreviewResolutionControllerState {
	const startMs = state.windowStartedAtMs;
	const hasPlaybackQuality = droppedVideoFrames !== undefined && totalVideoFrames !== undefined;
	state = samplePreviewResolutionPerformance(state, {
		nowMs: startMs + 1,
		frameTimeMs,
		playbackQuality: hasPlaybackQuality
			? {
					droppedVideoFrames: Math.max(0, droppedVideoFrames - 3),
					totalVideoFrames: Math.max(0, totalVideoFrames - 100),
				}
			: undefined,
	});
	return samplePreviewResolutionPerformance(state, {
		nowMs: endMs,
		frameTimeMs,
		playbackQuality: hasPlaybackQuality ? { droppedVideoFrames, totalVideoFrames } : undefined,
	});
}

describe("adaptive preview resolution", () => {
	it("uses 1.5x by default while active and full DPR while paused", () => {
		let state = createPreviewResolutionControllerState({ devicePixelRatio: 2, nowMs: 0 });
		expect(getPreviewResolutionCandidates(2)).toEqual([1, 1.25, 1.5, 2]);
		expect(state.resolution).toBe(2);

		state = setPreviewResolutionPlaybackActive(state, {
			active: true,
			devicePixelRatio: 2,
			nowMs: 10,
		});
		expect(state.resolution).toBe(1.5);

		state = setPreviewResolutionPlaybackActive(state, {
			active: false,
			devicePixelRatio: 2,
			nowMs: 20,
		});
		expect(state.resolution).toBe(2);
	});

	it("does not create tiers above the device DPR", () => {
		expect(getPreviewResolutionCandidates(1)).toEqual([1]);
		expect(getPreviewResolutionCandidates(1.25)).toEqual([1, 1.25]);
		expect(getPreviewResolutionCandidates(1.3)).toEqual([1, 1.25, 1.3]);
	});

	it("demotes one tier after two consecutive slow one-second windows", () => {
		let state = createPreviewResolutionControllerState({
			devicePixelRatio: 2,
			active: true,
			nowMs: 0,
		});
		state = sampleWindow(state, { endMs: 1_000, frameTimeMs: 23 });
		expect(state.resolution).toBe(1.5);
		state = sampleWindow(state, { endMs: 2_000, frameTimeMs: 23 });
		expect(state.resolution).toBe(1.25);
	});

	it("uses dropped-frame rate when playback quality is available", () => {
		let state = createPreviewResolutionControllerState({
			devicePixelRatio: 2,
			active: true,
			nowMs: 0,
		});
		state = sampleWindow(state, {
			endMs: 1_000,
			frameTimeMs: 10,
			droppedVideoFrames: 3,
			totalVideoFrames: 100,
		});
		state = sampleWindow(state, {
			endMs: 2_000,
			frameTimeMs: 10,
			droppedVideoFrames: 6,
			totalVideoFrames: 200,
		});
		expect(state.resolution).toBe(1.25);
		expect(state.lastWindow?.droppedRate).toBeCloseTo(0.03);
	});

	it("requires degraded windows to be consecutive", () => {
		let state = createPreviewResolutionControllerState({
			devicePixelRatio: 2,
			active: true,
			nowMs: 0,
		});
		state = sampleWindow(state, { endMs: 1_000, frameTimeMs: 23 });
		state = sampleWindow(state, { endMs: 2_000, frameTimeMs: 18 });
		state = sampleWindow(state, { endMs: 3_000, frameTimeMs: 23 });
		expect(state.resolution).toBe(1.5);
	});

	it("promotes one tier after five stable one-second windows", () => {
		let state = createPreviewResolutionControllerState({
			devicePixelRatio: 2,
			active: true,
			nowMs: 0,
		});
		for (let second = 1; second <= 4; second++) {
			state = sampleWindow(state, { endMs: second * 1_000, frameTimeMs: 10 });
		}
		expect(state.resolution).toBe(1.5);
		state = sampleWindow(state, { endMs: 5_000, frameTimeMs: 10 });
		expect(state.resolution).toBe(2);
	});

	it("enforces three seconds of cooldown between adaptive switches", () => {
		let state = createPreviewResolutionControllerState({
			devicePixelRatio: 2,
			active: true,
			nowMs: 0,
		});
		state = sampleWindow(state, { endMs: 1_000, frameTimeMs: 23 });
		state = sampleWindow(state, { endMs: 2_000, frameTimeMs: 23 });
		expect(state.resolution).toBe(1.25);

		state = sampleWindow(state, { endMs: 3_000, frameTimeMs: 23 });
		state = sampleWindow(state, { endMs: 4_000, frameTimeMs: 23 });
		expect(state.resolution).toBe(1.25);

		state = sampleWindow(state, { endMs: 5_000, frameTimeMs: 23 });
		expect(state.resolution).toBe(1);
	});

	it("falls back to frame timing when playback quality is unavailable", () => {
		let state = createPreviewResolutionControllerState({
			devicePixelRatio: 2,
			active: true,
			nowMs: 0,
		});
		state = sampleWindow(state, { endMs: 1_000, frameTimeMs: 24 });
		state = sampleWindow(state, { endMs: 2_000, frameTimeMs: 24 });
		expect(state.resolution).toBe(1.25);
		expect(state.lastWindow?.droppedRate).toBeNull();
	});
});
