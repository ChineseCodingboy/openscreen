import {
	Application,
	BlurFilter,
	Container,
	Graphics,
	Sprite,
	Texture,
	UPDATE_PRIORITY,
	VideoSource,
} from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import type React from "react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	getWebcamLayoutCssBoxShadow,
	reactiveWebcamScale,
	type Size,
	type StyledRenderRect,
	type WebcamLayoutPreset,
	type WebcamSizePreset,
} from "@/lib/compositeLayout";
import {
	createSmoothedCursorPath,
	getSmoothedCursorPath,
	type SerializedSmoothedCursorPath,
	type SmoothedCursorPath,
} from "@/lib/cursor/cursorPathSmoothing";
import {
	createNativeCursorMotionBlurState,
	getNativeCursorClickBounceProgress,
	getNativeCursorClickBounceScale,
	getNativeCursorMotionBlurPx,
	hasNativeCursorRecordingData,
	projectNativeCursorToLocal,
	projectNativeCursorToStage,
	resetNativeCursorMotionBlurState,
	resolveInterpolatedNativeCursorFrame,
	resolveNativeCursorRenderAsset,
} from "@/lib/cursor/nativeCursor";
import {
	getSemanticCursorPath,
	prepareSemanticCursorPath,
	type SemanticCursorPath,
} from "@/lib/cursor/semanticCursorPath";
import { classifyWallpaper, DEFAULT_WALLPAPER, resolveImageWallpaperUrl } from "@/lib/wallpaper";
import { getCssClipPath } from "@/lib/webcamMaskShapes";
import {
	resolveWebcamSyncPoint,
	type WebcamSyncMetadata,
	webcamSyncBoundaryAt,
} from "@/lib/webcamSync";
import type { CursorRecordingData } from "@/native/contracts";
import {
	type AspectRatio,
	formatAspectRatioForCSS,
	getNativeAspectRatioValue,
} from "@/utils/aspectRatioUtils";
import { AnnotationOverlay } from "./AnnotationOverlay";
import {
	DEFAULT_CURSOR_SETTINGS,
	DEFAULT_EDITOR_LAYOUT_SETTINGS,
	DEFAULT_SOURCE_DIMENSIONS,
} from "./editorDefaults";
import { toFileUrl } from "./projectPersistence";
import {
	type AnnotationRegion,
	type AudioTrackClip,
	type BlurData,
	type CursorTelemetryPoint,
	computeRotation3DContainScale,
	DEFAULT_ROTATION_3D,
	getZoomScale,
	isFileBackedAudioClip,
	isRotation3DIdentity,
	lerpRotation3D,
	rotation3DPerspective,
	type SpeedRegion,
	type TrimRegion,
	type ZoomFocus,
	type ZoomRegion,
} from "./types";
import { AUTO_FOLLOW_PARAMS, DEFAULT_FOCUS } from "./videoPlayback/constants";
import { advanceFollowFocus } from "./videoPlayback/cursorFollowUtils";
import {
	DEFAULT_CURSOR_CONFIG,
	PixiCursorOverlay,
	preloadCursorAssets,
} from "./videoPlayback/cursorRenderer";
import { clampFocusToScale } from "./videoPlayback/focusUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "./videoPlayback/layoutUtils";
import { clamp01 } from "./videoPlayback/mathUtils";
import { updateOverlayIndicator } from "./videoPlayback/overlayUtils";
import {
	createPreviewResolutionControllerState,
	samplePreviewResolutionPerformance,
	setPreviewResolutionPlaybackActive,
} from "./videoPlayback/previewResolution";
import {
	areExplicitPreviewAudioTracksReady,
	areMediaSpansContinuous,
	createFollowerBoundaryKey,
	resolvePreviewDrift,
	shouldMuteEmbeddedPreviewAudio,
	shouldPrepareLegacySupplementalAudio,
} from "./videoPlayback/previewTransport";
import { createVideoEventHandlers } from "./videoPlayback/videoEventHandlers";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";
import { createZoomSpringState, resetZoomSpring, stepZoomSpring } from "./videoPlayback/zoomSpring";
import {
	applyZoomTransform,
	computeFocusFromTransform,
	computeZoomTransform,
	createMotionBlurState,
	type MotionBlurState,
} from "./videoPlayback/zoomTransform";

interface VideoPlaybackProps {
	videoPath: string;
	webcamVideoPath?: string;
	webcamSync?: WebcamSyncMetadata;
	webcamLayoutPreset: WebcamLayoutPreset;
	webcamMaskShape?: import("./types").WebcamMaskShape;
	webcamMirrored?: boolean;
	webcamReactiveZoom?: boolean;
	webcamSizePreset?: WebcamSizePreset;
	webcamPosition?: { cx: number; cy: number } | null;
	onWebcamPositionChange?: (position: { cx: number; cy: number }) => void;
	onWebcamPositionDragEnd?: () => void;
	onDurationChange: (duration: number) => void;
	onTimeUpdate: (time: number) => void;
	currentTime: number;
	onPlayStateChange: (playing: boolean) => void;
	onError: (error: string) => void;
	wallpaper?: string;
	zoomRegions: ZoomRegion[];
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
	onZoomFocusDragEnd?: () => void;
	isPlaying: boolean;
	showShadow?: boolean;
	shadowIntensity?: number;
	showBlur?: boolean;
	motionBlurAmount?: number;
	borderRadius?: number;
	padding?: number;
	cropRegion?: import("./types").CropRegion;
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	aspectRatio: AspectRatio;
	cursorRecordingData?: CursorRecordingData | null;
	annotationRegions?: AnnotationRegion[];
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
	onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
	blurRegions?: AnnotationRegion[];
	selectedBlurId?: string | null;
	onSelectBlur?: (id: string | null) => void;
	onBlurPositionChange?: (id: string, position: { x: number; y: number }) => void;
	onBlurSizeChange?: (id: string, size: { width: number; height: number }) => void;
	onBlurDataChange?: (id: string, blurData: BlurData) => void;
	onBlurDataCommit?: () => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	cursorClickTimestamps?: number[];
	showCursor?: boolean;
	cursorSize?: number;
	cursorSmoothing?: number;
	smartCursorEnabled?: boolean;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClipToBounds?: boolean;
	cursorTheme?: string;
	// Render the selected zoom at the playhead even while paused, so the editor can
	// preview the effect without leaving the focus-edit view.
	isPreviewingZoom?: boolean;
	showSourceVideo?: boolean;
	audioTrackClips?: AudioTrackClip[];
	/** The parent media-track timeline supplies the high-frequency transport clock. */
	externalTransportActive?: boolean;
}

export interface VideoPlaybackRef {
	video: HTMLVideoElement | null;
	app: Application | null;
	videoSprite: Sprite | null;
	videoContainer: Container | null;
	containerRef: React.RefObject<HTMLDivElement>;
	play: () => Promise<void>;
	pause: () => void;
	seekTimeline: (timeSeconds: number) => void;
	updateTransportClock: (timelineMs: number, sourceMs: number, sourceActive?: boolean) => void;
}

function getResolvedVideoDuration(video: HTMLVideoElement): number | null {
	if (Number.isFinite(video.duration) && video.duration > 0) {
		return video.duration;
	}

	if (video.seekable.length > 0) {
		const lastRangeIndex = video.seekable.length - 1;
		const seekableEnd = video.seekable.end(lastRangeIndex);
		if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
			return seekableEnd;
		}
	}

	return null;
}

function getEndedVideoDuration(video: HTMLVideoElement): number | null {
	const currentTime = video.currentTime;
	if (!Number.isFinite(currentTime) || currentTime <= 0) {
		return null;
	}

	if (video.ended) {
		return currentTime;
	}

	const resolvedDuration = getResolvedVideoDuration(video);
	const durationEpsilonSeconds = 0.05;
	if (resolvedDuration && currentTime >= resolvedDuration - durationEpsilonSeconds) {
		return resolvedDuration;
	}

	return null;
}

type AudioTrackListLike = {
	length: number;
	[index: number]: { enabled: boolean };
};

type VideoElementWithAudioTracks = HTMLVideoElement & {
	audioTracks?: AudioTrackListLike;
};

interface PreparedPreviewAudioTrack {
	trackOrdinal: number;
	path: string;
}

function enableAllPreviewAudioTracks(video: HTMLVideoElement) {
	const audioTracks = (video as VideoElementWithAudioTracks).audioTracks;
	if (!audioTracks || audioTracks.length <= 1) {
		return;
	}

	for (let index = 0; index < audioTracks.length; index += 1) {
		audioTracks[index].enabled = true;
	}
}

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(
	(
		{
			videoPath,
			webcamVideoPath,
			webcamSync,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored = false,
			webcamReactiveZoom = false,
			webcamSizePreset,
			webcamPosition,
			onWebcamPositionChange,
			onWebcamPositionDragEnd,
			onDurationChange,
			onTimeUpdate,
			currentTime,
			onPlayStateChange,
			onError,
			wallpaper,
			zoomRegions,
			selectedZoomId,
			onSelectZoom,
			onZoomFocusChange,
			onZoomFocusDragEnd,
			isPlaying,
			showShadow,
			shadowIntensity = 0,
			showBlur,
			motionBlurAmount = 0,
			borderRadius = 0,
			padding = DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
			cropRegion,
			trimRegions = [],
			speedRegions = [],
			aspectRatio,
			cursorRecordingData,
			annotationRegions = [],
			selectedAnnotationId,
			onSelectAnnotation,
			onAnnotationPositionChange,
			onAnnotationSizeChange,
			blurRegions = [],
			selectedBlurId,
			onSelectBlur,
			onBlurPositionChange,
			onBlurSizeChange,
			onBlurDataChange,
			onBlurDataCommit,
			cursorTelemetry = [],
			cursorClickTimestamps = [],
			showCursor = false,
			cursorSize = DEFAULT_CURSOR_SETTINGS.size,
			cursorSmoothing = DEFAULT_CURSOR_SETTINGS.smoothing,
			smartCursorEnabled = true,
			cursorMotionBlur = DEFAULT_CURSOR_SETTINGS.motionBlur,
			cursorClickBounce = DEFAULT_CURSOR_SETTINGS.clickBounce,
			cursorClipToBounds = DEFAULT_CURSOR_SETTINGS.clipToBounds,
			cursorTheme = DEFAULT_CURSOR_SETTINGS.theme,
			isPreviewingZoom = false,
			showSourceVideo = true,
			audioTrackClips = [],
			externalTransportActive = false,
		},
		ref,
	) => {
		const videoRef = useRef<HTMLVideoElement | null>(null);
		const supplementalAudioRef = useRef<HTMLAudioElement | null>(null);
		const audioTrackElementsRef = useRef<Map<number, HTMLAudioElement>>(new Map());
		const readyAudioTrackOrdinalsRef = useRef<Set<number>>(new Set());
		const audioTrackClipsRef = useRef(audioTrackClips);
		const audioTransportRef = useRef({
			wasPlaying: false,
			activeClips: new Map<number, AudioTrackClip>(),
			rateMultipliers: new Map<number, number>(),
			supplementalRateMultiplier: 1,
			webcamRateMultiplier: 1,
			webcamBoundaryKey: null as string | null,
		});
		const audioContextRef = useRef<AudioContext | null>(null);
		const audioSourceNodesRef = useRef<Map<number, MediaElementAudioSourceNode>>(new Map());
		const audioGainNodesRef = useRef<Map<number, GainNode>>(new Map());
		const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
		const webcamSyncRef = useRef<WebcamSyncMetadata | undefined>(webcamSync);
		const webcamWrapperRef = useRef<HTMLDivElement | null>(null);
		const webcamReactiveZoomRef = useRef(webcamReactiveZoom);
		const webcamLayoutPresetRef = useRef(webcamLayoutPreset);
		const webcamPositionRef = useRef(webcamPosition);
		const containerRef = useRef<HTMLDivElement | null>(null);
		const appRef = useRef<Application | null>(null);
		const videoSpriteRef = useRef<Sprite | null>(null);
		const videoContainerRef = useRef<Container | null>(null);
		const cameraContainerRef = useRef<Container | null>(null);
		const timeUpdateAnimationRef = useRef<number | null>(null);
		const [pixiReady, setPixiReady] = useState(false);
		const [videoReady, setVideoReady] = useState(false);
		const [supplementalAudioPath, setSupplementalAudioPath] = useState<string | null>(null);
		const [preparedAudioTracks, setPreparedAudioTracks] = useState<PreparedPreviewAudioTrack[]>([]);
		const [overlaySize, setOverlaySize] = useState({ width: 800, height: 600 });
		const [overlayElement, setOverlayElement] = useState<HTMLDivElement | null>(null);
		const overlayRef = useRef<HTMLDivElement | null>(null);
		const blurPreviewSnapshotRef = useRef<{
			width: number;
			height: number;
			clientWidth?: number;
			clientHeight?: number;
		} | null>(null);
		const lastBlurSnapshotAtRef = useRef(Number.NEGATIVE_INFINITY);
		const lastBlurSnapshotTimeMsRef = useRef(Number.NEGATIVE_INFINITY);

		const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
		const composite3DRef = useRef<HTMLDivElement | null>(null);
		const outerWrapperRef = useRef<HTMLDivElement | null>(null);
		const [webcamLayout, setWebcamLayout] = useState<StyledRenderRect | null>(null);
		const [webcamDimensions, setWebcamDimensions] = useState<Size | null>(null);
		const currentTimeRef = useRef(currentTime * 1000);
		const timelineCurrentTimeRef = useRef(currentTime * 1000);
		const externalTransportActiveRef = useRef(externalTransportActive);
		const lastTransportClockRef = useRef({
			timelineMs: currentTime * 1000,
			sourceMs: currentTime * 1000,
			sourceActive: true,
		});
		const lastFollowerSyncAtMsRef = useRef(Number.NEGATIVE_INFINITY);
		const lastFollowerBoundaryKeyRef = useRef<string | null>(null);
		const syncFollowerMediaRef = useRef<(forceSeek?: boolean) => void>(() => {
			// Assigned once the follower transport is initialized.
		});
		const renderPreviewFrameRef = useRef<() => void>(() => {
			// Assigned once the Pixi scene is initialized.
		});
		const previewResolutionControllerRef = useRef(
			createPreviewResolutionControllerState({
				devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
			}),
		);
		const zoomRegionsRef = useRef<ZoomRegion[]>([]);
		const cursorTelemetryRef = useRef<CursorTelemetryPoint[]>([]);
		const cursorClickTimestampsRef = useRef<number[]>([]);
		const selectedZoomIdRef = useRef<string | null>(null);
		const animationStateRef = useRef({
			scale: 1,
			focusX: DEFAULT_FOCUS.cx,
			focusY: DEFAULT_FOCUS.cy,
			progress: 0,
			x: 0,
			y: 0,
			appliedScale: 1,
		});
		// Spring that chases the eased zoom target so the camera glides instead of jerking.
		const zoomSpringRef = useRef(createZoomSpringState());
		const prevZoomTimeMsRef = useRef<number | null>(null);
		const blurFilterRef = useRef<BlurFilter | null>(null);
		const motionBlurFilterRef = useRef<MotionBlurFilter | null>(null);
		const isDraggingFocusRef = useRef(false);
		const isDraggingWebcamRef = useRef(false);
		const webcamDragOffsetRef = useRef({ dx: 0, dy: 0 });
		const stageSizeRef = useRef({ width: 0, height: 0 });
		const videoSizeRef = useRef({ width: 0, height: 0 });
		const baseScaleRef = useRef(1);
		const baseOffsetRef = useRef({ x: 0, y: 0 });
		const baseMaskRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
		const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });
		const maskGraphicsRef = useRef<Graphics | null>(null);
		const isPlayingRef = useRef(isPlaying);
		const isSeekingRef = useRef(false);
		const isScrubbingRef = useRef(false);
		const scrubEndTimerRef = useRef<number | null>(null);
		const [isScrubbing, setIsScrubbing] = useState(false);
		const allowPlaybackRef = useRef(false);
		const lockedVideoDimensionsRef = useRef<{
			width: number;
			height: number;
		} | null>(null);
		const layoutVideoContentRef = useRef<(() => void) | null>(null);
		const trimRegionsRef = useRef<TrimRegion[]>([]);
		const speedRegionsRef = useRef<SpeedRegion[]>([]);
		const motionBlurAmountRef = useRef(motionBlurAmount);
		const cursorOverlayRef = useRef<PixiCursorOverlay | null>(null);
		const showCursorRef = useRef(showCursor);
		const cursorSizeRef = useRef(cursorSize);
		const cursorSmoothingRef = useRef(cursorSmoothing);
		const cursorMotionBlurRef = useRef(cursorMotionBlur);
		const cursorClickBounceRef = useRef(cursorClickBounce);
		const cursorClipToBoundsRef = useRef(cursorClipToBounds);
		const cursorThemeRef = useRef(cursorTheme);
		const isPreviewingZoomRef = useRef(isPreviewingZoom);
		const motionBlurStateRef = useRef<MotionBlurState>(createMotionBlurState());
		const onTimeUpdateRef = useRef(onTimeUpdate);
		const onPlayStateChangeRef = useRef(onPlayStateChange);
		const videoReadyRafRef = useRef<number | null>(null);
		const smoothedAutoFocusRef = useRef<ZoomFocus | null>(null);
		const prevTargetProgressRef = useRef(0);
		const durationResolutionTimeoutRef = useRef<number | null>(null);
		const lastResolvedDurationRef = useRef<number | null>(null);
		const isResolvingDurationRef = useRef(false);
		const hasNativeCursorRecordingRef = useRef(false);
		const cursorRecordingDataRef = useRef(cursorRecordingData);
		const smoothedNativeCursorPathRef = useRef<SmoothedCursorPath | null>(null);
		const semanticNativeCursorPathRef = useRef<SemanticCursorPath | null>(null);
		/** Recording the installed cursor paths were built from; unchanged data keeps the old path rendering until its replacement is ready. */
		const cursorPathRecordingRef = useRef<CursorRecordingData | null>(null);
		const smartCursorEnabledRef = useRef(smartCursorEnabled);
		const cropRegionRef = useRef(cropRegion);
		const nativeCursorSpriteRef = useRef<Sprite | null>(null);
		const nativeCursorTextureIdRef = useRef<string | null>(null);
		const nativeCursorImageRef = useRef<HTMLImageElement | null>(null);
		const nativeCursorImageIdRef = useRef<string | null>(null);
		const nativeCursorMotionBlurStateRef = useRef(createNativeCursorMotionBlurState());
		const nativeCursorClipRef = useRef<HTMLDivElement | null>(null);
		const borderRadiusRef = useRef<number>(0);

		const hasNativeCursorRecording = useMemo(
			() => hasNativeCursorRecordingData(cursorRecordingData),
			[cursorRecordingData],
		);
		const sampleSemanticCameraFocus = useCallback((timeMs: number): ZoomFocus | null => {
			const sample = semanticNativeCursorPathRef.current?.cameraSampleAt(timeMs);
			return sample ? { cx: sample.cx, cy: sample.cy } : null;
		}, []);

		const syncResolvedDuration = useCallback(
			(video: HTMLVideoElement) => {
				const resolvedDuration = getResolvedVideoDuration(video);
				if (!resolvedDuration) {
					return false;
				}

				const normalizedDuration = Math.round(resolvedDuration * 1000) / 1000;
				if (lastResolvedDurationRef.current !== normalizedDuration) {
					lastResolvedDurationRef.current = normalizedDuration;
					onDurationChange(normalizedDuration);
				}

				return true;
			},
			[onDurationChange],
		);

		const forceResolveDuration = useCallback(
			(video: HTMLVideoElement) => {
				if (isResolvingDurationRef.current) {
					return;
				}

				if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
					return;
				}

				isResolvingDurationRef.current = true;
				const previousMuted = video.muted;

				const finalize = () => {
					video.removeEventListener("durationchange", handleProgress);
					video.removeEventListener("timeupdate", handleProgress);
					video.removeEventListener("loadeddata", handleProgress);
					video.removeEventListener("ended", handleProgress);
					if (durationResolutionTimeoutRef.current) {
						clearTimeout(durationResolutionTimeoutRef.current);
						durationResolutionTimeoutRef.current = null;
					}
					video.muted = previousMuted;
					isResolvingDurationRef.current = false;
				};

				const resolveCurrentDuration = () => {
					if (syncResolvedDuration(video)) {
						return true;
					}

					const endedDuration = getEndedVideoDuration(video);
					if (endedDuration) {
						lastResolvedDurationRef.current = null;
						onDurationChange(Math.round(endedDuration * 1000) / 1000);
						return true;
					}

					return false;
				};

				const handleProgress = () => {
					if (!resolveCurrentDuration()) {
						return;
					}

					try {
						video.pause();
						video.currentTime = 0;
					} catch {
						// no-op
					}
					currentTimeRef.current = 0;
					timelineCurrentTimeRef.current = 0;
					lastTransportClockRef.current = { timelineMs: 0, sourceMs: 0, sourceActive: true };
					lastFollowerBoundaryKeyRef.current = null;
					finalize();
				};

				video.addEventListener("durationchange", handleProgress);
				video.addEventListener("timeupdate", handleProgress);
				video.addEventListener("loadeddata", handleProgress);
				video.addEventListener("ended", handleProgress);
				durationResolutionTimeoutRef.current = window.setTimeout(() => {
					handleProgress();
					finalize();
				}, 1500);
				video.muted = true;

				const playAttempt = video.play();
				if (playAttempt && typeof playAttempt.catch === "function") {
					playAttempt.catch(() => {
						try {
							video.currentTime = Math.max(video.currentTime, 0.1);
						} catch {
							finalize();
						}
					});
				}

				try {
					video.currentTime = Math.max(video.currentTime, 0.1);
				} catch {
					finalize();
				}
			},
			[onDurationChange, syncResolvedDuration],
		);

		// Clamp against getZoomScale(region), not region.depth: depth is just the preset
		// slot (1x/2x/4x) and ignores customScale, which gives wrong drag bounds near the edges.
		const clampFocusForRegion = useCallback((focus: ZoomFocus, region: ZoomRegion) => {
			return clampFocusToScale(focus, getZoomScale(region));
		}, []);

		const updateOverlayForRegion = useCallback(
			(region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
				const overlayEl = overlayRef.current;
				const indicatorEl = focusIndicatorRef.current;

				if (!overlayEl || !indicatorEl) {
					return;
				}

				const stageWidth = overlayEl.clientWidth;
				const stageHeight = overlayEl.clientHeight;
				if (stageWidth && stageHeight) {
					stageSizeRef.current = { width: stageWidth, height: stageHeight };
				}

				updateOverlayIndicator({
					overlayEl,
					indicatorEl,
					region,
					focusOverride,
					videoSize: videoSizeRef.current,
					baseScale: baseScaleRef.current,
					isPlaying: isPlayingRef.current,
				});
			},
			[],
		);

		const layoutVideoContent = useCallback(() => {
			const container = containerRef.current;
			const app = appRef.current;
			const videoSprite = videoSpriteRef.current;
			const maskGraphics = maskGraphicsRef.current;
			const videoElement = videoRef.current;
			const cameraContainer = cameraContainerRef.current;

			if (
				!container ||
				!app ||
				!videoSprite ||
				!maskGraphics ||
				!videoElement ||
				!cameraContainer
			) {
				return;
			}

			// Lock video dimensions on first layout to prevent resize issues
			if (
				!lockedVideoDimensionsRef.current &&
				videoElement.videoWidth > 0 &&
				videoElement.videoHeight > 0
			) {
				lockedVideoDimensionsRef.current = {
					width: videoElement.videoWidth,
					height: videoElement.videoHeight,
				};
			}

			const result = layoutVideoContentUtil({
				container,
				app,
				videoSprite,
				maskGraphics,
				videoElement,
				cropRegion,
				lockedVideoDimensions: lockedVideoDimensionsRef.current,
				borderRadius,
				padding,
				webcamDimensions,
				webcamLayoutPreset,
				webcamSizePreset,
				webcamPosition,
				webcamMaskShape,
			});

			if (result) {
				stageSizeRef.current = result.stageSize;
				videoSizeRef.current = result.videoSize;
				baseScaleRef.current = result.baseScale;
				baseOffsetRef.current = result.baseOffset;
				baseMaskRef.current = result.maskRect;
				borderRadiusRef.current = result.maskBorderRadius;
				cropBoundsRef.current = result.cropBounds;
				setWebcamLayout(result.webcamRect);

				// Reset camera container to identity
				cameraContainer.scale.set(1);
				cameraContainer.position.set(0, 0);

				const selectedId = selectedZoomIdRef.current;
				const activeRegion = selectedId
					? (zoomRegionsRef.current.find((region) => region.id === selectedId) ?? null)
					: null;

				updateOverlayForRegion(activeRegion);
			}
		}, [
			updateOverlayForRegion,
			cropRegion,
			borderRadius,
			padding,
			webcamDimensions,
			webcamLayoutPreset,
			webcamSizePreset,
			webcamPosition,
			webcamMaskShape,
		]);

		useEffect(() => {
			layoutVideoContentRef.current = layoutVideoContent;
		}, [layoutVideoContent]);

		const setOverlayRefs = useCallback((node: HTMLDivElement | null) => {
			overlayRef.current = node;
			setOverlayElement(node);
		}, []);

		const selectedZoom = useMemo(() => {
			if (!selectedZoomId) return null;
			return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
		}, [zoomRegions, selectedZoomId]);

		useEffect(() => {
			audioTrackClipsRef.current = audioTrackClips;
		}, [audioTrackClips]);

		useEffect(() => {
			if (!externalTransportActiveRef.current || !isPlayingRef.current) {
				const timeMs = currentTime * 1000;
				timelineCurrentTimeRef.current = timeMs;
				if (!externalTransportActiveRef.current) currentTimeRef.current = timeMs;
			}
		}, [currentTime]);

		useEffect(() => {
			externalTransportActiveRef.current = externalTransportActive;
		}, [externalTransportActive]);

		const ensurePreviewAudioGraph = useCallback(() => {
			if (typeof AudioContext === "undefined") return;
			const context = audioContextRef.current ?? new AudioContext();
			audioContextRef.current = context;
			for (const [trackOrdinal, element] of audioTrackElementsRef.current) {
				if (audioSourceNodesRef.current.has(trackOrdinal)) continue;
				const sourceNode = context.createMediaElementSource(element);
				const gainNode = context.createGain();
				sourceNode.connect(gainNode).connect(context.destination);
				audioSourceNodesRef.current.set(trackOrdinal, sourceNode);
				audioGainNodesRef.current.set(trackOrdinal, gainNode);
			}
			if (context.state === "suspended") void context.resume();
		}, []);

		const setPreviewAudioTrackElement = useCallback(
			(trackOrdinal: number, element: HTMLAudioElement | null) => {
				if (element) {
					audioTrackElementsRef.current.set(trackOrdinal, element);
					return;
				}
				audioTrackElementsRef.current.delete(trackOrdinal);
				readyAudioTrackOrdinalsRef.current.delete(trackOrdinal);
				audioSourceNodesRef.current.get(trackOrdinal)?.disconnect();
				audioGainNodesRef.current.get(trackOrdinal)?.disconnect();
				audioSourceNodesRef.current.delete(trackOrdinal);
				audioGainNodesRef.current.delete(trackOrdinal);
				audioTransportRef.current.activeClips.delete(trackOrdinal);
				audioTransportRef.current.rateMultipliers.delete(trackOrdinal);
				syncFollowerMediaRef.current(true);
			},
			[],
		);
		const markPreviewAudioTrackReady = useCallback((trackOrdinal: number) => {
			if (readyAudioTrackOrdinalsRef.current.has(trackOrdinal)) return;
			readyAudioTrackOrdinalsRef.current.add(trackOrdinal);
			syncFollowerMediaRef.current(true);
		}, []);
		const markPreviewAudioTrackFailed = useCallback((trackOrdinal: number) => {
			readyAudioTrackOrdinalsRef.current.delete(trackOrdinal);
			syncFollowerMediaRef.current(true);
		}, []);
		const audioTrackRefCallbacksRef = useRef<
			Map<number, (element: HTMLAudioElement | null) => void>
		>(new Map());
		const getPreviewAudioTrackRef = useCallback(
			(trackOrdinal: number) => {
				let callback = audioTrackRefCallbacksRef.current.get(trackOrdinal);
				if (!callback) {
					callback = (element) => setPreviewAudioTrackElement(trackOrdinal, element);
					audioTrackRefCallbacksRef.current.set(trackOrdinal, callback);
				}
				return callback;
			},
			[setPreviewAudioTrackElement],
		);

		useEffect(
			() => () => {
				for (const sourceNode of audioSourceNodesRef.current.values()) sourceNode.disconnect();
				for (const gainNode of audioGainNodesRef.current.values()) gainNode.disconnect();
				audioSourceNodesRef.current.clear();
				audioGainNodesRef.current.clear();
				audioTrackElementsRef.current.clear();
				readyAudioTrackOrdinalsRef.current.clear();
				audioTrackRefCallbacksRef.current.clear();
				const context = audioContextRef.current;
				audioContextRef.current = null;
				if (context && context.state !== "closed") void context.close();
			},
			[],
		);

		const syncFollowerMedia = useCallback(
			(forceSeek = false) => {
				const timelineMs = timelineCurrentTimeRef.current;
				const sourceMs = currentTimeRef.current;
				const sourceActive = lastTransportClockRef.current.sourceActive;
				const speed =
					speedRegionsRef.current.find(
						(region) => timelineMs >= region.startMs && timelineMs < region.endMs,
					)?.speed ?? 1;
				const playing = isPlayingRef.current;
				const transport = audioTransportRef.current;
				const clips = audioTrackClipsRef.current;
				const video = videoRef.current;
				const trackOrdinals = [...new Set(clips.map((clip) => clip.trackOrdinal))];
				const useExtractedTracks = areExplicitPreviewAudioTracksReady(
					trackOrdinals,
					readyAudioTrackOrdinalsRef.current,
				);

				if (video) {
					// Keep the embedded track audible until every editable physical track has
					// been prepared, except when the edit explicitly contains no audible clip.
					video.muted = shouldMuteEmbeddedPreviewAudio(clips, useExtractedTracks);
				}
				if (playing && useExtractedTracks) ensurePreviewAudioGraph();

				const syncMediaElement = (
					element: HTMLMediaElement | null,
					targetSeconds: number,
					rateKey: "supplementalRateMultiplier" | "webcamRateMultiplier",
					forceFollowerSeek = false,
					mediaRateMultiplier = 1,
				) => {
					if (!element) return;
					let correction = resolvePreviewDrift(element.currentTime - targetSeconds);
					if (
						forceSeek ||
						forceFollowerSeek ||
						(playing && !transport.wasPlaying) ||
						correction.type === "seek"
					) {
						if (Math.abs(element.currentTime - targetSeconds) > 0.005) {
							element.currentTime = Math.max(0, targetSeconds);
						}
						correction = { type: "none", rateMultiplier: 1 };
					}
					transport[rateKey] = correction.rateMultiplier;
					const desiredRate = speed * mediaRateMultiplier * transport[rateKey];
					if (element.playbackRate !== desiredRate) element.playbackRate = desiredRate;
					if (playing) {
						if (element.paused) void element.play().catch(() => undefined);
					} else {
						element.pause();
					}
				};

				const supplementalAudio = supplementalAudioRef.current;
				if (clips.length === 0 && sourceActive) {
					syncMediaElement(supplementalAudio, sourceMs / 1000, "supplementalRateMultiplier");
				} else {
					supplementalAudio?.pause();
				}

				const syncTrack = (trackOrdinal: number, element: HTMLAudioElement | null) => {
					if (!element) return;
					const clip = clips.find(
						(candidate) =>
							candidate.trackOrdinal === trackOrdinal &&
							!candidate.muted &&
							candidate.gain > 0 &&
							timelineMs >= candidate.startMs &&
							timelineMs < candidate.endMs,
					);
					if (!clip) {
						element.pause();
						transport.activeClips.delete(trackOrdinal);
						return;
					}

					const targetSeconds = (clip.sourceStartMs + timelineMs - clip.startMs) / 1000;
					const previousClip = transport.activeClips.get(trackOrdinal);
					const enteredDiscontinuousClip =
						previousClip?.id !== clip.id && !areMediaSpansContinuous(previousClip, clip);
					let correction = resolvePreviewDrift(element.currentTime - targetSeconds);
					if (
						forceSeek ||
						(playing && !transport.wasPlaying) ||
						enteredDiscontinuousClip ||
						correction.type === "seek"
					) {
						if (Math.abs(element.currentTime - targetSeconds) > 0.005) {
							element.currentTime = Math.max(0, targetSeconds);
						}
						correction = { type: "none", rateMultiplier: 1 };
					}
					transport.activeClips.set(trackOrdinal, clip);
					transport.rateMultipliers.set(trackOrdinal, correction.rateMultiplier);

					const gain = Math.min(4, Math.max(0, clip.gain));
					const gainNode = audioGainNodesRef.current.get(trackOrdinal);
					if (gainNode) {
						if (gainNode.gain.value !== gain) gainNode.gain.value = gain;
						if (element.volume !== 1) element.volume = 1;
					} else if (element.volume !== Math.min(1, gain)) {
						element.volume = Math.min(1, gain);
					}
					const desiredRate = speed * (transport.rateMultipliers.get(trackOrdinal) ?? 1);
					if (element.playbackRate !== desiredRate) element.playbackRate = desiredRate;
					if (playing) {
						if (element.paused) void element.play().catch(() => undefined);
					} else {
						element.pause();
					}
				};

				for (const [trackOrdinal, element] of audioTrackElementsRef.current) {
					if (useExtractedTracks) syncTrack(trackOrdinal, element);
					else element.pause();
				}
				const webcamPoint = sourceActive
					? resolveWebcamSyncPoint(sourceMs, webcamSyncRef.current)
					: null;
				if (webcamPoint) {
					const webcamBoundaryChanged = transport.webcamBoundaryKey !== webcamPoint.boundaryKey;
					transport.webcamBoundaryKey = webcamPoint.boundaryKey;
					syncMediaElement(
						webcamVideoRef.current,
						webcamPoint.webcamTimeMs / 1000,
						"webcamRateMultiplier",
						webcamBoundaryChanged,
						webcamPoint.localRate,
					);
				} else {
					transport.webcamBoundaryKey = "gap";
					webcamVideoRef.current?.pause();
				}
				transport.wasPlaying = playing;
			},
			[ensurePreviewAudioGraph],
		);
		syncFollowerMediaRef.current = syncFollowerMedia;

		const updateTransportClock = useCallback(
			(timelineMs: number, sourceMs: number, sourceActive = true) => {
				if (!Number.isFinite(timelineMs) || !Number.isFinite(sourceMs)) return;
				const nextClock = {
					timelineMs: Math.max(0, timelineMs),
					sourceMs: Math.max(0, sourceMs),
					sourceActive,
				};
				const previousClock = lastTransportClockRef.current;
				const timelineDelta = nextClock.timelineMs - previousClock.timelineMs;
				const sourceDelta = nextClock.sourceMs - previousClock.sourceMs;
				const discontinuity =
					Math.abs(timelineDelta) > 100 ||
					Math.abs(sourceDelta) > 100 ||
					Math.abs(timelineDelta - sourceDelta) > 100;
				const sourceActivityChanged = previousClock.sourceActive !== nextClock.sourceActive;
				lastTransportClockRef.current = nextClock;
				timelineCurrentTimeRef.current = nextClock.timelineMs;
				currentTimeRef.current = nextClock.sourceMs;

				const boundaryKey = `${createFollowerBoundaryKey(
					nextClock.timelineMs,
					nextClock.sourceActive,
					audioTrackClipsRef.current,
					speedRegionsRef.current,
				)}|webcam:${
					nextClock.sourceActive
						? webcamSyncBoundaryAt(nextClock.sourceMs, webcamSyncRef.current)
						: "inactive"
				}`;
				const boundaryChanged = boundaryKey !== lastFollowerBoundaryKeyRef.current;
				lastFollowerBoundaryKeyRef.current = boundaryKey;

				const nowMs = performance.now();
				if (discontinuity || boundaryChanged || nowMs - lastFollowerSyncAtMsRef.current >= 500) {
					lastFollowerSyncAtMsRef.current = nowMs;
					syncFollowerMediaRef.current(
						discontinuity || (sourceActivityChanged && nextClock.sourceActive),
					);
				}
				if (!isPlayingRef.current && !isScrubbingRef.current) {
					renderPreviewFrameRef.current();
				}
			},
			[],
		);

		const seekAudioToTimeline = useCallback((timeSeconds: number) => {
			timelineCurrentTimeRef.current = Math.max(0, timeSeconds * 1000);
			syncFollowerMediaRef.current(true);
		}, []);

		useImperativeHandle(ref, () => ({
			video: videoRef.current,
			app: appRef.current,
			videoSprite: videoSpriteRef.current,
			videoContainer: videoContainerRef.current,
			containerRef,
			play: async () => {
				const vid = videoRef.current;
				if (!vid) return;
				try {
					ensurePreviewAudioGraph();
					allowPlaybackRef.current = true;
					enableAllPreviewAudioTracks(vid);
					await vid.play().catch((err) => {
						console.log("PLAY ERROR:", err);
						throw err;
					});
					syncFollowerMediaRef.current(true);
				} catch (error) {
					allowPlaybackRef.current = false;
					throw error;
				}
			},
			pause: () => {
				const video = videoRef.current;
				allowPlaybackRef.current = false;
				if (!video) {
					return;
				}
				video.pause();
				supplementalAudioRef.current?.pause();
				webcamVideoRef.current?.pause();
				for (const element of audioTrackElementsRef.current.values()) element.pause();
			},
			seekTimeline: seekAudioToTimeline,
			updateTransportClock,
		}));

		const updateFocusFromClientPoint = (clientX: number, clientY: number) => {
			const overlayEl = overlayRef.current;
			if (!overlayEl) return;

			const regionId = selectedZoomIdRef.current;
			if (!regionId) return;

			const region = zoomRegionsRef.current.find((r) => r.id === regionId);
			if (!region) return;

			const rect = overlayEl.getBoundingClientRect();
			const stageWidth = rect.width;
			const stageHeight = rect.height;

			if (!stageWidth || !stageHeight) {
				return;
			}

			stageSizeRef.current = { width: stageWidth, height: stageHeight };

			const localX = clientX - rect.left;
			const localY = clientY - rect.top;

			const unclampedFocus: ZoomFocus = {
				cx: clamp01(localX / stageWidth),
				cy: clamp01(localY / stageHeight),
			};
			const clampedFocus = clampFocusForRegion(unclampedFocus, region);

			onZoomFocusChange(region.id, clampedFocus);
			updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
		};

		const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
			if (isPlayingRef.current) return;
			const regionId = selectedZoomIdRef.current;
			if (!regionId) return;
			const region = zoomRegionsRef.current.find((r) => r.id === regionId);
			if (!region) return;
			if (region.focusMode === "auto") return;
			onSelectZoom(region.id);
			event.preventDefault();
			isDraggingFocusRef.current = true;
			event.currentTarget.setPointerCapture(event.pointerId);
			updateFocusFromClientPoint(event.clientX, event.clientY);
		};

		const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
			if (!isDraggingFocusRef.current) return;
			event.preventDefault();
			updateFocusFromClientPoint(event.clientX, event.clientY);
		};

		const endFocusDrag = (event: React.PointerEvent<HTMLDivElement>) => {
			if (!isDraggingFocusRef.current) return;
			isDraggingFocusRef.current = false;
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
				// Pointer may already be released.
			}
			onZoomFocusDragEnd?.();
		};

		const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
			endFocusDrag(event);
		};

		const handleOverlayPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
			endFocusDrag(event);
		};

		// ── Webcam PiP drag handlers ──

		const handleWebcamPointerDown = (event: React.PointerEvent<HTMLVideoElement>) => {
			if (isPlayingRef.current) return;
			if (webcamLayoutPreset !== "picture-in-picture") return;
			event.preventDefault();
			event.stopPropagation();
			isDraggingWebcamRef.current = true;
			event.currentTarget.setPointerCapture(event.pointerId);

			const webcamEl = event.currentTarget;
			const webcamRect = webcamEl.getBoundingClientRect();
			webcamDragOffsetRef.current = {
				dx: event.clientX - (webcamRect.left + webcamRect.width / 2),
				dy: event.clientY - (webcamRect.top + webcamRect.height / 2),
			};
		};

		const handleWebcamPointerMove = (event: React.PointerEvent<HTMLVideoElement>) => {
			if (!isDraggingWebcamRef.current) return;
			event.preventDefault();
			event.stopPropagation();

			const containerEl = containerRef.current;
			if (!containerEl || !onWebcamPositionChange) return;

			const containerRect = containerEl.getBoundingClientRect();
			const cx = clamp01(
				(event.clientX - webcamDragOffsetRef.current.dx - containerRect.left) / containerRect.width,
			);
			const cy = clamp01(
				(event.clientY - webcamDragOffsetRef.current.dy - containerRect.top) / containerRect.height,
			);
			onWebcamPositionChange({ cx, cy });
		};

		const handleWebcamPointerUp = (event: React.PointerEvent<HTMLVideoElement>) => {
			if (!isDraggingWebcamRef.current) return;
			isDraggingWebcamRef.current = false;
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
				// Pointer may already be released.
			}
			onWebcamPositionDragEnd?.();
		};

		useEffect(() => {
			zoomRegionsRef.current = zoomRegions;
		}, [zoomRegions]);

		useEffect(() => {
			cursorTelemetryRef.current = cursorTelemetry;
		}, [cursorTelemetry]);

		useEffect(() => {
			cursorClickTimestampsRef.current = cursorClickTimestamps;
		}, [cursorClickTimestamps]);

		useEffect(() => {
			selectedZoomIdRef.current = selectedZoomId;
		}, [selectedZoomId]);

		useEffect(() => {
			isPlayingRef.current = isPlaying;
		}, [isPlaying]);

		useEffect(() => {
			trimRegionsRef.current = trimRegions;
		}, [trimRegions]);

		useEffect(() => {
			speedRegionsRef.current = speedRegions;
		}, [speedRegions]);

		useEffect(() => {
			motionBlurAmountRef.current = motionBlurAmount;
		}, [motionBlurAmount]);

		useEffect(() => {
			cursorTelemetryRef.current = cursorTelemetry;
		}, [cursorTelemetry]);

		useEffect(() => {
			showCursorRef.current = showCursor;
		}, [showCursor]);

		useEffect(() => {
			hasNativeCursorRecordingRef.current = hasNativeCursorRecording;
		}, [hasNativeCursorRecording]);

		useEffect(() => {
			cursorRecordingDataRef.current = cursorRecordingData;
			resetNativeCursorMotionBlurState(nativeCursorMotionBlurStateRef.current);
		}, [cursorRecordingData]);

		useEffect(() => {
			cropRegionRef.current = cropRegion;
		}, [cropRegion]);

		useEffect(() => {
			cursorSizeRef.current = cursorSize;
		}, [cursorSize]);

		useEffect(() => {
			cursorSmoothingRef.current = cursorSmoothing;
		}, [cursorSmoothing]);

		useEffect(() => {
			smartCursorEnabledRef.current = smartCursorEnabled;
		}, [smartCursorEnabled]);

		useEffect(() => {
			let cancelled = false;
			let idleId: number | null = null;
			let timeoutId: number | null = null;
			let worker: Worker | null = null;
			const semanticFallbackSmoothing = Number.parseFloat(
				(Number.isFinite(cursorSmoothing) ? Math.min(1, Math.max(0, cursorSmoothing)) : 0).toFixed(
					2,
				),
			);
			// Only a different recording invalidates the installed paths. Smoothing/smart-mode
			// changes keep the old path rendering until its replacement is ready, so the preview
			// never falls back to raw samples mid-swap.
			if (cursorPathRecordingRef.current !== cursorRecordingData) {
				cursorPathRecordingRef.current = cursorRecordingData ?? null;
				smoothedNativeCursorPathRef.current = null;
				semanticNativeCursorPathRef.current = null;
			}
			if (!cursorRecordingData?.samples.length) return;

			const installPath = (path: SmoothedCursorPath | null) => {
				if (cancelled) return;
				smoothedNativeCursorPathRef.current = path;
				renderPreviewFrameRef.current();
			};
			const buildOnMainThread = () => {
				if (cancelled) return;
				semanticNativeCursorPathRef.current = null;
				installPath(getSmoothedCursorPath(cursorRecordingData, cursorSmoothing));
			};
			const scheduleOnMainThread = (callback: () => void) => {
				if (cancelled || idleId !== null || timeoutId !== null) return;
				if (typeof window.requestIdleCallback === "function") {
					idleId = window.requestIdleCallback(
						() => {
							idleId = null;
							if (!cancelled) callback();
						},
						{ timeout: 500 },
					);
				} else {
					timeoutId = window.setTimeout(() => {
						timeoutId = null;
						if (!cancelled) callback();
					}, 0);
				}
			};
			const scheduleFallback = () => scheduleOnMainThread(buildOnMainThread);
			const terminateWorker = () => {
				worker?.terminate();
				worker = null;
			};

			if (smartCursorEnabled) {
				const installSemanticPath = (
					fallbackPath?: SmoothedCursorPath,
					fallbackSmoothing = cursorSmoothing,
				) => {
					if (cancelled) return;
					const semanticPath = getSemanticCursorPath(
						cursorRecordingData,
						fallbackSmoothing,
						fallbackPath,
					);
					semanticNativeCursorPathRef.current = semanticPath;
					installPath(semanticPath);
				};
				// Semantic analysis is O(samples) and cached — build synchronously so the render
				// loop never sees a missing path (raw-sample fallback) while smart mode is on.
				const prepared = prepareSemanticCursorPath(cursorRecordingData);
				if (
					!prepared.requiresFallbackPath ||
					semanticFallbackSmoothing <= 0 ||
					typeof Worker === "undefined"
				) {
					installSemanticPath();
					return () => {
						cancelled = true;
					};
				}

				// The spring fallback for anchor-poor runs is duration-proportional, so it stays on
				// the worker. Until it lands, an interim path with unsmoothed fallback runs (a cheap
				// array copy) keeps the semantic runs — identical in both paths — rendering.
				installSemanticPath(undefined, 0);
				try {
					worker = new Worker(
						new URL("../../lib/cursor/cursorPathSmoothing.worker.ts", import.meta.url),
						{ type: "module" },
					);
				} catch {
					scheduleOnMainThread(() => installSemanticPath());
					return () => {
						cancelled = true;
						if (idleId !== null) window.cancelIdleCallback(idleId);
						if (timeoutId !== null) window.clearTimeout(timeoutId);
					};
				}
				worker.onmessage = (
					event: MessageEvent<{ path?: SerializedSmoothedCursorPath; error?: string }>,
				) => {
					if (event.data.path) {
						installSemanticPath(createSmoothedCursorPath(event.data.path));
						terminateWorker();
						return;
					}
					terminateWorker();
					scheduleOnMainThread(() => installSemanticPath());
				};
				worker.onerror = () => {
					terminateWorker();
					scheduleOnMainThread(() => installSemanticPath());
				};
				try {
					worker.postMessage({
						samples: prepared.fallbackSamples,
						smoothing: semanticFallbackSmoothing,
					});
				} catch {
					terminateWorker();
					scheduleOnMainThread(() => installSemanticPath());
				}
				return () => {
					cancelled = true;
					terminateWorker();
					if (idleId !== null) window.cancelIdleCallback(idleId);
					if (timeoutId !== null) window.clearTimeout(timeoutId);
				};
			}

			// The raw path is only O(samples). The expensive 240Hz spring resampling
			// stays off the renderer thread so long recordings cannot stall preview.
			if (cursorSmoothing <= 0 || typeof Worker === "undefined") {
				scheduleFallback();
				return () => {
					cancelled = true;
					if (idleId !== null) window.cancelIdleCallback(idleId);
					if (timeoutId !== null) window.clearTimeout(timeoutId);
				};
			}

			worker = new Worker(
				new URL("../../lib/cursor/cursorPathSmoothing.worker.ts", import.meta.url),
				{ type: "module" },
			);
			worker.onmessage = (
				event: MessageEvent<{ path?: SerializedSmoothedCursorPath; error?: string }>,
			) => {
				if (event.data.path) {
					if (!cancelled) semanticNativeCursorPathRef.current = null;
					installPath(createSmoothedCursorPath(event.data.path));
				} else {
					scheduleFallback();
				}
				terminateWorker();
			};
			worker.onerror = () => {
				terminateWorker();
				scheduleFallback();
			};
			worker.postMessage({
				samples: cursorRecordingData.samples,
				smoothing: cursorSmoothing,
			});
			return () => {
				cancelled = true;
				terminateWorker();
				if (idleId !== null) window.cancelIdleCallback(idleId);
				if (timeoutId !== null) window.clearTimeout(timeoutId);
			};
		}, [cursorRecordingData, cursorSmoothing, smartCursorEnabled]);

		useEffect(() => {
			cursorMotionBlurRef.current = cursorMotionBlur;
		}, [cursorMotionBlur]);

		useEffect(() => {
			cursorClickBounceRef.current = cursorClickBounce;
		}, [cursorClickBounce]);

		useEffect(() => {
			cursorClipToBoundsRef.current = cursorClipToBounds;
		}, [cursorClipToBounds]);

		useEffect(() => {
			cursorThemeRef.current = cursorTheme;
		}, [cursorTheme]);

		useEffect(() => {
			webcamSyncRef.current = webcamSync;
			audioTransportRef.current.webcamBoundaryKey = null;
			lastFollowerBoundaryKeyRef.current = null;
			syncFollowerMediaRef.current(true);
		}, [webcamSync]);

		useEffect(() => {
			webcamReactiveZoomRef.current = webcamReactiveZoom;
			webcamLayoutPresetRef.current = webcamLayoutPreset;
			webcamPositionRef.current = webcamPosition;
			// Clear any reactive transform when the effect is turned off or layout changes,
			// so a stale shrink doesn't linger while the ticker isn't updating it.
			if (
				webcamWrapperRef.current &&
				(!webcamReactiveZoom || webcamLayoutPreset !== "picture-in-picture")
			) {
				webcamWrapperRef.current.style.transform = "";
			}
		}, [webcamReactiveZoom, webcamLayoutPreset, webcamPosition]);

		useEffect(() => {
			isPreviewingZoomRef.current = isPreviewingZoom;
		}, [isPreviewingZoom]);

		useEffect(() => {
			if (videoContainerRef.current) {
				videoContainerRef.current.visible = showSourceVideo;
			}
		}, [showSourceVideo, pixiReady, videoReady]);

		// Sync cursor overlay config when settings change
		useEffect(() => {
			const overlay = cursorOverlayRef.current;
			if (!overlay) return;
			overlay.setDotRadius(DEFAULT_CURSOR_CONFIG.dotRadius * cursorSize);
			overlay.setSmoothingFactor(cursorSmoothing);
			overlay.setMotionBlur(cursorMotionBlur);
			overlay.setClickBounce(cursorClickBounce);
			overlay.reset();
		}, [cursorSize, cursorSmoothing, cursorMotionBlur, cursorClickBounce]);

		useEffect(() => {
			if (pixiReady && videoReady) layoutVideoContent();
		}, [layoutVideoContent, pixiReady, videoReady]);

		useEffect(() => {
			if (!isPlayingRef.current && !isScrubbingRef.current) {
				renderPreviewFrameRef.current();
			}
		}, [
			cropRegion,
			cursorClickBounce,
			cursorClipToBounds,
			cursorMotionBlur,
			cursorRecordingData,
			cursorSize,
			cursorSmoothing,
			cursorTelemetry,
			cursorTheme,
			isPreviewingZoom,
			motionBlurAmount,
			selectedZoomId,
			showCursor,
			showSourceVideo,
			webcamLayoutPreset,
			webcamPosition,
			webcamReactiveZoom,
			zoomRegions,
		]);

		useEffect(() => {
			onTimeUpdateRef.current = onTimeUpdate;
		}, [onTimeUpdate]);

		useEffect(() => {
			onPlayStateChangeRef.current = onPlayStateChange;
		}, [onPlayStateChange]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			const el = overlayRef.current;
			if (!el) return;

			// Seed immediately so overlays never start at 800×600
			setOverlaySize({ width: el.clientWidth, height: el.clientHeight });

			const observer = new ResizeObserver((entries) => {
				if (!entries[0]) return;
				const { width, height } = entries[0].contentRect;
				setOverlaySize((prev) => {
					if (prev.width === width && prev.height === height) return prev;
					return { width, height };
				});
			});

			observer.observe(el);
			return () => observer.disconnect();
		}, [pixiReady, videoReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			const container = containerRef.current;
			if (!container) return;

			if (typeof ResizeObserver === "undefined") {
				return;
			}

			const observer = new ResizeObserver(() => {
				layoutVideoContent();
			});

			observer.observe(container);
			return () => {
				observer.disconnect();
			};
		}, [pixiReady, videoReady, layoutVideoContent]);

		const applyPreviewResolution = useCallback((targetResolution: number) => {
			const app = appRef.current;
			const container = containerRef.current;
			if (!app || !container) return;
			if (Math.abs(app.renderer.resolution - targetResolution) < 0.001) return;

			const cssWidth = container.clientWidth;
			const cssHeight = container.clientHeight;
			if (!cssWidth || !cssHeight) return;

			app.renderer.resolution = targetResolution;
			if (blurFilterRef.current) blurFilterRef.current.resolution = targetResolution;
			app.renderer.resize(cssWidth, cssHeight);
			// renderer.resize updates the backing store; keep layout dimensions CSS-driven.
			app.canvas.style.width = "100%";
			app.canvas.style.height = "100%";
			app.render();
		}, []);

		// Start playback at a balanced 1.5x backing resolution and adapt from measured
		// render/drop performance. Paused frames always return to the full device DPR.
		useEffect(() => {
			if (!pixiReady) return;
			const nextState = setPreviewResolutionPlaybackActive(previewResolutionControllerRef.current, {
				active: isPlaying || isScrubbing,
				devicePixelRatio: window.devicePixelRatio || 1,
				nowMs: performance.now(),
			});
			previewResolutionControllerRef.current = nextState;
			applyPreviewResolution(nextState.resolution);
		}, [applyPreviewResolution, isPlaying, isScrubbing, pixiReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			updateOverlayForRegion(selectedZoom);
		}, [selectedZoom, pixiReady, videoReady, updateOverlayForRegion]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			const overlayEl = overlayElement;
			if (!overlayEl) return;
			if (!selectedZoom) {
				overlayEl.style.cursor = "default";
				overlayEl.style.pointerEvents = "none";
				return;
			}
			overlayEl.style.cursor = isPlaying ? "not-allowed" : "grab";
			overlayEl.style.pointerEvents = isPlaying ? "none" : "auto";
		}, [selectedZoom, isPlaying, pixiReady, videoReady, overlayElement]);

		useEffect(() => {
			const overlayEl = overlayElement;
			if (!overlayEl) return;

			const updateOverlaySize = () => {
				const width = overlayEl.clientWidth || 800;
				const height = overlayEl.clientHeight || 600;
				setOverlaySize((prev) => {
					if (prev.width === width && prev.height === height) return prev;
					return { width, height };
				});
			};

			updateOverlaySize();

			if (typeof ResizeObserver !== "undefined") {
				const observer = new ResizeObserver(() => {
					updateOverlaySize();
				});
				observer.observe(overlayEl);
				return () => observer.disconnect();
			}

			window.addEventListener("resize", updateOverlaySize);
			return () => window.removeEventListener("resize", updateOverlaySize);
		}, [overlayElement]);

		useEffect(() => {
			const container = containerRef.current;
			if (!container) return;

			let mounted = true;
			let app: Application | null = null;

			(async () => {
				let cursorOverlayEnabled = true;
				try {
					await preloadCursorAssets();
				} catch {
					cursorOverlayEnabled = false;
				}

				app = new Application();

				await app.init({
					width: container.clientWidth,
					height: container.clientHeight,
					backgroundAlpha: 0,
					antialias: true,
					resolution: window.devicePixelRatio || 1,
					autoDensity: true,
					powerPreference: "high-performance",
				});

				app.ticker.maxFPS = 60;
				app.stop();

				if (!mounted) {
					app.destroy(true, {
						children: true,
						texture: true,
						textureSource: true,
					});
					return;
				}

				appRef.current = app;
				container.appendChild(app.canvas);

				// Camera container - this will be scaled/positioned for zoom
				const cameraContainer = new Container();
				cameraContainerRef.current = cameraContainer;
				app.stage.addChild(cameraContainer);

				// Video container - holds the masked video sprite
				const videoContainer = new Container();
				videoContainerRef.current = videoContainer;
				cameraContainer.addChild(videoContainer);

				// Cursor overlay - rendered above the masked video
				if (cursorOverlayEnabled) {
					const cursorOverlay = new PixiCursorOverlay({
						dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius * cursorSizeRef.current,
						smoothingFactor: cursorSmoothingRef.current,
						motionBlur: cursorMotionBlurRef.current,
						clickBounce: cursorClickBounceRef.current,
					});
					cursorOverlayRef.current = cursorOverlay;
				}

				setPixiReady(true);
			})();

			return () => {
				mounted = false;
				setPixiReady(false);
				if (cursorOverlayRef.current) {
					cursorOverlayRef.current.destroy();
					cursorOverlayRef.current = null;
				}
				nativeCursorSpriteRef.current = null;
				nativeCursorTextureIdRef.current = null;
				nativeCursorImageIdRef.current = null;
				if (app && app.renderer) {
					app.destroy(true, {
						children: true,
						texture: true,
						textureSource: true,
					});
				}
				appRef.current = null;
				cameraContainerRef.current = null;
				videoContainerRef.current = null;
				videoSpriteRef.current = null;
			};
		}, []);

		const audioTrackOrdinals = useMemo(
			() => [...new Set(audioTrackClips.map((clip) => clip.trackOrdinal))].sort((a, b) => a - b),
			[audioTrackClips],
		);
		const hasExplicitAudioTracks = audioTrackOrdinals.length > 0;
		// File-backed tracks (voice-over) resolve to their own file, so a regenerated
		// file at a new path must re-run track preparation even when ordinals repeat.
		const fileBackedAudioSourceKey = useMemo(
			() =>
				audioTrackClips
					.filter((clip) => isFileBackedAudioClip(clip))
					.map((clip) => `${clip.trackOrdinal}:${clip.sourcePath}`)
					.sort()
					.join("|"),
			[audioTrackClips],
		);

		useEffect(() => {
			setSupplementalAudioPath(null);
			if (!videoPath || !shouldPrepareLegacySupplementalAudio(hasExplicitAudioTracks)) {
				return;
			}

			let cancelled = false;
			window.electronAPI
				?.preparePreviewAudioTrack?.(videoPath)
				.then((result) => {
					if (!cancelled) {
						setSupplementalAudioPath(result.success ? (result.path ?? null) : null);
					}
				})
				.catch(() => {
					if (!cancelled) setSupplementalAudioPath(null);
				});
			return () => {
				cancelled = true;
			};
		}, [hasExplicitAudioTracks, videoPath]);

		useEffect(() => {
			if (!videoPath) {
				lastResolvedDurationRef.current = null;
				isResolvingDurationRef.current = false;
				setVideoReady(false);
				setSupplementalAudioPath(null);
				setPreparedAudioTracks([]);
				return;
			}

			const video = videoRef.current;
			if (!video) return;
			video.pause();
			video.currentTime = 0;
			allowPlaybackRef.current = false;
			lockedVideoDimensionsRef.current = null;
			lastResolvedDurationRef.current = null;
			isResolvingDurationRef.current = false;
			if (durationResolutionTimeoutRef.current) {
				clearTimeout(durationResolutionTimeoutRef.current);
				durationResolutionTimeoutRef.current = null;
			}
			setVideoReady(false);
			if (videoReadyRafRef.current) {
				cancelAnimationFrame(videoReadyRafRef.current);
				videoReadyRafRef.current = null;
			}
			video.load();
		}, [videoPath]);

		useEffect(() => {
			readyAudioTrackOrdinalsRef.current.clear();
			setPreparedAudioTracks([]);
			syncFollowerMediaRef.current(true);
			if (!videoPath || audioTrackOrdinals.length === 0) return;
			let cancelled = false;
			void Promise.all(
				audioTrackOrdinals.map(async (trackOrdinal) => {
					const fileBacked = audioTrackClipsRef.current.find(
						(clip) => clip.trackOrdinal === trackOrdinal && isFileBackedAudioClip(clip),
					);
					if (fileBacked?.sourcePath) {
						// Standalone audio file (voice-over): playable directly, no extraction.
						return { trackOrdinal, path: toFileUrl(fileBacked.sourcePath) };
					}
					try {
						const result = await window.electronAPI.preparePreviewAudioTrack(
							videoPath,
							trackOrdinal,
						);
						return result.success && result.path ? { trackOrdinal, path: result.path } : null;
					} catch {
						return null;
					}
				}),
			).then((tracks) => {
				if (!cancelled) {
					setPreparedAudioTracks(
						tracks.filter((track): track is PreparedPreviewAudioTrack => track !== null),
					);
				}
			});
			return () => {
				cancelled = true;
			};
		}, [audioTrackOrdinals, fileBackedAudioSourceKey, videoPath]);

		// Followers react to transport events and clip/source changes. Ongoing drift
		// checks are triggered by updateTransportClock at 500ms intervals, not by
		// React's playhead snapshots.
		useEffect(() => {
			syncFollowerMediaRef.current(true);
		}, [
			audioTrackClips,
			isPlaying,
			preparedAudioTracks,
			speedRegions,
			supplementalAudioPath,
			webcamVideoPath,
		]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const video = videoRef.current;
			const app = appRef.current;
			const videoContainer = videoContainerRef.current;

			if (!video || !app || !videoContainer) return;
			if (video.videoWidth === 0 || video.videoHeight === 0) return;

			const source = VideoSource.from(video);
			if ("autoPlay" in source) {
				(source as { autoPlay?: boolean }).autoPlay = false;
			}
			if ("autoUpdate" in source) {
				(source as { autoUpdate?: boolean }).autoUpdate = true;
			}
			const videoTexture = Texture.from(source);

			const videoSprite = new Sprite(videoTexture);
			videoSpriteRef.current = videoSprite;

			const maskGraphics = new Graphics();
			videoContainer.addChild(videoSprite);
			videoContainer.addChild(maskGraphics);
			videoContainer.mask = maskGraphics;
			maskGraphicsRef.current = maskGraphics;
			const nativeCursorSprite = new Sprite(Texture.EMPTY);
			nativeCursorSprite.visible = false;
			nativeCursorSprite.eventMode = "none";
			nativeCursorSpriteRef.current = nativeCursorSprite;
			if (cursorOverlayRef.current) {
				videoContainer.addChild(cursorOverlayRef.current.container);
			}

			videoContainer.addChild(nativeCursorSprite);

			animationStateRef.current = {
				scale: 1,
				focusX: DEFAULT_FOCUS.cx,
				focusY: DEFAULT_FOCUS.cy,
				progress: 0,
				x: 0,
				y: 0,
				appliedScale: 1,
			};

			const blurFilter = new BlurFilter();
			blurFilter.quality = 3;
			blurFilter.resolution = app.renderer.resolution;
			blurFilter.blur = 0;
			const motionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);
			blurFilterRef.current = blurFilter;
			motionBlurFilterRef.current = motionBlurFilter;

			layoutVideoContentRef.current?.();
			video.pause();

			const { handlePlay, handlePause, handleSeeked, handleSeeking } = createVideoEventHandlers({
				video,
				isSeekingRef,
				isPlayingRef,
				allowPlaybackRef,
				currentTimeRef,
				timeUpdateAnimationRef,
				onPlayStateChange: (playing) => {
					onPlayStateChangeRef.current(playing);
					syncFollowerMediaRef.current(true);
				},
				onTimeUpdate: (time) => {
					if (!externalTransportActiveRef.current) {
						updateTransportClock(time * 1000, time * 1000);
					} else if (!isPlayingRef.current) {
						syncFollowerMediaRef.current(true);
						renderPreviewFrameRef.current();
					}
					onTimeUpdateRef.current(time);
				},
				trimRegionsRef,
				speedRegionsRef,
				isScrubbingRef,
				scrubEndTimerRef,
				onScrubChange: (scrubbing) => setIsScrubbing(scrubbing),
				externalTransportActiveRef,
			});

			video.addEventListener("play", handlePlay);
			video.addEventListener("pause", handlePause);
			video.addEventListener("ended", handlePause);
			video.addEventListener("seeked", handleSeeked);
			video.addEventListener("seeking", handleSeeking);

			return () => {
				video.removeEventListener("play", handlePlay);
				video.removeEventListener("pause", handlePause);
				video.removeEventListener("ended", handlePause);
				video.removeEventListener("seeked", handleSeeked);
				video.removeEventListener("seeking", handleSeeking);

				if (timeUpdateAnimationRef.current) {
					cancelAnimationFrame(timeUpdateAnimationRef.current);
				}

				if (videoSprite) {
					videoContainer.removeChild(videoSprite);
					videoSprite.destroy();
				}
				if (maskGraphics) {
					videoContainer.removeChild(maskGraphics);
					maskGraphics.destroy();
				}
				if (nativeCursorSpriteRef.current) {
					videoContainer.removeChild(nativeCursorSpriteRef.current);
					nativeCursorSpriteRef.current.destroy();
					nativeCursorSpriteRef.current = null;
					nativeCursorTextureIdRef.current = null;
				}
				videoContainer.mask = null;
				maskGraphicsRef.current = null;
				if (blurFilterRef.current) {
					videoContainer.filters = null;
					blurFilterRef.current.destroy();
					blurFilterRef.current = null;
				}
				if (motionBlurFilterRef.current) {
					motionBlurFilterRef.current.destroy();
					motionBlurFilterRef.current = null;
				}
				videoTexture.destroy(true);

				videoSpriteRef.current = null;
			};
		}, [pixiReady, updateTransportClock, videoReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const app = appRef.current;
			const videoSprite = videoSpriteRef.current;
			const videoContainer = videoContainerRef.current;
			if (!app || !videoSprite || !videoContainer) return;

			const applyTransformFn = (
				transform: { scale: number; x: number; y: number },
				targetFocus: ZoomFocus,
				motionIntensity: number,
				motionVector: { x: number; y: number },
			) => {
				const cameraContainer = cameraContainerRef.current;
				if (!cameraContainer) return;

				const state = animationStateRef.current;

				const appliedTransform = applyZoomTransform({
					cameraContainer,
					blurFilter: blurFilterRef.current,
					motionBlurFilter: motionBlurFilterRef.current,
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: state.scale,
					zoomProgress: state.progress,
					focusX: targetFocus.cx,
					focusY: targetFocus.cy,
					motionIntensity,
					motionVector,
					isPlaying: isPlayingRef.current,
					motionBlurAmount: motionBlurAmountRef.current,
					transformOverride: transform,
					motionBlurState: motionBlurStateRef.current,
					// Content time, not wall-clock, so motion-blur velocity matches export and stays
					// correct under speed regions (frameRenderer passes the same content timeMs).
					frameTimeMs: timelineCurrentTimeRef.current,
				});

				state.x = appliedTransform.x;
				state.y = appliedTransform.y;
				state.appliedScale = appliedTransform.scale;

				// Scale the PiP webcam inversely with the (eased) zoom, anchored to the docked
				// corner (bottom-right by default) so it stays flush instead of drifting to center.
				const webcamWrapper = webcamWrapperRef.current;
				if (webcamWrapper) {
					const reactive =
						webcamReactiveZoomRef.current && webcamLayoutPresetRef.current === "picture-in-picture";
					const factor = reactive ? reactiveWebcamScale(state.appliedScale) : 1;
					if (factor < 1) {
						const pos = webcamPositionRef.current;
						const originX = (pos ? pos.cx >= 0.5 : true) ? "100%" : "0%";
						const originY = (pos ? pos.cy >= 0.5 : true) ? "100%" : "0%";
						webcamWrapper.style.transformOrigin = `${originX} ${originY}`;
						webcamWrapper.style.transform = `scale(${factor})`;
					} else {
						webcamWrapper.style.transform = "";
					}
				}
			};

			let lastMotionBlurActive: boolean | null = null;
			let lastTransformIsIdentity = true;
			let lastPerspectiveValue = 0;
			let frameStartedAtMs = performance.now();
			const ticker = () => {
				frameStartedAtMs = performance.now();
				const { region, strength, blendedScale, rotation3D, transition } = findDominantRegion(
					zoomRegionsRef.current,
					timelineCurrentTimeRef.current,
					{
						connectZooms: true,
						cursorTelemetry: cursorTelemetryRef.current,
						cursorFocusSampler:
							smartCursorEnabledRef.current && semanticNativeCursorPathRef.current
								? sampleSemanticCameraFocus
								: undefined,
						cursorFocusSamplerKey: semanticNativeCursorPathRef.current,
						cursorTimeMs: currentTimeRef.current,
					},
				);

				const defaultFocus = DEFAULT_FOCUS;
				let targetScaleFactor = 1;
				let targetFocus = defaultFocus;
				let targetProgress = 0;

				// If a zoom is selected but not playing, show the default unzoomed view.
				const selectedId = selectedZoomIdRef.current;
				const hasSelectedZoom = selectedId !== null;
				const shouldShowUnzoomedView =
					hasSelectedZoom && !isPlayingRef.current && !isPreviewingZoomRef.current;

				if (region && strength > 0 && !shouldShowUnzoomedView) {
					// Use getZoomScale (customScale-aware) to match export and the magnification
					// findDominantRegion resolved focus at. Falling back to the depth preset would
					// zoom/pan to a different level than export.
					const zoomScale = blendedScale ?? getZoomScale(region);
					const regionFocus = region.focus;

					targetScaleFactor = zoomScale;
					targetFocus = regionFocus;
					targetProgress = strength;

					// Adaptive smoothing for auto-follow mode.
					if (region.focusMode === "auto" && !transition) {
						const raw = targetFocus;
						const isZoomingIn =
							targetProgress < 0.999 && targetProgress >= prevTargetProgressRef.current;
						// Follow the cursor in content time (frame-rate independent) so the camera pans
						// at the same speed in preview and export. Snap to target when not actively
						// playing (paused/seek/scrub), matching the zoom spring's snap.
						const focusAnimating =
							isPlayingRef.current && !isSeekingRef.current && !isScrubbingRef.current;
						const focusDtMs =
							prevZoomTimeMsRef.current === null
								? 0
								: timelineCurrentTimeRef.current - prevZoomTimeMsRef.current;
						if (targetProgress >= 0.999) {
							// Full zoom: adaptive smoothing, faster when far, decelerating when close.
							const prev = smoothedAutoFocusRef.current ?? raw;
							const smoothed = focusAnimating
								? advanceFollowFocus(prev, raw, focusDtMs, AUTO_FOLLOW_PARAMS)
								: raw;
							smoothedAutoFocusRef.current = smoothed;
							targetFocus = smoothed;
						} else if (isZoomingIn) {
							// Zoom-in: track cursor directly so zoom always aims at the current position;
							// keep ref in sync to avoid a snap when full-zoom begins.
							smoothedAutoFocusRef.current = raw;
						} else {
							// Zoom-out: keep smoothing for continuity to avoid a snap at zoom-out start.
							const prev = smoothedAutoFocusRef.current ?? raw;
							const smoothed = focusAnimating
								? advanceFollowFocus(prev, raw, focusDtMs, AUTO_FOLLOW_PARAMS)
								: raw;
							smoothedAutoFocusRef.current = smoothed;
							targetFocus = smoothed;
						}
					} else if (region.focusMode !== "auto") {
						smoothedAutoFocusRef.current = null;
					}
					prevTargetProgressRef.current = targetProgress;

					// Connected zoom transitions: pan between adjacent regions.
					if (transition) {
						const startTransform = computeZoomTransform({
							stageSize: stageSizeRef.current,
							baseMask: baseMaskRef.current,
							zoomScale: transition.startScale,
							zoomProgress: 1,
							focusX: transition.startFocus.cx,
							focusY: transition.startFocus.cy,
						});
						const endTransform = computeZoomTransform({
							stageSize: stageSizeRef.current,
							baseMask: baseMaskRef.current,
							zoomScale: transition.endScale,
							zoomProgress: 1,
							focusX: transition.endFocus.cx,
							focusY: transition.endFocus.cy,
						});

						const interpolatedTransform = {
							scale:
								startTransform.scale +
								(endTransform.scale - startTransform.scale) * transition.progress,
							x: startTransform.x + (endTransform.x - startTransform.x) * transition.progress,
							y: startTransform.y + (endTransform.y - startTransform.y) * transition.progress,
						};

						targetScaleFactor = interpolatedTransform.scale;
						targetFocus = computeFocusFromTransform({
							stageSize: stageSizeRef.current,
							baseMask: baseMaskRef.current,
							zoomScale: interpolatedTransform.scale,
							x: interpolatedTransform.x,
							y: interpolatedTransform.y,
						});
						targetProgress = 1;
					}
				}

				const state = animationStateRef.current;
				const prevScale = state.appliedScale;
				const prevX = state.x;
				const prevY = state.y;

				state.scale = targetScaleFactor;
				state.focusX = targetFocus.cx;
				state.focusY = targetFocus.cy;
				state.progress = targetProgress;

				const projectedTransform = computeZoomTransform({
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: state.scale,
					zoomProgress: state.progress,
					focusX: state.focusX,
					focusY: state.focusY,
				});

				// Chase the eased target with a spring so the camera glides (no jerk at the steep
				// start of the ease, no snap at close-region seams). Step by content time while
				// playing; snap to the exact target when paused/seeking/scrubbing for crisp frames.
				const nowMs = timelineCurrentTimeRef.current;
				const prevMs = prevZoomTimeMsRef.current;
				const animating = isPlayingRef.current && !isSeekingRef.current && !isScrubbingRef.current;
				const dtMs = prevMs === null ? 0 : nowMs - prevMs;
				const synchronizedAutoZoomIn =
					region?.source === "auto" &&
					region.focusMode === "auto" &&
					Number.isFinite(region.zoomInDurationMs) &&
					nowMs >= region.startMs &&
					nowMs <= region.startMs + Math.max(1, region.zoomInDurationMs ?? 1);
				let appliedScale: number;
				let appliedX: number;
				let appliedY: number;
				if (!animating || synchronizedAutoZoomIn || prevMs === null || dtMs <= 0) {
					resetZoomSpring(zoomSpringRef.current, projectedTransform);
					appliedScale = projectedTransform.scale;
					appliedX = projectedTransform.x;
					appliedY = projectedTransform.y;
				} else {
					const sprung = stepZoomSpring(zoomSpringRef.current, projectedTransform, dtMs);
					appliedScale = sprung.scale;
					appliedX = sprung.x;
					appliedY = sprung.y;
				}
				prevZoomTimeMsRef.current = nowMs;

				const motionIntensity = Math.max(
					Math.abs(appliedScale - prevScale),
					Math.abs(appliedX - prevX) / Math.max(1, stageSizeRef.current.width),
					Math.abs(appliedY - prevY) / Math.max(1, stageSizeRef.current.height),
				);

				const motionVector = {
					x: appliedX - prevX,
					y: appliedY - prevY,
				};

				applyTransformFn(
					{ scale: appliedScale, x: appliedX, y: appliedY },
					targetFocus,
					motionIntensity,
					motionVector,
				);

				const isMotionBlurActive =
					(motionBlurAmountRef.current || 0) > 0 && isPlayingRef.current && !isScrubbingRef.current;

				if (isMotionBlurActive !== lastMotionBlurActive && videoContainerRef.current) {
					if (isMotionBlurActive) {
						if (blurFilterRef.current && motionBlurFilterRef.current) {
							videoContainerRef.current.filters = [
								blurFilterRef.current,
								motionBlurFilterRef.current,
							];
							lastMotionBlurActive = true;
						}
					} else {
						videoContainerRef.current.filters = null;
						lastMotionBlurActive = false;
					}
				}

				const cursorOverlay = cursorOverlayRef.current;
				if (cursorOverlay) {
					const timeMs = currentTimeRef.current; // already in ms
					cursorOverlay.update(
						cursorTelemetryRef.current,
						timeMs,
						baseMaskRef.current,
						showCursorRef.current && !hasNativeCursorRecordingRef.current,
						!isPlayingRef.current || isSeekingRef.current,
					);
				}

				// Keep the native cursor preview in the same transformed coordinate space as PIXI.
				const nativeCursorSprite = nativeCursorSpriteRef.current;
				const nativeCursorImage = nativeCursorImageRef.current;
				const hideNativeCursorPreview = () => {
					if (nativeCursorSprite) {
						nativeCursorSprite.visible = false;
					}
					if (nativeCursorImage) {
						nativeCursorImage.style.display = "none";
						nativeCursorImage.style.filter = "none";
					}
					if (nativeCursorClipRef.current) {
						nativeCursorClipRef.current.style.clipPath = "";
					}
					resetNativeCursorMotionBlurState(nativeCursorMotionBlurStateRef.current);
				};
				if (nativeCursorImage) {
					if (hasNativeCursorRecordingRef.current && showCursorRef.current) {
						const timeMs = currentTimeRef.current; // already in ms
						const frame = resolveInterpolatedNativeCursorFrame(
							cursorRecordingDataRef.current,
							timeMs,
						);
						if (frame) {
							// Position comes from the precomputed offline-smoothed path; the frame still
							// supplies the cursor image, type, and click timing.
							const smoothedPos = smoothedNativeCursorPathRef.current?.sampleAt(timeMs);
							const displaySample = smoothedPos
								? { ...frame.sample, cx: smoothedPos.cx, cy: smoothedPos.cy }
								: frame.sample;
							const cameraContainer = cameraContainerRef.current;
							const videoContainer = videoContainerRef.current;
							const cropRegionValue = cropRegionRef.current ?? { x: 0, y: 0, width: 1, height: 1 };
							const projectedLocalPoint = projectNativeCursorToLocal({
								cropRegion: cropRegionValue,
								maskRect: baseMaskRef.current,
								sample: displaySample,
							});
							const projectedStagePoint =
								cameraContainer && videoContainer
									? projectNativeCursorToStage({
											cameraContainer,
											cropRegion: cropRegionValue,
											maskRect: baseMaskRef.current,
											videoContainerPosition: {
												x: videoContainer.x,
												y: videoContainer.y,
											},
											sample: displaySample,
										})
									: null;
							if (projectedLocalPoint && projectedStagePoint) {
								// Pass deviceScaleFactor=1 since asset.scaleFactor already encodes DPR.
								// Size is normalized below so preview matches export proportionally.
								const renderAsset = resolveNativeCursorRenderAsset(
									frame.asset,
									1,
									displaySample,
									cursorThemeRef.current,
								);
								const bounceProgress = getNativeCursorClickBounceProgress(
									cursorRecordingDataRef.current,
									timeMs,
								);
								const scale =
									Math.max(0, cursorSizeRef.current) *
									getNativeCursorClickBounceScale(cursorClickBounceRef.current, bounceProgress);
								// Normalize cursor size to the displayed video width so the cursor
								// appears at the same fraction of the video in both preview and export.
								const crop = cropRegionRef.current ?? { x: 0, y: 0, width: 1, height: 1 };
								const croppedVideoWidth = (videoRef.current?.videoWidth ?? 0) * crop.width;
								const sizeNorm =
									croppedVideoWidth > 0 ? baseMaskRef.current.width / croppedVideoWidth : 1;
								const transformedScale = scale * Math.abs(cameraContainer?.scale.x || 1) * sizeNorm;
								const blurPx =
									!isPlayingRef.current || isSeekingRef.current
										? 0
										: getNativeCursorMotionBlurPx({
												motionBlur: cursorMotionBlurRef.current,
												point: projectedStagePoint,
												state: nativeCursorMotionBlurStateRef.current,
												timeMs,
											});
								if (nativeCursorImageIdRef.current !== renderAsset.id) {
									nativeCursorImage.src = renderAsset.imageDataUrl;
									nativeCursorImageIdRef.current = renderAsset.id;
								}
								nativeCursorImage.style.display = "block";
								// Clip to the camera-aware video boundary. Works here because nativeCursorClipRef
								// sits outside preserve-3d. When cursorClipToBounds is off, let the cursor overflow.
								if (nativeCursorClipRef.current) {
									if (!cursorClipToBoundsRef.current) {
										nativeCursorClipRef.current.style.clipPath = "none";
									} else {
										const mask = baseMaskRef.current;
										const stage = stageSizeRef.current;
										const br = borderRadiusRef.current;
										const s = cameraContainer ? Math.abs(cameraContainer.scale.x) : 1;
										const camX = cameraContainer ? cameraContainer.position.x : 0;
										const camY = cameraContainer ? cameraContainer.position.y : 0;
										const clipLeft = camX + s * mask.x;
										const clipTop = camY + s * mask.y;
										const clipRight = camX + s * (mask.x + mask.width);
										const clipBottom = camY + s * (mask.y + mask.height);
										nativeCursorClipRef.current.style.clipPath = `inset(${clipTop}px ${stage.width - clipRight}px ${stage.height - clipBottom}px ${clipLeft}px round ${br * s}px)`;
									}
								}
								nativeCursorImage.style.width = `${renderAsset.width * transformedScale}px`;
								nativeCursorImage.style.height = `${renderAsset.height * transformedScale}px`;
								nativeCursorImage.style.filter =
									blurPx > 0 ? `blur(${blurPx.toFixed(2)}px)` : "none";
								// translate3d is relative to nativeCursorClipRef (absolute inset-0 = stage origin).
								// projectedStagePoint.x is the stage-space cursor position, so no offset is needed.
								nativeCursorImage.style.transform = `translate3d(${
									projectedStagePoint.x - renderAsset.hotspotX * transformedScale
								}px, ${projectedStagePoint.y - renderAsset.hotspotY * transformedScale}px, 0)`;
								if (nativeCursorSprite) {
									nativeCursorSprite.visible = false;
									if (nativeCursorTextureIdRef.current !== renderAsset.id) {
										nativeCursorSprite.texture = Texture.from(renderAsset.imageDataUrl);
										nativeCursorTextureIdRef.current = renderAsset.id;
									}
									nativeCursorSprite.position.set(
										projectedLocalPoint.x - renderAsset.hotspotX * scale,
										projectedLocalPoint.y - renderAsset.hotspotY * scale,
									);
									nativeCursorSprite.width = renderAsset.width * scale;
									nativeCursorSprite.height = renderAsset.height * scale;
								}
							} else {
								hideNativeCursorPreview();
							}
						} else {
							hideNativeCursorPreview();
						}
					} else {
						hideNativeCursorPreview();
					}
				} else {
					hideNativeCursorPreview();
				}

				const composite3D = composite3DRef.current;
				const outerWrapper = outerWrapperRef.current;
				if (composite3D && outerWrapper) {
					const effectiveRotation =
						region && targetProgress > 0 && !shouldShowUnzoomedView
							? lerpRotation3D(DEFAULT_ROTATION_3D, rotation3D, targetProgress)
							: DEFAULT_ROTATION_3D;
					const isIdentity = isRotation3DIdentity(effectiveRotation);
					if (isIdentity) {
						if (!lastTransformIsIdentity) {
							composite3D.style.transform = "";
							composite3D.style.willChange = "auto";
							lastTransformIsIdentity = true;
						}
						if (nativeCursorClipRef.current) {
							nativeCursorClipRef.current.style.transform = "";
						}
						if (lastPerspectiveValue !== 0) {
							outerWrapper.style.perspective = "";
							lastPerspectiveValue = 0;
						}
					} else {
						const wrapperW = outerWrapper.clientWidth || 1;
						const wrapperH = outerWrapper.clientHeight || 1;
						const persp = rotation3DPerspective(wrapperW, wrapperH);
						const containScale = computeRotation3DContainScale(
							effectiveRotation,
							wrapperW,
							wrapperH,
							persp,
						);
						composite3D.style.transform = `scale(${containScale}) rotateX(${effectiveRotation.rotationX}deg) rotateY(${effectiveRotation.rotationY}deg) rotateZ(${effectiveRotation.rotationZ}deg)`;
						composite3D.style.willChange = "transform";
						if (nativeCursorClipRef.current) {
							nativeCursorClipRef.current.style.transform = composite3D.style.transform;
						}
						lastTransformIsIdentity = false;
						if (persp !== lastPerspectiveValue) {
							outerWrapper.style.perspective = `${persp}px`;
							lastPerspectiveValue = persp;
						}
					}
				}
			};
			const samplePreviewPerformance = () => {
				const currentState = previewResolutionControllerRef.current;
				if (!currentState.active) return;

				const nowMs = performance.now();
				const video = videoRef.current;
				const getPlaybackQuality = (
					video as
						| (HTMLVideoElement & {
								getVideoPlaybackQuality?: () => VideoPlaybackQuality;
						  })
						| null
				)?.getVideoPlaybackQuality;
				const playbackQuality =
					video && typeof getPlaybackQuality === "function"
						? getPlaybackQuality.call(video)
						: undefined;
				const nextState = samplePreviewResolutionPerformance(currentState, {
					nowMs,
					frameTimeMs: Math.max(0, nowMs - frameStartedAtMs),
					playbackQuality: playbackQuality
						? {
								droppedVideoFrames: playbackQuality.droppedVideoFrames,
								totalVideoFrames: playbackQuality.totalVideoFrames,
							}
						: undefined,
				});
				previewResolutionControllerRef.current = nextState;
				if (nextState.resolution !== currentState.resolution) {
					applyPreviewResolution(nextState.resolution);
				}
			};

			const renderStoppedFrame = () => {
				ticker();
				app.render();
			};
			renderPreviewFrameRef.current = renderStoppedFrame;
			app.ticker.add(ticker);
			// Pixi renders at LOW priority; sample at UTILITY so p95 includes scene update + render.
			app.ticker.add(samplePreviewPerformance, undefined, UPDATE_PRIORITY.UTILITY);
			if (isPlayingRef.current || isScrubbingRef.current) {
				app.start();
			} else {
				app.stop();
				renderStoppedFrame();
			}
			return () => {
				renderPreviewFrameRef.current = () => {
					// Ignore late media events after the Pixi scene is torn down.
				};
				if (app && app.ticker) {
					app.ticker.remove(ticker);
					app.ticker.remove(samplePreviewPerformance);
				}
			};
		}, [applyPreviewResolution, pixiReady, sampleSemanticCameraFocus, videoReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			const app = appRef.current;
			if (!app) return;
			if (isPlaying || isScrubbing) {
				app.start();
				return;
			}
			app.stop();
			renderPreviewFrameRef.current();
		}, [isPlaying, isScrubbing, pixiReady, videoReady]);

		const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
			const video = e.currentTarget;
			enableAllPreviewAudioTracks(video);
			const hasResolvedDuration = syncResolvedDuration(video);
			if (!hasResolvedDuration) {
				forceResolveDuration(video);
			} else {
				video.currentTime = 0;
			}
			video.pause();
			allowPlaybackRef.current = false;
			currentTimeRef.current = 0;
			timelineCurrentTimeRef.current = 0;
			lastTransportClockRef.current = { timelineMs: 0, sourceMs: 0, sourceActive: true };
			lastFollowerBoundaryKeyRef.current = null;

			if (videoReadyRafRef.current) {
				cancelAnimationFrame(videoReadyRafRef.current);
				videoReadyRafRef.current = null;
			}

			const waitForRenderableFrame = () => {
				const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
				const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
				if (!syncResolvedDuration(video)) {
					forceResolveDuration(video);
				}
				if (hasDimensions && hasData) {
					videoReadyRafRef.current = null;
					setVideoReady(true);
					return;
				}
				videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
			};

			videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
		};

		const resolvedWallpaper = useMemo<string | null>(() => {
			const source = wallpaper || DEFAULT_WALLPAPER;
			const classified = classifyWallpaper(source);
			if (classified.kind !== "image") return classified.value;
			try {
				return resolveImageWallpaperUrl(classified.path);
			} catch (err) {
				console.warn("[VideoPlayback] wallpaper resolve failed:", err);
				return null;
			}
		}, [wallpaper]);
		const webcamCssBoxShadow = useMemo(
			() => getWebcamLayoutCssBoxShadow(webcamLayoutPreset),
			[webcamLayoutPreset],
		);

		useEffect(() => {
			const webcamVideo = webcamVideoRef.current;
			if (!webcamVideo || !webcamVideoPath) {
				setWebcamDimensions(null);
				return;
			}

			const handleLoadedMetadata = () => {
				if (webcamVideo.videoWidth > 0 && webcamVideo.videoHeight > 0) {
					setWebcamDimensions({
						width: webcamVideo.videoWidth,
						height: webcamVideo.videoHeight,
					});
				}
			};

			webcamVideo.addEventListener("loadedmetadata", handleLoadedMetadata);
			handleLoadedMetadata();
			return () => {
				webcamVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
			};
		}, [webcamVideoPath]);

		useEffect(() => {
			const webcamVideo = webcamVideoRef.current;
			if (!webcamVideo || !webcamVideoPath) {
				return;
			}

			webcamVideo.pause();
			webcamVideo.currentTime = 0;
			syncFollowerMediaRef.current(true);
		}, [webcamVideoPath]);

		useEffect(() => {
			return () => {
				if (videoReadyRafRef.current) {
					cancelAnimationFrame(videoReadyRafRef.current);
					videoReadyRafRef.current = null;
				}
				if (scrubEndTimerRef.current !== null) {
					window.clearTimeout(scrubEndTimerRef.current);
					scrubEndTimerRef.current = null;
				}
				if (durationResolutionTimeoutRef.current) {
					clearTimeout(durationResolutionTimeoutRef.current);
					durationResolutionTimeoutRef.current = null;
				}
			};
		}, []);

		const isImageUrl = Boolean(
			resolvedWallpaper &&
				(resolvedWallpaper.startsWith("file://") ||
					resolvedWallpaper.startsWith("http") ||
					resolvedWallpaper.startsWith("/") ||
					resolvedWallpaper.startsWith("data:")),
		);
		const backgroundStyle = isImageUrl
			? { backgroundImage: `url(${resolvedWallpaper || ""})` }
			: { background: resolvedWallpaper || "" };

		return (
			<div
				ref={outerWrapperRef}
				className="relative rounded-sm overflow-hidden"
				style={{
					width: "100%",
					aspectRatio: formatAspectRatioForCSS(
						aspectRatio,
						aspectRatio === "native"
							? getNativeAspectRatioValue(
									lockedVideoDimensionsRef.current?.width || DEFAULT_SOURCE_DIMENSIONS.width,
									lockedVideoDimensionsRef.current?.height || DEFAULT_SOURCE_DIMENSIONS.height,
									cropRegion,
								)
							: undefined,
					),
				}}
			>
				{/* Background always renders as a DOM element so it can be blurred. */}
				<div
					className="absolute inset-0 bg-cover bg-center"
					style={{
						...backgroundStyle,
						filter: showBlur ? "blur(2px)" : "none",
					}}
				/>
				<div
					ref={composite3DRef}
					className="absolute inset-0"
					style={{
						transformStyle: "preserve-3d",
						transformOrigin: "center center",
					}}
				>
					<div
						ref={containerRef}
						className="absolute inset-0"
						style={{
							filter:
								showShadow && shadowIntensity > 0
									? `drop-shadow(0 ${shadowIntensity * 12}px ${shadowIntensity * 48}px rgba(0,0,0,${shadowIntensity * 0.7})) drop-shadow(0 ${shadowIntensity * 4}px ${shadowIntensity * 16}px rgba(0,0,0,${shadowIntensity * 0.5})) drop-shadow(0 ${shadowIntensity * 2}px ${shadowIntensity * 8}px rgba(0,0,0,${shadowIntensity * 0.3}))`
									: "none",
						}}
					/>
					{webcamVideoPath &&
						(() => {
							const clipPath = getCssClipPath(webcamLayout?.maskShape ?? "rectangle");
							const useClipPath = !!clipPath;
							return (
								<div
									ref={webcamWrapperRef}
									className="absolute"
									style={{
										left: webcamLayout?.x ?? 0,
										top: webcamLayout?.y ?? 0,
										width: webcamLayout?.width ?? 0,
										height: webcamLayout?.height ?? 0,
										zIndex: 20,
										opacity: webcamLayout ? 1 : 0,
										filter:
											useClipPath && webcamCssBoxShadow !== "none"
												? `drop-shadow(${webcamCssBoxShadow})`
												: undefined,
									}}
								>
									<video
										ref={webcamVideoRef}
										src={webcamVideoPath}
										className={`w-full h-full object-cover ${webcamLayoutPreset === "picture-in-picture" ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`}
										style={{
											borderRadius: useClipPath ? 0 : (webcamLayout?.borderRadius ?? 0),
											clipPath: clipPath ?? undefined,
											boxShadow: useClipPath ? "none" : webcamCssBoxShadow,
											backgroundColor: "#000",
											transform: webcamMirrored ? "scaleX(-1)" : undefined,
										}}
										onPointerDown={handleWebcamPointerDown}
										onPointerMove={handleWebcamPointerMove}
										onPointerUp={handleWebcamPointerUp}
										onPointerLeave={handleWebcamPointerUp}
										muted
										preload="metadata"
										playsInline
									/>
								</div>
							);
						})()}
					{/* Render the overlay only once PIXI and video are ready. */}
					{pixiReady && videoReady && (
						<div
							ref={setOverlayRefs}
							className="absolute inset-0 select-none"
							style={{ pointerEvents: "auto", zIndex: 30 }}
							onPointerDown={handleOverlayPointerDown}
							onPointerMove={handleOverlayPointerMove}
							onPointerUp={handleOverlayPointerUp}
							onPointerLeave={handleOverlayPointerLeave}
						>
							<div
								ref={focusIndicatorRef}
								className="absolute rounded-md border border-[#34B27B]/80 bg-[#34B27B]/20 shadow-[0_0_0_1px_rgba(52,178,123,0.35)]"
								style={{ display: "none", pointerEvents: "none" }}
							/>
							{(() => {
								const filteredAnnotations = (annotationRegions || []).filter((annotation) => {
									if (
										typeof annotation.startMs !== "number" ||
										typeof annotation.endMs !== "number"
									)
										return false;

									if (annotation.id === selectedAnnotationId) return true;

									const timeMs = Math.round(currentTime * 1000);
									return timeMs >= annotation.startMs && timeMs < annotation.endMs;
								});

								const filteredBlurRegions = (blurRegions || []).filter((blurRegion) => {
									if (
										typeof blurRegion.startMs !== "number" ||
										typeof blurRegion.endMs !== "number"
									)
										return false;

									if (blurRegion.id === selectedBlurId) return true;

									const timeMs = Math.round(currentTime * 1000);
									return timeMs >= blurRegion.startMs && timeMs < blurRegion.endMs;
								});

								const sorted = [
									...filteredAnnotations.map((annotation) => ({
										kind: "annotation" as const,
										region: annotation,
									})),
									...filteredBlurRegions.map((blurRegion) => ({
										kind: "blur" as const,
										region: blurRegion,
									})),
								].sort((a, b) => a.region.zIndex - b.region.zIndex);
								let previewSnapshotCanvas = blurPreviewSnapshotRef.current;
								if (filteredBlurRegions.length > 0) {
									const nowMs = performance.now();
									const snapshotTimeMs = Math.round(timelineCurrentTimeRef.current);
									const shouldRefresh = isPlayingRef.current
										? nowMs - lastBlurSnapshotAtRef.current >= 200
										: snapshotTimeMs !== lastBlurSnapshotTimeMsRef.current;
									if (shouldRefresh || !blurPreviewSnapshotRef.current) {
										const app = appRef.current;
										if (app?.renderer?.extract) {
											try {
												blurPreviewSnapshotRef.current = app.renderer.extract.canvas(app.stage);
												lastBlurSnapshotAtRef.current = nowMs;
												lastBlurSnapshotTimeMsRef.current = snapshotTimeMs;
											} catch {
												blurPreviewSnapshotRef.current = null;
											}
										}
									}
									previewSnapshotCanvas = blurPreviewSnapshotRef.current;
								}

								// Re-clicking a selected annotation cycles through any overlapping ones.
								const handleAnnotationClick = (clickedId: string) => {
									if (!onSelectAnnotation) return;

									if (clickedId === selectedAnnotationId && filteredAnnotations.length > 1) {
										const currentIndex = filteredAnnotations.findIndex((a) => a.id === clickedId);
										const nextIndex = (currentIndex + 1) % filteredAnnotations.length;
										onSelectAnnotation(filteredAnnotations[nextIndex].id);
									} else {
										onSelectAnnotation(clickedId);
									}
								};

								const handleBlurClick = (clickedId: string) => {
									if (!onSelectBlur) return;

									if (clickedId === selectedBlurId && filteredBlurRegions.length > 1) {
										const currentIndex = filteredBlurRegions.findIndex((a) => a.id === clickedId);
										const nextIndex = (currentIndex + 1) % filteredBlurRegions.length;
										onSelectBlur(filteredBlurRegions[nextIndex].id);
									} else {
										onSelectBlur(clickedId);
									}
								};

								return sorted.map((item) => (
									<AnnotationOverlay
										key={
											item.kind === "blur"
												? `${item.region.id}-${overlaySize.width}-${overlaySize.height}-${item.region.blurData?.type ?? "blur"}-${item.region.blurData?.shape ?? "rectangle"}-${item.region.blurData?.color ?? "white"}-${Math.round(item.region.blurData?.blockSize ?? 0)}-${Math.round(item.region.blurData?.intensity ?? 0)}-${(item.region.blurData?.freehandPoints ?? []).map((p) => `${Math.round(p.x)}_${Math.round(p.y)}`).join("-")}`
												: `${item.region.id}-${overlaySize.width}-${overlaySize.height}`
										}
										annotation={item.region}
										isSelected={
											item.kind === "blur"
												? item.region.id === selectedBlurId
												: item.region.id === selectedAnnotationId
										}
										containerWidth={overlaySize.width}
										containerHeight={overlaySize.height}
										onPositionChange={(id, position) =>
											item.kind === "blur"
												? onBlurPositionChange?.(id, position)
												: onAnnotationPositionChange?.(id, position)
										}
										onSizeChange={(id, size) =>
											item.kind === "blur"
												? onBlurSizeChange?.(id, size)
												: onAnnotationSizeChange?.(id, size)
										}
										onBlurDataChange={
											item.kind === "blur"
												? (id, blurData) => onBlurDataChange?.(id, blurData)
												: undefined
										}
										onBlurDataCommit={item.kind === "blur" ? onBlurDataCommit : undefined}
										onClick={item.kind === "blur" ? handleBlurClick : handleAnnotationClick}
										zIndex={item.region.zIndex}
										isSelectedBoost={
											item.kind === "blur"
												? item.region.id === selectedBlurId
												: item.region.id === selectedAnnotationId
										}
										previewSourceCanvas={previewSnapshotCanvas}
										previewFrameVersion={Math.round(currentTime * 1000)}
										currentTimeMs={Math.round(currentTime * 1000)}
									/>
								));
							})()}
						</div>
					)}
				</div>
				{/* Native cursor clip. Lives outside composite3DRef (preserve-3d) so clip-path
				    keeps working during 3D zoom rotations; bounds are set dynamically. */}
				<div
					ref={nativeCursorClipRef}
					className="absolute inset-0"
					style={{ zIndex: 18, pointerEvents: "none" }}
				>
					<img
						ref={nativeCursorImageRef}
						alt=""
						aria-hidden="true"
						className="absolute left-0 top-0 select-none"
						style={{
							display: "none",
							pointerEvents: "none",
							transformOrigin: "0 0",
						}}
					/>
				</div>
				<video
					ref={videoRef}
					src={videoPath}
					className="hidden"
					preload="auto"
					playsInline
					onLoadedMetadata={handleLoadedMetadata}
					onDurationChange={(e) => {
						enableAllPreviewAudioTracks(e.currentTarget);
						if (!syncResolvedDuration(e.currentTarget)) {
							forceResolveDuration(e.currentTarget);
						}
					}}
					onLoadedData={(e) => {
						enableAllPreviewAudioTracks(e.currentTarget);
						if (!syncResolvedDuration(e.currentTarget)) {
							forceResolveDuration(e.currentTarget);
						}
					}}
					onCanPlay={(e) => {
						enableAllPreviewAudioTracks(e.currentTarget);
						if (!syncResolvedDuration(e.currentTarget)) {
							forceResolveDuration(e.currentTarget);
						}
					}}
					onError={() => onError("Failed to load video")}
				/>
				{supplementalAudioPath && (
					<audio
						ref={supplementalAudioRef}
						src={supplementalAudioPath}
						preload="auto"
						muted={audioTrackClips.length > 0}
					/>
				)}
				{preparedAudioTracks.map(({ trackOrdinal, path }) => (
					<audio
						key={trackOrdinal}
						ref={getPreviewAudioTrackRef(trackOrdinal)}
						src={path}
						preload="auto"
						onLoadedData={() => markPreviewAudioTrackReady(trackOrdinal)}
						onCanPlay={() => markPreviewAudioTrackReady(trackOrdinal)}
						onError={() => markPreviewAudioTrackFailed(trackOrdinal)}
					/>
				))}
			</div>
		);
	},
);

VideoPlayback.displayName = "VideoPlayback";

export default VideoPlayback;
