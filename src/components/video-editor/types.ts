import type { WebcamLayoutPreset } from "@/lib/compositeLayout";
import type { AudioStreamSource, AudioTrackRole, RecordedAudioTrack } from "@/lib/recordingSession";

export type ZoomDepth = 1 | 2 | 3 | 4 | 5 | 6;
export type ZoomFocusMode = "manual" | "auto";
export type { WebcamLayoutPreset };
/** Webcam size as a percentage of the canvas reference dimension (10-50). */
export type WebcamSizePreset = number;

export const DEFAULT_WEBCAM_SIZE_PRESET: WebcamSizePreset = 25;

export const DEFAULT_WEBCAM_LAYOUT_PRESET: WebcamLayoutPreset = "picture-in-picture";

export type WebcamMaskShape = "rectangle" | "circle" | "square" | "rounded";

export const DEFAULT_WEBCAM_MASK_SHAPE: WebcamMaskShape = "rectangle";

export const DEFAULT_WEBCAM_MIRRORED = false;

/** When true, the picture-in-picture webcam scales inversely with zoom (shrinks as you zoom in). */
export const DEFAULT_WEBCAM_REACTIVE_ZOOM = true;

export interface WebcamPosition {
	cx: number; // normalized horizontal center (0-1)
	cy: number; // normalized vertical center (0-1)
}

export const DEFAULT_WEBCAM_POSITION: WebcamPosition | null = null;

export interface ZoomFocus {
	cx: number; // normalized horizontal center (0-1)
	cy: number; // normalized vertical center (0-1)
}

export interface Rotation3D {
	rotationX: number;
	rotationY: number;
	rotationZ: number;
}

export const DEFAULT_ROTATION_3D: Rotation3D = {
	rotationX: 0,
	rotationY: 0,
	rotationZ: 0,
};

export type Rotation3DPreset = "iso" | "left" | "right";

export const ROTATION_3D_PRESETS: Record<Rotation3DPreset, Rotation3D> = {
	iso: { rotationX: -10, rotationY: -16, rotationZ: 0 },
	left: { rotationX: 0, rotationY: -22, rotationZ: 0 },
	right: { rotationX: 0, rotationY: 22, rotationZ: 0 },
};

export const ROTATION_3D_PRESET_ORDER: Rotation3DPreset[] = ["iso", "left", "right"];

/** Perspective distance in CSS px is this factor times min(viewport w, h). Same
 * factor in preview and export so the look matches at any canvas resolution. */
export const ROTATION_3D_PERSPECTIVE_FACTOR = 2.6;

export function rotation3DPerspective(width: number, height: number): number {
	return Math.min(width, height) * ROTATION_3D_PERSPECTIVE_FACTOR;
}

/**
 * Origin of a zoom region. "auto" marks zooms from the magic-wand suggest pass;
 * toggling the wand off removes only these. Editing an auto zoom promotes it to
 * "manual" so it survives. Undefined is treated as "manual" for back-compat.
 */
export type ZoomRegionSource = "auto" | "manual";
export type ZoomMotionProfile = "professional-v2";
export type ZoomFocusSpace = "stage" | "source";

export interface ZoomTargetBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ZoomRegion {
	id: string;
	startMs: number;
	endMs: number;
	/**
	 * Optional explicit zoom-in duration. Auto-generated regions use this so the
	 * camera starts and finishes its zoom during the semantic cursor move. Older
	 * and manually-created regions omit it and keep the legacy lead-in timing.
	 */
	zoomInDurationMs?: number;
	/** Explicit analytic zoom-out duration used by professional auto camera moves. */
	zoomOutDurationMs?: number;
	/** Opt-in only: missing values preserve the legacy renderer for old/manual regions. */
	motionProfile?: ZoomMotionProfile;
	/** Original interaction time in source-media time. */
	triggerTimeMs?: number;
	/** Confidence of the local interaction/target analysis, in the 0-1 range. */
	confidence?: number;
	/** Target rectangle in normalized, uncropped source-video coordinates. */
	targetBounds?: ZoomTargetBounds;
	/** Coordinate system used by focus. Legacy regions default to stage coordinates. */
	focusSpace?: ZoomFocusSpace;
	depth: ZoomDepth;
	focus: ZoomFocus;
	/** Optional drag destination, in the same coordinate space as focus. */
	focusEnd?: ZoomFocus;
	focusMode?: ZoomFocusMode;
	rotationPreset?: Rotation3DPreset;
	/** Custom scale overriding the preset depth (1.0-5.0, two decimal precision). */
	customScale?: number;
	source?: ZoomRegionSource;
}

export function getRotation3D(region: Pick<ZoomRegion, "rotationPreset">): Rotation3D {
	if (!region.rotationPreset) return DEFAULT_ROTATION_3D;
	return ROTATION_3D_PRESETS[region.rotationPreset];
}

export function isRotation3DIdentity(r: Rotation3D, eps = 0.01): boolean {
	return Math.abs(r.rotationX) < eps && Math.abs(r.rotationY) < eps && Math.abs(r.rotationZ) < eps;
}

export function lerpRotation3D(a: Rotation3D, b: Rotation3D, t: number): Rotation3D {
	return {
		rotationX: a.rotationX + (b.rotationX - a.rotationX) * t,
		rotationY: a.rotationY + (b.rotationY - a.rotationY) * t,
		rotationZ: a.rotationZ + (b.rotationZ - a.rotationZ) * t,
	};
}

/**
 * Max uniform scale that, with `rot` and a perspective of `perspective` CSS px, keeps
 * the projected bounding box of a width x height element inside its original rectangle.
 * Returns 1 when no scaling is needed. Projects each rotated corner (x' = x*P/(P-z)) and
 * returns the limiting half-extent ratio so the rotated recording stays inside the zoom window.
 */
export function computeRotation3DContainScale(
	rot: Rotation3D,
	width: number,
	height: number,
	perspective: number,
): number {
	const a = (rot.rotationX * Math.PI) / 180;
	const b = (rot.rotationY * Math.PI) / 180;
	const g = (rot.rotationZ * Math.PI) / 180;
	const ca = Math.cos(a);
	const sa = Math.sin(a);
	const cb = Math.cos(b);
	const sb = Math.sin(b);
	const cg = Math.cos(g);
	const sg = Math.sin(g);
	const halfW = width / 2;
	const halfH = height / 2;
	const corners: Array<[number, number]> = [
		[-halfW, -halfH],
		[halfW, -halfH],
		[halfW, halfH],
		[-halfW, halfH],
	];

	let maxAbsX = 0;
	let maxAbsY = 0;

	for (const [x0, y0] of corners) {
		// CSS "rotateX rotateY rotateZ" applies right-to-left: Z first, then Y, then X.
		let px = x0;
		let py = y0;
		let pz = 0;

		// rotateZ
		const zx = px * cg - py * sg;
		const zy = px * sg + py * cg;
		px = zx;
		py = zy;

		// rotateY
		const yx = px * cb + pz * sb;
		const yz = -px * sb + pz * cb;
		px = yx;
		pz = yz;

		// rotateX
		const xy = py * ca - pz * sa;
		const xz = py * sa + pz * ca;
		py = xy;
		pz = xz;

		// Viewer at (0, 0, P) looking toward -z; a point at z=pz scales by P/(P-pz).
		// perspective <= 0 means orthographic.
		if (perspective > 0) {
			const denom = perspective - pz;
			if (denom <= 0) return 1; // pathological, skip scaling rather than crash
			const f = perspective / denom;
			px *= f;
			py *= f;
		}

		if (Math.abs(px) > maxAbsX) maxAbsX = Math.abs(px);
		if (Math.abs(py) > maxAbsY) maxAbsY = Math.abs(py);
	}

	if (maxAbsX === 0 || maxAbsY === 0) return 1;
	const sx = halfW / maxAbsX;
	const sy = halfH / maxAbsY;
	return Math.min(sx, sy, 1);
}

export interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	interactionType?: "move" | "click" | "double-click" | "right-click" | "middle-click" | "mouseup";
	cursorType?:
		| "arrow"
		| "text"
		| "pointer"
		| "crosshair"
		| "open-hand"
		| "closed-hand"
		| "resize-ew"
		| "resize-ns"
		| "not-allowed";
}

export interface CursorVisualSettings {
	size: number;
	smoothing: number;
	motionBlur: number;
	clickBounce: number;
	clipToBounds: boolean;
}

export const DEFAULT_CURSOR_SIZE = 3.0;
export const DEFAULT_CURSOR_SMOOTHING = 0.67;
export const DEFAULT_CURSOR_MOTION_BLUR = 0.35;
export const DEFAULT_CURSOR_CLICK_BOUNCE = 2.5;
export const DEFAULT_SMART_CURSOR_ENABLED = true;
// false lets the cursor overflow into the background; true clips it to the canvas bounds.
export const DEFAULT_CURSOR_CLIP_TO_BOUNDS = false;
export const DEFAULT_ZOOM_MOTION_BLUR = 0.35;

export interface TrimRegion {
	id: string;
	startMs: number;
	endMs: number;
}

export type AnnotationType = "text" | "image" | "figure" | "blur";

export type ArrowDirection =
	| "up"
	| "down"
	| "left"
	| "right"
	| "up-right"
	| "up-left"
	| "down-right"
	| "down-left";

export interface FigureData {
	arrowDirection: ArrowDirection;
	color: string;
	strokeWidth: number;
}

export type BlurShape = "rectangle" | "oval" | "freehand";
export type BlurType = "blur" | "mosaic";
export type BlurColor = "white" | "black";

export const MIN_BLUR_INTENSITY = 2;
export const MAX_BLUR_INTENSITY = 40;
export const DEFAULT_BLUR_INTENSITY = 12;
export const MIN_BLUR_BLOCK_SIZE = 4;
export const MAX_BLUR_BLOCK_SIZE = 48;
export const DEFAULT_BLUR_BLOCK_SIZE = 12;

export interface BlurData {
	type: BlurType;
	shape: BlurShape;
	color: BlurColor;
	intensity: number;
	blockSize: number;
	// Points are normalized (0-100) within the annotation bounds.
	freehandPoints?: Array<{ x: number; y: number }>;
}

export interface AnnotationPosition {
	x: number;
	y: number;
}

export interface AnnotationSize {
	width: number;
	height: number;
}

export type AnnotationTextAnimation =
	| "none"
	| "fade"
	| "rise"
	| "pop"
	| "slide-left"
	| "typewriter"
	| "pulse";

export interface AnnotationTextStyle {
	color: string;
	backgroundColor: string;
	fontSize: number; // pixels
	fontFamily: string;
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline";
	textAlign: "left" | "center" | "right";
	textAnimation?: AnnotationTextAnimation;
}

export interface AnnotationRegion {
	id: string;
	startMs: number;
	endMs: number;
	type: AnnotationType;
	content: string; // Legacy - still used for current type
	textContent?: string; // Separate storage for text
	imageContent?: string; // Separate storage for image data URL
	position: AnnotationPosition;
	size: AnnotationSize;
	style: AnnotationTextStyle;
	zIndex: number;
	/** When set, layout/style edits on one region can sync to all auto-caption siblings. */
	annotationSource?: "auto-caption";
	figureData?: FigureData;
	blurData?: BlurData;
}

export const DEFAULT_ANNOTATION_POSITION: AnnotationPosition = {
	x: 50,
	y: 50,
};

export const DEFAULT_ANNOTATION_SIZE: AnnotationSize = {
	width: 30,
	height: 20,
};

export const DEFAULT_ANNOTATION_STYLE: AnnotationTextStyle = {
	color: "#ffffff",
	backgroundColor: "transparent",
	fontSize: 32,
	fontFamily: "Inter",
	fontWeight: "bold",
	fontStyle: "normal",
	textDecoration: "none",
	textAlign: "center",
	textAnimation: "none",
};

export const DEFAULT_FIGURE_DATA: FigureData = {
	arrowDirection: "right",
	color: "#34B27B",
	strokeWidth: 4,
};

export const DEFAULT_BLUR_FREEHAND_POINTS: Array<{ x: number; y: number }> = [
	{ x: 10, y: 30 },
	{ x: 25, y: 10 },
	{ x: 55, y: 8 },
	{ x: 82, y: 20 },
	{ x: 90, y: 45 },
	{ x: 78, y: 72 },
	{ x: 52, y: 90 },
	{ x: 22, y: 84 },
	{ x: 8, y: 58 },
];

export const DEFAULT_BLUR_DATA: BlurData = {
	type: "mosaic",
	shape: "rectangle",
	color: "white",
	intensity: DEFAULT_BLUR_INTENSITY,
	blockSize: DEFAULT_BLUR_BLOCK_SIZE,
	freehandPoints: DEFAULT_BLUR_FREEHAND_POINTS,
};

export interface CropRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const DEFAULT_CROP_REGION: CropRegion = {
	x: 0,
	y: 0,
	width: 1,
	height: 1,
};

export type PlaybackSpeed = number;

export const MIN_PLAYBACK_SPEED = 0.1;
// Above 16x the decoder can't keep up and the playhead stalls during preview.
export const MAX_PLAYBACK_SPEED = 16;

export function clampPlaybackSpeed(speed: number): PlaybackSpeed {
	return Math.round(Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, speed)) * 100) / 100;
}

export interface SpeedRegion {
	id: string;
	startMs: number;
	endMs: number;
	speed: PlaybackSpeed;
}

/**
 * An editable slice of one of the audio streams written by ScreenCaptureKit.
 * `startMs`/`endMs` are its position on the editor timeline; `sourceStartMs`
 * is the position read from the original audio stream.
 */
export interface AudioTrackClip {
	id: string;
	role: AudioTrackRole;
	/** 0-based order among physical audio tracks; resolved to a demuxer stream index at runtime. */
	trackOrdinal: number;
	startMs: number;
	endMs: number;
	sourceStartMs: number;
	muted: boolean;
	gain: number;
	linkGroupId?: string;
	/**
	 * Absolute path of a standalone audio file backing this clip (e.g. a generated
	 * voice-over WAV). File-backed clips never resolve against the recording's own
	 * audio streams; their `trackOrdinal` is a reserved virtual ordinal.
	 */
	sourcePath?: string;
}

/** Virtual ordinal for the generated voice-over track; never collides with physical tracks. */
export const VOICEOVER_TRACK_ORDINAL = 1000;

export const VOICEOVER_CLIP_ID = "audio-voiceover";

export function isFileBackedAudioClip(clip: Pick<AudioTrackClip, "sourcePath">): boolean {
	return typeof clip.sourcePath === "string" && clip.sourcePath.length > 0;
}

/** One synthesized speech span of the generated voice-over, in timeline milliseconds. */
export interface VoiceoverUtterance {
	startMs: number;
	endMs: number;
	text: string;
}

/** Metadata for the generated voice-over track (the audio itself lives in `audioPath`). */
export interface VoiceoverState {
	audioPath: string;
	voice: string;
	style: string;
	polish: boolean;
	/** "hd" (gpt-audio chat models) or "standard" (gpt-4o-mini-tts). */
	quality: string;
	/** Target language the script was translated into; null reads the original language. */
	language: string | null;
	utterances: VoiceoverUtterance[];
	generatedAtMs: number;
}

/** An editable section of the recorded screen video. */
export interface VideoTrackClip {
	id: string;
	startMs: number;
	endMs: number;
	sourceStartMs: number;
	linkGroupId?: string;
}

export type TimelineTrackKind = "video" | "audio" | "zoom" | "annotation" | "blur" | "speed";

export interface TimelineTrack {
	id: string;
	kind: TimelineTrackKind;
	order: number;
	locked: boolean;
	muted: boolean;
	hidden: boolean;
}

export const DEFAULT_TIMELINE_TRACKS: TimelineTrack[] = [
	{ id: "track-video", kind: "video", order: 0, locked: false, muted: false, hidden: false },
	{ id: "track-zoom", kind: "zoom", order: 1, locked: false, muted: false, hidden: false },
	{
		id: "track-annotation",
		kind: "annotation",
		order: 2,
		locked: false,
		muted: false,
		hidden: false,
	},
	{ id: "track-blur", kind: "blur", order: 3, locked: false, muted: false, hidden: false },
	{ id: "track-speed", kind: "speed", order: 4, locked: false, muted: false, hidden: false },
	{ id: "track-audio", kind: "audio", order: 5, locked: false, muted: false, hidden: false },
];

export interface TimelineClipBase {
	id: string;
	trackId: string;
	kind: TimelineTrackKind;
	timelineStartMs: number;
	durationMs: number;
	sourceInMs: number;
	sourceDurationMs: number;
	linkGroupId?: string;
}

export type TimelineClip = TimelineClipBase & {
	payload:
		| { type: "video" }
		| { type: "audio"; tracks: Array<{ trackOrdinal: number; gain: number; muted: boolean }> }
		| { type: "zoom"; region: ZoomRegion }
		| { type: "annotation" | "blur"; region: AnnotationRegion }
		| { type: "speed"; region: SpeedRegion };
};

export function createDefaultVideoTrackClip(durationMs: number): VideoTrackClip {
	return {
		id: "video-screen",
		startMs: 0,
		endMs: Math.max(1, Math.round(durationMs)),
		sourceStartMs: 0,
		linkGroupId: "media-screen-1",
	};
}

export function createDefaultAudioTrackClips(
	durationMs: number,
	audioTracks?: RecordedAudioTrack[] | AudioStreamSource[],
): AudioTrackClip[] {
	// Without stream metadata (legacy manifests, imported videos, non-native
	// recordings) the audio track layout is unknown; leave the audio timeline
	// empty so playback falls back to the media's embedded audio.
	if (!audioTracks?.length) {
		return [];
	}
	const endMs = Math.max(1, Math.round(durationMs));
	const normalizedTracks: RecordedAudioTrack[] =
		typeof audioTracks[0] === "string"
			? audioTracks.length === 2
				? [{ ordinal: 0, role: "mixed" }]
				: (audioTracks as AudioStreamSource[]).map((role, ordinal) => ({ ordinal, role }))
			: (audioTracks as RecordedAudioTrack[]);
	return normalizedTracks.map(({ ordinal, role }) => ({
		id: `audio-${role}-${ordinal}`,
		role,
		trackOrdinal: ordinal,
		startMs: 0,
		endMs,
		sourceStartMs: 0,
		muted: false,
		gain: 1,
		linkGroupId: "media-screen-1",
	}));
}

/**
 * Aligns persisted clips with the physical track layout discovered from the media file.
 * File-backed clips (voice-over) are not tied to the media's streams and pass through as-is.
 */
export function reconcileAudioTrackClips(
	clips: AudioTrackClip[],
	tracks: RecordedAudioTrack[],
): AudioTrackClip[] {
	const fileBackedClips = clips.filter((clip) => isFileBackedAudioClip(clip));
	const physicalClips = clips.filter((clip) => !isFileBackedAudioClip(clip));
	return [...reconcilePhysicalAudioTrackClips(physicalClips, tracks), ...fileBackedClips];
}

function reconcilePhysicalAudioTrackClips(
	clips: AudioTrackClip[],
	tracks: RecordedAudioTrack[],
): AudioTrackClip[] {
	if (!tracks.length) return [];
	if (tracks.length === 1) {
		const spanGroups = new Map<string, AudioTrackClip[]>();
		for (const clip of clips) {
			const key = `${clip.startMs}:${clip.endMs}:${clip.sourceStartMs}:${clip.linkGroupId ?? ""}`;
			const group = spanGroups.get(key);
			if (group) group.push(clip);
			else spanGroups.set(key, [clip]);
		}

		return [...spanGroups.values()]
			.map((group) => {
				const first = group[0];
				const collapsedDuplicateControls = group.length > 1;
				return {
					...first,
					role: tracks[0].role,
					trackOrdinal: 0,
					// Legacy system/microphone controls can point at one physical mixed track.
					// Collapse only matching timeline spans, preserving cuts while avoiding a
					// doubled signal. Independent gains cannot be recovered, so use unity.
					muted: collapsedDuplicateControls ? group.every((clip) => clip.muted) : first.muted,
					gain: collapsedDuplicateControls ? 1 : first.gain,
				};
			})
			.sort((left, right) => left.startMs - right.startMs);
	}

	return clips
		.filter((clip) => tracks.some((track) => track.ordinal === clip.trackOrdinal))
		.map((clip) => ({
			...clip,
			role: tracks.find((track) => track.ordinal === clip.trackOrdinal)?.role ?? clip.role,
		}));
}

export const SPEED_OPTIONS: Array<{ speed: PlaybackSpeed; label: string }> = [
	{ speed: 0.25, label: "0.25×" },
	{ speed: 0.5, label: "0.5×" },
	{ speed: 0.75, label: "0.75×" },
	{ speed: 1.25, label: "1.25×" },
	{ speed: 1.5, label: "1.5×" },
	{ speed: 1.75, label: "1.75×" },
	{ speed: 2, label: "2×" },
	{ speed: 3, label: "3×" },
	{ speed: 4, label: "4×" },
	{ speed: 5, label: "5×" },
];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1.5;

export const ZOOM_DEPTH_SCALES: Record<ZoomDepth, number> = {
	1: 1.25,
	2: 1.5,
	3: 1.8,
	4: 2.2,
	5: 3.5,
	6: 5.0,
};

export const MIN_ZOOM_SCALE = 1.0;
export const MAX_ZOOM_SCALE = 5.0;

export const DEFAULT_ZOOM_DEPTH: ZoomDepth = 3;

/** Returns the effective zoom scale for a region, preferring customScale over the preset. */
export function getZoomScale(region: ZoomRegion): number {
	if (region.customScale != null) {
		const clamped = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, region.customScale));
		if (Number.isFinite(clamped)) return clamped;
	}
	return ZOOM_DEPTH_SCALES[region.depth];
}

export function clampFocusToDepth(focus: ZoomFocus, _depth: ZoomDepth): ZoomFocus {
	return {
		cx: clamp(focus.cx, 0, 1),
		cy: clamp(focus.cy, 0, 1),
	};
}

function clamp(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return (min + max) / 2;
	return Math.min(max, Math.max(min, value));
}
