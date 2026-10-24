import { describe, expect, it } from "vitest";
import {
	areExplicitPreviewAudioTracksReady,
	areMediaSpansContinuous,
	createFollowerBoundaryKey,
	createPreviewTimePublisher,
	resolvePreviewDrift,
	resolveVideoMasterAdvance,
	shouldMuteEmbeddedPreviewAudio,
	shouldPrepareLegacySupplementalAudio,
	sourceMsToTimelineMs,
	videoElementOwnsPreviewTransport,
} from "./previewTransport";

describe("preview transport", () => {
	it("keeps source-contiguous cut clips in one playback interval", () => {
		expect(
			areMediaSpansContinuous(
				{ id: "left", startMs: 0, endMs: 5000, sourceStartMs: 1000 },
				{ id: "right", startMs: 5000, endMs: 9000, sourceStartMs: 6000 },
			),
		).toBe(true);
	});

	it("rejects gaps and source discontinuities", () => {
		expect(
			areMediaSpansContinuous(
				{ id: "left", startMs: 0, endMs: 5000, sourceStartMs: 0 },
				{ id: "right", startMs: 5100, endMs: 9000, sourceStartMs: 5000 },
			),
		).toBe(false);
	});

	it("nudges small drift and seeks only beyond 250ms", () => {
		expect(resolvePreviewDrift(0.04).type).toBe("none");
		expect(resolvePreviewDrift(-0.1)).toEqual({ type: "rate", rateMultiplier: 1.02 });
		expect(resolvePreviewDrift(0.1)).toEqual({ type: "rate", rateMultiplier: 0.98 });
		expect(resolvePreviewDrift(0.251).type).toBe("seek");
	});

	it("maps source media time onto edited timeline time", () => {
		expect(
			sourceMsToTimelineMs({ id: "clip", startMs: 8000, endMs: 12000, sourceStartMs: 2000 }, 2750),
		).toBe(8750);
	});

	it("publishes React snapshots no more than 20 times per second", () => {
		const published: Array<{ timelineMs: number; sourceMs: number }> = [];
		const publish = createPreviewTimePublisher((clock) => published.push(clock));

		expect(publish({ timelineMs: 0, sourceMs: 1000 }, 0)).toBe(true);
		expect(publish({ timelineMs: 16, sourceMs: 1016 }, 16)).toBe(false);
		expect(publish({ timelineMs: 49, sourceMs: 1049 }, 49)).toBe(false);
		expect(publish({ timelineMs: 50, sourceMs: 1050 }, 50)).toBe(true);
		expect(publish({ timelineMs: 51, sourceMs: 1051 }, 51, true)).toBe(true);
		expect(published.map((clock) => clock.timelineMs)).toEqual([0, 50, 51]);
	});

	it("keeps an explicitly silent edit muted while track extraction is pending", () => {
		expect(
			shouldMuteEmbeddedPreviewAudio(
				[
					{ muted: true, gain: 1 },
					{ muted: false, gain: 0 },
				],
				false,
			),
		).toBe(true);
		expect(shouldMuteEmbeddedPreviewAudio([{ muted: false, gain: 1 }], false)).toBe(false);
		expect(shouldMuteEmbeddedPreviewAudio([{ muted: false, gain: 1 }], true)).toBe(true);
	});

	it("keeps parent transport playing when the video pauses through a timeline gap", () => {
		expect(videoElementOwnsPreviewTransport(true)).toBe(false);
		expect(videoElementOwnsPreviewTransport(false)).toBe(true);
	});

	it("skips legacy supplemental extraction when explicit audio tracks exist", () => {
		expect(shouldPrepareLegacySupplementalAudio(true)).toBe(false);
		expect(shouldPrepareLegacySupplementalAudio(false)).toBe(true);
	});

	it("waits for every explicit audio element to become playable", () => {
		expect(areExplicitPreviewAudioTracksReady([0, 1], new Set([0]))).toBe(false);
		expect(areExplicitPreviewAudioTracksReady([0, 1], new Set([0, 1]))).toBe(true);
		expect(areExplicitPreviewAudioTracksReady([], new Set())).toBe(false);
	});

	it("changes the follower key at clip, silence, speed, and source-activity boundaries", () => {
		const clips = [
			{ id: "a", trackOrdinal: 0, startMs: 0, endMs: 1000, muted: false, gain: 1 },
			{ id: "b", trackOrdinal: 0, startMs: 1500, endMs: 2500, muted: true, gain: 1 },
		];
		const speeds = [{ startMs: 2000, endMs: 3000, speed: 2 }];
		const activeClip = createFollowerBoundaryKey(999, true, clips, speeds);

		expect(createFollowerBoundaryKey(500, true, clips, speeds)).toBe(activeClip);
		expect(createFollowerBoundaryKey(1000, true, clips, speeds)).not.toBe(activeClip);
		expect(createFollowerBoundaryKey(1500, true, clips, speeds)).not.toBe(
			createFollowerBoundaryKey(1499, true, clips, speeds),
		);
		expect(createFollowerBoundaryKey(2000, true, clips, speeds)).not.toBe(
			createFollowerBoundaryKey(1999, true, clips, speeds),
		);
		expect(createFollowerBoundaryKey(999, false, clips, speeds)).not.toBe(activeClip);
	});
});

describe("resolveVideoMasterAdvance", () => {
	const clip = { id: "a", startMs: 1000, endMs: 5000, sourceStartMs: 3000 };

	it("maps the presented video frame to timeline time inside a clip", () => {
		expect(
			resolveVideoMasterAdvance({
				previousTimelineMs: 1200,
				videoSourceMs: 3250,
				activeClip: clip,
				nextClip: null,
			}),
		).toEqual({ timelineMs: 1250, videoAction: { type: "none" } });
	});

	it("keeps the playhead monotonic when the decoder reports a stale frame", () => {
		expect(
			resolveVideoMasterAdvance({
				previousTimelineMs: 1300,
				videoSourceMs: 3250,
				activeClip: clip,
				nextClip: null,
			}),
		).toEqual({ timelineMs: 1300, videoAction: { type: "none" } });
	});

	it("crosses a source-contiguous boundary without seeking", () => {
		const next = { id: "b", startMs: 5000, endMs: 9000, sourceStartMs: 7000 };
		expect(
			resolveVideoMasterAdvance({
				previousTimelineMs: 4990,
				videoSourceMs: 7010,
				activeClip: clip,
				nextClip: next,
			}),
		).toEqual({ timelineMs: 5010, videoAction: { type: "none" } });
	});

	it("seeks to the next clip's source position across a cut", () => {
		const next = { id: "b", startMs: 5000, endMs: 9000, sourceStartMs: 12000 };
		expect(
			resolveVideoMasterAdvance({
				previousTimelineMs: 4990,
				videoSourceMs: 7020,
				activeClip: clip,
				nextClip: next,
			}),
		).toEqual({ timelineMs: 5000, videoAction: { type: "seek", seekToSourceMs: 12000 } });
	});

	it("pauses at the end of the video track", () => {
		expect(
			resolveVideoMasterAdvance({
				previousTimelineMs: 4990,
				videoSourceMs: 7100,
				activeClip: clip,
				nextClip: null,
			}),
		).toEqual({ timelineMs: 5000, videoAction: { type: "pause" } });
	});

	it("pauses when there is no active clip", () => {
		expect(
			resolveVideoMasterAdvance({
				previousTimelineMs: 4990,
				videoSourceMs: 7100,
				activeClip: null,
				nextClip: null,
			}),
		).toEqual({ timelineMs: 4990, videoAction: { type: "pause" } });
	});
});
