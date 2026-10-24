export interface SpringState {
	value: number;
	velocity: number;
	initialized: boolean;
}

export interface SpringConfig {
	stiffness: number;
	damping: number;
	mass: number;
	restDelta?: number;
	restSpeed?: number;
}

const CURSOR_SMOOTHING_MIN = 0;
const CURSOR_SMOOTHING_MAX = 2;
const CURSOR_SMOOTHING_LEGACY_MAX = 0.5;

export function createSpringState(initialValue = 0): SpringState {
	return {
		value: initialValue,
		velocity: 0,
		initialized: false,
	};
}

export function resetSpringState(state: SpringState, initialValue?: number) {
	if (typeof initialValue === "number") {
		state.value = initialValue;
	}

	state.velocity = 0;
	state.initialized = false;
}

export function clampDeltaMs(deltaMs: number, fallbackMs = 1000 / 60) {
	if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
		return fallbackMs;
	}

	return Math.min(80, Math.max(1, deltaMs));
}

export function stepSpringValue(
	state: SpringState,
	target: number,
	deltaMs: number,
	config: SpringConfig,
) {
	const safeDeltaMs = clampDeltaMs(deltaMs);

	if (!state.initialized || !Number.isFinite(state.value)) {
		state.value = target;
		state.velocity = 0;
		state.initialized = true;
		return state.value;
	}

	const restDelta = config.restDelta ?? 0.0005;
	const restSpeed = config.restSpeed ?? 0.02;

	if (Math.abs(target - state.value) <= restDelta && Math.abs(state.velocity) <= restSpeed) {
		state.value = target;
		state.velocity = 0;
		return state.value;
	}

	// Solve the damped oscillator exactly for a constant target over this frame. This keeps the
	// persistent value/velocity semantics of Motion's spring without allocating a generator and
	// keyframe array for every axis on every animation frame.
	const mass = Math.max(0.0001, config.mass);
	const stiffness = Math.max(0, config.stiffness);
	const damping = Math.max(0, config.damping);
	const elapsedSeconds = safeDeltaMs / 1000;
	const displacement = state.value - target;
	const initialVelocity = state.velocity;
	const alpha = damping / (2 * mass);
	const naturalFrequencySquared = stiffness / mass;
	const discriminant = alpha * alpha - naturalFrequencySquared;

	let nextDisplacement: number;
	let nextVelocity: number;
	if (Math.abs(discriminant) < 1e-7) {
		const coefficient = initialVelocity + alpha * displacement;
		const decay = Math.exp(-alpha * elapsedSeconds);
		nextDisplacement = (displacement + coefficient * elapsedSeconds) * decay;
		nextVelocity = (initialVelocity - alpha * coefficient * elapsedSeconds) * decay;
	} else if (discriminant < 0) {
		const angularFrequency = Math.sqrt(-discriminant);
		const phaseCoefficient = (initialVelocity + alpha * displacement) / angularFrequency;
		const angle = angularFrequency * elapsedSeconds;
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const decay = Math.exp(-alpha * elapsedSeconds);
		nextDisplacement = decay * (displacement * cosine + phaseCoefficient * sine);
		nextVelocity =
			decay *
			(initialVelocity * cosine -
				((alpha * initialVelocity + naturalFrequencySquared * displacement) / angularFrequency) *
					sine);
	} else {
		const root = Math.sqrt(discriminant);
		const slowRoot = -alpha + root;
		const fastRoot = -alpha - root;
		const slowCoefficient = (initialVelocity - fastRoot * displacement) / (slowRoot - fastRoot);
		const fastCoefficient = displacement - slowCoefficient;
		const slowDecay = Math.exp(slowRoot * elapsedSeconds);
		const fastDecay = Math.exp(fastRoot * elapsedSeconds);
		nextDisplacement = slowCoefficient * slowDecay + fastCoefficient * fastDecay;
		nextVelocity = slowRoot * slowCoefficient * slowDecay + fastRoot * fastCoefficient * fastDecay;
	}

	state.value = target + nextDisplacement;
	state.velocity = nextVelocity;
	if (Math.abs(target - state.value) <= restDelta && Math.abs(state.velocity) <= restSpeed) {
		state.value = target;
		state.velocity = 0;
	}

	return state.value;
}

export function getCursorSpringConfig(smoothingFactor: number): SpringConfig {
	const clamped = Math.min(CURSOR_SMOOTHING_MAX, Math.max(CURSOR_SMOOTHING_MIN, smoothingFactor));

	if (clamped <= 0) {
		return {
			stiffness: 1000,
			damping: 100,
			mass: 1,
			restDelta: 0.0001,
			restSpeed: 0.001,
		};
	}

	if (clamped <= CURSOR_SMOOTHING_LEGACY_MAX) {
		const legacyNormalized = Math.min(
			1,
			Math.max(
				0,
				(clamped - CURSOR_SMOOTHING_MIN) / (CURSOR_SMOOTHING_LEGACY_MAX - CURSOR_SMOOTHING_MIN),
			),
		);

		return {
			stiffness: 760 - legacyNormalized * 420,
			damping: 34 + legacyNormalized * 24,
			mass: 0.55 + legacyNormalized * 0.45,
			restDelta: 0.0002,
			restSpeed: 0.01,
		};
	}

	const extendedNormalized = Math.min(
		1,
		Math.max(
			0,
			(clamped - CURSOR_SMOOTHING_LEGACY_MAX) /
				(CURSOR_SMOOTHING_MAX - CURSOR_SMOOTHING_LEGACY_MAX),
		),
	);

	return {
		stiffness: 340 - extendedNormalized * 180,
		damping: 58 + extendedNormalized * 22,
		mass: 1 + extendedNormalized * 0.35,
		restDelta: 0.0002,
		restSpeed: 0.01,
	};
}

export function getZoomSpringConfig(): SpringConfig {
	return {
		stiffness: 320,
		damping: 40,
		mass: 0.92,
		restDelta: 0.0005,
		restSpeed: 0.015,
	};
}
