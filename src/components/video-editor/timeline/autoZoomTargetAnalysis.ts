import type { ZoomFocus, ZoomTargetBounds } from "../types";
import {
	analyzeTargetFramePair,
	fallbackScaleForAction,
	type TargetAnalysisResult,
	type TargetFramePair,
} from "./autoZoomTargetAnalysisCore";
import type { AutoZoomTriggerType } from "./semanticZoomSuggestions";

export interface AutoZoomTargetRequest {
	triggerTimeMs: number;
	triggerType: AutoZoomTriggerType;
	focus: ZoomFocus;
}

export interface AnalyzedAutoZoomTarget extends AutoZoomTargetRequest {
	focus: ZoomFocus;
	targetBounds?: ZoomTargetBounds;
	scale: number;
	confidence: number;
	visualChange: number;
}

const analysisCache = new Map<string, AnalyzedAutoZoomTarget>();

function abortError() {
	return new DOMException("Auto zoom analysis cancelled", "AbortError");
}

function waitForEvent(target: EventTarget, eventName: string, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			target.removeEventListener(eventName, onEvent);
			signal.removeEventListener("abort", onAbort);
		};
		const onEvent = () => {
			cleanup();
			resolve();
		};
		const onAbort = () => {
			cleanup();
			reject(abortError());
		};
		target.addEventListener(eventName, onEvent, { once: true });
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

async function seekVideo(video: HTMLVideoElement, timeSec: number, signal: AbortSignal) {
	if (signal.aborted) throw abortError();
	const target = Math.max(0, Math.min(Math.max(0, video.duration - 0.001), timeSec));
	if (
		Math.abs(video.currentTime - target) < 0.002 &&
		video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
	) {
		return;
	}
	const done = waitForEvent(video, "seeked", signal);
	video.currentTime = target;
	await done;
}

function frameFromCanvas(
	video: HTMLVideoElement,
	canvas: HTMLCanvasElement,
	context: CanvasRenderingContext2D,
) {
	context.drawImage(video, 0, 0, canvas.width, canvas.height);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function createWorkerAnalyzer() {
	try {
		const worker = new Worker(new URL("./autoZoomTarget.worker.ts", import.meta.url), {
			type: "module",
		});
		let nextId = 1;
		const pending = new Map<
			number,
			{ resolve: (result: TargetAnalysisResult) => void; reject: (error: unknown) => void }
		>();
		worker.onmessage = (event: MessageEvent<{ id: number; result: TargetAnalysisResult }>) => {
			const task = pending.get(event.data.id);
			if (!task) return;
			pending.delete(event.data.id);
			task.resolve(event.data.result);
		};
		worker.onerror = (event) => {
			for (const task of pending.values()) task.reject(event.error ?? new Error(event.message));
			pending.clear();
		};
		return {
			analyze(pair: TargetFramePair) {
				const id = nextId++;
				return new Promise<TargetAnalysisResult>((resolve, reject) => {
					pending.set(id, { resolve, reject });
					worker.postMessage({ id, ...pair });
				});
			},
			dispose() {
				worker.terminate();
			},
		};
	} catch {
		return null;
	}
}

function fallbackResult(request: AutoZoomTargetRequest): AnalyzedAutoZoomTarget {
	return {
		...request,
		scale: fallbackScaleForAction(request.triggerType),
		confidence: request.triggerType === "dwell" ? 0.32 : 0.72,
		visualChange: 0,
	};
}

/** Extracts small local before/after frames. Video pixels and analysis never leave this process. */
export async function analyzeAutoZoomTargets(options: {
	videoUrl: string;
	requests: AutoZoomTargetRequest[];
	signal: AbortSignal;
	onProgress?: (completed: number, total: number) => void;
}): Promise<AnalyzedAutoZoomTarget[]> {
	const { videoUrl, requests, signal, onProgress } = options;
	if (requests.length === 0) return [];
	if (typeof document === "undefined") return requests.map(fallbackResult);

	const video = document.createElement("video");
	video.preload = "auto";
	video.muted = true;
	video.playsInline = true;
	video.src = videoUrl;
	try {
		if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
			video.load();
			await waitForEvent(video, "loadedmetadata", signal);
		}
		const width = Math.max(2, Math.min(640, video.videoWidth));
		const height = Math.max(2, Math.round((width * video.videoHeight) / video.videoWidth));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) return requests.map(fallbackResult);
		const workerAnalyzer = createWorkerAnalyzer();
		const results: AnalyzedAutoZoomTarget[] = [];

		try {
			for (let index = 0; index < requests.length; index += 1) {
				if (signal.aborted) throw abortError();
				const request = requests[index];
				const cacheKey = `${videoUrl}|${Math.round(request.triggerTimeMs / 20)}|${request.focus.cx.toFixed(3)}|${request.focus.cy.toFixed(3)}|${request.triggerType}`;
				const cached = analysisCache.get(cacheKey);
				if (cached) {
					results.push(cached);
					onProgress?.(index + 1, requests.length);
					continue;
				}
				const triggerSec = request.triggerTimeMs / 1000;
				await seekVideo(video, triggerSec - 0.16, signal);
				const before = frameFromCanvas(video, canvas, context);
				await seekVideo(video, triggerSec + 0.18, signal);
				const after = frameFromCanvas(video, canvas, context);
				const pair = {
					width,
					height,
					before,
					after,
					focus: request.focus,
					triggerType: request.triggerType,
				};
				const analysis = workerAnalyzer
					? await workerAnalyzer.analyze(pair)
					: analyzeTargetFramePair(pair);
				const result = { ...request, ...analysis };
				analysisCache.set(cacheKey, result);
				results.push(result);
				onProgress?.(index + 1, requests.length);
			}
		} finally {
			workerAnalyzer?.dispose();
		}
		return results;
	} catch (error) {
		if (signal.aborted) throw abortError();
		console.warn("[auto-zoom] local target analysis unavailable; using action presets", error);
		return requests.map(fallbackResult);
	} finally {
		video.removeAttribute("src");
		video.load();
	}
}
