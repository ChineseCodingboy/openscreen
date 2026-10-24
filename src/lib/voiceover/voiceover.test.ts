import { describe, expect, it } from "vitest";
import type { AnnotationRegion } from "@/components/video-editor/types";
import { splitLongUtteranceText } from "./synthesize";
import { assembleVoiceoverTimeline, fitSamplesToWindow, resampleLinear } from "./timelineFit";
import {
	buildUtterancesFromAnnotations,
	buildUtterancesFromCaptionSegments,
	joinUtteranceText,
	mergeIntoUtterances,
} from "./utterances";
import { decodeWavPcm16, encodeWavPcm16Mono } from "./wav";

function captionRegion(
	startMs: number,
	endMs: number,
	content: string,
	overrides?: Partial<AnnotationRegion>,
): AnnotationRegion {
	return {
		id: `annotation-${startMs}`,
		startMs,
		endMs,
		type: "text",
		content,
		position: { x: 50, y: 50 },
		size: { width: 30, height: 20 },
		style: {
			color: "#fff",
			backgroundColor: "transparent",
			fontSize: 32,
			fontFamily: "Inter",
			fontWeight: "bold",
			fontStyle: "normal",
			textDecoration: "none",
			textAlign: "center",
		},
		zIndex: 1,
		annotationSource: "auto-caption",
		...overrides,
	};
}

describe("wav codec", () => {
	it("round-trips PCM16 mono samples", () => {
		const samples = new Float32Array([0, 0.5, -0.5, 0.999, -1]);
		const decoded = decodeWavPcm16(encodeWavPcm16Mono(samples, 24_000));
		expect(decoded.sampleRate).toBe(24_000);
		expect(decoded.samples.length).toBe(samples.length);
		for (let index = 0; index < samples.length; index++) {
			// Quantization (1/0x8000) plus the encode-by-0x7fff / decode-by-0x8000 scale skew.
			expect(Math.abs(decoded.samples[index] - samples[index])).toBeLessThan(2 / 0x7fff);
		}
	});

	it("downmixes stereo PCM16 to mono", () => {
		// Hand-build a 2-channel WAV: frames [(0.5, -0.5), (1, 1)].
		const bytes = new ArrayBuffer(44 + 8);
		const view = new DataView(bytes);
		const write = (offset: number, value: string) => {
			for (let index = 0; index < value.length; index++)
				view.setUint8(offset + index, value.charCodeAt(index));
		};
		write(0, "RIFF");
		view.setUint32(4, 36 + 8, true);
		write(8, "WAVE");
		write(12, "fmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 2, true);
		view.setUint32(24, 24_000, true);
		view.setUint32(28, 24_000 * 4, true);
		view.setUint16(32, 4, true);
		view.setUint16(34, 16, true);
		write(36, "data");
		view.setUint32(40, 8, true);
		view.setInt16(44, 0x4000, true);
		view.setInt16(46, -0x4000, true);
		view.setInt16(48, 0x7fff, true);
		view.setInt16(50, 0x7fff, true);

		const decoded = decodeWavPcm16(bytes);
		expect(decoded.samples.length).toBe(2);
		expect(Math.abs(decoded.samples[0])).toBeLessThan(1e-4);
		expect(decoded.samples[1]).toBeCloseTo(1, 3);
	});

	it("rejects non-PCM16 input", () => {
		expect(() => decodeWavPcm16(new ArrayBuffer(10))).toThrow();
	});
});

describe("utterance building", () => {
	it("joins CJK text without spaces and Latin text with spaces", () => {
		expect(joinUtteranceText("打开设置", "点击导出")).toBe("打开设置点击导出");
		expect(joinUtteranceText("open the panel", "then export")).toBe("open the panel then export");
		expect(joinUtteranceText("点击 export", "按钮")).toBe("点击 export 按钮");
	});

	it("merges captions separated by less than the gap and keeps larger gaps apart", () => {
		const utterances = buildUtterancesFromAnnotations([
			captionRegion(0, 900, "首先"),
			captionRegion(1200, 2000, "打开设置"),
			captionRegion(4000, 5000, "然后导出"),
		]);
		expect(utterances).toEqual([
			{ startMs: 0, endMs: 2000, text: "首先打开设置" },
			{ startMs: 4000, endMs: 5000, text: "然后导出" },
		]);
	});

	it("prefers edited textContent over original caption content", () => {
		const utterances = buildUtterancesFromAnnotations([
			captionRegion(0, 1000, "原始文本", { textContent: "编辑后的文本" }),
		]);
		expect(utterances[0].text).toBe("编辑后的文本");
	});

	it("ignores non-caption annotations and empty captions", () => {
		const utterances = buildUtterancesFromAnnotations([
			captionRegion(0, 1000, "  "),
			captionRegion(2000, 3000, "手动标注", { annotationSource: undefined }),
			captionRegion(5000, 6000, "有效字幕"),
		]);
		expect(utterances).toEqual([{ startMs: 5000, endMs: 6000, text: "有效字幕" }]);
	});

	it("builds utterances from raw caption segments in seconds", () => {
		const utterances = buildUtterancesFromCaptionSegments([
			{ startSec: 1, endSec: 1.5, text: "hello" },
			{ startSec: 1.6, endSec: 2.2, text: "world" },
		]);
		expect(utterances).toEqual([{ startMs: 1000, endMs: 2200, text: "hello world" }]);
	});

	it("sorts out-of-order spans before merging", () => {
		const utterances = mergeIntoUtterances([
			{ startMs: 3000, endMs: 4000, text: "b" },
			{ startMs: 0, endMs: 1000, text: "a" },
		]);
		expect(utterances.map((utterance) => utterance.text)).toEqual(["a", "b"]);
	});
});

describe("timeline fitting", () => {
	it("keeps audio that fits its window untouched", () => {
		const samples = new Float32Array(24_000); // 1s at 24k
		const result = fitSamplesToWindow(samples, 24_000, 1500);
		expect(result.compressed).toBe(false);
		expect(result.samples).toBe(samples);
	});

	it("compresses overflowing audio into the window", () => {
		const samples = new Float32Array(30_000); // 1.25s
		const result = fitSamplesToWindow(samples, 24_000, 1000);
		expect(result.compressed).toBe(true);
		expect(result.trimmed).toBe(false);
		expect(result.samples.length).toBeLessThanOrEqual(24_000);
	});

	it("hard-trims with a fade when compression is not enough", () => {
		const samples = new Float32Array(24_000 * 3).fill(0.8); // 3s into a 1s window (needs 3x)
		const result = fitSamplesToWindow(samples, 24_000, 1000);
		expect(result.trimmed).toBe(true);
		expect(result.samples.length).toBe(24_000);
		expect(Math.abs(result.samples.at(-1) ?? 1)).toBeLessThan(0.01);
	});

	it("resamples linearly between rates", () => {
		const samples = new Float32Array([0, 1]);
		const resampled = resampleLinear(samples, 2, 4);
		expect(resampled.length).toBe(4);
		expect(resampled[0]).toBe(0);
		expect(resampled.at(-1)).toBe(1);
	});

	it("assembles utterances at their timeline offsets", () => {
		const timeline = assembleVoiceoverTimeline(
			[
				{ startMs: 0, samples: new Float32Array([1, 1]) },
				{ startMs: 1000, samples: new Float32Array([0.5]) },
			],
			2000,
			10,
		);
		expect(timeline.length).toBe(20);
		expect(timeline[0]).toBe(1);
		expect(timeline[10]).toBe(0.5);
		expect(timeline[5]).toBe(0);
	});

	it("clips placement to the timeline length", () => {
		const timeline = assembleVoiceoverTimeline(
			[{ startMs: 1900, samples: new Float32Array(100).fill(1) }],
			2000,
			10,
		);
		expect(timeline.length).toBe(20);
		expect(timeline[19]).toBe(1);
	});
});

describe("splitLongUtteranceText", () => {
	it("returns short text unchanged", () => {
		expect(splitLongUtteranceText("short", 100)).toEqual(["short"]);
	});

	it("splits at punctuation boundaries under the limit", () => {
		const text = `${"a".repeat(60)}。${"b".repeat(60)}。`;
		const chunks = splitLongUtteranceText(text, 100);
		expect(chunks.length).toBe(2);
		expect(chunks[0].endsWith("。")).toBe(true);
		expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
	});

	it("hard-splits text without any boundary", () => {
		const chunks = splitLongUtteranceText("x".repeat(250), 100);
		expect(chunks.length).toBe(3);
		expect(chunks.join("")).toBe("x".repeat(250));
	});
});
