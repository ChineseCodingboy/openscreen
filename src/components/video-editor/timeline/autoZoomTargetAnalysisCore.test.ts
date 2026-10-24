import { describe, expect, it } from "vitest";
import { fallbackScaleForAction, scaleForTargetBounds } from "./autoZoomTargetAnalysisCore";

describe("auto zoom adaptive target scale", () => {
	it("uses stronger zoom for a small button than for an input or panel", () => {
		const button = scaleForTargetBounds({ x: 0.2, y: 0.2, width: 0.08, height: 0.05 });
		const input = scaleForTargetBounds({ x: 0.2, y: 0.2, width: 0.3, height: 0.08 });
		const panel = scaleForTargetBounds({ x: 0.1, y: 0.1, width: 0.6, height: 0.55 });

		expect(button).toBe(2.6);
		expect(button).toBeGreaterThan(input);
		expect(input).toBeGreaterThan(panel);
		expect(panel).toBe(1.25);
	});

	it("falls back by action type instead of a universal 1.8x", () => {
		expect(new Set(["click", "drag", "dwell"].map(fallbackScaleForAction)).size).toBe(3);
	});
});
