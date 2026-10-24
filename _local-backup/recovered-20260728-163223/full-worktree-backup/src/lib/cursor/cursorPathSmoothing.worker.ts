/// <reference lib="webworker" />

import type { CursorRecordingSample } from "@/native/contracts";
import { buildSerializedSmoothedCursorPath } from "./cursorPathSmoothing";

type CursorPathWorkerRequest = {
	samples: CursorRecordingSample[];
	smoothing: number;
};

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<CursorPathWorkerRequest>) => {
	try {
		const path = buildSerializedSmoothedCursorPath(
			{ samples: event.data.samples },
			event.data.smoothing,
		);
		const transfer = path.runs.flatMap((run) => [run.times.buffer, run.xs.buffer, run.ys.buffer]);
		workerScope.postMessage({ path }, transfer);
	} catch (error) {
		workerScope.postMessage({
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
