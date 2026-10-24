/** Returns physical audio streams in container order. */
export function listAudioStreams<T extends { codec_type_string: string }>(streams: T[]): T[] {
	return streams.filter((stream) => stream.codec_type_string === "audio");
}

/** Resolves a stable 0-based audio-track ordinal to a container-global stream. */
export function resolveAudioStreamByOrdinal<T extends { codec_type_string: string }>(
	streams: T[],
	trackOrdinal: number,
): T | null {
	if (!Number.isFinite(trackOrdinal)) return null;
	return listAudioStreams(streams)[Math.max(0, Math.round(trackOrdinal))] ?? null;
}

export function getAudioTrackOrdinal<T extends { codec_type_string: string; index: number }>(
	streams: T[],
	streamIndex: number,
): number | null {
	const ordinal = listAudioStreams(streams).findIndex((stream) => stream.index === streamIndex);
	return ordinal >= 0 ? ordinal : null;
}
