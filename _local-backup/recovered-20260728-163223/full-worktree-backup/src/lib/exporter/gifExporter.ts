import GIF from "gif.js";
import { TimelineMapper } from "@/components/video-editor/timeline/timelineMapper";
import type {
	AnnotationRegion,
	CropRegion,
	SpeedRegion,
	TrimRegion,
	VideoTrackClip,
	WebcamLayoutPreset,
	WebcamSizePreset,
	ZoomRegion,
} from "@/components/video-editor/types";
import { BackgroundLoadError } from "@/lib/wallpaper";
import { mapScreenSourceToWebcam, type WebcamSyncMetadata } from "@/lib/webcamSync";
import type { CursorRecordingData } from "@/native/contracts";
import { getPlatform } from "@/utils/platformUtils";
import { FrameRenderer } from "./frameRenderer";
import {
	buildMediaTimelineTiming,
	buildMediaVideoDecodeJobs,
	frameIndexForExportTimestamp,
	frameIndexForTimelineTime,
	shouldRenderMediaBackground,
	timelineTimeForExportTime,
	totalFramesForExportDuration,
} from "./mediaTimelineTiming";
import { StreamingVideoDecoder } from "./streamingDecoder";
import { TimestampedVideoFrameQueue } from "./timestampedVideoFrameQueue";
import type {
	ExportProgress,
	ExportResult,
	GIF_SIZE_PRESETS,
	GifFrameRate,
	GifSizePreset,
} from "./types";

const GIF_WORKER_URL = new URL("gif.js/dist/gif.worker.js", import.meta.url).toString();

interface GifExporterConfig {
	videoUrl: string;
	webcamVideoUrl?: string;
	webcamSync?: WebcamSyncMetadata;
	width: number;
	height: number;
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	videoTrackClips?: VideoTrackClip[];
	videoTrackHidden?: boolean;
	showShadow: boolean;
	shadowIntensity: number;
	showBlur: boolean;
	motionBlurAmount?: number;
	borderRadius?: number;
	padding?: number;
	videoPadding?: number;
	cropRegion: CropRegion;
	webcamLayoutPreset?: WebcamLayoutPreset;
	webcamMaskShape?: import("@/components/video-editor/types").WebcamMaskShape;
	webcamMirrored?: boolean;
	webcamReactiveZoom?: boolean;
	webcamSizePreset?: WebcamSizePreset;
	webcamPosition?: { cx: number; cy: number } | null;
	cursorRecordingData?: CursorRecordingData | null;
	cursorScale?: number;
	cursorSmoothing?: number;
	smartCursorEnabled?: boolean;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClipToBounds?: boolean;
	cursorTheme?: string;
	annotationRegions?: AnnotationRegion[];
	previewWidth?: number;
	previewHeight?: number;
	cursorTelemetry?: import("@/components/video-editor/types").CursorTelemetryPoint[];
	cursorClickTimestamps?: number[];
	onProgress?: (progress: ExportProgress) => void;
}

/**
 * Calculate output dimensions based on size preset and source dimensions while preserving aspect ratio.
 * @param sourceWidth - Original video width
 * @param sourceHeight - Original video height
 * @param sizePreset - The size preset to use
 * @param sizePresets - The size presets configuration
 * @returns The calculated output dimensions
 */
export function calculateOutputDimensions(
	sourceWidth: number,
	sourceHeight: number,
	sizePreset: GifSizePreset,
	sizePresets: typeof GIF_SIZE_PRESETS,
	targetAspectRatio = sourceWidth / sourceHeight,
): { width: number; height: number } {
	const preset = sizePresets[sizePreset];
	const maxHeight = preset.maxHeight;
	const aspectRatio =
		Number.isFinite(targetAspectRatio) && targetAspectRatio > 0
			? targetAspectRatio
			: sourceWidth / sourceHeight;

	const toEven = (value: number) => {
		const evenValue = Math.max(2, Math.floor(value / 2) * 2);
		return evenValue;
	};

	if (sizePreset === "original") {
		const sourceAspect = sourceWidth / sourceHeight;
		if (aspectRatio >= sourceAspect) {
			const width = toEven(sourceWidth);
			const height = toEven(width / aspectRatio);
			return { width, height };
		}

		const height = toEven(sourceHeight);
		const width = toEven(height * aspectRatio);
		return { width, height };
	}

	const targetHeight = maxHeight;
	const targetWidth = Math.round(targetHeight * aspectRatio);

	return {
		width: toEven(targetWidth),
		height: toEven(targetHeight),
	};
}

export class GifExporter {
	private config: GifExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private webcamDecoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	private gif: GIF | null = null;
	private cancelled = false;

	constructor(config: GifExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		let webcamFrameQueue: TimestampedVideoFrameQueue | null = null;

		const warnings: string[] = [];
		const onWarning = (message: string) => warnings.push(message);

		try {
			const platform = await getPlatform();

			this.cleanup();
			this.cancelled = false;

			this.streamingDecoder = new StreamingVideoDecoder();
			const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);
			let webcamInfo: Awaited<ReturnType<StreamingVideoDecoder["loadMetadata"]>> | null = null;
			if (this.config.webcamVideoUrl) {
				this.webcamDecoder = new StreamingVideoDecoder();
				webcamInfo = await this.webcamDecoder.loadMetadata(this.config.webcamVideoUrl);
			}

			this.renderer = new FrameRenderer({
				width: this.config.width,
				height: this.config.height,
				wallpaper: this.config.wallpaper,
				zoomRegions: this.config.zoomRegions,
				showShadow: this.config.showShadow,
				shadowIntensity: this.config.shadowIntensity,
				showBlur: this.config.showBlur,
				motionBlurAmount: this.config.motionBlurAmount,
				borderRadius: this.config.borderRadius,
				padding: this.config.padding,
				cropRegion: this.config.cropRegion,
				cursorRecordingData: this.config.cursorRecordingData,
				cursorScale: this.config.cursorScale,
				cursorSmoothing: this.config.cursorSmoothing,
				smartCursorEnabled: this.config.smartCursorEnabled,
				cursorMotionBlur: this.config.cursorMotionBlur,
				cursorClickBounce: this.config.cursorClickBounce,
				cursorClipToBounds: this.config.cursorClipToBounds,
				cursorTheme: this.config.cursorTheme,
				videoWidth: videoInfo.width,
				videoHeight: videoInfo.height,
				webcamSize: webcamInfo ? { width: webcamInfo.width, height: webcamInfo.height } : null,
				webcamLayoutPreset: this.config.webcamLayoutPreset,
				webcamMaskShape: this.config.webcamMaskShape,
				webcamMirrored: this.config.webcamMirrored,
				webcamReactiveZoom: this.config.webcamReactiveZoom,
				webcamSizePreset: this.config.webcamSizePreset,
				webcamPosition: this.config.webcamPosition,
				annotationRegions: this.config.annotationRegions,
				speedRegions: this.config.speedRegions,
				previewWidth: this.config.previewWidth,
				previewHeight: this.config.previewHeight,
				cursorTelemetry: this.config.cursorTelemetry,
				cursorClickTimestamps: this.config.cursorClickTimestamps,
				platform,
			});
			await this.renderer.initialize();

			// gif.js repeat: 0 = infinite loop, 1 = play once
			const repeat = this.config.loop ? 0 : 1;
			const cores = navigator.hardwareConcurrency || 4;
			const WORKER_COUNT = Math.max(1, Math.min(8, cores - 1));
			this.gif = new GIF({
				workers: WORKER_COUNT,
				quality: 10,
				width: this.config.width,
				height: this.config.height,
				workerScript: GIF_WORKER_URL,
				repeat,
				background: "#000000",
				transparent: null,
				dither: "FloydSteinberg",
			});

			// Effective duration and frame count, excluding trim regions
			const sourceMetrics = this.streamingDecoder.getExportMetrics(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
			);
			const timelineMapper = new TimelineMapper(
				this.config.videoTrackClips ?? [],
				[],
				this.config.speedRegions ?? [],
			);
			const usesMediaTimeline = Boolean(
				this.config.videoTrackClips?.length || this.config.videoTrackHidden,
			);
			const mediaTiming = usesMediaTimeline
				? buildMediaTimelineTiming(timelineMapper.durationMs, this.config.speedRegions ?? [])
				: null;
			const mediaDecodeJobs = usesMediaTimeline
				? buildMediaVideoDecodeJobs(
						this.config.videoTrackClips ?? [],
						Math.round(videoInfo.duration * 1000),
						this.config.speedRegions ?? [],
					)
				: [];
			const effectiveDuration = usesMediaTimeline
				? (mediaTiming?.exportDurationMs ?? 0) / 1000
				: sourceMetrics.effectiveDuration;
			const totalFrames = usesMediaTimeline
				? totalFramesForExportDuration(mediaTiming?.exportDurationMs ?? 0, this.config.frameRate)
				: sourceMetrics.totalFrames;

			// gif.js wants frame delay in ms
			const frameDelay = Math.round(1000 / this.config.frameRate);

			console.log("[GifExporter] Original duration:", videoInfo.duration, "s");
			console.log("[GifExporter] Effective duration:", effectiveDuration, "s");
			console.log("[GifExporter] Total frames to export:", totalFrames);
			console.log("[GifExporter] Frame rate:", this.config.frameRate, "FPS");
			console.log("[GifExporter] Frame delay:", frameDelay, "ms");
			console.log("[GifExporter] Loop:", this.config.loop ? "infinite" : "once");
			console.log("[GifExporter] Using streaming decode (web-demuxer + VideoDecoder)");

			let frameIndex = 0;
			const mediaBackgroundTimestampUs = () =>
				mediaTiming
					? timelineTimeForExportTime(mediaTiming, (frameIndex * 1000) / this.config.frameRate) *
						1000
					: (frameIndex * 1_000_000) / this.config.frameRate;
			const addRenderedFrame = () => {
				const canvas = this.renderer!.getCanvas();
				this.gif!.addFrame(canvas, { delay: frameDelay, copy: true });
				frameIndex++;
				this.config.onProgress?.({
					currentFrame: frameIndex,
					totalFrames,
					percentage: Math.min(100, (frameIndex / totalFrames) * 100),
					estimatedTimeRemaining: 0,
				});
			};
			let stopWebcamDecode = false;
			let webcamDecodeError: Error | null = null;
			let webcamDecodePromise: Promise<void> | null = null;
			const startWebcamDecode = (_trimRegions?: TrimRegion[], _speedRegions?: SpeedRegion[]) => {
				if (!this.webcamDecoder) return;
				stopWebcamDecode = false;
				webcamDecodeError = null;
				webcamFrameQueue = new TimestampedVideoFrameQueue();
				const queue = webcamFrameQueue;
				webcamDecodePromise = this.webcamDecoder
					.decodeAll(
						this.config.frameRate,
						undefined,
						undefined,
						async (webcamFrame, _exportTimestampUs, webcamSourceTimestampMs) => {
							while (queue.length >= 12 && !this.cancelled && !stopWebcamDecode) {
								await new Promise((resolve) => setTimeout(resolve, 2));
							}
							if (this.cancelled || stopWebcamDecode) {
								webcamFrame.close();
								return;
							}
							queue.enqueue(webcamFrame, webcamSourceTimestampMs);
						},
						onWarning,
					)
					.catch((error) => {
						webcamDecodeError = error instanceof Error ? error : new Error(String(error));
						throw error;
					})
					.finally(() => {
						if (webcamDecodeError) queue.fail(webcamDecodeError);
						else queue.close();
					});
			};
			const finishWebcamDecode = async () => {
				stopWebcamDecode = true;
				webcamFrameQueue?.destroy();
				await webcamDecodePromise;
				webcamFrameQueue = null;
				webcamDecodePromise = null;
			};
			const processDecodedVideoFrame = async (
				videoFrame: VideoFrame,
				sourceTimestampMs: number,
				timelineTimestampMs: number,
				targetFrameIndex: number,
			) => {
				let webcamFrame: VideoFrame | null = null;
				try {
					if (this.cancelled) return;
					while (frameIndex < targetFrameIndex && frameIndex < totalFrames) {
						if (!usesMediaTimeline) {
							await this.renderer!.renderBackgroundFrame(
								(frameIndex * 1_000_000) / this.config.frameRate,
							);
						}
						addRenderedFrame();
					}
					if (targetFrameIndex < frameIndex || frameIndex >= totalFrames) return;
					const webcamSourceTimestampMs = mapScreenSourceToWebcam(
						sourceTimestampMs,
						this.config.webcamSync,
						{ webcamDurationMs: webcamInfo ? webcamInfo.duration * 1000 : undefined },
					);
					webcamFrame =
						webcamFrameQueue && webcamSourceTimestampMs !== null
							? await webcamFrameQueue.frameAt(webcamSourceTimestampMs)
							: null;
					const renderer = this.renderer;
					if (this.cancelled || !renderer) return;
					await renderer.renderFrame(
						videoFrame,
						timelineTimestampMs * 1000,
						webcamFrame,
						sourceTimestampMs * 1000,
					);
					addRenderedFrame();
				} finally {
					videoFrame.close();
					webcamFrame?.close();
				}
			};

			// Stream decode and process frames, no seeking
			if (!this.config.videoTrackHidden) {
				if (usesMediaTimeline && mediaTiming) {
					let previousClipEndMs: number | null = null;
					for (const job of mediaDecodeJobs) {
						if (
							previousClipEndMs === null
								? job.clip.startMs > 0
								: job.clip.startMs > previousClipEndMs + 0.0001
						) {
							const clipStartFrame = frameIndexForTimelineTime(
								mediaTiming,
								job.clip.startMs,
								this.config.frameRate,
							);
							while (frameIndex < clipStartFrame && frameIndex < totalFrames) {
								await this.renderer.renderBackgroundFrame(mediaBackgroundTimestampUs());
								addRenderedFrame();
							}
						}
						startWebcamDecode(job.trimRegions, job.speedRegions);
						try {
							await this.streamingDecoder.decodeAll(
								this.config.frameRate,
								job.trimRegions,
								job.speedRegions,
								async (videoFrame, _exportTimestampUs, sourceTimestampMs) => {
									const timelineTimestampMs =
										job.clip.startMs + sourceTimestampMs - job.clip.sourceStartMs;
									await processDecodedVideoFrame(
										videoFrame,
										sourceTimestampMs,
										timelineTimestampMs,
										frameIndexForTimelineTime(
											mediaTiming,
											timelineTimestampMs,
											this.config.frameRate,
										),
									);
								},
								onWarning,
							);
						} finally {
							await finishWebcamDecode();
						}
						previousClipEndMs = Math.max(previousClipEndMs ?? 0, job.clip.endMs);
					}
				} else {
					startWebcamDecode(this.config.trimRegions, this.config.speedRegions);
					try {
						await this.streamingDecoder.decodeAll(
							this.config.frameRate,
							this.config.trimRegions,
							this.config.speedRegions,
							async (videoFrame, exportTimestampUs, sourceTimestampMs) =>
								processDecodedVideoFrame(
									videoFrame,
									sourceTimestampMs,
									sourceTimestampMs,
									frameIndexForExportTimestamp(exportTimestampUs, this.config.frameRate),
								),
							onWarning,
						);
					} finally {
						await finishWebcamDecode();
					}
				}
			}
			const videoTimelineEndMs = Math.max(
				0,
				...(this.config.videoTrackClips ?? []).map((clip) => clip.endMs),
			);
			while (usesMediaTimeline && frameIndex < totalFrames && !this.cancelled) {
				if (
					shouldRenderMediaBackground(
						Boolean(this.config.videoTrackHidden),
						timelineMapper.durationMs,
						videoTimelineEndMs,
					)
				) {
					await this.renderer.renderBackgroundFrame(mediaBackgroundTimestampUs());
				}
				addRenderedFrame();
			}

			if (this.cancelled) {
				return { success: false, error: "Export cancelled" };
			}

			this.webcamDecoder?.cancel();

			// Now in the finalizing phase
			if (this.config.onProgress) {
				this.config.onProgress({
					currentFrame: totalFrames,
					totalFrames,
					percentage: 100,
					estimatedTimeRemaining: 0,
					phase: "finalizing",
				});
			}

			const blob = await new Promise<Blob>((resolve, _reject) => {
				this.gif!.on("finished", (blob: Blob) => {
					resolve(blob);
				});

				this.gif!.on("progress", (progress: number) => {
					if (this.config.onProgress) {
						this.config.onProgress({
							currentFrame: totalFrames,
							totalFrames,
							percentage: 100,
							estimatedTimeRemaining: 0,
							phase: "finalizing",
							renderProgress: Math.round(progress * 100),
						});
					}
				});

				// gif.js has no typed 'error' event; the outer try/catch handles failures
				this.gif!.render();
			});

			return { success: true, blob, warnings: warnings.length > 0 ? warnings : undefined };
		} catch (error) {
			if (error instanceof BackgroundLoadError) {
				throw error;
			}
			console.error("GIF Export error:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			(webcamFrameQueue as TimestampedVideoFrameQueue | null)?.destroy();
			this.cleanup();
		}
	}

	cancel(): void {
		this.cancelled = true;
		if (this.streamingDecoder) {
			this.streamingDecoder.cancel();
		}
		if (this.webcamDecoder) {
			this.webcamDecoder.cancel();
		}
		if (this.gif) {
			this.gif.abort();
		}
		this.cleanup();
	}

	private cleanup(): void {
		if (this.streamingDecoder) {
			try {
				this.streamingDecoder.destroy();
			} catch (e) {
				console.warn("Error destroying streaming decoder:", e);
			}
			this.streamingDecoder = null;
		}

		if (this.webcamDecoder) {
			try {
				this.webcamDecoder.destroy();
			} catch (e) {
				console.warn("Error destroying webcam decoder:", e);
			}
			this.webcamDecoder = null;
		}

		if (this.renderer) {
			try {
				this.renderer.destroy();
			} catch (e) {
				console.warn("Error destroying renderer:", e);
			}
			this.renderer = null;
		}

		this.gif = null;
	}
}
