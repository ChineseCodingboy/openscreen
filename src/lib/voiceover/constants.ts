export const VOICEOVER_TTS_MODEL = "gpt-4o-mini-tts";

/** Target sample rate of the assembled voice-over track (OpenAI TTS WAV output rate). */
export const VOICEOVER_SAMPLE_RATE = 24_000;

/** Merge captions closer than this into one spoken utterance. */
export const VOICEOVER_MERGE_GAP_MS = 600;

/** Utterance audio may exceed its timeline window by this factor before it gets compressed. */
export const VOICEOVER_WINDOW_TOLERANCE = 1.02;

/** Maximum speed-up applied to an overflowing utterance before hard-trimming. */
export const VOICEOVER_MAX_COMPRESSION = 1.4;

/** Fade-out applied when an utterance must be hard-trimmed to its window. */
export const VOICEOVER_TRIM_FADE_MS = 80;

/** OpenAI TTS rejects inputs above 4096 characters; stay under with margin. */
export const VOICEOVER_MAX_TTS_INPUT_CHARS = 4000;

export type VoiceoverStyleId = "sleek" | "energetic" | "broadcast" | "conversational";

export interface VoiceoverStyle {
	id: VoiceoverStyleId;
	/** i18n key suffix under `voiceover.styles.*` in the editor namespace. */
	i18nKey: string;
	/** English steering prompt for gpt-4o-mini-tts; works regardless of the spoken language. */
	instructions: string;
}

export const VOICEOVER_STYLES: VoiceoverStyle[] = [
	{
		id: "sleek",
		i18nKey: "sleek",
		instructions:
			"Narrate like a premium tech product film: calm, low, precise and confident, minimal emotion, cool tone, clean pacing with deliberate short pauses. Use standard, neutral pronunciation of the input language.",
	},
	{
		id: "energetic",
		i18nKey: "energetic",
		instructions:
			"Narrate like an enthusiastic product launch keynote: upbeat, warm and engaging, lively pacing, clearly excited about the product. Keep pronunciation standard and articulate.",
	},
	{
		id: "broadcast",
		i18nKey: "broadcast",
		instructions:
			"Read like a professional news broadcaster: neutral, standard pronunciation, steady measured pace, crisp articulation, no dramatization.",
	},
	{
		id: "conversational",
		i18nKey: "conversational",
		instructions:
			"Speak naturally and casually, like explaining something to a colleague: relaxed pace, friendly and approachable, standard pronunciation.",
	},
];

export const DEFAULT_VOICEOVER_STYLE: VoiceoverStyleId = "sleek";

/** Voice ids supported by BOTH the chat-audio (hd) and mini-tts (standard) paths. */
export const VOICEOVER_VOICES = [
	"ash",
	"alloy",
	"ballad",
	"coral",
	"echo",
	"sage",
	"shimmer",
] as const;

export type VoiceoverVoice = (typeof VOICEOVER_VOICES)[number];

export const DEFAULT_VOICEOVER_VOICE: VoiceoverVoice = "ash";

/** hd = gpt-audio chat models (ChatGPT-voice realism); standard = gpt-4o-mini-tts (cheaper). */
export type VoiceoverQuality = "hd" | "standard";

export const DEFAULT_VOICEOVER_QUALITY: VoiceoverQuality = "hd";

/** Languages offered for translated voice-overs; labels are shown in their own language. */
export const VOICEOVER_LANGUAGES = [
	{ id: "Simplified Chinese", label: "中文" },
	{ id: "English", label: "English" },
	{ id: "Japanese", label: "日本語" },
	{ id: "Korean", label: "한국어" },
	{ id: "Spanish", label: "Español" },
	{ id: "French", label: "Français" },
	{ id: "German", label: "Deutsch" },
	{ id: "Portuguese", label: "Português" },
	{ id: "Russian", label: "Русский" },
] as const;

export function resolveVoiceoverStyle(styleId: string): VoiceoverStyle {
	return VOICEOVER_STYLES.find((style) => style.id === styleId) ?? VOICEOVER_STYLES[0];
}
