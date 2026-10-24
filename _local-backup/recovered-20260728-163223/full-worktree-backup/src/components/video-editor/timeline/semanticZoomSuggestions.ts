import type {
	SemanticCursorPathMetadata,
	SemanticCursorTransition,
} from "@/lib/cursor/semanticCursorPath";
import type { ZoomFocus } from "../types";

const AUTO_ZOOM_HOLD_AFTER_ARRIVAL_MS = 900;
const AUTO_ZOOM_DWELL_TAIL_MS = 450;
const MIN_FOCUS_DISPLACEMENT = 0.035;

export interface SemanticZoomSuggestion {
	span: { start: number; end: number };
	focus: ZoomFocus;
	zoomInDurationMs: number;
}

function overlaps(span: { start: number; end: number }, other: { startMs: number; endMs: number }) {
	return span.end > other.startMs && span.start < other.endMs;
}

function isKeyTransition(transition: SemanticCursorTransition) {
	return (
		transition.fromAnchorId !== null &&
		transition.toAnchorId !== null &&
		Math.hypot(transition.to.cx - transition.from.cx, transition.to.cy - transition.from.cy) >=
			MIN_FOCUS_DISPLACEMENT
	);
}

/**
 * Converts semantic cursor A→B moves into zoom regions whose zoom-in window is exactly the
 * cursor transition. Adjacent moves remain edge-to-edge so the existing connected-zoom logic
 * can keep the camera engaged without producing overlapping timeline items.
 */
export function buildSemanticZoomSuggestions(options: {
	path: SemanticCursorPathMetadata;
	totalMs: number;
	existingRegions: { startMs: number; endMs: number }[];
}): SemanticZoomSuggestion[] {
	const { path, existingRegions } = options;
	const totalMs = Math.max(0, Math.round(options.totalMs));
	if (path.mode !== "semantic" || totalMs <= 0) return [];

	const targetAnchors = new Map(path.anchors.map((anchor) => [anchor.id, anchor]));
	const transitions = path.transitions.filter(isKeyTransition).sort((a, b) => {
		return a.startTimeMs - b.startTimeMs;
	});
	const reserved = existingRegions.map((region) => ({ ...region }));
	const suggestions: SemanticZoomSuggestion[] = [];

	for (let index = 0; index < transitions.length; index += 1) {
		const transition = transitions[index];
		const start = Math.max(0, Math.min(totalMs, Math.round(transition.startTimeMs)));
		const arrival = Math.max(start + 1, Math.min(totalMs, Math.round(transition.endTimeMs)));
		if (arrival > totalMs || start >= totalMs) continue;

		const target = transition.toAnchorId ? targetAnchors.get(transition.toAnchorId) : undefined;
		const dwellEnd = target?.dwellEndTimeMs ?? arrival;
		let end = Math.min(
			totalMs,
			Math.max(arrival + AUTO_ZOOM_HOLD_AFTER_ARRIVAL_MS, dwellEnd + AUTO_ZOOM_DWELL_TAIL_MS),
		);
		const nextTransition = transitions[index + 1];
		if (nextTransition?.runIndex === transition.runIndex && nextTransition.startTimeMs < end) {
			end = Math.max(arrival, Math.round(nextTransition.startTimeMs));
		}
		if (end <= start) continue;

		const span = { start, end };
		if (reserved.some((region) => overlaps(span, region))) continue;
		reserved.push({ startMs: start, endMs: end });
		suggestions.push({
			span,
			focus: { ...transition.to },
			zoomInDurationMs: Math.max(1, arrival - start),
		});
	}

	return suggestions;
}
