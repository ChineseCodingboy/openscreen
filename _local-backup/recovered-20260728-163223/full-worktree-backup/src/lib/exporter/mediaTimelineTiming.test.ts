import { describe, expect, it } from "vitest";
import {
	buildMediaTimelineTiming,
	buildMediaVideoDecodeJobs,
	exportTimeForTimelineTime,
	frameIndexForTimelineTime,
	shouldRenderMediaBackground,
	timelineTimeForExportTime,
	totalFramesForExportDuration,
} from "./mediaTimelineTiming";

describe("media timeline export timing", () => {
	it("compresses speed regions and keeps exact 30/60 fps output counts", () => {
		const timing = buildMediaTimelineTiming(4000, [
			{ id: "fast", startMs: 1000, endMs: 3000, speed: 2 },
		]);

		expect(timing.exportDurationMs).toBe(3000);
		expect(exportTimeForTimelineTime(timing, 3000)).toBe(2000);
		expect(totalFramesForExportDuration(timing.exportDurationMs, 30)).toBe(90);
		expect(totalFramesForExportDuration(timing.exportDurationMs, 60)).toBe(180);
		expect(frameIndexForTimelineTime(timing, 3000, 30)).toBe(60);
		expect(frameIndexForTimelineTime(timing, 3000, 60)).toBe(120);
	});

	it("rounds fractional speed boundaries consistently onto the CFR grid", () => {
		const timing = buildMediaTimelineTiming(4000, [
			{ id: "fractional", startMs: 0, endMs: 1100, speed: 2 },
		]);

		for (let index = 0; index < 10; index++) {
			expect(frameIndexForTimelineTime(timing, 1100 + (index * 1000) / 30, 30)).toBe(17 + index);
		}
	});

	it("expands slow regions when calculating the output duration", () => {
		const timing = buildMediaTimelineTiming(3000, [
			{ id: "slow", startMs: 1000, endMs: 2000, speed: 0.5 },
		]);

		expect(timing.exportDurationMs).toBe(4000);
		expect(exportTimeForTimelineTime(timing, 2500)).toBe(3500);
	});

	it("maps background export frames back to the editor timeline through speed regions", () => {
		const timing = buildMediaTimelineTiming(3000, [
			{ id: "fast", startMs: 0, endMs: 1000, speed: 2 },
		]);

		expect(timelineTimeForExportTime(timing, 750)).toBe(1250);
		expect(timelineTimeForExportTime(timing, timing.exportDurationMs)).toBe(3000);
	});

	it("always renders background frames when the video track is hidden", () => {
		expect(shouldRenderMediaBackground(true, 3000, 3000)).toBe(true);
		expect(shouldRenderMediaBackground(false, 3000, 3000)).toBe(false);
		expect(shouldRenderMediaBackground(false, 4000, 3000)).toBe(true);
	});
});

describe("media timeline decode jobs", () => {
	it("keeps timeline order when source windows are reordered", () => {
		const jobs = buildMediaVideoDecodeJobs(
			[
				{ id: "timeline-second", startMs: 1000, endMs: 2000, sourceStartMs: 0 },
				{ id: "timeline-first", startMs: 0, endMs: 1000, sourceStartMs: 4000 },
			],
			6000,
			[],
		);

		expect(jobs.map((job) => job.clip.id)).toEqual(["timeline-first", "timeline-second"]);
		expect(jobs.map((job) => job.clip.sourceStartMs)).toEqual([4000, 0]);
		expect(jobs[0].trimRegions).toEqual([
			{ id: "media-job-0-before", startMs: 0, endMs: 4000 },
			{ id: "media-job-0-after", startMs: 5000, endMs: 6000 },
		]);
	});

	it("preserves duplicate source windows as separate ordered decode passes", () => {
		const jobs = buildMediaVideoDecodeJobs(
			[
				{ id: "first-use", startMs: 0, endMs: 1000, sourceStartMs: 2000 },
				{ id: "second-use", startMs: 1000, endMs: 2000, sourceStartMs: 2000 },
			],
			5000,
			[{ id: "second-fast", startMs: 1000, endMs: 2000, speed: 2 }],
		);

		expect(jobs).toHaveLength(2);
		expect(jobs[0].trimRegions.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual(
			jobs[1].trimRegions.map(({ startMs, endMs }) => ({ startMs, endMs })),
		);
		expect(jobs[0].speedRegions).toEqual([]);
		expect(jobs[1].speedRegions).toEqual([
			{
				id: "media-job-1-speed-0",
				startMs: 2000,
				endMs: 3000,
				speed: 2,
			},
		]);
	});
});
