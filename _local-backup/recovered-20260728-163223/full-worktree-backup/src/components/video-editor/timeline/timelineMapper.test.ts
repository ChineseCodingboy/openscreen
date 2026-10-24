import { describe, expect, it } from "vitest";
import { buildSourceTrimRegions, TimelineMapper } from "./timelineMapper";

describe("TimelineMapper", () => {
	it("maps gaps to null and clip contents to source time", () => {
		const mapper = new TimelineMapper([
			{ id: "left", startMs: 0, endMs: 1000, sourceStartMs: 2000 },
			{ id: "right", startMs: 2000, endMs: 3000, sourceStartMs: 5000 },
		]);
		expect(mapper.videoAtTimelineTime(1500)).toBeNull();
		expect(mapper.videoAtTimelineTime(2500)?.sourceTimeMs).toBe(5500);
	});

	it("round-trips source and timeline time inside a clip", () => {
		const mapper = new TimelineMapper([
			{ id: "clip", startMs: 4000, endMs: 7000, sourceStartMs: 1000 },
		]);
		const source = mapper.videoAtTimelineTime(5500);
		expect(source?.sourceTimeMs).toBe(2500);
		expect(mapper.timelineTimeForVideoSource(source?.sourceTimeMs ?? 0)?.timelineTimeMs).toBe(5500);
	});

	it("builds source gaps so export can skip unused decode windows", () => {
		expect(
			buildSourceTrimRegions(
				[
					{ id: "one", startMs: 0, endMs: 1000, sourceStartMs: 1000 },
					{ id: "two", startMs: 1000, endMs: 2500, sourceStartMs: 4000 },
				],
				7000,
			),
		).toEqual([
			{ id: "source-gap-1", startMs: 0, endMs: 1000 },
			{ id: "source-gap-2", startMs: 2000, endMs: 4000 },
			{ id: "source-gap-3", startMs: 5500, endMs: 7000 },
		]);
	});
});
