import { describe, expect, it } from "vitest";
import {
	groupAudioTrackClips,
	splitLinkedMedia,
	splitMediaClip,
	splitTimedRegion,
} from "./timelineCommands";

describe("timeline cut commands", () => {
	it("splits media without a source-time gap", () => {
		const split = splitMediaClip(
			{ id: "video", startMs: 1000, endMs: 5000, sourceStartMs: 8000 },
			3000,
			(side) => `video-${side}`,
		);
		expect(split).toEqual([
			{ id: "video-left", startMs: 1000, endMs: 3000, sourceStartMs: 8000 },
			{ id: "video-right", startMs: 3000, endMs: 5000, sourceStartMs: 10000 },
		]);
	});

	it("does not create tiny edge fragments", () => {
		expect(
			splitMediaClip(
				{ id: "video", startMs: 0, endMs: 1000, sourceStartMs: 0 },
				20,
				(side) => side,
			),
		).toBeNull();
	});

	it("splits linked video and both mixed-audio streams atomically", () => {
		const result = splitLinkedMedia(
			[{ id: "video", startMs: 0, endMs: 4000, sourceStartMs: 0 }],
			[
				{
					id: "system",
					role: "system",
					trackOrdinal: 0,
					startMs: 0,
					endMs: 4000,
					sourceStartMs: 0,
					muted: false,
					gain: 1,
				},
				{
					id: "mic",
					role: "microphone",
					trackOrdinal: 1,
					startMs: 0,
					endMs: 4000,
					sourceStartMs: 0,
					muted: false,
					gain: 1,
				},
			],
			1500,
			(kind, id, side) => `${kind}-${id}-${side}`,
		);
		expect(result.videoTrackClips).toHaveLength(2);
		expect(result.audioTrackClips).toHaveLength(4);
		expect(groupAudioTrackClips(result.audioTrackClips)).toHaveLength(2);
		expect(result.audioTrackClips.filter((clip) => clip.startMs === 1500)).toHaveLength(2);
	});

	it("splits a microphone-only linked group atomically", () => {
		const result = splitLinkedMedia(
			[{ id: "video", startMs: 0, endMs: 4000, sourceStartMs: 0 }],
			[
				{
					id: "mic",
					role: "microphone",
					trackOrdinal: 0,
					startMs: 0,
					endMs: 4000,
					sourceStartMs: 0,
					muted: false,
					gain: 1,
				},
			],
			1500,
			(kind, id, side) => `${kind}-${id}-${side}`,
		);
		expect(result.videoTrackClips).toHaveLength(2);
		expect(result.audioTrackClips).toHaveLength(2);
		expect(result.audioTrackClips.map((clip) => clip.trackOrdinal)).toEqual([0, 0]);
		expect(result.audioTrackClips.filter((clip) => clip.startMs === 1500)).toHaveLength(1);
	});

	it("duplicates effect payload when cutting a timed region", () => {
		const split = splitTimedRegion(
			{ id: "speed", startMs: 0, endMs: 2000, speed: 1.5 },
			1000,
			(side) => `speed-${side}`,
		);
		expect(split?.map((region) => region.speed)).toEqual([1.5, 1.5]);
	});
});
