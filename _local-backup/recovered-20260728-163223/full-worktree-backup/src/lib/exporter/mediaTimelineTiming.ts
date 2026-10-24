import type { SpeedRegion, TrimRegion, VideoTrackClip } from "@/components/video-editor/types";

const FRAME_COUNT_EPSILON = 1e-9;
const FRAME_INDEX_EPSILON = 1e-7;

export interface MediaTimelineTimingSegment {
	timelineStartMs: number;
	timelineEndMs: number;
	exportStartMs: number;
	speed: number;
}

export interface MediaTimelineTiming {
	timelineDurationMs: number;
	exportDurationMs: number;
	segments: MediaTimelineTimingSegment[];
}

export interface MediaVideoDecodeJob {
	clip: VideoTrackClip;
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
}

function validSpeedAt(speedRegions: SpeedRegion[], timelineTimeMs: number): number {
	const speed = speedRegions.find(
		(region) => timelineTimeMs >= region.startMs && timelineTimeMs < region.endMs,
	)?.speed;
	return Number.isFinite(speed) && (speed ?? 0) > 0 ? speed! : 1;
}

/** Builds the wall-clock export timeline while preserving editor timeline coordinates. */
export function buildMediaTimelineTiming(
	timelineDurationMs: number,
	speedRegions: SpeedRegion[],
): MediaTimelineTiming {
	const durationMs = Math.max(0, timelineDurationMs);
	const boundaries = new Set<number>([0, durationMs]);
	for (const region of speedRegions) {
		boundaries.add(Math.min(durationMs, Math.max(0, region.startMs)));
		boundaries.add(Math.min(durationMs, Math.max(0, region.endMs)));
	}

	const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
	const segments: MediaTimelineTimingSegment[] = [];
	let exportStartMs = 0;
	for (let index = 0; index < sortedBoundaries.length - 1; index++) {
		const timelineStartMs = sortedBoundaries[index];
		const timelineEndMs = sortedBoundaries[index + 1];
		if (timelineEndMs <= timelineStartMs) continue;
		const speed = validSpeedAt(speedRegions, (timelineStartMs + timelineEndMs) / 2);
		segments.push({ timelineStartMs, timelineEndMs, exportStartMs, speed });
		exportStartMs += (timelineEndMs - timelineStartMs) / speed;
	}

	return {
		timelineDurationMs: durationMs,
		exportDurationMs: exportStartMs,
		segments,
	};
}

export function exportTimeForTimelineTime(
	timing: MediaTimelineTiming,
	timelineTimeMs: number,
): number {
	const clampedTimeMs = Math.min(timing.timelineDurationMs, Math.max(0, timelineTimeMs));
	if (clampedTimeMs >= timing.timelineDurationMs) return timing.exportDurationMs;
	const segment = timing.segments.find(
		(candidate) =>
			clampedTimeMs >= candidate.timelineStartMs && clampedTimeMs < candidate.timelineEndMs,
	);
	if (!segment) return 0;
	return segment.exportStartMs + (clampedTimeMs - segment.timelineStartMs) / segment.speed;
}

export function timelineTimeForExportTime(
	timing: MediaTimelineTiming,
	exportTimeMs: number,
): number {
	const clampedTimeMs = Math.min(timing.exportDurationMs, Math.max(0, exportTimeMs));
	if (clampedTimeMs >= timing.exportDurationMs) return timing.timelineDurationMs;
	const segment = timing.segments.find((candidate) => {
		const exportEndMs =
			candidate.exportStartMs +
			(candidate.timelineEndMs - candidate.timelineStartMs) / candidate.speed;
		return clampedTimeMs >= candidate.exportStartMs && clampedTimeMs < exportEndMs;
	});
	if (!segment) return 0;
	return segment.timelineStartMs + (clampedTimeMs - segment.exportStartMs) * segment.speed;
}

export function shouldRenderMediaBackground(
	videoTrackHidden: boolean,
	timelineDurationMs: number,
	videoTimelineEndMs: number,
): boolean {
	return videoTrackHidden || timelineDurationMs > videoTimelineEndMs + 0.0001;
}

export function frameIndexForTimelineTime(
	timing: MediaTimelineTiming,
	timelineTimeMs: number,
	frameRate: number,
): number {
	const framePosition = (exportTimeForTimelineTime(timing, timelineTimeMs) * frameRate) / 1000;
	return Math.max(0, Math.floor(framePosition + 0.5 + FRAME_INDEX_EPSILON));
}

export function frameIndexForExportTimestamp(exportTimestampUs: number, frameRate: number): number {
	const framePosition = (exportTimestampUs * frameRate) / 1_000_000;
	return Math.max(0, Math.floor(framePosition + 0.5 + FRAME_INDEX_EPSILON));
}

export function totalFramesForExportDuration(exportDurationMs: number, frameRate: number): number {
	return Math.max(
		1,
		Math.ceil((Math.max(0, exportDurationMs) * frameRate) / 1000 - FRAME_COUNT_EPSILON),
	);
}

function trimRegionsForSourceWindow(
	sourceStartMs: number,
	sourceEndMs: number,
	sourceDurationMs: number,
	jobIndex: number,
): TrimRegion[] {
	const trims: TrimRegion[] = [];
	if (sourceStartMs > 0) {
		trims.push({ id: `media-job-${jobIndex}-before`, startMs: 0, endMs: sourceStartMs });
	}
	if (sourceEndMs < sourceDurationMs) {
		trims.push({
			id: `media-job-${jobIndex}-after`,
			startMs: sourceEndMs,
			endMs: sourceDurationMs,
		});
	}
	return trims;
}

/**
 * Produces one decode pass per timeline clip. Keeping duplicate source windows as separate jobs is
 * intentional: a source-time lookup cannot represent reordering or using the same source twice.
 */
export function buildMediaVideoDecodeJobs(
	videoClips: VideoTrackClip[],
	sourceDurationMs: number,
	speedRegions: SpeedRegion[],
): MediaVideoDecodeJob[] {
	const durationMs = Math.max(0, sourceDurationMs);
	return [...videoClips]
		.sort((left, right) => left.startMs - right.startMs)
		.map((clip, jobIndex) => {
			const sourceStartMs = Math.min(durationMs, Math.max(0, clip.sourceStartMs));
			const requestedSourceEndMs = clip.sourceStartMs + clip.endMs - clip.startMs;
			const sourceEndMs = Math.min(durationMs, Math.max(sourceStartMs, requestedSourceEndMs));
			const mappedSpeedRegions = speedRegions.flatMap((region, regionIndex) => {
				const timelineStartMs = Math.max(clip.startMs, region.startMs);
				const timelineEndMs = Math.min(clip.endMs, region.endMs);
				if (timelineEndMs <= timelineStartMs) return [];
				return [
					{
						id: `media-job-${jobIndex}-speed-${regionIndex}`,
						startMs: clip.sourceStartMs + timelineStartMs - clip.startMs,
						endMs: clip.sourceStartMs + timelineEndMs - clip.startMs,
						speed: region.speed,
					},
				];
			});
			return {
				clip,
				trimRegions: trimRegionsForSourceWindow(sourceStartMs, sourceEndMs, durationMs, jobIndex),
				speedRegions: mappedSpeedRegions,
			};
		})
		.filter(
			(job) =>
				job.clip.endMs > job.clip.startMs &&
				job.clip.sourceStartMs < durationMs &&
				job.clip.sourceStartMs + job.clip.endMs - job.clip.startMs > 0,
		);
}
