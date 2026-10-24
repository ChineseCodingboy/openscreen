import { describe, expect, it } from "vitest";
import { buildSemanticCursorPath } from "@/lib/cursor/semanticCursorPath";
import type { CursorRecordingData } from "@/native/contracts";
import { buildSemanticZoomSuggestions } from "./semanticZoomSuggestions";

function pathFrom(samples: CursorRecordingData["samples"]) {
	return buildSemanticCursorPath({ version: 2, provider: "native", assets: [], samples }, 0);
}

describe("semantic zoom suggestions", () => {
	it("starts zoom and cursor together and arrives at full focus together", () => {
		const path = pathFrom([
			{ timeMs: 0, cx: 0.1, cy: 0.2, visible: true },
			{ timeMs: 100, cx: 0.1, cy: 0.2, visible: true, interactionType: "click" },
			{ timeMs: 200, cx: 0.2, cy: 0.2, visible: true },
			{ timeMs: 800, cx: 0.8, cy: 0.7, visible: true },
			{ timeMs: 900, cx: 0.8, cy: 0.7, visible: true, interactionType: "click" },
			{ timeMs: 1200, cx: 0.8, cy: 0.7, visible: true },
		]);
		const transition = path.transitions.find(
			(item) => item.fromAnchorId !== null && item.toAnchorId !== null,
		)!;

		const [suggestion] = buildSemanticZoomSuggestions({
			path,
			totalMs: 2500,
			existingRegions: [],
		});

		expect(suggestion.span.start).toBe(transition.startTimeMs);
		expect(suggestion.zoomInDurationMs).toBe(transition.endTimeMs - transition.startTimeMs);
		expect(suggestion.focus).toEqual(transition.to);
	});

	it("does not overlap manual zoom regions", () => {
		const path = pathFrom([
			{ timeMs: 0, cx: 0.1, cy: 0.5, visible: true, interactionType: "click" },
			{ timeMs: 400, cx: 0.8, cy: 0.5, visible: true },
			{ timeMs: 500, cx: 0.8, cy: 0.5, visible: true, interactionType: "click" },
			{ timeMs: 700, cx: 0.8, cy: 0.5, visible: true },
		]);

		expect(
			buildSemanticZoomSuggestions({
				path,
				totalMs: 2000,
				existingRegions: [{ startMs: 100, endMs: 1200 }],
			}),
		).toEqual([]);
	});
});
