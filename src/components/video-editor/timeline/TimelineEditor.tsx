import type { Range, Span } from "dnd-timeline";
import { useTimelineContext } from "dnd-timeline";
import {
	Captions,
	Check,
	ChevronDown,
	Gauge,
	LoaderCircle,
	MessageSquare,
	MousePointer2,
	Plus,
	ScanEye,
	Scissors,
	WandSparkles,
	ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { useAudioPeaks } from "@/hooks/useAudioPeaks";
import { matchesShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { ASPECT_RATIOS, type AspectRatio, getAspectRatioLabel } from "@/utils/aspectRatioUtils";
import { BLUR_REGIONS_ENABLED } from "../featureFlags";
import { toFileUrl } from "../projectPersistence";
import {
	type AnnotationRegion,
	type AudioTrackClip,
	isFileBackedAudioClip,
	type SpeedRegion,
	type TrimRegion,
	type VideoTrackClip,
	type ZoomRegion,
} from "../types";
import AutoCaptionTrack from "./AutoCaptionTrack";
import BackgroundWaveform from "./BackgroundWaveform";
import { type CutGuideState, snapCutTime } from "./cutGuide";
import Item from "./Item";
import KeyframeMarkers from "./KeyframeMarkers";
import Row from "./Row";
import TimelineWrapper from "./TimelineWrapper";
import { groupAudioTrackClips, isAudioMixItemId, MIN_CUT_DURATION_MS } from "./timelineCommands";

const ZOOM_ROW_ID = "row-zoom";
const TRIM_ROW_ID = "row-trim";
const ANNOTATION_ROW_ID = "row-annotation";
const BLUR_ROW_ID = "row-blur";
const SPEED_ROW_ID = "row-speed";
const VIDEO_ROW_ID = "row-video";
const AUDIO_ROW_ID = "row-audio";
const FALLBACK_RANGE_MS = 1000;
const TARGET_MARKER_COUNT = 12;

interface TimelineEditorProps {
	videoDuration: number;
	hasVideoSource?: boolean;
	currentTime: number;
	onSeek?: (time: number) => void;
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	/** Magic-wand auto-zoom toggle state + handler. */
	autoZoomEnabled?: boolean;
	autoZoomAnalysisProgress?: { completed: number; total: number } | null;
	onToggleAutoZoom?: (enabled: boolean) => void;
	/** Global Auto-Focus toggle state + handler. */
	autoFocusAll?: boolean;
	onToggleAutoFocusAll?: (on: boolean) => void;
	onZoomSpanChange: (id: string, span: Span) => void;
	onZoomDelete: (id: string) => void;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	videoTrackClips?: VideoTrackClip[];
	onVideoTrackSpanChange?: (id: string, span: Span) => void;
	onVideoTrackDelete?: (id: string) => void;
	selectedVideoTrackId?: string | null;
	onSelectVideoTrack?: (id: string | null) => void;
	trimRegions?: TrimRegion[];
	onTrimAdded?: (span: Span) => void;
	onTrimSpanChange?: (id: string, span: Span) => void;
	onTrimDelete?: (id: string) => void;
	selectedTrimId?: string | null;
	onSelectTrim?: (id: string | null) => void;
	annotationRegions?: AnnotationRegion[];
	onAnnotationAdded?: (span: Span) => void;
	onAnnotationSpanChange?: (id: string, span: Span) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	blurRegions?: AnnotationRegion[];
	onBlurAdded?: (span: Span) => void;
	onBlurSpanChange?: (id: string, span: Span) => void;
	onBlurDelete?: (id: string) => void;
	selectedBlurId?: string | null;
	onSelectBlur?: (id: string | null) => void;
	speedRegions?: SpeedRegion[];
	onSpeedAdded?: (span: Span) => void;
	onSpeedSpanChange?: (id: string, span: Span) => void;
	onSpeedDelete?: (id: string) => void;
	selectedSpeedId?: string | null;
	onSelectSpeed?: (id: string | null) => void;
	audioTrackClips?: AudioTrackClip[];
	onAudioTrackSpanChange?: (id: string, span: Span) => void;
	onAudioTrackDelete?: (id: string) => void;
	selectedAudioTrackId?: string | null;
	onSelectAudioTrack?: (id: string | null) => void;
	aspectRatio: AspectRatio;
	onAspectRatioChange: (aspectRatio: AspectRatio) => void;
	videoUrl?: string;
	showTrimWaveform?: boolean;
	/** Opens the auto-captions flow. When omitted, the captions button is hidden. */
	onGenerateCaptions?: () => void;
	isGeneratingCaptions?: boolean;
	/** Localized label for the auto-captions button (lives in the `editor` namespace). */
	captionsLabel?: string;
	onCutItem?: (id: string, cutMs: number) => void;
	onRippleDeleteItem?: (id: string) => void;
	onCopyItem?: (id: string) => void;
	onPasteItems?: (atMs: number) => void;
	onDuplicateItem?: (id: string) => void;
	onCutItems?: (ids: string[], cutMs: number) => void;
	onDeleteItems?: (ids: string[], ripple: boolean) => void;
	onCopyItems?: (ids: string[]) => void;
	onDuplicateItems?: (ids: string[]) => void;
	onBatchItemSpanChange?: (changes: Array<{ id: string; span: Span }>) => void;
	videoFrameRate?: number;
	lockedTrackKinds?: string[];
}

interface TimelineScaleConfig {
	minItemDurationMs: number;
	defaultItemDurationMs: number;
	minVisibleRangeMs: number;
}

interface TimelineRenderItem {
	id: string;
	rowId: string;
	span: Span;
	label: string;
	zoomDepth?: number;
	zoomCustomScale?: number;
	speedValue?: number;
	isAutoFocus?: boolean;
	variant:
		| "video"
		| "zoom"
		| "trim"
		| "annotation"
		| "speed"
		| "blur"
		| "mixed-audio"
		| "system-audio"
		| "microphone-audio";
}

const SCALE_CANDIDATES = [
	{ intervalSeconds: 0.05, gridSeconds: 0.01 },
	{ intervalSeconds: 0.1, gridSeconds: 0.02 },
	{ intervalSeconds: 0.25, gridSeconds: 0.05 },
	{ intervalSeconds: 0.5, gridSeconds: 0.1 },
	{ intervalSeconds: 1, gridSeconds: 0.25 },
	{ intervalSeconds: 2, gridSeconds: 0.5 },
	{ intervalSeconds: 5, gridSeconds: 1 },
	{ intervalSeconds: 10, gridSeconds: 2 },
	{ intervalSeconds: 15, gridSeconds: 3 },
	{ intervalSeconds: 30, gridSeconds: 5 },
	{ intervalSeconds: 60, gridSeconds: 10 },
	{ intervalSeconds: 120, gridSeconds: 20 },
	{ intervalSeconds: 300, gridSeconds: 30 },
	{ intervalSeconds: 600, gridSeconds: 60 },
	{ intervalSeconds: 900, gridSeconds: 120 },
	{ intervalSeconds: 1800, gridSeconds: 180 },
	{ intervalSeconds: 3600, gridSeconds: 300 },
];

/**
 * Picks the best axis interval for the currently visible time range, so marker
 * density stays meaningful regardless of video length.
 */
function calculateAxisScale(visibleRangeMs: number): { intervalMs: number; gridMs: number } {
	const visibleSeconds = visibleRangeMs / 1000;
	const candidate =
		SCALE_CANDIDATES.find((c) => {
			if (visibleSeconds <= 0) return true;
			return visibleSeconds / c.intervalSeconds <= TARGET_MARKER_COUNT;
		}) ?? SCALE_CANDIDATES[SCALE_CANDIDATES.length - 1];
	return {
		intervalMs: Math.round(candidate.intervalSeconds * 1000),
		gridMs: Math.round(candidate.gridSeconds * 1000),
	};
}

function calculateTimelineScale(durationSeconds: number): TimelineScaleConfig {
	const totalMs = Math.max(0, Math.round(durationSeconds * 1000));

	// 100ms, precise enough to cut but still grabbable.
	const minItemDurationMs = 100;

	// 5% of duration, clamped to 1-30s.
	const defaultItemDurationMs =
		totalMs > 0
			? Math.max(minItemDurationMs, Math.min(Math.round(totalMs * 0.05), 30000))
			: Math.max(minItemDurationMs, 1000);

	// 300ms, enough to view 0.1s items comfortably. Axis markers adapt via
	// calculateAxisScale, so there's no cap on zoom-in.
	const minVisibleRangeMs = 300;

	return {
		minItemDurationMs,
		defaultItemDurationMs,
		minVisibleRangeMs,
	};
}

function createInitialRange(totalMs: number): Range {
	if (totalMs > 0) {
		return { start: 0, end: totalMs };
	}

	return { start: 0, end: FALLBACK_RANGE_MS };
}

function clampVisibleRange(candidate: Range, totalMs: number): Range {
	if (totalMs <= 0) {
		return candidate;
	}

	const span = Math.max(candidate.end - candidate.start, 1);

	if (span >= totalMs) {
		return { start: 0, end: totalMs };
	}

	const start = Math.max(0, Math.min(candidate.start, totalMs - span));
	return { start, end: start + span };
}

function formatTimeLabel(milliseconds: number, intervalMs: number) {
	const totalSeconds = milliseconds / 1000;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		const minutesString = minutes.toString().padStart(2, "0");
		const secondsString = Math.floor(seconds).toString().padStart(2, "0");
		return `${hours}:${minutesString}:${secondsString}`;
	}

	if (minutes > 0) {
		return `${minutes}:${Math.floor(seconds).toString().padStart(2, "0")}`;
	}

	// Under a minute: plain seconds ("3s"), with decimals only when the axis is
	// zoomed to sub-second intervals ("1.5s", "1.75s").
	const fractionalDigits = intervalMs < 250 ? 2 : intervalMs < 1000 ? 1 : 0;
	if (fractionalDigits > 0) {
		return `${Number(seconds.toFixed(fractionalDigits))}s`;
	}
	return `${Math.floor(seconds)}s`;
}

function formatPlayheadTime(ms: number): string {
	const s = ms / 1000;
	const min = Math.floor(s / 60);
	const sec = s % 60;
	if (min > 0) return `${min}:${sec.toFixed(1).padStart(4, "0")}`;
	return `${sec.toFixed(1)}s`;
}

function formatCutTime(ms: number): string {
	const totalMs = Math.max(0, Math.round(ms));
	const minutes = Math.floor(totalMs / 60_000);
	const seconds = Math.floor((totalMs % 60_000) / 1000);
	const milliseconds = totalMs % 1000;
	return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function trackKindForRow(rowId: string): string | null {
	if (rowId === VIDEO_ROW_ID) return "video";
	if (rowId === AUDIO_ROW_ID) return "audio";
	if (rowId === ZOOM_ROW_ID) return "zoom";
	if (rowId === ANNOTATION_ROW_ID) return "annotation";
	if (rowId === BLUR_ROW_ID) return "blur";
	if (rowId === SPEED_ROW_ID) return "speed";
	return null;
}

function shouldStartTimelineScrub(target: EventTarget | null, timelineElement: HTMLElement) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	for (let element: HTMLElement | null = target; element && element !== timelineElement; ) {
		const className = element.className;
		const classText = typeof className === "string" ? className : "";

		if (
			classText.split(/\s+/).includes("group") ||
			classText.includes("cursor-grab") ||
			classText.includes("cursor-grabbing") ||
			classText.includes("cursor-ew-resize") ||
			element.style.cursor === "col-resize"
		) {
			return false;
		}

		element = element.parentElement;
	}

	return true;
}

function PlaybackCursor({
	currentTimeMs,
	videoDurationMs,
	onSeek,
	onRangeChange,
	timelineRef,
	keyframes = [],
}: {
	currentTimeMs: number;
	videoDurationMs: number;
	onSeek?: (time: number) => void;
	onRangeChange?: (updater: (previous: Range) => Range) => void;
	timelineRef: React.RefObject<HTMLDivElement>;
	keyframes?: { id: string; time: number }[];
}) {
	const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";
	const [isDragging, setIsDragging] = useState(false);
	const [dragPreviewTimeMs, setDragPreviewTimeMs] = useState<number | null>(null);

	useEffect(() => {
		if (!isDragging) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!timelineRef.current || !onSeek) return;

			const rect = timelineRef.current.getBoundingClientRect();
			const clickX = e.clientX - rect.left - sidebarWidth;
			const contentWidth = Math.max(rect.width - sidebarWidth, 1);

			// Allow dragging past the edges, but clamp the value
			const relativeMs = pixelsToValue(clickX);
			let absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

			// Snap to a keyframe within 150ms
			const snapThresholdMs = 150;
			const nearbyKeyframe = keyframes.find(
				(kf) =>
					Math.abs(kf.time - absoluteMs) <= snapThresholdMs &&
					kf.time >= range.start &&
					kf.time <= range.end,
			);

			if (nearbyKeyframe) {
				absoluteMs = nearbyKeyframe.time;
			}

			setDragPreviewTimeMs(absoluteMs);

			const visibleMs = range.end - range.start;
			if (onRangeChange && visibleMs > 0 && videoDurationMs > visibleMs) {
				const msPerPixel = visibleMs / contentWidth;
				const overflowLeftPx = Math.max(0, -clickX);
				const overflowRightPx = Math.max(0, clickX - contentWidth);

				if (overflowLeftPx > 0 && range.start > 0) {
					const shiftMs = overflowLeftPx * msPerPixel;
					onRangeChange((previous) => {
						const nextRange = clampVisibleRange(
							{
								start: previous.start - shiftMs,
								end: previous.end - shiftMs,
							},
							videoDurationMs,
						);
						return nextRange.start === previous.start && nextRange.end === previous.end
							? previous
							: nextRange;
					});
				} else if (overflowRightPx > 0 && range.end < videoDurationMs) {
					const shiftMs = overflowRightPx * msPerPixel;
					onRangeChange((previous) => {
						const nextRange = clampVisibleRange(
							{
								start: previous.start + shiftMs,
								end: previous.end + shiftMs,
							},
							videoDurationMs,
						);
						return nextRange.start === previous.start && nextRange.end === previous.end
							? previous
							: nextRange;
					});
				}
			}

			onSeek(absoluteMs / 1000);
		};

		const handleMouseUp = () => {
			setIsDragging(false);
			setDragPreviewTimeMs(null);
			document.body.style.cursor = "";
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		document.body.style.cursor = "ew-resize";

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "";
		};
	}, [
		isDragging,
		onSeek,
		onRangeChange,
		timelineRef,
		sidebarWidth,
		range.start,
		range.end,
		videoDurationMs,
		pixelsToValue,
		keyframes,
	]);

	const displayTimeMs =
		isDragging && dragPreviewTimeMs !== null ? dragPreviewTimeMs : currentTimeMs;

	if (videoDurationMs <= 0 || displayTimeMs < 0) {
		return null;
	}

	const clampedTime = Math.min(displayTimeMs, videoDurationMs);

	if (clampedTime < range.start || clampedTime > range.end) {
		return null;
	}

	const offset = valueToPixels(clampedTime - range.start);

	return (
		<div
			className="absolute top-0 bottom-0 z-50 group/cursor"
			style={{
				[sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth - 1}px`,
				pointerEvents: "none", // pass clicks through to the timeline; the handle re-enables them
			}}
		>
			<div
				className="absolute top-0 bottom-0 w-[2px] bg-[#6C55FF] shadow-[0_0_18px_rgba(108,85,255,0.68)] cursor-ew-resize pointer-events-auto hover:shadow-[0_0_24px_rgba(108,85,255,0.85)] transition-shadow"
				style={{
					[sideProperty]: `${offset}px`,
				}}
				onMouseDown={(e) => {
					e.stopPropagation(); // Prevent timeline click
					setDragPreviewTimeMs(currentTimeMs);
					setIsDragging(true);
				}}
			>
				<div
					className="absolute -top-2 left-1/2 -translate-x-1/2 hover:scale-110 transition-transform"
					style={{ width: "20px", height: "20px" }}
				>
					<div className="w-4 h-4 mx-auto mt-[2px] bg-[#6C55FF] rotate-45 rounded-[5px] shadow-lg shadow-[#6C55FF]/30 border border-white/30" />
				</div>
				{isDragging && (
					<div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] text-white/90 font-medium tabular-nums whitespace-nowrap border border-white/10 shadow-lg pointer-events-none">
						{formatPlayheadTime(clampedTime)}
					</div>
				)}
			</div>
		</div>
	);
}

function TimelineAxis({
	videoDurationMs,
	currentTimeMs,
}: {
	videoDurationMs: number;
	currentTimeMs: number;
}) {
	const { sidebarWidth, direction, range, valueToPixels } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";

	const { intervalMs } = useMemo(
		() => calculateAxisScale(range.end - range.start),
		[range.end, range.start],
	);

	const markers = useMemo(() => {
		if (intervalMs <= 0) {
			return { markers: [], minorTicks: [] };
		}

		const maxTime = videoDurationMs > 0 ? videoDurationMs : range.end;
		const visibleStart = Math.max(0, Math.min(range.start, maxTime));
		const visibleEnd = Math.min(range.end, maxTime);
		const markerTimes = new Set<number>();

		const firstMarker = Math.ceil(visibleStart / intervalMs) * intervalMs;

		for (let time = firstMarker; time <= maxTime; time += intervalMs) {
			if (time >= visibleStart && time <= visibleEnd) {
				markerTimes.add(Math.round(time));
			}
		}

		const sorted = Array.from(markerTimes)
			.filter((time) => time <= maxTime)
			.sort((a, b) => a - b);

		// 4 minor ticks between major intervals
		const minorTicks = [];
		const minorInterval = intervalMs / 5;

		for (let time = firstMarker; time <= maxTime; time += minorInterval) {
			if (time >= visibleStart && time <= visibleEnd) {
				const isMajor = Math.abs(time % intervalMs) < 1;
				if (!isMajor) {
					minorTicks.push(time);
				}
			}
		}

		return {
			markers: sorted.map((time) => ({
				time,
				label: formatTimeLabel(time, intervalMs),
			})),
			minorTicks,
		};
	}, [intervalMs, range.end, range.start, videoDurationMs]);

	return (
		<div
			className="h-9 bg-[#0c0d10] border-b border-white/[0.07] relative overflow-hidden select-none"
			style={{
				[sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth}px`,
			}}
		>
			{/* Minor Ticks */}
			{markers.minorTicks.map((time) => {
				const offset = valueToPixels(time - range.start);
				return (
					<div
						key={`minor-${time}`}
						className="absolute bottom-0 h-1.5 w-[1px] bg-white/[0.07]"
						style={{ [sideProperty]: `${offset}px` }}
					/>
				);
			})}

			{/* Major Markers */}
			{markers.markers.map((marker) => {
				const offset = valueToPixels(marker.time - range.start);
				const markerStyle: React.CSSProperties = {
					position: "absolute",
					bottom: 0,
					height: "100%",
					display: "flex",
					flexDirection: "row",
					alignItems: "flex-end",
					[sideProperty]: `${offset}px`,
				};

				return (
					<div key={marker.time} style={markerStyle}>
						<div className="flex flex-col items-center pb-1">
							<div className="h-2.5 w-[1px] bg-white/25 mb-1" />
							<span
								className={cn(
									"text-[10px] font-medium tabular-nums tracking-tight",
									marker.time === currentTimeMs ? "text-[#34B27B]" : "text-slate-400",
								)}
							>
								{marker.label}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function Timeline({
	items,
	videoDurationMs,
	currentTimeMs,
	onSeek,
	onRangeChange,
	onSelectZoom,
	onSelectVideoTrack,
	onSelectTrim,
	onSelectAnnotation,
	onSelectBlur,
	onSelectSpeed,
	onSelectAudioTrack,
	selectedItemIds,
	onSelectItem,
	onBoxSelect,
	onClearSelection,
	toolMode,
	onCutItem,
	videoFrameRate,
	lockedTrackKinds,
	keyframes = [],
	videoUrl,
	voiceoverAudioUrl,
	showTrimWaveform = false,
	autoCaptionRegions = [],
	selectedAnnotationId,
	captionTrackLabel,
}: {
	items: TimelineRenderItem[];
	videoDurationMs: number;
	currentTimeMs: number;
	onSeek?: (time: number) => void;
	onRangeChange?: (updater: (previous: Range) => Range) => void;
	onSelectZoom?: (id: string | null) => void;
	onSelectVideoTrack?: (id: string | null) => void;
	onSelectTrim?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectBlur?: (id: string | null) => void;
	onSelectSpeed?: (id: string | null) => void;
	onSelectAudioTrack?: (id: string | null) => void;
	selectedItemIds: Set<string>;
	onSelectItem: (item: TimelineRenderItem, event: React.PointerEvent<HTMLDivElement>) => void;
	onBoxSelect: (ids: string[]) => void;
	onClearSelection: () => void;
	toolMode: "select" | "cut";
	onCutItem?: (id: string, cutMs: number) => void;
	videoFrameRate: number;
	lockedTrackKinds: string[];
	keyframes?: { id: string; time: number }[];
	videoUrl?: string;
	voiceoverAudioUrl?: string;
	showTrimWaveform?: boolean;
	autoCaptionRegions?: AnnotationRegion[];
	selectedAnnotationId?: string | null;
	captionTrackLabel?: string;
}) {
	const t = useScopedT("timeline");
	const { setTimelineRef, style, sidebarWidth, range, pixelsToValue, valueToPixels } =
		useTimelineContext();
	const localTimelineRef = useRef<HTMLDivElement | null>(null);
	const isScrubbingTimelineRef = useRef(false);
	const scrubPointerIdRef = useRef<number | null>(null);
	const boxPointerIdRef = useRef<number | null>(null);
	const [boxSelection, setBoxSelection] = useState<{
		startX: number;
		startY: number;
		currentX: number;
		currentY: number;
	} | null>(null);
	const [cutGuide, setCutGuide] = useState<CutGuideState | null>(null);
	const peaks = useAudioPeaks(showTrimWaveform ? videoUrl : undefined);
	const firstAudioTrackPeaks = useAudioPeaks(showTrimWaveform ? videoUrl : undefined, 0);
	const secondAudioTrackPeaks = useAudioPeaks(showTrimWaveform ? videoUrl : undefined, 1);
	const voiceoverPeaks = useAudioPeaks(showTrimWaveform ? voiceoverAudioUrl : undefined);
	const mixedAudioPeaks = useMemo(() => {
		const trackPeaks = [firstAudioTrackPeaks, secondAudioTrackPeaks, voiceoverPeaks].filter(
			(entry): entry is Float32Array => entry !== null,
		);
		if (trackPeaks.length === 0) return peaks;
		if (trackPeaks.length === 1) return trackPeaks[0];
		const length = Math.min(...trackPeaks.map((entry) => entry.length));
		const mixed = new Float32Array(length);
		for (let index = 0; index + 1 < length; index += 2) {
			mixed[index] = Math.min(...trackPeaks.map((entry) => entry[index]));
			mixed[index + 1] = Math.max(...trackPeaks.map((entry) => entry[index + 1]));
		}
		return mixed;
	}, [firstAudioTrackPeaks, peaks, secondAudioTrackPeaks, voiceoverPeaks]);

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			setTimelineRef(node);
			localTimelineRef.current = node;
		},
		[setTimelineRef],
	);

	const seekTimelineAtClientX = useCallback(
		(timelineElement: HTMLDivElement, clientX: number) => {
			if (!onSeek || videoDurationMs <= 0) return false;

			const rect = timelineElement.getBoundingClientRect();
			const clickX = clientX - rect.left - sidebarWidth;

			if (clickX < 0) return false;

			const relativeMs = pixelsToValue(clickX);
			const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

			onSeek(absoluteMs / 1000);
			return true;
		},
		[onSeek, videoDurationMs, sidebarWidth, pixelsToValue, range.start],
	);

	const clearTimelineSelection = useCallback(() => {
		onClearSelection();
		onSelectZoom?.(null);
		onSelectVideoTrack?.(null);
		onSelectTrim?.(null);
		onSelectAnnotation?.(null);
		onSelectBlur?.(null);
		onSelectSpeed?.(null);
		onSelectAudioTrack?.(null);
	}, [
		onClearSelection,
		onSelectZoom,
		onSelectVideoTrack,
		onSelectTrim,
		onSelectAnnotation,
		onSelectBlur,
		onSelectSpeed,
		onSelectAudioTrack,
	]);

	const handleTimelineClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (toolMode === "cut") return;
			// Items stop propagation, so this only fires on empty space
			clearTimelineSelection();
			seekTimelineAtClientX(e.currentTarget, e.clientX);
		},
		[clearTimelineSelection, seekTimelineAtClientX, toolMode],
	);

	const resolveCutGuide = useCallback(
		(root: HTMLDivElement, eventTarget: EventTarget | null, clientX: number, altKey: boolean) => {
			const rect = root.getBoundingClientRect();
			const contentX = clientX - rect.left - sidebarWidth;
			if (contentX < 0) return null;
			const rawTimeMs = Math.max(
				0,
				Math.min(range.start + pixelsToValue(contentX), videoDurationMs),
			);
			const frameDurationMs = 1000 / Math.max(1, Math.min(240, videoFrameRate));
			const snappedTimeMs = snapCutTime({
				rawTimeMs,
				durationMs: videoDurationMs,
				frameRate: videoFrameRate,
				magneticTargets: [
					currentTimeMs,
					...keyframes.map((keyframe) => keyframe.time),
					...items.flatMap((item) => [item.span.start, item.span.end]),
				],
				magneticThresholdMs: Math.max(frameDurationMs, Math.abs(pixelsToValue(6))),
				disableMagnet: altKey,
			});
			const targetElement =
				eventTarget instanceof Element
					? eventTarget.closest<HTMLElement>("[data-timeline-item-id]")
					: null;
			const targetId = targetElement?.dataset.timelineItemId ?? null;
			const targetItem = targetId ? items.find((item) => item.id === targetId) : undefined;
			const targetKind = targetItem ? trackKindForRow(targetItem.rowId) : null;
			const mediaLinkLocked =
				targetKind === "video" || targetKind === "audio"
					? lockedTrackKinds.includes("video") || lockedTrackKinds.includes("audio")
					: false;
			const trackLocked = Boolean(targetKind && lockedTrackKinds.includes(targetKind));
			const valid = Boolean(
				targetItem &&
					!trackLocked &&
					!mediaLinkLocked &&
					snappedTimeMs - targetItem.span.start >= MIN_CUT_DURATION_MS &&
					targetItem.span.end - snappedTimeMs >= MIN_CUT_DURATION_MS,
			);
			return {
				targetId,
				rawTimeMs,
				snappedTimeMs,
				offsetPx: sidebarWidth + valueToPixels(snappedTimeMs - range.start),
				valid,
			} satisfies CutGuideState;
		},
		[
			currentTimeMs,
			items,
			keyframes,
			lockedTrackKinds,
			pixelsToValue,
			range.start,
			sidebarWidth,
			valueToPixels,
			videoDurationMs,
			videoFrameRate,
		],
	);

	const handleCutPointerDownCapture = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (toolMode !== "cut" || !onCutItem || !event.isPrimary || event.button !== 0) return;
			const guide = resolveCutGuide(event.currentTarget, event.target, event.clientX, event.altKey);
			setCutGuide(guide);
			event.preventDefault();
			event.stopPropagation();
			if (guide?.valid && guide.targetId) {
				onCutItem(guide.targetId, guide.snappedTimeMs);
			}
		},
		[onCutItem, resolveCutGuide, toolMode],
	);

	const handleTimelinePointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) {
				return;
			}
			const clickedItem =
				e.target instanceof Element
					? e.target.closest<HTMLElement>("[data-timeline-item-id]")
					: null;
			if (toolMode === "select" && e.shiftKey && !clickedItem) {
				const rect = e.currentTarget.getBoundingClientRect();
				const x = e.clientX - rect.left;
				const y = e.clientY - rect.top;
				boxPointerIdRef.current = e.pointerId;
				setBoxSelection({ startX: x, startY: y, currentX: x, currentY: y });
				e.currentTarget.setPointerCapture(e.pointerId);
				e.preventDefault();
				return;
			}

			if (!shouldStartTimelineScrub(e.target, e.currentTarget)) {
				return;
			}

			if (!seekTimelineAtClientX(e.currentTarget, e.clientX)) {
				return;
			}

			clearTimelineSelection();
			isScrubbingTimelineRef.current = true;
			scrubPointerIdRef.current = e.pointerId;
			e.currentTarget.setPointerCapture(e.pointerId);
			e.preventDefault();
		},
		[clearTimelineSelection, seekTimelineAtClientX, toolMode],
	);

	const handleTimelinePointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (toolMode === "cut") {
				setCutGuide(resolveCutGuide(e.currentTarget, e.target, e.clientX, e.altKey));
				return;
			}
			if (boxPointerIdRef.current === e.pointerId) {
				const rect = e.currentTarget.getBoundingClientRect();
				setBoxSelection((current) =>
					current
						? { ...current, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top }
						: null,
				);
				e.preventDefault();
				return;
			}
			if (!isScrubbingTimelineRef.current || scrubPointerIdRef.current !== e.pointerId) {
				return;
			}

			seekTimelineAtClientX(e.currentTarget, e.clientX);
			e.preventDefault();
		},
		[resolveCutGuide, seekTimelineAtClientX, toolMode],
	);

	const stopTimelineScrub = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (boxPointerIdRef.current === e.pointerId && boxSelection) {
				const rootRect = e.currentTarget.getBoundingClientRect();
				const left = rootRect.left + Math.min(boxSelection.startX, boxSelection.currentX);
				const right = rootRect.left + Math.max(boxSelection.startX, boxSelection.currentX);
				const top = rootRect.top + Math.min(boxSelection.startY, boxSelection.currentY);
				const bottom = rootRect.top + Math.max(boxSelection.startY, boxSelection.currentY);
				const ids = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-timeline-item-id]")]
					.filter((element) => {
						const rect = element.getBoundingClientRect();
						return (
							rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom
						);
					})
					.map((element) => element.dataset.timelineItemId)
					.filter((id): id is string => Boolean(id));
				onBoxSelect(ids);
				boxPointerIdRef.current = null;
				setBoxSelection(null);
				if (e.currentTarget.hasPointerCapture(e.pointerId)) {
					e.currentTarget.releasePointerCapture(e.pointerId);
				}
				return;
			}
			if (!isScrubbingTimelineRef.current || scrubPointerIdRef.current !== e.pointerId) {
				return;
			}

			isScrubbingTimelineRef.current = false;
			scrubPointerIdRef.current = null;
			if (e.currentTarget.hasPointerCapture(e.pointerId)) {
				e.currentTarget.releasePointerCapture(e.pointerId);
			}
		},
		[boxSelection, onBoxSelect],
	);

	const handleTimelinePointerLeave = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (toolMode === "cut") {
				setCutGuide(null);
				return;
			}
			if (isScrubbingTimelineRef.current && scrubPointerIdRef.current === e.pointerId) {
				seekTimelineAtClientX(e.currentTarget, e.clientX);
			}
		},
		[seekTimelineAtClientX, toolMode],
	);

	useEffect(() => {
		if (toolMode !== "cut") setCutGuide(null);
	}, [toolMode]);

	const handleTimelineLostPointerCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		if (boxPointerIdRef.current === e.pointerId) {
			boxPointerIdRef.current = null;
			setBoxSelection(null);
		}
		if (scrubPointerIdRef.current === e.pointerId) {
			isScrubbingTimelineRef.current = false;
			scrubPointerIdRef.current = null;
		}
	}, []);

	const zoomItems = items.filter((item) => item.rowId === ZOOM_ROW_ID);
	const videoItems = items.filter((item) => item.rowId === VIDEO_ROW_ID);
	const trimItems = items.filter((item) => item.rowId === TRIM_ROW_ID);
	const annotationItems = items.filter((item) => item.rowId === ANNOTATION_ROW_ID);
	const blurItems = items.filter((item) => item.rowId === BLUR_ROW_ID);
	const speedItems = items.filter((item) => item.rowId === SPEED_ROW_ID);
	const audioItems = items.filter((item) => item.rowId === AUDIO_ROW_ID);

	return (
		<div
			ref={setRefs}
			style={{ ...style, touchAction: "none" }}
			className={cn(
				"select-none bg-[#0b0c0f] min-h-[190px] relative group",
				toolMode === "cut" ? "cursor-crosshair" : "cursor-pointer",
			)}
			onClick={handleTimelineClick}
			onPointerDownCapture={handleCutPointerDownCapture}
			onPointerDown={handleTimelinePointerDown}
			onPointerMove={handleTimelinePointerMove}
			onPointerUp={stopTimelineScrub}
			onPointerCancel={stopTimelineScrub}
			onPointerLeave={handleTimelinePointerLeave}
			onLostPointerCapture={handleTimelineLostPointerCapture}
		>
			<div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px)] bg-[length:24px_100%] pointer-events-none" />
			{toolMode === "cut" && cutGuide && (
				<div
					className="pointer-events-none absolute inset-y-0 z-[70]"
					style={{ left: cutGuide.offsetPx }}
				>
					<div
						className={cn(
							"absolute inset-y-0 left-0 w-px",
							cutGuide.valid
								? "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.75)]"
								: "bg-red-400/35",
						)}
					/>
					<div
						className={cn(
							"absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums shadow-lg",
							cutGuide.valid
								? "border-red-400/40 bg-red-500/90 text-white"
								: "border-white/10 bg-black/85 text-slate-500",
						)}
					>
						{formatCutTime(cutGuide.snappedTimeMs)}
					</div>
					<Scissors
						className={cn(
							"absolute -left-2 top-8 h-4 w-4",
							cutGuide.valid ? "text-red-300" : "text-slate-600",
						)}
					/>
				</div>
			)}
			{boxSelection && (
				<div
					className="pointer-events-none absolute z-[60] border border-[#34B27B] bg-[#34B27B]/10"
					style={{
						left: Math.min(boxSelection.startX, boxSelection.currentX),
						top: Math.min(boxSelection.startY, boxSelection.currentY),
						width: Math.abs(boxSelection.currentX - boxSelection.startX),
						height: Math.abs(boxSelection.currentY - boxSelection.startY),
					}}
				/>
			)}
			<TimelineAxis videoDurationMs={videoDurationMs} currentTimeMs={currentTimeMs} />
			<PlaybackCursor
				currentTimeMs={currentTimeMs}
				videoDurationMs={videoDurationMs}
				onSeek={onSeek}
				onRangeChange={onRangeChange}
				timelineRef={localTimelineRef}
				keyframes={keyframes}
			/>

			<Row id={VIDEO_ROW_ID} isEmpty={videoItems.length === 0} hint="Screen video">
				{videoItems.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={selectedItemIds.has(item.id)}
						isCutTarget={cutGuide?.targetId === item.id}
						onSelect={(event) => onSelectItem(item, event)}
						variant="video"
					>
						{item.label}
					</Item>
				))}
			</Row>

			<Row id={ZOOM_ROW_ID} isEmpty={zoomItems.length === 0} hint={t("hints.pressZoom")}>
				{zoomItems.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={selectedItemIds.has(item.id)}
						isCutTarget={cutGuide?.targetId === item.id}
						onSelect={(event) => onSelectItem(item, event)}
						zoomDepth={item.zoomDepth}
						zoomCustomScale={item.zoomCustomScale}
						isAutoFocus={item.isAutoFocus}
						variant="zoom"
					>
						{item.label}
					</Item>
				))}
			</Row>

			{false && (
				<Row
					id={TRIM_ROW_ID}
					isEmpty={trimItems.length === 0}
					hint={t("hints.pressTrim")}
					background={
						showTrimWaveform ? (
							<BackgroundWaveform
								peaks={peaks}
								videoDurationMs={videoDurationMs}
								topInset={3}
								bottomInset={3}
							/>
						) : undefined
					}
				>
					{trimItems.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={selectedItemIds.has(item.id)}
							isCutTarget={cutGuide?.targetId === item.id}
							onSelect={(event) => onSelectItem(item, event)}
							variant="trim"
						>
							{item.label}
						</Item>
					))}
				</Row>
			)}

			<Row
				id={ANNOTATION_ROW_ID}
				isEmpty={annotationItems.length === 0 && autoCaptionRegions.length === 0}
				hint={t("hints.pressAnnotation")}
			>
				{autoCaptionRegions.length > 0 && (
					<AutoCaptionTrack
						rowId={ANNOTATION_ROW_ID}
						regions={autoCaptionRegions}
						selectedId={selectedAnnotationId}
						onSelect={() => onSelectAnnotation?.(autoCaptionRegions[0]?.id ?? null)}
						label={captionTrackLabel}
					/>
				)}
				{annotationItems.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={selectedItemIds.has(item.id)}
						isCutTarget={cutGuide?.targetId === item.id}
						onSelect={(event) => onSelectItem(item, event)}
						variant="annotation"
					>
						{item.label}
					</Item>
				))}
			</Row>

			{BLUR_REGIONS_ENABLED && (
				<Row id={BLUR_ROW_ID} isEmpty={blurItems.length === 0} hint={t("hints.pressBlur")}>
					{blurItems.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={selectedItemIds.has(item.id)}
							isCutTarget={cutGuide?.targetId === item.id}
							onSelect={(event) => onSelectItem(item, event)}
							variant={item.variant}
						>
							{item.label}
						</Item>
					))}
				</Row>
			)}

			<Row id={SPEED_ROW_ID} isEmpty={speedItems.length === 0} hint={t("hints.pressSpeed")}>
				{speedItems.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={selectedItemIds.has(item.id)}
						isCutTarget={cutGuide?.targetId === item.id}
						onSelect={(event) => onSelectItem(item, event)}
						variant="speed"
						speedValue={item.speedValue}
					>
						{item.label}
					</Item>
				))}
			</Row>

			<Row
				id={AUDIO_ROW_ID}
				isEmpty={audioItems.length === 0}
				hint="Audio"
				background={
					showTrimWaveform ? (
						<BackgroundWaveform
							peaks={mixedAudioPeaks}
							videoDurationMs={videoDurationMs}
							topInset={3}
							bottomInset={3}
						/>
					) : undefined
				}
			>
				{audioItems.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={selectedItemIds.has(item.id)}
						isCutTarget={cutGuide?.targetId === item.id}
						onSelect={(event) => onSelectItem(item, event)}
						variant="mixed-audio"
					>
						{item.label}
					</Item>
				))}
			</Row>
		</div>
	);
}

export default function TimelineEditor({
	videoDuration,
	hasVideoSource = false,
	currentTime,
	onSeek,
	zoomRegions,
	videoTrackClips = [],
	onVideoTrackSpanChange,
	onVideoTrackDelete,
	selectedVideoTrackId,
	onSelectVideoTrack,
	onZoomAdded,
	autoZoomEnabled = true,
	autoZoomAnalysisProgress,
	onToggleAutoZoom,
	autoFocusAll = false,
	onToggleAutoFocusAll,
	onZoomSpanChange,
	onZoomDelete,
	selectedZoomId,
	onSelectZoom,
	trimRegions = [],
	onTrimAdded,
	onTrimSpanChange,
	onTrimDelete,
	selectedTrimId,
	onSelectTrim,
	annotationRegions = [],
	onAnnotationAdded,
	onAnnotationSpanChange,
	onAnnotationDelete,
	selectedAnnotationId,
	onSelectAnnotation,
	blurRegions = [],
	onBlurAdded,
	onBlurSpanChange,
	onBlurDelete,
	selectedBlurId,
	onSelectBlur,
	speedRegions = [],
	onSpeedAdded,
	onSpeedSpanChange,
	onSpeedDelete,
	selectedSpeedId,
	onSelectSpeed,
	audioTrackClips = [],
	onAudioTrackSpanChange,
	onAudioTrackDelete,
	selectedAudioTrackId,
	onSelectAudioTrack,
	aspectRatio,
	onAspectRatioChange,
	videoUrl,
	showTrimWaveform = false,
	onGenerateCaptions,
	isGeneratingCaptions = false,
	captionsLabel,
	onCutItem,
	onRippleDeleteItem,
	onCopyItem,
	onPasteItems,
	onDuplicateItem,
	onCutItems,
	onDeleteItems,
	onCopyItems,
	onDuplicateItems,
	onBatchItemSpanChange,
	videoFrameRate = 60,
	lockedTrackKinds = [],
}: TimelineEditorProps) {
	const t = useScopedT("timeline");
	const totalMs = useMemo(() => Math.max(0, Math.round(videoDuration * 1000)), [videoDuration]);
	const currentTimeMs = useMemo(() => Math.round(currentTime * 1000), [currentTime]);
	const timelineScale = useMemo(() => calculateTimelineScale(videoDuration), [videoDuration]);
	const safeMinDurationMs = useMemo(
		() =>
			totalMs > 0
				? Math.min(timelineScale.minItemDurationMs, totalMs)
				: timelineScale.minItemDurationMs,
		[timelineScale.minItemDurationMs, totalMs],
	);

	const [range, setRange] = useState<Range>(() => createInitialRange(totalMs));
	const [keyframes, setKeyframes] = useState<{ id: string; time: number }[]>([]);
	const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
	const [toolMode, setToolMode] = useState<"select" | "cut">("select");
	const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
	const selectionAnchorIdRef = useRef<string | null>(null);
	const timelineContainerRef = useRef<HTMLDivElement>(null);
	const { shortcuts: keyShortcuts, isMac } = useShortcuts();

	const addKeyframe = useCallback(() => {
		if (totalMs === 0) return;
		const time = Math.max(0, Math.min(currentTimeMs, totalMs));
		if (keyframes.some((kf) => Math.abs(kf.time - time) < 1)) return;
		setKeyframes((prev) => [...prev, { id: uuidv4(), time }]);
	}, [currentTimeMs, totalMs, keyframes]);

	const deleteSelectedKeyframe = useCallback(() => {
		if (!selectedKeyframeId) return;
		setKeyframes((prev) => prev.filter((kf) => kf.id !== selectedKeyframeId));
		setSelectedKeyframeId(null);
	}, [selectedKeyframeId]);

	const handleKeyframeMove = useCallback(
		(id: string, newTime: number) => {
			setKeyframes((prev) =>
				prev.map((kf) =>
					kf.id === id ? { ...kf, time: Math.max(0, Math.min(newTime, totalMs)) } : kf,
				),
			);
		},
		[totalMs],
	);

	const deleteSelectedZoom = useCallback(() => {
		if (!selectedZoomId) return;
		onZoomDelete(selectedZoomId);
		onSelectZoom(null);
	}, [selectedZoomId, onZoomDelete, onSelectZoom]);

	const deleteSelectedVideoTrack = useCallback(() => {
		if (!selectedVideoTrackId || !onVideoTrackDelete || !onSelectVideoTrack) return;
		onVideoTrackDelete(selectedVideoTrackId);
		onSelectVideoTrack(null);
	}, [selectedVideoTrackId, onVideoTrackDelete, onSelectVideoTrack]);

	const deleteSelectedTrim = useCallback(() => {
		if (!selectedTrimId || !onTrimDelete || !onSelectTrim) return;
		onTrimDelete(selectedTrimId);
		onSelectTrim(null);
	}, [selectedTrimId, onTrimDelete, onSelectTrim]);

	const deleteSelectedAnnotation = useCallback(() => {
		if (!selectedAnnotationId || !onAnnotationDelete || !onSelectAnnotation) return;
		onAnnotationDelete(selectedAnnotationId);
		onSelectAnnotation(null);
	}, [selectedAnnotationId, onAnnotationDelete, onSelectAnnotation]);

	const deleteSelectedBlur = useCallback(() => {
		if (!selectedBlurId || !onBlurDelete || !onSelectBlur) return;
		onBlurDelete(selectedBlurId);
		onSelectBlur(null);
	}, [selectedBlurId, onBlurDelete, onSelectBlur]);

	const deleteSelectedSpeed = useCallback(() => {
		if (!selectedSpeedId || !onSpeedDelete || !onSelectSpeed) return;
		onSpeedDelete(selectedSpeedId);
		onSelectSpeed(null);
	}, [selectedSpeedId, onSpeedDelete, onSelectSpeed]);

	const deleteSelectedAudioTrack = useCallback(() => {
		if (!selectedAudioTrackId || !onAudioTrackDelete || !onSelectAudioTrack) return;
		onAudioTrackDelete(selectedAudioTrackId);
		onSelectAudioTrack(null);
	}, [selectedAudioTrackId, onAudioTrackDelete, onSelectAudioTrack]);

	useEffect(() => {
		setRange(createInitialRange(totalMs));
	}, [totalMs]);

	// Normalize regions only when timeline bounds change. Reading via refs avoids a
	// dependency loop that would re-fire on every drag and race dnd-timeline's state.
	const zoomRegionsRef = useRef(zoomRegions);
	const trimRegionsRef = useRef(trimRegions);
	const speedRegionsRef = useRef(speedRegions);
	zoomRegionsRef.current = zoomRegions;
	trimRegionsRef.current = trimRegions;
	speedRegionsRef.current = speedRegions;

	useEffect(() => {
		if (totalMs === 0 || safeMinDurationMs <= 0) {
			return;
		}

		zoomRegionsRef.current.forEach((region) => {
			const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
			const minEnd = clampedStart + safeMinDurationMs;
			const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
			const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
			const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

			if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
				onZoomSpanChange(region.id, { start: normalizedStart, end: normalizedEnd });
			}
		});

		trimRegionsRef.current.forEach((region) => {
			const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
			const minEnd = clampedStart + safeMinDurationMs;
			const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
			const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
			const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

			if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
				onTrimSpanChange?.(region.id, { start: normalizedStart, end: normalizedEnd });
			}
		});

		speedRegionsRef.current.forEach((region) => {
			const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
			const minEnd = clampedStart + safeMinDurationMs;
			const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
			const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
			const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

			if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
				onSpeedSpanChange?.(region.id, { start: normalizedStart, end: normalizedEnd });
			}
		});
	}, [totalMs, safeMinDurationMs, onZoomSpanChange, onTrimSpanChange, onSpeedSpanChange]);

	const hasOverlap = useCallback(
		(newSpan: Span, excludeId?: string): boolean => {
			const isZoomItem = zoomRegions.some((r) => r.id === excludeId);
			const isTrimItem = trimRegions.some((r) => r.id === excludeId);
			const isAnnotationItem = annotationRegions.some((r) => r.id === excludeId);
			const isBlurItem = blurRegions.some((r) => r.id === excludeId);
			const isSpeedItem = speedRegions.some((r) => r.id === excludeId);
			const isVideoItem = videoTrackClips.some((clip) => clip.id === excludeId);
			const audioGroups = groupAudioTrackClips(audioTrackClips);
			const isAudioItem = Boolean(excludeId && isAudioMixItemId(excludeId));

			if (isAnnotationItem || isBlurItem) {
				return false;
			}

			const checkOverlap = (regions: (ZoomRegion | TrimRegion | SpeedRegion)[]) => {
				return regions.some((region) => {
					if (region.id === excludeId) return false;
					// True intersection, adjacency is allowed
					return newSpan.end > region.startMs && newSpan.start < region.endMs;
				});
			};

			if (isZoomItem) {
				return checkOverlap(zoomRegions);
			}

			if (isTrimItem) {
				return checkOverlap(trimRegions);
			}

			if (isSpeedItem) {
				return checkOverlap(speedRegions);
			}
			if (isVideoItem) {
				return videoTrackClips.some(
					(clip) =>
						clip.id !== excludeId && newSpan.end > clip.startMs && newSpan.start < clip.endMs,
				);
			}
			if (isAudioItem) {
				return audioGroups.some(
					(group) =>
						group.id !== excludeId && newSpan.end > group.startMs && newSpan.start < group.endMs,
				);
			}

			return false;
		},
		[
			zoomRegions,
			trimRegions,
			annotationRegions,
			blurRegions,
			speedRegions,
			videoTrackClips,
			audioTrackClips,
		],
	);

	// 5% of the timeline or 1000ms, whichever is larger, so it's wide enough to grab.
	const defaultRegionDurationMs = useMemo(
		() => Math.max(1000, Math.round(totalMs * 0.05)),
		[totalMs],
	);

	const handleAddZoom = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
		const sorted = [...zoomRegions].sort((a, b) => a.startMs - b.startMs);
		const nextRegion = sorted.find((region) => region.startMs > startPos);
		const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;

		const isOverlapping = sorted.some(
			(region) => startPos >= region.startMs && startPos < region.endMs,
		);
		if (isOverlapping || gapToNext <= 0) {
			toast.error(t("errors.cannotPlaceZoom"), {
				description: t("errors.zoomExistsAtLocation"),
			});
			return;
		}

		const actualDuration = Math.min(defaultRegionDurationMs, gapToNext);
		onZoomAdded({ start: startPos, end: startPos + actualDuration });
	}, [videoDuration, totalMs, currentTimeMs, zoomRegions, onZoomAdded, defaultRegionDurationMs, t]);

	const handleAddTrim = useCallback(() => {
		// Trim is retained only for loading legacy projects. New edits use media clips.
		void onTrimAdded;
	}, [onTrimAdded]);

	const handleAddSpeed = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onSpeedAdded) {
			return;
		}

		const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
		const sorted = [...speedRegions].sort((a, b) => a.startMs - b.startMs);
		const nextRegion = sorted.find((region) => region.startMs > startPos);
		const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;

		const isOverlapping = sorted.some(
			(region) => startPos >= region.startMs && startPos < region.endMs,
		);
		if (isOverlapping || gapToNext <= 0) {
			toast.error(t("errors.cannotPlaceSpeed"), {
				description: t("errors.speedExistsAtLocation"),
			});
			return;
		}

		const actualDuration = Math.min(defaultRegionDurationMs, gapToNext);
		onSpeedAdded({ start: startPos, end: startPos + actualDuration });
	}, [
		videoDuration,
		totalMs,
		currentTimeMs,
		speedRegions,
		onSpeedAdded,
		defaultRegionDurationMs,
		t,
	]);

	const handleAddAnnotation = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onAnnotationAdded) {
			return;
		}

		const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		// Multiple annotations can exist at the same timestamp
		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
		const endPos = Math.min(startPos + defaultDuration, totalMs);

		onAnnotationAdded({ start: startPos, end: endPos });
	}, [videoDuration, totalMs, currentTimeMs, onAnnotationAdded, defaultRegionDurationMs]);

	const handleAddBlur = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onBlurAdded) {
			return;
		}

		const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
		const endPos = Math.min(startPos + defaultDuration, totalMs);
		onBlurAdded({ start: startPos, end: endPos });
	}, [videoDuration, totalMs, currentTimeMs, onBlurAdded, defaultRegionDurationMs]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
				return;
			}
			if (e.key === "Escape" && toolMode === "cut") {
				e.preventDefault();
				setToolMode("select");
				return;
			}
			const primaryModifier = isMac ? e.metaKey : e.ctrlKey;
			if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "c") {
				e.preventDefault();
				setToolMode("cut");
				return;
			}
			if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "v") {
				e.preventDefault();
				setToolMode("select");
				return;
			}
			if (primaryModifier && e.key.toLowerCase() === "b" && onCutItem) {
				const selectedIds = [...selectedItemIds];
				if (selectedIds.length > 0) {
					e.preventDefault();
					if (onCutItems) onCutItems(selectedIds, currentTimeMs);
					else onCutItem(selectedIds[0], currentTimeMs);
				}
				return;
			}
			const selectedTimelineIds = [...selectedItemIds];
			const selectedTimelineId = selectedTimelineIds[0];
			if (primaryModifier && e.key.toLowerCase() === "c" && selectedTimelineId) {
				e.preventDefault();
				if (onCopyItems) onCopyItems(selectedTimelineIds);
				else onCopyItem?.(selectedTimelineId);
				return;
			}
			if (primaryModifier && e.key.toLowerCase() === "v" && onPasteItems) {
				e.preventDefault();
				onPasteItems(currentTimeMs);
				return;
			}
			if (primaryModifier && e.key.toLowerCase() === "d" && selectedTimelineId) {
				e.preventDefault();
				if (onDuplicateItems) onDuplicateItems(selectedTimelineIds);
				else onDuplicateItem?.(selectedTimelineId);
				return;
			}
			if ((e.key === "Delete" || e.key === "Backspace") && e.shiftKey && onRippleDeleteItem) {
				const selectedIds = [...selectedItemIds];
				if (selectedIds.length > 0) {
					e.preventDefault();
					if (onDeleteItems) onDeleteItems(selectedIds, true);
					else onRippleDeleteItem(selectedIds[0]);
				}
				return;
			}

			if (matchesShortcut(e, keyShortcuts.addKeyframe, isMac)) {
				addKeyframe();
			}
			if (matchesShortcut(e, keyShortcuts.addZoom, isMac)) {
				handleAddZoom();
			}
			if (matchesShortcut(e, keyShortcuts.addTrim, isMac)) {
				handleAddTrim();
			}
			if (matchesShortcut(e, keyShortcuts.addAnnotation, isMac)) {
				handleAddAnnotation();
			}
			if (BLUR_REGIONS_ENABLED && matchesShortcut(e, keyShortcuts.addBlur, isMac)) {
				handleAddBlur();
			}
			if (matchesShortcut(e, keyShortcuts.addSpeed, isMac)) {
				handleAddSpeed();
			}

			// Tab cycles through overlapping annotations at the current time
			if (e.key === "Tab" && annotationRegions.length > 0) {
				const currentTimeMs = Math.round(currentTime * 1000);
				const overlapping = annotationRegions
					.filter((a) => currentTimeMs >= a.startMs && currentTimeMs <= a.endMs)
					.sort((a, b) => a.zIndex - b.zIndex);

				if (overlapping.length > 0) {
					e.preventDefault();

					if (!selectedAnnotationId || !overlapping.some((a) => a.id === selectedAnnotationId)) {
						onSelectAnnotation?.(overlapping[0].id);
					} else {
						const currentIndex = overlapping.findIndex((a) => a.id === selectedAnnotationId);
						const nextIndex = e.shiftKey
							? (currentIndex - 1 + overlapping.length) % overlapping.length // Shift+Tab steps backward
							: (currentIndex + 1) % overlapping.length;
						onSelectAnnotation?.(overlapping[nextIndex].id);
					}
				}
			}
			// Delete key or Ctrl+D / Cmd+D
			if (
				e.key === "Delete" ||
				e.key === "Backspace" ||
				matchesShortcut(e, keyShortcuts.deleteSelected, isMac)
			) {
				if (selectedItemIds.size > 0 && onDeleteItems) {
					e.preventDefault();
					onDeleteItems([...selectedItemIds], false);
					setSelectedItemIds(new Set());
				} else if (selectedKeyframeId) {
					deleteSelectedKeyframe();
				} else if (selectedZoomId) {
					deleteSelectedZoom();
				} else if (selectedVideoTrackId) {
					deleteSelectedVideoTrack();
				} else if (selectedTrimId) {
					deleteSelectedTrim();
				} else if (selectedAnnotationId) {
					deleteSelectedAnnotation();
				} else if (selectedBlurId) {
					deleteSelectedBlur();
				} else if (selectedSpeedId) {
					deleteSelectedSpeed();
				} else if (selectedAudioTrackId) {
					deleteSelectedAudioTrack();
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		addKeyframe,
		handleAddZoom,
		handleAddTrim,
		handleAddAnnotation,
		handleAddBlur,
		handleAddSpeed,
		deleteSelectedKeyframe,
		deleteSelectedZoom,
		deleteSelectedVideoTrack,
		selectedVideoTrackId,
		deleteSelectedTrim,
		deleteSelectedAnnotation,
		deleteSelectedBlur,
		deleteSelectedSpeed,
		selectedKeyframeId,
		selectedZoomId,
		selectedTrimId,
		selectedAnnotationId,
		selectedBlurId,
		selectedSpeedId,
		selectedAudioTrackId,
		deleteSelectedAudioTrack,
		annotationRegions,
		currentTime,
		onSelectAnnotation,
		onCutItem,
		onRippleDeleteItem,
		onCopyItem,
		onPasteItems,
		onDuplicateItem,
		onCutItems,
		onDeleteItems,
		onCopyItems,
		onDuplicateItems,
		selectedItemIds,
		currentTimeMs,
		keyShortcuts,
		isMac,
		toolMode,
	]);

	const clampedRange = useMemo<Range>(() => {
		if (totalMs === 0) {
			return range;
		}

		return {
			start: Math.max(0, Math.min(range.start, totalMs)),
			end: Math.min(range.end, totalMs),
		};
	}, [range, totalMs]);

	const timelineItems = useMemo<TimelineRenderItem[]>(() => {
		const zooms: TimelineRenderItem[] = zoomRegions.map((region, index) => ({
			id: region.id,
			rowId: ZOOM_ROW_ID,
			span: { start: region.startMs, end: region.endMs },
			label: t("labels.zoomItem", { index: String(index + 1) }),
			zoomDepth: region.depth,
			zoomCustomScale: region.customScale,
			isAutoFocus: region.focusMode === "auto",
			variant: "zoom",
		}));

		const videos: TimelineRenderItem[] = videoTrackClips.map((clip, index) => ({
			id: clip.id,
			rowId: VIDEO_ROW_ID,
			span: { start: clip.startMs, end: clip.endMs },
			label: `Screen video ${index + 1}`,
			variant: "video",
		}));

		const trims: TimelineRenderItem[] = trimRegions.map((region, index) => ({
			id: region.id,
			rowId: TRIM_ROW_ID,
			span: { start: region.startMs, end: region.endMs },
			label: t("labels.trimItem", { index: String(index + 1) }),
			variant: "trim",
		}));

		const annotations: TimelineRenderItem[] = annotationRegions
			.filter((region) => region.annotationSource !== "auto-caption")
			.map((region) => {
				let label: string;

				if (region.type === "text") {
					const preview = region.content.trim() || t("labels.emptyText");
					label = preview.length > 20 ? `${preview.substring(0, 20)}...` : preview;
				} else if (region.type === "image") {
					label = t("labels.imageItem");
				} else {
					label = t("labels.annotationItem");
				}

				return {
					id: region.id,
					rowId: ANNOTATION_ROW_ID,
					span: { start: region.startMs, end: region.endMs },
					label,
					variant: "annotation",
				};
			});

		const blurs: TimelineRenderItem[] = blurRegions.map((region, index) => ({
			id: region.id,
			rowId: BLUR_ROW_ID,
			span: { start: region.startMs, end: region.endMs },
			label: t("labels.blurItem", { index: String(index + 1) }),
			variant: "blur",
		}));

		const speeds: TimelineRenderItem[] = speedRegions.map((region, index) => ({
			id: region.id,
			rowId: SPEED_ROW_ID,
			span: { start: region.startMs, end: region.endMs },
			label: t("labels.speedItem", { index: String(index + 1) }),
			speedValue: region.speed,
			variant: "speed",
		}));

		const audioTracks: TimelineRenderItem[] = groupAudioTrackClips(audioTrackClips).map((group) => {
			const roles = new Set(group.clips.map((clip) => clip.role));
			return {
				id: group.id,
				rowId: AUDIO_ROW_ID,
				span: {
					start: group.startMs,
					end: group.endMs,
				},
				label: roles.has("voiceover") ? "AI Voice-over" : "Audio",
				variant: "mixed-audio",
			};
		});

		return [...videos, ...zooms, ...trims, ...annotations, ...blurs, ...speeds, ...audioTracks];
	}, [
		videoTrackClips,
		zoomRegions,
		trimRegions,
		annotationRegions,
		blurRegions,
		speedRegions,
		audioTrackClips,
		t,
	]);

	const voiceoverAudioUrl = useMemo(() => {
		const clip = audioTrackClips.find((candidate) => isFileBackedAudioClip(candidate));
		return clip?.sourcePath ? toFileUrl(clip.sourcePath) : undefined;
	}, [audioTrackClips]);
	const autoCaptionRegions = useMemo(
		() => annotationRegions.filter((region) => region.annotationSource === "auto-caption"),
		[annotationRegions],
	);

	const clearItemSelection = useCallback(() => {
		setSelectedItemIds(new Set());
		selectionAnchorIdRef.current = null;
		onSelectVideoTrack?.(null);
		onSelectZoom(null);
		onSelectTrim?.(null);
		onSelectAnnotation?.(null);
		onSelectBlur?.(null);
		onSelectSpeed?.(null);
		onSelectAudioTrack?.(null);
	}, [
		onSelectAnnotation,
		onSelectAudioTrack,
		onSelectBlur,
		onSelectSpeed,
		onSelectTrim,
		onSelectVideoTrack,
		onSelectZoom,
	]);

	const handleItemSelection = useCallback(
		(item: TimelineRenderItem, event: React.PointerEvent<HTMLDivElement>) => {
			setSelectedItemIds((current) => {
				let next: Set<string>;
				if (event.shiftKey && selectionAnchorIdRef.current) {
					const anchorIndex = timelineItems.findIndex(
						(candidate) => candidate.id === selectionAnchorIdRef.current,
					);
					const itemIndex = timelineItems.findIndex((candidate) => candidate.id === item.id);
					if (anchorIndex >= 0 && itemIndex >= 0) {
						const [start, end] =
							anchorIndex <= itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex];
						next = new Set(timelineItems.slice(start, end + 1).map((candidate) => candidate.id));
					} else {
						next = new Set([item.id]);
					}
				} else if (event.metaKey || event.ctrlKey) {
					next = new Set(current);
					if (next.has(item.id)) next.delete(item.id);
					else next.add(item.id);
					selectionAnchorIdRef.current = item.id;
				} else if (current.size > 1 && current.has(item.id)) {
					next = current;
				} else {
					next = new Set([item.id]);
					selectionAnchorIdRef.current = item.id;
				}
				return next;
			});

			if (item.rowId === VIDEO_ROW_ID) onSelectVideoTrack?.(item.id);
			else if (item.rowId === ZOOM_ROW_ID) onSelectZoom(item.id);
			else if (item.rowId === TRIM_ROW_ID) onSelectTrim?.(item.id);
			else if (item.rowId === ANNOTATION_ROW_ID) onSelectAnnotation?.(item.id);
			else if (item.rowId === BLUR_ROW_ID) onSelectBlur?.(item.id);
			else if (item.rowId === SPEED_ROW_ID) onSelectSpeed?.(item.id);
			else if (item.rowId === AUDIO_ROW_ID) onSelectAudioTrack?.(item.id);
		},
		[
			onSelectAnnotation,
			onSelectAudioTrack,
			onSelectBlur,
			onSelectSpeed,
			onSelectTrim,
			onSelectVideoTrack,
			onSelectZoom,
			timelineItems,
		],
	);
	const handleBoxSelection = useCallback((ids: string[]) => {
		setSelectedItemIds(new Set(ids));
		selectionAnchorIdRef.current = ids[ids.length - 1] ?? null;
	}, []);

	useEffect(() => {
		const validIds = new Set(timelineItems.map((item) => item.id));
		setSelectedItemIds((current) => {
			const next = new Set([...current].filter((id) => validIds.has(id)));
			return next.size === current.size ? current : next;
		});
	}, [timelineItems]);

	// Spans that participate in overlap resolution (clampToNeighbours). Annotation
	// and blur are excluded since they may overlap and shouldn't constrain a drag.
	const allRegionSpans = useMemo(() => {
		const zooms = zoomRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
		const trims = trimRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
		const speeds = speedRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
		return [...zooms, ...trims, ...speeds];
	}, [zoomRegions, trimRegions, speedRegions]);

	// Snap targets whose edges pull during a snap but don't push anyone away.
	const softSnapSpans = useMemo(() => {
		const annotations = annotationRegions.map((r) => ({
			id: r.id,
			start: r.startMs,
			end: r.endMs,
		}));
		const blurs = blurRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
		return [...annotations, ...blurs];
	}, [annotationRegions, blurRegions]);

	const keyframeTimesMs = useMemo(() => keyframes.map((kf) => kf.time), [keyframes]);

	const handleItemSpanChange = useCallback(
		(id: string, span: Span) => {
			const active = timelineItems.find((item) => item.id === id);
			if (
				active &&
				selectedItemIds.size > 1 &&
				selectedItemIds.has(id) &&
				onBatchItemSpanChange &&
				Math.round(span.end - span.start) === Math.round(active.span.end - active.span.start)
			) {
				const selected = timelineItems.filter((item) => selectedItemIds.has(item.id));
				const requestedDelta = span.start - active.span.start;
				const minStart = Math.min(...selected.map((item) => item.span.start));
				const maxEnd = Math.max(...selected.map((item) => item.span.end));
				const delta = Math.max(-minStart, Math.min(requestedDelta, totalMs - maxEnd));
				onBatchItemSpanChange(
					selected.map((item) => ({
						id: item.id,
						span: { start: item.span.start + delta, end: item.span.end + delta },
					})),
				);
				return;
			}
			if (isAudioMixItemId(id)) {
				onAudioTrackSpanChange?.(id, span);
			} else if (zoomRegions.some((r) => r.id === id)) {
				onZoomSpanChange(id, span);
			} else if (videoTrackClips.some((clip) => clip.id === id)) {
				onVideoTrackSpanChange?.(id, span);
			} else if (trimRegions.some((r) => r.id === id)) {
				onTrimSpanChange?.(id, span);
			} else if (speedRegions.some((r) => r.id === id)) {
				onSpeedSpanChange?.(id, span);
			} else if (annotationRegions.some((r) => r.id === id)) {
				onAnnotationSpanChange?.(id, span);
			} else if (blurRegions.some((r) => r.id === id)) {
				onBlurSpanChange?.(id, span);
			} else if (audioTrackClips.some((clip) => clip.id === id)) {
				onAudioTrackSpanChange?.(id, span);
			}
		},
		[
			zoomRegions,
			videoTrackClips,
			onVideoTrackSpanChange,
			trimRegions,
			speedRegions,
			annotationRegions,
			blurRegions,
			onZoomSpanChange,
			onTrimSpanChange,
			onSpeedSpanChange,
			onAnnotationSpanChange,
			onBlurSpanChange,
			audioTrackClips,
			onAudioTrackSpanChange,
			onBatchItemSpanChange,
			selectedItemIds,
			timelineItems,
			totalMs,
		],
	);

	if (!videoDuration || videoDuration === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-[#09090b] gap-3">
				<div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
					<Plus className="w-6 h-6 text-slate-600" />
				</div>
				<div className="text-center">
					<p className="text-sm font-medium text-slate-300">
						{hasVideoSource ? "Loading Timeline" : "No Video Loaded"}
					</p>
					<p className="text-xs text-slate-500 mt-1">
						{hasVideoSource
							? "Video opened, waiting for duration metadata"
							: "Drag and drop a video to start editing"}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 min-h-0 flex flex-col bg-[#09090b] overflow-hidden">
			<div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-[#08090b]/95">
				<div className="flex items-center gap-0.5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-0.5">
					<Button
						onClick={() => setToolMode("select")}
						variant="ghost"
						size="icon"
						aria-pressed={toolMode === "select"}
						className={cn(
							"h-7 w-7 rounded-lg",
							toolMode === "select" ? "bg-white/10 text-white" : "text-slate-400",
						)}
						title="Select tool (V)"
					>
						<MousePointer2 className="w-4 h-4" />
					</Button>
					<Button
						onClick={() => setToolMode("cut")}
						variant="ghost"
						size="icon"
						aria-pressed={toolMode === "cut"}
						className={cn(
							"h-7 w-7 rounded-lg",
							toolMode === "cut" ? "bg-red-500/15 text-red-400" : "text-slate-400",
						)}
						title="Cut tool (C)"
					>
						<Scissors className="w-4 h-4" />
					</Button>
					<Button
						onClick={handleAddZoom}
						variant="ghost"
						size="icon"
						className="h-7 w-7 rounded-lg text-slate-400 hover:text-[#34B27B] hover:bg-[#34B27B]/10 transition-all"
						title={t("buttons.addZoom")}
					>
						<ZoomIn className="w-4 h-4" />
					</Button>
					<Button
						onClick={() => onToggleAutoZoom?.(!autoZoomEnabled)}
						disabled={autoZoomAnalysisProgress !== null}
						variant="ghost"
						size="icon"
						aria-pressed={autoZoomEnabled}
						className={cn(
							"h-7 w-7 rounded-lg transition-all hover:bg-[#34B27B]/10 hover:text-[#34B27B]",
							autoZoomEnabled ? "bg-[#34B27B]/15 text-[#34B27B]" : "text-slate-400",
						)}
						title={autoZoomEnabled ? t("buttons.autoZoomOn") : t("buttons.autoZoomOff")}
					>
						{autoZoomAnalysisProgress ? (
							<LoaderCircle className="w-4 h-4 animate-spin" />
						) : (
							<WandSparkles className="w-4 h-4" />
						)}
					</Button>
					{autoZoomAnalysisProgress && (
						<span className="whitespace-nowrap text-[11px] text-[#34B27B]">
							正在分析关键操作 {autoZoomAnalysisProgress.completed}/{autoZoomAnalysisProgress.total}
						</span>
					)}
					<Button
						onClick={() => onToggleAutoFocusAll?.(!autoFocusAll)}
						variant="ghost"
						size="icon"
						aria-pressed={autoFocusAll}
						className={cn(
							"h-7 w-7 rounded-lg transition-all hover:bg-[#34B27B]/10 hover:text-[#34B27B]",
							autoFocusAll ? "bg-[#34B27B]/15 text-[#34B27B]" : "text-slate-400",
						)}
						title={autoFocusAll ? t("buttons.autoFocusAllOn") : t("buttons.autoFocusAllOff")}
					>
						<ScanEye className="w-4 h-4" />
					</Button>
					<Button
						onClick={handleAddAnnotation}
						variant="ghost"
						size="icon"
						className="h-7 w-7 rounded-lg text-slate-400 hover:text-[#B4A046] hover:bg-[#B4A046]/10 transition-all"
						title={t("buttons.addAnnotation")}
					>
						<MessageSquare className="w-4 h-4" />
					</Button>
					{BLUR_REGIONS_ENABLED && (
						<Button
							onClick={handleAddBlur}
							variant="ghost"
							size="icon"
							className="h-7 w-7 rounded-lg text-slate-400 hover:text-[#7dd3fc] hover:bg-[#7dd3fc]/10 transition-all"
							title={t("buttons.addBlur")}
						>
							<svg
								className="w-4 h-4"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<circle cx="8" cy="12" r="3" />
								<circle cx="16" cy="12" r="3" />
								<path d="M6 6h12M6 18h12" />
							</svg>
						</Button>
					)}
					<Button
						onClick={handleAddSpeed}
						variant="ghost"
						size="icon"
						className="h-7 w-7 rounded-lg text-slate-400 hover:text-[#d97706] hover:bg-[#d97706]/10 transition-all"
						title={t("buttons.addSpeed")}
					>
						<Gauge className="w-4 h-4" />
					</Button>
					{onGenerateCaptions && (
						<Button
							onClick={onGenerateCaptions}
							disabled={isGeneratingCaptions || !videoUrl}
							variant="ghost"
							size="icon"
							className="h-7 w-7 rounded-lg text-slate-400 hover:text-[#a78bfa] hover:bg-[#a78bfa]/10 transition-all"
							title={captionsLabel}
						>
							<Captions className="w-4 h-4" />
						</Button>
					)}
				</div>
				<div className="flex items-center gap-1.5 min-w-0">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 px-2 rounded-lg text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/[0.07] transition-all gap-1"
							>
								<span className="font-medium">{getAspectRatioLabel(aspectRatio)}</span>
								<ChevronDown className="w-3 h-3" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="bg-[#1a1a1a] border-white/10">
							{ASPECT_RATIOS.map((ratio) => (
								<DropdownMenuItem
									key={ratio}
									onClick={() => onAspectRatioChange(ratio)}
									className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer flex items-center justify-between gap-3"
								>
									<span>{getAspectRatioLabel(ratio)}</span>
									{aspectRatio === ratio && <Check className="w-3 h-3 text-[#34B27B]" />}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				<div className="flex-1" />
			</div>
			<div
				ref={timelineContainerRef}
				className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-[#09090b] relative"
				onClick={() => setSelectedKeyframeId(null)}
			>
				<TimelineWrapper
					range={clampedRange}
					videoDuration={videoDuration}
					hasOverlap={hasOverlap}
					onRangeChange={setRange}
					minItemDurationMs={timelineScale.minItemDurationMs}
					minVisibleRangeMs={timelineScale.minVisibleRangeMs}
					onItemSpanChange={handleItemSpanChange}
					allRegionSpans={allRegionSpans}
					softSnapSpans={softSnapSpans}
					currentTimeMs={currentTimeMs}
					keyframeTimesMs={keyframeTimesMs}
				>
					<KeyframeMarkers
						keyframes={keyframes}
						selectedKeyframeId={selectedKeyframeId}
						setSelectedKeyframeId={setSelectedKeyframeId}
						onKeyframeMove={handleKeyframeMove}
						videoDurationMs={totalMs}
						timelineRef={timelineContainerRef}
					/>
					<Timeline
						items={timelineItems}
						videoDurationMs={totalMs}
						currentTimeMs={currentTimeMs}
						onSeek={onSeek}
						onRangeChange={setRange}
						onSelectZoom={onSelectZoom}
						onSelectVideoTrack={onSelectVideoTrack}
						onSelectTrim={onSelectTrim}
						onSelectAnnotation={onSelectAnnotation}
						onSelectBlur={onSelectBlur}
						onSelectSpeed={onSelectSpeed}
						onSelectAudioTrack={onSelectAudioTrack}
						selectedItemIds={selectedItemIds}
						onSelectItem={handleItemSelection}
						onBoxSelect={handleBoxSelection}
						onClearSelection={clearItemSelection}
						keyframes={keyframes}
						videoUrl={videoUrl}
						voiceoverAudioUrl={voiceoverAudioUrl}
						showTrimWaveform={showTrimWaveform}
						autoCaptionRegions={autoCaptionRegions}
						selectedAnnotationId={selectedAnnotationId}
						captionTrackLabel={captionsLabel}
						toolMode={toolMode}
						onCutItem={onCutItem}
						videoFrameRate={videoFrameRate}
						lockedTrackKinds={lockedTrackKinds}
					/>
				</TimelineWrapper>
			</div>
		</div>
	);
}
