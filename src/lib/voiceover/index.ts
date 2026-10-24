export {
	DEFAULT_VOICEOVER_QUALITY,
	DEFAULT_VOICEOVER_STYLE,
	DEFAULT_VOICEOVER_VOICE,
	resolveVoiceoverStyle,
	VOICEOVER_LANGUAGES,
	VOICEOVER_MERGE_GAP_MS,
	VOICEOVER_SAMPLE_RATE,
	VOICEOVER_STYLES,
	VOICEOVER_TTS_MODEL,
	VOICEOVER_VOICES,
	type VoiceoverQuality,
	type VoiceoverStyle,
	type VoiceoverStyleId,
	type VoiceoverVoice,
} from "./constants";
export {
	type SynthesizeVoiceoverOptions,
	type SynthesizeVoiceoverResult,
	synthesizeVoiceover,
} from "./synthesize";
export {
	assembleVoiceoverTimeline,
	fitSamplesToWindow,
	resampleLinear,
} from "./timelineFit";
export {
	buildUtterancesFromAnnotations,
	buildUtterancesFromCaptionSegments,
	joinUtteranceText,
	mergeIntoUtterances,
} from "./utterances";
export { decodeWavPcm16, encodeWavPcm16Mono } from "./wav";
