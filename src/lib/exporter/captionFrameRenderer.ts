import type { AnnotationRegion, CropRegion } from "@/components/video-editor/types";
import { computeCompositeLayout } from "@/lib/compositeLayout";
import { BackgroundLoadError, classifyWallpaper, resolveImageWallpaperUrl } from "@/lib/wallpaper";
import { renderAnnotations } from "./annotationRenderer";
import {
	getLinearGradientPoints,
	getRadialGradientShape,
	parseCssGradient,
	resolveLinearGradientAngle,
} from "./gradientParser";

interface CaptionFrameRendererConfig {
	width: number;
	height: number;
	videoWidth: number;
	videoHeight: number;
	wallpaper: string;
	backgroundMode?: "wallpaper" | "none";
	cropRegion: CropRegion;
	padding?: number;
	borderRadius?: number;
	showShadow: boolean;
	shadowIntensity: number;
	showBlur: boolean;
	annotationRegions: AnnotationRegion[];
	previewWidth?: number;
	previewHeight?: number;
}

/**
 * Canvas2D-only renderer for the common "static layout + generated captions" export.
 * It avoids starting Pixi/WebGL when no animated camera, cursor, webcam, or blur annotation exists.
 */
export class CaptionFrameRenderer {
	private readonly canvas = document.createElement("canvas");
	private readonly foregroundCanvas = document.createElement("canvas");
	private readonly backgroundCanvas = document.createElement("canvas");
	private readonly ctx: CanvasRenderingContext2D;
	private readonly foregroundCtx: CanvasRenderingContext2D;
	private readonly backgroundCtx: CanvasRenderingContext2D;

	constructor(private readonly config: CaptionFrameRendererConfig) {
		for (const canvas of [this.canvas, this.foregroundCanvas, this.backgroundCanvas]) {
			canvas.width = config.width;
			canvas.height = config.height;
		}
		const ctx = this.canvas.getContext("2d", { alpha: false, desynchronized: true });
		const foregroundCtx = this.foregroundCanvas.getContext("2d");
		const backgroundCtx = this.backgroundCanvas.getContext("2d");
		if (!ctx || !foregroundCtx || !backgroundCtx) {
			throw new Error("Unable to initialize the fast caption renderer.");
		}
		this.ctx = ctx;
		this.foregroundCtx = foregroundCtx;
		this.backgroundCtx = backgroundCtx;
	}

	async initialize() {
		if (this.config.backgroundMode === "none") return;
		const classified = classifyWallpaper(this.config.wallpaper);
		if (classified.kind === "color") {
			this.backgroundCtx.fillStyle = classified.value;
			this.backgroundCtx.fillRect(0, 0, this.config.width, this.config.height);
			return;
		}
		if (classified.kind === "gradient") {
			const parsed = parseCssGradient(classified.value);
			if (!parsed) throw new BackgroundLoadError(classified.value);
			const gradient =
				parsed.type === "linear"
					? (() => {
							const points = getLinearGradientPoints(
								resolveLinearGradientAngle(parsed.descriptor),
								this.config.width,
								this.config.height,
							);
							return this.backgroundCtx.createLinearGradient(
								points.x0,
								points.y0,
								points.x1,
								points.y1,
							);
						})()
					: (() => {
							const shape = getRadialGradientShape(
								parsed.descriptor,
								this.config.width,
								this.config.height,
							);
							return this.backgroundCtx.createRadialGradient(
								shape.cx,
								shape.cy,
								0,
								shape.cx,
								shape.cy,
								shape.radius,
							);
						})();
			for (const stop of parsed.stops) gradient.addColorStop(stop.offset, stop.color);
			this.backgroundCtx.fillStyle = gradient;
			this.backgroundCtx.fillRect(0, 0, this.config.width, this.config.height);
			return;
		}

		const imageUrl = resolveImageWallpaperUrl(classified.path);
		const image = new Image();
		if (imageUrl.startsWith("http") && !imageUrl.startsWith(window.location.origin)) {
			image.crossOrigin = "anonymous";
		}
		try {
			await new Promise<void>((resolve, reject) => {
				image.onload = () => resolve();
				image.onerror = reject;
				image.src = imageUrl;
			});
		} catch (error) {
			throw new BackgroundLoadError(imageUrl, error);
		}
		const imageAspect = image.width / image.height;
		const canvasAspect = this.config.width / this.config.height;
		const drawHeight =
			imageAspect > canvasAspect ? this.config.height : this.config.width / imageAspect;
		const drawWidth = imageAspect > canvasAspect ? drawHeight * imageAspect : this.config.width;
		this.backgroundCtx.drawImage(
			image,
			(this.config.width - drawWidth) / 2,
			(this.config.height - drawHeight) / 2,
			drawWidth,
			drawHeight,
		);
	}

	async renderFrame(sourceFrame: VideoFrame, timelineTimestampMs: number) {
		const { width, height, cropRegion } = this.config;
		this.ctx.clearRect(0, 0, width, height);
		if (this.config.backgroundMode !== "none") {
			this.ctx.save();
			if (this.config.showBlur) this.ctx.filter = "blur(6px)";
			this.ctx.drawImage(this.backgroundCanvas, 0, 0, width, height);
			this.ctx.restore();
		}

		const croppedWidth = this.config.videoWidth * cropRegion.width;
		const croppedHeight = this.config.videoHeight * cropRegion.height;
		const paddingScale = 1 - ((this.config.padding ?? 0) / 100) * 0.4;
		const layout = computeCompositeLayout({
			canvasSize: { width, height },
			maxContentSize: { width: width * paddingScale, height: height * paddingScale },
			screenSize: { width: croppedWidth, height: croppedHeight },
			webcamSize: null,
		});
		if (!layout) throw new Error("Unable to calculate the fast caption layout.");

		const rect = layout.screenRect;
		const scaleFactor = Math.min(
			width / (this.config.previewWidth ?? width),
			height / (this.config.previewHeight ?? height),
		);
		const radius = Math.max(0, (this.config.borderRadius ?? 0) * scaleFactor);
		this.foregroundCtx.clearRect(0, 0, width, height);
		this.foregroundCtx.save();
		this.foregroundCtx.beginPath();
		this.foregroundCtx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
		this.foregroundCtx.clip();
		this.foregroundCtx.drawImage(
			sourceFrame,
			cropRegion.x * this.config.videoWidth,
			cropRegion.y * this.config.videoHeight,
			croppedWidth,
			croppedHeight,
			rect.x,
			rect.y,
			rect.width,
			rect.height,
		);
		this.foregroundCtx.restore();

		this.ctx.save();
		if (this.config.showShadow && this.config.shadowIntensity > 0) {
			const intensity = this.config.shadowIntensity;
			this.ctx.filter = `drop-shadow(0 ${12 * intensity}px ${48 * intensity}px rgba(0,0,0,${0.7 * intensity})) drop-shadow(0 ${4 * intensity}px ${16 * intensity}px rgba(0,0,0,${0.5 * intensity})) drop-shadow(0 ${2 * intensity}px ${8 * intensity}px rgba(0,0,0,${0.3 * intensity}))`;
		}
		this.ctx.drawImage(this.foregroundCanvas, 0, 0, width, height);
		this.ctx.restore();

		await renderAnnotations(
			this.ctx,
			this.config.annotationRegions,
			width,
			height,
			timelineTimestampMs,
			(width / (this.config.previewWidth ?? width) +
				height / (this.config.previewHeight ?? height)) /
				2,
		);
	}

	getCanvas() {
		return this.canvas;
	}
}
