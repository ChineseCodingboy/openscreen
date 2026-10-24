import type { Span } from "dnd-timeline";
import { FolderOpen, Languages, LoaderCircle, Save, Video, X } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { INITIAL_EDITOR_STATE, useEditorHistory } from "@/hooks/useEditorHistory";
import { type Locale } from "@/i18n/config";
import { getAvailableLocales, getLocaleName } from "@/i18n/loader";
import {
	captionSegmentsToAnnotationRegions,
	extractMono16kFromVideoUrl,
	MAX_CAPTION_AUDIO_SEC,
	reconcileAutoCaptionTimelineGaps,
	transcribeMono16kWithOpenAI,
	trimLeadingSilenceMono16k,
} from "@/lib/captioning";
import { hasNativeCursorRecordingData } from "@/lib/cursor/nativeCursor";
import { getSemanticCursorPathMetadata } from "@/lib/cursor/semanticCursorPath";
import {
	calculateEffectiveSourceDimensions,
	calculateMp4ExportSettings,
	calculateOutputDimensions,
	type ExportFormat,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	isSourceCopyFastPathEligible,
	VideoExporter,
	type VideoExporterConfig,
} from "@/lib/exporter";
import { computeFrameStepTime } from "@/lib/frameStep";
import {
	type CursorCaptureMode,
	type ProjectMedia,
	type RecordedAudioTrack,
	reconcileRecordedAudioTracks,
} from "@/lib/recordingSession";
import { matchesShortcut } from "@/lib/shortcuts";
import {
	getExportFolder,
	getProjectFolder,
	loadUserPreferences,
	parentDirectoryOf,
	saveUserPreferences,
} from "@/lib/userPreferences";
import {
	buildUtterancesFromCaptionSegments,
	DEFAULT_VOICEOVER_QUALITY,
	DEFAULT_VOICEOVER_STYLE,
	DEFAULT_VOICEOVER_VOICE,
	mergeIntoUtterances,
	synthesizeVoiceover,
	VOICEOVER_LANGUAGES,
	VOICEOVER_STYLES,
	VOICEOVER_VOICES,
	type VoiceoverQuality,
	type VoiceoverStyleId,
	type VoiceoverVoice,
} from "@/lib/voiceover";
import { BackgroundLoadError } from "@/lib/wallpaper";
import type { WebcamSyncMetadata } from "@/lib/webcamSync";
import { nativeBridgeClient, useCursorRecordingData, useCursorTelemetry } from "@/native";
import type { NativePlatform } from "@/native/contracts";
import {
	getAspectRatioValue,
	getNativeAspectRatioValue,
	isPortraitAspectRatio,
} from "@/utils/aspectRatioUtils";
import { EditorEmptyState } from "./EditorEmptyState";
import { ExportDialog } from "./ExportDialog";
import {
	DEFAULT_CURSOR_SETTINGS,
	DEFAULT_EXPORT_SETTINGS,
	DEFAULT_GIF_SETTINGS,
	DEFAULT_SOURCE_DIMENSIONS,
} from "./editorDefaults";
import { type MediaLibraryItem, MediaLibraryView } from "./MediaLibraryView";
import PlaybackControls from "./PlaybackControls";
import {
	createProjectData,
	createProjectSnapshot,
	deriveNextId,
	fromFileUrl,
	hasProjectUnsavedChanges,
	normalizeProjectEditor,
	resolveProjectMedia,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { SettingsPanel } from "./SettingsPanel";
import { buildSemanticZoomSuggestions } from "./timeline/semanticZoomSuggestions";
import TimelineEditor from "./timeline/TimelineEditor";
import {
	findAudioClipGroup,
	groupAudioTrackClips,
	isAudioMixItemId,
	splitLinkedMedia,
	splitTimedRegion,
} from "./timeline/timelineCommands";
import { TimelineMapper } from "./timeline/timelineMapper";
import { buildAutoZoomSuggestions } from "./timeline/zoomSuggestionUtils";
import {
	type AnnotationRegion,
	type AudioTrackClip,
	type BlurData,
	clampFocusToDepth,
	createDefaultAudioTrackClips,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_BLUR_DATA,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_ZOOM_DEPTH,
	type FigureData,
	isFileBackedAudioClip,
	type PlaybackSpeed,
	type Rotation3DPreset,
	reconcileAudioTrackClips,
	type SpeedRegion,
	type TrimRegion,
	type VideoTrackClip,
	VOICEOVER_CLIP_ID,
	VOICEOVER_TRACK_ORDINAL,
	type VoiceoverUtterance,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomFocusMode,
	type ZoomRegion,
} from "./types";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import {
	areMediaSpansContinuous,
	createPreviewTimePublisher,
	resolveVideoMasterAdvance,
} from "./videoPlayback/previewTransport";

/** Single Sonner slot so auto-caption phases update in place instead of stacking. */
const AUTO_CAPTION_PROGRESS_TOAST_ID = "auto-caption-progress";

/** Single Sonner slot for the voice-over pipeline phases. */
const VOICEOVER_PROGRESS_TOAST_ID = "voiceover-progress";

interface TimelineClipboardPayload {
	originStartMs: number;
	videoTrackClips: VideoTrackClip[];
	audioTrackClips: AudioTrackClip[];
	zoomRegions: ZoomRegion[];
	annotationRegions: AnnotationRegion[];
	speedRegions: SpeedRegion[];
}

function isClickInteractionType(interactionType: string | null | undefined) {
	return (
		interactionType === "click" ||
		interactionType === "double-click" ||
		interactionType === "right-click" ||
		interactionType === "middle-click"
	);
}

async function resolvePhysicalAudioTracks(
	sourcePath: string,
	media: Pick<ProjectMedia, "audioTracks" | "audioStreams">,
): Promise<RecordedAudioTrack[] | null> {
	try {
		const inspection = await window.electronAPI?.inspectAudioTracks?.(sourcePath);
		if (inspection?.success && inspection.tracks) {
			return reconcileRecordedAudioTracks(
				inspection.tracks.length,
				media.audioTracks,
				media.audioStreams,
			);
		}
	} catch (error) {
		console.warn("Unable to inspect the recording's physical audio tracks", error);
	}

	if (media.audioTracks?.length) return media.audioTracks;
	if (media.audioStreams?.length === 1) {
		return reconcileRecordedAudioTracks(1, undefined, media.audioStreams);
	}
	return null;
}

function buildMediaClipsFromLegacyTrims(durationMs: number, trimRegions: TrimRegion[]) {
	const sorted = [...trimRegions]
		.map((region) => ({
			startMs: Math.max(0, Math.min(durationMs, region.startMs)),
			endMs: Math.max(0, Math.min(durationMs, region.endMs)),
		}))
		.filter((region) => region.endMs > region.startMs)
		.sort((left, right) => left.startMs - right.startMs);
	const parts: Array<{ timelineStartMs: number; sourceStartMs: number; durationMs: number }> = [];
	let sourceCursor = 0;
	let timelineCursor = 0;
	for (const trim of sorted) {
		if (trim.startMs > sourceCursor) {
			const duration = trim.startMs - sourceCursor;
			parts.push({
				timelineStartMs: timelineCursor,
				sourceStartMs: sourceCursor,
				durationMs: duration,
			});
			timelineCursor += duration;
		}
		sourceCursor = Math.max(sourceCursor, trim.endMs);
	}
	if (sourceCursor < durationMs) {
		parts.push({
			timelineStartMs: timelineCursor,
			sourceStartMs: sourceCursor,
			durationMs: durationMs - sourceCursor,
		});
	}
	return parts;
}

function mapLegacySourceTimeToTimeline(timeMs: number, trimRegions: TrimRegion[]) {
	const removedBefore = trimRegions.reduce((total, trim) => {
		if (timeMs <= trim.startMs) return total;
		return total + Math.max(0, Math.min(timeMs, trim.endMs) - trim.startMs);
	}, 0);
	return Math.max(0, Math.round(timeMs - removedBefore));
}

function migrateLegacyEffectTimes<T extends { startMs: number; endMs: number }>(
	regions: T[],
	trimRegions: TrimRegion[],
): T[] {
	return regions.map((region) => {
		const startMs = mapLegacySourceTimeToTimeline(region.startMs, trimRegions);
		const mappedEnd = mapLegacySourceTimeToTimeline(region.endMs, trimRegions);
		return { ...region, startMs, endMs: Math.max(startMs + 1, mappedEnd) };
	});
}

interface ExportDiagnostics {
	formatLabel: "GIF" | "Video";
	reason?: string;
	sourcePath?: string | null;
	width?: number;
	height?: number;
	frameRate?: number;
	codec?: string;
	bitrate?: number;
}

function getFileNameForDiagnostics(filePath?: string | null) {
	if (!filePath) return "unknown";

	try {
		const url = new URL(filePath);
		if (url.protocol === "file:") {
			return decodeURIComponent(url.pathname).split(/[\\/]/).pop() || filePath;
		}
	} catch {
		// Treat non-URL values as filesystem paths.
	}

	return filePath.split(/[\\/]/).pop() || filePath;
}

function buildExportDiagnosticMessage(diagnostics: ExportDiagnostics) {
	const details = [
		diagnostics.reason ? `Reason: ${diagnostics.reason}` : null,
		`Source: ${getFileNameForDiagnostics(diagnostics.sourcePath)}`,
		diagnostics.width && diagnostics.height
			? `Output: ${diagnostics.width}x${diagnostics.height}${
					diagnostics.frameRate ? ` @ ${diagnostics.frameRate} fps` : ""
				}`
			: null,
		diagnostics.codec ? `Codec: ${diagnostics.codec}` : null,
		diagnostics.bitrate ? `Bitrate: ${Math.round(diagnostics.bitrate / 1_000_000)} Mbps` : null,
		`VideoEncoder: ${"VideoEncoder" in window ? "available" : "unavailable"}`,
	].filter(Boolean);

	return `${diagnostics.formatLabel} export failed\n${details.join("\n")}`;
}

function buildSaveDiagnosticMessage(formatLabel: "GIF" | "Video", reason?: string) {
	return `${formatLabel} export save failed${reason ? `\nReason: ${reason}` : ""}`;
}

const CAPTION_WORD_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export default function VideoEditor() {
	const {
		state: editorState,
		pushState,
		updateState,
		commitState,
		undo,
		redo,
		resetState,
	} = useEditorHistory(INITIAL_EDITOR_STATE);

	const {
		zoomRegions,
		autoZoomEnabled,
		autoFocusAll,
		smartCursorEnabled,
		trimRegions,
		speedRegions,
		annotationRegions,
		audioTrackClips,
		voiceover,
		videoTrackClips,
		timelineTracks,
		cropRegion,
		wallpaper,
		backgroundMode,
		shadowIntensity,
		showBlur,
		showTrimWaveform,
		motionBlurAmount,
		borderRadius,
		padding,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamMirrored,
		webcamReactiveZoom,
		webcamSizePreset,
		webcamPosition,
	} = editorState;

	// Non-undoable state
	const [studioView, setStudioView] = useState<"editor" | "media-library">("editor");
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [webcamVideoPath, setWebcamVideoPath] = useState<string | null>(null);
	const [webcamVideoSourcePath, setWebcamVideoSourcePath] = useState<string | null>(null);
	const [webcamSync, setWebcamSync] = useState<WebcamSyncMetadata | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const currentTimeRef = useRef(currentTime);
	const publishCurrentTime = useCallback((timeSeconds: number) => {
		currentTimeRef.current = timeSeconds;
		setCurrentTime(timeSeconds);
	}, []);
	const durationRef = useRef(duration);
	durationRef.current = duration;
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [isPreviewingZoom, setIsPreviewingZoom] = useState(false);
	const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
	const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [selectedBlurId, setSelectedBlurId] = useState<string | null>(null);
	const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
	const [selectedVideoTrackId, setSelectedVideoTrackId] = useState<string | null>(null);
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDialog, setShowExportDialog] = useState(false);
	const [showNewRecordingDialog, setShowNewRecordingDialog] = useState(false);
	const [exportQuality, setExportQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_SETTINGS.quality,
	);
	const [exportFormat, setExportFormat] = useState<ExportFormat>(DEFAULT_EXPORT_SETTINGS.format);
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(DEFAULT_GIF_SETTINGS.frameRate);
	const [gifLoop, setGifLoop] = useState(DEFAULT_GIF_SETTINGS.loop);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(
		DEFAULT_GIF_SETTINGS.sizePreset,
	);
	const [exportedFilePath, setExportedFilePath] = useState<string | null>(null);
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
	const [unsavedExport, setUnsavedExport] = useState<{
		arrayBuffer: ArrayBuffer;
		fileName: string;
		format: string;
	} | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showCloseConfirmDialog, setShowCloseConfirmDialog] = useState(false);
	// Unsaved-changes confirmation for New Project / Load Project.
	// The window-close flow uses showCloseConfirmDialog above.
	const [confirmDialogVariant, setConfirmDialogVariant] = useState<
		"newProject" | "loadProject" | null
	>(null);
	const playerContainerRef = useRef<HTMLDivElement | null>(null);
	const cursorTelemetrySourcePath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
	const { samples: cursorTelemetry, error: cursorTelemetryError } =
		useCursorTelemetry(cursorTelemetrySourcePath);
	const { data: cursorRecordingData, error: cursorRecordingDataError } =
		useCursorRecordingData(cursorTelemetrySourcePath);
	const cursorClickTimestamps = useMemo<number[]>(() => {
		const recordingClicks =
			cursorRecordingData?.samples
				.filter((sample) => isClickInteractionType(sample.interactionType))
				.map((sample) => sample.timeMs) ?? [];
		if (recordingClicks.length > 0) {
			return recordingClicks;
		}

		return cursorTelemetry
			.filter((sample) => isClickInteractionType(sample.interactionType))
			.map((sample) => sample.timeMs);
	}, [cursorRecordingData, cursorTelemetry]);

	// Cursor & motion blur visual settings (non-undoable preferences)
	const [showCursor, setShowCursor] = useState(DEFAULT_CURSOR_SETTINGS.show);
	const [cursorSize, setCursorSize] = useState(DEFAULT_CURSOR_SETTINGS.size);
	const [cursorSmoothing, setCursorSmoothing] = useState(DEFAULT_CURSOR_SETTINGS.smoothing);
	const [cursorMotionBlur, setCursorMotionBlur] = useState(DEFAULT_CURSOR_SETTINGS.motionBlur);
	const [cursorClickBounce, setCursorClickBounce] = useState(DEFAULT_CURSOR_SETTINGS.clickBounce);
	const [cursorClipToBounds, setCursorClipToBounds] = useState(
		DEFAULT_CURSOR_SETTINGS.clipToBounds,
	);
	const [cursorTheme, setCursorTheme] = useState(DEFAULT_CURSOR_SETTINGS.theme);
	const [nativePlatform, setNativePlatform] = useState<NativePlatform | null>(null);
	const [recordingCursorCaptureMode, setRecordingCursorCaptureMode] =
		useState<CursorCaptureMode | null>(null);
	const [recordingAudioTracks, setRecordingAudioTracks] = useState<RecordedAudioTrack[] | null>(
		null,
	);

	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);

	const nextZoomIdRef = useRef(1);
	const nextTrimIdRef = useRef(1);
	const nextSpeedIdRef = useRef(1);

	const { shortcuts, isMac } = useShortcuts();
	// Windows recordings include captured cursor assets. macOS hides the system
	// cursor in ScreenCaptureKit and renders telemetry samples with OpenScreen's
	// default arrow asset for the editable overlay.
	const hasEditableCursorRecording =
		recordingCursorCaptureMode === "editable-overlay" &&
		(nativePlatform === "win32" || nativePlatform === "darwin") &&
		hasNativeCursorRecordingData(cursorRecordingData);
	const effectiveShowCursor = showCursor && hasEditableCursorRecording;
	const showCursorSettings = hasEditableCursorRecording;
	const { locale, setLocale, t: rawT } = useI18n();
	const t = useScopedT("editor");
	const ts = useScopedT("settings");
	const availableLocales = getAvailableLocales();

	const nextAnnotationIdRef = useRef(1);
	const audioTracksInitializedForSourceRef = useRef<string | null>(null);
	const nextAnnotationZIndexRef = useRef(1);
	const isAutoCaptioningRef = useRef(false);
	const [isAutoCaptioning, setIsAutoCaptioning] = useState(false);
	const [showAutoCaptionsDialog, setShowAutoCaptionsDialog] = useState(false);
	const [captionWordsMin, setCaptionWordsMin] = useState(2);
	const [captionWordsMax, setCaptionWordsMax] = useState(7);
	const [openAIKeyDraft, setOpenAIKeyDraft] = useState("");
	const [openAIKeyConfigured, setOpenAIKeyConfigured] = useState(false);
	const [openAISecureStorageAvailable, setOpenAISecureStorageAvailable] = useState(true);
	const [isSavingOpenAIKey, setIsSavingOpenAIKey] = useState(false);
	const [openAIKeyError, setOpenAIKeyError] = useState<string | null>(null);
	const openAIKeySavePromiseRef = useRef<Promise<boolean> | null>(null);
	const [captionsDialogTab, setCaptionsDialogTab] = useState<"captions" | "voiceover">("captions");
	const [voiceoverVoice, setVoiceoverVoice] = useState<VoiceoverVoice>(DEFAULT_VOICEOVER_VOICE);
	const [voiceoverStyle, setVoiceoverStyle] = useState<VoiceoverStyleId>(DEFAULT_VOICEOVER_STYLE);
	const [voiceoverQuality, setVoiceoverQuality] =
		useState<VoiceoverQuality>(DEFAULT_VOICEOVER_QUALITY);
	/** Empty string = keep the original language (no translation). */
	const [voiceoverLanguage, setVoiceoverLanguage] = useState("");
	const [voiceoverSyncCaptions, setVoiceoverSyncCaptions] = useState(true);
	const [voiceoverPolish, setVoiceoverPolish] = useState(false);
	const [voiceoverReplaceOriginal, setVoiceoverReplaceOriginal] = useState(true);
	const [isGeneratingVoiceover, setIsGeneratingVoiceover] = useState(false);
	const isVoiceoverBusyRef = useRef(false);
	const exporterRef = useRef<VideoExporter | null>(null);
	const timelineClipboardRef = useRef<TimelineClipboardPayload | null>(null);

	const annotationOnlyRegions = useMemo(
		() => annotationRegions.filter((region) => region.type !== "blur"),
		[annotationRegions],
	);
	const blurRegions = useMemo(
		() => annotationRegions.filter((region) => region.type === "blur"),
		[annotationRegions],
	);
	const timelineMapper = useMemo(
		() => new TimelineMapper(videoTrackClips, audioTrackClips, speedRegions),
		[audioTrackClips, speedRegions, videoTrackClips],
	);
	const publishLegacyReactSnapshot = useMemo(
		() =>
			createPreviewTimePublisher(({ timelineMs }) => {
				publishCurrentTime(timelineMs / 1000);
			}),
		[publishCurrentTime],
	);
	const trackState = useCallback(
		(kind: (typeof timelineTracks)[number]["kind"]) =>
			timelineTracks.find((track) => track.kind === kind),
		[timelineTracks],
	);
	const videoTrackHidden = trackState("video")?.hidden === true;
	const effectiveAudioTrackClips = useMemo(
		() =>
			trackState("audio")?.muted
				? audioTrackClips.map((clip) => ({ ...clip, muted: true }))
				: audioTrackClips,
		[audioTrackClips, trackState],
	);
	const effectiveZoomRegions = trackState("zoom")?.hidden === true ? [] : zoomRegions;
	const effectiveSpeedRegions = trackState("speed")?.hidden === true ? [] : speedRegions;
	const effectiveAnnotationRegions =
		trackState("annotation")?.hidden === true ? [] : annotationOnlyRegions;
	const effectiveBlurRegions = trackState("blur")?.hidden === true ? [] : blurRegions;
	const timelineDuration = useMemo(() => {
		if (videoTrackClips.length === 0 && audioTrackClips.length === 0) return duration;
		const endMs = Math.max(
			timelineMapper.durationMs,
			...zoomRegions.map((region) => region.endMs),
			...annotationRegions.map((region) => region.endMs),
			...speedRegions.map((region) => region.endMs),
		);
		return endMs / 1000;
	}, [
		annotationRegions,
		audioTrackClips.length,
		duration,
		speedRegions,
		timelineMapper,
		videoTrackClips.length,
		zoomRegions,
	]);

	useEffect(() => {
		if (!isPlaying || videoTrackClips.length === 0) return;
		let animationFrame = 0;
		let previousTimestamp = performance.now();
		let previousVideoClip: VideoTrackClip | null = null;
		let lastAppliedVideoRate: number | null = null;
		const sortedClips = [...videoTrackClips].sort((a, b) => a.startMs - b.startMs);
		const publishReactSnapshot = createPreviewTimePublisher(({ timelineMs }) => {
			publishCurrentTime(timelineMs / 1000);
		});
		// Only a timeline-adjacent clip counts as "next": across a timeline gap the
		// wall clock carries the playhead and the video pauses until re-entry.
		const findAdjacentNextClip = (clip: VideoTrackClip) =>
			sortedClips.find((candidate) => Math.abs(candidate.startMs - clip.endMs) <= 2) ?? null;
		const tick = (timestamp: number) => {
			const elapsedSeconds = Math.min(0.1, Math.max(0, (timestamp - previousTimestamp) / 1000));
			previousTimestamp = timestamp;
			const previousTimelineMs = currentTimeRef.current * 1000;
			const video = videoPlaybackRef.current?.video;
			const point = timelineMapper.videoAtTimelineTime(previousTimelineMs);
			let sourceMs = video?.currentTime ? video.currentTime * 1000 : 0;
			let sourceActive = false;
			// Wall clock drives the playhead through gaps and audio-only tails.
			let nextTime =
				currentTimeRef.current + elapsedSeconds * timelineMapper.playbackRateAt(previousTimelineMs);
			if (video && point && !videoTrackHidden) {
				sourceActive = true;
				const clip = videoTrackClips.find((candidate) => candidate.id === point.clipId) ?? null;
				if (clip) {
					const transitioned = previousVideoClip?.id !== clip.id;
					if (
						transitioned &&
						!areMediaSpansContinuous(previousVideoClip, clip) &&
						Math.abs(video.currentTime * 1000 - point.sourceTimeMs) > 50
					) {
						video.currentTime = point.sourceTimeMs / 1000;
						sourceMs = point.sourceTimeMs;
					}
					// The video element is the master clock: the playhead follows the
					// frames it actually presents instead of seeking/rate-nudging the
					// decoder to chase a separate clock (which visibly drops frames).
					const advance = resolveVideoMasterAdvance({
						previousTimelineMs,
						videoSourceMs: video.currentTime * 1000,
						activeClip: clip,
						nextClip: findAdjacentNextClip(clip),
					});
					nextTime = advance.timelineMs / 1000;
					if (advance.videoAction.type === "seek") {
						video.currentTime = advance.videoAction.seekToSourceMs / 1000;
						sourceMs = advance.videoAction.seekToSourceMs;
					} else {
						sourceMs = video.currentTime * 1000;
					}
					if (advance.videoAction.type === "pause") {
						sourceActive = false;
						video.pause();
					} else {
						const speed = timelineMapper.playbackRateAt(advance.timelineMs);
						if (speed !== lastAppliedVideoRate) {
							video.playbackRate = speed;
							lastAppliedVideoRate = speed;
						}
						// Play through the imperative handle, not video.play(): the raw
						// element call trips VideoPlayback's allowPlaybackRef guard, whose
						// "play" listener instantly pauses unapproved playback and leaves
						// the video crawling one frame per tick.
						if (video.paused) {
							void videoPlaybackRef.current?.play().catch(() => undefined);
						}
					}
					previousVideoClip = clip;
				} else {
					previousVideoClip = null;
				}
			} else {
				video?.pause();
				previousVideoClip = null;
				lastAppliedVideoRate = null;
			}
			nextTime = Math.min(timelineDuration, nextTime);
			currentTimeRef.current = nextTime;
			const clock = { timelineMs: nextTime * 1000, sourceMs };
			videoPlaybackRef.current?.updateTransportClock(
				clock.timelineMs,
				clock.sourceMs,
				sourceActive,
			);
			const reachedEnd = nextTime >= timelineDuration;
			publishReactSnapshot(clock, timestamp, reachedEnd);
			if (reachedEnd) {
				setIsPlaying(false);
				video?.pause();
				return;
			}
			animationFrame = requestAnimationFrame(tick);
		};
		animationFrame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(animationFrame);
			// Covers the isPlaying → false transition: the pause side of the toggle
			// only flips state, so the media elements are stopped here.
			videoPlaybackRef.current?.pause();
		};
	}, [
		isPlaying,
		publishCurrentTime,
		timelineDuration,
		timelineMapper,
		videoTrackClips,
		videoTrackHidden,
	]);

	const currentProjectMedia = useMemo<ProjectMedia | null>(() => {
		const screenVideoPath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
		if (!screenVideoPath) {
			return null;
		}

		const webcamSourcePath =
			webcamVideoSourcePath ?? (webcamVideoPath ? fromFileUrl(webcamVideoPath) : null);
		return {
			screenVideoPath,
			...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
			...(webcamSourcePath && webcamSync ? { webcamSync } : {}),
			...(recordingCursorCaptureMode ? { cursorCaptureMode: recordingCursorCaptureMode } : {}),
			...(recordingAudioTracks?.length ? { audioTracks: recordingAudioTracks } : {}),
		};
	}, [
		videoPath,
		videoSourcePath,
		webcamVideoPath,
		webcamVideoSourcePath,
		webcamSync,
		recordingCursorCaptureMode,
		recordingAudioTracks,
	]);

	const applyLoadedProject = useCallback(
		async (candidate: unknown, path?: string | null) => {
			if (!validateProjectData(candidate)) {
				return false;
			}

			const project = candidate;
			const projectMedia = resolveProjectMedia(project);
			if (!projectMedia) {
				return false;
			}
			const sourcePath = projectMedia.screenVideoPath;
			const webcamSourcePath = projectMedia.webcamVideoPath ?? null;
			const projectWebcamSync = projectMedia.webcamSync ?? null;
			const projectCursorCaptureMode = projectMedia.cursorCaptureMode ?? null;
			const projectAudioTracks = await resolvePhysicalAudioTracks(sourcePath, projectMedia);
			let normalizedEditor = normalizeProjectEditor(project.editor);
			if (project.version < 4 && normalizedEditor.trimRegions.length > 0) {
				const legacyTrims = normalizedEditor.trimRegions;
				normalizedEditor = {
					...normalizedEditor,
					videoTrackClips: [],
					audioTrackClips: [],
					zoomRegions: migrateLegacyEffectTimes(normalizedEditor.zoomRegions, legacyTrims),
					speedRegions: migrateLegacyEffectTimes(normalizedEditor.speedRegions, legacyTrims),
					annotationRegions: migrateLegacyEffectTimes(
						normalizedEditor.annotationRegions,
						legacyTrims,
					),
				};
			}
			if (projectAudioTracks) {
				normalizedEditor = {
					...normalizedEditor,
					audioTrackClips: reconcileAudioTrackClips(
						normalizedEditor.audioTrackClips,
						projectAudioTracks,
					),
				};
			}
			const inferredDurationMs = Math.max(
				0,
				...normalizedEditor.zoomRegions.map((region) => region.endMs),
				...normalizedEditor.trimRegions.map((region) => region.endMs),
				...normalizedEditor.speedRegions.map((region) => region.endMs),
				...normalizedEditor.annotationRegions.map((region) => region.endMs),
				...normalizedEditor.videoTrackClips.map((clip) => clip.endMs),
				...normalizedEditor.audioTrackClips.map((clip) => clip.endMs),
			);

			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// no-op
			}
			setIsPlaying(false);
			publishCurrentTime(0);
			setDuration(inferredDurationMs > 0 ? inferredDurationMs / 1000 : 0);

			setError(null);
			setVideoSourcePath(sourcePath);
			setVideoPath(toFileUrl(sourcePath));
			audioTracksInitializedForSourceRef.current = null;
			setWebcamVideoSourcePath(webcamSourcePath);
			setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
			setWebcamSync(projectWebcamSync);
			setRecordingCursorCaptureMode(projectCursorCaptureMode);
			setRecordingAudioTracks(projectAudioTracks);
			setCurrentProjectPath(path ?? null);

			// A loaded project keeps its zooms exactly as saved, so never auto-suggest
			// over it (even if it has zero zooms because the user deleted them all).
			autoProcessedSourceRef.current = sourcePath;

			pushState({
				wallpaper: normalizedEditor.wallpaper,
				backgroundMode: normalizedEditor.backgroundMode,
				shadowIntensity: normalizedEditor.shadowIntensity,
				showBlur: normalizedEditor.showBlur,
				showTrimWaveform: normalizedEditor.showTrimWaveform,
				motionBlurAmount: normalizedEditor.motionBlurAmount,
				borderRadius: normalizedEditor.borderRadius,
				padding: normalizedEditor.padding,
				cropRegion: normalizedEditor.cropRegion,
				zoomRegions: normalizedEditor.zoomRegions,
				autoZoomEnabled: normalizedEditor.autoZoomEnabled,
				autoFocusAll: normalizedEditor.autoFocusAll,
				smartCursorEnabled: normalizedEditor.smartCursorEnabled,
				trimRegions: normalizedEditor.trimRegions,
				speedRegions: normalizedEditor.speedRegions,
				annotationRegions: normalizedEditor.annotationRegions,
				audioTrackClips: normalizedEditor.audioTrackClips,
				voiceover: normalizedEditor.voiceover ?? null,
				videoTrackClips: normalizedEditor.videoTrackClips,
				timelineTracks: normalizedEditor.timelineTracks,
				aspectRatio: normalizedEditor.aspectRatio,
				webcamLayoutPreset: normalizedEditor.webcamLayoutPreset,
				webcamMaskShape: normalizedEditor.webcamMaskShape,
				webcamMirrored: normalizedEditor.webcamMirrored,
				webcamReactiveZoom: normalizedEditor.webcamReactiveZoom,
				webcamSizePreset: normalizedEditor.webcamSizePreset,
				webcamPosition: normalizedEditor.webcamPosition,
			});
			setExportQuality(normalizedEditor.exportQuality);
			setExportFormat(normalizedEditor.exportFormat);
			setGifFrameRate(normalizedEditor.gifFrameRate);
			setGifLoop(normalizedEditor.gifLoop);
			setGifSizePreset(normalizedEditor.gifSizePreset);
			setCursorTheme(normalizedEditor.cursorTheme);

			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioTrackId(null);
			setSelectedVideoTrackId(null);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				normalizedEditor.zoomRegions.map((region) => region.id),
			);
			nextTrimIdRef.current = deriveNextId(
				"trim",
				normalizedEditor.trimRegions.map((region) => region.id),
			);
			nextSpeedIdRef.current = deriveNextId(
				"speed",
				normalizedEditor.speedRegions.map((region) => region.id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				normalizedEditor.annotationRegions.map((region) => region.id),
			);
			nextAnnotationZIndexRef.current =
				normalizedEditor.annotationRegions.reduce(
					(max, region) => Math.max(max, region.zIndex),
					0,
				) + 1;

			setLastSavedSnapshot(
				createProjectSnapshot(
					{
						screenVideoPath: sourcePath,
						...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
						...(webcamSourcePath && projectWebcamSync ? { webcamSync: projectWebcamSync } : {}),
						...(projectCursorCaptureMode ? { cursorCaptureMode: projectCursorCaptureMode } : {}),
						...(projectAudioTracks?.length ? { audioTracks: projectAudioTracks } : {}),
					},
					normalizedEditor,
				),
			);
			return true;
		},
		[publishCurrentTime, pushState],
	);

	const currentProjectSnapshot = useMemo(() => {
		if (!currentProjectMedia) {
			return null;
		}
		return createProjectSnapshot(currentProjectMedia, {
			wallpaper,
			backgroundMode,
			shadowIntensity,
			showBlur,
			showTrimWaveform,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			autoZoomEnabled,
			autoFocusAll,
			smartCursorEnabled,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioTrackClips,
			voiceover,
			videoTrackClips,
			timelineTracks,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			cursorTheme,
		});
	}, [
		currentProjectMedia,
		cursorTheme,
		voiceover,
		wallpaper,
		shadowIntensity,
		showBlur,
		showTrimWaveform,
		motionBlurAmount,
		borderRadius,
		padding,
		cropRegion,
		zoomRegions,
		autoZoomEnabled,
		autoFocusAll,
		smartCursorEnabled,
		trimRegions,
		speedRegions,
		annotationRegions,
		audioTrackClips,
		videoTrackClips,
		timelineTracks,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamMirrored,
		webcamReactiveZoom,
		webcamSizePreset,
		webcamPosition,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
	]);

	const hasUnsavedChanges = hasProjectUnsavedChanges(currentProjectSnapshot, lastSavedSnapshot);

	useEffect(() => {
		async function loadInitialData() {
			try {
				const currentProjectResult = await nativeBridgeClient.project.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						return;
					}
				}

				const currentSessionResult = await window.electronAPI.getCurrentRecordingSession();
				if (currentSessionResult.success && currentSessionResult.session) {
					const session = currentSessionResult.session;
					const sourcePath = fromFileUrl(session.screenVideoPath);
					const webcamSourcePath = session.webcamVideoPath
						? fromFileUrl(session.webcamVideoPath)
						: null;
					const sessionAudioTracks = await resolvePhysicalAudioTracks(sourcePath, session);
					setVideoSourcePath(sourcePath);
					setVideoPath(toFileUrl(sourcePath));
					setWebcamVideoSourcePath(webcamSourcePath);
					setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
					setWebcamSync(session.webcamSync ?? null);
					setRecordingCursorCaptureMode(session.cursorCaptureMode ?? null);
					setRecordingAudioTracks(sessionAudioTracks);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot(
							{
								screenVideoPath: sourcePath,
								...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
								...(webcamSourcePath && session.webcamSync
									? { webcamSync: session.webcamSync }
									: {}),
								...(session.cursorCaptureMode
									? { cursorCaptureMode: session.cursorCaptureMode }
									: {}),
								...(sessionAudioTracks?.length ? { audioTracks: sessionAudioTracks } : {}),
							},
							INITIAL_EDITOR_STATE,
						),
					);
					return;
				}

				const result = await nativeBridgeClient.project.getCurrentVideoPath();
				if (result.success && result.path) {
					setVideoSourcePath(result.path);
					setVideoPath(toFileUrl(result.path));
					setWebcamSync(null);
					setRecordingCursorCaptureMode(null);
					setRecordingAudioTracks(null);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot({ screenVideoPath: result.path }, INITIAL_EDITOR_STATE),
					);
				}
				// No video/project/session, so leave videoPath null and let the
				// EditorEmptyState dashboard render instead of an error screen.
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}

		loadInitialData();
	}, [applyLoadedProject]);

	// Seed editable media clips once duration and the physical audio layout are known.
	useEffect(() => {
		if (
			!videoSourcePath ||
			duration <= 0 ||
			audioTracksInitializedForSourceRef.current === videoSourcePath
		) {
			return;
		}
		audioTracksInitializedForSourceRef.current = videoSourcePath;
		const durationMs = Math.round(duration * 1000);
		if (audioTrackClips.length === 0 || videoTrackClips.length === 0) {
			const legacyParts = trimRegions.length
				? buildMediaClipsFromLegacyTrims(durationMs, trimRegions)
				: [{ timelineStartMs: 0, sourceStartMs: 0, durationMs }];
			pushState({
				videoTrackClips:
					videoTrackClips.length > 0
						? videoTrackClips
						: legacyParts.map((part, index) => ({
								id: `video-screen-${index + 1}`,
								startMs: part.timelineStartMs,
								endMs: part.timelineStartMs + part.durationMs,
								sourceStartMs: part.sourceStartMs,
								linkGroupId: `media-screen-${index + 1}`,
							})),
				audioTrackClips:
					audioTrackClips.length > 0
						? audioTrackClips
						: createDefaultAudioTrackClips(durationMs, recordingAudioTracks ?? undefined).flatMap(
								(track) =>
									legacyParts.map((part, index) => ({
										...track,
										id: `${track.id}-${index + 1}`,
										startMs: part.timelineStartMs,
										endMs: part.timelineStartMs + part.durationMs,
										sourceStartMs: part.sourceStartMs,
										linkGroupId: `media-screen-${index + 1}`,
									})),
							),
				trimRegions: [],
			});
		}
	}, [
		audioTrackClips,
		duration,
		pushState,
		recordingAudioTracks,
		trimRegions,
		videoSourcePath,
		videoTrackClips,
	]);

	// Avoid overwriting saved prefs with defaults before they've loaded.
	const [prefsHydrated, setPrefsHydrated] = useState(false);

	// Load persisted user preferences on mount (intentionally runs once)
	useEffect(() => {
		const prefs = loadUserPreferences();
		updateState({
			padding: prefs.padding,
			aspectRatio: prefs.aspectRatio,
		});
		setExportQuality(prefs.exportQuality);
		setExportFormat(prefs.exportFormat);
		setPrefsHydrated(true);
	}, [updateState]);

	// Auto-save user preferences when settings change
	useEffect(() => {
		if (!prefsHydrated) return;
		saveUserPreferences({ padding, aspectRatio, exportQuality, exportFormat });
	}, [prefsHydrated, padding, aspectRatio, exportQuality, exportFormat]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return false;
			}

			if (!currentProjectMedia) {
				toast.error(t("errors.unableToDetermineSourcePath"));
				return false;
			}

			const editorState = {
				wallpaper,
				backgroundMode,
				shadowIntensity,
				showBlur,
				showTrimWaveform,
				motionBlurAmount,
				borderRadius,
				padding,
				cropRegion,
				zoomRegions,
				autoZoomEnabled,
				autoFocusAll,
				smartCursorEnabled,
				trimRegions,
				speedRegions,
				annotationRegions,
				audioTrackClips,
				voiceover,
				videoTrackClips,
				timelineTracks,
				aspectRatio,
				webcamLayoutPreset,
				webcamMaskShape,
				webcamMirrored,
				webcamReactiveZoom,
				webcamSizePreset,
				webcamPosition,
				exportQuality,
				exportFormat,
				gifFrameRate,
				gifLoop,
				gifSizePreset,
				cursorTheme,
			};
			const projectData = createProjectData(currentProjectMedia, editorState);

			const fileNameBase =
				currentProjectMedia.screenVideoPath
					.split(/[\\/]/)
					.pop()
					?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
			// Normalize the same way as currentProjectSnapshot so the post-save
			// baseline compares equal and hasUnsavedChanges clears.
			const projectSnapshot = createProjectSnapshot(currentProjectMedia, editorState);
			const result = await nativeBridgeClient.project.saveProjectFile(
				projectData,
				fileNameBase,
				forceSaveAs ? undefined : (currentProjectPath ?? undefined),
			);

			if (result.canceled) {
				toast.info(t("project.saveCanceled"));
				return false;
			}

			if (!result.success) {
				toast.error(result.message || t("project.failedToSave"));
				return false;
			}

			if (result.path) {
				setCurrentProjectPath(result.path);
			}
			setLastSavedSnapshot(projectSnapshot);

			toast.success(t("project.savedTo", { path: result.path ?? "" }));
			return true;
		},
		[
			currentProjectMedia,
			currentProjectPath,
			wallpaper,
			backgroundMode,
			shadowIntensity,
			showBlur,
			showTrimWaveform,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			autoZoomEnabled,
			autoFocusAll,
			smartCursorEnabled,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioTrackClips,
			voiceover,
			videoTrackClips,
			timelineTracks,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			cursorTheme,
			videoPath,
			t,
		],
	);

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	useEffect(() => {
		const cleanup = window.electronAPI.onRequestSaveBeforeClose(async () => {
			return saveProject(false);
		});
		return () => cleanup();
	}, [saveProject]);

	useEffect(() => {
		const cleanup = window.electronAPI.onRequestCloseConfirm(() => {
			setShowCloseConfirmDialog(true);
		});
		return () => cleanup();
	}, []);

	const handleCloseConfirmSave = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("save");
	}, []);

	const handleCloseConfirmDiscard = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("discard");
	}, []);

	const handleCloseConfirmCancel = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("cancel");
	}, []);

	const handleSaveProject = useCallback(async () => {
		await saveProject(false);
	}, [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		await saveProject(true);
	}, [saveProject]);

	const handleNewRecordingConfirm = useCallback(async () => {
		const result = await window.electronAPI.startNewRecording();
		if (result.success) {
			setShowNewRecordingDialog(false);
		} else {
			console.error("Failed to start new recording:", result.error);
			setError("Failed to start new recording: " + (result.error || "Unknown error"));
		}
	}, []);

	const doLoadProject = useCallback(async () => {
		const result = await nativeBridgeClient.project.loadProjectFile(getProjectFolder());

		if (result.canceled) {
			return;
		}

		if (!result.success) {
			toast.error(result.message || t("project.failedToLoad"));
			return;
		}

		const restored = await applyLoadedProject(result.project, result.path ?? null);
		if (!restored) {
			toast.error(t("project.invalidFormat"));
			return;
		}

		if (result.path) {
			const folder = parentDirectoryOf(result.path);
			if (folder) {
				saveUserPreferences({ projectFolder: folder });
			}
		}

		toast.success(t("project.loadedFrom", { path: result.path ?? "" }));
	}, [applyLoadedProject, t]);

	const openLibraryItem = useCallback(
		async (item: MediaLibraryItem) => {
			if (item.kind === "project") {
				const result = await window.electronAPI.loadProjectFileFromPath(item.path);
				if (!result.success || !result.project) {
					toast.error(result.message || t("project.failedToLoad"));
					return;
				}
				if (!(await applyLoadedProject(result.project, result.path ?? item.path))) {
					toast.error(t("project.invalidFormat"));
					return;
				}
			} else {
				const result = await window.electronAPI.setCurrentVideoPath(item.path);
				if (!result.success) {
					toast.error(t("project.failedToLoad"));
					return;
				}
				setVideoSourcePath(item.path);
				setVideoPath(toFileUrl(item.path));
				setCurrentProjectPath(null);
			}
			setStudioView("editor");
		},
		[applyLoadedProject, t],
	);

	const handleLoadProject = useCallback(async () => {
		setStudioView("media-library");
	}, []);

	const handleLoadProjectConfirmSave = useCallback(async () => {
		setConfirmDialogVariant(null);
		const saved = await saveProject(false);
		if (saved) {
			await doLoadProject();
		}
	}, [saveProject, doLoadProject]);

	const handleLoadProjectConfirmDiscard = useCallback(async () => {
		setConfirmDialogVariant(null);
		await doLoadProject();
	}, [doLoadProject]);

	// New Project: clear all media/project/editor state back to the empty
	// Studio dashboard. Prompts to save first when there are unsaved changes.
	const doNewProject = useCallback(async () => {
		await nativeBridgeClient.project.clearCurrentVideoPath();
		setVideoPath(null);
		setVideoSourcePath(null);
		setWebcamVideoPath(null);
		setWebcamVideoSourcePath(null);
		setWebcamSync(null);
		setRecordingCursorCaptureMode(null);
		setRecordingAudioTracks(null);
		setCurrentProjectPath(null);
		setLastSavedSnapshot(null);
		// Reset undoable editor state + undo/redo history to a clean slate.
		resetState();
		// Reset non-undoable selection state.
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedSpeedId(null);
		setSelectedAnnotationId(null);
		setSelectedBlurId(null);
		setSelectedAudioTrackId(null);
		// Reset playback.
		publishCurrentTime(0);
		setIsPlaying(false);
		// Reset cursor preferences to defaults.
		setShowCursor(DEFAULT_CURSOR_SETTINGS.show);
		setCursorSize(DEFAULT_CURSOR_SETTINGS.size);
		setCursorSmoothing(DEFAULT_CURSOR_SETTINGS.smoothing);
		setCursorMotionBlur(DEFAULT_CURSOR_SETTINGS.motionBlur);
		setCursorClickBounce(DEFAULT_CURSOR_SETTINGS.clickBounce);
		setCursorClipToBounds(DEFAULT_CURSOR_SETTINGS.clipToBounds);
		setCursorTheme(DEFAULT_CURSOR_SETTINGS.theme);
		// Reset region ID counters.
		nextZoomIdRef.current = 1;
		nextTrimIdRef.current = 1;
		nextSpeedIdRef.current = 1;
		nextAnnotationIdRef.current = 1;
		nextAnnotationZIndexRef.current = 1;
	}, [publishCurrentTime, resetState]);

	const handleNewProject = useCallback(async () => {
		if (hasUnsavedChanges) {
			setConfirmDialogVariant("newProject");
			return;
		}
		await doNewProject();
	}, [hasUnsavedChanges, doNewProject]);

	const handleNewProjectConfirmSave = useCallback(async () => {
		setConfirmDialogVariant(null);
		const saved = await saveProject(false);
		if (saved) {
			await doNewProject();
		}
	}, [saveProject, doNewProject]);

	const handleNewProjectConfirmDiscard = useCallback(async () => {
		setConfirmDialogVariant(null);
		await doNewProject();
	}, [doNewProject]);

	useEffect(() => {
		const removeNewProjectListener = window.electronAPI.onMenuNewProject(handleNewProject);
		const removeLoadListener = window.electronAPI.onMenuLoadProject(handleLoadProject);
		const removeSaveListener = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAsListener = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);

		return () => {
			removeNewProjectListener?.();
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
		};
	}, [handleNewProject, handleLoadProject, handleSaveProject, handleSaveProjectAs]);

	useEffect(() => {
		let canceled = false;
		nativeBridgeClient.system
			.getPlatform()
			.then((platform) => {
				if (!canceled) {
					setNativePlatform(platform);
				}
			})
			.catch((error) => {
				console.warn("Unable to resolve native platform for cursor settings:", error);
				if (!canceled) {
					setNativePlatform(null);
				}
			});

		return () => {
			canceled = true;
		};
	}, []);

	useEffect(() => {
		if (cursorTelemetryError) {
			console.warn("Unable to load cursor telemetry:", cursorTelemetryError);
		}
	}, [cursorTelemetryError]);

	useEffect(() => {
		if (cursorRecordingDataError) {
			console.warn("Unable to load cursor recording data:", cursorRecordingDataError);
		}
	}, [cursorRecordingDataError]);

	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;
		if (videoTrackClips.length > 0) {
			if (currentTimeRef.current >= timelineDuration) handleSeek(0);
			if (isPlaying) publishCurrentTime(currentTimeRef.current);
			setIsPlaying(!isPlaying);
			return;
		}

		if (isPlaying) {
			playback.pause();
		} else {
			playback.play().catch((err) => console.error("Video play failed:", err));
		}
	}

	// Ref-stable handle so the global shortcut listener toggles playback with
	// fresh state instead of driving the raw media element.
	const togglePlayPauseRef = useRef<() => void>(() => {
		// Assigned after the playback callback is created.
	});
	useEffect(() => {
		togglePlayPauseRef.current = togglePlayPause;
	});

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen((prev) => !prev);
	}, []);

	useEffect(() => {
		if (!isFullscreen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsFullscreen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	function handleSeek(time: number) {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!video) return;
		const point = timelineMapper.videoAtTimelineTime(time * 1000);
		const sourceActive = videoTrackClips.length === 0 || (point !== null && !videoTrackHidden);
		publishCurrentTime(time);
		if (!point) {
			video.pause();
			playback?.updateTransportClock(time * 1000, video.currentTime * 1000, sourceActive);
			playback?.seekTimeline(time);
			return;
		}
		video.currentTime = point.sourceTimeMs / 1000;
		playback?.updateTransportClock(time * 1000, point.sourceTimeMs, sourceActive);
		playback?.seekTimeline(time);
	}

	const handleSelectZoom = useCallback((id: string | null) => {
		setSelectedZoomId(id);
		if (id) {
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		}
	}, []);

	const handleSelectTrim = useCallback((id: string | null) => {
		setSelectedTrimId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		}
	}, []);

	const handleSelectAnnotation = useCallback((id: string | null) => {
		setSelectedAnnotationId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedBlurId(null);
		}
	}, []);

	const handleSelectBlur = useCallback((id: string | null) => {
		setSelectedBlurId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedSpeedId(null);
		}
	}, []);

	const handleZoomAdded = useCallback(
		(span: Span) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
				focus: { cx: 0.5, cy: 0.5 },
				// Auto-Focus on means new zooms follow the cursor too.
				focusMode: autoFocusAll ? "auto" : undefined,
				source: "manual",
			};
			pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
			setSelectedZoomId(id);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState, autoFocusAll],
	);

	// Builds fresh "auto" zoom regions from cursor telemetry without overlapping
	// existing ones. Used by both the on-load auto-suggest pass and the wand toggle.
	const buildAutoZoomRegions = useCallback(
		(existingRegions: ZoomRegion[]): ZoomRegion[] => {
			const totalMs = Math.round(duration * 1000);
			if (smartCursorEnabled && cursorRecordingData) {
				const semanticPath = getSemanticCursorPathMetadata(cursorRecordingData);
				if (semanticPath?.mode === "semantic") {
					return buildSemanticZoomSuggestions({
						path: semanticPath,
						totalMs,
						existingRegions,
					}).map((suggestion) => ({
						id: `zoom-${nextZoomIdRef.current++}`,
						startMs: suggestion.span.start,
						endMs: suggestion.span.end,
						zoomInDurationMs: suggestion.zoomInDurationMs,
						depth: DEFAULT_ZOOM_DEPTH,
						customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
						focus: clampFocusToDepth(suggestion.focus, DEFAULT_ZOOM_DEPTH),
						focusMode: "auto" as const,
						source: "auto" as const,
					}));
				}
			}
			const suggestions = buildAutoZoomSuggestions({
				cursorTelemetry,
				totalMs,
				existingRegions,
				defaultDurationMs: Math.max(1000, Math.round(totalMs * 0.05)),
			});
			return suggestions.map((suggestion) => ({
				id: `zoom-${nextZoomIdRef.current++}`,
				startMs: Math.round(suggestion.span.start),
				endMs: Math.round(suggestion.span.end),
				...(smartCursorEnabled
					? {
							zoomInDurationMs: Math.min(
								700,
								Math.max(180, Math.round((suggestion.span.end - suggestion.span.start) / 2)),
							),
						}
					: {}),
				depth: DEFAULT_ZOOM_DEPTH,
				customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
				focus: clampFocusToDepth(suggestion.focus, DEFAULT_ZOOM_DEPTH),
				focusMode: smartCursorEnabled || autoFocusAll ? ("auto" as const) : undefined,
				source: "auto" as const,
			}));
		},
		[cursorTelemetry, duration, autoFocusAll, smartCursorEnabled, cursorRecordingData],
	);

	// Auto-suggest zooms once per fresh recording (no existing zooms, telemetry
	// available, wand enabled). Loaded projects are marked processed elsewhere so
	// they're never touched. The ref guard runs this once per source and survives undo.
	const autoProcessedSourceRef = useRef<string | null>(null);
	useEffect(() => {
		if (!autoZoomEnabled || !cursorTelemetrySourcePath) return;
		if (autoProcessedSourceRef.current === cursorTelemetrySourcePath) return;
		if (cursorTelemetry.length < 2 && (cursorRecordingData?.samples.length ?? 0) < 2) {
			return;
		}
		if (duration <= 0) return;
		// Only auto-suggest for a fresh recording; don't disturb existing zooms.
		if (zoomRegions.length > 0) {
			autoProcessedSourceRef.current = cursorTelemetrySourcePath;
			return;
		}
		const newRegions = buildAutoZoomRegions([]);
		autoProcessedSourceRef.current = cursorTelemetrySourcePath;
		if (newRegions.length === 0) return;
		pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, ...newRegions] }));
	}, [
		autoZoomEnabled,
		cursorTelemetrySourcePath,
		cursorTelemetry,
		cursorRecordingData,
		duration,
		zoomRegions,
		buildAutoZoomRegions,
		pushState,
	]);

	// Wand toggle: ON regenerates suggestions around existing zooms; OFF removes
	// only untouched auto zooms (manual and edited-to-manual survive).
	const handleToggleAutoZoom = useCallback(
		(enabled: boolean) => {
			if (enabled) {
				autoProcessedSourceRef.current = cursorTelemetrySourcePath;
				pushState((prev) => ({
					autoZoomEnabled: true,
					zoomRegions: [...prev.zoomRegions, ...buildAutoZoomRegions(prev.zoomRegions)],
				}));
			} else {
				pushState((prev) => ({
					autoZoomEnabled: false,
					zoomRegions: prev.zoomRegions.filter((region) => region.source !== "auto"),
				}));
			}
		},
		[pushState, buildAutoZoomRegions, cursorTelemetrySourcePath],
	);

	// Flip every zoom between auto (cursor-follow) and manual at once.
	const handleToggleAutoFocusAll = useCallback(
		(on: boolean) => {
			pushState((prev) => ({
				autoFocusAll: on,
				zoomRegions: prev.zoomRegions.map((region) => ({
					...region,
					focusMode: on ? "auto" : "manual",
				})),
			}));
		},
		[pushState],
	);

	const handleTrimAdded = useCallback(
		(span: Span) => {
			const id = `trim-${nextTrimIdRef.current++}`;
			const newRegion: TrimRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
			};
			pushState((prev) => ({ trimRegions: [...prev.trimRegions, newRegion] }));
			setSelectedTrimId(id);
			setSelectedZoomId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleZoomSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) =>
				prev.timelineTracks.some((track) => track.kind === "zoom" && track.locked)
					? {}
					: {
							zoomRegions: prev.zoomRegions.map((region) =>
								region.id === id
									? {
											...region,
											startMs: Math.round(span.start),
											endMs: Math.round(span.end),
											source: "manual",
										}
									: region,
							),
						},
			);
		},
		[pushState],
	);

	const handleTrimSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleAudioTrackSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => {
				if (prev.timelineTracks.some((track) => track.kind === "audio" && track.locked)) {
					return {};
				}
				if (isAudioMixItemId(id)) {
					const group = findAudioClipGroup(prev.audioTrackClips, id);
					if (!group) return {};
					const groupIds = new Set(group.clips.map((clip) => clip.id));
					const currentStart = group.startMs;
					const nextStart = Math.round(span.start);
					const isMove = Math.round(span.end - span.start) === group.endMs - group.startMs;
					const sourceDelta = isMove ? 0 : nextStart - currentStart;
					const linkGroups = new Set(
						group.clips
							.map((clip) => clip.linkGroupId)
							.filter((value): value is string => Boolean(value)),
					);
					return {
						audioTrackClips: prev.audioTrackClips.map((clip) =>
							groupIds.has(clip.id)
								? {
										...clip,
										startMs: nextStart,
										endMs: Math.round(span.end),
										sourceStartMs: Math.max(0, clip.sourceStartMs + sourceDelta),
									}
								: clip,
						),
						videoTrackClips: prev.timelineTracks.some(
							(track) => track.kind === "video" && track.locked,
						)
							? prev.videoTrackClips
							: prev.videoTrackClips.map((clip) =>
									clip.linkGroupId && linkGroups.has(clip.linkGroupId)
										? {
												...clip,
												startMs: nextStart,
												endMs: Math.round(span.end),
												sourceStartMs: Math.max(0, clip.sourceStartMs + sourceDelta),
											}
										: clip,
								),
					};
				}
				return {
					audioTrackClips: prev.audioTrackClips.map((clip) =>
						clip.id === id
							? { ...clip, startMs: Math.round(span.start), endMs: Math.round(span.end) }
							: clip,
					),
				};
			});
		},
		[pushState],
	);

	const handleVideoTrackSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => {
				if (prev.timelineTracks.some((track) => track.kind === "video" && track.locked)) {
					return {};
				}
				const target = prev.videoTrackClips.find((clip) => clip.id === id);
				if (!target) return {};
				const nextStartMs = Math.round(span.start);
				const isMove = Math.round(span.end - span.start) === target.endMs - target.startMs;
				const sourceDelta = isMove ? 0 : nextStartMs - target.startMs;
				return {
					videoTrackClips: prev.videoTrackClips.map((clip) => {
						if (clip.id !== id) return clip;
						return {
							...clip,
							startMs: nextStartMs,
							endMs: Math.round(span.end),
							sourceStartMs: Math.max(0, clip.sourceStartMs + sourceDelta),
						};
					}),
					audioTrackClips: prev.timelineTracks.some(
						(track) => track.kind === "audio" && track.locked,
					)
						? prev.audioTrackClips
						: prev.audioTrackClips.map((clip) =>
								target.linkGroupId && clip.linkGroupId === target.linkGroupId
									? {
											...clip,
											startMs: nextStartMs,
											endMs: Math.round(span.end),
											sourceStartMs: Math.max(0, clip.sourceStartMs + sourceDelta),
										}
									: clip,
							),
				};
			});
		},
		[pushState],
	);

	const handleBatchTimelineSpanChange = useCallback(
		(changes: Array<{ id: string; span: Span }>) => {
			pushState((prev) => {
				const changeById = new Map(changes.map((change) => [change.id, change.span]));
				const locked = (kind: string) =>
					prev.timelineTracks.some((track) => track.kind === kind && track.locked);
				const changeByLinkGroup = new Map<string, Span>();
				for (const clip of prev.videoTrackClips) {
					const span = changeById.get(clip.id);
					if (span && clip.linkGroupId) changeByLinkGroup.set(clip.linkGroupId, span);
				}
				const audioChangeByClipId = new Map<string, Span>();
				for (const group of groupAudioTrackClips(prev.audioTrackClips)) {
					const span = changeById.get(group.id);
					if (!span) continue;
					for (const clip of group.clips) {
						audioChangeByClipId.set(clip.id, span);
						if (clip.linkGroupId) changeByLinkGroup.set(clip.linkGroupId, span);
					}
				}
				return {
					videoTrackClips: locked("video")
						? prev.videoTrackClips
						: prev.videoTrackClips.map((clip) => {
								const span =
									changeById.get(clip.id) ||
									(clip.linkGroupId ? changeByLinkGroup.get(clip.linkGroupId) : undefined);
								if (!span) return clip;
								const isMove = Math.round(span.end - span.start) === clip.endMs - clip.startMs;
								return {
									...clip,
									startMs: Math.round(span.start),
									endMs: Math.round(span.end),
									sourceStartMs: Math.max(
										0,
										clip.sourceStartMs + (isMove ? 0 : Math.round(span.start) - clip.startMs),
									),
								};
							}),
					audioTrackClips: locked("audio")
						? prev.audioTrackClips
						: prev.audioTrackClips.map((clip) => {
								const span =
									audioChangeByClipId.get(clip.id) ||
									(clip.linkGroupId ? changeByLinkGroup.get(clip.linkGroupId) : undefined);
								if (!span) return clip;
								const isMove = Math.round(span.end - span.start) === clip.endMs - clip.startMs;
								return {
									...clip,
									startMs: Math.round(span.start),
									endMs: Math.round(span.end),
									sourceStartMs: Math.max(
										0,
										clip.sourceStartMs + (isMove ? 0 : Math.round(span.start) - clip.startMs),
									),
								};
							}),
					zoomRegions: locked("zoom")
						? prev.zoomRegions
						: prev.zoomRegions.map((region) => {
								const span = changeById.get(region.id);
								return span
									? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
									: region;
							}),
					annotationRegions: prev.annotationRegions.map((region) => {
						const kind = region.type === "blur" ? "blur" : "annotation";
						const span = locked(kind) ? undefined : changeById.get(region.id);
						return span
							? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
							: region;
					}),
					speedRegions: locked("speed")
						? prev.speedRegions
						: prev.speedRegions.map((region) => {
								const span = changeById.get(region.id);
								return span
									? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
									: region;
							}),
				};
			});
		},
		[pushState],
	);

	const handleVideoTrackDelete = useCallback(
		(id: string) => {
			pushState((prev) => {
				if (
					prev.timelineTracks.some(
						(track) => (track.kind === "video" || track.kind === "audio") && track.locked,
					)
				)
					return {};
				const video = prev.videoTrackClips.find((clip) => clip.id === id);
				if (!video) return {};
				return {
					videoTrackClips: prev.videoTrackClips.filter((clip) => clip.id !== id),
					audioTrackClips: prev.audioTrackClips.filter(
						(clip) => clip.startMs !== video.startMs || clip.endMs !== video.endMs,
					),
				};
			});
			if (selectedVideoTrackId === id) setSelectedVideoTrackId(null);
		},
		[pushState, selectedVideoTrackId],
	);

	const handleSelectVideoTrack = useCallback((id: string | null) => {
		setSelectedVideoTrackId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedAudioTrackId(null);
		}
	}, []);

	const handleAudioTrackDelete = useCallback(
		(id: string) => {
			pushState((prev) => {
				if (
					prev.timelineTracks.some(
						(track) => (track.kind === "video" || track.kind === "audio") && track.locked,
					)
				)
					return {};
				const group = isAudioMixItemId(id) ? findAudioClipGroup(prev.audioTrackClips, id) : null;
				const ids = new Set(group?.clips.map((clip) => clip.id) ?? [id]);
				return {
					audioTrackClips: prev.audioTrackClips.filter((clip) => !ids.has(clip.id)),
					videoTrackClips: group
						? prev.videoTrackClips.filter(
								(clip) => clip.startMs !== group.startMs || clip.endMs !== group.endMs,
							)
						: prev.videoTrackClips,
				};
			});
			if (selectedAudioTrackId === id) setSelectedAudioTrackId(null);
		},
		[pushState, selectedAudioTrackId],
	);

	const handleSelectAudioTrack = useCallback((id: string | null) => {
		setSelectedAudioTrackId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		}
	}, []);

	const handleRippleDeleteTimelineItem = useCallback(
		(id: string) => {
			pushState((prev) => {
				const video = prev.videoTrackClips.find((clip) => clip.id === id);
				const audio = isAudioMixItemId(id) ? findAudioClipGroup(prev.audioTrackClips, id) : null;
				const zoom = prev.zoomRegions.find((region) => region.id === id);
				const annotation = prev.annotationRegions.find((region) => region.id === id);
				const speed = prev.speedRegions.find((region) => region.id === id);
				const target = video || audio || zoom || annotation || speed;
				if (!target) return {};
				const lockedKinds =
					video || audio
						? new Set(["video", "audio"])
						: new Set([
								zoom
									? "zoom"
									: annotation?.type === "blur"
										? "blur"
										: annotation
											? "annotation"
											: "speed",
							]);
				if (prev.timelineTracks.some((track) => lockedKinds.has(track.kind) && track.locked)) {
					return {};
				}
				const startMs = target.startMs;
				const endMs = target.endMs;
				const deltaMs = endMs - startMs;
				const shift = <T extends { startMs: number; endMs: number }>(item: T): T =>
					item.startMs >= endMs
						? { ...item, startMs: item.startMs - deltaMs, endMs: item.endMs - deltaMs }
						: item;
				const audioIds = new Set(audio?.clips.map((clip) => clip.id) ?? []);
				return {
					videoTrackClips: prev.videoTrackClips
						.filter((clip) =>
							video || audio ? clip.startMs !== startMs || clip.endMs !== endMs : true,
						)
						.map(shift),
					audioTrackClips: prev.audioTrackClips
						.filter((clip) =>
							video
								? clip.startMs !== startMs || clip.endMs !== endMs
								: audio
									? !audioIds.has(clip.id)
									: true,
						)
						.map(shift),
					zoomRegions: prev.zoomRegions.filter((region) => region.id !== id).map(shift),
					annotationRegions: prev.annotationRegions.filter((region) => region.id !== id).map(shift),
					speedRegions: prev.speedRegions.filter((region) => region.id !== id).map(shift),
				};
			});
			setSelectedVideoTrackId(null);
			setSelectedAudioTrackId(null);
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedSpeedId(null);
		},
		[pushState],
	);

	const handleDeleteTimelineItems = useCallback(
		(ids: string[], ripple: boolean) => {
			const selected = new Set(ids);
			pushState((prev) => {
				const locked = (kind: string) =>
					prev.timelineTracks.some((track) => track.kind === kind && track.locked);
				const deleteVideoIds = new Set<string>();
				const deleteAudioIds = new Set<string>();
				const intervals: Array<{ startMs: number; endMs: number }> = [];

				if (!locked("video") && !locked("audio")) {
					for (const clip of prev.videoTrackClips) {
						if (!selected.has(clip.id)) continue;
						deleteVideoIds.add(clip.id);
						intervals.push(clip);
						for (const audio of prev.audioTrackClips) {
							if (audio.startMs === clip.startMs && audio.endMs === clip.endMs) {
								deleteAudioIds.add(audio.id);
							}
						}
					}
					for (const group of groupAudioTrackClips(prev.audioTrackClips)) {
						if (!selected.has(group.id)) continue;
						intervals.push(group);
						for (const audio of group.clips) deleteAudioIds.add(audio.id);
						for (const video of prev.videoTrackClips) {
							if (video.startMs === group.startMs && video.endMs === group.endMs) {
								deleteVideoIds.add(video.id);
							}
						}
					}
				}

				const deletedZoomIds = locked("zoom") ? new Set<string>() : selected;
				const deletedSpeedIds = locked("speed") ? new Set<string>() : selected;
				for (const region of prev.zoomRegions) {
					if (deletedZoomIds.has(region.id)) intervals.push(region);
				}
				for (const region of prev.speedRegions) {
					if (deletedSpeedIds.has(region.id)) intervals.push(region);
				}
				for (const region of prev.annotationRegions) {
					const kind = region.type === "blur" ? "blur" : "annotation";
					if (selected.has(region.id) && !locked(kind)) intervals.push(region);
				}

				const merged = intervals
					.map((interval) => ({ startMs: interval.startMs, endMs: interval.endMs }))
					.sort((left, right) => left.startMs - right.startMs)
					.reduce<Array<{ startMs: number; endMs: number }>>((result, interval) => {
						const previous = result[result.length - 1];
						if (previous && interval.startMs <= previous.endMs) {
							previous.endMs = Math.max(previous.endMs, interval.endMs);
						} else result.push({ ...interval });
						return result;
					}, []);
				const shift = <T extends { startMs: number; endMs: number }>(item: T): T => {
					if (!ripple) return item;
					const delta = merged
						.filter((interval) => interval.endMs <= item.startMs)
						.reduce((total, interval) => total + interval.endMs - interval.startMs, 0);
					return delta
						? { ...item, startMs: item.startMs - delta, endMs: item.endMs - delta }
						: item;
				};

				return {
					videoTrackClips: prev.videoTrackClips
						.filter((clip) => !deleteVideoIds.has(clip.id))
						.map(shift),
					audioTrackClips: prev.audioTrackClips
						.filter((clip) => !deleteAudioIds.has(clip.id))
						.map(shift),
					zoomRegions: prev.zoomRegions
						.filter((region) => !deletedZoomIds.has(region.id))
						.map(shift),
					annotationRegions: prev.annotationRegions
						.filter((region) => {
							const kind = region.type === "blur" ? "blur" : "annotation";
							return !selected.has(region.id) || locked(kind);
						})
						.map(shift),
					speedRegions: prev.speedRegions
						.filter((region) => !deletedSpeedIds.has(region.id))
						.map(shift),
				};
			});
			setSelectedVideoTrackId(null);
			setSelectedAudioTrackId(null);
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
			setSelectedSpeedId(null);
		},
		[pushState],
	);

	const handleCutTimelineItem = useCallback(
		(id: string, cutMs: number) => {
			pushState((prev) => {
				const isLocked = (kind: string) =>
					prev.timelineTracks.some((track) => track.kind === kind && track.locked);
				if (
					(prev.videoTrackClips.some((clip) => clip.id === id) || isAudioMixItemId(id)) &&
					!isLocked("video") &&
					!isLocked("audio")
				) {
					const result = splitLinkedMedia(
						prev.videoTrackClips,
						prev.audioTrackClips,
						Math.round(cutMs),
						(kind, originalId, side) => `${kind}-${side}-${originalId}-${crypto.randomUUID()}`,
					);
					return result.didSplit
						? {
								videoTrackClips: result.videoTrackClips,
								audioTrackClips: result.audioTrackClips,
							}
						: {};
				}

				if (!isLocked("zoom")) {
					const region = prev.zoomRegions.find((candidate) => candidate.id === id);
					if (region) {
						const split = splitTimedRegion(
							region,
							Math.round(cutMs),
							(side) => `zoom-${side}-${crypto.randomUUID()}`,
						);
						if (split) {
							return {
								zoomRegions: prev.zoomRegions.flatMap((item) => (item.id === id ? split : [item])),
							};
						}
					}
				}

				const annotation = prev.annotationRegions.find((candidate) => candidate.id === id);
				if (annotation && !isLocked(annotation.type === "blur" ? "blur" : "annotation")) {
					const split = splitTimedRegion(
						annotation,
						Math.round(cutMs),
						(side) => `annotation-${side}-${crypto.randomUUID()}`,
					);
					if (split) {
						return {
							annotationRegions: prev.annotationRegions.flatMap((item) =>
								item.id === id ? split : [item],
							),
						};
					}
				}

				if (!isLocked("speed")) {
					const region = prev.speedRegions.find((candidate) => candidate.id === id);
					if (region) {
						const split = splitTimedRegion(
							region,
							Math.round(cutMs),
							(side) => `speed-${side}-${crypto.randomUUID()}`,
						);
						if (split) {
							return {
								speedRegions: prev.speedRegions.flatMap((item) =>
									item.id === id ? split : [item],
								),
							};
						}
					}
				}
				return {};
			});
		},
		[pushState],
	);

	const handleCutTimelineItems = useCallback(
		(ids: string[], cutMs: number) => {
			const selected = new Set(ids);
			pushState((prev) => {
				const locked = (kind: string) =>
					prev.timelineTracks.some((track) => track.kind === kind && track.locked);
				let nextVideo = prev.videoTrackClips;
				let nextAudio = prev.audioTrackClips;
				const hasSelectedMedia =
					prev.videoTrackClips.some((clip) => selected.has(clip.id)) || ids.some(isAudioMixItemId);
				if (hasSelectedMedia && !locked("video") && !locked("audio")) {
					const split = splitLinkedMedia(
						prev.videoTrackClips,
						prev.audioTrackClips,
						Math.round(cutMs),
						(kind, originalId, side) => `${kind}-${side}-${originalId}-${crypto.randomUUID()}`,
					);
					nextVideo = split.videoTrackClips;
					nextAudio = split.audioTrackClips;
				}
				return {
					videoTrackClips: nextVideo,
					audioTrackClips: nextAudio,
					zoomRegions: locked("zoom")
						? prev.zoomRegions
						: prev.zoomRegions.flatMap((region) => {
								if (!selected.has(region.id)) return [region];
								return (
									splitTimedRegion(
										region,
										Math.round(cutMs),
										(side) => `zoom-${side}-${crypto.randomUUID()}`,
									) ?? [region]
								);
							}),
					annotationRegions: prev.annotationRegions.flatMap((region) => {
						const kind = region.type === "blur" ? "blur" : "annotation";
						if (!selected.has(region.id) || locked(kind)) return [region];
						return (
							splitTimedRegion(
								region,
								Math.round(cutMs),
								(side) => `${kind}-${side}-${crypto.randomUUID()}`,
							) ?? [region]
						);
					}),
					speedRegions: locked("speed")
						? prev.speedRegions
						: prev.speedRegions.flatMap((region) => {
								if (!selected.has(region.id)) return [region];
								return (
									splitTimedRegion(
										region,
										Math.round(cutMs),
										(side) => `speed-${side}-${crypto.randomUUID()}`,
									) ?? [region]
								);
							}),
				};
			});
		},
		[pushState],
	);

	const handleCopyTimelineItems = useCallback(
		(ids: string[]) => {
			const selected = new Set(ids);
			const selectedVideo = videoTrackClips.filter((clip) => selected.has(clip.id));
			const selectedAudioGroups = groupAudioTrackClips(audioTrackClips).filter((group) =>
				selected.has(group.id),
			);
			const linkedSpans = [
				...selectedVideo.map((clip) => ({ startMs: clip.startMs, endMs: clip.endMs })),
				...selectedAudioGroups.map((group) => ({ startMs: group.startMs, endMs: group.endMs })),
			];
			const hasLinkedSpan = (startMs: number, endMs: number) =>
				linkedSpans.some((span) => span.startMs === startMs && span.endMs === endMs);
			const copiedVideo = videoTrackClips.filter(
				(clip) => selected.has(clip.id) || hasLinkedSpan(clip.startMs, clip.endMs),
			);
			const copiedAudio = audioTrackClips.filter((clip) => hasLinkedSpan(clip.startMs, clip.endMs));
			const copiedZoom = zoomRegions.filter((region) => selected.has(region.id));
			const copiedAnnotations = annotationRegions.filter((region) => selected.has(region.id));
			const copiedSpeed = speedRegions.filter((region) => selected.has(region.id));
			const starts = [
				...copiedVideo.map((item) => item.startMs),
				...copiedAudio.map((item) => item.startMs),
				...copiedZoom.map((item) => item.startMs),
				...copiedAnnotations.map((item) => item.startMs),
				...copiedSpeed.map((item) => item.startMs),
			];
			if (starts.length === 0) return;
			timelineClipboardRef.current = {
				originStartMs: Math.min(...starts),
				videoTrackClips: copiedVideo,
				audioTrackClips: copiedAudio,
				zoomRegions: copiedZoom,
				annotationRegions: copiedAnnotations,
				speedRegions: copiedSpeed,
			};
		},
		[audioTrackClips, annotationRegions, speedRegions, videoTrackClips, zoomRegions],
	);

	const handleCopyTimelineItem = useCallback(
		(id: string) => handleCopyTimelineItems([id]),
		[handleCopyTimelineItems],
	);

	const handlePasteTimelineItems = useCallback(
		(atMs: number) => {
			const payload = timelineClipboardRef.current;
			if (!payload) return;
			const deltaMs = Math.round(atMs - payload.originStartMs);
			const linkGroupIds = new Map<string, string>();
			const copiedLinkGroup = (linkGroupId?: string) => {
				if (!linkGroupId) return undefined;
				const existing = linkGroupIds.get(linkGroupId);
				if (existing) return existing;
				const created = `media-copy-${crypto.randomUUID()}`;
				linkGroupIds.set(linkGroupId, created);
				return created;
			};
			const move = <T extends { id: string; startMs: number; endMs: number }>(
				item: T,
				kind: string,
			): T => ({
				...item,
				id: `${kind}-${crypto.randomUUID()}`,
				startMs: Math.max(0, item.startMs + deltaMs),
				endMs: Math.max(1, item.endMs + deltaMs),
			});
			pushState((prev) => ({
				videoTrackClips: [
					...prev.videoTrackClips,
					...payload.videoTrackClips.map((item) => ({
						...move(item, "video-copy"),
						linkGroupId: copiedLinkGroup(item.linkGroupId),
					})),
				],
				audioTrackClips: [
					...prev.audioTrackClips,
					...payload.audioTrackClips.map((item) => ({
						...move(item, "audio-copy"),
						linkGroupId: copiedLinkGroup(item.linkGroupId),
					})),
				],
				zoomRegions: [
					...prev.zoomRegions,
					...payload.zoomRegions.map((item) => move(item, "zoom-copy")),
				],
				annotationRegions: [
					...prev.annotationRegions,
					...payload.annotationRegions.map((item) => move(item, "annotation-copy")),
				],
				speedRegions: [
					...prev.speedRegions,
					...payload.speedRegions.map((item) => move(item, "speed-copy")),
				],
			}));
		},
		[pushState],
	);

	const handleDuplicateTimelineItems = useCallback(
		(ids: string[]) => {
			handleCopyTimelineItems(ids);
			const payload = timelineClipboardRef.current;
			if (!payload) return;
			const endMs = Math.max(
				...payload.videoTrackClips.map((item) => item.endMs),
				...payload.audioTrackClips.map((item) => item.endMs),
				...payload.zoomRegions.map((item) => item.endMs),
				...payload.annotationRegions.map((item) => item.endMs),
				...payload.speedRegions.map((item) => item.endMs),
			);
			handlePasteTimelineItems(endMs);
		},
		[handleCopyTimelineItems, handlePasteTimelineItems],
	);

	const handleDuplicateTimelineItem = useCallback(
		(id: string) => handleDuplicateTimelineItems([id]),
		[handleDuplicateTimelineItems],
	);

	// Focus drag: updateState for live preview, commitState on pointer-up.
	const handleZoomFocusChange = useCallback(
		(id: string, focus: ZoomFocus) => {
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id
						? { ...region, focus: clampFocusToDepth(focus, region.depth), source: "manual" }
						: region,
				),
			}));
		},
		[updateState],
	);

	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? {
								...region,
								depth,
								customScale: ZOOM_DEPTH_SCALES[depth],
								focus: clampFocusToDepth(region.focus, depth),
								source: "manual",
							}
						: region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomCustomScaleChange = useCallback(
		(scale: number) => {
			if (!selectedZoomId) return;
			const rounded = Math.round(scale * 100) / 100;
			if (!Number.isFinite(rounded)) return;
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? { ...region, customScale: rounded, source: "manual" }
						: region,
				),
			}));
		},
		[selectedZoomId, updateState],
	);

	const handleZoomCustomScaleCommit = useCallback(() => {
		commitState();
	}, [commitState]);

	const handleZoomFocusModeChange = useCallback(
		(focusMode: ZoomFocusMode) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId ? { ...region, focusMode, source: "manual" } : region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomDelete = useCallback(
		(id: string) => {
			pushState((prev) =>
				prev.timelineTracks.some((track) => track.kind === "zoom" && track.locked)
					? {}
					: { zoomRegions: prev.zoomRegions.filter((r) => r.id !== id) },
			);
			if (selectedZoomId === id) {
				setSelectedZoomId(null);
			}
		},
		[selectedZoomId, pushState],
	);

	const handleZoomRotationPresetChange = useCallback(
		(preset: Rotation3DPreset | null) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) => {
					if (region.id !== selectedZoomId) return region;
					if (preset === null) {
						const { rotationPreset: _p, ...rest } = region;
						return { ...rest, source: "manual" };
					}
					return { ...region, rotationPreset: preset, source: "manual" };
				}),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleTrimDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.filter((r) => r.id !== id),
			}));
			if (selectedTrimId === id) {
				setSelectedTrimId(null);
			}
		},
		[selectedTrimId, pushState],
	);

	const handleSelectSpeed = useCallback((id: string | null) => {
		setSelectedSpeedId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		}
	}, []);

	const handleSpeedAdded = useCallback(
		(span: Span) => {
			const id = `speed-${nextSpeedIdRef.current++}`;
			const newRegion: SpeedRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				speed: DEFAULT_PLAYBACK_SPEED,
			};
			pushState((prev) => ({
				speedRegions: [...prev.speedRegions, newRegion],
			}));
			setSelectedSpeedId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleSpeedSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) =>
				prev.timelineTracks.some((track) => track.kind === "speed" && track.locked)
					? {}
					: {
							speedRegions: prev.speedRegions.map((region) =>
								region.id === id
									? {
											...region,
											startMs: Math.round(span.start),
											endMs: Math.round(span.end),
										}
									: region,
							),
						},
			);
		},
		[pushState],
	);

	const handleSpeedDelete = useCallback(
		(id: string) => {
			pushState((prev) =>
				prev.timelineTracks.some((track) => track.kind === "speed" && track.locked)
					? {}
					: { speedRegions: prev.speedRegions.filter((region) => region.id !== id) },
			);
			if (selectedSpeedId === id) {
				setSelectedSpeedId(null);
			}
		},
		[selectedSpeedId, pushState],
	);

	const handleSpeedChange = useCallback(
		(speed: PlaybackSpeed) => {
			if (!selectedSpeedId) return;
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === selectedSpeedId ? { ...region, speed } : region,
				),
			}));
		},
		[selectedSpeedId, pushState],
	);

	const handleAnnotationAdded = useCallback(
		(span: Span) => {
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type: "text",
				content: "Enter text...",
				position: { ...DEFAULT_ANNOTATION_POSITION },
				size: { ...DEFAULT_ANNOTATION_SIZE },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
			};
			pushState((prev) => ({
				annotationRegions: [...prev.annotationRegions, newRegion],
			}));
			setSelectedAnnotationId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleBlurAdded = useCallback(
		(span: Span) => {
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type: "blur",
				content: "",
				position: { ...DEFAULT_ANNOTATION_POSITION },
				size: { ...DEFAULT_ANNOTATION_SIZE },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
				blurData: { ...DEFAULT_BLUR_DATA },
			};
			pushState((prev) => ({
				annotationRegions: [...prev.annotationRegions, newRegion],
			}));
			setSelectedBlurId(id);
			setSelectedAnnotationId(null);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
		},
		[pushState],
	);

	const handleAnnotationSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => {
				const target = prev.annotationRegions.find((region) => region.id === id);
				const kind = target?.type === "blur" ? "blur" : "annotation";
				if (prev.timelineTracks.some((track) => track.kind === kind && track.locked)) {
					return {};
				}
				const editedAutoCaption =
					prev.annotationRegions.find((region) => region.id === id)?.annotationSource ===
					"auto-caption";
				const next = prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				);
				return {
					annotationRegions: editedAutoCaption ? reconcileAutoCaptionTimelineGaps(next) : next,
				};
			});
		},
		[pushState],
	);

	const handleAnnotationDuplicate = useCallback(
		(id: string) => {
			const duplicateId = `annotation-${nextAnnotationIdRef.current++}`;
			const duplicateZIndex = nextAnnotationZIndexRef.current++;
			pushState((prev) => {
				const source = prev.annotationRegions.find((region) => region.id === id);
				if (!source) return {};

				const { annotationSource: _stripCaptionLink, ...sourceWithoutCaptionLink } = source;

				const duplicate: AnnotationRegion = {
					...sourceWithoutCaptionLink,
					id: duplicateId,
					zIndex: duplicateZIndex,
					position: { x: source.position.x + 4, y: source.position.y + 4 },
					size: { ...source.size },
					style: { ...source.style },
					figureData: source.figureData ? { ...source.figureData } : undefined,
				};

				return { annotationRegions: [...prev.annotationRegions, duplicate] };
			});
			setSelectedAnnotationId(duplicateId);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedBlurId(null);
		},
		[pushState],
	);

	const handleAnnotationDelete = useCallback(
		(id: string) => {
			pushState((prev) => {
				const target = prev.annotationRegions.find((region) => region.id === id);
				const kind = target?.type === "blur" ? "blur" : "annotation";
				return prev.timelineTracks.some((track) => track.kind === kind && track.locked)
					? {}
					: { annotationRegions: prev.annotationRegions.filter((r) => r.id !== id) };
			});
			if (selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
			}
			if (selectedBlurId === id) {
				setSelectedBlurId(null);
			}
		},
		[selectedAnnotationId, selectedBlurId, pushState],
	);

	const handleAnnotationContentChange = useCallback(
		(id: string, content: string) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) => {
					if (region.id !== id) return region;
					if (region.type === "text") {
						return { ...region, content, textContent: content };
					} else if (region.type === "image") {
						return { ...region, content, imageContent: content };
					}
					return { ...region, content };
				}),
			}));
		},
		[pushState],
	);

	const handleAnnotationTypeChange = useCallback(
		(id: string, type: AnnotationRegion["type"]) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) => {
					if (region.id !== id) return region;
					const updatedRegion = { ...region, type };
					if (type === "text") {
						updatedRegion.content = region.textContent || "Enter text...";
					} else if (type === "image") {
						updatedRegion.content = region.imageContent || "";
					} else if (type === "figure") {
						updatedRegion.content = "";
						if (!region.figureData) {
							updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
						}
					} else if (type === "blur") {
						updatedRegion.content = "";
						if (!region.blurData) {
							updatedRegion.blurData = { ...DEFAULT_BLUR_DATA };
						}
					}
					return updatedRegion;
				}),
			}));

			if (type === "blur" && selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
				setSelectedBlurId(id);
				setSelectedSpeedId(null);
			} else if (type !== "blur" && selectedBlurId === id) {
				setSelectedBlurId(null);
				setSelectedAnnotationId(id);
			}
		},
		[pushState, selectedAnnotationId, selectedBlurId],
	);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			pushState((prev) => {
				const touched = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = touched?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, style: { ...region.style, ...style } };
						}
						return region.id === id ? { ...region, style: { ...region.style, ...style } } : region;
					}),
				};
			});
		},
		[pushState],
	);

	const handleAnnotationFigureDataChange = useCallback(
		(id: string, figureData: FigureData) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, figureData } : region,
				),
			}));
		},
		[pushState],
	);

	const handleBlurDataPreviewChange = useCallback(
		(id: string, blurData: BlurData) => {
			updateState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								// Freehand drawing area is the full video surface.
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[updateState],
	);

	const handleBlurDataPanelChange = useCallback(
		(id: string, blurData: BlurData) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => {
			pushState((prev) => {
				const moved = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = moved?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, position };
						}
						return region.id === id ? { ...region, position } : region;
					}),
				};
			});
		},
		[pushState],
	);

	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => {
			pushState((prev) => {
				const resized = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = resized?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, size };
						}
						return region.id === id ? { ...region, size } : region;
					}),
				};
			});
		},
		[pushState],
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			const key = e.key.toLowerCase();

			if (mod && key === "z" && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				undo();
				return;
			}
			if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
				e.preventDefault();
				e.stopPropagation();
				redo();
				return;
			}

			// Frame-step navigation (arrow keys, no modifiers)
			if (
				(e.key === "ArrowLeft" || e.key === "ArrowRight") &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.shiftKey &&
				!e.altKey
			) {
				const target = e.target;
				if (
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement ||
					(target instanceof HTMLElement &&
						(target.isContentEditable ||
							target.closest('[role="separator"], [role="slider"], [role="spinbutton"]')))
				) {
					return;
				}
				e.preventDefault();
				const video = videoPlaybackRef.current?.video;
				if (!video) {
					return;
				}
				const direction = e.key === "ArrowLeft" ? "backward" : "forward";
				const newTime = computeFrameStepTime(
					video.currentTime,
					Number.isFinite(video.duration) ? video.duration : durationRef.current,
					direction,
				);
				video.currentTime = newTime;
				return;
			}

			const isInput =
				e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

			if (e.key === "Tab" && !isInput) {
				e.preventDefault();
			}

			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				// Let space pass through inside inputs/textareas.
				if (isInput) {
					return;
				}
				e.preventDefault();
				togglePlayPauseRef.current();
			}
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [undo, redo, shortcuts, isMac]);

	useEffect(() => {
		if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
			setSelectedZoomId(null);
		}
	}, [selectedZoomId, zoomRegions]);

	useEffect(() => {
		if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
			setSelectedTrimId(null);
		}
	}, [selectedTrimId, trimRegions]);

	useEffect(() => {
		if (
			selectedAnnotationId &&
			!annotationOnlyRegions.some((region) => region.id === selectedAnnotationId)
		) {
			setSelectedAnnotationId(null);
		}
		if (selectedBlurId && !blurRegions.some((region) => region.id === selectedBlurId)) {
			setSelectedBlurId(null);
		}
	}, [selectedAnnotationId, selectedBlurId, annotationOnlyRegions, blurRegions]);

	useEffect(() => {
		if (selectedSpeedId && !speedRegions.some((region) => region.id === selectedSpeedId)) {
			setSelectedSpeedId(null);
		}
	}, [selectedSpeedId, speedRegions]);

	const handleShowExportedFile = useCallback(async (filePath: string) => {
		try {
			const result = await window.electronAPI.revealInFolder(filePath);
			if (!result.success) {
				const errorMessage = result.error || result.message || "Failed to reveal item in folder.";
				console.error("Failed to reveal in folder:", errorMessage);
				toast.error(errorMessage);
			}
		} catch (error) {
			const errorMessage = String(error);
			console.error("Error calling revealInFolder IPC:", errorMessage);
			toast.error(`Error revealing in folder: ${errorMessage}`);
		}
	}, []);

	const handleExportSaved = useCallback(
		(formatLabel: "GIF" | "Video", filePath: string) => {
			setExportedFilePath(filePath);
			const folder = parentDirectoryOf(filePath);
			if (folder) {
				saveUserPreferences({ exportFolder: folder });
			}
			toast.success(
				t("export.exportedSuccessfully", {
					format: formatLabel,
				}),
				{
					description: filePath,
					action: {
						label: rawT("common.actions.showInFolder"),
						onClick: () => {
							void handleShowExportedFile(filePath);
						},
					},
				},
			);
		},
		[handleShowExportedFile, t, rawT],
	);

	const handleSaveUnsavedExport = useCallback(async () => {
		if (!unsavedExport) return;
		try {
			const pickResult = await window.electronAPI.pickExportSavePath(
				unsavedExport.fileName,
				getExportFolder(),
			);
			if (pickResult.canceled || !pickResult.success || !pickResult.path) {
				toast.info("Export canceled");
				return;
			}
			const saveResult = await window.electronAPI.writeExportToPath(
				unsavedExport.arrayBuffer,
				pickResult.path,
			);
			if (saveResult.success && saveResult.path) {
				setUnsavedExport(null);
				handleExportSaved(unsavedExport.format === "gif" ? "GIF" : "Video", saveResult.path);
			} else {
				toast.error(
					buildSaveDiagnosticMessage(
						unsavedExport.format === "gif" ? "GIF" : "Video",
						saveResult.message || "Failed to save export",
					),
				);
			}
		} catch (error) {
			console.error("Error saving unsaved export:", error);
			toast.error(
				buildSaveDiagnosticMessage(
					unsavedExport.format === "gif" ? "GIF" : "Video",
					error instanceof Error ? error.message : "Failed to save exported video",
				),
			);
		}
	}, [unsavedExport, handleExportSaved]);

	const handleExport = useCallback(
		async (settings: ExportSettings) => {
			if (!videoPath) {
				toast.error("No video loaded");
				return;
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
				toast.error("Video not ready");
				return;
			}

			// Pick the save path before exporting, otherwise the save dialog can end up
			// hidden behind other windows after a long-running export.
			const isGifFormat = settings.format === "gif";
			const targetFileName = `export-${Date.now()}.${isGifFormat ? "gif" : "mp4"}`;
			const pickResult = await window.electronAPI.pickExportSavePath(
				targetFileName,
				getExportFolder(),
			);
			if (pickResult.canceled || !pickResult.success || !pickResult.path) {
				setShowExportDialog(false);
				return;
			}
			const targetPath = pickResult.path;

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);

			try {
				const wasPlaying = isPlaying;
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
				const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
				const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
					sourceWidth,
					sourceHeight,
					cropRegion,
				);
				const aspectRatioValue =
					aspectRatio === "native"
						? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
						: getAspectRatioValue(aspectRatio);

				// Preview container dimensions, used for scaling.
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || DEFAULT_SOURCE_DIMENSIONS.width;
				const previewHeight = containerElement?.clientHeight || DEFAULT_SOURCE_DIMENSIONS.height;

				if (settings.format === "gif" && settings.gifConfig) {
					// GIF Export
					const gifExporter = new GifExporter({
						videoUrl: videoPath,
						webcamVideoUrl: webcamVideoPath || undefined,
						webcamSync: webcamSync ?? undefined,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						wallpaper,
						backgroundMode,
						zoomRegions: effectiveZoomRegions,
						trimRegions,
						speedRegions: effectiveSpeedRegions,
						videoTrackClips,
						videoTrackHidden,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						showBlur,
						motionBlurAmount,
						borderRadius,
						padding,
						videoPadding: padding,
						cropRegion,
						cursorRecordingData,
						cursorScale: effectiveShowCursor ? cursorSize : 0,
						cursorSmoothing,
						smartCursorEnabled,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClipToBounds,
						cursorTheme,
						annotationRegions: [...effectiveAnnotationRegions, ...effectiveBlurRegions],
						webcamLayoutPreset,
						webcamMaskShape,
						webcamMirrored,
						webcamReactiveZoom,
						webcamSizePreset,
						webcamPosition,
						previewWidth,
						previewHeight,
						cursorTelemetry,
						cursorClickTimestamps,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = gifExporter as unknown as VideoExporter;
					const result = await gifExporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();

						if (result.warnings) {
							for (const warning of result.warnings) {
								toast.warning(warning);
							}
						}

						const saveResult = await window.electronAPI.writeExportToPath(arrayBuffer, targetPath);

						if (saveResult.success && saveResult.path) {
							setUnsavedExport(null);
							handleExportSaved("GIF", saveResult.path);
						} else {
							setUnsavedExport({ arrayBuffer, fileName: targetFileName, format: "gif" });
							const message = buildSaveDiagnosticMessage(
								"GIF",
								saveResult.message || "Failed to save GIF",
							);
							setExportError(message);
							toast.error(message);
						}
					} else {
						const message = buildExportDiagnosticMessage({
							formatLabel: "GIF",
							reason: result.error || "GIF export failed",
							sourcePath: videoSourcePath ?? videoPath,
							width: settings.gifConfig.width,
							height: settings.gifConfig.height,
							frameRate: settings.gifConfig.frameRate,
						});
						setExportError(message);
						toast.error(message);
					}
				} else {
					// MP4 Export
					const quality = settings.quality || exportQuality;
					const {
						width: exportWidth,
						height: exportHeight,
						bitrate,
					} = calculateMp4ExportSettings({
						quality,
						sourceWidth: effectiveSourceDimensions.width,
						sourceHeight: effectiveSourceDimensions.height,
						aspectRatioValue,
					});

					const exporterConfig = {
						videoUrl: videoPath,
						webcamVideoUrl: webcamVideoPath || undefined,
						webcamSync: webcamSync ?? undefined,
						width: exportWidth,
						height: exportHeight,
						frameRate: quality === "source" ? 60 : 30,
						maxFrameRate: quality === "source" ? 60 : 30,
						exportQuality: quality,
						bitrate,
						codec: "avc1.640033",
						wallpaper,
						backgroundMode,
						zoomRegions: effectiveZoomRegions,
						trimRegions,
						speedRegions: effectiveSpeedRegions,
						audioTrackClips: effectiveAudioTrackClips,
						videoTrackClips,
						videoTrackHidden,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						showBlur,
						motionBlurAmount,
						borderRadius,
						padding,
						cropRegion,
						cursorRecordingData,
						cursorScale: effectiveShowCursor ? cursorSize : 0,
						cursorSmoothing,
						smartCursorEnabled,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClipToBounds,
						cursorTheme,
						annotationRegions: [...effectiveAnnotationRegions, ...effectiveBlurRegions],
						webcamLayoutPreset,
						webcamMaskShape,
						webcamMirrored,
						webcamReactiveZoom,
						webcamSizePreset,
						webcamPosition,
						previewWidth,
						previewHeight,
						cursorTelemetry,
						cursorClickTimestamps,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					} satisfies VideoExporterConfig;
					const sourcePath = videoSourcePath ?? videoPath;
					const canCopySourceDirectly =
						!sourcePath.startsWith("http") &&
						sourcePath.toLowerCase().split(/[?#]/, 1)[0].endsWith(".mp4") &&
						isSourceCopyFastPathEligible(exporterConfig, {
							width: sourceWidth,
							height: sourceHeight,
							duration: video.duration,
						});

					if (canCopySourceDirectly) {
						setExportProgress({
							currentFrame: 1,
							totalFrames: 1,
							percentage: 100,
							estimatedTimeRemaining: 0,
							phase: "finalizing",
						});
						const copyResult = await window.electronAPI.copyExportSourceToPath(
							sourcePath,
							targetPath,
						);
						if (!copyResult.success || !copyResult.path) {
							throw new Error(copyResult.message || "Could not copy the source video");
						}
						setUnsavedExport(null);
						handleExportSaved("Video", copyResult.path);
					} else {
						const exporter = new VideoExporter(exporterConfig);
						exporterRef.current = exporter;
						const result = await exporter.export();

						if (result.success && result.blob) {
							const arrayBuffer = await result.blob.arrayBuffer();

							if (result.warnings) {
								for (const warning of result.warnings) {
									toast.warning(warning);
								}
							}

							const saveResult = await window.electronAPI.writeExportToPath(
								arrayBuffer,
								targetPath,
							);

							if (saveResult.success && saveResult.path) {
								setUnsavedExport(null);
								handleExportSaved("Video", saveResult.path);
							} else {
								setUnsavedExport({ arrayBuffer, fileName: targetFileName, format: "mp4" });
								const message = buildSaveDiagnosticMessage(
									"Video",
									saveResult.message || "Failed to save video",
								);
								setExportError(message);
								toast.error(message);
							}
						} else {
							const message = buildExportDiagnosticMessage({
								formatLabel: "Video",
								reason: result.error || "Export failed",
								sourcePath,
								width: exportWidth,
								height: exportHeight,
								frameRate: quality === "source" ? 60 : 30,
								codec: "avc1.640033",
								bitrate,
							});
							setExportError(message);
							toast.error(message);
						}
					}
				}

				if (wasPlaying) {
					videoPlaybackRef.current?.play();
				}
			} catch (error) {
				console.error("Export error:", error);
				if (error instanceof BackgroundLoadError) {
					const message = t("errors.exportBackgroundLoadFailed", { url: error.displayUrl });
					setExportError(message);
					toast.error(message);
				} else {
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					const message = buildExportDiagnosticMessage({
						formatLabel: settings.format === "gif" ? "GIF" : "Video",
						reason: errorMessage,
						sourcePath: videoSourcePath ?? videoPath,
					});
					setExportError(message);
					toast.error(t("errors.exportFailedWithError", { error: message }));
				}
			} finally {
				setIsExporting(false);
				exporterRef.current = null;
				// Reset so the next export can reopen the dialog (second export
				// otherwise wouldn't show the save dialog).
				setShowExportDialog(false);
				setExportProgress(null);
			}
		},
		[
			videoPath,
			videoSourcePath,
			webcamVideoPath,
			webcamSync,
			audioTrackClips,
			videoTrackClips,
			videoTrackHidden,
			effectiveAudioTrackClips,
			effectiveAnnotationRegions,
			effectiveBlurRegions,
			effectiveSpeedRegions,
			effectiveZoomRegions,
			wallpaper,
			zoomRegions,
			trimRegions,
			speedRegions,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			cursorRecordingData,
			annotationRegions,
			isPlaying,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			handleExportSaved,
			cursorTelemetry,
			cursorClickTimestamps,
			effectiveShowCursor,
			cursorSize,
			cursorSmoothing,
			smartCursorEnabled,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClipToBounds,
			cursorTheme,
			t,
		],
	);

	const handleOpenExportDialog = useCallback(() => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		const video = videoPlaybackRef.current?.video;
		if (!video) {
			toast.error("Video not ready");
			return;
		}

		// Build export settings from current state
		const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
		const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
		const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
			sourceWidth,
			sourceHeight,
			cropRegion,
		);
		const aspectRatioValue =
			aspectRatio === "native"
				? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
				: getAspectRatioValue(aspectRatio);
		const gifDimensions = calculateOutputDimensions(
			effectiveSourceDimensions.width,
			effectiveSourceDimensions.height,
			gifSizePreset,
			GIF_SIZE_PRESETS,
			aspectRatioValue,
		);

		const settings: ExportSettings = {
			format: exportFormat,
			quality: exportFormat === "mp4" ? exportQuality : undefined,
			gifConfig:
				exportFormat === "gif"
					? {
							frameRate: gifFrameRate,
							loop: gifLoop,
							sizePreset: gifSizePreset,
							width: gifDimensions.width,
							height: gifDimensions.height,
						}
					: undefined,
		};

		setShowExportDialog(true);
		setExportError(null);
		setExportedFilePath(null);

		// Start export immediately
		handleExport(settings);
	}, [
		videoPath,
		exportFormat,
		exportQuality,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		aspectRatio,
		cropRegion,
		handleExport,
	]);

	const handleCancelExport = useCallback(() => {
		if (exporterRef.current) {
			exporterRef.current.cancel();
			toast.info("Export canceled");
			setShowExportDialog(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);
		}
	}, []);

	const generateAutoCaptions = useCallback(
		async (minWords: number, maxWords: number) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return;
			}
			if (isAutoCaptioningRef.current) {
				toast.error(t("autoCaptions.busy"));
				return;
			}
			const minW = Math.max(1, Math.min(minWords, maxWords));
			const maxW = Math.max(minW, maxWords);

			isAutoCaptioningRef.current = true;
			setIsAutoCaptioning(true);
			toast.loading(t("autoCaptions.generating"), { id: AUTO_CAPTION_PROGRESS_TOAST_ID });
			try {
				const { samples, truncated, durationSec } = await extractMono16kFromVideoUrl(videoPath);
				if (!Number.isFinite(durationSec) || durationSec <= 0 || samples.length < 800) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.error(t("autoCaptions.noAudio"));
					return;
				}

				const { samples: speechSamples, trimSec } = trimLeadingSilenceMono16k(samples);
				if (speechSamples.length < 800) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.error(t("autoCaptions.noAudio"));
					return;
				}

				toast.loading(t("autoCaptions.transcribing"), { id: AUTO_CAPTION_PROGRESS_TOAST_ID });
				let { segments: segmentsRaw, granularity } = await transcribeMono16kWithOpenAI(
					speechSamples,
					{
						onProgress: (completed, total) =>
							toast.loading(`${t("autoCaptions.transcribing")} ${completed}/${total}`, {
								id: AUTO_CAPTION_PROGRESS_TOAST_ID,
							}),
					},
				);
				let transcribedFromTrimmedBuffer = true;

				// Leading-silence trimming can return empty even when the full source has
				// speech. Retry once against the untrimmed buffer before giving up.
				if (segmentsRaw.length === 0 && trimSec > 0) {
					({ segments: segmentsRaw, granularity } = await transcribeMono16kWithOpenAI(samples));
					transcribedFromTrimmedBuffer = false;
				}

				const segments =
					transcribedFromTrimmedBuffer && trimSec > 0
						? segmentsRaw.map((s) => ({
								...s,
								startSec: s.startSec + trimSec,
								endSec: s.endSec + trimSec,
							}))
						: segmentsRaw;

				let { regions, nextNumericId, nextZIndex } = captionSegmentsToAnnotationRegions(
					segments,
					nextAnnotationIdRef.current,
					nextAnnotationZIndexRef.current,
					{
						minWordsPerCaption: minW,
						maxWordsPerCaption: maxW,
						timestampGranularity: granularity,
					},
				);

				if (regions.length === 0 && segments.length > 0) {
					({ regions, nextNumericId, nextZIndex } = captionSegmentsToAnnotationRegions(
						segments,
						nextAnnotationIdRef.current,
						nextAnnotationZIndexRef.current,
						{
							minWordsPerCaption: 1,
							maxWordsPerCaption: Number.MAX_SAFE_INTEGER,
							timestampGranularity: granularity,
						},
					));
				}

				if (regions.length === 0) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.info(t("autoCaptions.noneHeard"));
					return;
				}

				pushState((prev) => ({ annotationRegions: [...prev.annotationRegions, ...regions] }));
				nextAnnotationIdRef.current = nextNumericId;
				nextAnnotationZIndexRef.current = nextZIndex;

				toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
				const minutesTrunc = String(Math.round(MAX_CAPTION_AUDIO_SEC / 60));
				if (truncated) {
					toast.success(t("autoCaptions.done", { count: String(regions.length) }), {
						description: t("autoCaptions.truncated", { minutes: minutesTrunc }),
					});
				} else {
					toast.success(t("autoCaptions.done", { count: String(regions.length) }));
				}
			} catch (e) {
				console.error(e);
				toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
				const detail = e instanceof Error ? e.message : String(e);
				toast.error(t("autoCaptions.failed"), { description: detail });
			} finally {
				isAutoCaptioningRef.current = false;
				setIsAutoCaptioning(false);
			}
		},
		[videoPath, trimRegions, pushState, t],
	);

	const generateVoiceover = useCallback(async () => {
		if (!videoPath || !videoSourcePath) {
			toast.error(t("errors.noVideoLoaded"));
			return;
		}
		if (isVoiceoverBusyRef.current) {
			toast.error(t("voiceover.busy"));
			return;
		}
		isVoiceoverBusyRef.current = true;
		setIsGeneratingVoiceover(true);
		const toastId = VOICEOVER_PROGRESS_TOAST_ID;
		try {
			const targetLanguage = voiceoverLanguage || null;
			let utterances: VoiceoverUtterance[] = [];
			// When translating with caption sync on, the same pushState also swaps the
			// caption texts so subtitles and speech stay one script.
			let translatedAnnotationRegions: AnnotationRegion[] | null = null;

			// The captions on the timeline are the script, so user edits to their text
			// flow straight into the generated speech. Without captions, transcribe now
			// (without adding captions to the timeline).
			const captionRegions = annotationRegions
				.filter((region) => region.annotationSource === "auto-caption" && region.type === "text")
				.sort((left, right) => left.startMs - right.startMs);

			if (captionRegions.length > 0) {
				let regionTexts = captionRegions.map((region) =>
					(region.textContent ?? region.content ?? "").trim(),
				);
				if (targetLanguage) {
					toast.loading(t("voiceover.translating"), { id: toastId });
					const translated = await window.electronAPI.translateVoiceoverText(
						regionTexts,
						targetLanguage,
					);
					if (!translated.success || !translated.texts) {
						throw new Error(translated.message || translated.code || "Translation failed");
					}
					regionTexts = translated.texts;
					if (voiceoverSyncCaptions) {
						const textByRegionId = new Map(
							captionRegions.map((region, index) => [region.id, regionTexts[index]]),
						);
						translatedAnnotationRegions = annotationRegions.map((region) => {
							const translatedText = textByRegionId.get(region.id);
							if (translatedText === undefined) return region;
							return {
								...region,
								content: translatedText,
								...(region.textContent !== undefined ? { textContent: translatedText } : {}),
							};
						});
					}
				}
				utterances = mergeIntoUtterances(
					captionRegions.map((region, index) => ({
						startMs: region.startMs,
						endMs: region.endMs,
						text: regionTexts[index],
					})),
				);
			} else {
				toast.loading(t("voiceover.transcribing"), { id: toastId });
				const { samples, durationSec } = await extractMono16kFromVideoUrl(videoPath);
				if (!Number.isFinite(durationSec) || durationSec <= 0 || samples.length < 800) {
					toast.dismiss(toastId);
					toast.error(t("autoCaptions.noAudio"));
					return;
				}
				const { segments } = await transcribeMono16kWithOpenAI(samples);
				utterances = buildUtterancesFromCaptionSegments(segments);
				if (targetLanguage && utterances.length > 0) {
					toast.loading(t("voiceover.translating"), { id: toastId });
					const translated = await window.electronAPI.translateVoiceoverText(
						utterances.map((utterance) => utterance.text),
						targetLanguage,
					);
					if (!translated.success || !translated.texts) {
						throw new Error(translated.message || translated.code || "Translation failed");
					}
					const translatedTexts = translated.texts;
					utterances = utterances.map((utterance, index) => ({
						...utterance,
						text: translatedTexts[index] ?? utterance.text,
					}));
				}
			}
			if (utterances.length === 0) {
				toast.dismiss(toastId);
				toast.error(t("autoCaptions.noneHeard"));
				return;
			}

			const timelineDurationMs = Math.max(
				Math.round(duration * 1000),
				...utterances.map((utterance) => utterance.endMs),
			);
			toast.loading(t("voiceover.synthesizing", { done: "0", total: String(utterances.length) }), {
				id: toastId,
			});
			const result = await synthesizeVoiceover({
				utterances,
				voice: voiceoverVoice,
				styleId: voiceoverStyle,
				polish: voiceoverPolish,
				quality: voiceoverQuality,
				durationMs: timelineDurationMs,
				onProgress: (done, total) =>
					toast.loading(t("voiceover.synthesizing", { done: String(done), total: String(total) }), {
						id: toastId,
					}),
			});

			toast.loading(t("voiceover.saving"), { id: toastId });
			const saved = await window.electronAPI.saveVoiceoverAudio(videoSourcePath, result.wavData);
			if (!saved.success || !saved.path) {
				throw new Error(saved.message || "Could not save the voice-over audio file");
			}
			const savedPath = saved.path;

			const replaceOriginal = voiceoverReplaceOriginal;
			pushState((prev) => {
				const physicalClips = prev.audioTrackClips.filter((clip) => !isFileBackedAudioClip(clip));
				return {
					...(translatedAnnotationRegions
						? { annotationRegions: translatedAnnotationRegions }
						: {}),
					audioTrackClips: [
						...(replaceOriginal
							? physicalClips.map((clip) => ({ ...clip, muted: true }))
							: physicalClips),
						{
							id: VOICEOVER_CLIP_ID,
							role: "voiceover" as const,
							trackOrdinal: VOICEOVER_TRACK_ORDINAL,
							startMs: 0,
							endMs: timelineDurationMs,
							sourceStartMs: 0,
							muted: false,
							gain: 1,
							linkGroupId: "voiceover",
							sourcePath: savedPath,
						},
					],
					voiceover: {
						audioPath: savedPath,
						voice: voiceoverVoice,
						style: voiceoverStyle,
						polish: voiceoverPolish,
						quality: voiceoverQuality,
						language: targetLanguage,
						utterances: result.utterances,
						generatedAtMs: Date.now(),
					},
				};
			});

			toast.dismiss(toastId);
			if (result.compressedCount > 0) {
				toast.success(t("voiceover.done"), {
					description: t("voiceover.compressedNote", {
						count: String(result.compressedCount),
					}),
				});
			} else {
				toast.success(t("voiceover.done"));
			}
		} catch (error) {
			console.error(error);
			toast.dismiss(toastId);
			if (!(error instanceof Error && error.message === "cancelled")) {
				toast.error(t("voiceover.failed"), {
					description: error instanceof Error ? error.message : String(error),
				});
			}
		} finally {
			isVoiceoverBusyRef.current = false;
			setIsGeneratingVoiceover(false);
		}
	}, [
		annotationRegions,
		duration,
		pushState,
		t,
		videoPath,
		videoSourcePath,
		voiceoverLanguage,
		voiceoverPolish,
		voiceoverQuality,
		voiceoverReplaceOriginal,
		voiceoverStyle,
		voiceoverSyncCaptions,
		voiceoverVoice,
	]);

	const removeVoiceover = useCallback(() => {
		pushState((prev) => ({
			audioTrackClips: prev.audioTrackClips
				.filter((clip) => !isFileBackedAudioClip(clip))
				.map((clip) => ({ ...clip, muted: false })),
			voiceover: null,
		}));
		toast.success(t("voiceover.removed"));
	}, [pushState, t]);

	const refreshOpenAIKeyStatus = useCallback(async () => {
		const status = await window.electronAPI.getOpenAIApiKeyStatus();
		setOpenAIKeyConfigured(status.configured);
		setOpenAISecureStorageAvailable(status.secureStorageAvailable);
		return status.configured;
	}, []);

	const saveOpenAIKeyForCaptions = useCallback(async () => {
		if (!openAIKeyDraft.trim()) return refreshOpenAIKeyStatus();
		if (openAIKeySavePromiseRef.current) return openAIKeySavePromiseRef.current;
		const savePromise = (async () => {
			setIsSavingOpenAIKey(true);
			setOpenAIKeyError(null);
			const result = await window.electronAPI.saveOpenAIApiKey(openAIKeyDraft);
			if (!result.success) {
				setOpenAIKeyError(result.message || "Could not save OpenAI API key");
				return false;
			}
			setOpenAIKeyDraft("");
			setOpenAIKeyConfigured(true);
			return true;
		})();
		openAIKeySavePromiseRef.current = savePromise;
		try {
			return await savePromise;
		} finally {
			openAIKeySavePromiseRef.current = null;
			setIsSavingOpenAIKey(false);
		}
	}, [openAIKeyDraft, refreshOpenAIKeyStatus]);

	const clearOpenAIKey = useCallback(async () => {
		if (openAIKeySavePromiseRef.current) await openAIKeySavePromiseRef.current;
		setOpenAIKeyDraft("");
		setOpenAIKeyError(null);
		const result = await window.electronAPI.clearOpenAIApiKey();
		if (result.success) {
			setOpenAIKeyConfigured(false);
			toast.success("OpenAI API key cleared");
		} else {
			setOpenAIKeyError(result.message || "Could not clear OpenAI API key");
		}
	}, []);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="text-foreground">{t("loadingVideo")}</div>
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<button
						type="button"
						onClick={handleLoadProject}
						className="px-3 py-1.5 rounded-md bg-[#34B27B] text-white text-sm hover:bg-[#34B27B]/90"
					>
						{ts("project.load")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-[#09090b] text-slate-200 overflow-hidden selection:bg-[#34B27B]/30">
			{studioView === "media-library" ? (
				<MediaLibraryView
					onBack={() => setStudioView("editor")}
					onOpen={openLibraryItem}
					onOpenFromComputer={() => void doLoadProject()}
					onNewRecording={() => setShowNewRecordingDialog(true)}
				/>
			) : (
				<>
					<Dialog open={showNewRecordingDialog} onOpenChange={setShowNewRecordingDialog}>
						<DialogContent
							className="sm:max-w-[425px]"
							style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
						>
							<DialogHeader>
								<DialogTitle>{t("newRecording.title")}</DialogTitle>
								<DialogDescription>{t("newRecording.description")}</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<button
									type="button"
									onClick={() => setShowNewRecordingDialog(false)}
									className="px-4 py-2 rounded-md bg-white/10 text-white hover:bg-white/20 text-sm font-medium transition-colors"
								>
									{t("newRecording.cancel")}
								</button>
								<button
									type="button"
									onClick={handleNewRecordingConfirm}
									className="px-4 py-2 rounded-md bg-[#34B27B] text-white hover:bg-[#34B27B]/90 text-sm font-medium transition-colors"
								>
									{t("newRecording.confirm")}
								</button>
							</DialogFooter>
						</DialogContent>
					</Dialog>

					<Dialog
						open={showAutoCaptionsDialog}
						onOpenChange={(open) => {
							setShowAutoCaptionsDialog(open);
							if (open) {
								setOpenAIKeyError(null);
								void refreshOpenAIKeyStatus();
								if (voiceover) {
									if ((VOICEOVER_VOICES as readonly string[]).includes(voiceover.voice)) {
										setVoiceoverVoice(voiceover.voice as VoiceoverVoice);
									}
									if (VOICEOVER_STYLES.some((style) => style.id === voiceover.style)) {
										setVoiceoverStyle(voiceover.style as VoiceoverStyleId);
									}
									setVoiceoverPolish(voiceover.polish);
									setVoiceoverQuality(voiceover.quality === "standard" ? "standard" : "hd");
									setVoiceoverLanguage(
										voiceover.language &&
											VOICEOVER_LANGUAGES.some((language) => language.id === voiceover.language)
											? voiceover.language
											: "",
									);
								}
							}
						}}
					>
						<DialogContent
							className="sm:max-w-md"
							style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
						>
							<DialogHeader>
								<DialogTitle>
									{captionsDialogTab === "voiceover"
										? t("voiceover.dialogTitle")
										: t("autoCaptions.dialogTitle")}
								</DialogTitle>
								<DialogDescription>
									{captionsDialogTab === "voiceover"
										? t("voiceover.dialogDescription")
										: t("autoCaptions.dialogDescription")}
								</DialogDescription>
							</DialogHeader>
							<div className="grid gap-4 py-2">
								<div className="grid gap-2">
									<Label htmlFor="openai-caption-key">OpenAI API Key</Label>
									<div className="relative">
										<input
											id="openai-caption-key"
											type="password"
											autoComplete="off"
											value={openAIKeyDraft}
											disabled={isSavingOpenAIKey}
											onChange={(event) => {
												setOpenAIKeyDraft(event.target.value);
												setOpenAIKeyError(null);
											}}
											onBlur={() => {
												if (openAIKeyDraft.trim()) void saveOpenAIKeyForCaptions();
											}}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													void saveOpenAIKeyForCaptions();
												}
											}}
											placeholder={openAIKeyConfigured ? "Stored securely on this Mac" : "sk-..."}
											className="h-9 w-full rounded-md border border-white/15 bg-black/25 px-3 pr-10 text-sm text-white outline-none focus:border-[#34B27B]/70 disabled:opacity-60"
										/>
										{isSavingOpenAIKey ? (
											<LoaderCircle className="pointer-events-none absolute right-3 top-2.5 size-4 animate-spin text-slate-400" />
										) : (
											(openAIKeyDraft || openAIKeyConfigured) && (
												<button
													type="button"
													title="Remove saved key"
													aria-label="Remove saved OpenAI API key"
													onMouseDown={(event) => event.preventDefault()}
													onClick={() => void clearOpenAIKey()}
													className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded text-slate-400 hover:bg-white/10 hover:text-white"
												>
													<X size={14} />
												</button>
											)
										)}
									</div>
									{openAIKeyError && (
										<p className="text-[11px] text-red-400" role="alert">
											{openAIKeyError}
										</p>
									)}
									<p className="text-[11px] text-slate-500">
										{openAISecureStorageAvailable
											? "Stored encrypted on this Mac and used only by the app's main process."
											: "Secure storage is unavailable on this device."}
									</p>
								</div>
								<Tabs
									value={captionsDialogTab}
									onValueChange={(value) =>
										setCaptionsDialogTab(value === "voiceover" ? "voiceover" : "captions")
									}
								>
									<TabsList className="grid w-full grid-cols-2 bg-white/[0.06]">
										<TabsTrigger value="captions">{t("voiceover.tabCaptions")}</TabsTrigger>
										<TabsTrigger value="voiceover">{t("voiceover.tabVoiceover")}</TabsTrigger>
									</TabsList>
									<TabsContent value="captions" className="grid gap-4 pt-2">
										<div className="grid gap-2">
											<Label htmlFor="caption-min-words">{t("autoCaptions.minWords")}</Label>
											<Select
												value={String(captionWordsMin)}
												onValueChange={(v) => {
													const n = Number.parseInt(v, 10);
													setCaptionWordsMin(n);
													if (n > captionWordsMax) setCaptionWordsMax(n);
												}}
											>
												<SelectTrigger id="caption-min-words" className="h-9">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{CAPTION_WORD_CHOICES.map((n) => (
														<SelectItem key={`min-${n}`} value={String(n)}>
															{t("autoCaptions.wordsCount", { count: String(n) })}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className="grid gap-2">
											<Label htmlFor="caption-max-words">{t("autoCaptions.maxWords")}</Label>
											<Select
												value={String(captionWordsMax)}
												onValueChange={(v) => {
													const n = Number.parseInt(v, 10);
													setCaptionWordsMax(n);
													if (n < captionWordsMin) setCaptionWordsMin(n);
												}}
											>
												<SelectTrigger id="caption-max-words" className="h-9">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{CAPTION_WORD_CHOICES.map((n) => (
														<SelectItem key={`max-${n}`} value={String(n)}>
															{t("autoCaptions.wordsCount", { count: String(n) })}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</TabsContent>
									<TabsContent value="voiceover" className="grid gap-4 pt-2">
										<div className="grid grid-cols-2 gap-3">
											<div className="grid gap-2">
												<Label htmlFor="voiceover-voice">{t("voiceover.voice")}</Label>
												<Select
													value={voiceoverVoice}
													onValueChange={(value) => setVoiceoverVoice(value as VoiceoverVoice)}
												>
													<SelectTrigger id="voiceover-voice" className="h-9">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{VOICEOVER_VOICES.map((voice) => (
															<SelectItem key={voice} value={voice}>
																{voice.charAt(0).toUpperCase() + voice.slice(1)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
											<div className="grid gap-2">
												<Label htmlFor="voiceover-style">{t("voiceover.style")}</Label>
												<Select
													value={voiceoverStyle}
													onValueChange={(value) => setVoiceoverStyle(value as VoiceoverStyleId)}
												>
													<SelectTrigger id="voiceover-style" className="h-9">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{VOICEOVER_STYLES.map((style) => (
															<SelectItem key={style.id} value={style.id}>
																{t(`voiceover.styles.${style.i18nKey}`)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										</div>
										<div className="grid grid-cols-2 gap-3">
											<div className="grid gap-2">
												<Label htmlFor="voiceover-quality">{t("voiceover.quality")}</Label>
												<Select
													value={voiceoverQuality}
													onValueChange={(value) =>
														setVoiceoverQuality(value === "standard" ? "standard" : "hd")
													}
												>
													<SelectTrigger id="voiceover-quality" className="h-9">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="hd">{t("voiceover.qualityHd")}</SelectItem>
														<SelectItem value="standard">
															{t("voiceover.qualityStandard")}
														</SelectItem>
													</SelectContent>
												</Select>
											</div>
											<div className="grid gap-2">
												<Label htmlFor="voiceover-language">{t("voiceover.targetLanguage")}</Label>
												<Select
													value={voiceoverLanguage || "original"}
													onValueChange={(value) =>
														setVoiceoverLanguage(value === "original" ? "" : value)
													}
												>
													<SelectTrigger id="voiceover-language" className="h-9">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="original">
															{t("voiceover.sourceLanguage")}
														</SelectItem>
														{VOICEOVER_LANGUAGES.map((language) => (
															<SelectItem key={language.id} value={language.id}>
																{language.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										</div>
										{voiceoverLanguage && (
											<div className="flex items-center justify-between gap-3">
												<Label
													htmlFor="voiceover-sync-captions"
													className="font-normal text-slate-300"
												>
													{t("voiceover.syncCaptions")}
												</Label>
												<Switch
													id="voiceover-sync-captions"
													checked={voiceoverSyncCaptions}
													onCheckedChange={setVoiceoverSyncCaptions}
												/>
											</div>
										)}
										<div className="flex items-center justify-between gap-3">
											<Label htmlFor="voiceover-polish" className="font-normal text-slate-300">
												{t("voiceover.polish")}
											</Label>
											<Switch
												id="voiceover-polish"
												checked={voiceoverPolish}
												onCheckedChange={setVoiceoverPolish}
											/>
										</div>
										<div className="flex items-center justify-between gap-3">
											<Label
												htmlFor="voiceover-replace-original"
												className="font-normal text-slate-300"
											>
												{t("voiceover.replaceOriginal")}
											</Label>
											<Switch
												id="voiceover-replace-original"
												checked={voiceoverReplaceOriginal}
												onCheckedChange={setVoiceoverReplaceOriginal}
											/>
										</div>
										<p className="text-[11px] text-slate-500">
											{t("voiceover.hint")}
											{voiceoverQuality === "hd" ? ` ${t("voiceover.hdCostHint")}` : ""}
										</p>
									</TabsContent>
								</Tabs>
							</div>
							<DialogFooter className="gap-2 sm:gap-0">
								<Button
									type="button"
									variant="outline"
									onClick={() => setShowAutoCaptionsDialog(false)}
									className="border-white/20 bg-transparent text-white hover:bg-white/10"
								>
									{t("autoCaptions.dialogCancel")}
								</Button>
								{captionsDialogTab === "voiceover" && voiceover && (
									<Button
										type="button"
										variant="outline"
										disabled={isGeneratingVoiceover}
										onClick={() => {
											setShowAutoCaptionsDialog(false);
											removeVoiceover();
										}}
										className="border-white/20 bg-transparent text-red-300 hover:bg-white/10"
									>
										{t("voiceover.remove")}
									</Button>
								)}
								{captionsDialogTab === "captions" ? (
									<Button
										type="button"
										disabled={isAutoCaptioning || isSavingOpenAIKey}
										onClick={() => {
											void (async () => {
												const configured = await saveOpenAIKeyForCaptions();
												if (!configured) {
													toast.error("Add an OpenAI API key to generate captions.");
													return;
												}
												setShowAutoCaptionsDialog(false);
												void generateAutoCaptions(captionWordsMin, captionWordsMax);
											})();
										}}
										className="bg-[#34B27B] text-white hover:bg-[#34B27B]/90"
									>
										{t("autoCaptions.generate")}
									</Button>
								) : (
									<Button
										type="button"
										disabled={isGeneratingVoiceover || isSavingOpenAIKey}
										onClick={() => {
											void (async () => {
												const configured = await saveOpenAIKeyForCaptions();
												if (!configured) {
													toast.error("Add an OpenAI API key to generate the voice-over.");
													return;
												}
												setShowAutoCaptionsDialog(false);
												void generateVoiceover();
											})();
										}}
										className="bg-[#34B27B] text-white hover:bg-[#34B27B]/90"
									>
										{voiceover ? t("voiceover.regenerate") : t("voiceover.generate")}
									</Button>
								)}
							</DialogFooter>
						</DialogContent>
					</Dialog>

					<div
						className="h-11 flex-shrink-0 bg-[#070809]/85 backdrop-blur-xl border-b border-white/[0.07] flex items-center justify-between px-5 z-50 shadow-[0_1px_0_rgba(255,255,255,0.03)]"
						style={{ WebkitAppRegion: "drag" } as CSSProperties}
					>
						<div
							className="flex-1 flex items-center gap-1"
							style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
						>
							<div
								className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 ${isMac ? "ml-14" : "ml-2"}`}
							>
								<Languages size={14} />
								<select
									value={locale}
									onChange={(e) => setLocale(e.target.value as Locale)}
									className="bg-transparent text-[11px] font-medium outline-none cursor-pointer appearance-none pr-1"
									style={{ color: "inherit" }}
								>
									{availableLocales.map((loc) => (
										<option key={loc} value={loc} className="bg-[#09090b] text-white">
											{getLocaleName(loc)}
										</option>
									))}
								</select>
							</div>
							<button
								type="button"
								onClick={() => setShowNewRecordingDialog(true)}
								className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
							>
								<Video size={14} />
								{t("newRecording.title")}
							</button>
							<button
								type="button"
								onClick={handleLoadProject}
								className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
							>
								<FolderOpen size={14} />
								{ts("project.load")}
							</button>
							<button
								type="button"
								onClick={handleSaveProject}
								className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
							>
								<Save size={14} />
								{ts("project.save")}
							</button>
						</div>
					</div>

					{/* Empty state shown when no video is loaded */}
					{!videoPath && (
						<div className="flex-1 min-h-0 relative">
							<EditorEmptyState
								onLoadFromLibrary={() => setStudioView("media-library")}
								onVideoImported={(path) => {
									setVideoPath(toFileUrl(path));
									setVideoSourcePath(path);
									setWebcamVideoPath(null);
									setWebcamVideoSourcePath(null);
									setWebcamSync(null);
									setRecordingCursorCaptureMode(null);
									setRecordingAudioTracks(null);
								}}
								onProjectOpened={async (project, path) => {
									const restored = await applyLoadedProject(project, path);
									if (!restored) {
										toast.error(t("project.invalidFormat"));
									}
								}}
							/>
						</div>
					)}

					{videoPath && (
						<div className="editor-workspace flex-1 min-h-0 relative">
							<PanelGroup direction="vertical" className="gap-3 min-h-0">
								{/* Top section: preview and contextual settings */}
								<Panel defaultSize={67} maxSize={76} minSize={46} className="min-h-[300px]">
									<div className="editor-main-deck h-full min-h-0">
										<div className="editor-preview-zone min-w-0 h-full">
											<div
												ref={playerContainerRef}
												className={
													isFullscreen
														? "fixed inset-0 z-[99999] w-full h-full flex flex-col items-center justify-center bg-[#09090b]"
														: "editor-preview-panel w-full h-full flex flex-col items-center justify-center overflow-hidden relative"
												}
											>
												{/* Video preview */}
												<div className="w-full min-h-0 flex justify-center items-center flex-auto px-4 pt-4">
													<div
														className="relative flex justify-center items-center w-auto h-full max-w-full box-border"
														style={{
															aspectRatio:
																aspectRatio === "native"
																	? getNativeAspectRatioValue(
																			videoPlaybackRef.current?.video?.videoWidth ||
																				DEFAULT_SOURCE_DIMENSIONS.width,
																			videoPlaybackRef.current?.video?.videoHeight ||
																				DEFAULT_SOURCE_DIMENSIONS.height,
																			cropRegion,
																		)
																	: getAspectRatioValue(aspectRatio),
														}}
													>
														<VideoPlayback
															key={`${videoPath || "no-video"}:${webcamVideoPath || "no-webcam"}`}
															aspectRatio={aspectRatio}
															ref={videoPlaybackRef}
															videoPath={videoPath || ""}
															webcamVideoPath={webcamVideoPath || undefined}
															webcamSync={webcamSync ?? undefined}
															webcamLayoutPreset={webcamLayoutPreset}
															webcamMaskShape={webcamMaskShape}
															webcamMirrored={webcamMirrored}
															webcamReactiveZoom={webcamReactiveZoom}
															webcamSizePreset={webcamSizePreset}
															webcamPosition={webcamPosition}
															onWebcamPositionChange={(pos) => updateState({ webcamPosition: pos })}
															onWebcamPositionDragEnd={commitState}
															onDurationChange={setDuration}
															onTimeUpdate={(sourceTime) => {
																if (videoTrackClips.length > 0) return;
																const sourceMs = sourceTime * 1000;
																publishLegacyReactSnapshot(
																	{
																		timelineMs:
																			timelineMapper.timelineTimeForVideoSource(sourceMs)
																				?.timelineTimeMs ?? sourceMs,
																		sourceMs,
																	},
																	performance.now(),
																);
															}}
															currentTime={currentTime}
															showSourceVideo={
																!videoTrackHidden &&
																Boolean(timelineMapper.videoAtTimelineTime(currentTime * 1000))
															}
															audioTrackClips={effectiveAudioTrackClips}
															externalTransportActive={videoTrackClips.length > 0}
															onPlayStateChange={(playing) => {
																if (videoTrackClips.length === 0) {
																	setIsPlaying(playing);
																	if (!playing) {
																		const sourceMs =
																			(videoPlaybackRef.current?.video?.currentTime ?? 0) * 1000;
																		publishLegacyReactSnapshot(
																			{
																				timelineMs:
																					timelineMapper.timelineTimeForVideoSource(sourceMs)
																						?.timelineTimeMs ?? sourceMs,
																				sourceMs,
																			},
																			performance.now(),
																			true,
																		);
																	}
																}
															}}
															onError={setError}
															wallpaper={wallpaper}
															backgroundMode={backgroundMode}
															zoomRegions={effectiveZoomRegions}
															selectedZoomId={selectedZoomId}
															onSelectZoom={handleSelectZoom}
															onZoomFocusChange={handleZoomFocusChange}
															onZoomFocusDragEnd={commitState}
															isPlaying={isPlaying}
															showShadow={shadowIntensity > 0}
															shadowIntensity={shadowIntensity}
															showBlur={showBlur}
															motionBlurAmount={motionBlurAmount}
															borderRadius={borderRadius}
															padding={padding}
															cropRegion={cropRegion}
															cursorRecordingData={cursorRecordingData}
															trimRegions={trimRegions}
															speedRegions={effectiveSpeedRegions}
															annotationRegions={effectiveAnnotationRegions}
															selectedAnnotationId={selectedAnnotationId}
															onSelectAnnotation={handleSelectAnnotation}
															onAnnotationPositionChange={handleAnnotationPositionChange}
															onAnnotationSizeChange={handleAnnotationSizeChange}
															blurRegions={effectiveBlurRegions}
															selectedBlurId={selectedBlurId}
															onSelectBlur={handleSelectBlur}
															onBlurPositionChange={handleAnnotationPositionChange}
															onBlurSizeChange={handleAnnotationSizeChange}
															onBlurDataChange={handleBlurDataPreviewChange}
															onBlurDataCommit={commitState}
															cursorTelemetry={cursorTelemetry}
															cursorClickTimestamps={cursorClickTimestamps}
															showCursor={effectiveShowCursor}
															cursorSize={cursorSize}
															cursorSmoothing={cursorSmoothing}
															smartCursorEnabled={smartCursorEnabled}
															cursorMotionBlur={cursorMotionBlur}
															cursorClickBounce={cursorClickBounce}
															cursorClipToBounds={cursorClipToBounds}
															cursorTheme={cursorTheme}
															isPreviewingZoom={isPreviewingZoom}
														/>
													</div>
												</div>
												{/* Playback controls */}
												<div className="w-full flex justify-center items-center h-14 flex-shrink-0 px-4 py-2">
													<div className="w-full max-w-[760px]">
														<PlaybackControls
															isPlaying={isPlaying}
															currentTime={currentTime}
															duration={timelineDuration}
															isFullscreen={isFullscreen}
															onToggleFullscreen={toggleFullscreen}
															onTogglePlayPause={togglePlayPause}
															onSeek={handleSeek}
														/>
													</div>
												</div>
											</div>
										</div>

										<div className="editor-settings-rail min-w-0 h-full">
											<SettingsPanel
												selected={wallpaper}
												onWallpaperChange={(w) => pushState({ wallpaper: w })}
												backgroundMode={backgroundMode}
												onBackgroundModeChange={(mode) => {
													if (mode === "none") {
														pushState({
															backgroundMode: mode,
															padding: 0,
															showBlur: false,
															borderRadius: 0,
														});
													} else {
														pushState({ backgroundMode: mode });
													}
												}}
												selectedZoomDepth={
													selectedZoomId
														? zoomRegions.find((z) => z.id === selectedZoomId)?.depth
														: null
												}
												onZoomDepthChange={(depth) =>
													selectedZoomId && handleZoomDepthChange(depth)
												}
												selectedZoomCustomScale={
													selectedZoomId
														? (zoomRegions.find((z) => z.id === selectedZoomId)?.customScale ??
															null)
														: null
												}
												onZoomCustomScaleChange={handleZoomCustomScaleChange}
												onZoomCustomScaleCommit={handleZoomCustomScaleCommit}
												onZoomPreviewStart={() => setIsPreviewingZoom(true)}
												onZoomPreviewEnd={() => setIsPreviewingZoom(false)}
												selectedZoomFocusMode={
													selectedZoomId
														? (zoomRegions.find((z) => z.id === selectedZoomId)?.focusMode ??
															"manual")
														: null
												}
												onZoomFocusModeChange={(mode) =>
													selectedZoomId && handleZoomFocusModeChange(mode)
												}
												focusModeLocked={autoFocusAll}
												selectedZoomFocus={
													selectedZoomId
														? (zoomRegions.find((z) => z.id === selectedZoomId)?.focus ?? null)
														: null
												}
												onZoomFocusCoordinateChange={(focus) =>
													selectedZoomId && handleZoomFocusChange(selectedZoomId, focus)
												}
												onZoomFocusCoordinateCommit={commitState}
												hasCursorTelemetry={cursorTelemetry.length > 0}
												selectedZoomId={selectedZoomId}
												onZoomDelete={handleZoomDelete}
												selectedZoomRotationPreset={
													selectedZoomId
														? (zoomRegions.find((z) => z.id === selectedZoomId)?.rotationPreset ??
															null)
														: null
												}
												onZoomRotationPresetChange={handleZoomRotationPresetChange}
												selectedTrimId={selectedTrimId}
												onTrimDelete={handleTrimDelete}
												shadowIntensity={shadowIntensity}
												onShadowChange={(v) => updateState({ shadowIntensity: v })}
												onShadowCommit={commitState}
												showBlur={showBlur}
												onBlurChange={(v) => pushState({ showBlur: v })}
												showTrimWaveform={showTrimWaveform}
												onTrimWaveformChange={(v) => pushState({ showTrimWaveform: v })}
												motionBlurAmount={motionBlurAmount}
												onMotionBlurChange={(v) => updateState({ motionBlurAmount: v })}
												onMotionBlurCommit={commitState}
												borderRadius={borderRadius}
												onBorderRadiusChange={(v) => updateState({ borderRadius: v })}
												onBorderRadiusCommit={commitState}
												padding={padding}
												onPaddingChange={(v) => updateState({ padding: v })}
												onPaddingCommit={commitState}
												cropRegion={cropRegion}
												onCropChange={(r) => pushState({ cropRegion: r })}
												aspectRatio={aspectRatio}
												hasWebcam={Boolean(webcamVideoPath)}
												webcamLayoutPreset={webcamLayoutPreset}
												onWebcamLayoutPresetChange={(preset) =>
													pushState({
														webcamLayoutPreset: preset,
														webcamPosition: preset === "picture-in-picture" ? webcamPosition : null,
													})
												}
												webcamMaskShape={webcamMaskShape}
												onWebcamMaskShapeChange={(shape) => pushState({ webcamMaskShape: shape })}
												webcamMirrored={webcamMirrored}
												webcamReactiveZoom={webcamReactiveZoom}
												onWebcamMirroredChange={(mirrored) =>
													pushState({ webcamMirrored: mirrored })
												}
												onWebcamReactiveZoomChange={(reactive) =>
													pushState({ webcamReactiveZoom: reactive })
												}
												webcamSizePreset={webcamSizePreset}
												onWebcamSizePresetChange={(v) => updateState({ webcamSizePreset: v })}
												onWebcamSizePresetCommit={commitState}
												videoElement={videoPlaybackRef.current?.video || null}
												exportQuality={exportQuality}
												onExportQualityChange={setExportQuality}
												exportFormat={exportFormat}
												onExportFormatChange={setExportFormat}
												gifFrameRate={gifFrameRate}
												onGifFrameRateChange={setGifFrameRate}
												gifLoop={gifLoop}
												onGifLoopChange={setGifLoop}
												gifSizePreset={gifSizePreset}
												onGifSizePresetChange={setGifSizePreset}
												gifOutputDimensions={calculateOutputDimensions(
													calculateEffectiveSourceDimensions(
														videoPlaybackRef.current?.video?.videoWidth ||
															DEFAULT_SOURCE_DIMENSIONS.width,
														videoPlaybackRef.current?.video?.videoHeight ||
															DEFAULT_SOURCE_DIMENSIONS.height,
														cropRegion,
													).width,
													calculateEffectiveSourceDimensions(
														videoPlaybackRef.current?.video?.videoWidth ||
															DEFAULT_SOURCE_DIMENSIONS.width,
														videoPlaybackRef.current?.video?.videoHeight ||
															DEFAULT_SOURCE_DIMENSIONS.height,
														cropRegion,
													).height,
													gifSizePreset,
													GIF_SIZE_PRESETS,
													aspectRatio === "native"
														? getNativeAspectRatioValue(
																videoPlaybackRef.current?.video?.videoWidth ||
																	DEFAULT_SOURCE_DIMENSIONS.width,
																videoPlaybackRef.current?.video?.videoHeight ||
																	DEFAULT_SOURCE_DIMENSIONS.height,
																cropRegion,
															)
														: getAspectRatioValue(aspectRatio),
												)}
												onExport={handleOpenExportDialog}
												onExportPanelOpen={() => {
													setSelectedZoomId(null);
													setSelectedTrimId(null);
													setSelectedSpeedId(null);
												}}
												selectedAnnotationId={selectedAnnotationId}
												annotationRegions={annotationOnlyRegions}
												onAnnotationContentChange={handleAnnotationContentChange}
												onAnnotationTypeChange={handleAnnotationTypeChange}
												onAnnotationStyleChange={handleAnnotationStyleChange}
												onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
												onAnnotationDuplicate={handleAnnotationDuplicate}
												onAnnotationDelete={handleAnnotationDelete}
												selectedBlurId={selectedBlurId}
												blurRegions={blurRegions}
												onBlurDataChange={handleBlurDataPanelChange}
												onBlurDataCommit={commitState}
												onBlurDelete={handleAnnotationDelete}
												selectedSpeedId={selectedSpeedId}
												selectedSpeedValue={
													selectedSpeedId
														? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null)
														: null
												}
												onSpeedChange={handleSpeedChange}
												onSpeedDelete={handleSpeedDelete}
												unsavedExport={unsavedExport}
												onSaveUnsavedExport={handleSaveUnsavedExport}
												timelineTracks={timelineTracks}
												onTimelineTrackChange={(id, changes) => {
													pushState((prev) => ({
														timelineTracks: prev.timelineTracks.map((track) =>
															track.id === id ? { ...track, ...changes } : track,
														),
													}));
												}}
												showCursor={showCursor}
												onShowCursorChange={setShowCursor}
												cursorSize={cursorSize}
												onCursorSizeChange={setCursorSize}
												cursorSmoothing={cursorSmoothing}
												onCursorSmoothingChange={setCursorSmoothing}
												smartCursorEnabled={smartCursorEnabled}
												onSmartCursorEnabledChange={(enabled) =>
													pushState({ smartCursorEnabled: enabled })
												}
												cursorMotionBlur={cursorMotionBlur}
												onCursorMotionBlurChange={setCursorMotionBlur}
												cursorClickBounce={cursorClickBounce}
												onCursorClickBounceChange={setCursorClickBounce}
												cursorClipToBounds={cursorClipToBounds}
												onCursorClipToBoundsChange={setCursorClipToBounds}
												cursorTheme={cursorTheme}
												onCursorThemeChange={setCursorTheme}
												hasCursorData={
													cursorTelemetry.length > 0 ||
													hasNativeCursorRecordingData(cursorRecordingData)
												}
												showCursorSettings={showCursorSettings}
											/>
										</div>
									</div>
								</Panel>

								<PanelResizeHandle className="editor-resize-handle group">
									<div className="w-10 h-1 bg-white/20 rounded-full transition-colors group-hover:bg-[#34B27B]/70"></div>
								</PanelResizeHandle>

								{/* Full-width timeline */}
								<Panel defaultSize={33} maxSize={54} minSize={24} className="min-h-[210px]">
									<div className="editor-timeline-panel h-full overflow-hidden flex flex-col">
										<TimelineEditor
											videoDuration={timelineDuration}
											currentTime={currentTime}
											onSeek={handleSeek}
											zoomRegions={zoomRegions}
											videoTrackClips={videoTrackClips}
											onVideoTrackSpanChange={handleVideoTrackSpanChange}
											onVideoTrackDelete={handleVideoTrackDelete}
											selectedVideoTrackId={selectedVideoTrackId}
											onSelectVideoTrack={handleSelectVideoTrack}
											onZoomAdded={handleZoomAdded}
											autoZoomEnabled={autoZoomEnabled}
											onToggleAutoZoom={handleToggleAutoZoom}
											autoFocusAll={autoFocusAll}
											onToggleAutoFocusAll={handleToggleAutoFocusAll}
											onZoomSpanChange={handleZoomSpanChange}
											onZoomDelete={handleZoomDelete}
											selectedZoomId={selectedZoomId}
											onSelectZoom={handleSelectZoom}
											trimRegions={trimRegions}
											onTrimAdded={handleTrimAdded}
											onTrimSpanChange={handleTrimSpanChange}
											onTrimDelete={handleTrimDelete}
											selectedTrimId={selectedTrimId}
											onSelectTrim={handleSelectTrim}
											speedRegions={speedRegions}
											onSpeedAdded={handleSpeedAdded}
											onSpeedSpanChange={handleSpeedSpanChange}
											onSpeedDelete={handleSpeedDelete}
											selectedSpeedId={selectedSpeedId}
											onSelectSpeed={handleSelectSpeed}
											audioTrackClips={audioTrackClips}
											onAudioTrackSpanChange={handleAudioTrackSpanChange}
											onAudioTrackDelete={handleAudioTrackDelete}
											selectedAudioTrackId={selectedAudioTrackId}
											onSelectAudioTrack={handleSelectAudioTrack}
											onCutItem={handleCutTimelineItem}
											onRippleDeleteItem={handleRippleDeleteTimelineItem}
											onCopyItem={handleCopyTimelineItem}
											onPasteItems={handlePasteTimelineItems}
											onDuplicateItem={handleDuplicateTimelineItem}
											onCutItems={handleCutTimelineItems}
											onDeleteItems={handleDeleteTimelineItems}
											onCopyItems={handleCopyTimelineItems}
											onDuplicateItems={handleDuplicateTimelineItems}
											onBatchItemSpanChange={handleBatchTimelineSpanChange}
											lockedTrackKinds={timelineTracks
												.filter((track) => track.locked)
												.map((track) => track.kind)}
											annotationRegions={annotationOnlyRegions}
											onAnnotationAdded={handleAnnotationAdded}
											onAnnotationSpanChange={handleAnnotationSpanChange}
											onAnnotationDelete={handleAnnotationDelete}
											selectedAnnotationId={selectedAnnotationId}
											onSelectAnnotation={handleSelectAnnotation}
											blurRegions={blurRegions}
											onBlurAdded={handleBlurAdded}
											onBlurSpanChange={handleAnnotationSpanChange}
											onBlurDelete={handleAnnotationDelete}
											selectedBlurId={selectedBlurId}
											onSelectBlur={handleSelectBlur}
											aspectRatio={aspectRatio}
											onAspectRatioChange={(ar) =>
												pushState({
													aspectRatio: ar,
													webcamLayoutPreset:
														(isPortraitAspectRatio(ar) && webcamLayoutPreset === "dual-frame") ||
														(!isPortraitAspectRatio(ar) && webcamLayoutPreset === "vertical-stack")
															? "picture-in-picture"
															: webcamLayoutPreset,
												})
											}
											videoUrl={videoPath ?? undefined}
											showTrimWaveform={showTrimWaveform}
											captionsLabel={t("autoCaptions.button")}
											isGeneratingCaptions={isAutoCaptioning}
											onGenerateCaptions={() => {
												if (!videoPath) {
													toast.error(t("errors.noVideoLoaded"));
													return;
												}
												if (isAutoCaptioningRef.current) {
													toast.error(t("autoCaptions.busy"));
													return;
												}
												setShowAutoCaptionsDialog(true);
											}}
										/>
									</div>
								</Panel>
							</PanelGroup>
						</div>
					)}

					<ExportDialog
						isOpen={showExportDialog}
						onClose={() => setShowExportDialog(false)}
						progress={exportProgress}
						isExporting={isExporting}
						error={exportError}
						onCancel={handleCancelExport}
						exportFormat={exportFormat}
						exportedFilePath={exportedFilePath || undefined}
						onShowInFolder={
							exportedFilePath ? () => void handleShowExportedFile(exportedFilePath) : undefined
						}
					/>

					<UnsavedChangesDialog
						isOpen={showCloseConfirmDialog}
						onSaveAndClose={handleCloseConfirmSave}
						onDiscardAndClose={handleCloseConfirmDiscard}
						onCancel={handleCloseConfirmCancel}
					/>

					<UnsavedChangesDialog
						isOpen={confirmDialogVariant !== null}
						variant={confirmDialogVariant ?? "newProject"}
						onSaveAndClose={
							confirmDialogVariant === "loadProject"
								? handleLoadProjectConfirmSave
								: handleNewProjectConfirmSave
						}
						onDiscardAndClose={
							confirmDialogVariant === "loadProject"
								? handleLoadProjectConfirmDiscard
								: handleNewProjectConfirmDiscard
						}
						onCancel={() => setConfirmDialogVariant(null)}
					/>
				</>
			)}
		</div>
	);
}
