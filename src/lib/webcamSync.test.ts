import { describe, expect, it } from "vitest";
import {
	ActiveMediaClock,
	buildWebcamSyncMetadata,
	mapScreenRangeToWebcamWindows,
	mapScreenSourceToWebcam,
	normalizeWebcamSyncMetadata,
	resolveWebcamSyncPoint,
	webcamSyncBoundaryAt,
	webcamSyncRateAt,
} from "./webcamSync";

describe("webcam sync metadata", () => {
	it("maps screen source time through a segment and exposes its local rate", () => {
		const metadata = {
			schemaVersion: 1 as const,
			segments: [{ screenStartMs: 100, screenEndMs: 1100, webcamStartMs: 300, webcamEndMs: 2300 }],
		};
		expect(mapScreenSourceToWebcam(600, metadata)).toBe(1300);
		expect(webcamSyncRateAt(600, metadata)).toBe(2);
		expect(webcamSyncBoundaryAt(600, metadata)).toBe("segment:0");
	});

	it("uses identity for legacy sessions without metadata", () => {
		expect(resolveWebcamSyncPoint(250, undefined)).toEqual({
			webcamTimeMs: 250,
			localRate: 1,
			boundaryKey: "identity",
			segmentIndex: null,
		});
	});

	it("treats segment ends and camera duration as exclusive boundaries", () => {
		const metadata = {
			schemaVersion: 1 as const,
			segments: [{ screenStartMs: 0, screenEndMs: 1000, webcamStartMs: 50, webcamEndMs: 1050 }],
		};
		expect(mapScreenSourceToWebcam(999, metadata, { webcamDurationMs: 1050 })).toBe(1049);
		expect(mapScreenSourceToWebcam(1000, metadata)).toBeNull();
		expect(
			mapScreenSourceToWebcam(999, metadata, { adjustmentMs: 1, webcamDurationMs: 1050 }),
		).toBeNull();
	});

	it("normalizes valid segments and drops overlaps, backwards values, and junk", () => {
		expect(
			normalizeWebcamSyncMetadata({
				version: 1,
				segments: [
					{ screenStartMs: 100, screenEndMs: 200, webcamStartMs: 300, webcamEndMs: 400 },
					{ screenStartMs: 0, screenEndMs: 100, webcamStartMs: 200, webcamEndMs: 300 },
					{ screenStartMs: 50, screenEndMs: 150, webcamStartMs: 250, webcamEndMs: 350 },
					{ screenStartMs: 300, screenEndMs: 200, webcamStartMs: 500, webcamEndMs: 600 },
					"junk",
				],
			}),
		).toEqual({
			schemaVersion: 1,
			segments: [
				{ screenStartMs: 0, screenEndMs: 100, webcamStartMs: 200, webcamEndMs: 300 },
				{ screenStartMs: 100, screenEndMs: 200, webcamStartMs: 300, webcamEndMs: 400 },
			],
		});
	});

	it("maps export ranges per segment and clips them to webcam duration", () => {
		const metadata = {
			schemaVersion: 1 as const,
			segments: [
				{ screenStartMs: 0, screenEndMs: 1000, webcamStartMs: 200, webcamEndMs: 1200 },
				{ screenStartMs: 1500, screenEndMs: 2000, webcamStartMs: 1300, webcamEndMs: 2300 },
			],
		};
		expect(mapScreenRangeToWebcamWindows(500, 2000, metadata, { webcamDurationMs: 1800 })).toEqual([
			{
				screenStartMs: 500,
				screenEndMs: 1000,
				webcamStartMs: 700,
				webcamEndMs: 1200,
				localRate: 1,
				boundaryKey: "segment:0",
				segmentIndex: 0,
			},
			{
				screenStartMs: 1500,
				screenEndMs: 1750,
				webcamStartMs: 1300,
				webcamEndMs: 1800,
				localRate: 2,
				boundaryKey: "segment:1",
				segmentIndex: 1,
			},
		]);
	});
});

describe("active media clocks", () => {
	it("records active media time while excluding pauses", () => {
		const clock = new ActiveMediaClock();
		clock.start(1000);
		clock.pause(1500);
		clock.resume(2500);
		clock.stop(3000);
		expect(clock.snapshot()).toEqual({
			startedAtMs: 1000,
			stoppedAtMs: 3000,
			activeDurationMs: 1000,
			active: false,
			segments: [
				{ wallStartMs: 1000, wallEndMs: 1500, mediaStartMs: 0, mediaEndMs: 500 },
				{ wallStartMs: 2500, wallEndMs: 3000, mediaStartMs: 500, mediaEndMs: 1000 },
			],
		});
	});

	it("builds sync segments from overlapping active periods", () => {
		const screen = new ActiveMediaClock();
		const webcam = new ActiveMediaClock();
		webcam.start(800);
		screen.start(1000);
		screen.pause(1500);
		webcam.pause(1600);
		webcam.resume(2400);
		screen.resume(2500);
		screen.stop(3000);
		webcam.stop(3100);

		expect(buildWebcamSyncMetadata(screen.snapshot(), webcam.snapshot())).toEqual({
			schemaVersion: 1,
			segments: [
				{ screenStartMs: 0, screenEndMs: 500, webcamStartMs: 200, webcamEndMs: 700 },
				{ screenStartMs: 500, screenEndMs: 1000, webcamStartMs: 900, webcamEndMs: 1400 },
			],
		});
	});
});
