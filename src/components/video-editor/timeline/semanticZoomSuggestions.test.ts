import { describe, expect, it } from "vitest";
import { buildSemanticCursorPath } from "@/lib/cursor/semanticCursorPath";
import type { CursorRecordingData } from "@/native/contracts";
import { buildSemanticZoomSuggestions } from "./semanticZoomSuggestions";

function pathFrom(samples: CursorRecordingData["samples"]) {
	return buildSemanticCursorPath({ version: 2, provider: "native", assets: [], samples }, 0);
}

describe("semantic zoom suggestions", () => {
	it("starts before the action and reaches full zoom 80ms after it", () => {
		const path = pathFrom([
			{ timeMs: 0, cx: 0.1, cy: 0.2, visible: true },
			{ timeMs: 100, cx: 0.1, cy: 0.2, visible: true, interactionType: "click" },
			{ timeMs: 200, cx: 0.2, cy: 0.2, visible: true },
			{ timeMs: 800, cx: 0.8, cy: 0.7, visible: true },
			{ timeMs: 900, cx: 0.8, cy: 0.7, visible: true, interactionType: "click" },
			{ timeMs: 1200, cx: 0.8, cy: 0.7, visible: true },
		]);
		const [suggestion] = buildSemanticZoomSuggestions({
			path,
			totalMs: 2500,
			existingRegions: [],
		});

		expect(suggestion.span.start).toBe(0);
		expect(suggestion.span.start + suggestion.zoomInDurationMs).toBe(suggestion.triggerTimeMs + 80);
		expect(suggestion.triggerType).toBe("click");
		expect(
			suggestion.span.end + suggestion.zoomOutDurationMs - suggestion.span.start,
		).toBeLessThanOrEqual(3200);
	});

	it("scores globally and distributes a long recording with sparse limits", () => {
		const samples: CursorRecordingData["samples"] = [];
		for (let timeMs = 0; timeMs <= 440_000; timeMs += 10_000) {
			samples.push({
				timeMs,
				cx: 0.15 + ((timeMs / 10_000) % 6) * 0.12,
				cy: 0.25 + ((timeMs / 10_000) % 3) * 0.2,
				visible: true,
				interactionType: "click",
			});
		}
		const suggestions = buildSemanticZoomSuggestions({
			path: pathFrom(samples),
			totalMs: 449_000,
			existingRegions: [],
		});

		expect(suggestions.length).toBeGreaterThan(6);
		expect(suggestions.some((suggestion) => suggestion.triggerTimeMs > 300_000)).toBe(true);
		for (let index = 1; index < suggestions.length; index += 1) {
			expect(
				suggestions[index].triggerTimeMs - suggestions[index - 1].triggerTimeMs,
			).toBeGreaterThanOrEqual(4000);
		}
		for (let index = 0; index + 3 < suggestions.length; index += 1) {
			expect(
				suggestions[index + 3].triggerTimeMs - suggestions[index].triggerTimeMs,
			).toBeGreaterThanOrEqual(60_000);
		}
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

	it("keeps drag start and destination so the camera can pan instead of chasing samples", () => {
		const path = pathFrom([
			{ timeMs: 1000, cx: 0.2, cy: 0.3, visible: true, interactionType: "click" },
			{ timeMs: 1400, cx: 0.45, cy: 0.5, visible: true },
			{ timeMs: 1800, cx: 0.75, cy: 0.7, visible: true, interactionType: "mouseup" },
		]);
		const [suggestion] = buildSemanticZoomSuggestions({
			path,
			totalMs: 4000,
			existingRegions: [],
		});

		expect(suggestion.triggerType).toBe("drag");
		expect(suggestion.focus).toEqual({ cx: 0.2, cy: 0.3 });
		expect(suggestion.dragEndFocus).toEqual({ cx: 0.75, cy: 0.7 });
	});
});
