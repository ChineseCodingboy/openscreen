import { describe, expect, it } from "vitest";
import { snapCutTime } from "./cutGuide";

describe("snapCutTime", () => {
	it("quantizes a cut to the nearest video frame", () => {
		expect(
			snapCutTime({
				rawTimeMs: 1011,
				durationMs: 5000,
				frameRate: 60,
				magneticTargets: [],
				magneticThresholdMs: 20,
			}),
		).toBeCloseTo(1016.6667, 3);
	});

	it("prefers a nearby magnetic target unless Alt disables it", () => {
		const input = {
			rawTimeMs: 1024,
			durationMs: 5000,
			frameRate: 60,
			magneticTargets: [1000],
			magneticThresholdMs: 30,
		};
		expect(snapCutTime(input)).toBe(1000);
		expect(snapCutTime({ ...input, disableMagnet: true })).toBeCloseTo(1016.6667, 3);
	});

	it("clamps to timeline bounds", () => {
		expect(
			snapCutTime({
				rawTimeMs: 5100,
				durationMs: 5000,
				frameRate: 30,
				magneticTargets: [],
				magneticThresholdMs: 10,
			}),
		).toBe(5000);
	});
});
