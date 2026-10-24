/// <reference lib="webworker" />

import { analyzeTargetFramePair, type TargetFramePair } from "./autoZoomTargetAnalysisCore";

interface WorkerRequest extends TargetFramePair {
	id: number;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const { id, ...pair } = event.data;
	self.postMessage({ id, result: analyzeTargetFramePair(pair) });
};

export {};
