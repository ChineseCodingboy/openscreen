import type {
	AnnotationRegion,
	AudioTrackClip,
	SpeedRegion,
	VideoTrackClip,
	ZoomRegion,
} from "../types";

export const MIN_CUT_DURATION_MS = 40;
export const AUDIO_MIX_ITEM_PREFIX = "audio-mix:";

type TimedRegion = ZoomRegion | AnnotationRegion | SpeedRegion;
type MediaClip = VideoTrackClip | AudioTrackClip;

export interface AudioClipGroup {
	id: string;
	startMs: number;
	endMs: number;
	sourceStartMs: number;
	clips: AudioTrackClip[];
}

export function groupAudioTrackClips(clips: AudioTrackClip[]): AudioClipGroup[] {
	const groups = new Map<string, AudioClipGroup>();
	for (const clip of clips) {
		const key = `${clip.linkGroupId ?? "unlinked"}:${clip.startMs}:${clip.endMs}:${clip.sourceStartMs}`;
		const existing = groups.get(key);
		if (existing) {
			existing.clips.push(clip);
		} else {
			groups.set(key, {
				id: `${AUDIO_MIX_ITEM_PREFIX}${key}`,
				startMs: clip.startMs,
				endMs: clip.endMs,
				sourceStartMs: clip.sourceStartMs,
				clips: [clip],
			});
		}
	}
	return [...groups.values()].sort((left, right) => left.startMs - right.startMs);
}

export function isAudioMixItemId(id: string): boolean {
	return id.startsWith(AUDIO_MIX_ITEM_PREFIX);
}

export function findAudioClipGroup(clips: AudioTrackClip[], id: string): AudioClipGroup | null {
	return groupAudioTrackClips(clips).find((group) => group.id === id) ?? null;
}

function canCut(startMs: number, endMs: number, cutMs: number): boolean {
	return cutMs - startMs >= MIN_CUT_DURATION_MS && endMs - cutMs >= MIN_CUT_DURATION_MS;
}

export function splitMediaClip<T extends MediaClip>(
	clip: T,
	cutMs: number,
	createId: (side: "left" | "right") => string,
): [T, T] | null {
	if (!canCut(clip.startMs, clip.endMs, cutMs)) return null;
	const sourceOffsetMs = cutMs - clip.startMs;
	const leftLink = clip.linkGroupId ? { linkGroupId: `${clip.linkGroupId}:left:${cutMs}` } : {};
	const rightLink = clip.linkGroupId ? { linkGroupId: `${clip.linkGroupId}:right:${cutMs}` } : {};
	return [
		{
			...clip,
			id: createId("left"),
			endMs: cutMs,
			...leftLink,
		},
		{
			...clip,
			id: createId("right"),
			startMs: cutMs,
			sourceStartMs: clip.sourceStartMs + sourceOffsetMs,
			...rightLink,
		},
	];
}

export function splitTimedRegion<T extends TimedRegion>(
	region: T,
	cutMs: number,
	createId: (side: "left" | "right") => string,
): [T, T] | null {
	if (!canCut(region.startMs, region.endMs, cutMs)) return null;
	return [
		{ ...region, id: createId("left"), endMs: cutMs },
		{ ...region, id: createId("right"), startMs: cutMs },
	];
}

function splitAllContaining<T extends MediaClip>(
	clips: T[],
	cutMs: number,
	createId: (clip: T, side: "left" | "right") => string,
): { clips: T[]; didSplit: boolean } {
	let didSplit = false;
	const next = clips.flatMap((clip) => {
		const split = splitMediaClip(clip, cutMs, (side) => createId(clip, side));
		if (!split) return [clip];
		didSplit = true;
		return split;
	});
	return { clips: next, didSplit };
}

/** Split linked screen video and mixed audio atomically at one timeline position. */
export function splitLinkedMedia(
	videoClips: VideoTrackClip[],
	audioClips: AudioTrackClip[],
	cutMs: number,
	createId: (kind: "video" | "audio", originalId: string, side: "left" | "right") => string,
) {
	const videos = splitAllContaining(videoClips, cutMs, (clip, side) =>
		createId("video", clip.id, side),
	);
	const audio = splitAllContaining(audioClips, cutMs, (clip, side) =>
		createId("audio", clip.id, side),
	);
	return {
		videoTrackClips: videos.clips,
		audioTrackClips: audio.clips,
		didSplit: videos.didSplit || audio.didSplit,
	};
}

export function rippleDeleteMedia<T extends MediaClip>(clips: T[], deletedIds: Set<string>): T[] {
	const deleted = clips.filter((clip) => deletedIds.has(clip.id));
	if (!deleted.length) return clips;
	const startMs = Math.min(...deleted.map((clip) => clip.startMs));
	const endMs = Math.max(...deleted.map((clip) => clip.endMs));
	const deltaMs = endMs - startMs;
	return clips
		.filter((clip) => !deletedIds.has(clip.id))
		.map((clip) =>
			clip.startMs >= endMs
				? { ...clip, startMs: clip.startMs - deltaMs, endMs: clip.endMs - deltaMs }
				: clip,
		);
}
