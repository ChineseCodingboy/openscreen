import type { AudioTrackClip, SpeedRegion, TrimRegion, VideoTrackClip } from "../types";

export interface TimelineMediaPoint {
	clipId: string;
	timelineTimeMs: number;
	sourceTimeMs: number;
}

export function buildSourceTrimRegions(
	videoClips: VideoTrackClip[],
	sourceDurationMs: number,
): TrimRegion[] {
	const windows = videoClips
		.map((clip) => ({
			startMs: Math.max(0, clip.sourceStartMs),
			endMs: Math.min(sourceDurationMs, clip.sourceStartMs + clip.endMs - clip.startMs),
		}))
		.filter((window) => window.endMs > window.startMs)
		.sort((left, right) => left.startMs - right.startMs)
		.reduce<Array<{ startMs: number; endMs: number }>>((result, window) => {
			const previous = result[result.length - 1];
			if (previous && window.startMs <= previous.endMs) {
				previous.endMs = Math.max(previous.endMs, window.endMs);
			} else result.push({ ...window });
			return result;
		}, []);
	const trims: TrimRegion[] = [];
	let cursor = 0;
	for (const window of windows) {
		if (window.startMs > cursor) {
			trims.push({ id: `source-gap-${trims.length + 1}`, startMs: cursor, endMs: window.startMs });
		}
		cursor = Math.max(cursor, window.endMs);
	}
	if (cursor < sourceDurationMs) {
		trims.push({ id: `source-gap-${trims.length + 1}`, startMs: cursor, endMs: sourceDurationMs });
	}
	return trims;
}

export class TimelineMapper {
	constructor(
		private readonly videoClips: VideoTrackClip[],
		private readonly audioClips: AudioTrackClip[] = [],
		private readonly speedRegions: SpeedRegion[] = [],
	) {}

	get durationMs(): number {
		return Math.max(
			0,
			...this.videoClips.map((clip) => clip.endMs),
			...this.audioClips.map((clip) => clip.endMs),
			...this.speedRegions.map((region) => region.endMs),
		);
	}

	videoAtTimelineTime(timelineTimeMs: number): TimelineMediaPoint | null {
		const clip = this.videoClips.find(
			(candidate) => timelineTimeMs >= candidate.startMs && timelineTimeMs < candidate.endMs,
		);
		if (!clip) return null;
		return {
			clipId: clip.id,
			timelineTimeMs,
			sourceTimeMs: clip.sourceStartMs + timelineTimeMs - clip.startMs,
		};
	}

	timelineTimeForVideoSource(sourceTimeMs: number): TimelineMediaPoint | null {
		const clip = this.videoClips.find(
			(candidate) =>
				sourceTimeMs >= candidate.sourceStartMs &&
				sourceTimeMs < candidate.sourceStartMs + candidate.endMs - candidate.startMs,
		);
		if (!clip) return null;
		return {
			clipId: clip.id,
			timelineTimeMs: clip.startMs + sourceTimeMs - clip.sourceStartMs,
			sourceTimeMs,
		};
	}

	audioSourceTime(clip: AudioTrackClip, timelineTimeMs: number): number | null {
		if (timelineTimeMs < clip.startMs || timelineTimeMs >= clip.endMs) return null;
		return clip.sourceStartMs + timelineTimeMs - clip.startMs;
	}

	playbackRateAt(timelineTimeMs: number): number {
		return (
			this.speedRegions.find(
				(region) => timelineTimeMs >= region.startMs && timelineTimeMs < region.endMs,
			)?.speed ?? 1
		);
	}
}
