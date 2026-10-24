const MIN_SEGMENT_DURATION_MS = 0.001;

export interface MediaClockSegment {
	wallStartMs: number;
	wallEndMs: number;
	mediaStartMs: number;
	mediaEndMs: number;
}

export interface MediaClockSnapshot {
	startedAtMs: number | null;
	stoppedAtMs: number | null;
	activeDurationMs: number;
	active: boolean;
	segments: MediaClockSegment[];
}

export interface WebcamSyncSegment {
	screenStartMs: number;
	screenEndMs: number;
	webcamStartMs: number;
	webcamEndMs: number;
}

export interface WebcamSyncMetadata {
	schemaVersion: 1;
	segments: WebcamSyncSegment[];
}

export interface WebcamSyncPoint {
	webcamTimeMs: number;
	localRate: number;
	boundaryKey: string;
	segmentIndex: number | null;
}

export interface WebcamSyncLookupOptions {
	adjustmentMs?: number;
	webcamDurationMs?: number;
}

export interface WebcamSyncWindow {
	screenStartMs: number;
	screenEndMs: number;
	webcamStartMs: number;
	webcamEndMs: number;
	localRate: number;
	boundaryKey: string;
	segmentIndex: number | null;
}

function finiteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function normalizeSegment(value: unknown): WebcamSyncSegment | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Partial<WebcamSyncSegment>;
	if (
		!finiteNumber(raw.screenStartMs) ||
		!finiteNumber(raw.screenEndMs) ||
		!finiteNumber(raw.webcamStartMs) ||
		!finiteNumber(raw.webcamEndMs)
	) {
		return null;
	}
	if (
		raw.screenStartMs < 0 ||
		raw.webcamStartMs < 0 ||
		raw.screenEndMs - raw.screenStartMs < MIN_SEGMENT_DURATION_MS ||
		raw.webcamEndMs - raw.webcamStartMs < MIN_SEGMENT_DURATION_MS
	) {
		return null;
	}
	return {
		screenStartMs: raw.screenStartMs,
		screenEndMs: raw.screenEndMs,
		webcamStartMs: raw.webcamStartMs,
		webcamEndMs: raw.webcamEndMs,
	};
}

/**
 * Validates persisted sync data and drops overlapping or backwards segments. A corrupt project
 * must never make follower media seek backwards indefinitely.
 */
export function normalizeWebcamSyncMetadata(value: unknown): WebcamSyncMetadata | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as { schemaVersion?: unknown; version?: unknown; segments?: unknown };
	// Accept the short-lived `version` spelling used by early development builds.
	if (raw.schemaVersion !== 1 && raw.version !== 1) return undefined;
	if (!Array.isArray(raw.segments)) return undefined;

	const sorted = raw.segments
		.map(normalizeSegment)
		.filter((segment): segment is WebcamSyncSegment => segment !== null)
		.sort((left, right) => left.screenStartMs - right.screenStartMs);
	const segments: WebcamSyncSegment[] = [];
	for (const segment of sorted) {
		const previous = segments.at(-1);
		if (
			previous &&
			(segment.screenStartMs < previous.screenEndMs || segment.webcamStartMs < previous.webcamEndMs)
		) {
			continue;
		}
		segments.push(segment);
	}
	return segments.length > 0 ? { schemaVersion: 1, segments } : undefined;
}

/** Mutable active-media clock driven by actual recorder/native lifecycle event timestamps. */
export class ActiveMediaClock {
	private startedAtMs: number | null = null;
	private stoppedAtMs: number | null = null;
	private activeStartedAtMs: number | null = null;
	private activeMediaStartMs = 0;
	private completedSegments: MediaClockSegment[] = [];

	start(wallTimeMs: number): void {
		if (this.startedAtMs !== null || !finiteNumber(wallTimeMs)) return;
		this.startedAtMs = wallTimeMs;
		this.activeStartedAtMs = wallTimeMs;
		this.activeMediaStartMs = 0;
	}

	pause(wallTimeMs: number): void {
		this.closeActiveSegment(wallTimeMs);
	}

	resume(wallTimeMs: number): void {
		if (
			this.startedAtMs === null ||
			this.stoppedAtMs !== null ||
			this.activeStartedAtMs !== null ||
			!finiteNumber(wallTimeMs)
		) {
			return;
		}
		this.activeStartedAtMs = wallTimeMs;
		this.activeMediaStartMs = this.completedDurationMs();
	}

	stop(wallTimeMs: number): void {
		if (this.startedAtMs === null || this.stoppedAtMs !== null || !finiteNumber(wallTimeMs)) return;
		this.closeActiveSegment(wallTimeMs);
		this.stoppedAtMs = Math.max(this.startedAtMs, wallTimeMs);
	}

	snapshot(atWallTimeMs = Date.now()): MediaClockSnapshot {
		const segments = this.completedSegments.map((segment) => ({ ...segment }));
		if (this.activeStartedAtMs !== null) {
			const wallEndMs = Math.max(this.activeStartedAtMs, atWallTimeMs);
			segments.push({
				wallStartMs: this.activeStartedAtMs,
				wallEndMs,
				mediaStartMs: this.activeMediaStartMs,
				mediaEndMs: this.activeMediaStartMs + wallEndMs - this.activeStartedAtMs,
			});
		}
		return {
			startedAtMs: this.startedAtMs,
			stoppedAtMs: this.stoppedAtMs,
			activeDurationMs: segments.at(-1)?.mediaEndMs ?? 0,
			active: this.activeStartedAtMs !== null,
			segments,
		};
	}

	private closeActiveSegment(wallTimeMs: number): void {
		if (this.activeStartedAtMs === null || !finiteNumber(wallTimeMs)) return;
		const wallEndMs = Math.max(this.activeStartedAtMs, wallTimeMs);
		const mediaEndMs = this.activeMediaStartMs + wallEndMs - this.activeStartedAtMs;
		if (wallEndMs - this.activeStartedAtMs >= MIN_SEGMENT_DURATION_MS) {
			this.completedSegments.push({
				wallStartMs: this.activeStartedAtMs,
				wallEndMs,
				mediaStartMs: this.activeMediaStartMs,
				mediaEndMs,
			});
		}
		this.activeStartedAtMs = null;
		this.activeMediaStartMs = mediaEndMs;
	}

	private completedDurationMs(): number {
		return this.completedSegments.at(-1)?.mediaEndMs ?? this.activeMediaStartMs;
	}
}

/** Builds source-time mapping by intersecting periods when both recorders were active. */
export function buildWebcamSyncMetadata(
	screenClock: MediaClockSnapshot,
	webcamClock: MediaClockSnapshot,
): WebcamSyncMetadata | undefined {
	const segments: WebcamSyncSegment[] = [];
	for (const screen of screenClock.segments) {
		for (const webcam of webcamClock.segments) {
			const wallStartMs = Math.max(screen.wallStartMs, webcam.wallStartMs);
			const wallEndMs = Math.min(screen.wallEndMs, webcam.wallEndMs);
			if (wallEndMs - wallStartMs < MIN_SEGMENT_DURATION_MS) continue;
			segments.push({
				screenStartMs: screen.mediaStartMs + wallStartMs - screen.wallStartMs,
				screenEndMs: screen.mediaStartMs + wallEndMs - screen.wallStartMs,
				webcamStartMs: webcam.mediaStartMs + wallStartMs - webcam.wallStartMs,
				webcamEndMs: webcam.mediaStartMs + wallEndMs - webcam.wallStartMs,
			});
		}
	}
	return normalizeWebcamSyncMetadata({ schemaVersion: 1, segments });
}

/** Missing metadata intentionally means identity, preserving legacy sessions. */
export function resolveWebcamSyncPoint(
	screenTimeMs: number,
	metadata?: WebcamSyncMetadata | null,
	options: WebcamSyncLookupOptions = {},
): WebcamSyncPoint | null {
	if (!finiteNumber(screenTimeMs) || screenTimeMs < 0) return null;
	const adjustmentMs = finiteNumber(options.adjustmentMs) ? options.adjustmentMs : 0;
	const webcamDurationMs = finiteNumber(options.webcamDurationMs)
		? Math.max(0, options.webcamDurationMs)
		: Number.POSITIVE_INFINITY;

	if (!metadata) {
		const webcamTimeMs = screenTimeMs + adjustmentMs;
		if (webcamTimeMs < 0 || webcamTimeMs >= webcamDurationMs) return null;
		return { webcamTimeMs, localRate: 1, boundaryKey: "identity", segmentIndex: null };
	}

	const segmentIndex = metadata.segments.findIndex(
		(segment) => screenTimeMs >= segment.screenStartMs && screenTimeMs < segment.screenEndMs,
	);
	if (segmentIndex < 0) return null;
	const segment = metadata.segments[segmentIndex];
	const localRate =
		(segment.webcamEndMs - segment.webcamStartMs) / (segment.screenEndMs - segment.screenStartMs);
	const webcamTimeMs =
		segment.webcamStartMs + (screenTimeMs - segment.screenStartMs) * localRate + adjustmentMs;
	if (webcamTimeMs < 0 || webcamTimeMs >= webcamDurationMs) return null;
	return {
		webcamTimeMs,
		localRate,
		boundaryKey: `segment:${segmentIndex}`,
		segmentIndex,
	};
}

export function mapScreenSourceToWebcam(
	screenTimeMs: number,
	metadata?: WebcamSyncMetadata | null,
	options?: WebcamSyncLookupOptions,
): number | null {
	return resolveWebcamSyncPoint(screenTimeMs, metadata, options)?.webcamTimeMs ?? null;
}

export function webcamSyncRateAt(
	screenTimeMs: number,
	metadata?: WebcamSyncMetadata | null,
): number | null {
	return resolveWebcamSyncPoint(screenTimeMs, metadata)?.localRate ?? null;
}

export function webcamSyncBoundaryAt(
	screenTimeMs: number,
	metadata?: WebcamSyncMetadata | null,
): string {
	return resolveWebcamSyncPoint(screenTimeMs, metadata)?.boundaryKey ?? "gap";
}

/**
 * Maps a screen source interval into one or more webcam intervals. Export callers should create
 * one decode job per returned window and multiply timeline speed by `localRate`.
 */
export function mapScreenRangeToWebcamWindows(
	screenStartMs: number,
	screenEndMs: number,
	metadata?: WebcamSyncMetadata | null,
	options: WebcamSyncLookupOptions = {},
): WebcamSyncWindow[] {
	if (
		!finiteNumber(screenStartMs) ||
		!finiteNumber(screenEndMs) ||
		screenStartMs < 0 ||
		screenEndMs - screenStartMs < MIN_SEGMENT_DURATION_MS
	) {
		return [];
	}
	const adjustmentMs = finiteNumber(options.adjustmentMs) ? options.adjustmentMs : 0;
	const webcamDurationMs = finiteNumber(options.webcamDurationMs)
		? Math.max(0, options.webcamDurationMs)
		: Number.POSITIVE_INFINITY;
	const sources = metadata?.segments ?? [
		{
			screenStartMs,
			screenEndMs,
			webcamStartMs: screenStartMs,
			webcamEndMs: screenEndMs,
		},
	];

	return sources.flatMap((segment, segmentIndex) => {
		let mappedScreenStartMs = Math.max(screenStartMs, segment.screenStartMs);
		let mappedScreenEndMs = Math.min(screenEndMs, segment.screenEndMs);
		if (mappedScreenEndMs - mappedScreenStartMs < MIN_SEGMENT_DURATION_MS) return [];
		const localRate =
			(segment.webcamEndMs - segment.webcamStartMs) / (segment.screenEndMs - segment.screenStartMs);
		let webcamStartMs =
			segment.webcamStartMs +
			(mappedScreenStartMs - segment.screenStartMs) * localRate +
			adjustmentMs;
		let webcamEndMs =
			segment.webcamStartMs +
			(mappedScreenEndMs - segment.screenStartMs) * localRate +
			adjustmentMs;
		if (webcamStartMs < 0) {
			mappedScreenStartMs += -webcamStartMs / localRate;
			webcamStartMs = 0;
		}
		if (webcamEndMs > webcamDurationMs) {
			mappedScreenEndMs -= (webcamEndMs - webcamDurationMs) / localRate;
			webcamEndMs = webcamDurationMs;
		}
		if (
			mappedScreenEndMs - mappedScreenStartMs < MIN_SEGMENT_DURATION_MS ||
			webcamEndMs - webcamStartMs < MIN_SEGMENT_DURATION_MS
		) {
			return [];
		}
		const resolvedSegmentIndex = metadata ? segmentIndex : null;
		return [
			{
				screenStartMs: mappedScreenStartMs,
				screenEndMs: mappedScreenEndMs,
				webcamStartMs,
				webcamEndMs,
				localRate,
				boundaryKey: resolvedSegmentIndex === null ? "identity" : `segment:${segmentIndex}`,
				segmentIndex: resolvedSegmentIndex,
			},
		];
	});
}
