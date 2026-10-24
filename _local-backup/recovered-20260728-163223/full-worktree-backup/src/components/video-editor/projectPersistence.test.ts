import { describe, expect, it } from "vitest";
import {
	createProjectData,
	createProjectSnapshot,
	hasProjectUnsavedChanges,
	normalizeProjectEditor,
	PROJECT_VERSION,
	resolveProjectMedia,
	validateProjectData,
} from "./projectPersistence";

describe("projectPersistence media compatibility", () => {
	it("accepts legacy projects with a single videoPath", () => {
		const project = {
			version: 1,
			videoPath: "/tmp/screen.webm",
			editor: {},
		};

		expect(validateProjectData(project)).toBe(true);
		expect(resolveProjectMedia(project)).toEqual({
			screenVideoPath: "/tmp/screen.webm",
		});
	});

	it("creates v6 projects with explicit media", () => {
		const project = createProjectData(
			{
				screenVideoPath: "/tmp/screen.webm",
				webcamVideoPath: "/tmp/webcam.webm",
			},
			{
				wallpaper: "/wallpapers/wallpaper1.jpg",
				shadowIntensity: 0,
				showBlur: false,
				motionBlurAmount: 0,
				borderRadius: 0,
				padding: 50,
				cropRegion: { x: 0, y: 0, width: 1, height: 1 },
				zoomRegions: [],
				trimRegions: [],
				speedRegions: [],
				annotationRegions: [],
				aspectRatio: "16:9",
				webcamLayoutPreset: "picture-in-picture",
				webcamMaskShape: "circle",
				webcamMirrored: true,
				webcamSizePreset: 25,
				webcamPosition: null,
				exportQuality: "good",
				exportFormat: "mp4",
				gifFrameRate: 15,
				gifLoop: true,
				gifSizePreset: "medium",
			},
		);

		expect(project.version).toBe(PROJECT_VERSION);
		expect(project.media).toEqual({
			screenVideoPath: "/tmp/screen.webm",
			webcamVideoPath: "/tmp/webcam.webm",
		});
		expect(validateProjectData(project)).toBe(true);
	});

	it("preserves the recording's physical audio layout in project media", () => {
		const media = resolveProjectMedia({
			media: {
				screenVideoPath: "/tmp/screen.mp4",
				audioTracks: [{ ordinal: 0, role: "microphone" }],
			},
		});
		expect(media).toEqual({
			screenVideoPath: "/tmp/screen.mp4",
			audioTracks: [{ ordinal: 0, role: "microphone" }],
		});
	});

	it("migrates v4 global stream indices to 0-based audio-track ordinals", () => {
		const editor = normalizeProjectEditor({
			audioTrackClips: [
				{
					id: "legacy-microphone",
					source: "microphone",
					streamIndex: 2,
					startMs: 0,
					endMs: 1000,
					sourceStartMs: 0,
					muted: false,
					gain: 1,
				} as never,
			],
		});
		expect(editor.audioTrackClips).toEqual([
			expect.objectContaining({ role: "microphone", trackOrdinal: 1 }),
		]);
	});

	it("fills missing timeline tracks while preserving supplied controls", () => {
		const editor = normalizeProjectEditor({
			timelineTracks: [
				{
					id: "custom-video",
					kind: "video",
					order: 4,
					locked: true,
					muted: false,
					hidden: false,
				},
			],
		});
		expect(editor.timelineTracks).toHaveLength(6);
		expect(editor.timelineTracks.find((track) => track.kind === "video")).toMatchObject({
			id: "custom-video",
			locked: true,
		});
		expect(editor.timelineTracks.find((track) => track.kind === "audio")).toBeDefined();
	});

	it("normalizes webcam mask shape values safely", () => {
		expect(normalizeProjectEditor({ webcamMaskShape: "rounded" }).webcamMaskShape).toBe("rounded");
		expect(
			normalizeProjectEditor({ webcamMaskShape: "not-a-real-shape" as never }).webcamMaskShape,
		).toBe("rectangle");
	});

	it("normalizes webcam mirroring safely", () => {
		expect(normalizeProjectEditor({ webcamMirrored: true }).webcamMirrored).toBe(true);
		expect(normalizeProjectEditor({ webcamMirrored: false }).webcamMirrored).toBe(false);
		expect(normalizeProjectEditor({ webcamMirrored: "yes" as never }).webcamMirrored).toBe(false);
	});

	it("keeps legacy smart cursor off while preserving an explicit selection", () => {
		expect(normalizeProjectEditor({}).smartCursorEnabled).toBe(false);
		expect(normalizeProjectEditor({ smartCursorEnabled: true }).smartCursorEnabled).toBe(true);
	});

	it("normalizes synchronized zoom-in duration to the region span", () => {
		const editor = normalizeProjectEditor({
			zoomRegions: [
				{
					id: "auto-1",
					startMs: 100,
					endMs: 500,
					depth: 6,
					focus: { cx: 0.5, cy: 0.5 },
					zoomInDurationMs: 900,
				},
			],
		});

		expect(editor.zoomRegions[0].zoomInDurationMs).toBe(400);
	});

	it("normalizes blur region type and mosaic block size safely", () => {
		const editor = normalizeProjectEditor({
			annotationRegions: [
				{
					id: "annotation-1",
					startMs: 0,
					endMs: 500,
					type: "blur",
					content: "",
					position: { x: 10, y: 10 },
					size: { width: 20, height: 20 },
					style: {
						color: "#fff",
						backgroundColor: "transparent",
						fontSize: 32,
						fontFamily: "Inter",
						fontWeight: "bold",
						fontStyle: "normal",
						textDecoration: "none",
						textAlign: "center",
					},
					zIndex: 1,
					blurData: {
						type: "mosaic",
						shape: "rectangle",
						color: "black",
						intensity: 999,
						blockSize: 999,
					},
				},
				{
					id: "annotation-2",
					startMs: 0,
					endMs: 500,
					type: "blur",
					content: "",
					position: { x: 10, y: 10 },
					size: { width: 20, height: 20 },
					style: {
						color: "#fff",
						backgroundColor: "transparent",
						fontSize: 32,
						fontFamily: "Inter",
						fontWeight: "bold",
						fontStyle: "normal",
						textDecoration: "none",
						textAlign: "center",
					},
					zIndex: 2,
					blurData: {
						type: "invalid" as never,
						shape: "rectangle",
						color: "invalid" as never,
						intensity: 10,
						blockSize: 0,
					},
				},
			],
		});

		expect(editor.annotationRegions[0].blurData?.type).toBe("mosaic");
		expect(editor.annotationRegions[0].blurData?.color).toBe("black");
		expect(editor.annotationRegions[0].blurData?.intensity).toBe(40);
		expect(editor.annotationRegions[0].blurData?.blockSize).toBe(48);
		expect(editor.annotationRegions[1].blurData?.type).toBe("mosaic");
		expect(editor.annotationRegions[1].blurData?.color).toBe("white");
		expect(editor.annotationRegions[1].blurData?.blockSize).toBe(4);
	});

	it("accepts the dual frame webcam layout preset", () => {
		expect(normalizeProjectEditor({ webcamLayoutPreset: "dual-frame" }).webcamLayoutPreset).toBe(
			"dual-frame",
		);
	});

	it("falls back from dual frame to picture in picture for portrait aspect ratios", () => {
		expect(
			normalizeProjectEditor({
				aspectRatio: "9:16",
				webcamLayoutPreset: "dual-frame",
			}).webcamLayoutPreset,
		).toBe("picture-in-picture");
	});

	it("clears webcamPosition when the normalized preset is not picture in picture", () => {
		expect(
			normalizeProjectEditor({
				webcamLayoutPreset: "dual-frame",
				webcamPosition: { cx: 0.2, cy: 0.8 },
			}).webcamPosition,
		).toBeNull();
	});
});

it("creates stable snapshots for identical project state", () => {
	const media = {
		screenVideoPath: "/tmp/screen.webm",
		webcamVideoPath: "/tmp/webcam.webm",
	};
	const editor = normalizeProjectEditor({
		wallpaper: "/wallpapers/wallpaper1.jpg",
		shadowIntensity: 0,
		showBlur: false,
		motionBlurAmount: 0,
		borderRadius: 0,
		padding: 50,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		zoomRegions: [],
		trimRegions: [],
		speedRegions: [],
		annotationRegions: [],
		aspectRatio: "16:9",
		webcamLayoutPreset: "picture-in-picture",
		webcamMaskShape: "circle",
		exportQuality: "good",
		exportFormat: "mp4",
		gifFrameRate: 15,
		gifLoop: true,
		gifSizePreset: "medium",
	});

	expect(createProjectSnapshot(media, editor)).toBe(createProjectSnapshot(media, editor));
});

it("detects unsaved changes from differing snapshots", () => {
	expect(hasProjectUnsavedChanges(null, null)).toBe(false);
	expect(hasProjectUnsavedChanges("same", "same")).toBe(false);
	expect(hasProjectUnsavedChanges("current", "baseline")).toBe(true);
});

describe("wallpaper legacy normalization", () => {
	it("rewrites pre-fix packaged paths (resources/assets/wallpapers/…)", () => {
		const normalized = normalizeProjectEditor({
			wallpaper: "file:///opt/Openscreen/resources/assets/wallpapers/wallpaper5.jpg",
		});
		expect(normalized.wallpaper).toBe("/wallpapers/wallpaper5.jpg");
	});

	it("rewrites new packaged layout (resources/wallpapers/…)", () => {
		const normalized = normalizeProjectEditor({
			wallpaper: "file:///opt/Openscreen/resources/wallpapers/wallpaper3.jpg",
		});
		expect(normalized.wallpaper).toBe("/wallpapers/wallpaper3.jpg");
	});

	it("rewrites unpackaged dev layout (public/wallpapers/…)", () => {
		const normalized = normalizeProjectEditor({
			wallpaper: "file:///home/user/project/public/wallpapers/wallpaper1.jpg",
		});
		expect(normalized.wallpaper).toBe("/wallpapers/wallpaper1.jpg");
	});

	it("rewrites Windows-style file URLs with drive letter", () => {
		const normalized = normalizeProjectEditor({
			wallpaper: "file:///C:/Users/me/openscreen/resources/wallpapers/wallpaper2.jpg",
		});
		expect(normalized.wallpaper).toBe("/wallpapers/wallpaper2.jpg");
	});

	it("leaves canonical relative paths untouched", () => {
		const normalized = normalizeProjectEditor({ wallpaper: "/wallpapers/wallpaper2.jpg" });
		expect(normalized.wallpaper).toBe("/wallpapers/wallpaper2.jpg");
	});

	it("leaves data URIs untouched", () => {
		const dataUri = "data:image/png;base64,AAA";
		expect(normalizeProjectEditor({ wallpaper: dataUri }).wallpaper).toBe(dataUri);
	});

	it("leaves colors and gradients untouched", () => {
		expect(normalizeProjectEditor({ wallpaper: "#1a1a2e" }).wallpaper).toBe("#1a1a2e");
		expect(
			normalizeProjectEditor({ wallpaper: "linear-gradient(90deg, red, blue)" }).wallpaper,
		).toBe("linear-gradient(90deg, red, blue)");
	});

	it("does NOT rewrite user files outside the known install layout", () => {
		const userPath = "file:///home/user/Pictures/wallpapers/wallpaper1.jpg";
		expect(normalizeProjectEditor({ wallpaper: userPath }).wallpaper).toBe(userPath);
	});

	it("falls back to default for bundled paths outside WALLPAPER_PATHS", () => {
		const normalized = normalizeProjectEditor({
			wallpaper: "file:///opt/Openscreen/resources/wallpapers/wallpaper99.jpg",
		});
		expect(normalized.wallpaper).toBe("/wallpapers/wallpaper1.jpg");
	});
});

describe("projectPersistence voiceover (v7)", () => {
	it("round-trips a file-backed voice-over clip and voiceover metadata", () => {
		const editor = normalizeProjectEditor({
			audioTrackClips: [
				{
					id: "audio-voiceover",
					role: "voiceover",
					trackOrdinal: 1000,
					startMs: 0,
					endMs: 60_000,
					sourceStartMs: 0,
					muted: false,
					gain: 1,
					linkGroupId: "voiceover",
					sourcePath: "/tmp/voiceover/recording.abc123.voiceover.1700000000000.wav",
				},
				{
					id: "audio-mixed-0",
					role: "mixed",
					trackOrdinal: 0,
					startMs: 0,
					endMs: 60_000,
					sourceStartMs: 0,
					muted: true,
					gain: 1,
					linkGroupId: "media-screen-1",
				},
			],
			voiceover: {
				audioPath: "/tmp/voiceover/recording.abc123.voiceover.1700000000000.wav",
				voice: "nova",
				style: "energetic",
				polish: false,
				quality: "standard",
				language: "English",
				utterances: [{ startMs: 100, endMs: 2000, text: "打开设置" }],
				generatedAtMs: 1_700_000_000_000,
			},
		});

		const voiceoverClip = editor.audioTrackClips.find((clip) => clip.role === "voiceover");
		expect(voiceoverClip).toMatchObject({
			trackOrdinal: 1000,
			sourcePath: "/tmp/voiceover/recording.abc123.voiceover.1700000000000.wav",
			linkGroupId: "voiceover",
		});
		expect(editor.voiceover).toEqual({
			audioPath: "/tmp/voiceover/recording.abc123.voiceover.1700000000000.wav",
			voice: "nova",
			style: "energetic",
			polish: false,
			quality: "standard",
			language: "English",
			utterances: [{ startMs: 100, endMs: 2000, text: "打开设置" }],
			generatedAtMs: 1_700_000_000_000,
		});

		// Legacy v7 payloads without quality/language get safe defaults.
		const legacy = normalizeProjectEditor({
			voiceover: {
				audioPath: "/tmp/voiceover/a.wav",
				voice: "ash",
				style: "sleek",
				polish: true,
				utterances: [],
				generatedAtMs: 1,
			} as never,
		});
		expect(legacy.voiceover).toMatchObject({ quality: "hd", language: null });

		// Full serialize → parse → normalize cycle keeps both intact.
		const reloaded = normalizeProjectEditor(JSON.parse(JSON.stringify(editor)) as typeof editor);
		expect(reloaded.audioTrackClips).toEqual(editor.audioTrackClips);
		expect(reloaded.voiceover).toEqual(editor.voiceover);
	});

	it("drops invalid voiceover metadata and keeps physical clips intact", () => {
		const editor = normalizeProjectEditor({
			voiceover: { voice: "nova" } as never,
		});
		expect(editor.voiceover).toBeNull();
	});
});
