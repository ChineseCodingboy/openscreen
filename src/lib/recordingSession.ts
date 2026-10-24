import { normalizeWebcamSyncMetadata, type WebcamSyncMetadata } from "./webcamSync";

export interface ProjectMedia {
	screenVideoPath: string;
	webcamVideoPath?: string;
	/** Maps screen/audio source time to the independently recorded webcam source clock. */
	webcamSync?: WebcamSyncMetadata;
	cursorCaptureMode?: CursorCaptureMode;
	/** Physical audio tracks, addressed by their 0-based order among audio tracks. */
	audioTracks?: RecordedAudioTrack[];
	/** @deprecated v4 metadata. Normalization migrates this to `audioTracks`. */
	audioStreams?: AudioStreamSource[];
}

export type CursorCaptureMode = "editable-overlay" | "system";

export type AudioStreamSource = "system" | "microphone";

export type AudioTrackRole = AudioStreamSource | "mixed" | "unknown" | "voiceover";

export interface RecordedAudioTrack {
	/** 0-based order among audio tracks only; never a container-global stream index. */
	ordinal: number;
	role: AudioTrackRole;
}

export interface RecordingSession extends ProjectMedia {
	createdAt: number;
}

export interface RecordedVideoAssetInput {
	fileName: string;
	videoData: ArrayBuffer;
	/** Active media duration, excluding pauses. Used to patch MediaRecorder WebM metadata. */
	durationMs?: number;
}

export interface StoreRecordedSessionInput {
	screen: RecordedVideoAssetInput;
	webcam?: RecordedVideoAssetInput;
	webcamSync?: WebcamSyncMetadata;
	createdAt?: number;
	cursorCaptureMode?: CursorCaptureMode;
	/**
	 * Recording wall-clock duration (ms). The main process patches the WebM Duration
	 * header on streamed recordings (the renderer no longer holds the bytes). Browser
	 * MediaRecorder writes no/zero duration, which breaks the editor seek bar and
	 * timeline for anything that took the streaming path.
	 */
	durationMs?: number;
}

export function normalizeCursorCaptureMode(value: unknown): CursorCaptureMode | undefined {
	return value === "editable-overlay" || value === "system" ? value : undefined;
}

export function normalizeAudioStreams(value: unknown): AudioStreamSource[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const streams: AudioStreamSource[] = [];
	for (const entry of value) {
		if ((entry === "system" || entry === "microphone") && !streams.includes(entry)) {
			streams.push(entry);
		}
	}
	return streams.length > 0 ? streams : undefined;
}

export function normalizeAudioTracks(value: unknown): RecordedAudioTrack[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const tracks = new Map<number, RecordedAudioTrack>();
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const raw = entry as Partial<RecordedAudioTrack>;
		if (typeof raw.ordinal !== "number" || !Number.isFinite(raw.ordinal)) continue;
		if (!isAudioTrackRole(raw.role)) continue;
		const ordinal = Math.max(0, Math.round(raw.ordinal));
		if (!tracks.has(ordinal)) tracks.set(ordinal, { ordinal, role: raw.role });
	}

	const normalized = [...tracks.values()].sort((left, right) => left.ordinal - right.ordinal);
	return normalized.length > 0 ? normalized : undefined;
}

export function isAudioTrackRole(value: unknown): value is AudioTrackRole {
	return (
		value === "system" ||
		value === "microphone" ||
		value === "mixed" ||
		value === "unknown" ||
		value === "voiceover"
	);
}

/** Migrates requested-source metadata and reconciles it with the tracks actually in the file. */
export function reconcileRecordedAudioTracks(
	actualTrackCount: number,
	audioTracks?: RecordedAudioTrack[],
	legacyAudioStreams?: AudioStreamSource[],
): RecordedAudioTrack[] {
	const count = Math.max(0, Math.round(Number.isFinite(actualTrackCount) ? actualTrackCount : 0));
	if (count === 0) return [];

	const normalizedTracks = normalizeAudioTracks(audioTracks) ?? [];
	const normalizedLegacy = normalizeAudioStreams(legacyAudioStreams) ?? [];
	if (count === 1) {
		const roles = new Set<AudioTrackRole>([
			...normalizedTracks.map((track) => track.role),
			...normalizedLegacy,
		]);
		const role: AudioTrackRole =
			roles.has("mixed") || (roles.has("system") && roles.has("microphone"))
				? "mixed"
				: (normalizedTracks[0]?.role ?? normalizedLegacy[0] ?? "unknown");
		return [{ ordinal: 0, role }];
	}

	return Array.from({ length: count }, (_, ordinal) => ({
		ordinal,
		role:
			normalizedTracks.find((track) => track.ordinal === ordinal)?.role ??
			normalizedLegacy[ordinal] ??
			"unknown",
	}));
}

function normalizePath(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function normalizeProjectMedia(candidate: unknown): ProjectMedia | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const raw = candidate as Partial<ProjectMedia>;
	const screenVideoPath = normalizePath(raw.screenVideoPath);

	if (!screenVideoPath) {
		return null;
	}

	const webcamVideoPath = normalizePath(raw.webcamVideoPath);
	const webcamSync = webcamVideoPath ? normalizeWebcamSyncMetadata(raw.webcamSync) : undefined;
	const cursorCaptureMode = normalizeCursorCaptureMode(raw.cursorCaptureMode);
	const audioTracks = normalizeAudioTracks(raw.audioTracks);
	const audioStreams = normalizeAudioStreams(raw.audioStreams);
	const migratedAudioTracks =
		audioTracks ??
		(audioStreams?.length === 1
			? audioStreams.map((role, ordinal) => ({ ordinal, role }))
			: undefined);

	return {
		screenVideoPath,
		...(webcamVideoPath ? { webcamVideoPath } : {}),
		...(webcamSync ? { webcamSync } : {}),
		...(cursorCaptureMode ? { cursorCaptureMode } : {}),
		...(migratedAudioTracks ? { audioTracks: migratedAudioTracks } : {}),
		// Retain v4 requested-source metadata until the renderer has inspected the
		// physical file; two requested sources may be one mixed track or two tracks.
		...(audioStreams && !audioTracks ? { audioStreams } : {}),
	};
}

export function normalizeRecordingSession(candidate: unknown): RecordingSession | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const raw = candidate as Partial<RecordingSession>;
	const media = normalizeProjectMedia(raw);
	if (!media) {
		return null;
	}

	return {
		...media,
		createdAt:
			typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
				? raw.createdAt
				: Date.now(),
	};
}
