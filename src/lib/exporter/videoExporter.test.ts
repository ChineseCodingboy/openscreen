import { describe, expect, it } from "vitest";
import {
	createExportPlan,
	getSourceCopyFastPathBlockers,
	isSourceCopyFastPathEligible,
	selectExportFrameRate,
	shouldExportAudio,
	type VideoExporterConfig,
} from "./videoExporter";

function createConfig(overrides: Partial<VideoExporterConfig> = {}): VideoExporterConfig {
	return {
		videoUrl: "recording.mp4",
		width: 1920,
		height: 1080,
		frameRate: 60,
		bitrate: 30_000_000,
		wallpaper: "#000000",
		zoomRegions: [],
		trimRegions: [],
		speedRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		showBlur: false,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		...overrides,
	};
}

describe("shouldExportAudio", () => {
	it("keeps embedded audio unless every configured clip is silent", () => {
		expect(shouldExportAudio(true)).toBe(true);
		expect(shouldExportAudio(false)).toBe(false);
		expect(
			shouldExportAudio(true, [
				{
					id: "mixed",
					role: "mixed",
					trackOrdinal: 0,
					startMs: 0,
					endMs: 1000,
					sourceStartMs: 0,
					muted: true,
					gain: 1,
				},
			]),
		).toBe(false);
	});
});

describe("isSourceCopyFastPathEligible", () => {
	it("allows a no-op MP4 export at source dimensions", () => {
		expect(
			isSourceCopyFastPathEligible(createConfig(), {
				width: 1920,
				height: 1080,
			}),
		).toBe(true);
	});

	it("rejects timeline edits and frame-level effects", () => {
		const videoInfo = { width: 1920, height: 1080 };

		expect(
			isSourceCopyFastPathEligible(
				createConfig({ trimRegions: [{ id: "trim", startMs: 100, endMs: 200 }] }),
				videoInfo,
			),
		).toBe(false);
		expect(
			isSourceCopyFastPathEligible(
				createConfig({
					speedRegions: [{ id: "speed", startMs: 100, endMs: 200, speed: 1.5 }],
				}),
				videoInfo,
			),
		).toBe(false);
		expect(
			isSourceCopyFastPathEligible(
				createConfig({
					zoomRegions: [
						{
							id: "zoom",
							startMs: 100,
							endMs: 200,
							depth: 2,
							focus: { cx: 0.5, cy: 0.5 },
						},
					],
				}),
				videoInfo,
			),
		).toBe(false);
		expect(isSourceCopyFastPathEligible(createConfig({ showBlur: true }), videoInfo)).toBe(false);
	});

	it("rejects resizing and overlays", () => {
		const videoInfo = { width: 1920, height: 1080 };

		expect(isSourceCopyFastPathEligible(createConfig({ width: 1280 }), videoInfo)).toBe(false);
		expect(
			isSourceCopyFastPathEligible(
				createConfig({
					cursorScale: 2,
				}),
				videoInfo,
			),
		).toBe(false);
		expect(
			isSourceCopyFastPathEligible(
				createConfig({
					cursorScale: 2,
					cursorRecordingData: {
						version: 2,
						provider: "native",
						assets: [
							{
								id: "cursor",
								platform: "win32",
								imageDataUrl: "data:image/png;base64,AA==",
								width: 32,
								height: 32,
								hotspotX: 0,
								hotspotY: 0,
							},
						],
						samples: [{ timeMs: 0, cx: 0.5, cy: 0.5, visible: true, assetId: "cursor" }],
					},
				}),
				videoInfo,
			),
		).toBe(false);
	});
});

describe("getSourceCopyFastPathBlockers", () => {
	it("reports the source-size mismatch that blocks copy-only export", () => {
		expect(
			getSourceCopyFastPathBlockers(createConfig({ height: 1080 }), {
				width: 1920,
				height: 1032,
			}),
		).toContain("output-size 1920x1080 differs from source 1920x1032");
	});
});

describe("createExportPlan", () => {
	it("uses packet remux for keyframe-aligned cut-only edits", () => {
		const config = createConfig({
			videoTrackClips: [
				{ id: "left", startMs: 0, endMs: 1000, sourceStartMs: 0 },
				{ id: "right", startMs: 1000, endMs: 2000, sourceStartMs: 3000 },
			],
		});
		expect(
			createExportPlan(
				config,
				{ width: 1920, height: 1080, duration: 4 },
				{
					packetBoundariesAreKeyframes: true,
				},
			).path,
		).toBe("packet-remux");
	});

	it("uses direct transcode for precise non-keyframe cuts without visual effects", () => {
		const config = createConfig({
			videoTrackClips: [
				{ id: "left", startMs: 0, endMs: 1000, sourceStartMs: 125 },
				{ id: "right", startMs: 1000, endMs: 2000, sourceStartMs: 2500 },
			],
		});
		expect(createExportPlan(config, { width: 1920, height: 1080, duration: 4 }).path).toBe(
			"direct-transcode",
		);
	});

	it("uses the lightweight transcode path for auto captions at every output size", () => {
		const captions = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 1000,
				type: "text" as const,
				content: "Fast captions",
				annotationSource: "auto-caption" as const,
				position: { x: 4, y: 86 },
				size: { width: 92, height: 12 },
				style: {
					color: "#fff",
					backgroundColor: "transparent",
					fontSize: 24,
					fontFamily: "Inter",
					fontWeight: "normal" as const,
					fontStyle: "normal" as const,
					textDecoration: "none" as const,
					textAlign: "center" as const,
				},
				zIndex: 1,
			},
		];
		for (const output of [
			{ width: 1280, height: 720 },
			{ width: 1920, height: 1080 },
			{ width: 3840, height: 2160 },
		]) {
			expect(
				createExportPlan(createConfig({ ...output, annotationRegions: captions }), {
					width: 1920,
					height: 1080,
				}).path,
			).toBe("direct-transcode");
		}
	});

	it("keeps manual annotations on the full compositor", () => {
		expect(
			createExportPlan(
				createConfig({
					annotationRegions: [
						{
							id: "manual",
							startMs: 0,
							endMs: 1000,
							type: "text",
							content: "Manual",
							position: { x: 0, y: 0 },
							size: { width: 50, height: 20 },
							style: {
								color: "#fff",
								backgroundColor: "transparent",
								fontSize: 24,
								fontFamily: "Inter",
								fontWeight: "normal",
								fontStyle: "normal",
								textDecoration: "none",
								textAlign: "center",
							},
							zIndex: 1,
						},
					],
				}),
				{ width: 1920, height: 1080 },
			).path,
		).toBe("composite");
	});

	it("uses the lightweight caption renderer for static layout effects", () => {
		expect(
			createExportPlan(
				createConfig({
					width: 1080,
					height: 1080,
					padding: 50,
					borderRadius: 24,
					showShadow: true,
					shadowIntensity: 0.5,
					showBlur: true,
					cropRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
					annotationRegions: [
						{
							id: "caption",
							startMs: 0,
							endMs: 1000,
							type: "text",
							content: "Caption",
							annotationSource: "auto-caption",
							position: { x: 4, y: 86 },
							size: { width: 92, height: 12 },
							style: {
								color: "#fff",
								backgroundColor: "transparent",
								fontSize: 24,
								fontFamily: "Inter",
								fontWeight: "normal",
								fontStyle: "normal",
								textDecoration: "none",
								textAlign: "center",
							},
							zIndex: 1,
						},
					],
				}),
				{ width: 1920, height: 1080 },
			).path,
		).toBe("direct-transcode");
	});

	it("requires composite rendering for visual effects and timeline gaps", () => {
		expect(
			createExportPlan(createConfig({ padding: 40 }), {
				width: 1920,
				height: 1080,
			}).path,
		).toBe("composite");
		expect(
			createExportPlan(
				createConfig({
					videoTrackClips: [{ id: "moved", startMs: 500, endMs: 1500, sourceStartMs: 0 }],
				}),
				{ width: 1920, height: 1080 },
			).path,
		).toBe("composite");
	});

	it("uses composite CFR resampling for speed regions on the media timeline", () => {
		const config = createConfig({
			videoTrackClips: [{ id: "clip", startMs: 0, endMs: 4000, sourceStartMs: 0 }],
			speedRegions: [{ id: "fast", startMs: 1000, endMs: 3000, speed: 2 }],
		});

		expect(createExportPlan(config, { width: 1920, height: 1080, duration: 4 }).path).toBe(
			"composite",
		);
	});
});

describe("selectExportFrameRate", () => {
	it("does not synthesize duplicate frames above the source cadence", () => {
		expect(selectExportFrameRate({ frameRate: 30, maxFrameRate: 30 }, 23.976, "composite")).toBe(
			23.976,
		);
		expect(selectExportFrameRate({ frameRate: 60, maxFrameRate: 60 }, 27.76, "composite")).toBe(
			27.76,
		);
	});

	it("retains source cadence for direct and packet export paths", () => {
		expect(selectExportFrameRate({ frameRate: 60 }, 23.976, "direct-transcode")).toBe(23.976);
		expect(selectExportFrameRate({ frameRate: 60 }, 27.76, "packet-remux")).toBe(27.76);
	});

	it("honors an explicit maximum on composite output", () => {
		expect(selectExportFrameRate({ frameRate: 60, maxFrameRate: 30 }, 60, "composite")).toBe(30);
	});
});
