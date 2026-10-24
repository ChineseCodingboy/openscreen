import type {
	SemanticCursorAnchor,
	SemanticCursorPathMetadata,
} from "@/lib/cursor/semanticCursorPath";
import type { ZoomFocus } from "../types";

export const AUTO_ZOOM_PRE_ROLL_MS = 420;
export const AUTO_ZOOM_ARRIVAL_AFTER_TRIGGER_MS = 80;
export const AUTO_ZOOM_IN_DURATION_MS = AUTO_ZOOM_PRE_ROLL_MS + AUTO_ZOOM_ARRIVAL_AFTER_TRIGGER_MS;
export const AUTO_ZOOM_OUT_DURATION_MS = 620;
export const AUTO_ZOOM_MAX_TOTAL_DURATION_MS = 3200;
export const AUTO_ZOOM_MIN_SPACING_MS = 4000;
export const AUTO_ZOOM_MAX_PER_MINUTE = 3;
export const AUTO_ZOOM_MERGE_WINDOW_MS = 1200;

export type AutoZoomTriggerType = "click" | "drag" | "dwell";

export interface SemanticZoomSuggestion {
	span: { start: number; end: number };
	focus: ZoomFocus;
	zoomInDurationMs: number;
	zoomOutDurationMs: number;
	triggerTimeMs: number;
	triggerType: AutoZoomTriggerType;
	confidence: number;
	score: number;
	dragEndFocus?: ZoomFocus;
}

interface Candidate {
	triggerTimeMs: number;
	focus: ZoomFocus;
	type: AutoZoomTriggerType;
	confidence: number;
	score: number;
	holdMs: number;
	runIndex: number;
	dragEndFocus?: ZoomFocus;
}

function clamp01(value: number) {
	return Math.min(1, Math.max(0, value));
}

function distance(a: ZoomFocus, b: ZoomFocus) {
	return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

function overlaps(span: { start: number; end: number }, other: { startMs: number; endMs: number }) {
	return span.end > other.startMs && span.start < other.endMs;
}

function fallbackHoldMs(type: AutoZoomTriggerType, mergedCount = 1) {
	const base = type === "drag" ? 1450 : type === "click" ? 1100 : 900;
	return Math.min(1800, base + Math.max(0, mergedCount - 1) * 180);
}

function fallbackConfidence(type: AutoZoomTriggerType) {
	return type === "click" ? 0.96 : type === "drag" ? 0.9 : 0.46;
}

function fallbackScore(type: AutoZoomTriggerType, dwellDurationMs = 0) {
	if (type === "click") return 100;
	if (type === "drag") return 92;
	return 24 + Math.min(18, dwellDurationMs / 180);
}

function candidateFromAnchor(anchor: SemanticCursorAnchor): Candidate {
	const dwellDurationMs = Math.max(
		0,
		(anchor.dwellEndTimeMs ?? anchor.timeMs) - (anchor.dwellStartTimeMs ?? anchor.timeMs),
	);
	const type: AutoZoomTriggerType = anchor.kind === "click" ? "click" : "dwell";
	return {
		triggerTimeMs: anchor.timeMs,
		focus: { cx: anchor.cx, cy: anchor.cy },
		type,
		confidence: fallbackConfidence(type),
		score: fallbackScore(type, dwellDurationMs),
		holdMs: fallbackHoldMs(type),
		runIndex: anchor.runIndex,
	};
}

function buildCandidates(anchors: SemanticCursorAnchor[]) {
	const sorted = [...anchors].sort((a, b) => a.timeMs - b.timeMs);
	const consumedMouseUps = new Set<string>();
	const candidates: Candidate[] = [];

	for (const anchor of sorted) {
		if (anchor.kind !== "click") continue;
		const mouseUp = sorted.find(
			(candidate) =>
				candidate.kind === "mouseup" &&
				candidate.runIndex === anchor.runIndex &&
				candidate.timeMs >= anchor.timeMs &&
				candidate.timeMs - anchor.timeMs <= 5000 &&
				!consumedMouseUps.has(candidate.id),
		);
		if (mouseUp && distance(anchor, mouseUp) >= 0.025) {
			consumedMouseUps.add(mouseUp.id);
			candidates.push({
				triggerTimeMs: anchor.timeMs,
				focus: { cx: anchor.cx, cy: anchor.cy },
				dragEndFocus: { cx: mouseUp.cx, cy: mouseUp.cy },
				type: "drag",
				confidence: fallbackConfidence("drag"),
				score: fallbackScore("drag") + Math.min(6, distance(anchor, mouseUp) * 10),
				holdMs: Math.min(1800, Math.max(1100, mouseUp.timeMs - anchor.timeMs + 700)),
				runIndex: anchor.runIndex,
			});
			continue;
		}
		candidates.push(candidateFromAnchor(anchor));
	}

	for (const anchor of sorted) {
		if (anchor.kind === "dwell") candidates.push(candidateFromAnchor(anchor));
	}

	return candidates.sort((a, b) => a.triggerTimeMs - b.triggerTimeMs);
}

function mergeSameTarget(candidates: Candidate[]) {
	const merged: Array<Candidate & { mergedCount: number }> = [];
	for (const candidate of candidates) {
		const previous = merged[merged.length - 1];
		if (
			previous &&
			candidate.runIndex === previous.runIndex &&
			candidate.triggerTimeMs - previous.triggerTimeMs <= AUTO_ZOOM_MERGE_WINDOW_MS &&
			distance(candidate.focus, previous.focus) <= 0.045
		) {
			const mergedCount = previous.mergedCount + 1;
			const stronger = candidate.score > previous.score ? candidate : previous;
			merged[merged.length - 1] = {
				...stronger,
				triggerTimeMs: candidate.triggerTimeMs,
				focus: {
					cx: (previous.focus.cx * previous.mergedCount + candidate.focus.cx) / mergedCount,
					cy: (previous.focus.cy * previous.mergedCount + candidate.focus.cy) / mergedCount,
				},
				score: Math.max(previous.score, candidate.score) + Math.min(12, mergedCount * 2),
				holdMs: fallbackHoldMs(stronger.type, mergedCount),
				mergedCount,
			};
			continue;
		}
		merged.push({ ...candidate, mergedCount: 1 });
	}
	return merged;
}

function violatesRollingMinuteLimit(times: number[], candidateTime: number) {
	const sorted = [...times, candidateTime].sort((a, b) => a - b);
	for (let index = 0; index + AUTO_ZOOM_MAX_PER_MINUTE < sorted.length; index += 1) {
		if (sorted[index + AUTO_ZOOM_MAX_PER_MINUTE] - sorted[index] < 60_000) return true;
	}
	return false;
}

function candidateToSuggestion(
	candidate: Candidate,
	totalMs: number,
): SemanticZoomSuggestion | null {
	const triggerTimeMs = Math.round(Math.min(totalMs, Math.max(0, candidate.triggerTimeMs)));
	const start = Math.max(0, triggerTimeMs - AUTO_ZOOM_PRE_ROLL_MS);
	const zoomInDurationMs = Math.max(1, triggerTimeMs + AUTO_ZOOM_ARRIVAL_AFTER_TRIGGER_MS - start);
	const desiredEnd = start + zoomInDurationMs + candidate.holdMs;
	const maximumEnd = start + AUTO_ZOOM_MAX_TOTAL_DURATION_MS - AUTO_ZOOM_OUT_DURATION_MS;
	const end = Math.min(totalMs, desiredEnd, maximumEnd);
	if (end <= start) return null;
	return {
		span: { start: Math.round(start), end: Math.round(end) },
		focus: { cx: clamp01(candidate.focus.cx), cy: clamp01(candidate.focus.cy) },
		zoomInDurationMs: Math.round(zoomInDurationMs),
		zoomOutDurationMs: Math.min(AUTO_ZOOM_OUT_DURATION_MS, Math.max(1, totalMs - end)),
		triggerTimeMs,
		triggerType: candidate.type,
		confidence: clamp01(candidate.confidence),
		score: candidate.score,
		...(candidate.dragEndFocus ? { dragEndFocus: candidate.dragEndFocus } : {}),
	};
}

/**
 * Builds a sparse professional camera plan. Candidates are ranked globally instead of consumed
 * chronologically, then constrained by a four-second separation and a rolling three-per-minute
 * budget. This keeps long recordings distributed while still making real interactions win.
 */
export function buildSemanticZoomSuggestions(options: {
	path: SemanticCursorPathMetadata;
	totalMs: number;
	existingRegions: { startMs: number; endMs: number }[];
}): SemanticZoomSuggestion[] {
	const totalMs = Math.max(0, Math.round(options.totalMs));
	if (options.path.mode !== "semantic" || totalMs <= 0) return [];

	const ranked = mergeSameTarget(buildCandidates(options.path.anchors)).sort(
		(a, b) => b.score - a.score || a.triggerTimeMs - b.triggerTimeMs,
	);
	const acceptedTimes: number[] = [];
	const accepted: SemanticZoomSuggestion[] = [];
	const reserved = [...options.existingRegions];

	for (const candidate of ranked) {
		if (
			acceptedTimes.some(
				(time) => Math.abs(time - candidate.triggerTimeMs) < AUTO_ZOOM_MIN_SPACING_MS,
			)
		) {
			continue;
		}
		if (violatesRollingMinuteLimit(acceptedTimes, candidate.triggerTimeMs)) continue;
		const suggestion = candidateToSuggestion(candidate, totalMs);
		if (!suggestion || reserved.some((region) => overlaps(suggestion.span, region))) continue;
		accepted.push(suggestion);
		acceptedTimes.push(suggestion.triggerTimeMs);
		reserved.push({ startMs: suggestion.span.start, endMs: suggestion.span.end });
	}

	return accepted.sort((a, b) => a.triggerTimeMs - b.triggerTimeMs);
}
