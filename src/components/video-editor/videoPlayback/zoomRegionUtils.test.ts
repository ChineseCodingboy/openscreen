import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint, ZoomRegion } from "../types";
import { computeRegionStrength, findDominantRegion } from "./zoomRegionUtils";

const cursorTelemetry: CursorTelemetryPoint[] = [
	{ timeMs: 0, cx: 0.1, cy: 0.2 },
	{ timeMs: 2000, cx: 0.9, cy: 0.8 },
];

function autoRegion(overrides: Partial<ZoomRegion> = {}): ZoomRegion {
	return {
		id: "auto",
		startMs: 0,
		endMs: 3000,
		depth: 6,
		focus: { cx: 0.5, cy: 0.5 },
		focusMode: "auto",
		...overrides,
	};
}

describe("computeRegionStrength synchronized zoom-in", () => {
	it("uses a deterministic quintic professional-v2 profile with an explicit exit", () => {
		const region = autoRegion({
			startMs: 1000,
			endMs: 2400,
			zoomInDurationMs: 500,
			zoomOutDurationMs: 600,
			motionProfile: "professional-v2",
		});
		expect(computeRegionStrength(region, 1000)).toBe(0);
		expect(computeRegionStrength(region, 1250)).toBeCloseTo(0.5, 10);
		expect(computeRegionStrength(region, 1500)).toBe(1);
		expect(computeRegionStrength(region, 2700)).toBeCloseTo(0.5, 10);
		expect(computeRegionStrength(region, 3000)).toBe(0);
	});
	it("starts an explicit auto zoom at the cursor transition start", () => {
		const region = autoRegion({ startMs: 1000, endMs: 3000, zoomInDurationMs: 800 });

		expect(computeRegionStrength(region, 999)).toBe(0);
		expect(computeRegionStrength(region, 1000)).toBe(0);
		expect(computeRegionStrength(region, 1400)).toBeGreaterThan(0);
		expect(computeRegionStrength(region, 1400)).toBeLessThan(1);
		expect(computeRegionStrength(region, 1800)).toBe(1);
	});

	it("keeps legacy/manual zoom timing when no duration is stored", () => {
		const region = autoRegion({ startMs: 1000, endMs: 3000 });

		expect(computeRegionStrength(region, 500)).toBeGreaterThan(0);
		expect(computeRegionStrength(region, 1500)).toBe(1);
	});
});

describe("findDominantRegion dual-time auto-focus", () => {
	it("uses timeline time for region strength and cursor time for focus", () => {
		const result = findDominantRegion([autoRegion()], 1000, {
			cursorTelemetry,
			cursorTimeMs: 0,
		});

		expect(result.region?.id).toBe("auto");
		expect(result.strength).toBe(1);
		expect(result.region?.focus.cx).toBeCloseTo(0.1, 6);
		expect(result.region?.focus.cy).toBeCloseTo(0.2, 6);
	});

	it("defaults cursor sampling to timeline time for existing callers", () => {
		const result = findDominantRegion([autoRegion()], 1000, { cursorTelemetry });
		expect(result.region?.focus).toEqual({ cx: 0.5, cy: 0.5 });
	});

	it("includes cursor time in the dominant-region cache key", () => {
		const regions = [autoRegion()];
		const atSourceStart = findDominantRegion(regions, 1000, {
			cursorTelemetry,
			cursorTimeMs: 0,
		});
		const atSourceEnd = findDominantRegion(regions, 1000, {
			cursorTelemetry,
			cursorTimeMs: 2000,
		});

		expect(atSourceStart.region?.focus.cx).toBeCloseTo(0.1, 6);
		expect(atSourceEnd.region?.focus.cx).toBeCloseTo(0.9, 6);
	});

	it("uses cursor time during connected zoom transitions", () => {
		const regions = [
			autoRegion({ id: "first", endMs: 1000 }),
			autoRegion({ id: "second", startMs: 1200, endMs: 3000 }),
		];
		const result = findDominantRegion(regions, 1500, {
			connectZooms: true,
			cursorTelemetry,
			cursorTimeMs: 0,
		});

		expect(result.transition).not.toBeNull();
		expect(result.region?.focus.cx).toBeCloseTo(0.1, 6);
		expect(result.region?.focus.cy).toBeCloseTo(0.2, 6);
	});

	it("prefers a shared processed cursor sampler for auto focus", () => {
		const result = findDominantRegion([autoRegion()], 1000, {
			cursorTelemetry,
			cursorTimeMs: 750,
			cursorFocusSampler: (timeMs) => ({ cx: timeMs / 1000, cy: 0.25 }),
		});

		expect(result.region?.focus.cx).toBeCloseTo(0.75, 6);
		expect(result.region?.focus.cy).toBeCloseTo(0.25, 6);
	});
});

describe("findDominantRegion active-region indexing", () => {
	it("does not build temporary arrays while selecting an active region", () => {
		const regions = [
			autoRegion({ id: "first", focusMode: undefined }),
			autoRegion({ id: "second", startMs: 1000, focusMode: undefined }),
		];
		const guardedRegions = new Proxy(regions, {
			get(target, property, receiver) {
				if (property === "map" || property === "filter" || property === "sort") {
					throw new Error(`Unexpected active-region array method: ${String(property)}`);
				}
				return Reflect.get(target, property, receiver);
			},
		});

		expect(findDominantRegion(guardedRegions, 1500).region?.id).toBe("second");
	});

	it("preserves strength and latest-start priority without sorting active regions", () => {
		const earlierButStronger = autoRegion({
			id: "earlier-stronger",
			startMs: 0,
			endMs: 3000,
			focusMode: undefined,
		});
		const laterButStillEntering = autoRegion({
			id: "later-entering",
			startMs: 1400,
			endMs: 3000,
			focusMode: undefined,
		});

		expect(findDominantRegion([laterButStillEntering, earlierButStronger], 1500).region?.id).toBe(
			"earlier-stronger",
		);

		const laterAtFullStrength = { ...laterButStillEntering, startMs: 1000 };
		expect(findDominantRegion([earlierButStronger, laterAtFullStrength], 1500).region?.id).toBe(
			"later-entering",
		);
	});

	it("builds connected lookups once and keeps active selection linear", () => {
		let idReadCount = 0;
		const regions = Array.from({ length: 250 }, (_, index) => {
			const region = autoRegion({
				startMs: index * 2000,
				endMs: index * 2000 + 1000,
				focusMode: undefined,
			});
			Object.defineProperty(region, "id", {
				configurable: true,
				enumerable: true,
				get() {
					idReadCount += 1;
					return `region-${index}`;
				},
			});
			return region;
		});

		expect(findDominantRegion(regions, -10_000, { connectZooms: true }).region).toBeNull();
		expect(idReadCount).toBeLessThan(regions.length * 3);

		idReadCount = 0;
		expect(findDominantRegion(regions, -9000, { connectZooms: true }).region).toBeNull();
		expect(idReadCount).toBe(0);
	});

	it("creates a fresh connected index when immutable edits replace the regions array", () => {
		const first = autoRegion({ id: "first", endMs: 1000, focusMode: undefined });
		const second = autoRegion({
			id: "second",
			startMs: 1200,
			endMs: 3000,
			focusMode: undefined,
		});
		const original = [first, second];

		expect(findDominantRegion(original, 1500, { connectZooms: true }).transition).not.toBeNull();

		const edited = [{ ...first, endMs: 100 }, second];
		const result = findDominantRegion(edited, 1500, { connectZooms: true });
		expect(result.transition).toBeNull();
		expect(result.region?.id).toBe("second");
	});
});
