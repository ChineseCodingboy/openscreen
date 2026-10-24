export function parseAfinfoAudioTrackBitrates(output: string): number[] {
	const bitrates: number[] = [];
	const trackSections = output.split(/\n----\n/g).slice(1);
	for (const section of trackSections) {
		// afinfo terminates its output with another divider. Only sections carrying
		// an audio data format describe a physical track.
		if (!/^Data format:/m.test(section) || !/\baudio packets:/i.test(section)) continue;
		const match = section.match(/\bbit rate:\s*([0-9]+)\s*bits per second/i);
		bitrates.push(match ? Number(match[1]) : 0);
	}
	return bitrates;
}

/**
 * Picks which audio track of a recording to extract for preview playback.
 *
 * With an explicit 0-based audio-track ordinal the track only needs to exist — a
 * mic-only or system-only recording has a single audio track and must still be
 * extractable. Without a request (legacy single supplemental track), extraction
 * only makes sense when there are multiple tracks to choose between, and the
 * most substantial one wins: a disabled/silent system track is often a tiny AAC
 * stream while the microphone track carries the actual recording.
 */
export function resolveSupplementalTrackArrayIndex(
	bitrates: number[],
	requestedTrackOrdinal?: number,
): number | null {
	if (typeof requestedTrackOrdinal === "number") {
		const arrayIndex = Math.round(requestedTrackOrdinal);
		return arrayIndex >= 0 && arrayIndex < bitrates.length ? arrayIndex : null;
	}

	if (bitrates.length <= 1) {
		return null;
	}

	// Ordinal 0 already plays through the embedded video element. The legacy
	// supplemental path only supplies one of the additional physical tracks.
	let bestArrayIndex = 1;
	for (let index = 2; index < bitrates.length; index += 1) {
		if (bitrates[index] > bitrates[bestArrayIndex]) bestArrayIndex = index;
	}
	return bestArrayIndex;
}

/** Shares one extraction promise for callers that resolve to the same source track. */
export function runDedupedPreviewAudioPreparation<T>(
	inFlight: Map<string, Promise<T>>,
	key: string,
	prepare: () => Promise<T>,
): Promise<T> {
	const existing = inFlight.get(key);
	if (existing) return existing;

	let shared: Promise<T>;
	shared = Promise.resolve()
		.then(prepare)
		.finally(() => {
			if (inFlight.get(key) === shared) inFlight.delete(key);
		});
	inFlight.set(key, shared);
	return shared;
}
