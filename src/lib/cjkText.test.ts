import { describe, expect, it } from "vitest";
import { isCjkChar, joinTextSegments, joinWords } from "./cjkText";

describe("cjkText", () => {
	it("classifies CJK and non-CJK chars", () => {
		expect(isCjkChar("好")).toBe(true);
		expect(isCjkChar("の")).toBe(true);
		expect(isCjkChar("한")).toBe(true);
		expect(isCjkChar("a")).toBe(false);
		expect(isCjkChar(undefined)).toBe(false);
	});

	it("joins CJK boundaries without spaces and Latin with spaces", () => {
		expect(joinTextSegments("好那", "我们")).toBe("好那我们");
		expect(joinTextSegments("hello", "world")).toBe("hello world");
		expect(joinTextSegments("点击 export", "按钮")).toBe("点击 export 按钮");
		expect(joinTextSegments("", "开始")).toBe("开始");
	});

	it("joins Chinese whisper word tokens into a clean line", () => {
		expect(joinWords(["好", "那", "我们", "今天", "来", "看一下", "这个"])).toBe(
			"好那我们今天来看一下这个",
		);
		expect(joinWords(["the", "quick", "fox"])).toBe("the quick fox");
		expect(joinWords(["用", "cloud", "的", "度"])).toBe("用 cloud 的度");
	});
});
