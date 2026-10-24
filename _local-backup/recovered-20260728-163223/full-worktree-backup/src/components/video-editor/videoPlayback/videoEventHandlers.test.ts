import { describe, expect, it, vi } from "vitest";
import { createVideoEventHandlers } from "./videoEventHandlers";

function createPauseHarness(externalTransportActive: boolean) {
	const isPlayingRef = { current: true };
	const onPlayStateChange = vi.fn();
	const onTimeUpdate = vi.fn();
	const handlers = createVideoEventHandlers({
		video: {
			currentTime: 4.25,
			paused: true,
			ended: false,
		} as HTMLVideoElement,
		isSeekingRef: { current: false },
		isPlayingRef,
		allowPlaybackRef: { current: true },
		currentTimeRef: { current: 0 },
		timeUpdateAnimationRef: { current: null },
		onPlayStateChange,
		onTimeUpdate,
		trimRegionsRef: { current: [] },
		speedRegionsRef: { current: [] },
		externalTransportActiveRef: { current: externalTransportActive },
	});

	return { handlers, isPlayingRef, onPlayStateChange, onTimeUpdate };
}

describe("video event transport ownership", () => {
	it("does not stop an external transport when its video element pauses", () => {
		const harness = createPauseHarness(true);

		harness.handlers.handlePause();

		expect(harness.isPlayingRef.current).toBe(true);
		expect(harness.onPlayStateChange).not.toHaveBeenCalled();
		expect(harness.onTimeUpdate).toHaveBeenCalledWith(4.25);
	});

	it("does not start an external transport when its video element resumes", () => {
		const harness = createPauseHarness(true);
		harness.isPlayingRef.current = false;

		harness.handlers.handlePlay();

		expect(harness.isPlayingRef.current).toBe(false);
		expect(harness.onPlayStateChange).not.toHaveBeenCalled();
	});

	it("still stops legacy playback when the video element pauses", () => {
		const harness = createPauseHarness(false);

		harness.handlers.handlePause();

		expect(harness.isPlayingRef.current).toBe(false);
		expect(harness.onPlayStateChange).toHaveBeenCalledWith(false);
	});
});
