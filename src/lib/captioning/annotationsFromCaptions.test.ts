import { describe, expect, it } from "vitest";

import {
	captionSegmentsToAnnotationRegions,
	groupCaptionSegmentsAdaptively,
	groupPhraseCaptionSegmentsIntoLines,
	groupTimedCaptionWordsIntoLines,
	reconcileAutoCaptionTimelineGaps,
	replaceAutoCaptionRegions,
} from "./annotationsFromCaptions";

describe("groupCaptionSegmentsAdaptively", () => {
	it("breaks on natural pauses and punctuation without word-count settings", () => {
		const lines = groupCaptionSegmentsAdaptively([
			{ startSec: 0, endSec: 0.35, text: "This" },
			{ startSec: 0.36, endSec: 0.72, text: "works." },
			{ startSec: 1.3, endSec: 1.65, text: "Next" },
			{ startSec: 1.66, endSec: 2.1, text: "idea" },
		]);

		expect(lines.map((line) => line.text)).toEqual(["This works.", "Next idea"]);
		expect(lines[1]!.startSec).toBe(1.3);
	});

	it("limits dense Chinese captions by readable visual width", () => {
		const characters = Array.from("这是一个会根据画面宽度和说话速度自动分段的字幕示例").map(
			(text, index) => ({
				startSec: index * 0.16,
				endSec: index * 0.16 + 0.15,
				text,
			}),
		);
		const lines = groupCaptionSegmentsAdaptively(characters);

		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((line) => Array.from(line.text).length <= 15)).toBe(true);
		expect(lines.map((line) => line.text).join("")).toBe(
			"这是一个会根据画面宽度和说话速度自动分段的字幕示例",
		);
	});

	it("tokenizes unspaced phrase-timestamp Chinese before adaptive layout", () => {
		const lines = groupCaptionSegmentsAdaptively(
			[
				{
					startSec: 0,
					endSec: 4,
					text: "这是一个很长的中文语句需要根据阅读宽度自动拆分成多条字幕",
				},
			],
			"phrase",
		);

		expect(lines.length).toBeGreaterThan(1);
		expect(lines.map((line) => line.text).join("")).toBe(
			"这是一个很长的中文语句需要根据阅读宽度自动拆分成多条字幕",
		);
	});
});

describe("groupPhraseCaptionSegmentsIntoLines", () => {
	it("preserves phrase boundaries when formatting phrase-timestamp captions", () => {
		const lines = groupPhraseCaptionSegmentsIntoLines(
			[
				{ startSec: 0, endSec: 0.5, text: "alpha beta" },
				{ startSec: 0.62, endSec: 1.6, text: "gamma delta" },
			],
			2,
			2,
		);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ text: "alpha beta", startSec: 0 });
		expect(lines[1]).toMatchObject({ text: "gamma delta", startSec: 0.62 });
		expect(lines[0]!.endSec).toBeLessThanOrEqual(0.62);
	});

	it("slices a single merged phrase into timed caption lines by word bounds", () => {
		const lines = groupPhraseCaptionSegmentsIntoLines(
			[{ startSec: 0, endSec: 1, text: "alpha beta gamma delta" }],
			2,
			2,
		);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({
			startSec: 0,
			endSec: 0.5,
			text: "alpha beta",
		});
		expect(lines[1]).toMatchObject({
			startSec: 0.5,
			endSec: 1,
			text: "gamma delta",
		});
	});
});

describe("captionSegmentsToAnnotationRegions", () => {
	it("puts every generated caption clip on one visual track", () => {
		const { regions, nextZIndex } = captionSegmentsToAnnotationRegions(
			[
				{ startSec: 0, endSec: 0.5, text: "first caption" },
				{ startSec: 0.6, endSec: 1.1, text: "second caption" },
			],
			1,
			7,
			{ minWordsPerCaption: 2, maxWordsPerCaption: 2, timestampGranularity: "phrase" },
		);

		expect(regions).toHaveLength(2);
		expect(regions.map((region) => region.zIndex)).toEqual([7, 7]);
		expect(nextZIndex).toBe(8);
	});

	it("uses raw phrase timing instead of shifting caption boundaries", () => {
		const { regions } = captionSegmentsToAnnotationRegions(
			[
				{ startSec: 0, endSec: 0.5, text: "first second" },
				{ startSec: 0.62, endSec: 1.2, text: "third fourth" },
			],
			1,
			1,
			{ minWordsPerCaption: 2, maxWordsPerCaption: 2, timestampGranularity: "phrase" },
		);

		expect(regions).toHaveLength(2);
		expect(regions[0]).toMatchObject({ startMs: 0, endMs: 500 });
		expect(regions[1]).toMatchObject({ startMs: 620, endMs: 1200 });
	});

	it("preserves empty timeline space when word timestamps contain a real pause", () => {
		const lines = groupTimedCaptionWordsIntoLines(
			[
				{ startSec: 0, endSec: 0.12, text: "first" },
				{ startSec: 0.13, endSec: 0.28, text: "caption" },
				{ startSec: 0.7, endSec: 0.83, text: "second" },
				{ startSec: 0.84, endSec: 0.98, text: "caption" },
			],
			2,
			2,
		);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ startSec: 0, endSec: 0.28, text: "first caption" });
		expect(lines[1]).toMatchObject({ startSec: 0.7, endSec: 0.98, text: "second caption" });
	});

	it("preserves repeated words before grouping in word mode", () => {
		const { regions } = captionSegmentsToAnnotationRegions(
			[
				{ startSec: 0, endSec: 0.12, text: "I" },
				{ startSec: 0.13, endSec: 0.25, text: "I" },
			],
			1,
			1,
			{ minWordsPerCaption: 2, maxWordsPerCaption: 2, timestampGranularity: "word" },
		);

		expect(regions).toHaveLength(1);
		expect(regions[0]).toMatchObject({ content: "I I" });
	});
});

describe("replaceAutoCaptionRegions", () => {
	it("replaces the previous generated track and keeps manual annotations", () => {
		const style = {
			color: "#fff",
			backgroundColor: "transparent",
			fontSize: 24,
			fontFamily: "Inter",
			fontWeight: "normal" as const,
			fontStyle: "normal" as const,
			textDecoration: "none" as const,
			textAlign: "center" as const,
		};
		const base = {
			startMs: 0,
			endMs: 100,
			type: "text" as const,
			position: { x: 0, y: 0 },
			size: { width: 10, height: 10 },
			style,
		};
		const result = replaceAutoCaptionRegions(
			[
				{ ...base, id: "old-caption", content: "old", annotationSource: "auto-caption", zIndex: 2 },
				{ ...base, id: "manual", content: "manual", zIndex: 3 },
			],
			[
				{ ...base, id: "new-1", content: "new one", annotationSource: "auto-caption", zIndex: 9 },
				{ ...base, id: "new-2", content: "new two", annotationSource: "auto-caption", zIndex: 10 },
			],
		);

		expect(result.map((region) => region.id)).toEqual(["manual", "new-1", "new-2"]);
		expect(result.slice(1).map((region) => region.zIndex)).toEqual([9, 9]);
	});
});

describe("reconcileAutoCaptionTimelineGaps", () => {
	it("does not change regions when the minimum enforced gap is zero", () => {
		const regions = reconcileAutoCaptionTimelineGaps([
			{
				id: "annotation-1",
				startMs: 0,
				endMs: 120,
				type: "text",
				content: "one",
				annotationSource: "auto-caption",
				position: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				style: {
					color: "#fff",
					backgroundColor: "transparent",
					fontSize: 24,
					fontFamily: "Inter",
					fontWeight: "normal",
					fontStyle: "normal",
					textDecoration: "none",
					textAlign: "center",
				},
				zIndex: 1,
			},
			{
				id: "manual-1",
				startMs: 50,
				endMs: 1000,
				type: "text",
				content: "manual",
				position: { x: 10, y: 10 },
				size: { width: 10, height: 10 },
				style: {
					color: "#fff",
					backgroundColor: "transparent",
					fontSize: 24,
					fontFamily: "Inter",
					fontWeight: "normal",
					fontStyle: "normal",
					textDecoration: "none",
					textAlign: "center",
				},
				zIndex: 2,
			},
			{
				id: "annotation-2",
				startMs: 130,
				endMs: 300,
				type: "text",
				content: "two",
				annotationSource: "auto-caption",
				position: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				style: {
					color: "#fff",
					backgroundColor: "transparent",
					fontSize: 24,
					fontFamily: "Inter",
					fontWeight: "normal",
					fontStyle: "normal",
					textDecoration: "none",
					textAlign: "center",
				},
				zIndex: 3,
			},
		]);

		expect(regions.find((r) => r.id === "manual-1")).toMatchObject({
			startMs: 50,
			endMs: 1000,
		});
		expect(regions.find((r) => r.id === "annotation-1")).toMatchObject({
			startMs: 0,
			endMs: 120,
		});
		expect(regions.find((r) => r.id === "annotation-2")).toMatchObject({
			startMs: 130,
			endMs: 300,
		});
	});
});

describe("CJK caption line joining", () => {
	it("joins Chinese word tokens without spaces", () => {
		const words = ["好", "那", "我们", "今天", "来", "看一下", "这个"].map((text, index) => ({
			startSec: index * 0.3,
			endSec: index * 0.3 + 0.25,
			text,
		}));
		const lines = groupTimedCaptionWordsIntoLines(words, 2, 7);
		expect(lines.length).toBe(1);
		expect(lines[0].text).toBe("好那我们今天来看一下这个");
	});

	it("keeps spaces for Latin tokens and mixed boundaries", () => {
		const words = ["cloud", "的", "度", "怎么样"].map((text, index) => ({
			startSec: index * 0.3,
			endSec: index * 0.3 + 0.25,
			text,
		}));
		const lines = groupTimedCaptionWordsIntoLines(words, 2, 7);
		expect(lines.length).toBe(1);
		expect(lines[0].text).toBe("cloud 的度怎么样");
	});
});
