export interface PreviewMediaSpan {
	id: string;
	startMs: number;
	endMs: number;
	sourceStartMs: number;
}

export interface PreviewClock {
	/** Position in the edited timeline. Effects and the playhead use this clock. */
	timelineMs: number;
	/** Position in the source recording. Cursor and decoded media use this clock. */
	sourceMs: number;
}

export const PREVIEW_REACT_PUBLISH_INTERVAL_MS = 50;

/**
 * The video element owns playback state only in legacy source playback. When a
 * media-track timeline is active, that parent transport may intentionally
 * pause the video through gaps while audio and the playhead keep running.
 */
export function videoElementOwnsPreviewTransport(externalTransportActive: boolean) {
	return !externalTransportActive;
}

export function shouldPrepareLegacySupplementalAudio(hasExplicitAudioTracks: boolean) {
	return !hasExplicitAudioTracks;
}

export function areExplicitPreviewAudioTracksReady(
	trackOrdinals: readonly number[],
	readyTrackOrdinals: ReadonlySet<number>,
) {
	return (
		trackOrdinals.length > 0 &&
		trackOrdinals.every((trackOrdinal) => readyTrackOrdinals.has(trackOrdinal))
	);
}

interface FollowerBoundaryAudioClip {
	id: string;
	trackOrdinal: number;
	startMs: number;
	endMs: number;
	muted: boolean;
	gain: number;
}

interface FollowerBoundarySpeedRegion {
	startMs: number;
	endMs: number;
	speed: number;
}

/** A cheap per-frame signature; media followers resync only when this changes. */
export function createFollowerBoundaryKey(
	timelineMs: number,
	sourceActive: boolean,
	audioClips: readonly FollowerBoundaryAudioClip[],
	speedRegions: readonly FollowerBoundarySpeedRegion[],
) {
	let speed = 1;
	for (const region of speedRegions) {
		if (timelineMs >= region.startMs && timelineMs < region.endMs) {
			speed = region.speed;
			break;
		}
	}

	let key = `${sourceActive ? 1 : 0}|${speed}|`;
	for (const clip of audioClips) {
		if (timelineMs < clip.startMs || timelineMs >= clip.endMs) continue;
		key += `${clip.trackOrdinal}:${clip.id}:${clip.muted || clip.gain <= 0 ? 0 : 1};`;
	}
	return key;
}

export function shouldMuteEmbeddedPreviewAudio(
	clips: Array<{ muted: boolean; gain: number }>,
	allEditableTracksPrepared: boolean,
) {
	if (allEditableTracksPrepared) return true;
	return clips.length > 0 && clips.every((clip) => clip.muted || clip.gain <= 0);
}

/**
 * Keeps high-frequency transport updates out of React while still publishing a
 * UI snapshot at 20Hz. The transport clock itself remains available every
 * frame through refs.
 */
export function createPreviewTimePublisher(
	publish: (clock: PreviewClock) => void,
	intervalMs = PREVIEW_REACT_PUBLISH_INTERVAL_MS,
) {
	let lastPublishedAtMs = Number.NEGATIVE_INFINITY;

	return (clock: PreviewClock, nowMs: number, force = false) => {
		if (!force && nowMs - lastPublishedAtMs < intervalMs) return false;
		lastPublishedAtMs = nowMs;
		publish(clock);
		return true;
	};
}

export type DriftCorrection =
	| { type: "none"; rateMultiplier: 1 }
	| { type: "rate"; rateMultiplier: number }
	| { type: "seek"; rateMultiplier: 1 };

const CONTINUITY_EPSILON_MS = 2;

export function sourceMsToTimelineMs(span: PreviewMediaSpan, sourceMs: number) {
	return span.startMs + (sourceMs - span.sourceStartMs);
}

export function areMediaSpansContinuous(
	previous: PreviewMediaSpan | null | undefined,
	next: PreviewMediaSpan | null | undefined,
) {
	if (!previous || !next) return false;
	const previousSourceEnd = previous.sourceStartMs + previous.endMs - previous.startMs;
	return (
		Math.abs(previous.endMs - next.startMs) <= CONTINUITY_EPSILON_MS &&
		Math.abs(previousSourceEnd - next.sourceStartMs) <= CONTINUITY_EPSILON_MS
	);
}

export function resolvePreviewDrift(driftSeconds: number): DriftCorrection {
	const magnitude = Math.abs(driftSeconds);
	if (magnitude < 0.06) return { type: "none", rateMultiplier: 1 };
	if (magnitude <= 0.25) {
		return {
			type: "rate",
			rateMultiplier: driftSeconds > 0 ? 0.98 : 1.02,
		};
	}
	return { type: "seek", rateMultiplier: 1 };
}

export type VideoMasterAction =
	| { type: "none" }
	| { type: "seek"; seekToSourceMs: number }
	| { type: "pause" };

export interface VideoMasterAdvance {
	timelineMs: number;
	videoAction: VideoMasterAction;
}

/**
 * Derives the next timeline position from the playing video element (the
 * preview master clock). Seeking or rate-nudging a decoding video forces
 * keyframe re-decodes and drops frames, so the video runs free and everything
 * else follows it; the only remaining seek is a genuine source discontinuity
 * at a cut boundary.
 */
export function resolveVideoMasterAdvance(input: {
	previousTimelineMs: number;
	videoSourceMs: number;
	activeClip: PreviewMediaSpan | null;
	nextClip: PreviewMediaSpan | null;
}): VideoMasterAdvance {
	const { previousTimelineMs, videoSourceMs, activeClip, nextClip } = input;
	if (!activeClip) {
		return { timelineMs: previousTimelineMs, videoAction: { type: "pause" } };
	}

	// Clamping below to the previous position keeps the playhead monotonic when
	// the decoder momentarily reports a stale frame time.
	const mappedMs = Math.max(previousTimelineMs, sourceMsToTimelineMs(activeClip, videoSourceMs));
	if (mappedMs < activeClip.endMs) {
		return { timelineMs: mappedMs, videoAction: { type: "none" } };
	}

	if (!nextClip) {
		return { timelineMs: activeClip.endMs, videoAction: { type: "pause" } };
	}
	if (areMediaSpansContinuous(activeClip, nextClip)) {
		return {
			timelineMs: Math.min(mappedMs, nextClip.endMs),
			videoAction: { type: "none" },
		};
	}
	return {
		timelineMs: nextClip.startMs,
		videoAction: { type: "seek", seekToSourceMs: nextClip.sourceStartMs },
	};
}
