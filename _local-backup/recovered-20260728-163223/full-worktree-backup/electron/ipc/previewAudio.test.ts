import { describe, expect, it, vi } from "vitest";
import {
	parseAfinfoAudioTrackBitrates,
	resolveSupplementalTrackArrayIndex,
	runDedupedPreviewAudioPreparation,
} from "./previewAudio";

describe("parseAfinfoAudioTrackBitrates", () => {
	it("reads one bitrate per track section", () => {
		const output = [
			"File: recording.mp4",
			"----",
			"Data format: 2 ch, 48000 Hz, aac",
			"num channels: 2",
			"audio packets: 100",
			"bit rate: 192000 bits per second",
			"----",
			"Data format: 1 ch, 48000 Hz, aac",
			"num channels: 1",
			"audio packets: 100",
			"bit rate: 96000 bits per second",
		].join("\n");
		expect(parseAfinfoAudioTrackBitrates(output)).toEqual([192000, 96000]);
	});

	it("ignores afinfo's trailing divider instead of inventing a silent track", () => {
		const output = [
			"File: recording.mp4",
			"----",
			"Data format: 2 ch, 48000 Hz, aac",
			"audio packets: 665",
			"bit rate: 245691 bits per second",
			"----",
		].join("\n");
		expect(parseAfinfoAudioTrackBitrates(output)).toEqual([245691]);
	});

	it("returns an empty list when no track sections exist", () => {
		expect(parseAfinfoAudioTrackBitrates("File: recording.mp4")).toEqual([]);
	});
});

describe("resolveSupplementalTrackArrayIndex", () => {
	it("extracts an explicitly requested track even on a single-track file", () => {
		expect(resolveSupplementalTrackArrayIndex([96000], 0)).toBe(0);
	});

	it("returns null for a requested track that does not exist", () => {
		expect(resolveSupplementalTrackArrayIndex([96000], 1)).toBeNull();
		expect(resolveSupplementalTrackArrayIndex([96000], -1)).toBeNull();
		expect(resolveSupplementalTrackArrayIndex([], 0)).toBeNull();
	});

	it("resolves requested tracks on multi-track files by 0-based ordinal", () => {
		expect(resolveSupplementalTrackArrayIndex([192000, 96000], 0)).toBe(0);
		expect(resolveSupplementalTrackArrayIndex([192000, 96000], 1)).toBe(1);
	});

	it("skips the legacy no-index path unless there are multiple tracks", () => {
		expect(resolveSupplementalTrackArrayIndex([96000])).toBeNull();
		expect(resolveSupplementalTrackArrayIndex([])).toBeNull();
	});

	it("picks the most substantial non-embedded track on the legacy no-index path", () => {
		expect(resolveSupplementalTrackArrayIndex([4000, 96000])).toBe(1);
		expect(resolveSupplementalTrackArrayIndex([192000, 96000])).toBe(1);
		expect(resolveSupplementalTrackArrayIndex([192000, 96000, 128000])).toBe(2);
	});
});

describe("runDedupedPreviewAudioPreparation", () => {
	it("shares concurrent work for the same resolved source track", async () => {
		const inFlight = new Map<string, Promise<string>>();
		let resolvePreparation: (value: string) => void = () => undefined;
		const prepare = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolvePreparation = resolve;
				}),
		);

		const first = runDedupedPreviewAudioPreparation(inFlight, "source.mp4\0track-1", prepare);
		const second = runDedupedPreviewAudioPreparation(inFlight, "source.mp4\0track-1", prepare);
		await Promise.resolve();

		expect(second).toBe(first);
		expect(prepare).toHaveBeenCalledTimes(1);
		resolvePreparation("file:///preview.m4a");
		await expect(first).resolves.toBe("file:///preview.m4a");
		expect(inFlight.size).toBe(0);
	});

	it("clears failed work so a later call can retry", async () => {
		const inFlight = new Map<string, Promise<string>>();
		const key = "source.mp4\0track-1";

		await expect(
			runDedupedPreviewAudioPreparation(inFlight, key, async () => {
				throw new Error("conversion failed");
			}),
		).rejects.toThrow("conversion failed");
		expect(inFlight.size).toBe(0);
		await expect(
			runDedupedPreviewAudioPreparation(inFlight, key, async () => "file:///retry.m4a"),
		).resolves.toBe("file:///retry.m4a");
	});
});
