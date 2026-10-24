import { describe, expect, it } from "vitest";
import { computeZoomTransform, mapSourceFocusToStage } from "./zoomTransform";

describe("source-space professional zoom mapping", () => {
	it("maps through the actual source sprite offset and scale", () => {
		const focus = mapSourceFocusToStage({
			focus: { cx: 0.75, cy: 0.25 },
			stageSize: { width: 1000, height: 600 },
			baseOffset: { x: -100, y: 50 },
			sourceSize: { width: 1200, height: 800 },
			baseScale: 0.5,
		});
		expect(focus).toEqual({ cx: 0.35, cy: 0.25 });
	});

	it("is analytic and identical when sampled repeatedly at one timestamp", () => {
		const geometry = {
			stageSize: { width: 1000, height: 600 },
			baseMask: { x: 100, y: 80, width: 800, height: 440 },
			zoomScale: 2.2,
			zoomProgress: 0.42,
			focusX: 0.35,
			focusY: 0.25,
		};
		expect(computeZoomTransform(geometry)).toEqual(computeZoomTransform(geometry));
	});
});
