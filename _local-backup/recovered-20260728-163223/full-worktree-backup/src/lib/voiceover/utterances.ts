import type { AnnotationRegion, VoiceoverUtterance } from "@/components/video-editor/types";
import type { CaptionSegment } from "@/lib/captioning";
import { joinTextSegments } from "@/lib/cjkText";
import { VOICEOVER_MERGE_GAP_MS } from "./constants";

export const joinUtteranceText = joinTextSegments;

/** Merges time-adjacent caption spans into sentence-sized utterances. */
export function mergeIntoUtterances(
	spans: VoiceoverUtterance[],
	mergeGapMs = VOICEOVER_MERGE_GAP_MS,
): VoiceoverUtterance[] {
	const sorted = spans
		.filter((span) => span.text.trim().length > 0 && span.endMs > span.startMs)
		.sort((left, right) => left.startMs - right.startMs);

	const merged: VoiceoverUtterance[] = [];
	for (const span of sorted) {
		const previous = merged.at(-1);
		if (previous && span.startMs - previous.endMs < mergeGapMs) {
			previous.text = joinUtteranceText(previous.text, span.text);
			previous.endMs = Math.max(previous.endMs, span.endMs);
			continue;
		}
		merged.push({ startMs: span.startMs, endMs: span.endMs, text: span.text.trim() });
	}
	return merged;
}

/**
 * Builds the spoken script from the auto-caption regions currently on the timeline,
 * so any text the user edited into the captions is exactly what gets voiced.
 */
export function buildUtterancesFromAnnotations(
	regions: AnnotationRegion[],
	mergeGapMs = VOICEOVER_MERGE_GAP_MS,
): VoiceoverUtterance[] {
	const spans = regions
		.filter((region) => region.annotationSource === "auto-caption" && region.type === "text")
		.map((region) => ({
			startMs: region.startMs,
			endMs: region.endMs,
			text: (region.textContent ?? region.content ?? "").trim(),
		}));
	return mergeIntoUtterances(spans, mergeGapMs);
}

/** Fallback source when no captions exist: raw transcription segments (seconds-based). */
export function buildUtterancesFromCaptionSegments(
	segments: CaptionSegment[],
	mergeGapMs = VOICEOVER_MERGE_GAP_MS,
): VoiceoverUtterance[] {
	const spans = segments.map((segment) => ({
		startMs: Math.round(segment.startSec * 1000),
		endMs: Math.round(segment.endSec * 1000),
		text: segment.text.trim(),
	}));
	return mergeIntoUtterances(spans, mergeGapMs);
}
