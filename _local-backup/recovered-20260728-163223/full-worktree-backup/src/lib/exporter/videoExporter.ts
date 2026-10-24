import { TimelineMapper } from "@/components/video-editor/timeline/timelineMapper";
import {
	type AnnotationRegion,
	type AudioTrackClip,
	type CropRegion,
	isFileBackedAudioClip,
	type SpeedRegion,
	type TrimRegion,
	type VideoTrackClip,
	type WebcamLayoutPreset,
	type WebcamSizePreset,
	type ZoomRegion,
} from "@/components/video-editor/types";
import { BackgroundLoadError } from "@/lib/wallpaper";
import { mapScreenSourceToWebcam, type WebcamSyncMetadata } from "@/lib/webcamSync";
import type { CursorRecordingData } from "@/native/contracts";
import { getPlatform } from "@/utils/platformUtils";
import { AudioProcessor } from "./audioEncoder";
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
import { VideoMuxer } from "./muxer";
import { StreamingVideoDecoder } from "./streamingDecoder";
import { TimestampedVideoFrameQueue } from "./timestampedVideoFrameQueue";
import type {
	ExportConfig,
	ExportPath,
	ExportProgress,
	ExportQuality,
	ExportResult,
} from "./types";

const ENCODER_STALL_TIMEOUT_MS = 15_000;
const ENCODER_FLUSH_TIMEOUT_MS = 20_000;

export interface VideoExporterConfig extends ExportConfig {
	maxFrameRate?: number;
	exportQuality?: ExportQuality;
	videoUrl: string;
	webcamVideoUrl?: string;
	webcamSync?: WebcamSyncMetadata;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	audioTrackClips?: AudioTrackClip[];
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

export interface ExportPlan {
	path: ExportPath;
	reasons: string[];
}

export function selectExportFrameRate(
	config: Pick<VideoExporterConfig, "frameRate" | "maxFrameRate">,
	sourceFrameRate: number,
	path: ExportPath,
) {
	const requestedFrameRate = Math.max(
		1,
		Math.min(config.frameRate, config.maxFrameRate ?? config.frameRate),
	);
	if (path !== "composite" && Number.isFinite(sourceFrameRate) && sourceFrameRate > 0) {
		return sourceFrameRate;
	}
	return requestedFrameRate;
}

export function shouldExportAudio(hasSourceAudio: boolean, clips?: AudioTrackClip[]): boolean {
	// A file-backed clip (voice-over) carries its own audio even when the source has none.
	const hasAudibleFileBackedClip = Boolean(
		clips?.some((clip) => isFileBackedAudioClip(clip) && !clip.muted && clip.gain > 0),
	);
	if (!hasSourceAudio && !hasAudibleFileBackedClip) return false;
	if (!clips?.length) return true;
	return clips.some((clip) => !clip.muted && clip.gain > 0);
}

const SOURCE_COPY_EPSILON = 0.0001;

function hasActiveTimeRegions(regions?: Array<{ startMs: number; endMs: number }>) {
	return Boolean(regions?.some((region) => region.endMs - region.startMs > SOURCE_COPY_EPSILON));
}

function hasActiveSpeedRegions(regions?: SpeedRegion[]) {
	return Boolean(
		regions?.some(
			(region) =>
				region.endMs - region.startMs > SOURCE_COPY_EPSILON &&
				Math.abs(region.speed - 1) > SOURCE_COPY_EPSILON,
		),
	);
}

function hasNativeCursorOverlay(config: VideoExporterConfig) {
	return (config.cursorScale ?? 0) > 0;
}

function isDefaultCrop(cropRegion: CropRegion) {
	return (
		Math.abs(cropRegion.x) <= SOURCE_COPY_EPSILON &&
		Math.abs(cropRegion.y) <= SOURCE_COPY_EPSILON &&
		Math.abs(cropRegion.width - 1) <= SOURCE_COPY_EPSILON &&
		Math.abs(cropRegion.height - 1) <= SOURCE_COPY_EPSILON
	);
}

function hasContiguousMonotonicVideo(config: VideoExporterConfig) {
	if (config.videoTrackHidden) return false;
	const clips = [...(config.videoTrackClips ?? [])].sort(
		(left, right) => left.startMs - right.startMs,
	);
	if (clips.length === 0) return true;
	let timelineCursor = 0;
	let sourceCursor = -Infinity;
	for (const clip of clips) {
		if (Math.abs(clip.startMs - timelineCursor) > SOURCE_COPY_EPSILON) return false;
		if (clip.sourceStartMs < sourceCursor - SOURCE_COPY_EPSILON) return false;
		timelineCursor = clip.endMs;
		sourceCursor = clip.sourceStartMs + clip.endMs - clip.startMs;
	}
	return true;
}

export function getCompositeExportBlockers(
	config: VideoExporterConfig,
	videoInfo: { width: number; height: number },
) {
	const blockers: string[] = [];
	if (config.width !== videoInfo.width || config.height !== videoInfo.height)
		blockers.push("output size differs from source");
	if (config.webcamVideoUrl) blockers.push("webcam overlay");
	if (!hasContiguousMonotonicVideo(config)) blockers.push("video background gap or reorder");
	if (config.videoTrackClips?.length && hasActiveSpeedRegions(config.speedRegions)) {
		blockers.push("media timeline speed resampling");
	}
	if (hasActiveTimeRegions(config.zoomRegions)) blockers.push("zoom");
	if (hasActiveTimeRegions(config.annotationRegions)) blockers.push("annotation or blur");
	if (hasNativeCursorOverlay(config)) blockers.push("cursor overlay");
	if (!isDefaultCrop(config.cropRegion)) blockers.push("crop");
	if ((config.padding ?? 0) > SOURCE_COPY_EPSILON) blockers.push("padding");
	if ((config.videoPadding ?? 0) > SOURCE_COPY_EPSILON) blockers.push("video padding");
	if ((config.borderRadius ?? 0) > SOURCE_COPY_EPSILON) blockers.push("roundness");
	if (config.showShadow || config.shadowIntensity > SOURCE_COPY_EPSILON) blockers.push("shadow");
	if (config.showBlur) blockers.push("background blur");
	if ((config.motionBlurAmount ?? 0) > SOURCE_COPY_EPSILON) blockers.push("motion blur");
	return blockers;
}

export function createExportPlan(
	config: VideoExporterConfig,
	videoInfo: { width: number; height: number; duration?: number },
	options: { packetBoundariesAreKeyframes?: boolean } = {},
): ExportPlan {
	const sourceCopyBlockers = getSourceCopyFastPathBlockers(config, videoInfo);
	if (sourceCopyBlockers.length === 0) return { path: "source-copy", reasons: [] };
	const compositeBlockers = getCompositeExportBlockers(config, videoInfo);
	if (compositeBlockers.length > 0) return { path: "composite", reasons: compositeBlockers };
	const packetOnlyEdits =
		!hasActiveSpeedRegions(config.speedRegions) &&
		!config.audioTrackClips?.some(
			(clip) => clip.muted || clip.gain !== 1 || isFileBackedAudioClip(clip),
		);
	if (options.packetBoundariesAreKeyframes && packetOnlyEdits) {
		return { path: "packet-remux", reasons: sourceCopyBlockers };
	}
	return { path: "direct-transcode", reasons: sourceCopyBlockers };
}

export function isSourceCopyFastPathEligible(
	config: VideoExporterConfig,
	videoInfo: { width: number; height: number; duration?: number },
) {
	return getSourceCopyFastPathBlockers(config, videoInfo).length === 0;
}

export function getSourceCopyFastPathBlockers(
	config: VideoExporterConfig,
	videoInfo: { width: number; height: number; duration?: number },
) {
	const blockers: string[] = [];

	if (config.width !== videoInfo.width || config.height !== videoInfo.height) {
		blockers.push(
			`output-size ${config.width}x${config.height} differs from source ${videoInfo.width}x${videoInfo.height}`,
		);
	}
	if (config.webcamVideoUrl) blockers.push("webcam overlay is enabled");
	if (config.videoTrackHidden) blockers.push("video track is hidden");
	if (hasActiveTimeRegions(config.trimRegions)) blockers.push("trim regions are present");
	if (hasActiveSpeedRegions(config.speedRegions)) blockers.push("speed regions are present");
	if (
		config.videoTrackClips?.length &&
		(config.videoTrackClips.length !== 1 ||
			config.videoTrackClips[0].startMs !== 0 ||
			config.videoTrackClips[0].sourceStartMs !== 0 ||
			(typeof videoInfo.duration === "number" &&
				Math.abs(config.videoTrackClips[0].endMs - videoInfo.duration * 1000) >
					SOURCE_COPY_EPSILON))
	) {
		blockers.push("video track is edited");
	}
	if (
		config.audioTrackClips?.some(
			(clip) => clip.startMs !== 0 || clip.sourceStartMs !== 0 || clip.muted || clip.gain !== 1,
		)
	) {
		blockers.push("audio tracks are edited");
	}
	if (config.audioTrackClips?.some((clip) => isFileBackedAudioClip(clip))) {
		blockers.push("voice-over track is present");
	}
	if (hasActiveTimeRegions(config.zoomRegions)) blockers.push("zoom regions are present");
	if (hasActiveTimeRegions(config.annotationRegions))
		blockers.push("annotation regions are present");
	if (hasNativeCursorOverlay(config)) blockers.push("editable cursor overlay is enabled");
	if (!isDefaultCrop(config.cropRegion)) blockers.push("crop is not default");
	if ((config.padding ?? 0) > SOURCE_COPY_EPSILON) blockers.push("padding is not zero");
	if ((config.videoPadding ?? 0) > SOURCE_COPY_EPSILON) blockers.push("video padding is not zero");
	if ((config.borderRadius ?? 0) > SOURCE_COPY_EPSILON) blockers.push("roundness is not zero");
	if (config.showShadow || config.shadowIntensity > SOURCE_COPY_EPSILON) {
		blockers.push("shadow is enabled");
	}
	if (config.showBlur) blockers.push("background blur is enabled");
	if ((config.motionBlurAmount ?? 0) > SOURCE_COPY_EPSILON) blockers.push("motion blur is enabled");

	return blockers;
}

function isMp4Source(videoUrl: string, blob: Blob) {
	if (blob.type.toLowerCase().includes("mp4")) {
		return true;
	}

	try {
		const path = new URL(videoUrl, window.location.href).pathname;
		return path.toLowerCase().endsWith(".mp4");
	} catch {
		return videoUrl.toLowerCase().split(/[?#]/, 1)[0].endsWith(".mp4");
	}
}

export class VideoExporter {
	private config: VideoExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	private encoder: VideoEncoder | null = null;
	private muxer: VideoMuxer | null = null;
	private audioProcessor: AudioProcessor | null = null;
	private webcamDecoder: StreamingVideoDecoder | null = null;
	private cancelled = false;
	private encodeQueue = 0;
	// Keep a smaller queue for software encoding so Windows does not balloon memory.
	private readonly MAX_ENCODE_QUEUE = 120;
	private videoDescription: Uint8Array | undefined;
	private videoColorSpace: VideoColorSpaceInit | undefined;
	private muxingPromises: Promise<void>[] = [];
	private chunkCount = 0;
	private lastEncoderOutputAt = 0;
	private fatalEncoderError: Error | null = null;

	constructor(config: VideoExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		const encoderPreferences = this.getEncoderPreferences();
		let lastError: Error | null = null;

		for (const encoderPreference of encoderPreferences) {
			try {
				return await this.exportWithEncoderPreference(encoderPreference);
			} catch (error) {
				const normalizedError = error instanceof Error ? error : new Error(String(error));
				lastError = normalizedError;

				if (this.cancelled) {
					return { success: false, error: "Export cancelled" };
				}

				if (normalizedError instanceof BackgroundLoadError) {
					throw normalizedError;
				}

				if (encoderPreferences.length > 1) {
					console.warn(
						`[VideoExporter] ${encoderPreference} export attempt failed:`,
						normalizedError,
					);
				}
			} finally {
				this.cleanup();
			}
		}

		return {
			success: false,
			error: lastError?.message || "Export failed",
		};
	}

	private async exportWithEncoderPreference(
		encoderPreference: HardwareAcceleration,
	): Promise<ExportResult> {
		const exportStartedAt = performance.now();
		const stageDurationsMs: Record<string, number> = {};
		let webcamFrameQueue: TimestampedVideoFrameQueue | null = null;
		let stopWebcamDecode = false;
		let webcamDecodeError: Error | null = null;
		let webcamDecodePromise: Promise<void> | null = null;
		let webcamDecoder: StreamingVideoDecoder | null = null;
		let lastDirectVideoFrame: VideoFrame | null = null;
		const warnings: string[] = [];
		const onWarning = (message: string) => warnings.push(message);

		this.cleanup();
		this.cancelled = false;
		this.fatalEncoderError = null;

		try {
			const platform = await getPlatform();
			this.reportProgress({
				currentFrame: 0,
				totalFrames: 1,
				percentage: 0,
				estimatedTimeRemaining: 0,
				phase: "analyzing",
			});

			const streamingDecoder = new StreamingVideoDecoder();
			this.streamingDecoder = streamingDecoder;
			const analysisStartedAt = performance.now();
			const videoInfo = await streamingDecoder.loadMetadata(this.config.videoUrl);
			stageDurationsMs.analysis = performance.now() - analysisStartedAt;
			const sourceCopyResult = await this.trySourceCopyFastPath(videoInfo);
			if (sourceCopyResult) {
				return {
					...sourceCopyResult,
					path: "source-copy",
					diagnostics: {
						frameCount: 0,
						frameRate: videoInfo.frameRate,
						stageDurationsMs: {
							...stageDurationsMs,
							total: performance.now() - exportStartedAt,
						},
					},
				};
			}
			const exportPlan = createExportPlan(this.config, videoInfo);
			this.config.frameRate = selectExportFrameRate(
				this.config,
				videoInfo.frameRate,
				exportPlan.path,
			);
			const usesCompositeRenderer = exportPlan.path === "composite";
			console.info(`[VideoExporter] using ${exportPlan.path} path`, {
				reasons: exportPlan.reasons,
				frameRate: this.config.frameRate,
			});
			if (exportPlan.path === "direct-transcode") {
				const remuxResult = await this.tryPacketRemuxFastPath(videoInfo, stageDurationsMs);
				if (remuxResult) {
					return {
						...remuxResult,
						diagnostics: {
							...remuxResult.diagnostics,
							stageDurationsMs: {
								...stageDurationsMs,
								total: performance.now() - exportStartedAt,
							},
						},
					};
				}
			}

			let webcamInfo: Awaited<ReturnType<StreamingVideoDecoder["loadMetadata"]>> | null = null;
			if (this.config.webcamVideoUrl) {
				webcamDecoder = new StreamingVideoDecoder();
				this.webcamDecoder = webcamDecoder;
				webcamInfo = await webcamDecoder.loadMetadata(this.config.webcamVideoUrl);
			}

			const renderer = usesCompositeRenderer
				? new FrameRenderer({
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
					})
				: null;
			this.renderer = renderer;
			if (renderer) await renderer.initialize();

			await this.initializeEncoder(encoderPreference);

			const sourceDemuxer = streamingDecoder.getDemuxer();
			const expectsAudio = shouldExportAudio(videoInfo.hasAudio, this.config.audioTrackClips);
			let audioExportCodec =
				expectsAudio && sourceDemuxer
					? await AudioProcessor.selectSupportedExportCodecForSource(sourceDemuxer)
					: null;
			if (
				expectsAudio &&
				!audioExportCodec &&
				this.config.audioTrackClips?.some((clip) => isFileBackedAudioClip(clip))
			) {
				// Voice-over over a silent source: no source stream to derive a codec from.
				audioExportCodec = await AudioProcessor.selectSupportedExportCodec(48_000, 1);
			}
			if (expectsAudio && !audioExportCodec) {
				throw new Error("The source contains audio, but no safe audio export path is available.");
			}

			const hasAudio = expectsAudio && Boolean(audioExportCodec);
			const muxer = new VideoMuxer(this.config, hasAudio, audioExportCodec?.muxerCodec);
			this.muxer = muxer;
			await muxer.initialize();

			const { totalFrames: sourceTotalFrames } = streamingDecoder.getExportMetrics(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
			);
			const timelineMapper = new TimelineMapper(
				this.config.videoTrackClips ?? [],
				this.config.audioTrackClips ?? [],
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
			const totalFrames = usesMediaTimeline
				? totalFramesForExportDuration(mediaTiming?.exportDurationMs ?? 0, this.config.frameRate)
				: sourceTotalFrames;
			const audioTimelineDurationSec = usesMediaTimeline
				? timelineMapper.durationMs / 1000
				: videoInfo.duration;

			const frameDuration = 1_000_000 / this.config.frameRate;
			let frameIndex = 0;
			const mediaBackgroundTimestampUs = () =>
				mediaTiming
					? timelineTimeForExportTime(mediaTiming, (frameIndex * 1000) / this.config.frameRate) *
						1000
					: frameIndex * frameDuration;
			const maxEncodeQueue =
				encoderPreference === "prefer-software"
					? Math.min(this.MAX_ENCODE_QUEUE, 32)
					: this.MAX_ENCODE_QUEUE;

			const encodeFrame = async (exportFrame: VideoFrame) => {
				while (this.encoder && this.encoder.encodeQueueSize >= maxEncodeQueue && !this.cancelled) {
					if (Date.now() - this.lastEncoderOutputAt > ENCODER_STALL_TIMEOUT_MS) {
						exportFrame.close();
						throw new Error(
							encoderPreference === "prefer-hardware"
								? "The hardware video encoder stopped responding. Retrying with a safer encoder."
								: "The video encoder stopped responding during export.",
						);
					}
					await new Promise((resolve) => setTimeout(resolve, 5));
				}
				if (this.encoder?.state === "configured") {
					this.encodeQueue++;
					this.encoder.encode(exportFrame, { keyFrame: frameIndex % 150 === 0 });
				}
				exportFrame.close();
				frameIndex++;
				this.reportProgress({
					currentFrame: frameIndex,
					totalFrames,
					percentage: Math.min(100, (frameIndex / totalFrames) * 100),
					estimatedTimeRemaining: 0,
					phase: "video",
				});
			};

			const encodeRenderedCanvas = async () => {
				if (!renderer) throw new Error("Composite renderer is not initialized");
				const canvas = renderer.getCanvas();
				const timestamp = frameIndex * frameDuration;
				let exportFrame: VideoFrame;
				if (platform === "linux") {
					const canvasCtx = canvas.getContext("2d")!;
					const imageData = canvasCtx.getImageData(0, 0, canvas.width, canvas.height);
					exportFrame = new VideoFrame(imageData.data.buffer, {
						format: "RGBA",
						codedWidth: canvas.width,
						codedHeight: canvas.height,
						timestamp,
						duration: frameDuration,
						colorSpace: {
							primaries: "bt709",
							transfer: "iec61966-2-1",
							matrix: "rgb",
							fullRange: true,
						},
					});
				} else {
					exportFrame = new VideoFrame(canvas, { timestamp, duration: frameDuration });
				}
				await encodeFrame(exportFrame);
			};

			const startWebcamDecode = (_trimRegions?: TrimRegion[], _speedRegions?: SpeedRegion[]) => {
				if (!webcamDecoder) return;
				stopWebcamDecode = false;
				webcamDecodeError = null;
				webcamFrameQueue = new TimestampedVideoFrameQueue();
				const queue = webcamFrameQueue;
				webcamDecodePromise = webcamDecoder
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
						throw webcamDecodeError;
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
					if (this.fatalEncoderError) throw this.fatalEncoderError;
					if (!usesCompositeRenderer) {
						while (frameIndex < targetFrameIndex && frameIndex < totalFrames) {
							const fillSource = lastDirectVideoFrame ?? videoFrame;
							await encodeFrame(
								new VideoFrame(fillSource, {
									timestamp: frameIndex * frameDuration,
									duration: frameDuration,
								}),
							);
						}
						lastDirectVideoFrame?.close();
						lastDirectVideoFrame = new VideoFrame(videoFrame, {
							timestamp: videoFrame.timestamp,
						});
						if (targetFrameIndex < frameIndex || frameIndex >= totalFrames) return;
						const exportFrame = new VideoFrame(videoFrame, {
							timestamp: frameIndex * frameDuration,
							duration: frameDuration,
						});
						await encodeFrame(exportFrame);
						return;
					}
					if (!renderer) throw new Error("Composite renderer is not initialized");
					while (frameIndex < targetFrameIndex && frameIndex < totalFrames) {
						if (!usesMediaTimeline)
							await renderer.renderBackgroundFrame(frameIndex * frameDuration);
						await encodeRenderedCanvas();
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
					if (this.cancelled) return;
					await renderer.renderFrame(
						videoFrame,
						timelineTimestampMs * 1000,
						webcamFrame,
						sourceTimestampMs * 1000,
					);
					await encodeRenderedCanvas();
				} finally {
					videoFrame.close();
					webcamFrame?.close();
				}
			};

			const videoStartedAt = performance.now();
			if (!this.config.videoTrackHidden) {
				if (usesMediaTimeline && mediaTiming) {
					let previousClipEndMs: number | null = null;
					for (const job of mediaDecodeJobs) {
						if (
							previousClipEndMs === null
								? job.clip.startMs > 0
								: job.clip.startMs > previousClipEndMs + SOURCE_COPY_EPSILON
						) {
							const clipStartFrame = frameIndexForTimelineTime(
								mediaTiming,
								job.clip.startMs,
								this.config.frameRate,
							);
							while (frameIndex < clipStartFrame && frameIndex < totalFrames) {
								if (!renderer) throw new Error("Composite renderer is not initialized");
								await renderer.renderBackgroundFrame(mediaBackgroundTimestampUs());
								await encodeRenderedCanvas();
							}
						}
						startWebcamDecode(job.trimRegions, job.speedRegions);
						try {
							await streamingDecoder.decodeAll(
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
						await streamingDecoder.decodeAll(
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
			while (
				!usesCompositeRenderer &&
				usesMediaTimeline &&
				lastDirectVideoFrame &&
				frameIndex < totalFrames &&
				!this.cancelled
			) {
				await encodeFrame(
					new VideoFrame(lastDirectVideoFrame, {
						timestamp: frameIndex * frameDuration,
						duration: frameDuration,
					}),
				);
			}
			while (
				usesCompositeRenderer &&
				usesMediaTimeline &&
				frameIndex < totalFrames &&
				!this.cancelled
			) {
				if (!renderer) throw new Error("Composite renderer is not initialized");
				const videoTimelineEndMs = Math.max(
					0,
					...(this.config.videoTrackClips ?? []).map((clip) => clip.endMs),
				);
				if (
					shouldRenderMediaBackground(
						Boolean(this.config.videoTrackHidden),
						timelineMapper.durationMs,
						videoTimelineEndMs,
					)
				) {
					await renderer.renderBackgroundFrame(mediaBackgroundTimestampUs());
				}
				await encodeRenderedCanvas();
			}
			stageDurationsMs.video = performance.now() - videoStartedAt;

			if (this.cancelled) {
				return { success: false, error: "Export cancelled" };
			}

			if (this.fatalEncoderError) {
				throw this.fatalEncoderError;
			}

			webcamDecoder?.cancel();

			if (this.encoder && this.encoder.state === "configured") {
				await this.withTimeout(
					this.encoder.flush(),
					ENCODER_FLUSH_TIMEOUT_MS,
					encoderPreference === "prefer-hardware"
						? "The hardware video encoder stopped responding while finalizing the export."
						: "The video encoder stopped responding while finalizing the export.",
				);
			}

			if (this.fatalEncoderError) {
				throw this.fatalEncoderError;
			}

			await Promise.all(this.muxingPromises);

			this.reportProgress({
				currentFrame: totalFrames,
				totalFrames,
				percentage: 100,
				estimatedTimeRemaining: 0,
				phase: "finalizing",
			});

			if (hasAudio && audioExportCodec && !this.cancelled) {
				const demuxer = streamingDecoder.getDemuxer();
				if (demuxer) {
					this.reportProgress({
						currentFrame: totalFrames,
						totalFrames,
						percentage: 100,
						estimatedTimeRemaining: 0,
						phase: "audio",
					});
					console.log("[VideoExporter] Processing audio track...");
					const audioStartedAt = performance.now();
					this.audioProcessor = new AudioProcessor();
					await this.audioProcessor.process(
						demuxer,
						muxer,
						this.config.videoUrl,
						this.config.trimRegions,
						this.config.speedRegions,
						videoInfo.duration,
						audioExportCodec,
						this.config.audioTrackClips,
						audioTimelineDurationSec,
					);
					stageDurationsMs.audio = performance.now() - audioStartedAt;
				}
			}

			const muxStartedAt = performance.now();
			const blob = await muxer.finalize();
			stageDurationsMs.mux = performance.now() - muxStartedAt;
			stageDurationsMs.total = performance.now() - exportStartedAt;
			return {
				success: true,
				blob,
				warnings: warnings.length > 0 ? warnings : undefined,
				path: exportPlan.path,
				diagnostics: {
					frameCount: frameIndex,
					frameRate: this.config.frameRate,
					stageDurationsMs,
				},
			};
		} finally {
			stopWebcamDecode = true;
			(webcamFrameQueue as TimestampedVideoFrameQueue | null)?.destroy();
			webcamDecoder?.cancel();
			(lastDirectVideoFrame as VideoFrame | null)?.close();
			if (webcamDecodePromise) {
				await webcamDecodePromise.catch(() => undefined);
			}
		}
	}

	private async tryPacketRemuxFastPath(
		videoInfo: {
			width: number;
			height: number;
			duration: number;
			frameRate: number;
			codec: string;
			hasAudio: boolean;
		},
		stageDurationsMs: Record<string, number>,
	): Promise<ExportResult | null> {
		if (!/^(avc1|avc3|h264)/i.test(videoInfo.codec)) return null;
		if (hasActiveSpeedRegions(this.config.speedRegions)) return null;
		if (
			this.config.audioTrackClips?.some(
				(clip) => clip.muted || clip.gain !== 1 || isFileBackedAudioClip(clip),
			)
		) {
			return null;
		}
		const clips = [...(this.config.videoTrackClips ?? [])].sort(
			(left, right) => left.startMs - right.startMs,
		);
		if (clips.length === 0) return null;
		const demuxer = this.streamingDecoder?.getDemuxer();
		if (!demuxer) return null;

		const frameToleranceUs = (1_000_000 / Math.max(1, videoInfo.frameRate)) * 0.55;
		try {
			for (const clip of clips) {
				const sourceEndMs = clip.sourceStartMs + clip.endMs - clip.startMs;
				const boundaries = [clip.sourceStartMs];
				if (sourceEndMs < videoInfo.duration * 1000 - frameToleranceUs / 1000) {
					boundaries.push(sourceEndMs);
				}
				for (const boundaryMs of boundaries) {
					const boundary = await demuxer.seek("video", boundaryMs / 1000);
					if (
						boundary.type !== "key" ||
						Math.abs(boundary.timestamp - boundaryMs * 1000) > frameToleranceUs
					) {
						return null;
					}
				}
			}

			const sourceConfig = await demuxer.getDecoderConfig("video");
			const expectsAudio = shouldExportAudio(videoInfo.hasAudio, this.config.audioTrackClips);
			const audioExportCodec = expectsAudio
				? await AudioProcessor.selectSupportedExportCodecForSource(demuxer)
				: null;
			if (expectsAudio && !audioExportCodec) {
				throw new Error("The source contains audio, but no safe audio export path is available.");
			}
			const muxer = new VideoMuxer(
				this.config,
				expectsAudio && Boolean(audioExportCodec),
				audioExportCodec?.muxerCodec,
			);
			this.muxer = muxer;
			await muxer.initialize();
			const remuxStartedAt = performance.now();
			let packetCount = 0;
			let firstPacket = true;
			for (const clip of clips) {
				const sourceStartUs = clip.sourceStartMs * 1000;
				const sourceEndUs = (clip.sourceStartMs + clip.endMs - clip.startMs) * 1000;
				const reader = demuxer
					.read("video", sourceStartUs / 1_000_000, sourceEndUs / 1_000_000)
					.getReader();
				try {
					while (!this.cancelled) {
						const { done, value: chunk } = await reader.read();
						if (done || !chunk) break;
						if (chunk.timestamp < sourceStartUs - frameToleranceUs) continue;
						if (chunk.timestamp >= sourceEndUs - frameToleranceUs) break;
						const data = new Uint8Array(chunk.byteLength);
						chunk.copyTo(data);
						const timestamp = clip.startMs * 1000 + (chunk.timestamp - sourceStartUs);
						const rewritten = new EncodedVideoChunk({
							type: chunk.type,
							timestamp: Math.max(0, Math.round(timestamp)),
							duration: chunk.duration ?? undefined,
							data,
						});
						await muxer.addVideoChunk(
							rewritten,
							firstPacket ? { decoderConfig: sourceConfig } : undefined,
						);
						firstPacket = false;
						packetCount++;
					}
				} finally {
					await reader.cancel().catch(() => undefined);
				}
			}
			if (packetCount === 0 || this.cancelled) return null;
			stageDurationsMs.video = performance.now() - remuxStartedAt;

			if (audioExportCodec) {
				this.reportProgress({
					currentFrame: packetCount,
					totalFrames: packetCount,
					percentage: 100,
					estimatedTimeRemaining: 0,
					phase: "audio",
				});
				const audioStartedAt = performance.now();
				this.audioProcessor = new AudioProcessor();
				const audioTimelineDurationSec = new TimelineMapper(
					this.config.videoTrackClips ?? [],
					this.config.audioTrackClips ?? [],
					this.config.speedRegions ?? [],
				).durationMs;
				await this.audioProcessor.process(
					demuxer,
					muxer,
					this.config.videoUrl,
					this.config.trimRegions,
					this.config.speedRegions,
					videoInfo.duration,
					audioExportCodec,
					this.config.audioTrackClips,
					audioTimelineDurationSec > 0 ? audioTimelineDurationSec / 1000 : videoInfo.duration,
				);
				stageDurationsMs.audio = performance.now() - audioStartedAt;
			}
			this.reportProgress({
				currentFrame: packetCount,
				totalFrames: packetCount,
				percentage: 100,
				estimatedTimeRemaining: 0,
				phase: "finalizing",
			});
			const muxStartedAt = performance.now();
			const blob = await muxer.finalize();
			stageDurationsMs.mux = performance.now() - muxStartedAt;
			console.info("[VideoExporter] using packet-remux path", { packetCount });
			return {
				success: true,
				blob,
				path: "packet-remux",
				diagnostics: { frameCount: packetCount, frameRate: videoInfo.frameRate },
			};
		} catch (error) {
			console.warn("[VideoExporter] packet-remux unavailable; using exact transcode", error);
			this.muxer = null;
			this.audioProcessor = null;
			return null;
		}
	}

	private async initializeEncoder(hardwareAcceleration: HardwareAcceleration): Promise<void> {
		this.encodeQueue = 0;
		this.muxingPromises = [];
		this.chunkCount = 0;
		this.lastEncoderOutputAt = Date.now();
		this.fatalEncoderError = null;
		let videoDescription: Uint8Array | undefined;

		this.encoder = new VideoEncoder({
			output: (chunk, meta) => {
				this.lastEncoderOutputAt = Date.now();

				if (meta?.decoderConfig?.description && !videoDescription) {
					const desc = meta.decoderConfig.description;
					if (desc instanceof ArrayBuffer || desc instanceof SharedArrayBuffer) {
						videoDescription = new Uint8Array(desc);
					} else if (ArrayBuffer.isView(desc)) {
						videoDescription = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
					}
					this.videoDescription = videoDescription;
				}

				if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
					this.videoColorSpace = meta.decoderConfig.colorSpace;
				}

				const isFirstChunk = this.chunkCount === 0;
				this.chunkCount++;

				const muxingPromise = (async () => {
					try {
						if (isFirstChunk && this.videoDescription) {
							const colorSpace = this.videoColorSpace || {
								primaries: "bt709",
								transfer: "iec61966-2-1",
								matrix: "rgb",
								fullRange: true,
							};

							const metadata: EncodedVideoChunkMetadata = {
								decoderConfig: {
									codec: this.config.codec || "avc1.640033",
									codedWidth: this.config.width,
									codedHeight: this.config.height,
									description: this.videoDescription,
									colorSpace,
								},
							};

							await this.muxer!.addVideoChunk(chunk, metadata);
						} else {
							await this.muxer!.addVideoChunk(chunk, meta);
						}
					} catch (error) {
						console.error("Muxing error:", error);
					}
				})();

				this.muxingPromises.push(muxingPromise);
				this.encodeQueue = Math.max(0, this.encodeQueue - 1);
			},
			error: (error) => {
				console.error("[VideoExporter] Encoder error:", error);
				this.fatalEncoderError =
					error instanceof Error ? error : new Error(`Video encoder error: ${String(error)}`);
				this.streamingDecoder?.cancel();
				this.webcamDecoder?.cancel();
			},
		});

		const encoderConfig: VideoEncoderConfig = {
			codec: this.config.codec || "avc1.640033",
			width: this.config.width,
			height: this.config.height,
			bitrate: this.config.bitrate,
			framerate: this.config.frameRate,
			latencyMode: this.config.exportQuality === "source" ? "quality" : "realtime",
			bitrateMode: "variable",
			hardwareAcceleration,
		};

		const support = await VideoEncoder.isConfigSupported(encoderConfig);
		if (!support.supported) {
			throw new Error(
				hardwareAcceleration === "prefer-hardware"
					? "Hardware video encoding is not supported on this system."
					: "Software video encoding is not supported on this system.",
			);
		}

		console.log(
			`[VideoExporter] Using ${hardwareAcceleration === "prefer-hardware" ? "hardware" : "software"} acceleration`,
		);
		this.encoder.configure(encoderConfig);
	}

	cancel(): void {
		this.cancelled = true;
		if (this.streamingDecoder) {
			this.streamingDecoder.cancel();
		}
		if (this.webcamDecoder) {
			this.webcamDecoder.cancel();
		}
		if (this.audioProcessor) {
			this.audioProcessor.cancel();
		}
		this.cleanup();
	}

	private cleanup(): void {
		if (this.encoder) {
			try {
				if (this.encoder.state === "configured") {
					this.encoder.close();
				}
			} catch (e) {
				console.warn("Error closing encoder:", e);
			}
			this.encoder = null;
		}

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

		this.audioProcessor = null;
		this.muxer = null;
		this.encodeQueue = 0;
		this.muxingPromises = [];
		this.chunkCount = 0;
		this.videoDescription = undefined;
		this.videoColorSpace = undefined;
		this.lastEncoderOutputAt = 0;
		this.fatalEncoderError = null;
	}

	private getEncoderPreferences(): HardwareAcceleration[] {
		if (typeof navigator !== "undefined" && /\bWindows\b/i.test(navigator.userAgent)) {
			return ["prefer-software", "prefer-hardware"];
		}
		return ["prefer-hardware", "prefer-software"];
	}

	private async trySourceCopyFastPath(videoInfo: {
		width: number;
		height: number;
		duration?: number;
	}) {
		const blockers = getSourceCopyFastPathBlockers(this.config, videoInfo);
		if (blockers.length > 0) {
			console.info("[VideoExporter] source-copy fast path disabled", {
				blockers,
				output: { width: this.config.width, height: this.config.height },
				source: videoInfo,
			});
			return null;
		}

		const sourceBlob = await this.loadSourceBlob();
		if (!sourceBlob || !isMp4Source(this.config.videoUrl, sourceBlob)) {
			console.info("[VideoExporter] source-copy fast path disabled", {
				blockers: ["source is not a readable MP4"],
				source: videoInfo,
			});
			return null;
		}

		if (this.cancelled) {
			return { success: false, error: "Export cancelled" };
		}

		this.reportProgress({
			currentFrame: 1,
			totalFrames: 1,
			percentage: 100,
			estimatedTimeRemaining: 0,
			phase: "finalizing",
		});
		console.info("[VideoExporter] using source-copy fast path", {
			source: videoInfo,
			bytes: sourceBlob.size,
		});

		return {
			success: true,
			blob: sourceBlob.type ? sourceBlob : new Blob([sourceBlob], { type: "video/mp4" }),
		} satisfies ExportResult;
	}

	private async loadSourceBlob() {
		const videoUrl = this.config.videoUrl;
		const isRemoteUrl = /^(https?:|blob:|data:)/i.test(videoUrl);

		if (!isRemoteUrl && window.electronAPI?.readBinaryFile) {
			const result = await window.electronAPI.readBinaryFile(videoUrl);
			if (!result.success || !result.data) {
				return null;
			}

			const type = videoUrl.toLowerCase().split(/[?#]/, 1)[0].endsWith(".mp4") ? "video/mp4" : "";
			return new Blob([result.data], type ? { type } : undefined);
		}

		const response = await fetch(videoUrl);
		if (!response.ok) {
			return null;
		}

		return response.blob();
	}

	private reportProgress(progress: ExportProgress): void {
		this.config.onProgress?.(progress);
	}

	private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
			promise.then(
				(value) => {
					window.clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					window.clearTimeout(timer);
					reject(error);
				},
			);
		});
	}
}
