import type { ZoomFocus, ZoomTargetBounds } from "../types";
import type { AutoZoomTriggerType } from "./semanticZoomSuggestions";

export interface TargetFramePair {
	width: number;
	height: number;
	before: Uint8ClampedArray;
	after: Uint8ClampedArray;
	focus: ZoomFocus;
	triggerType: AutoZoomTriggerType;
}

export interface TargetAnalysisResult {
	focus: ZoomFocus;
	targetBounds?: ZoomTargetBounds;
	scale: number;
	confidence: number;
	visualChange: number;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function fallbackScaleForAction(type: AutoZoomTriggerType) {
	if (type === "click") return 2.05;
	if (type === "drag") return 1.55;
	return 1.4;
}

export function scaleForTargetBounds(bounds: ZoomTargetBounds) {
	const byWidth = 0.42 / Math.max(0.02, bounds.width);
	const byHeight = 0.3 / Math.max(0.02, bounds.height);
	return clamp(Math.min(byWidth, byHeight), 1.25, 2.6);
}

function luminance(data: Uint8ClampedArray, pixelIndex: number) {
	const offset = pixelIndex * 4;
	return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

/** Pure worker-safe target finder based on local frame difference and edge density. */
export function analyzeTargetFramePair(pair: TargetFramePair): TargetAnalysisResult {
	const { width, height, before, after, focus, triggerType } = pair;
	if (width < 2 || height < 2 || before.length !== after.length) {
		return {
			focus,
			scale: fallbackScaleForAction(triggerType),
			confidence: 0,
			visualChange: 0,
		};
	}

	const centerX = clamp(Math.round(focus.cx * width), 0, width - 1);
	const centerY = clamp(Math.round(focus.cy * height), 0, height - 1);
	const radiusX = Math.max(20, Math.round(width * 0.22));
	const radiusY = Math.max(20, Math.round(height * 0.2));
	const minX = Math.max(1, centerX - radiusX);
	const maxX = Math.min(width - 2, centerX + radiusX);
	const minY = Math.max(1, centerY - radiusY);
	const maxY = Math.min(height - 2, centerY + radiusY);

	let sum = 0;
	let squared = 0;
	let sampleCount = 0;
	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			const index = y * width + x;
			const difference = Math.abs(luminance(after, index) - luminance(before, index));
			sum += difference;
			squared += difference * difference;
			sampleCount += 1;
		}
	}
	const mean = sum / Math.max(1, sampleCount);
	const deviation = Math.sqrt(Math.max(0, squared / Math.max(1, sampleCount) - mean * mean));
	const threshold = Math.max(14, mean + deviation * 1.15);

	let changed = 0;
	let boundsMinX = centerX;
	let boundsMaxX = centerX;
	let boundsMinY = centerY;
	let boundsMaxY = centerY;
	let weightedX = 0;
	let weightedY = 0;
	let weight = 0;
	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			const index = y * width + x;
			const difference = Math.abs(luminance(after, index) - luminance(before, index));
			const horizontalEdge = Math.abs(luminance(after, index + 1) - luminance(after, index - 1));
			const verticalEdge = Math.abs(
				luminance(after, index + width) - luminance(after, index - width),
			);
			const cursorDistance = Math.hypot((x - centerX) / radiusX, (y - centerY) / radiusY);
			if (difference < threshold || cursorDistance > 1.15) continue;
			const pixelWeight = difference * (1 + Math.min(1, (horizontalEdge + verticalEdge) / 80));
			changed += 1;
			weightedX += x * pixelWeight;
			weightedY += y * pixelWeight;
			weight += pixelWeight;
			boundsMinX = Math.min(boundsMinX, x);
			boundsMaxX = Math.max(boundsMaxX, x);
			boundsMinY = Math.min(boundsMinY, y);
			boundsMaxY = Math.max(boundsMaxY, y);
		}
	}

	const roiArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
	const visualChange = changed / roiArea;
	if (changed < 8 || weight <= 0) {
		return {
			focus,
			scale: fallbackScaleForAction(triggerType),
			confidence: 0,
			visualChange,
		};
	}

	// Pad the changed area so text/caret changes resolve to their surrounding control.
	const paddingX = Math.max(8, Math.round(width * 0.018));
	const paddingY = Math.max(6, Math.round(height * 0.014));
	const targetBounds = {
		x: clamp((boundsMinX - paddingX) / width, 0, 1),
		y: clamp((boundsMinY - paddingY) / height, 0, 1),
		width: clamp((boundsMaxX - boundsMinX + paddingX * 2) / width, 0.02, 1),
		height: clamp((boundsMaxY - boundsMinY + paddingY * 2) / height, 0.02, 1),
	};
	const analyzedFocus = {
		cx: clamp(weightedX / weight / width, targetBounds.x, targetBounds.x + targetBounds.width),
		cy: clamp(weightedY / weight / height, targetBounds.y, targetBounds.y + targetBounds.height),
	};
	const confidence = clamp(visualChange * 8 + Math.min(0.35, deviation / 100), 0, 0.94);

	return {
		focus: analyzedFocus,
		targetBounds,
		scale: scaleForTargetBounds(targetBounds),
		confidence,
		visualChange,
	};
}
