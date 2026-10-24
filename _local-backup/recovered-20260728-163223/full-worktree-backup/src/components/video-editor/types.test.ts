import { describe, expect, it } from "vitest";
import { createDefaultAudioTrackClips, reconcileAudioTrackClips } from "./types";

describe("createDefaultAudioTrackClips", () => {
	it("creates one clip per physical track with 0-based audio ordinals", () => {
		expect(
			createDefaultAudioTrackClips(5000, [
				{ ordinal: 0, role: "system" },
				{ ordinal: 1, role: "microphone" },
			]),
		).toEqual([
			expect.objectContaining({
				id: "audio-system-0",
				role: "system",
				trackOrdinal: 0,
				startMs: 0,
				endMs: 5000,
			}),
			expect.objectContaining({
				id: "audio-microphone-1",
				role: "microphone",
				trackOrdinal: 1,
			}),
		]);
	});

	it("maps a microphone-only recording to ordinal zero", () => {
		expect(createDefaultAudioTrackClips(5000, [{ ordinal: 0, role: "microphone" }])).toEqual([
			expect.objectContaining({ role: "microphone", trackOrdinal: 0 }),
		]);
	});

	it("migrates the v4 requested-source list to one mixed physical track", () => {
		expect(createDefaultAudioTrackClips(5000, ["system", "microphone"])).toEqual([
			expect.objectContaining({ role: "mixed", trackOrdinal: 0 }),
		]);
	});

	it("creates no clips without stream metadata so embedded audio stays audible", () => {
		expect(createDefaultAudioTrackClips(5000)).toEqual([]);
		expect(createDefaultAudioTrackClips(5000, [])).toEqual([]);
	});
});

describe("reconcileAudioTrackClips", () => {
	it("remaps a legacy microphone-only clip to physical ordinal zero", () => {
		expect(
			reconcileAudioTrackClips(
				[
					{
						id: "microphone",
						role: "microphone",
						trackOrdinal: 1,
						startMs: 1000,
						endMs: 4000,
						sourceStartMs: 500,
						muted: true,
						gain: 0.4,
					},
				],
				[{ ordinal: 0, role: "microphone" }],
			),
		).toEqual([
			expect.objectContaining({
				role: "microphone",
				trackOrdinal: 0,
				startMs: 1000,
				endMs: 4000,
				sourceStartMs: 500,
				muted: true,
				gain: 0.4,
			}),
		]);
	});

	it("folds broken v4 dual controls onto the one mixed physical track", () => {
		const base = {
			startMs: 0,
			endMs: 5000,
			sourceStartMs: 0,
			muted: false,
			gain: 0.5,
		};
		expect(
			reconcileAudioTrackClips(
				[
					{ ...base, id: "system", role: "system", trackOrdinal: 0 },
					{ ...base, id: "microphone", role: "microphone", trackOrdinal: 1 },
				],
				[{ ordinal: 0, role: "mixed" }],
			),
		).toEqual([expect.objectContaining({ role: "mixed", trackOrdinal: 0, gain: 1, muted: false })]);
	});

	it("preserves timeline cuts while folding duplicate legacy controls", () => {
		const spans = [
			{ startMs: 0, endMs: 2000, sourceStartMs: 0, linkGroupId: "left" },
			{ startMs: 2000, endMs: 4000, sourceStartMs: 5000, linkGroupId: "right" },
		];
		const clips = spans.flatMap((span, spanIndex) => [
			{
				...span,
				id: `system-${spanIndex}`,
				role: "system" as const,
				trackOrdinal: 0,
				muted: false,
				gain: 1,
			},
			{
				...span,
				id: `microphone-${spanIndex}`,
				role: "microphone" as const,
				trackOrdinal: 1,
				muted: false,
				gain: 1,
			},
		]);

		const reconciled = reconcileAudioTrackClips(clips, [{ ordinal: 0, role: "mixed" }]);
		expect(reconciled).toHaveLength(2);
		expect(
			reconciled.map(({ startMs, endMs, sourceStartMs }) => ({
				startMs,
				endMs,
				sourceStartMs,
			})),
		).toEqual(
			spans.map(({ startMs, endMs, sourceStartMs }) => ({
				startMs,
				endMs,
				sourceStartMs,
			})),
		);
	});
});
