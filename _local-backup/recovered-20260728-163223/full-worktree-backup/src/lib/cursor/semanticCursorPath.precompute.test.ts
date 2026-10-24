import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CursorRecordingData } from "@/native/contracts";

const smoothingBuildSpy = vi.hoisted(() => vi.fn());

vi.mock("./cursorPathSmoothing", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./cursorPathSmoothing")>();
	return {
		...actual,
		buildSerializedSmoothedCursorPath: (
			...args: Parameters<typeof actual.buildSerializedSmoothedCursorPath>
		) => {
			smoothingBuildSpy();
			return actual.buildSerializedSmoothedCursorPath(...args);
		},
	};
});

import { buildSemanticCursorPath, getSemanticCursorPathMetadata } from "./semanticCursorPath";

describe("semantic fallback precomputation", () => {
	beforeEach(() => smoothingBuildSpy.mockClear());

	it("finishes the expensive fallback build before sampleAt can enter the render loop", () => {
		const recording: CursorRecordingData = {
			version: 2,
			provider: "native",
			assets: [],
			samples: [
				{ timeMs: 0, cx: 0.1, cy: 0.5, visible: true },
				{ timeMs: 100, cx: 0.5, cy: 0.5, visible: true, interactionType: "click" },
				{ timeMs: 200, cx: 0.9, cy: 0.5, visible: true },
			],
		};

		expect(getSemanticCursorPathMetadata(recording)?.mode).toBe("fallback");
		expect(smoothingBuildSpy).not.toHaveBeenCalled();

		const path = buildSemanticCursorPath(recording, 0.6);
		expect(smoothingBuildSpy).toHaveBeenCalledOnce();

		path.sampleAt(0);
		path.sampleAt(100);
		path.cameraSampleAt(200);
		expect(smoothingBuildSpy).toHaveBeenCalledOnce();
	});
});
