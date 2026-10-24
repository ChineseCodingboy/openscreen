import { describe, expect, it } from "vitest";
import { createSpringState, type SpringConfig, stepSpringValue } from "./motionSmoothing";

const config: SpringConfig = {
	stiffness: 320,
	damping: 40,
	mass: 0.92,
	restDelta: 0.000001,
	restSpeed: 0.000001,
};

function initializedState(value: number) {
	const state = createSpringState(value);
	state.initialized = true;
	return state;
}

describe("motion smoothing spring", () => {
	it("is consistent when the same elapsed time is split across frames", () => {
		const singleStep = initializedState(0);
		const splitStep = initializedState(0);

		stepSpringValue(singleStep, 1, 32, config);
		stepSpringValue(splitStep, 1, 16, config);
		stepSpringValue(splitStep, 1, 16, config);

		expect(splitStep.value).toBeCloseTo(singleStep.value, 10);
		expect(splitStep.velocity).toBeCloseTo(singleStep.velocity, 10);
	});

	it("converges without creating a new spring state per step", () => {
		const state = initializedState(0);
		for (let frame = 0; frame < 240; frame++) {
			stepSpringValue(state, 1, 1000 / 60, config);
		}
		expect(state.value).toBeCloseTo(1, 5);
		expect(state.velocity).toBe(0);
	});

	it("stays finite for underdamped and overdamped configurations", () => {
		for (const springConfig of [
			{ stiffness: 760, damping: 34, mass: 0.55 },
			{ stiffness: 160, damping: 80, mass: 1.35 },
		]) {
			const state = initializedState(0);
			for (let frame = 0; frame < 60; frame++) {
				stepSpringValue(state, 1, 1000 / 60, springConfig);
			}
			expect(Number.isFinite(state.value)).toBe(true);
			expect(Number.isFinite(state.velocity)).toBe(true);
		}
	});
});
