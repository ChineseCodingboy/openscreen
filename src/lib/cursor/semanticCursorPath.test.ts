import { describe, expect, it, vi } from "vitest";
import type { CursorRecordingData, CursorRecordingSample } from "@/native/contracts";
import {
	buildSerializedSmoothedCursorPath,
	createSmoothedCursorPath,
	getSmoothedCursorPath,
} from "./cursorPathSmoothing";
import {
	buildSemanticCursorPath,
	getSemanticCursorPath,
	prepareSemanticCursorPath,
} from "./semanticCursorPath";

function makeRecording(samples: CursorRecordingSample[]): CursorRecordingData {
	return { version: 2, provider: "native", assets: [], samples };
}

function sample(
	timeMs: number,
	cx: number,
	cy = 0.5,
	overrides: Partial<CursorRecordingSample> = {},
): CursorRecordingSample {
	return { timeMs, cx, cy, visible: true, ...overrides };
}

describe("semantic cursor anchors", () => {
	it("prioritizes clicks over mouseup and dwell candidates, then merges nearby events", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1),
				sample(100, 0.2, 0.5, { interactionType: "click" }),
				sample(170, 0.201, 0.5, { interactionType: "mouseup" }),
				sample(350, 0.21, 0.5, { interactionType: "click" }),
				sample(500, 0.5),
				sample(800, 0.8, 0.5, { interactionType: "click" }),
				sample(850, 0.8, 0.5, { interactionType: "mouseup" }),
				sample(1000, 0.8),
			]),
			0,
		);

		// Mouseups merge into their click, but distinct clicks always stay separate anchors.
		expect(path.anchors).toHaveLength(3);
		expect(path.anchors.map(({ kind, timeMs }) => ({ kind, timeMs }))).toEqual([
			{ kind: "click", timeMs: 100 },
			{ kind: "click", timeMs: 350 },
			{ kind: "click", timeMs: 800 },
		]);
		expect(path.mode).toBe("semantic");
	});

	it("uses 350ms dwells inside a 0.012 radius when interactions are absent", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1),
				sample(100, 0.106),
				sample(250, 0.095),
				sample(400, 0.1),
				sample(500, 0.4),
				sample(600, 0.8),
				sample(750, 0.806),
				sample(900, 0.795),
				sample(1000, 0.8),
			]),
			0,
		);

		expect(path.anchors.map((anchor) => anchor.kind)).toEqual(["dwell", "dwell"]);
		expect(path.anchors[0]).toMatchObject({ dwellStartTimeMs: 0, dwellEndTimeMs: 400 });
		expect(path.anchors[1]).toMatchObject({ dwellStartTimeMs: 600, dwellEndTimeMs: 1000 });
		expect(path.mode).toBe("semantic");
	});

	it("keeps 0.04 dwell moves but drops those below 0.03", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1),
				sample(400, 0.1),
				sample(500, 0.14),
				sample(900, 0.14),
				sample(1000, 0.4),
				sample(1400, 0.4),
			]),
			0,
		);

		expect(path.anchors).toHaveLength(3);
		expect(path.anchors[0].cx).toBeCloseTo(0.1, 6);
		expect(path.anchors[1].cx).toBeCloseTo(0.14, 6);
		expect(path.anchors[2].cx).toBeCloseTo(0.4, 6);

		const flattened = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1),
				sample(400, 0.1),
				sample(500, 0.12),
				sample(900, 0.12),
				sample(1000, 0.4),
				sample(1400, 0.4),
			]),
			0,
		);
		expect(flattened.anchors).toHaveLength(2);
		expect(flattened.anchors[0].cx).toBeCloseTo(0.1, 6);
		expect(flattened.anchors[1].cx).toBeCloseTo(0.4, 6);
	});
});

describe("semantic cursor transitions", () => {
	it("travels directly from A to B without following a raw detour", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1, 0.1),
				sample(100, 0.1, 0.1, { interactionType: "click" }),
				sample(150, 0.1, 0.1),
				sample(200, 0.5, 0.9),
				sample(300, 0.9, 0.1),
				sample(320, 0.9, 0.1, { interactionType: "click" }),
				sample(400, 0.9, 0.1),
			]),
			0,
		);
		const [from, to] = path.anchors;
		const transition = path.transitions.find(
			(candidate) => candidate.fromAnchorId === from.id && candidate.toAnchorId === to.id,
		);

		// The desired duration does not fit before the recorded arrival, so the transition
		// starts earlier instead of overshooting the click: arrival stays pinned.
		expect(transition).toMatchObject({
			departureTimeMs: 200,
			arrivalTimeMs: 300,
			startTimeMs: 100,
			endTimeMs: 300,
		});
		expect(transition!.endTimeMs).toBeLessThanOrEqual(to.timeMs);
		expect(path.sampleAt(to.timeMs)).toEqual({ cx: 0.9, cy: 0.1 });
		const midpoint = path.sampleAt(200)!;
		expect(midpoint.cx).toBeCloseTo(0.5, 6);
		expect(midpoint.cy).toBeCloseTo(0.1, 6);
		// 200ms transition: lag is capped at 20% (40ms), peaking mid-transition.
		expect(path.cameraSampleAt(200)).toEqual(path.sampleAt(160));
	});

	it("preserves longer recorded departure and arrival timing", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1),
				sample(100, 0.1, 0.5, { interactionType: "click" }),
				sample(150, 0.1),
				sample(200, 0.2),
				sample(500, 0.5),
				sample(1000, 0.9),
				sample(1100, 0.9, 0.5, { interactionType: "click" }),
				sample(1200, 0.9),
			]),
			0,
		);
		const [from, to] = path.anchors;
		const transition = path.transitions.find(
			(candidate) => candidate.fromAnchorId === from.id && candidate.toAnchorId === to.id,
		)!;

		expect(transition.departureTimeMs).toBe(200);
		expect(transition.arrivalTimeMs).toBe(1000);
		expect(transition.startTimeMs).toBe(200);
		expect(transition.endTimeMs).toBe(1000);
	});

	it("applies camera lag only inside a transition and meets at both endpoints", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1),
				sample(100, 0.1, 0.5, { interactionType: "click" }),
				sample(150, 0.1),
				sample(200, 0.2),
				sample(500, 0.5),
				sample(1000, 0.9),
				sample(1100, 0.9, 0.5, { interactionType: "click" }),
				sample(1300, 0.9),
			]),
			0,
		);
		const [from, to] = path.anchors;
		const transition = path.transitions.find(
			(candidate) => candidate.fromAnchorId === from.id && candidate.toAnchorId === to.id,
		)!;
		const midpoint = (transition.startTimeMs + transition.endTimeMs) / 2;

		expect(path.cameraSampleAt(transition.startTimeMs)).toEqual(
			path.sampleAt(transition.startTimeMs),
		);
		expect(path.cameraSampleAt(transition.endTimeMs)).toEqual(path.sampleAt(transition.endTimeMs));
		expect(path.cameraSampleAt(midpoint)).toEqual(path.sampleAt(midpoint - 150));
		expect(path.cameraSampleAt(1150)).toEqual(path.sampleAt(1150));
	});

	it("pins the cursor to each recorded click position at its exact time", () => {
		const clickSamples = [
			sample(100, 0.1, 0.1, { interactionType: "click" }),
			sample(600, 0.52, 0.48, { interactionType: "click" }),
			sample(1200, 0.9, 0.85, { interactionType: "click" }),
		];
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1, 0.1),
				clickSamples[0],
				sample(150, 0.1, 0.1),
				// A dwell just before the second click merges into it without displacing it.
				sample(200, 0.5, 0.5),
				sample(560, 0.5, 0.5),
				clickSamples[1],
				sample(700, 0.52, 0.48),
				sample(900, 0.7, 0.6),
				clickSamples[2],
				sample(1300, 0.9, 0.85),
			]),
			0,
		);

		for (const click of clickSamples) {
			const position = path.sampleAt(click.timeMs)!;
			expect(position.cx).toBeCloseTo(click.cx, 6);
			expect(position.cy).toBeCloseTo(click.cy, 6);
		}
	});

	it("keeps both of two rapid nearby clicks as pinned anchors", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.2),
				sample(100, 0.2, 0.5, { interactionType: "click" }),
				sample(250, 0.215, 0.5, { interactionType: "click" }),
				sample(400, 0.215),
			]),
			0,
		);

		expect(path.anchors.map(({ kind, timeMs }) => ({ kind, timeMs }))).toEqual([
			{ kind: "click", timeMs: 100 },
			{ kind: "click", timeMs: 250 },
		]);
		expect(path.sampleAt(100)!.cx).toBeCloseTo(0.2, 6);
		expect(path.sampleAt(250)!.cx).toBeCloseTo(0.215, 6);
	});

	it("never ends a transition after its target anchor's recorded time", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.05),
				sample(300, 0.05, 0.5, { interactionType: "click" }),
				sample(350, 0.5),
				sample(400, 0.95, 0.5, { interactionType: "click" }),
				sample(700, 0.95),
				sample(750, 0.4),
				sample(800, 0.1, 0.5, { interactionType: "click" }),
				sample(900, 0.1),
			]),
			0,
		);

		const anchorsById = new Map(path.anchors.map((anchor) => [anchor.id, anchor]));
		expect(path.transitions.length).toBeGreaterThan(0);
		for (const transition of path.transitions) {
			const target = transition.toAnchorId ? anchorsById.get(transition.toAnchorId) : null;
			if (target) expect(transition.endTimeMs).toBeLessThanOrEqual(target.timeMs);
		}
		// The click at 400 is reached on time even though the recorded flick took only 50ms.
		expect(path.sampleAt(400)!.cx).toBeCloseTo(0.95, 6);
	});

	it("replays the recorded path between a click and its distant mouseup (drag follow)", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1, 0.1),
				sample(400, 0.1, 0.1),
				sample(500, 0.1, 0.1, { interactionType: "click" }),
				sample(600, 0.25, 0.4),
				sample(700, 0.42, 0.55),
				sample(800, 0.55, 0.62),
				sample(900, 0.6, 0.6, { interactionType: "mouseup" }),
				sample(1000, 0.6, 0.6),
				sample(1400, 0.6, 0.6),
			]),
			0,
		);

		const follow = path.transitions.find((transition) => transition.kind === "follow")!;
		expect(follow).toMatchObject({ startTimeMs: 500, endTimeMs: 900 });
		// Mid-drag positions replay the raw samples instead of a synthesized straight line.
		expect(path.sampleAt(700)).toEqual({ cx: 0.42, cy: 0.55 });
		expect(path.sampleAt(650)!.cx).toBeCloseTo((0.25 + 0.42) / 2, 6);
		expect(path.sampleAt(650)!.cy).toBeCloseTo((0.4 + 0.55) / 2, 6);
		// Endpoints coincide with the recorded click and mouseup samples.
		expect(path.sampleAt(500)).toEqual({ cx: 0.1, cy: 0.1 });
		expect(path.sampleAt(900)).toEqual({ cx: 0.6, cy: 0.6 });
		expect(path.cameraSampleAt(500)).toEqual(path.sampleAt(500));
		expect(path.cameraSampleAt(900)).toEqual(path.sampleAt(900));
	});

	it("keeps sampleAt continuous across holds, transitions, drags and hidden gaps", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1, 0.1),
				sample(400, 0.1, 0.1),
				sample(500, 0.1, 0.1, { interactionType: "click" }),
				sample(600, 0.3, 0.3),
				sample(700, 0.5, 0.5, { interactionType: "mouseup" }),
				sample(1100, 0.5, 0.5),
				sample(1200, 0.7, 0.2),
				sample(1300, 0.9, 0.1, { interactionType: "click" }),
				sample(1400, 0.9, 0.1),
				sample(1500, 0.9, 0.1, { visible: false }),
				sample(1600, 0.2, 0.8),
				sample(1700, 0.2, 0.8, { interactionType: "click" }),
				sample(2100, 0.6, 0.4),
				sample(2200, 0.6, 0.4, { interactionType: "click" }),
				sample(2300, 0.6, 0.4),
			]),
			0,
		);

		let previous: { cx: number; cy: number } | null = null;
		let sawHiddenGap = false;
		for (let timeMs = 0; timeMs <= 2300; timeMs += 1) {
			const position = path.sampleAt(timeMs);
			if (!position) {
				sawHiddenGap = true;
				expect(timeMs).toBeGreaterThan(1400);
				expect(timeMs).toBeLessThan(1600);
				previous = null;
				continue;
			}
			if (previous) {
				const stepDistance = Math.hypot(position.cx - previous.cx, position.cy - previous.cy);
				expect(stepDistance).toBeLessThanOrEqual(0.01);
			}
			previous = position;
		}
		expect(sawHiddenGap).toBe(true);
	});
});

describe("semantic cursor path runs and fallback", () => {
	it("never creates anchors or transitions across a hidden gap", () => {
		const path = buildSemanticCursorPath(
			makeRecording([
				sample(0, 0.1),
				sample(100, 0.1, 0.5, { interactionType: "click" }),
				sample(400, 0.8),
				sample(500, 0.8, 0.5, { interactionType: "click" }),
				sample(600, 0.8),
				sample(700, 0.8, 0.5, { visible: false }),
				sample(1000, 0.2),
				sample(1100, 0.2, 0.5, { interactionType: "click" }),
				sample(1400, 0.9),
				sample(1500, 0.9, 0.5, { interactionType: "click" }),
				sample(1600, 0.9),
			]),
			0,
		);

		expect(path.visibleRuns.map((run) => run.mode)).toEqual(["semantic", "semantic"]);
		expect(path.sampleAt(650)).toBeNull();
		expect(path.sampleAt(700)).toBeNull();
		expect(path.sampleAt(900)).toBeNull();
		expect(
			path.transitions.every(
				(transition) => transition.runIndex === 0 || transition.runIndex === 1,
			),
		).toBe(true);
		expect(
			path.transitions.some((transition) => transition.from.cx > 0.7 && transition.to.cx < 0.3),
		).toBe(false);
	});

	it("falls back to the existing smoothed path with fewer than two anchors", () => {
		const recording = makeRecording([
			sample(0, 0.1),
			sample(100, 0.5, 0.55, { interactionType: "click" }),
			sample(200, 0.9),
		]);
		const semantic = buildSemanticCursorPath(recording, 0.6);
		const fallback = getSmoothedCursorPath(recording, 0.6)!;

		expect(semantic.anchors).toHaveLength(1);
		expect(semantic.mode).toBe("fallback");
		for (const timeMs of [0, 50, 100, 150, 200]) {
			expect(semantic.sampleAt(timeMs)).toEqual(fallback.sampleAt(timeMs));
			expect(semantic.cameraSampleAt(timeMs)).toEqual(semantic.sampleAt(timeMs));
		}
	});

	it("injects a precomputed fallback without doing work during path construction", () => {
		const recording = makeRecording([
			sample(0, 0.1),
			sample(100, 0.5, 0.55, { interactionType: "click" }),
			sample(200, 0.9),
		]);
		const fallbackSampleAt = vi.fn(() => ({ cx: 0.42, cy: 0.24 }));
		const path = buildSemanticCursorPath(recording, 0.6, {
			sampleAt: fallbackSampleAt,
		});

		expect(fallbackSampleAt).not.toHaveBeenCalled();
		expect(path.sampleAt(100)).toEqual({ cx: 0.42, cy: 0.24 });
		expect(fallbackSampleAt).toHaveBeenCalledOnce();
	});

	it("prepares only fallback runs for worker smoothing", () => {
		const recording = makeRecording([
			sample(0, 0.1),
			sample(100, 0.1, 0.5, { interactionType: "click" }),
			sample(400, 0.8),
			sample(500, 0.8, 0.5, { interactionType: "click" }),
			sample(600, 0.8),
			sample(700, 0.8, 0.5, { visible: false }),
			sample(1000, 0.2),
			sample(1200, 0.3),
		]);
		const prepared = prepareSemanticCursorPath(recording);

		expect(prepared.metadata.mode).toBe("semantic");
		expect(prepared.requiresFallbackPath).toBe(true);
		expect(prepared.fallbackSamples.map((point) => point.timeMs)).toEqual([1000, 1200]);
		expect(() => prepared.createPath()).toThrow(/precomputed fallback/i);
	});

	it("keeps worker-injected preview fallback identical to export precomputation", () => {
		const recording = makeRecording([
			sample(0, 0.1),
			sample(100, 0.1, 0.5, { interactionType: "click" }),
			sample(400, 0.8),
			sample(500, 0.8, 0.5, { interactionType: "click" }),
			sample(600, 0.8),
			sample(700, 0.8, 0.5, { visible: false }),
			sample(1000, 0.2),
			sample(1100, 0.5),
			sample(1200, 0.3),
		]);
		const prepared = prepareSemanticCursorPath(recording);
		const workerFallback = createSmoothedCursorPath(
			buildSerializedSmoothedCursorPath({ samples: prepared.fallbackSamples }, 0.6),
		);
		const previewPath = buildSemanticCursorPath(recording, 0.6, workerFallback);
		const exportPath = buildSemanticCursorPath(recording, 0.6);

		for (const timeMs of [0, 250, 600, 700, 1000, 1050, 1150, 1200]) {
			expect(previewPath.sampleAt(timeMs)).toEqual(exportPath.sampleAt(timeMs));
		}
	});

	it("does not request fallback smoothing for a fully semantic recording", () => {
		const recording = makeRecording([
			sample(0, 0.1),
			sample(100, 0.1, 0.5, { interactionType: "click" }),
			sample(400, 0.8),
			sample(500, 0.8, 0.5, { interactionType: "click" }),
			sample(600, 0.8),
		]);
		const prepared = prepareSemanticCursorPath(recording);

		expect(prepared.requiresFallbackPath).toBe(false);
		expect(prepared.fallbackSamples).toEqual([]);
		expect(prepared.createPath().sampleAt(250)).not.toBeNull();
	});

	it("is deterministic and memoized for preview/export sharing", () => {
		const recording = makeRecording([
			sample(0, 0.1),
			sample(100, 0.1, 0.5, { interactionType: "click" }),
			sample(400, 0.8),
			sample(500, 0.8, 0.5, { interactionType: "click" }),
			sample(600, 0.8),
		]);
		const firstBuild = buildSemanticCursorPath(recording, 0.4);
		const secondBuild = buildSemanticCursorPath(recording, 0.4);

		expect(firstBuild.anchors).toEqual(secondBuild.anchors);
		expect(firstBuild.transitions).toEqual(secondBuild.transitions);
		for (const timeMs of [0, 100, 250, 500, 600]) {
			expect(firstBuild.sampleAt(timeMs)).toEqual(secondBuild.sampleAt(timeMs));
		}
		expect(getSemanticCursorPath(recording, 0.4)).toBe(getSemanticCursorPath(recording, 0.4));
	});

	it("returns the same path object for every smoothing strength when no fallback is needed", () => {
		const recording = makeRecording([
			sample(0, 0.1),
			sample(100, 0.1, 0.5, { interactionType: "click" }),
			sample(400, 0.8),
			sample(500, 0.8, 0.5, { interactionType: "click" }),
			sample(600, 0.8),
		]);

		expect(prepareSemanticCursorPath(recording).requiresFallbackPath).toBe(false);
		expect(getSemanticCursorPath(recording, 0.3)).toBe(getSemanticCursorPath(recording, 0.7));
	});

	it("returns null from the memoized API when recording data is absent", () => {
		expect(getSemanticCursorPath(null)).toBeNull();
		expect(getSemanticCursorPath(makeRecording([]))).toBeNull();
	});
});
