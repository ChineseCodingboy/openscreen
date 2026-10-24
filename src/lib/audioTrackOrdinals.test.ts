import { describe, expect, it } from "vitest";
import { getAudioTrackOrdinal, resolveAudioStreamByOrdinal } from "./audioTrackOrdinals";

const video = { codec_type_string: "video", index: 7 };
const system = { codec_type_string: "audio", index: 11 };
const microphone = { codec_type_string: "audio", index: 19 };

describe("audio track ordinals", () => {
	it("resolves ordinal zero regardless of the container-global stream index", () => {
		expect(resolveAudioStreamByOrdinal([video, system], 0)).toBe(system);
		expect(resolveAudioStreamByOrdinal([system, video], 0)).toBe(system);
	});

	it("preserves audio-only ordering across interleaved streams", () => {
		expect(resolveAudioStreamByOrdinal([video, system, microphone], 1)).toBe(microphone);
		expect(getAudioTrackOrdinal([video, system, microphone], 19)).toBe(1);
	});
});
