import { describe, expect, it } from "vitest";
import {
	normalizeAudioStreams,
	normalizeAudioTracks,
	normalizeProjectMedia,
	normalizeRecordingSession,
	reconcileRecordedAudioTracks,
} from "./recordingSession";

describe("normalizeAudioStreams", () => {
	it("keeps valid sources in captured order", () => {
		expect(normalizeAudioStreams(["system", "microphone"])).toEqual(["system", "microphone"]);
		expect(normalizeAudioStreams(["microphone"])).toEqual(["microphone"]);
	});

	it("drops junk entries and duplicates", () => {
		expect(normalizeAudioStreams(["system", "system", "webcam", 3, null, "microphone"])).toEqual([
			"system",
			"microphone",
		]);
	});

	it("returns undefined for missing, empty, or invalid values", () => {
		expect(normalizeAudioStreams(undefined)).toBeUndefined();
		expect(normalizeAudioStreams("system")).toBeUndefined();
		expect(normalizeAudioStreams([])).toBeUndefined();
		expect(normalizeAudioStreams(["webcam"])).toBeUndefined();
	});
});

describe("normalizeAudioTracks", () => {
	it("keeps unique physical tracks in ordinal order", () => {
		expect(
			normalizeAudioTracks([
				{ ordinal: 1, role: "microphone" },
				{ ordinal: 0, role: "system" },
				{ ordinal: 0, role: "unknown" },
			]),
		).toEqual([
			{ ordinal: 0, role: "system" },
			{ ordinal: 1, role: "microphone" },
		]);
	});
});

describe("reconcileRecordedAudioTracks", () => {
	it("folds requested system and microphone sources into one physical mixed track", () => {
		expect(reconcileRecordedAudioTracks(1, undefined, ["system", "microphone"])).toEqual([
			{ ordinal: 0, role: "mixed" },
		]);
	});

	it("preserves independent roles when the file really has two audio tracks", () => {
		expect(reconcileRecordedAudioTracks(2, undefined, ["system", "microphone"])).toEqual([
			{ ordinal: 0, role: "system" },
			{ ordinal: 1, role: "microphone" },
		]);
	});
});

describe("normalizeProjectMedia audio streams", () => {
	it("round-trips audioTracks", () => {
		const media = normalizeProjectMedia({
			screenVideoPath: "/tmp/recording.mp4",
			audioTracks: [{ ordinal: 0, role: "microphone" }],
		});
		expect(media?.audioTracks).toEqual([{ ordinal: 0, role: "microphone" }]);
	});

	it("omits audioTracks when absent or invalid", () => {
		expect(normalizeProjectMedia({ screenVideoPath: "/tmp/recording.mp4" })).not.toHaveProperty(
			"audioTracks",
		);
		expect(
			normalizeProjectMedia({ screenVideoPath: "/tmp/recording.mp4", audioTracks: ["nope"] }),
		).not.toHaveProperty("audioTracks");
	});

	it("retains ambiguous v4 dual-source metadata until the file is inspected", () => {
		expect(
			normalizeProjectMedia({
				screenVideoPath: "/tmp/recording.mp4",
				audioStreams: ["system", "microphone"],
			}),
		).toEqual({
			screenVideoPath: "/tmp/recording.mp4",
			audioStreams: ["system", "microphone"],
		});
	});
});

describe("normalizeProjectMedia webcam sync", () => {
	it("round-trips valid sync metadata when a webcam asset exists", () => {
		expect(
			normalizeProjectMedia({
				screenVideoPath: "/tmp/recording.mp4",
				webcamVideoPath: "/tmp/recording-webcam.webm",
				webcamSync: {
					schemaVersion: 1,
					segments: [
						{ screenStartMs: 0, screenEndMs: 1000, webcamStartMs: 250, webcamEndMs: 1250 },
					],
				},
			}),
		).toMatchObject({
			webcamSync: {
				schemaVersion: 1,
				segments: [{ screenStartMs: 0, screenEndMs: 1000, webcamStartMs: 250, webcamEndMs: 1250 }],
			},
		});
	});

	it("drops sync metadata without a corresponding webcam asset", () => {
		expect(
			normalizeProjectMedia({
				screenVideoPath: "/tmp/recording.mp4",
				webcamSync: {
					schemaVersion: 1,
					segments: [{ screenStartMs: 0, screenEndMs: 1000, webcamStartMs: 0, webcamEndMs: 1000 }],
				},
			}),
		).not.toHaveProperty("webcamSync");
	});

	it("keeps legacy sessions valid without adding persisted sync data", () => {
		const media = normalizeProjectMedia({
			screenVideoPath: "/tmp/recording.mp4",
			webcamVideoPath: "/tmp/recording-webcam.webm",
		});
		expect(media).not.toHaveProperty("webcamSync");
	});
});

describe("normalizeRecordingSession audio streams", () => {
	it("migrates audioStreams from a session manifest", () => {
		const session = normalizeRecordingSession({
			screenVideoPath: "/tmp/recording.mp4",
			createdAt: 123,
			audioStreams: ["system", "microphone"],
		});
		expect(session?.audioTracks).toBeUndefined();
		expect(session?.audioStreams).toEqual(["system", "microphone"]);
		expect(session?.createdAt).toBe(123);
	});
});
