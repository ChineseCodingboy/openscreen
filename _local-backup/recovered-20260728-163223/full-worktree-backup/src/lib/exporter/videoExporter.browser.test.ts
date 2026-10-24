import { describe, expect, it, vi } from "vitest";
import sampleVideoUrl from "../../../tests/fixtures/sample.webm?url";
import { BackgroundLoadError } from "../wallpaper";
import { FrameRenderer } from "./frameRenderer";
import type { ExportProgress } from "./types";
import { VideoExporter } from "./videoExporter";

describe("VideoExporter (real browser)", () => {
	it("exports a valid MP4 blob from a real video", async () => {
		const progressEvents: ExportProgress[] = [];

		const exporter = new VideoExporter({
			videoUrl: sampleVideoUrl,
			width: 320,
			height: 180,
			frameRate: 15,
			bitrate: 1_000_000,
			wallpaper: "#1a1a2e",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			onProgress: (p) => progressEvents.push(p),
		});

		const result = await exporter.export();

		expect(result.success, result.error).toBe(true);
		expect(result.blob).toBeInstanceOf(Blob);

		const buf = await result.blob!.arrayBuffer();
		const bytes = new Uint8Array(buf);
		const ftyp = new TextDecoder().decode(bytes.slice(4, 8));
		expect(ftyp).toBe("ftyp");

		expect(result.blob!.size).toBeGreaterThan(1024);

		expect(progressEvents.length).toBeGreaterThan(0);

		const finalizing = progressEvents.filter((p) => p.phase === "finalizing");
		expect(finalizing.length).toBeGreaterThan(0);
		expect(finalizing.at(-1)!.percentage).toBe(100);
	});

	it("renders every speed-adjusted media frame from the background when video is hidden", async () => {
		const renderBackground = vi.spyOn(FrameRenderer.prototype, "renderBackgroundFrame");
		try {
			const exporter = new VideoExporter({
				videoUrl: sampleVideoUrl,
				width: 320,
				height: 180,
				frameRate: 30,
				bitrate: 1_000_000,
				wallpaper: "#1a1a2e",
				zoomRegions: [],
				videoTrackClips: [{ id: "hidden", startMs: 0, endMs: 1000, sourceStartMs: 0 }],
				videoTrackHidden: true,
				speedRegions: [{ id: "fast", startMs: 0, endMs: 1000, speed: 2 }],
				showShadow: false,
				shadowIntensity: 0,
				showBlur: false,
				cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			});

			const result = await exporter.export();

			expect(result.success, result.error).toBe(true);
			expect(result.diagnostics?.frameCount).toBe(15);
			expect(renderBackground).toHaveBeenCalledTimes(15);
		} finally {
			renderBackground.mockRestore();
		}
	});

	it("exports successfully with an image wallpaper (served by Vite dev server)", async () => {
		const exporter = new VideoExporter({
			videoUrl: sampleVideoUrl,
			width: 320,
			height: 180,
			frameRate: 15,
			bitrate: 1_000_000,
			wallpaper: "/wallpapers/wallpaper1.jpg",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		});

		const result = await exporter.export();
		expect(result.success, result.error).toBe(true);
		expect(result.blob!.size).toBeGreaterThan(1024);
	});

	it("throws BackgroundLoadError when wallpaper fails to load (no silent black fallback)", async () => {
		const exporter = new VideoExporter({
			videoUrl: sampleVideoUrl,
			width: 320,
			height: 180,
			frameRate: 15,
			bitrate: 1_000_000,
			wallpaper: "/wallpapers/does-not-exist.jpg",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		});

		const rejection = exporter.export();
		await expect(rejection).rejects.toBeInstanceOf(BackgroundLoadError);
		await expect(rejection).rejects.toMatchObject({
			url: expect.stringContaining("does-not-exist"),
		});
	});
});
