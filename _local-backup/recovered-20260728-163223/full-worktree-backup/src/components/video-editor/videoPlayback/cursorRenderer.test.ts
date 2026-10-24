import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import { getCursorVisualState } from "./cursorRenderer";

describe("cursor visual lookup", () => {
	it("finds click effects and the latest non-click cursor type", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.1, cy: 0.1, cursorType: "arrow" },
			{ timeMs: 100, cx: 0.2, cy: 0.2, cursorType: "pointer", interactionType: "click" },
			{ timeMs: 200, cx: 0.3, cy: 0.3, cursorType: "text", interactionType: "move" },
		];

		const duringClick = getCursorVisualState(samples, 150);
		expect(duringClick.cursorType).toBe("arrow");
		expect(duringClick.clickBounceProgress).toBeGreaterThan(0);
		expect(duringClick.clickProgress).toBeGreaterThan(0);
		expect(getCursorVisualState(samples, 250).cursorType).toBe("text");
	});

	it("invalidates its index when samples are appended to the same array", () => {
		const samples: CursorTelemetryPoint[] = [{ timeMs: 0, cx: 0.1, cy: 0.1, cursorType: "arrow" }];
		expect(getCursorVisualState(samples, 50).cursorType).toBe("arrow");

		samples.push({
			timeMs: 100,
			cx: 0.2,
			cy: 0.2,
			cursorType: "pointer",
			interactionType: "move",
		});
		expect(getCursorVisualState(samples, 150).cursorType).toBe("pointer");
	});

	it("returns no click animation before the first indexed click", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.1, cy: 0.1, cursorType: "arrow" },
			{ timeMs: 1000, cx: 0.2, cy: 0.2, interactionType: "click" },
		];
		expect(getCursorVisualState(samples, 500)).toMatchObject({
			clickBounceProgress: 0,
			clickProgress: 0,
		});
	});
});
