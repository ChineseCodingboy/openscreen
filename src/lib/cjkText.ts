/** CJK-aware text joining shared by caption layout and the voice-over script builder. */

/** True when the char borders CJK text, where joining with a space would look/sound wrong. */
export function isCjkChar(char: string | undefined): boolean {
	if (!char) return false;
	const code = char.codePointAt(0) ?? 0;
	return (
		(code >= 0x2e80 && code <= 0x9fff) || // CJK radicals, ideographs
		(code >= 0x3000 && code <= 0x30ff) || // CJK punctuation, kana
		(code >= 0xac00 && code <= 0xd7af) || // Hangul
		(code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
		(code >= 0xff00 && code <= 0xffef) // full-width forms
	);
}

/**
 * Joins two fragments with a space, except across a CJK–CJK boundary. Mixed
 * CJK↔Latin boundaries keep the space (standard Chinese typesetting style).
 */
export function joinTextSegments(left: string, right: string): string {
	const trimmedLeft = left.trimEnd();
	const trimmedRight = right.trimStart();
	if (!trimmedLeft) return trimmedRight;
	if (!trimmedRight) return trimmedLeft;
	const boundaryIsCjk = isCjkChar(trimmedLeft.at(-1)) && isCjkChar(trimmedRight.at(0));
	return boundaryIsCjk ? `${trimmedLeft}${trimmedRight}` : `${trimmedLeft} ${trimmedRight}`;
}

/** Joins word tokens into one line: spaces for Latin scripts, none across CJK boundaries. */
export function joinWords(words: readonly string[]): string {
	let joined = "";
	for (const word of words) {
		joined = joinTextSegments(joined, word);
	}
	return joined;
}
