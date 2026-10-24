import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DesktopCapturerSource } from "electron";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	safeStorage,
	screen,
	shell,
	systemPreferences,
} from "electron";
import type { NativeMacRecordingRequest } from "../../src/lib/nativeMacRecording";
import type { NativeWindowsRecordingRequest } from "../../src/lib/nativeWindowsRecording";
import {
	type AudioStreamSource,
	type CursorCaptureMode,
	normalizeCursorCaptureMode,
	normalizeProjectMedia,
	normalizeRecordingSession,
	type ProjectMedia,
	type RecordedVideoAssetInput,
	type RecordingSession,
	type StoreRecordedSessionInput,
} from "../../src/lib/recordingSession";
import type {
	CursorRecordingData,
	CursorRecordingSample,
	NativeCursorAsset,
	ProjectFileResult,
	ProjectPathResult,
} from "../../src/native/contracts";
import { mainT } from "../i18n";
import { RECORDINGS_DIR } from "../main";
import { createCursorRecordingSession } from "../native-bridge/cursor/recording/factory";
import { requestMacCursorAccessibilityAccess } from "../native-bridge/cursor/recording/macNativeCursorRecordingSession";
import type { CursorRecordingSession } from "../native-bridge/cursor/recording/session";
import { patchWebmDurationOnDisk } from "../recording/webm-duration";
import { registerNativeBridgeHandlers } from "./nativeBridge";
import { parseAfinfoAudioTrackBitrates, resolveSupplementalTrackArrayIndex } from "./previewAudio";
import { RecordingStreamRegistry, registerRecordingStreamHandlers } from "./recordingStream";

const PROJECT_FILE_EXTENSION = "openscreen";
export const SHORTCUTS_FILE = path.join(app.getPath("userData"), "shortcuts.json");
const RECORDING_FILE_PREFIX = "recording-";
const RECORDING_SESSION_SUFFIX = ".session.json";
const ALLOWED_IMPORT_VIDEO_EXTENSIONS = new Set([
	".webm",
	".mp4",
	".mov",
	".avi",
	".mkv",
	".m4v",
	".wmv",
	".flv",
	".ts",
]);
const PREVIEW_AUDIO_DIR = path.join(app.getPath("userData"), "preview-audio");
const VOICEOVER_AUDIO_DIR = path.join(app.getPath("userData"), "voiceover");
const OPENAI_KEY_FILE = path.join(app.getPath("userData"), "openai-api-key.bin");
// safeStorage ciphertext is bound to the app signature, so every re-signed build
// would "lose" the key. A local obfuscated copy survives re-signing and self-heals
// the encrypted file on the next read.
const OPENAI_KEY_LOCAL_FILE = path.join(app.getPath("userData"), "openai-api-key.local.json");
const nativeMacCaptureEvents = new EventEmitter();

// Paths the user approved via file picker or project load (i.e. outside the default dirs).
const approvedPaths = new Set<string>();
const mediaSourceHandles = new Map<string, { filePath: string; expiresAt: number }>();
let mediaSourceServer: Server | null = null;
let mediaSourceServerPort = 0;

async function ensureMediaSourceServer(): Promise<number> {
	if (mediaSourceServer?.listening) return mediaSourceServerPort;
	mediaSourceServer = createServer(async (request, response) => {
		const token = request.url?.split("/media/")[1]?.split(/[?#]/, 1)[0];
		const handle = token ? mediaSourceHandles.get(token) : null;
		if (!handle || handle.expiresAt < Date.now()) {
			if (token) mediaSourceHandles.delete(token);
			response.writeHead(404).end();
			return;
		}
		try {
			const stat = await fs.stat(handle.filePath);
			const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
			let start = 0;
			let end = Math.max(0, stat.size - 1);
			if (range) {
				start = range[1] ? Number.parseInt(range[1], 10) : 0;
				end = range[2] ? Number.parseInt(range[2], 10) : end;
				if (start > end || start >= stat.size) {
					response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
					return;
				}
				end = Math.min(end, stat.size - 1);
			}
			const headers: Record<string, string> = {
				"Accept-Ranges": "bytes",
				"Access-Control-Allow-Origin": "*",
				"Content-Length": String(end - start + 1),
				"Content-Type": "application/octet-stream",
			};
			if (range) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
			response.writeHead(range ? 206 : 200, headers);
			createReadStream(handle.filePath, { start, end }).pipe(response);
		} catch {
			response.writeHead(500).end();
		}
	});
	await new Promise<void>((resolve, reject) => {
		mediaSourceServer!.once("error", reject);
		mediaSourceServer!.listen(0, "127.0.0.1", () => {
			const address = mediaSourceServer!.address();
			mediaSourceServerPort = typeof address === "object" && address ? address.port : 0;
			resolve();
		});
	});
	return mediaSourceServerPort;
}

function approveFilePath(filePath: string): void {
	approvedPaths.add(path.resolve(filePath));
}

function getAllowedReadDirs(): string[] {
	return [RECORDINGS_DIR, PREVIEW_AUDIO_DIR, VOICEOVER_AUDIO_DIR];
}

function isPathWithinDir(filePath: string, dirPath: string): boolean {
	const resolved = path.resolve(filePath);
	const resolvedDir = path.resolve(dirPath);
	return resolved === resolvedDir || resolved.startsWith(resolvedDir + path.sep);
}

function isPathAllowed(filePath: string): boolean {
	const resolved = path.resolve(filePath);
	if (approvedPaths.has(resolved)) return true;
	return getAllowedReadDirs().some((dir) => isPathWithinDir(resolved, dir));
}

// Not encryption — just keeps the key from being readable at a glance in the
// local fallback file. The real protection is safeStorage; this copy exists so a
// re-signed build can still recover the key the user already entered.
const OPENAI_KEY_LOCAL_PAD = "openscreen-local-key-pad";

function obfuscateApiKey(key: string): string {
	const bytes = Buffer.from(key, "utf8");
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] ^= OPENAI_KEY_LOCAL_PAD.charCodeAt(i % OPENAI_KEY_LOCAL_PAD.length);
	}
	return bytes.toString("base64");
}

function deobfuscateApiKey(value: string): string {
	const bytes = Buffer.from(value, "base64");
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] ^= OPENAI_KEY_LOCAL_PAD.charCodeAt(i % OPENAI_KEY_LOCAL_PAD.length);
	}
	return bytes.toString("utf8");
}

async function readOpenAIApiKey(): Promise<string | null> {
	if (safeStorage.isEncryptionAvailable()) {
		try {
			const encrypted = await fs.readFile(OPENAI_KEY_FILE);
			const decrypted = safeStorage.decryptString(encrypted).trim();
			if (decrypted) return decrypted;
		} catch {
			// Ciphertext from a differently-signed build; fall back to the local copy.
		}
	}
	try {
		const raw = JSON.parse(await fs.readFile(OPENAI_KEY_LOCAL_FILE, "utf8")) as { key?: unknown };
		const key = typeof raw.key === "string" ? deobfuscateApiKey(raw.key).trim() : "";
		if (!key) return null;
		if (safeStorage.isEncryptionAvailable()) {
			// Self-heal so the encrypted file matches this build's signature.
			await fs
				.writeFile(OPENAI_KEY_FILE, safeStorage.encryptString(key), { mode: 0o600 })
				.catch(() => undefined);
		}
		return key;
	} catch {
		return null;
	}
}

async function saveOpenAIApiKey(key: string): Promise<{ success: boolean; message?: string }> {
	const normalized = key.trim();
	if (!normalized.startsWith("sk-") || normalized.length < 20) {
		return { success: false, message: "Enter a valid OpenAI API key." };
	}
	await fs.writeFile(OPENAI_KEY_LOCAL_FILE, JSON.stringify({ key: obfuscateApiKey(normalized) }), {
		mode: 0o600,
	});
	if (safeStorage.isEncryptionAvailable()) {
		await fs.writeFile(OPENAI_KEY_FILE, safeStorage.encryptString(normalized), { mode: 0o600 });
	}
	return { success: true };
}

function resolveApprovedVideoPath(videoPath?: string | null): string | null {
	const normalizedPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedPath) {
		return null;
	}

	if (!hasAllowedImportVideoExtension(normalizedPath) || !isPathAllowed(normalizedPath)) {
		return null;
	}

	return normalizedPath;
}

// Attach the parent window only when valid, to avoid passing a destroyed BrowserWindow to dialogs.
function buildDialogOptions<T extends Electron.OpenDialogOptions | Electron.SaveDialogOptions>(
	baseOptions: T,
	parentWindow: BrowserWindow | null,
): T & { parent?: BrowserWindow } {
	const mainWindow = parentWindow;
	if (mainWindow && !mainWindow.isDestroyed()) {
		return { ...baseOptions, parent: mainWindow };
	}
	return baseOptions;
}

function hasAllowedImportVideoExtension(filePath: string): boolean {
	return ALLOWED_IMPORT_VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function runProcess(
	command: string,
	args: string[],
	options?: { timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut?: boolean }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = options?.timeoutMs
			? setTimeout(() => {
					timedOut = true;
					child.kill("SIGKILL");
				}, options.timeoutMs)
			: null;
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			if (timer) clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			resolve({ code, stdout, stderr, timedOut });
		});
	});
}

async function prepareSupplementalPreviewAudioTrack(
	videoPath: string,
	requestedTrackIndex?: number,
) {
	const normalizedPath = await approveReadableVideoPath(videoPath);
	if (!normalizedPath) {
		return {
			success: false,
			message: "File path is not approved or is not a supported video file",
		};
	}

	if (process.platform !== "darwin" || path.extname(normalizedPath).toLowerCase() !== ".mp4") {
		return { success: true, path: null };
	}

	const afinfo = await runProcess("/usr/bin/afinfo", [normalizedPath]);
	if (afinfo.code !== 0) {
		return { success: true, path: null };
	}

	const bitrates = parseAfinfoAudioTrackBitrates(`${afinfo.stdout}\n${afinfo.stderr}`);
	const supplementalTrackIndex = resolveSupplementalTrackArrayIndex(bitrates, requestedTrackIndex);
	if (supplementalTrackIndex === null) {
		return { success: true, path: null };
	}

	await fs.mkdir(PREVIEW_AUDIO_DIR, { recursive: true });
	const sourceStat = await fs.stat(normalizedPath);
	const parsedPath = path.parse(normalizedPath);
	const outputPath = path.join(
		PREVIEW_AUDIO_DIR,
		`${parsedPath.name}.track-${supplementalTrackIndex + 1}.${Math.round(sourceStat.mtimeMs)}.m4a`,
	);

	try {
		const outputStat = await fs.stat(outputPath);
		if (outputStat.mtimeMs >= sourceStat.mtimeMs) {
			return { success: true, path: pathToFileURL(outputPath).toString() };
		}
	} catch {
		// Generate below.
	}

	const conversion = await runProcess("/usr/bin/afconvert", [
		"--read-track",
		String(supplementalTrackIndex),
		"-f",
		"m4af",
		"-d",
		"aac",
		normalizedPath,
		outputPath,
	]);
	if (conversion.code !== 0) {
		return {
			success: false,
			message: conversion.stderr || conversion.stdout || "Failed to prepare preview audio",
		};
	}

	return { success: true, path: pathToFileURL(outputPath).toString() };
}

async function approveReadableVideoPath(
	filePath?: string | null,
	trustedDirs?: string[],
): Promise<string | null> {
	const normalizedPath = normalizeVideoSourcePath(filePath);
	if (!normalizedPath) {
		return null;
	}

	if (isPathAllowed(normalizedPath)) {
		return normalizedPath;
	}

	if (!hasAllowedImportVideoExtension(normalizedPath)) {
		return null;
	}

	// With trustedDirs (e.g. project load), only auto-approve paths inside them so a
	// malicious project file can't approve reads to arbitrary locations.
	if (trustedDirs) {
		const resolved = path.resolve(normalizedPath);
		const withinTrusted = trustedDirs.some((dir) => isPathWithinDir(resolved, dir));
		if (!withinTrusted) {
			return null;
		}
	}

	try {
		const stats = await fs.stat(normalizedPath);
		if (!stats.isFile()) {
			return null;
		}
	} catch {
		return null;
	}

	approveFilePath(normalizedPath);
	return normalizedPath;
}

function resolveRecordingOutputPath(fileName: string): string {
	const trimmed = fileName.trim();
	if (!trimmed) {
		throw new Error("Invalid recording file name");
	}

	const parsedPath = path.parse(trimmed);
	const hasTraversalSegments = trimmed.split(/[\\/]+/).some((segment) => segment === "..");
	const isNestedPath =
		parsedPath.dir !== "" ||
		path.isAbsolute(trimmed) ||
		trimmed.includes("/") ||
		trimmed.includes("\\");
	if (hasTraversalSegments || isNestedPath || parsedPath.base !== trimmed) {
		throw new Error("Recording file name must not contain path segments");
	}

	return path.join(RECORDINGS_DIR, parsedPath.base);
}

function isValidDurationMs(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Finalize one recording file: flush/close the stream if it was streamed, else write
 * the buffered bytes (short recording or stream failed to open). Returns whether it was
 * streamed, so the caller knows if the WebM duration needs patching on disk.
 */
async function finalizeRecordingFile(
	registry: RecordingStreamRegistry,
	fileName: string,
	filePath: string,
	videoData?: ArrayBuffer,
): Promise<boolean> {
	const streamed = await registry.finalize(fileName);
	if (!streamed && videoData && videoData.byteLength > 0) {
		await fs.writeFile(filePath, Buffer.from(videoData));
	}
	return streamed;
}

async function getApprovedProjectSession(
	project: unknown,
	projectFilePath?: string,
): Promise<RecordingSession | null> {
	if (!project || typeof project !== "object") {
		return null;
	}

	const rawProject = project as { media?: unknown; videoPath?: unknown };
	const media: ProjectMedia | null =
		normalizeProjectMedia(rawProject.media) ??
		(typeof rawProject.videoPath === "string"
			? {
					screenVideoPath: normalizeVideoSourcePath(rawProject.videoPath) ?? rawProject.videoPath,
				}
			: null);

	if (!media) {
		return null;
	}

	// Only auto-approve media within the project's dir or RECORDINGS_DIR, so a crafted
	// project file can't approve reads to arbitrary locations.
	const trustedDirs = [RECORDINGS_DIR];
	if (projectFilePath) {
		trustedDirs.push(path.dirname(path.resolve(projectFilePath)));
	}

	const screenVideoPath = await approveReadableVideoPath(media.screenVideoPath, trustedDirs);
	if (!screenVideoPath) {
		throw new Error("Project references an invalid or unsupported screen video path");
	}

	const webcamVideoPath = media.webcamVideoPath
		? await approveReadableVideoPath(media.webcamVideoPath, trustedDirs)
		: undefined;
	if (media.webcamVideoPath && !webcamVideoPath) {
		throw new Error("Project references an invalid or unsupported webcam video path");
	}

	return webcamVideoPath
		? { screenVideoPath, webcamVideoPath, createdAt: Date.now() }
		: { screenVideoPath, createdAt: Date.now() };
}

type SelectedSource = {
	name: string;
	id?: string;
	display_id?: string;
	[key: string]: unknown;
};

type AttachNativeMacWebcamRecordingInput = {
	screenVideoPath?: string;
	recordingId?: number;
	webcam?: RecordedVideoAssetInput;
	cursorCaptureMode?: CursorCaptureMode;
};

let selectedSource: SelectedSource | null = null;
let selectedDesktopSource: DesktopCapturerSource | null = null;
let lastEnumeratedSources = new Map<string, DesktopCapturerSource>();
let currentProjectPath: string | null = null;
let currentRecordingSession: RecordingSession | null = null;

// Cached source from the user's pick. Used by setDisplayMediaRequestHandler in main.ts for cursor-free capture.
export function getSelectedDesktopSource(): DesktopCapturerSource | null {
	return selectedDesktopSource;
}
let currentVideoPath: string | null = null;

function normalizePath(filePath: string) {
	return path.resolve(filePath);
}

function normalizeVideoSourcePath(videoPath?: string | null): string | null {
	if (typeof videoPath !== "string") {
		return null;
	}

	const trimmed = videoPath.trim();
	if (!trimmed) {
		return null;
	}

	if (/^file:\/\//i.test(trimmed)) {
		try {
			return fileURLToPath(trimmed);
		} catch {
			// Fall through and keep best-effort string path below.
		}
	}

	return trimmed;
}

function isTrustedProjectPath(filePath?: string | null) {
	if (!filePath || !currentProjectPath) {
		return false;
	}
	return normalizePath(filePath) === normalizePath(currentProjectPath);
}

const CURSOR_TELEMETRY_VERSION = 2;
const CURSOR_SAMPLE_INTERVAL_MS = 33;
const MAX_CURSOR_SAMPLES = 60 * 60 * 30; // 1 hour @ 30Hz

let cursorRecordingSession: CursorRecordingSession | null = null;
let pendingCursorRecordingData: CursorRecordingData | null = null;
let nativeWindowsCaptureProcess: ChildProcessWithoutNullStreams | null = null;
let nativeWindowsCaptureOutput = "";
let nativeWindowsCaptureTargetPath: string | null = null;
let nativeWindowsCaptureWebcamTargetPath: string | null = null;
let nativeWindowsCaptureRecordingId: number | null = null;
let nativeWindowsCursorOffsetMs = 0;
let nativeWindowsCursorCaptureMode: CursorCaptureMode = "editable-overlay";
let nativeWindowsCursorRecordingStartMs = 0;
let nativeWindowsPauseStartedAtMs: number | null = null;
let nativeWindowsPauseRanges: Array<{ startMs: number; endMs: number }> = [];
let nativeWindowsIsPaused = false;
const NATIVE_WINDOWS_CAPTURE_STOP_TIMEOUT_MS = 15_000;
let nativeMacCaptureProcess: ChildProcessWithoutNullStreams | null = null;
let nativeMacCaptureOutput = "";
let nativeMacCaptureTargetPath: string | null = null;
let nativeMacCaptureRecordingId: number | null = null;
let nativeMacAudioStreams: AudioStreamSource[] | null = null;
let nativeMacCursorOffsetMs = 0;
let nativeMacCursorCaptureMode: CursorCaptureMode = "editable-overlay";
let nativeMacCursorRecordingStartMs = 0;
let nativeMacPauseStartedAtMs: number | null = null;
let nativeMacPauseRanges: Array<{ startMs: number; endMs: number }> = [];
let nativeMacIsPaused = false;

function normalizeCursorSample(sample: unknown): CursorRecordingSample | null {
	if (!sample || typeof sample !== "object") {
		return null;
	}

	const point = sample as Partial<CursorRecordingSample>;
	const interactionType =
		point.interactionType === "click" ||
		point.interactionType === "mouseup" ||
		point.interactionType === "move"
			? point.interactionType
			: "move";
	return {
		timeMs:
			typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
				? Math.max(0, point.timeMs)
				: 0,
		cx: typeof point.cx === "number" && Number.isFinite(point.cx) ? point.cx : 0.5,
		cy: typeof point.cy === "number" && Number.isFinite(point.cy) ? point.cy : 0.5,
		assetId: typeof point.assetId === "string" ? point.assetId : null,
		visible: typeof point.visible === "boolean" ? point.visible : true,
		cursorType: typeof point.cursorType === "string" ? point.cursorType : null,
		interactionType,
	};
}

function normalizeCursorAsset(asset: unknown): NativeCursorAsset | null {
	if (!asset || typeof asset !== "object") {
		return null;
	}

	const candidate = asset as Partial<NativeCursorAsset>;
	if (typeof candidate.id !== "string" || typeof candidate.imageDataUrl !== "string") {
		return null;
	}

	return {
		id: candidate.id,
		platform:
			candidate.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
		imageDataUrl: candidate.imageDataUrl,
		width:
			typeof candidate.width === "number" && Number.isFinite(candidate.width)
				? Math.max(1, Math.round(candidate.width))
				: 1,
		height:
			typeof candidate.height === "number" && Number.isFinite(candidate.height)
				? Math.max(1, Math.round(candidate.height))
				: 1,
		hotspotX:
			typeof candidate.hotspotX === "number" && Number.isFinite(candidate.hotspotX)
				? Math.max(0, Math.round(candidate.hotspotX))
				: 0,
		hotspotY:
			typeof candidate.hotspotY === "number" && Number.isFinite(candidate.hotspotY)
				? Math.max(0, Math.round(candidate.hotspotY))
				: 0,
		scaleFactor:
			typeof candidate.scaleFactor === "number" && Number.isFinite(candidate.scaleFactor)
				? Math.max(0.1, candidate.scaleFactor)
				: undefined,
		cursorType: typeof candidate.cursorType === "string" ? candidate.cursorType : null,
	};
}

async function readCursorRecordingFile(targetVideoPath: string): Promise<CursorRecordingData> {
	const telemetryPath = `${targetVideoPath}.cursor.json`;
	try {
		const content = await fs.readFile(telemetryPath, "utf-8");
		const parsed = JSON.parse(content);
		const rawSamples = Array.isArray(parsed)
			? parsed
			: Array.isArray(parsed?.samples)
				? parsed.samples
				: [];
		const rawAssets = Array.isArray(parsed?.assets) ? parsed.assets : [];

		const samples = rawSamples
			.map((sample: unknown) => normalizeCursorSample(sample))
			.filter((sample: CursorRecordingSample | null): sample is CursorRecordingSample =>
				Boolean(sample),
			)
			.sort((a: CursorRecordingSample, b: CursorRecordingSample) => a.timeMs - b.timeMs);

		const assets = rawAssets
			.map((asset: unknown) => normalizeCursorAsset(asset))
			.filter((asset: NativeCursorAsset | null): asset is NativeCursorAsset => Boolean(asset));

		return {
			version:
				typeof parsed?.version === "number" && Number.isFinite(parsed.version) ? parsed.version : 1,
			provider: parsed?.provider === "native" ? "native" : "none",
			samples,
			assets,
		};
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === "ENOENT") {
			return {
				version: CURSOR_TELEMETRY_VERSION,
				provider: "none",
				samples: [],
				assets: [],
			};
		}

		console.error("Failed to load cursor telemetry:", error);
		throw error;
	}
}

async function readCursorTelemetryFile(targetVideoPath: string) {
	try {
		const recordingData = await readCursorRecordingFile(targetVideoPath);
		return {
			success: true,
			samples: recordingData.samples.map((sample) => ({
				timeMs: sample.timeMs,
				cx: sample.cx,
				cy: sample.cy,
			})),
		};
	} catch (error) {
		console.error("Failed to load cursor telemetry:", error);
		return {
			success: false,
			message: "Failed to load cursor telemetry",
			error: String(error),
			samples: [],
		};
	}
}

function resolveAssetBasePath() {
	try {
		if (app.isPackaged) {
			const assetPath = path.join(process.resourcesPath, "assets");
			return pathToFileURL(`${assetPath}${path.sep}`).toString();
		}
		const assetPath = path.join(app.getAppPath(), "public", "assets");
		return pathToFileURL(`${assetPath}${path.sep}`).toString();
	} catch (err) {
		console.error("Failed to resolve asset base path:", err);
		return null;
	}
}

function getSelectedSourceBounds() {
	const cursor = screen.getCursorScreenPoint();
	const sourceDisplayId = Number(selectedSource?.display_id);
	const sourceDisplay = Number.isFinite(sourceDisplayId)
		? (screen.getAllDisplays().find((display) => display.id === sourceDisplayId) ?? null)
		: null;
	return (sourceDisplay ?? screen.getDisplayNearestPoint(cursor)).bounds;
}

function getSelectedSourceId() {
	return typeof selectedSource?.id === "string" ? selectedSource.id : null;
}

function getSelectedDisplay() {
	const sourceDisplayId = Number(selectedSource?.display_id);
	if (!Number.isFinite(sourceDisplayId)) {
		return null;
	}

	return screen.getAllDisplays().find((display) => display.id === sourceDisplayId) ?? null;
}

function resolveUnpackedAppPath(...segments: string[]) {
	const resolved = path.join(app.getAppPath(), ...segments);
	if (app.isPackaged) {
		return resolved.replace(/\.asar([/\\])/, ".asar.unpacked$1");
	}

	return resolved;
}

function resolvePackagedResourcePath(...segments: string[]) {
	if (!app.isPackaged) {
		return null;
	}

	return path.join(process.resourcesPath, ...segments);
}

function getNativeWindowsCaptureHelperCandidates() {
	const envPath = process.env.OPENSCREEN_WGC_CAPTURE_EXE?.trim();
	const archTag = process.arch === "arm64" ? "win32-arm64" : "win32-x64";
	return [
		envPath,
		resolveUnpackedAppPath(
			"electron",
			"native",
			"wgc-capture",
			"build",
			"Release",
			"wgc-capture.exe",
		),
		resolveUnpackedAppPath("electron", "native", "wgc-capture", "build", "wgc-capture.exe"),
		resolveUnpackedAppPath("electron", "native", "bin", archTag, "wgc-capture.exe"),
		resolvePackagedResourcePath("electron", "native", "bin", archTag, "wgc-capture.exe"),
	].filter((candidate): candidate is string => Boolean(candidate));
}

async function findNativeWindowsCaptureHelperPath() {
	if (process.platform !== "win32") {
		return null;
	}

	for (const candidate of getNativeWindowsCaptureHelperCandidates()) {
		try {
			await fs.access(candidate, fsConstants.X_OK);
			return candidate;
		} catch {
			// Try the next configured helper location.
		}
	}

	return null;
}

function getNativeMacCaptureHelperCandidates() {
	const envPath = process.env.OPENSCREEN_SCK_CAPTURE_EXE?.trim();
	const archTag = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	const helperName = "openscreen-screencapturekit-helper";
	return [
		envPath,
		resolveUnpackedAppPath("electron", "native", "screencapturekit", "build", helperName),
		resolveUnpackedAppPath("electron", "native", "bin", archTag, helperName),
		resolvePackagedResourcePath("electron", "native", "bin", archTag, helperName),
	].filter((candidate): candidate is string => Boolean(candidate));
}

async function findNativeMacCaptureHelperPath() {
	if (process.platform !== "darwin") {
		return null;
	}

	for (const candidate of getNativeMacCaptureHelperCandidates()) {
		try {
			await fs.access(candidate, fsConstants.X_OK);
			return candidate;
		} catch {
			// Try the next configured helper location.
		}
	}

	return null;
}

function isNativeMacCaptureOsSupported() {
	if (process.platform !== "darwin") {
		return false;
	}

	const [major] = process.getSystemVersion().split(".").map(Number);
	return Number.isFinite(major) && major >= 15;
}

function isWindowsGraphicsCaptureOsSupported() {
	if (process.platform !== "win32") {
		return false;
	}

	const [, , build] = process.getSystemVersion().split(".").map(Number);
	return Number.isFinite(build) && build >= 19041;
}

function normalizeNativeDeviceName(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function scoreNativeDeviceName(candidateName: string, candidateId: string, requestedName?: string) {
	const candidate = normalizeNativeDeviceName(candidateName);
	const id = normalizeNativeDeviceName(candidateId);
	const requested = normalizeNativeDeviceName(requestedName ?? "");
	if (!requested) {
		return 0;
	}
	if (candidate === requested) {
		return 1000;
	}
	if (candidate.includes(requested) || requested.includes(candidate)) {
		return 900;
	}
	if (id.includes(requested) || requested.includes(id)) {
		return 800;
	}

	return requested
		.split(/\s+/)
		.filter((word) => word.length > 1 && !["camera", "webcam", "video", "input"].includes(word))
		.reduce((score, word) => {
			if (candidate.includes(word)) return score + 100;
			if (id.includes(word)) return score + 50;
			return score;
		}, 0);
}

function queryDirectShowVideoInputRegistry() {
	return new Promise<string>((resolve) => {
		const proc = spawn(
			"reg.exe",
			["query", "HKCR\\CLSID\\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\\Instance", "/s"],
			{ windowsHide: true },
		);
		let stdout = "";
		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf16le").includes("\u0000")
				? chunk.toString("utf16le")
				: chunk.toString();
		});
		proc.on("close", () => resolve(stdout));
		proc.on("error", () => resolve(""));
	});
}

async function resolveDirectShowWebcamClsid(deviceName?: string) {
	if (process.platform !== "win32" || !deviceName?.trim()) {
		return null;
	}

	const output = await queryDirectShowVideoInputRegistry();
	let current: { friendlyName?: string; clsid?: string } = {};
	const entries: Array<{ friendlyName?: string; clsid?: string }> = [];
	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (/^HKEY_/i.test(line)) {
			if (current.friendlyName || current.clsid) entries.push(current);
			current = {};
			continue;
		}
		const match = line.match(/^(\S+)\s+REG_SZ\s+(.+)$/);
		if (!match) continue;
		if (match[1] === "FriendlyName") current.friendlyName = match[2].trim();
		if (match[1] === "CLSID") current.clsid = match[2].trim();
	}
	if (current.friendlyName || current.clsid) entries.push(current);

	let best: { clsid: string; friendlyName?: string; score: number } | null = null;
	for (const entry of entries) {
		if (!entry.clsid) continue;
		const score = scoreNativeDeviceName(entry.friendlyName ?? "", entry.clsid, deviceName);
		if (!best || score > best.score) {
			best = { clsid: entry.clsid, friendlyName: entry.friendlyName, score };
		}
	}

	if (!best || best.score <= 0) {
		return null;
	}

	console.info("[native-wgc] resolved DirectShow webcam filter", {
		requestedName: deviceName,
		filterName: best.friendlyName,
		clsid: best.clsid,
		score: best.score,
	});
	return best.clsid;
}

async function startCursorRecording(recordingId?: number) {
	if (cursorRecordingSession) {
		pendingCursorRecordingData = await cursorRecordingSession.stop();
		cursorRecordingSession = null;
	}

	pendingCursorRecordingData = null;
	cursorRecordingSession = createCursorRecordingSession({
		getDisplayBounds: getSelectedSourceBounds,
		maxSamples: MAX_CURSOR_SAMPLES,
		platform: process.platform,
		sampleIntervalMs: CURSOR_SAMPLE_INTERVAL_MS,
		sourceId: getSelectedSourceId(),
		startTimeMs:
			typeof recordingId === "number" && Number.isFinite(recordingId) ? recordingId : undefined,
	});

	try {
		await cursorRecordingSession.start();
	} catch (error) {
		console.error("Failed to start cursor recording session:", error);
		cursorRecordingSession = null;
	}
}

async function stopCursorRecording() {
	if (!cursorRecordingSession) {
		return;
	}

	try {
		pendingCursorRecordingData = await cursorRecordingSession.stop();
	} catch (error) {
		console.error("Failed to stop cursor recording session:", error);
		pendingCursorRecordingData = null;
	} finally {
		cursorRecordingSession = null;
	}
}

async function writePendingCursorTelemetry(videoPath: string) {
	const telemetryPath = `${videoPath}.cursor.json`;
	if (pendingCursorRecordingData && pendingCursorRecordingData.samples.length > 0) {
		await fs.writeFile(telemetryPath, JSON.stringify(pendingCursorRecordingData, null, 2), "utf-8");
	}
	pendingCursorRecordingData = null;
}

function shiftPendingCursorTelemetry(offsetMs: number) {
	if (!pendingCursorRecordingData || !Number.isFinite(offsetMs) || offsetMs <= 0) {
		return;
	}

	pendingCursorRecordingData = {
		...pendingCursorRecordingData,
		samples: pendingCursorRecordingData.samples
			.map((sample) => ({
				...sample,
				timeMs: Math.max(0, sample.timeMs - offsetMs),
			}))
			.sort((a, b) => a.timeMs - b.timeMs),
	};
}

function compactPendingCursorTelemetryPauseRanges(
	ranges: Array<{ startMs: number; endMs: number }>,
) {
	if (!pendingCursorRecordingData || ranges.length === 0) {
		return;
	}

	const normalizedRanges = ranges
		.map((range) => ({
			startMs: Math.max(0, Math.min(range.startMs, range.endMs)),
			endMs: Math.max(0, Math.max(range.startMs, range.endMs)),
		}))
		.filter((range) => Number.isFinite(range.startMs) && Number.isFinite(range.endMs))
		.filter((range) => range.endMs > range.startMs)
		.sort((a, b) => a.startMs - b.startMs);

	if (normalizedRanges.length === 0) {
		return;
	}

	pendingCursorRecordingData = {
		...pendingCursorRecordingData,
		samples: pendingCursorRecordingData.samples
			.map((sample) => {
				let pausedBeforeSampleMs = 0;
				for (const range of normalizedRanges) {
					if (sample.timeMs >= range.startMs && sample.timeMs <= range.endMs) {
						return null;
					}
					if (sample.timeMs > range.endMs) {
						pausedBeforeSampleMs += range.endMs - range.startMs;
					}
				}

				return {
					...sample,
					timeMs: Math.max(0, sample.timeMs - pausedBeforeSampleMs),
				};
			})
			.filter((sample): sample is CursorRecordingSample => Boolean(sample))
			.sort((a, b) => a.timeMs - b.timeMs),
	};
}

function completeNativeMacCursorPauseRange(endMs = Date.now()) {
	if (nativeMacPauseStartedAtMs === null || nativeMacCursorRecordingStartMs <= 0) {
		return;
	}

	nativeMacPauseRanges.push({
		startMs: Math.max(0, nativeMacPauseStartedAtMs - nativeMacCursorRecordingStartMs),
		endMs: Math.max(0, endMs - nativeMacCursorRecordingStartMs),
	});
	nativeMacPauseStartedAtMs = null;
}

function completeNativeWindowsCursorPauseRange(endMs = Date.now()) {
	if (nativeWindowsPauseStartedAtMs === null || nativeWindowsCursorRecordingStartMs <= 0) {
		return;
	}

	nativeWindowsPauseRanges.push({
		startMs: Math.max(0, nativeWindowsPauseStartedAtMs - nativeWindowsCursorRecordingStartMs),
		endMs: Math.max(0, endMs - nativeWindowsCursorRecordingStartMs),
	});
	nativeWindowsPauseStartedAtMs = null;
}

function waitForNativeWindowsCaptureStart(proc: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for native Windows capture to start"));
		}, 12000);

		const onOutput = (chunk: Buffer) => {
			nativeWindowsCaptureOutput += chunk.toString();
			if (nativeWindowsCaptureOutput.includes("Recording started")) {
				cleanup();
				resolve();
			}
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					nativeWindowsCaptureOutput.trim() ||
						`Native Windows capture exited before recording started (code=${code ?? "unknown"})`,
				),
			);
		};
		const cleanup = () => {
			clearTimeout(timer);
			proc.stdout.off("data", onOutput);
			proc.stderr.off("data", onOutput);
			proc.off("error", onError);
			proc.off("exit", onExit);
		};

		proc.stdout.on("data", onOutput);
		proc.stderr.on("data", onOutput);
		proc.once("error", onError);
		proc.once("exit", onExit);
	});
}

function waitForNativeWindowsCaptureStop(proc: ChildProcessWithoutNullStreams) {
	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			if (!proc.killed) {
				proc.kill();
			}
			reject(
				new Error(
					`Timed out waiting for native Windows capture to stop. Output path: ${
						nativeWindowsCaptureTargetPath ?? "unknown"
					}. Output: ${nativeWindowsCaptureOutput.trim()}`,
				),
			);
		}, NATIVE_WINDOWS_CAPTURE_STOP_TIMEOUT_MS);
		const onOutput = (chunk: Buffer) => {
			nativeWindowsCaptureOutput += chunk.toString();
		};
		const onClose = (code: number | null) => {
			cleanup();
			const match = nativeWindowsCaptureOutput.match(/Recording stopped\. Output path: (.+)/);
			if (match?.[1]) {
				resolve(match[1].trim());
				return;
			}
			if (code === 0 && nativeWindowsCaptureTargetPath) {
				resolve(nativeWindowsCaptureTargetPath);
				return;
			}
			reject(
				new Error(
					nativeWindowsCaptureOutput.trim() ||
						`Native Windows capture exited with code=${code ?? "unknown"}`,
				),
			);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			clearTimeout(timer);
			proc.stdout.off("data", onOutput);
			proc.stderr.off("data", onOutput);
			proc.off("close", onClose);
			proc.off("error", onError);
		};

		proc.stdout.on("data", onOutput);
		proc.stderr.on("data", onOutput);
		proc.once("close", onClose);
		proc.once("error", onError);
	});
}

function readNativeWindowsWebcamFormat(output: string) {
	const lines = output.split(/\r?\n/).filter((line) => line.includes('"event":"webcam-format"'));
	const lastLine = lines.at(-1);
	if (!lastLine) {
		return null;
	}

	try {
		return JSON.parse(lastLine) as {
			width?: number;
			height?: number;
			fps?: number;
			deviceName?: string;
		};
	} catch {
		return null;
	}
}

function tryParseNativeHelperEvent(line: string) {
	try {
		const parsed = JSON.parse(line);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

function inspectNativeMacCaptureOutput() {
	for (const line of nativeMacCaptureOutput.split(/\r?\n/)) {
		const event = tryParseNativeHelperEvent(line.trim());
		if (event) {
			nativeMacCaptureEvents.emit("helper-event", event);
		}
	}
}

function attachNativeMacCaptureOutputDrain(proc: ChildProcessWithoutNullStreams) {
	let lineBuffer = "";
	const drain = (chunk: Buffer) => {
		const text = chunk.toString();
		nativeMacCaptureOutput += text;
		lineBuffer += text;
		const lines = lineBuffer.split(/\r?\n/);
		lineBuffer = lines.pop() ?? "";
		for (const line of lines) {
			const event = tryParseNativeHelperEvent(line.trim());
			if (event) {
				if (event.event === "recording-diagnostics") {
					console.info("[native-sck] recording diagnostics", event);
				}
				nativeMacCaptureEvents.emit("helper-event", event);
			}
		}
	};
	const cleanup = () => {
		proc.stdout.off("data", drain);
		proc.stderr.off("data", drain);
		proc.off("close", cleanup);
		proc.off("error", cleanup);
	};

	proc.stdout.on("data", drain);
	proc.stderr.on("data", drain);
	proc.once("close", cleanup);
	proc.once("error", cleanup);
}

function waitForNativeMacCaptureStart(proc: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for native macOS capture to start"));
		}, 10_000);

		const inspect = (event: Record<string, unknown>) => {
			if (event.event === "recording-started") {
				cleanup();
				resolve();
				return;
			}
			if (event.event === "error") {
				cleanup();
				reject(new Error(String(event.message ?? event.code ?? "Native macOS capture failed")));
			}
		};

		const onOutput = (event: Record<string, unknown>) => inspect(event);
		const onClose = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					nativeMacCaptureOutput.trim() ||
						`Native macOS capture exited before recording started (code=${code ?? "unknown"})`,
				),
			);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			clearTimeout(timer);
			nativeMacCaptureEvents.off("helper-event", onOutput);
			proc.off("close", onClose);
			proc.off("error", onError);
		};

		nativeMacCaptureEvents.on("helper-event", onOutput);
		proc.once("close", onClose);
		proc.once("error", onError);
		inspectNativeMacCaptureOutput();
	});
}

function waitForNativeMacCaptureEvent(
	proc: ChildProcessWithoutNullStreams,
	expectedEvent: "recording-paused" | "recording-resumed",
	timeoutMs = 30_000,
) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for native macOS ${expectedEvent}`));
		}, timeoutMs);
		const onOutput = (event: Record<string, unknown>) => {
			if (event.event === expectedEvent) {
				cleanup();
				resolve();
				return;
			}
			if (event.event === "error") {
				cleanup();
				reject(new Error(String(event.message ?? event.code ?? "Native macOS capture failed")));
			}
		};
		const onClose = (code: number | null) => {
			cleanup();
			reject(new Error(`Native macOS capture exited during ${expectedEvent} (code=${code})`));
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			clearTimeout(timer);
			nativeMacCaptureEvents.off("helper-event", onOutput);
			proc.off("close", onClose);
			proc.off("error", onError);
		};

		nativeMacCaptureEvents.on("helper-event", onOutput);
		proc.once("close", onClose);
		proc.once("error", onError);
	});
}

function waitForNativeMacCaptureStop(proc: ChildProcessWithoutNullStreams) {
	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(
				new Error(
					`Timed out waiting for native macOS capture to stop. Output path: ${
						nativeMacCaptureTargetPath ?? "unknown"
					}. Output: ${nativeMacCaptureOutput.trim()}`,
				),
			);
		}, 120_000);

		const inspect = (event: Record<string, unknown>) => {
			if (event.event === "recording-stopped") {
				cleanup();
				resolve(String(event.screenPath ?? nativeMacCaptureTargetPath ?? ""));
				return;
			}
			if (event.event === "error") {
				cleanup();
				reject(new Error(String(event.message ?? event.code ?? "Native macOS capture failed")));
			}
		};

		const onOutput = (event: Record<string, unknown>) => inspect(event);
		const onClose = (code: number | null) => {
			if (code === 0 && nativeMacCaptureTargetPath) {
				cleanup();
				resolve(nativeMacCaptureTargetPath);
				return;
			}
			cleanup();
			reject(
				new Error(
					nativeMacCaptureOutput.trim() ||
						`Native macOS capture exited with code=${code ?? "unknown"}`,
				),
			);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			clearTimeout(timer);
			nativeMacCaptureEvents.off("helper-event", onOutput);
			proc.off("close", onClose);
			proc.off("error", onError);
		};

		nativeMacCaptureEvents.on("helper-event", onOutput);
		proc.once("close", onClose);
		proc.once("error", onError);
		inspectNativeMacCaptureOutput();
	});
}

function setCurrentRecordingSessionState(session: RecordingSession | null) {
	currentRecordingSession = session;
	currentVideoPath = session?.screenVideoPath ?? null;
}

function getSessionManifestPathForVideo(videoPath: string) {
	const parsedPath = path.parse(videoPath);
	const baseName = parsedPath.name.endsWith("-webcam")
		? parsedPath.name.slice(0, -"-webcam".length)
		: parsedPath.name;
	return path.join(parsedPath.dir, `${baseName}${RECORDING_SESSION_SUFFIX}`);
}

async function loadRecordedSessionForVideoPath(
	videoPath: string,
): Promise<RecordingSession | null> {
	try {
		const manifestPath = getSessionManifestPathForVideo(videoPath);
		if (!isPathAllowed(manifestPath)) {
			const parsedVideoPath = path.parse(videoPath);
			if (!isPathWithinDir(path.resolve(manifestPath), parsedVideoPath.dir)) {
				return null;
			}
		}

		const content = await fs.readFile(manifestPath, "utf-8");
		const session = normalizeRecordingSession(JSON.parse(content));
		if (!session) {
			return null;
		}

		const normalizedVideoPath = normalizePath(videoPath);
		const matchesScreen = normalizePath(session.screenVideoPath) === normalizedVideoPath;
		const matchesWebcam =
			typeof session.webcamVideoPath === "string" &&
			normalizePath(session.webcamVideoPath) === normalizedVideoPath;
		if (!matchesScreen && !matchesWebcam) {
			return null;
		}

		if (!isPathAllowed(session.screenVideoPath)) {
			const approvedScreen = await approveReadableVideoPath(session.screenVideoPath, [
				path.dirname(manifestPath),
				RECORDINGS_DIR,
			]);
			if (!approvedScreen) {
				return null;
			}
			session.screenVideoPath = approvedScreen;
		}

		if (session.webcamVideoPath && !isPathAllowed(session.webcamVideoPath)) {
			const approvedWebcam = await approveReadableVideoPath(session.webcamVideoPath, [
				path.dirname(manifestPath),
				RECORDINGS_DIR,
			]);
			if (!approvedWebcam) {
				session.webcamVideoPath = undefined;
			} else {
				session.webcamVideoPath = approvedWebcam;
			}
		}

		approveFilePath(session.screenVideoPath);
		if (session.webcamVideoPath) {
			approveFilePath(session.webcamVideoPath);
		}
		return session;
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code !== "ENOENT") {
			console.error("Failed to restore recording session manifest:", error);
		}
		return null;
	}
}

export function registerIpcHandlers(
	createEditorWindow: () => void,
	createSourceSelectorWindow: () => BrowserWindow,
	createCountdownOverlayWindow: () => BrowserWindow,
	getMainWindow: () => BrowserWindow | null,
	getSourceSelectorWindow: () => BrowserWindow | null,
	getCountdownOverlayWindow?: () => BrowserWindow | null,
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
	_switchToHud?: () => void,
) {
	async function requestScreenAccess() {
		if (process.platform !== "darwin") {
			return { success: true, granted: true, status: "granted" };
		}

		try {
			const status = systemPreferences.getMediaAccessStatus("screen");
			if (status === "granted") {
				return { success: true, granted: true, status };
			}

			// Screen recording has no askForMediaAccess equivalent, so trigger the
			// TCC prompt without opening OpenScreen's source selector above it.
			if (status === "not-determined") {
				const mainWin = getMainWindow();
				if (mainWin && !mainWin.isDestroyed()) {
					if (!mainWin.isVisible()) {
						mainWin.show();
					}
					mainWin.focus();
				}
				app.focus({ steal: true });
				desktopCapturer
					.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } })
					.catch(() => {
						// Permission probing failure is reported by the explicit status check below.
					});
				return { success: true, granted: false, status: "not-determined" };
			}

			return { success: true, granted: false, status };
		} catch (error) {
			console.error("Failed to request screen access:", error);
			return { success: false, granted: false, status: "unknown", error: String(error) };
		}
	}

	ipcMain.handle("get-sources", async (_, opts) => {
		const sources = await desktopCapturer.getSources(opts);
		lastEnumeratedSources = new Map(sources.map((source) => [source.id, source]));
		return sources.map((source) => ({
			id: source.id,
			name: source.name,
			display_id: source.display_id,
			thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
			appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
		}));
	});

	// Enumerates windows across ALL Spaces via the ScreenCaptureKit helper.
	// desktopCapturer only reports windows on the current Space, so full-screen
	// apps living on other Spaces are invisible to the picker without this.
	ipcMain.handle("list-native-windows", async () => {
		try {
			if (process.platform !== "darwin" || !isNativeMacCaptureOsSupported()) {
				return { success: true, windows: [] };
			}
			const helperPath = await findNativeMacCaptureHelperPath();
			if (!helperPath) return { success: true, windows: [] };

			const thumbnailDir = await fs.mkdtemp(path.join(os.tmpdir(), "openscreen-native-windows-"));
			try {
				const startedAt = Date.now();
				const result = await runProcess(helperPath, ["list-windows", thumbnailDir], {
					timeoutMs: 20_000,
				});
				if (result.code !== 0) {
					const reason = result.timedOut
						? "Timed out enumerating windows"
						: result.stderr || result.stdout || "Failed to enumerate windows";
					console.warn(`list-native-windows helper failed (code ${result.code}): ${reason}`);
					return { success: false, message: reason };
				}
				interface NativeWindowEntry {
					windowId?: number;
					title?: string;
					appName?: string;
					isOnScreen?: boolean;
					thumbnailPath?: string;
				}
				let windows: NativeWindowEntry[] = [];
				for (const line of result.stdout.split("\n")) {
					if (!line.trim()) continue;
					try {
						const parsed = JSON.parse(line) as { event?: string; windows?: NativeWindowEntry[] };
						if (parsed?.event === "windows" && Array.isArray(parsed.windows)) {
							windows = parsed.windows;
						}
					} catch {
						// Non-JSON helper output line.
					}
				}
				console.log(
					`list-native-windows: ${windows.length} windows in ${Date.now() - startedAt}ms`,
				);
				const mapped = await Promise.all(
					windows
						.filter((win) => typeof win.windowId === "number")
						.map(async (win) => {
							let thumbnail: string | null = null;
							if (typeof win.thumbnailPath === "string") {
								try {
									const bytes = await fs.readFile(win.thumbnailPath);
									thumbnail = `data:image/png;base64,${bytes.toString("base64")}`;
								} catch {
									// Screenshot failed for this window; card renders without one.
								}
							}
							const title = String(win.title ?? "");
							const appName = String(win.appName ?? "");
							return {
								// Same id shape Electron's desktopCapturer uses, so the native
								// recording path parses the windowId without special-casing.
								id: `window:${win.windowId}:0`,
								windowId: Number(win.windowId),
								name: [appName, title].filter(Boolean).join(" — ") || title || appName,
								appName,
								title,
								isOnScreen: Boolean(win.isOnScreen),
								thumbnail,
							};
						}),
				);
				return { success: true, windows: mapped };
			} finally {
				await fs.rm(thumbnailDir, { recursive: true, force: true }).catch(() => undefined);
			}
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle("select-source", async (_, source: SelectedSource) => {
		selectedSource = source;
		// Reuse the exact source object returned during enumeration to avoid
		// Windows window-source id mismatches across separate getSources() calls.
		selectedDesktopSource =
			typeof source.id === "string" ? (lastEnumeratedSources.get(source.id) ?? null) : null;

		if (!selectedDesktopSource && typeof source.id === "string") {
			try {
				const sources = await desktopCapturer.getSources({
					types: ["screen", "window"],
					thumbnailSize: { width: 0, height: 0 },
					fetchWindowIcons: true,
				});
				lastEnumeratedSources = new Map(sources.map((candidate) => [candidate.id, candidate]));
				selectedDesktopSource = lastEnumeratedSources.get(source.id) ?? null;
			} catch {
				selectedDesktopSource = null;
			}
		}
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.close();
		}
		return selectedSource;
	});

	ipcMain.handle("get-selected-source", () => {
		return selectedSource;
	});

	ipcMain.handle("request-camera-access", async () => {
		if (process.platform !== "darwin") {
			return { success: true, granted: true, status: "granted" };
		}

		try {
			const status = systemPreferences.getMediaAccessStatus("camera");
			if (status === "granted") {
				return { success: true, granted: true, status };
			}

			if (status === "not-determined") {
				const granted = await systemPreferences.askForMediaAccess("camera");
				return {
					success: true,
					granted,
					status: granted ? "granted" : systemPreferences.getMediaAccessStatus("camera"),
				};
			}

			return { success: true, granted: false, status };
		} catch (error) {
			console.error("Failed to request camera access:", error);
			return {
				success: false,
				granted: false,
				status: "unknown",
				error: String(error),
			};
		}
	});

	ipcMain.handle("request-screen-access", async () => {
		return requestScreenAccess();
	});

	ipcMain.handle("request-native-mac-cursor-access", async () => {
		const access = await requestMacCursorAccessibilityAccess();
		// Accessibility is an optional enhancement. The cursor helper still emits
		// position and bitmap data without AX trust, so callers can continue the
		// recording and simply omit text/pointer affordance classification.
		return access;
	});

	ipcMain.handle("open-source-selector", async () => {
		const access = await requestScreenAccess();
		if (!access.granted) {
			if (process.platform === "darwin" && access.status !== "not-determined") {
				const mainWin = getMainWindow();
				const messageOptions = {
					type: "warning",
					buttons: ["Open System Settings", "Cancel"],
					defaultId: 0,
					cancelId: 1,
					message: "Screen Recording permission is required",
					detail:
						"Allow OpenScreen in macOS System Settings, then come back and choose a screen or window.",
				} satisfies Electron.MessageBoxOptions;
				const result =
					mainWin && !mainWin.isDestroyed()
						? await dialog.showMessageBox(mainWin, messageOptions)
						: await dialog.showMessageBox(messageOptions);
				if (result.response === 0) {
					await shell.openExternal(
						"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
					);
				}
			}
			return {
				opened: false,
				reason: "screen-access-required",
				access,
			};
		}

		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.focus();
			return { opened: true };
		}
		createSourceSelectorWindow();
		return { opened: true };
	});

	ipcMain.handle("switch-to-editor", () => {
		// createEditorWindow already closes the current mainWindow (the HUD) before
		// opening the editor. Closing it here too double-closes, leaving ghost
		// transparent windows and compounding the HUD shadow each cycle.
		createEditorWindow();
	});

	ipcMain.handle("switch-to-hud", () => {
		_switchToHud?.();
		return { success: true };
	});

	ipcMain.handle("start-new-recording", () => {
		_switchToHud?.();
		return { success: true };
	});

	ipcMain.handle("countdown-overlay-show", async (_, value: number, runId: number) => {
		const overlayWindow = getCountdownOverlayWindow?.() ?? createCountdownOverlayWindow();
		if (overlayWindow.isDestroyed()) {
			return;
		}

		// Wait for the first frame before showing, else Chromium flashes a black
		// rectangle because it hasn't rendered any pixels yet.
		if (overlayWindow.webContents.isLoading()) {
			await new Promise<void>((resolve) => {
				overlayWindow.once("ready-to-show", resolve);
			});
		}

		if (!overlayWindow.isVisible()) {
			overlayWindow.showInactive();
		}

		overlayWindow.webContents.send("countdown-overlay-value", value, runId);
	});

	ipcMain.handle("countdown-overlay-set-value", (_, value: number, runId: number) => {
		const overlayWindow = getCountdownOverlayWindow?.();
		if (!overlayWindow || overlayWindow.isDestroyed()) {
			return;
		}

		overlayWindow.webContents.send("countdown-overlay-value", value, runId);
	});

	ipcMain.handle("countdown-overlay-hide", (_, runId: number) => {
		const overlayWindow = getCountdownOverlayWindow?.();
		if (!overlayWindow || overlayWindow.isDestroyed()) {
			return;
		}

		overlayWindow.webContents.send("countdown-overlay-value", null, runId);
		overlayWindow.hide();
	});

	ipcMain.handle("is-native-windows-capture-available", async () => {
		if (!isWindowsGraphicsCaptureOsSupported()) {
			return { success: true, available: false, reason: "unsupported-os" };
		}

		const helperPath = await findNativeWindowsCaptureHelperPath();
		return helperPath
			? { success: true, available: true, helperPath }
			: { success: true, available: false, reason: "missing-helper" };
	});

	ipcMain.handle("is-native-mac-capture-available", async () => {
		if (!isNativeMacCaptureOsSupported()) {
			return { success: true, available: false, reason: "unsupported-platform" };
		}

		const helperPath = await findNativeMacCaptureHelperPath();
		return helperPath
			? { success: true, available: true, helperPath }
			: { success: true, available: false, reason: "missing-helper" };
	});

	ipcMain.handle(
		"start-native-windows-recording",
		async (_, request: NativeWindowsRecordingRequest) => {
			try {
				if (!isWindowsGraphicsCaptureOsSupported()) {
					return {
						success: false,
						error: "Windows Graphics Capture requires Windows 10 build 19041 or newer.",
					};
				}
				if (nativeWindowsCaptureProcess) {
					return { success: false, error: "Native Windows capture is already running." };
				}

				const helperPath = await findNativeWindowsCaptureHelperPath();
				if (!helperPath) {
					return { success: false, error: "Native Windows capture helper is not available." };
				}

				if (!request?.source?.sourceId) {
					return {
						success: false,
						error: "Native Windows capture request is missing a source.",
					};
				}

				const recordingId =
					typeof request.recordingId === "number" && Number.isFinite(request.recordingId)
						? request.recordingId
						: Date.now();
				const outputPath = path.join(RECORDINGS_DIR, `${RECORDING_FILE_PREFIX}${recordingId}.mp4`);
				const webcamOutputPath = path.join(
					RECORDINGS_DIR,
					`${RECORDING_FILE_PREFIX}${recordingId}-webcam.mp4`,
				);
				const sourceDisplay =
					request.source.type === "display" && typeof request.source.displayId === "number"
						? (screen.getAllDisplays().find((display) => display.id === request.source.displayId) ??
							null)
						: getSelectedDisplay();
				const bounds = sourceDisplay?.bounds ?? getSelectedSourceBounds();
				const displayId =
					typeof request.source.displayId === "number" && Number.isFinite(request.source.displayId)
						? request.source.displayId
						: Number(selectedSource?.display_id);
				const webcamDirectShowClsid = request.webcam.enabled
					? await resolveDirectShowWebcamClsid(request.webcam.deviceName)
					: null;
				const cursorCaptureMode =
					normalizeCursorCaptureMode(request.cursor?.mode) ?? "editable-overlay";
				const config = {
					schemaVersion: 2,
					recordingId,
					outputPath,
					sourceType: request.source.type,
					sourceId: request.source.sourceId,
					displayId: Number.isFinite(displayId) ? displayId : 0,
					windowHandle: request.source.windowHandle ?? null,
					fps: request.video.fps,
					videoWidth: request.video.width,
					videoHeight: request.video.height,
					displayX: bounds.x,
					displayY: bounds.y,
					displayW: bounds.width,
					displayH: bounds.height,
					hasDisplayBounds: true,
					captureSystemAudio: request.audio.system.enabled,
					captureMic: request.audio.microphone.enabled,
					microphoneDeviceId: request.audio.microphone.deviceId ?? null,
					microphoneDeviceName: request.audio.microphone.deviceName ?? null,
					microphoneGain: request.audio.microphone.gain,
					webcamEnabled: request.webcam.enabled,
					webcamDeviceId: request.webcam.deviceId ?? null,
					webcamDeviceName: request.webcam.deviceName ?? null,
					webcamDirectShowClsid,
					webcamWidth: request.webcam.width,
					webcamHeight: request.webcam.height,
					webcamFps: request.webcam.fps,
					captureCursor: cursorCaptureMode === "system",
					cursorCaptureMode,
					outputs: {
						screenPath: outputPath,
						webcamPath: webcamOutputPath,
					},
					source: {
						type: request.source.type,
						sourceId: request.source.sourceId,
						displayId: Number.isFinite(displayId) ? displayId : null,
						windowHandle: request.source.windowHandle ?? null,
						bounds,
					},
					video: request.video,
					audio: request.audio,
					webcam: request.webcam,
					cursor: {
						mode: cursorCaptureMode,
					},
				};

				console.info("[native-wgc] starting Windows capture", {
					helperPath,
					source: request.source,
					audio: request.audio,
					webcam: request.webcam,
					cursor: { mode: cursorCaptureMode },
					bounds,
					sourceId: selectedSource?.id ?? null,
					usedDisplayMatch: Boolean(sourceDisplay),
					outputPath,
				});

				await fs.mkdir(RECORDINGS_DIR, { recursive: true });
				nativeWindowsCaptureOutput = "";
				nativeWindowsCaptureTargetPath = outputPath;
				nativeWindowsCaptureWebcamTargetPath = request.webcam.enabled ? webcamOutputPath : null;
				nativeWindowsCaptureRecordingId = recordingId;
				nativeWindowsCursorOffsetMs = 0;
				nativeWindowsCursorCaptureMode = cursorCaptureMode;
				nativeWindowsCursorRecordingStartMs = 0;
				nativeWindowsPauseStartedAtMs = null;
				nativeWindowsPauseRanges = [];
				nativeWindowsIsPaused = false;

				const cursorStartTimeMs = Date.now();
				if (cursorCaptureMode === "editable-overlay") {
					nativeWindowsCursorRecordingStartMs = cursorStartTimeMs;
					await startCursorRecording(cursorStartTimeMs);
					console.info("[native-wgc] cursor sampler ready", {
						cursorStartTimeMs,
						warmupMs: Date.now() - cursorStartTimeMs,
					});
				} else {
					pendingCursorRecordingData = null;
				}

				const proc = spawn(helperPath, [JSON.stringify(config)], {
					cwd: RECORDINGS_DIR,
					stdio: ["pipe", "pipe", "pipe"],
					windowsHide: true,
				});
				nativeWindowsCaptureProcess = proc;

				await waitForNativeWindowsCaptureStart(proc);
				const captureStartedAtMs = Date.now();
				nativeWindowsCursorOffsetMs =
					cursorCaptureMode === "editable-overlay"
						? Math.max(0, captureStartedAtMs - cursorStartTimeMs)
						: 0;
				const webcamFormat = readNativeWindowsWebcamFormat(nativeWindowsCaptureOutput);
				console.info("[native-wgc] capture started", {
					captureStartedAtMs,
					cursorOffsetMs: nativeWindowsCursorOffsetMs,
					webcamFormat,
				});

				const source = selectedSource || { name: "Screen" };
				if (onRecordingStateChange) {
					onRecordingStateChange(true, source.name);
				}

				return {
					success: true,
					recordingId,
					path: outputPath,
					helperPath,
				};
			} catch (error) {
				console.error("Failed to start native Windows recording:", error);
				nativeWindowsCaptureProcess?.kill();
				nativeWindowsCaptureProcess = null;
				nativeWindowsCaptureTargetPath = null;
				nativeWindowsCaptureWebcamTargetPath = null;
				nativeWindowsCaptureRecordingId = null;
				nativeWindowsCursorOffsetMs = 0;
				nativeWindowsCursorCaptureMode = "editable-overlay";
				nativeWindowsCursorRecordingStartMs = 0;
				nativeWindowsPauseStartedAtMs = null;
				nativeWindowsPauseRanges = [];
				nativeWindowsIsPaused = false;
				await stopCursorRecording();
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle("start-native-mac-recording", async (_, request: NativeMacRecordingRequest) => {
		try {
			if (!isNativeMacCaptureOsSupported()) {
				return { success: false, error: "Native macOS capture requires macOS 15 or newer." };
			}
			if (nativeMacCaptureProcess) {
				return { success: false, error: "Native macOS capture is already running." };
			}

			const helperPath = await findNativeMacCaptureHelperPath();
			if (!helperPath) {
				return { success: false, error: "Native macOS capture helper is not available." };
			}

			if (!request?.source?.sourceId) {
				return { success: false, error: "Native macOS capture request is missing a source." };
			}

			const recordingId =
				typeof request.recordingId === "number" && Number.isFinite(request.recordingId)
					? request.recordingId
					: Date.now();
			const outputPath = path.join(RECORDINGS_DIR, `${RECORDING_FILE_PREFIX}${recordingId}.mp4`);
			const cursorCaptureMode =
				normalizeCursorCaptureMode(request.cursor?.mode) ?? "editable-overlay";
			try {
				await desktopCapturer.getSources({
					types: ["screen"],
					thumbnailSize: { width: 1, height: 1 },
				});
			} catch {
				// The helper reports the final ScreenCaptureKit permission status.
			}
			if (request.audio?.microphone?.enabled) {
				const micStatus = systemPreferences.getMediaAccessStatus("microphone");
				if (micStatus !== "granted") {
					await systemPreferences.askForMediaAccess("microphone");
				}
			}
			const sourceDisplay =
				request.source.type === "display" && typeof request.source.displayId === "number"
					? (screen.getAllDisplays().find((display) => display.id === request.source.displayId) ??
						null)
					: getSelectedDisplay();
			const bounds = request.source.bounds ?? sourceDisplay?.bounds ?? getSelectedSourceBounds();
			const config: NativeMacRecordingRequest = {
				...request,
				schemaVersion: 1,
				recordingId,
				source: {
					...request.source,
					bounds,
				},
				video: {
					...request.video,
					hideSystemCursor: cursorCaptureMode === "editable-overlay",
				},
				webcam: {
					...request.webcam,
					enabled: false,
				},
				cursor: {
					mode: cursorCaptureMode,
				},
				outputs: {
					screenPath: outputPath,
					manifestPath: path.join(
						RECORDINGS_DIR,
						`${RECORDING_FILE_PREFIX}${recordingId}${RECORDING_SESSION_SUFFIX}`,
					),
				},
			};

			console.info("[native-sck] starting macOS capture", {
				helperPath,
				source: config.source,
				audio: config.audio,
				webcam: config.webcam,
				cursor: config.cursor,
				outputPath,
			});

			await fs.mkdir(RECORDINGS_DIR, { recursive: true });
			nativeMacCaptureOutput = "";
			nativeMacCaptureTargetPath = outputPath;
			nativeMacCaptureRecordingId = recordingId;
			// The helper muxes enabled audio sources as separate tracks after the
			// video track, system audio first.
			nativeMacAudioStreams = [
				...(config.audio?.system?.enabled ? (["system"] as const) : []),
				...(config.audio?.microphone?.enabled ? (["microphone"] as const) : []),
			];
			nativeMacCursorOffsetMs = 0;
			nativeMacCursorCaptureMode = cursorCaptureMode;
			nativeMacCursorRecordingStartMs = 0;
			nativeMacPauseStartedAtMs = null;
			nativeMacPauseRanges = [];
			nativeMacIsPaused = false;

			const cursorStartTimeMs = Date.now();
			if (cursorCaptureMode === "editable-overlay") {
				nativeMacCursorRecordingStartMs = cursorStartTimeMs;
				await startCursorRecording(cursorStartTimeMs);
			} else {
				pendingCursorRecordingData = null;
			}

			const proc = spawn(helperPath, [JSON.stringify(config)], {
				cwd: RECORDINGS_DIR,
				stdio: ["pipe", "pipe", "pipe"],
			});
			nativeMacCaptureProcess = proc;
			attachNativeMacCaptureOutputDrain(proc);

			await waitForNativeMacCaptureStart(proc);
			const captureStartedAtMs = Date.now();
			nativeMacCursorOffsetMs =
				cursorCaptureMode === "editable-overlay"
					? Math.max(0, captureStartedAtMs - cursorStartTimeMs)
					: 0;

			const source = selectedSource || { name: "Screen" };
			if (onRecordingStateChange) {
				onRecordingStateChange(true, source.name);
			}

			return {
				success: true,
				recordingId,
				path: outputPath,
				helperPath,
			};
		} catch (error) {
			console.error("Failed to start native macOS recording:", error);
			nativeMacCaptureProcess?.kill();
			nativeMacCaptureProcess = null;
			nativeMacCaptureTargetPath = null;
			nativeMacCaptureRecordingId = null;
			nativeMacAudioStreams = null;
			nativeMacCursorOffsetMs = 0;
			nativeMacCursorCaptureMode = "editable-overlay";
			nativeMacCursorRecordingStartMs = 0;
			nativeMacPauseStartedAtMs = null;
			nativeMacPauseRanges = [];
			nativeMacIsPaused = false;
			await stopCursorRecording();
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle("pause-native-mac-recording", async () => {
		if (process.platform !== "darwin") {
			return { success: false, error: "Native macOS capture requires macOS." };
		}

		const proc = nativeMacCaptureProcess;
		if (!proc) {
			return { success: false, error: "Native macOS capture is not running." };
		}
		if (nativeMacIsPaused) {
			return { success: true };
		}
		if (!proc.stdin.writable) {
			return { success: false, error: "Native macOS capture command channel is closed." };
		}

		try {
			const pausedPromise = waitForNativeMacCaptureEvent(proc, "recording-paused");
			proc.stdin.write("pause\n");
			await pausedPromise;
			nativeMacIsPaused = true;
			nativeMacPauseStartedAtMs = Date.now();
			return { success: true };
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle("resume-native-mac-recording", async () => {
		if (process.platform !== "darwin") {
			return { success: false, error: "Native macOS capture requires macOS." };
		}

		const proc = nativeMacCaptureProcess;
		if (!proc) {
			return { success: false, error: "Native macOS capture is not running." };
		}
		if (!nativeMacIsPaused) {
			return { success: true };
		}
		if (!proc.stdin.writable) {
			return { success: false, error: "Native macOS capture command channel is closed." };
		}

		try {
			const resumedPromise = waitForNativeMacCaptureEvent(proc, "recording-resumed");
			proc.stdin.write("resume\n");
			await resumedPromise;
			completeNativeMacCursorPauseRange();
			nativeMacIsPaused = false;
			return { success: true };
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle("pause-native-windows-recording", async () => {
		const proc = nativeWindowsCaptureProcess;
		if (!proc) {
			return { success: false, error: "Native Windows capture is not running." };
		}
		if (nativeWindowsIsPaused) {
			return { success: true };
		}
		if (!proc.stdin.writable) {
			return { success: false, error: "Native Windows capture command channel is closed." };
		}

		try {
			proc.stdin.write("pause\n");
			nativeWindowsIsPaused = true;
			nativeWindowsPauseStartedAtMs = Date.now();
			return { success: true };
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle("resume-native-windows-recording", async () => {
		const proc = nativeWindowsCaptureProcess;
		if (!proc) {
			return { success: false, error: "Native Windows capture is not running." };
		}
		if (!nativeWindowsIsPaused) {
			return { success: true };
		}
		if (!proc.stdin.writable) {
			return { success: false, error: "Native Windows capture command channel is closed." };
		}

		try {
			proc.stdin.write("resume\n");
			completeNativeWindowsCursorPauseRange();
			nativeWindowsIsPaused = false;
			return { success: true };
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle("stop-native-windows-recording", async (_, discard?: boolean) => {
		const proc = nativeWindowsCaptureProcess;
		const preferredPath = nativeWindowsCaptureTargetPath;
		const preferredWebcamPath = nativeWindowsCaptureWebcamTargetPath;
		const recordingId = nativeWindowsCaptureRecordingId ?? Date.now();
		const cursorCaptureMode = nativeWindowsCursorCaptureMode;

		if (!proc) {
			return { success: false, error: "Native Windows capture is not running." };
		}

		try {
			completeNativeWindowsCursorPauseRange();
			const stoppedPathPromise = waitForNativeWindowsCaptureStop(proc);
			proc.stdin.write("stop\n");
			const stoppedPath = await stoppedPathPromise;
			const screenVideoPath = stoppedPath || preferredPath;
			if (!screenVideoPath) {
				throw new Error("Native Windows capture did not return an output path.");
			}

			if (cursorCaptureMode === "editable-overlay") {
				await stopCursorRecording();
			} else {
				pendingCursorRecordingData = null;
			}
			if (discard) {
				pendingCursorRecordingData = null;
				await Promise.all([
					fs.rm(screenVideoPath, { force: true }),
					preferredWebcamPath ? fs.rm(preferredWebcamPath, { force: true }) : Promise.resolve(),
					fs.rm(`${screenVideoPath}.cursor.json`, { force: true }),
				]);
				return { success: true, discarded: true };
			}

			if (cursorCaptureMode === "editable-overlay") {
				compactPendingCursorTelemetryPauseRanges(nativeWindowsPauseRanges);
				shiftPendingCursorTelemetry(nativeWindowsCursorOffsetMs);
				await writePendingCursorTelemetry(screenVideoPath);
			}
			let webcamVideoPath: string | undefined;
			if (preferredWebcamPath) {
				try {
					await fs.access(preferredWebcamPath, fsConstants.R_OK);
					webcamVideoPath = preferredWebcamPath;
				} catch {
					webcamVideoPath = undefined;
				}
			}
			const session: RecordingSession = webcamVideoPath
				? { screenVideoPath, webcamVideoPath, createdAt: recordingId, cursorCaptureMode }
				: { screenVideoPath, createdAt: recordingId, cursorCaptureMode };
			setCurrentRecordingSessionState(session);
			currentProjectPath = null;

			const sessionManifestPath = path.join(
				RECORDINGS_DIR,
				`${path.parse(screenVideoPath).name}${RECORDING_SESSION_SUFFIX}`,
			);
			await fs.writeFile(sessionManifestPath, JSON.stringify(session, null, 2), "utf-8");

			return {
				success: true,
				path: screenVideoPath,
				session,
				message: "Native Windows recording session stored successfully",
			};
		} catch (error) {
			console.error("Failed to stop native Windows recording:", error);
			await stopCursorRecording();
			return { success: false, error: String(error) };
		} finally {
			nativeWindowsCaptureProcess = null;
			nativeWindowsCaptureTargetPath = null;
			nativeWindowsCaptureWebcamTargetPath = null;
			nativeWindowsCaptureRecordingId = null;
			nativeWindowsCursorOffsetMs = 0;
			nativeWindowsCursorCaptureMode = "editable-overlay";
			nativeWindowsCursorRecordingStartMs = 0;
			nativeWindowsPauseStartedAtMs = null;
			nativeWindowsPauseRanges = [];
			nativeWindowsIsPaused = false;
			const source = selectedSource || { name: "Screen" };
			if (onRecordingStateChange) {
				onRecordingStateChange(false, source.name);
			}
		}
	});

	ipcMain.handle("stop-native-mac-recording", async (_, discard?: boolean) => {
		if (process.platform !== "darwin") {
			return { success: false, error: "Native macOS capture requires macOS." };
		}

		const proc = nativeMacCaptureProcess;
		const preferredPath = nativeMacCaptureTargetPath;
		const recordingId = nativeMacCaptureRecordingId ?? Date.now();
		const cursorCaptureMode = nativeMacCursorCaptureMode;
		const audioStreams = nativeMacAudioStreams;

		if (!proc) {
			return { success: false, error: "Native macOS capture is not running." };
		}

		try {
			completeNativeMacCursorPauseRange();
			const stoppedPathPromise = waitForNativeMacCaptureStop(proc);
			proc.stdin.write("stop\n");
			const stoppedPath = await stoppedPathPromise;
			const screenVideoPath = stoppedPath || preferredPath;
			if (!screenVideoPath) {
				throw new Error("Native macOS capture did not return an output path.");
			}

			if (cursorCaptureMode === "editable-overlay") {
				await stopCursorRecording();
			} else {
				pendingCursorRecordingData = null;
			}
			if (discard) {
				pendingCursorRecordingData = null;
				await Promise.all([
					fs.rm(screenVideoPath, { force: true }),
					fs.rm(`${screenVideoPath}.cursor.json`, { force: true }),
					fs.rm(`${screenVideoPath}.diagnostics.json`, { force: true }),
				]);
				return { success: true, discarded: true };
			}

			if (cursorCaptureMode === "editable-overlay") {
				compactPendingCursorTelemetryPauseRanges(nativeMacPauseRanges);
				shiftPendingCursorTelemetry(nativeMacCursorOffsetMs);
				await writePendingCursorTelemetry(screenVideoPath);
			}

			const session: RecordingSession = {
				screenVideoPath,
				createdAt: recordingId,
				cursorCaptureMode,
				...(audioStreams?.length ? { audioStreams } : {}),
			};
			setCurrentRecordingSessionState(session);
			currentProjectPath = null;

			const sessionManifestPath = path.join(
				RECORDINGS_DIR,
				`${path.parse(screenVideoPath).name}${RECORDING_SESSION_SUFFIX}`,
			);
			await fs.writeFile(sessionManifestPath, JSON.stringify(session, null, 2), "utf-8");

			return {
				success: true,
				path: screenVideoPath,
				session,
				message: "Native macOS recording session stored successfully",
			};
		} catch (error) {
			console.error("Failed to stop native macOS recording:", error);
			await stopCursorRecording();
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		} finally {
			nativeMacCaptureProcess = null;
			nativeMacCaptureTargetPath = null;
			nativeMacCaptureRecordingId = null;
			nativeMacAudioStreams = null;
			nativeMacCursorOffsetMs = 0;
			nativeMacCursorCaptureMode = "editable-overlay";
			nativeMacCursorRecordingStartMs = 0;
			nativeMacPauseStartedAtMs = null;
			nativeMacPauseRanges = [];
			nativeMacIsPaused = false;
			const source = selectedSource || { name: "Screen" };
			if (onRecordingStateChange) {
				onRecordingStateChange(false, source.name);
			}
		}
	});

	ipcMain.handle(
		"attach-native-mac-webcam-recording",
		async (_, payload: AttachNativeMacWebcamRecordingInput) => {
			try {
				if (process.platform !== "darwin") {
					return { success: false, error: "Native macOS webcam attachment requires macOS." };
				}

				const screenVideoPath = normalizeVideoSourcePath(payload.screenVideoPath);
				if (!screenVideoPath || !isPathWithinDir(screenVideoPath, RECORDINGS_DIR)) {
					return {
						success: false,
						error: "Native macOS webcam attachment requires a recording output path.",
					};
				}

				await fs.access(screenVideoPath, fsConstants.R_OK);

				if (!payload.webcam?.fileName || !payload.webcam.videoData) {
					return { success: false, error: "Native macOS webcam attachment is missing video data." };
				}

				const webcamVideoPath = resolveRecordingOutputPath(payload.webcam.fileName);
				await fs.writeFile(webcamVideoPath, Buffer.from(payload.webcam.videoData));

				const createdAt =
					typeof payload.recordingId === "number" && Number.isFinite(payload.recordingId)
						? payload.recordingId
						: Date.now();
				const cursorCaptureMode = normalizeCursorCaptureMode(payload.cursorCaptureMode);
				// The screen recording's stop handler already stored the session with its
				// audio stream layout; carry it over instead of dropping it.
				const existingSession =
					currentRecordingSession?.screenVideoPath === screenVideoPath
						? currentRecordingSession
						: await loadRecordedSessionForVideoPath(screenVideoPath);
				const audioStreams = existingSession?.audioStreams;
				const session: RecordingSession = {
					screenVideoPath,
					webcamVideoPath,
					createdAt,
					...(cursorCaptureMode ? { cursorCaptureMode } : {}),
					...(audioStreams?.length ? { audioStreams } : {}),
				};
				setCurrentRecordingSessionState(session);
				currentProjectPath = null;

				const sessionManifestPath = path.join(
					RECORDINGS_DIR,
					`${path.parse(screenVideoPath).name}${RECORDING_SESSION_SUFFIX}`,
				);
				await fs.writeFile(sessionManifestPath, JSON.stringify(session, null, 2), "utf-8");

				return {
					success: true,
					path: screenVideoPath,
					session,
					message: "Native macOS webcam recording attached successfully",
				};
			} catch (error) {
				console.error("Failed to attach native macOS webcam recording:", error);
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	// On-disk write streams for in-progress recordings, keyed by output file name.
	// Chunks append as they arrive so the renderer never buffers the full video (#616).
	const recordingStreams = new RecordingStreamRegistry();
	registerRecordingStreamHandlers(ipcMain, recordingStreams, resolveRecordingOutputPath);

	ipcMain.handle("store-recorded-session", async (_, payload: StoreRecordedSessionInput) => {
		try {
			return await storeRecordedSessionFiles(payload);
		} catch (error) {
			console.error("Failed to store recording session:", error);
			return {
				success: false,
				message: "Failed to store recording session",
				error: String(error),
			};
		}
	});

	async function storeRecordedSessionFiles(payload: StoreRecordedSessionInput) {
		const createdAt =
			typeof payload.createdAt === "number" && Number.isFinite(payload.createdAt)
				? payload.createdAt
				: Date.now();
		const cursorCaptureMode = normalizeCursorCaptureMode(payload.cursorCaptureMode);
		const screenVideoPath = resolveRecordingOutputPath(payload.screen.fileName);
		const screenStreamed = await finalizeRecordingFile(
			recordingStreams,
			payload.screen.fileName,
			screenVideoPath,
			payload.screen.videoData,
		);

		let webcamVideoPath: string | undefined;
		let webcamStreamed = false;
		if (payload.webcam) {
			webcamVideoPath = resolveRecordingOutputPath(payload.webcam.fileName);
			webcamStreamed = await finalizeRecordingFile(
				recordingStreams,
				payload.webcam.fileName,
				webcamVideoPath,
				payload.webcam.videoData,
			);
		}

		// Streamed files lack the WebM Duration header (renderer no longer holds the
		// blob), so patch on disk for the editor's seek bar and timeline. Best-effort,
		// independent per file, so they run together.
		if (isValidDurationMs(payload.durationMs)) {
			const patches: Promise<unknown>[] = [];
			if (screenStreamed) {
				patches.push(patchWebmDurationOnDisk(screenVideoPath, payload.durationMs));
			}
			if (webcamStreamed && webcamVideoPath) {
				patches.push(patchWebmDurationOnDisk(webcamVideoPath, payload.durationMs));
			}
			await Promise.all(patches);
		}

		const session: RecordingSession = webcamVideoPath
			? {
					screenVideoPath,
					webcamVideoPath,
					createdAt,
					...(cursorCaptureMode ? { cursorCaptureMode } : {}),
				}
			: { screenVideoPath, createdAt, ...(cursorCaptureMode ? { cursorCaptureMode } : {}) };
		setCurrentRecordingSessionState(session);
		currentProjectPath = null;

		await writePendingCursorTelemetry(screenVideoPath);

		const sessionManifestPath = path.join(
			RECORDINGS_DIR,
			`${path.parse(payload.screen.fileName).name}${RECORDING_SESSION_SUFFIX}`,
		);
		await fs.writeFile(sessionManifestPath, JSON.stringify(session, null, 2), "utf-8");

		return {
			success: true,
			path: screenVideoPath,
			session,
			message: "Recording session stored successfully",
		};
	}

	ipcMain.handle("store-recorded-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			return await storeRecordedSessionFiles({
				screen: { videoData, fileName },
				createdAt: Date.now(),
			});
		} catch (error) {
			console.error("Failed to store recorded video:", error);
			return {
				success: false,
				message: "Failed to store recorded video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-recorded-video-path", async () => {
		try {
			if (currentRecordingSession?.screenVideoPath) {
				return { success: true, path: currentRecordingSession.screenVideoPath };
			}

			const files = await fs.readdir(RECORDINGS_DIR);
			const videoFiles = files.filter(
				(file) => file.endsWith(".webm") && !file.endsWith("-webcam.webm"),
			);

			if (videoFiles.length === 0) {
				return { success: false, message: "No recorded video found" };
			}

			const latestVideo = videoFiles.sort().reverse()[0];
			const videoPath = path.join(RECORDINGS_DIR, latestVideo);

			return { success: true, path: videoPath };
		} catch (error) {
			console.error("Failed to get video path:", error);
			return { success: false, message: "Failed to get video path", error: String(error) };
		}
	});

	ipcMain.handle(
		"set-recording-state",
		async (_, recording: boolean, recordingId?: number, cursorCaptureMode?: CursorCaptureMode) => {
			const normalizedCursorCaptureMode =
				normalizeCursorCaptureMode(cursorCaptureMode) ?? "editable-overlay";
			if (recording && normalizedCursorCaptureMode === "editable-overlay") {
				await startCursorRecording(recordingId);
			} else {
				await stopCursorRecording();
			}

			const source = selectedSource || { name: "Screen" };
			if (onRecordingStateChange) {
				onRecordingStateChange(recording, source.name);
			}
		},
	);

	ipcMain.handle("get-cursor-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = resolveApprovedVideoPath(
			videoPath ?? currentRecordingSession?.screenVideoPath,
		);
		if (!targetVideoPath) {
			return { success: true, samples: [] };
		}

		return readCursorTelemetryFile(targetVideoPath);
	});

	ipcMain.handle("open-external-url", async (_, url: string) => {
		try {
			await shell.openExternal(url);
			return { success: true };
		} catch (error) {
			console.error("Failed to open URL:", error);
			return { success: false, error: String(error) };
		}
	});

	// Return base path for assets so renderer can resolve file:// paths in production
	ipcMain.handle("get-asset-base-path", () => {
		return resolveAssetBasePath();
	});

	ipcMain.handle("pick-export-save-path", async (_, fileName: string, exportFolder?: string) => {
		try {
			const isGif = fileName.toLowerCase().endsWith(".gif");
			const filters = isGif
				? [{ name: mainT("dialogs", "fileDialogs.gifImage"), extensions: ["gif"] }]
				: [{ name: mainT("dialogs", "fileDialogs.mp4Video"), extensions: ["mp4"] }];

			// Prefer the user's last export folder if it still exists, else ~/Downloads.
			// Validate here because the renderer can't stat the filesystem.
			let defaultDir = app.getPath("downloads");
			if (exportFolder) {
				try {
					const stats = await fs.stat(exportFolder);
					if (stats.isDirectory()) {
						defaultDir = exportFolder;
					}
				} catch (err) {
					console.warn(
						`Could not access remembered export folder "${exportFolder}", falling back to Downloads:`,
						err,
					);
				}
			}
			const dialogOptions = buildDialogOptions(
				{
					title: isGif
						? mainT("dialogs", "fileDialogs.saveGif")
						: mainT("dialogs", "fileDialogs.saveVideo"),
					defaultPath: path.join(defaultDir, fileName),
					filters,
					properties: ["createDirectory", "showOverwriteConfirmation"],
				},
				getMainWindow(),
			);
			const result = await dialog.showSaveDialog(dialogOptions);

			if (result.canceled || !result.filePath) {
				return { success: false, canceled: true, message: "Export canceled" };
			}

			return { success: true, path: path.normalize(result.filePath) };
		} catch (error) {
			console.error("Failed to show save dialog:", error);
			return {
				success: false,
				message: "Failed to show save dialog",
				error: String(error),
			};
		}
	});

	ipcMain.handle("write-export-to-path", async (_, videoData: ArrayBuffer, filePath: string) => {
		try {
			// Sanity-check the path: the renderer is trusted (contextIsolation on), but a
			// stale-state bug shouldn't be able to clobber arbitrary files.
			if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
				return { success: false, message: "Invalid path" };
			}
			const lower = filePath.toLowerCase();
			if (!lower.endsWith(".mp4") && !lower.endsWith(".gif")) {
				return { success: false, message: "Invalid file type" };
			}

			const normalizedPath = path.normalize(filePath);
			await fs.mkdir(path.dirname(normalizedPath), { recursive: true });
			await fs.writeFile(normalizedPath, Buffer.from(videoData));

			return {
				success: true,
				path: normalizedPath,
				message: "Video exported successfully",
			};
		} catch (error) {
			console.error("Failed to write exported video:", error);
			return {
				success: false,
				message: "Failed to save exported video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("copy-export-source-to-path", async (_, sourcePath: string, filePath: string) => {
		try {
			const normalizedSource = normalizeVideoSourcePath(sourcePath);
			if (
				!normalizedSource ||
				!isPathAllowed(normalizedSource) ||
				typeof filePath !== "string" ||
				!path.isAbsolute(filePath) ||
				!filePath.toLowerCase().endsWith(".mp4")
			) {
				return { success: false, message: "Invalid export path" };
			}
			const normalizedTarget = path.normalize(filePath);
			await fs.mkdir(path.dirname(normalizedTarget), { recursive: true });
			await fs.copyFile(normalizedSource, normalizedTarget);
			return { success: true, path: normalizedTarget, message: "Video copied successfully" };
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle("open-video-file-picker", async () => {
		try {
			const dialogOptions = buildDialogOptions(
				{
					title: mainT("dialogs", "fileDialogs.selectVideo"),
					defaultPath: RECORDINGS_DIR,
					filters: [
						{
							name: mainT("dialogs", "fileDialogs.videoFiles"),
							extensions: ["webm", "mp4", "mov", "avi", "mkv", "m4v", "wmv", "flv", "ts"],
						},
						{ name: mainT("dialogs", "fileDialogs.allFiles"), extensions: ["*"] },
					],
					properties: ["openFile"],
				},
				getMainWindow(),
			);
			const result = await dialog.showOpenDialog(dialogOptions);

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			const normalizedPath = await approveReadableVideoPath(result.filePaths[0]);
			if (!normalizedPath) {
				return {
					success: false,
					message: "Selected file is not a supported readable video file",
				};
			}

			currentProjectPath = null;
			return {
				success: true,
				path: normalizedPath,
			};
		} catch (error) {
			console.error("Failed to open file picker:", error);
			return {
				success: false,
				message: "Failed to open file picker",
				error: String(error),
			};
		}
	});

	ipcMain.handle("reveal-in-folder", async (_, filePath: string) => {
		try {
			// showItemInFolder returns nothing, it throws on error
			shell.showItemInFolder(filePath);
			return { success: true };
		} catch (error) {
			console.error(`Error revealing item in folder: ${filePath}`, error);
			// Fall back to opening the directory if revealing fails (file moved/deleted
			// after export, or a path showItemInFolder rejects).
			try {
				const openPathResult = await shell.openPath(path.dirname(filePath));
				if (openPathResult) {
					// openPath returned an error message
					return { success: false, error: openPathResult };
				}
				return { success: true, message: "Could not reveal item, but opened directory." };
			} catch (openError) {
				console.error(`Error opening directory: ${path.dirname(filePath)}`, openError);
				return { success: false, error: String(error) };
			}
		}
	});

	ipcMain.handle("read-binary-file", async (_, filePath: string) => {
		try {
			const normalizedPath = await approveReadableVideoPath(filePath);
			if (!normalizedPath) {
				return {
					success: false,
					message: "File path is not approved or is not a supported video file",
				};
			}

			const data = await fs.readFile(normalizedPath);
			return {
				success: true,
				data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
				path: normalizedPath,
			};
		} catch (error) {
			console.error("Failed to read binary file:", error);
			return {
				success: false,
				message: "Failed to read binary file",
				error: String(error),
			};
		}
	});

	ipcMain.handle("create-media-source-handle", async (_, filePath: string) => {
		const normalized = normalizeVideoSourcePath(filePath);
		if (!normalized || !isPathAllowed(normalized)) {
			return { success: false, message: "Source file is not approved" };
		}
		try {
			const stat = await fs.stat(normalized);
			const id = randomUUID();
			const port = await ensureMediaSourceServer();
			mediaSourceHandles.set(id, {
				filePath: normalized,
				expiresAt: Date.now() + 30 * 60 * 1000,
			});
			return {
				success: true,
				id,
				url: `http://127.0.0.1:${port}/media/${id}`,
				size: stat.size,
				mtimeMs: stat.mtimeMs,
			};
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle("release-media-source-handle", (_, id: string) => {
		mediaSourceHandles.delete(id);
		return { success: true };
	});

	ipcMain.handle(
		"prepare-preview-audio-track",
		async (_, filePath: string, trackIndex?: number) => {
			try {
				return await prepareSupplementalPreviewAudioTrack(filePath, trackIndex);
			} catch (error) {
				console.error("Failed to prepare preview audio track:", error);
				return {
					success: false,
					message: "Failed to prepare preview audio track",
					error: String(error),
				};
			}
		},
	);

	// Reports one entry per physical audio track so the editor can map mp4 track
	// ordinals to timeline tracks without guessing.
	ipcMain.handle("inspect-audio-tracks", async (_, filePath: string) => {
		try {
			const normalizedPath = await approveReadableVideoPath(filePath);
			if (!normalizedPath) return { success: false, message: "Source file is not approved" };
			if (process.platform !== "darwin" || path.extname(normalizedPath).toLowerCase() !== ".mp4") {
				return {
					success: false,
					message: "Audio track inspection is only available for macOS MP4",
				};
			}
			const afinfo = await runProcess("/usr/bin/afinfo", [normalizedPath]);
			if (afinfo.code !== 0) {
				return { success: false, message: afinfo.stderr || "Unable to inspect audio tracks" };
			}
			return {
				success: true,
				tracks: parseAfinfoAudioTrackBitrates(`${afinfo.stdout}\n${afinfo.stderr}`).map(
					(bitRate, ordinal) => ({ ordinal, bitRate }),
				),
			};
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle(
		"save-project-file",
		async (_, projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
			return saveProjectFile(projectData, suggestedName, existingProjectPath);
		},
	);

	async function saveProjectFile(
		projectData: unknown,
		suggestedName?: string,
		existingProjectPath?: string,
	): Promise<ProjectFileResult> {
		try {
			const trustedExistingProjectPath = isTrustedProjectPath(existingProjectPath)
				? existingProjectPath
				: null;

			if (trustedExistingProjectPath) {
				await fs.writeFile(
					trustedExistingProjectPath,
					JSON.stringify(projectData, null, 2),
					"utf-8",
				);
				currentProjectPath = trustedExistingProjectPath;
				return {
					success: true,
					path: trustedExistingProjectPath,
					message: "Project saved successfully",
				};
			}

			const safeName = (suggestedName || `project-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, "_");
			const defaultName = safeName.endsWith(`.${PROJECT_FILE_EXTENSION}`)
				? safeName
				: `${safeName}.${PROJECT_FILE_EXTENSION}`;

			const dialogOptions = buildDialogOptions(
				{
					title: mainT("dialogs", "fileDialogs.saveProject"),
					defaultPath: path.join(RECORDINGS_DIR, defaultName),
					filters: [
						{
							name: mainT("dialogs", "fileDialogs.openscreenProject"),
							extensions: [PROJECT_FILE_EXTENSION],
						},
						{ name: "JSON", extensions: ["json"] },
					],
					properties: ["createDirectory", "showOverwriteConfirmation"],
				},
				getMainWindow(),
			);
			const result = await dialog.showSaveDialog(dialogOptions);

			if (result.canceled || !result.filePath) {
				return {
					success: false,
					canceled: true,
					message: "Save project canceled",
				};
			}

			await fs.writeFile(result.filePath, JSON.stringify(projectData, null, 2), "utf-8");
			currentProjectPath = result.filePath;

			return {
				success: true,
				path: result.filePath,
				message: "Project saved successfully",
			};
		} catch (error) {
			console.error("Failed to save project file:", error);
			return {
				success: false,
				message: "Failed to save project file",
				error: String(error),
			};
		}
	}

	ipcMain.handle("load-project-file", async (_, projectFolder?: string) => {
		return loadProjectFile(projectFolder);
	});

	async function loadProjectFile(projectFolder?: string): Promise<ProjectFileResult> {
		try {
			// Prefer the user's last opened-project folder if it still exists, else
			// RECORDINGS_DIR. Validate here because the renderer can't stat the filesystem.
			let defaultDir = RECORDINGS_DIR;
			if (projectFolder) {
				try {
					const stats = await fs.stat(projectFolder);
					if (stats.isDirectory()) {
						defaultDir = projectFolder;
					}
				} catch (err) {
					// Stat can fail if the folder was moved/deleted (expected) or on a
					// permission error (worth surfacing). We fall back either way, but log it.
					console.warn(
						`Could not access remembered project folder "${projectFolder}", falling back to RECORDINGS_DIR:`,
						err,
					);
				}
			}
			const dialogOptions = buildDialogOptions(
				{
					title: mainT("dialogs", "fileDialogs.openProject"),
					defaultPath: defaultDir,
					filters: [
						{
							name: mainT("dialogs", "fileDialogs.openscreenProject"),
							extensions: [PROJECT_FILE_EXTENSION],
						},
						{ name: "JSON", extensions: ["json"] },
						{ name: mainT("dialogs", "fileDialogs.allFiles"), extensions: ["*"] },
					],
					properties: ["openFile"],
				},
				getMainWindow(),
			);
			const result = await dialog.showOpenDialog(dialogOptions);

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true, message: "Open project canceled" };
			}

			const filePath = result.filePaths[0];
			const content = await fs.readFile(filePath, "utf-8");
			const project = JSON.parse(content);
			currentProjectPath = filePath;
			setCurrentRecordingSessionState(await getApprovedProjectSession(project, filePath));

			return {
				success: true,
				path: filePath,
				project,
			};
		} catch (error) {
			console.error("Failed to load project file:", error);
			return {
				success: false,
				message: "Failed to load project file",
				error: String(error),
			};
		}
	}

	ipcMain.handle("load-project-file-from-path", async (_event, filePath: string) => {
		return loadProjectFileFromPath(filePath);
	});

	ipcMain.handle("list-media-library", async () => {
		try {
			const entries = await fs.readdir(RECORDINGS_DIR, { withFileTypes: true });
			const visibleFiles = entries.filter(
				(entry) =>
					entry.isFile() && (entry.name.endsWith(".openscreen") || entry.name.endsWith(".mp4")),
			);
			const libraryItems = await Promise.all(
				visibleFiles.map(async (entry) => {
					const itemPath = path.join(RECORDINGS_DIR, entry.name);
					try {
						const stat = await fs.stat(itemPath);
						const baseName = entry.name.replace(/\.openscreen$|\.mp4$/i, "");
						const isProject = entry.name.endsWith(".openscreen");
						const pairedProjectPath = path.join(RECORDINGS_DIR, `${baseName}.openscreen`);
						const sessionPath = path.join(RECORDINGS_DIR, `${baseName}.session.json`);
						const [hasProject, hasSession] = await Promise.all([
							isProject
								? Promise.resolve(true)
								: fs
										.access(pairedProjectPath)
										.then(() => true)
										.catch(() => false),
							fs
								.access(sessionPath)
								.then(() => true)
								.catch(() => false),
						]);
						return {
							path: itemPath,
							kind: isProject ? "project" : "recording",
							title: baseName.replace(/^recording-/, "Recording "),
							modifiedAt: stat.mtimeMs,
							fileSize: stat.size,
							hasProject,
							hasSession,
						};
					} catch {
						return null;
					}
				}),
			);
			return {
				success: true,
				items: libraryItems
					.filter((item): item is NonNullable<typeof item> => item !== null)
					.sort((a, b) => b.modifiedAt - a.modifiedAt),
			};
		} catch (error) {
			return {
				success: false,
				items: [],
				message: error instanceof Error ? error.message : String(error),
			};
		}
	});

	async function loadProjectFileFromPath(filePath: string): Promise<ProjectFileResult> {
		try {
			if (!filePath || typeof filePath !== "string") {
				return { success: false, message: "Invalid file path" };
			}
			// Validate extension and readability
			if (path.extname(filePath).toLowerCase() !== `.${PROJECT_FILE_EXTENSION}`) {
				return { success: false, message: "Not an Openscreen project file" };
			}
			const stats = await fs.stat(filePath).catch(() => null);
			if (!stats?.isFile()) {
				return { success: false, message: "File not found" };
			}
			const content = await fs.readFile(filePath, "utf-8");
			const project = JSON.parse(content);
			currentProjectPath = filePath;

			// Approve session paths but tolerate failures (e.g. video moved outside trusted
			// dirs) so the project still loads and the renderer can show "video not found".
			let session: import("../../src/lib/recordingSession").RecordingSession | null = null;
			try {
				session = await getApprovedProjectSession(project, filePath);
			} catch (sessionError) {
				console.warn(
					"[loadProjectFileFromPath] Could not approve session paths, proceeding without session:",
					sessionError,
				);
			}
			setCurrentRecordingSessionState(session);
			return { success: true, path: filePath, project };
		} catch (error) {
			console.error("Failed to load project file from path:", error);
			return {
				success: false,
				message: "Failed to load project file",
				error: String(error),
			};
		}
	}

	ipcMain.handle("load-current-project-file", async () => {
		return loadCurrentProjectFile();
	});

	async function loadCurrentProjectFile(): Promise<ProjectFileResult> {
		try {
			if (!currentProjectPath) {
				return { success: false, message: "No active project" };
			}

			const content = await fs.readFile(currentProjectPath, "utf-8");
			const project = JSON.parse(content);
			setCurrentRecordingSessionState(await getApprovedProjectSession(project, currentProjectPath));
			return {
				success: true,
				path: currentProjectPath,
				project,
			};
		} catch (error) {
			console.error("Failed to load current project file:", error);
			return {
				success: false,
				message: "Failed to load current project file",
				error: String(error),
			};
		}
	}

	ipcMain.handle("set-current-video-path", async (_, path: string) => {
		return setCurrentVideoPath(path);
	});

	ipcMain.handle("set-current-recording-session", (_, session: RecordingSession | null) => {
		const normalizedSession = normalizeRecordingSession(session);
		setCurrentRecordingSessionState(normalizedSession);
		currentVideoPath = normalizedSession?.screenVideoPath ?? null;
		currentProjectPath = null;
		return { success: true, session: currentRecordingSession };
	});

	ipcMain.handle("get-current-recording-session", () => {
		return currentRecordingSession
			? { success: true, session: currentRecordingSession }
			: { success: false };
	});

	async function setCurrentVideoPath(path: string): Promise<ProjectPathResult> {
		const normalizedPath = normalizeVideoSourcePath(path);
		if (!normalizedPath || !isPathAllowed(normalizedPath)) {
			return {
				success: false,
				message: "Video path has not been approved",
			};
		}

		const restoredSession = await loadRecordedSessionForVideoPath(normalizedPath);
		if (restoredSession) {
			setCurrentRecordingSessionState(restoredSession);
		} else {
			setCurrentRecordingSessionState({
				screenVideoPath: normalizedPath,
				createdAt: Date.now(),
			});
		}
		currentProjectPath = null;
		return { success: true, path: currentVideoPath ?? normalizedPath };
	}

	ipcMain.handle("get-current-video-path", () => {
		return getCurrentVideoPathResult();
	});

	function getCurrentVideoPathResult(): ProjectPathResult {
		return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
	}

	ipcMain.handle("clear-current-video-path", () => {
		return clearCurrentVideoPath();
	});

	function clearCurrentVideoPath(): ProjectPathResult {
		currentVideoPath = null;
		currentProjectPath = null;
		setCurrentRecordingSessionState(null);
		return { success: true };
	}

	ipcMain.handle("get-platform", () => {
		return process.platform;
	});

	ipcMain.handle("get-shortcuts", async () => {
		try {
			const data = await fs.readFile(SHORTCUTS_FILE, "utf-8");
			return JSON.parse(data);
		} catch {
			return null;
		}
	});

	ipcMain.handle("save-shortcuts", async (_, shortcuts: unknown) => {
		try {
			await fs.writeFile(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), "utf-8");
			return { success: true };
		} catch (error) {
			console.error("Failed to save shortcuts:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("openai-api-key-status", async () => ({
		configured: Boolean(await readOpenAIApiKey()),
		secureStorageAvailable: safeStorage.isEncryptionAvailable(),
	}));

	ipcMain.handle("openai-api-key-save", async (_, key: string) => {
		try {
			return await saveOpenAIApiKey(key);
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle("openai-api-key-clear", async () => {
		try {
			await fs.rm(OPENAI_KEY_FILE, { force: true });
			await fs.rm(OPENAI_KEY_LOCAL_FILE, { force: true });
			return { success: true };
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	});

	ipcMain.handle(
		"openai-whisper-transcribe",
		async (_, payload: { audio: ArrayBuffer; language?: string }) => {
			const key = await readOpenAIApiKey();
			if (!key)
				return { success: false, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
			if (!payload?.audio || payload.audio.byteLength === 0) {
				return {
					success: false,
					code: "NO_AUDIO",
					message: "No audio was provided for transcription.",
				};
			}
			if (payload.audio.byteLength > 24 * 1024 * 1024) {
				return {
					success: false,
					code: "AUDIO_TOO_LARGE",
					message: "Audio chunk exceeds the transcription upload limit.",
				};
			}

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 120_000);
			try {
				const body = new FormData();
				body.append("file", new Blob([payload.audio], { type: "audio/wav" }), "captions.wav");
				body.append("model", "whisper-1");
				body.append("response_format", "verbose_json");
				body.append("timestamp_granularities[]", "word");
				body.append("timestamp_granularities[]", "segment");
				if (payload.language) body.append("language", payload.language);

				const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
					method: "POST",
					headers: { Authorization: `Bearer ${key}` },
					body,
					signal: controller.signal,
				});
				const data = (await response.json().catch(() => null)) as unknown;
				if (!response.ok) {
					const message =
						data && typeof data === "object" && "error" in data
							? String(
									(data as { error?: { message?: string } }).error?.message || response.statusText,
								)
							: response.statusText;
					return { success: false, code: `HTTP_${response.status}`, message };
				}
				return { success: true, data };
			} catch (error) {
				const cause =
					error && typeof error === "object" && "cause" in error
						? String((error as { cause?: unknown }).cause ?? "")
						: "";
				const detail = error instanceof Error ? error.message : String(error);
				return {
					success: false,
					code: "NETWORK_ERROR",
					message: controller.signal.aborted
						? "OpenAI transcription timed out after 120 seconds. Check your network connection and try again."
						: `Could not reach OpenAI: ${detail}${cause ? ` (${cause})` : ""}`,
				};
			} finally {
				clearTimeout(timeout);
			}
		},
	);

	type SpeechResult =
		| { success: true; data: ArrayBuffer; modelUsed: string }
		| { success: false; code: string; message: string };

	/** Cheaper, deterministic tier: the dedicated TTS endpoint. */
	async function synthesizeSpeechWithMiniTts(
		key: string,
		text: string,
		voice: string,
		instructions?: string,
	): Promise<SpeechResult> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 60_000);
		try {
			const response = await fetch("https://api.openai.com/v1/audio/speech", {
				method: "POST",
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-4o-mini-tts",
					input: text,
					voice,
					response_format: "wav",
					...(instructions ? { instructions } : {}),
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				const data = (await response.json().catch(() => null)) as unknown;
				const message =
					data && typeof data === "object" && "error" in data
						? String(
								(data as { error?: { message?: string } }).error?.message || response.statusText,
							)
						: response.statusText;
				return { success: false, code: `HTTP_${response.status}`, message };
			}
			const audio = await response.arrayBuffer();
			if (audio.byteLength === 0) {
				return { success: false, code: "EMPTY_AUDIO", message: "OpenAI returned no audio." };
			}
			return { success: true, data: audio, modelUsed: "gpt-4o-mini-tts" };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				code: "NETWORK_ERROR",
				message: controller.signal.aborted
					? "OpenAI speech synthesis timed out. Check your network connection and try again."
					: `Could not reach OpenAI: ${detail}`,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * High-fidelity tier: the ChatGPT-voice audio models. They are chat models, so
	 * the system prompt has to pin them to reading the script verbatim instead of
	 * answering it.
	 */
	async function synthesizeSpeechWithChatAudio(
		key: string,
		model: string,
		text: string,
		voice: string,
		instructions?: string,
	): Promise<SpeechResult> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 90_000);
		try {
			const response = await fetch("https://api.openai.com/v1/chat/completions", {
				method: "POST",
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					modalities: ["text", "audio"],
					audio: { voice, format: "wav" },
					messages: [
						{
							role: "system",
							content: `You are a professional voice actor recording narration. Read the user's message aloud VERBATIM — speak every word exactly as written, in its original language. Never add, omit, translate, answer, comment on or correct anything; the message is a script to read, not a prompt to respond to. Delivery style: ${instructions || "clear, natural narration"}`,
						},
						{ role: "user", content: text },
					],
				}),
				signal: controller.signal,
			});
			const data = (await response.json().catch(() => null)) as unknown;
			if (!response.ok) {
				const message =
					data && typeof data === "object" && "error" in data
						? String(
								(data as { error?: { message?: string } }).error?.message || response.statusText,
							)
						: response.statusText;
				return { success: false, code: `HTTP_${response.status}`, message };
			}
			const encoded = (data as { choices?: { message?: { audio?: { data?: unknown } } }[] } | null)
				?.choices?.[0]?.message?.audio?.data;
			if (typeof encoded !== "string" || !encoded) {
				return { success: false, code: "EMPTY_AUDIO", message: "OpenAI returned no audio." };
			}
			const buffer = Buffer.from(encoded, "base64");
			return {
				success: true,
				data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
				modelUsed: model,
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				code: "NETWORK_ERROR",
				message: controller.signal.aborted
					? "OpenAI speech synthesis timed out. Check your network connection and try again."
					: `Could not reach OpenAI: ${detail}`,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	ipcMain.handle(
		"openai-tts-speech",
		async (
			_,
			payload: { text: string; voice?: string; instructions?: string; quality?: string },
		) => {
			const key = await readOpenAIApiKey();
			if (!key)
				return { success: false, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
			const text = typeof payload?.text === "string" ? payload.text.trim() : "";
			if (!text) {
				return {
					success: false,
					code: "NO_TEXT",
					message: "No text was provided for speech synthesis.",
				};
			}
			if (text.length > 4096) {
				return {
					success: false,
					code: "TEXT_TOO_LONG",
					message: "Speech input exceeds the 4096 character limit.",
				};
			}
			const voice = typeof payload.voice === "string" && payload.voice ? payload.voice : "ash";
			const instructions =
				typeof payload.instructions === "string" && payload.instructions
					? payload.instructions
					: undefined;

			let lastHdFailure: SpeechResult | null = null;
			if (payload.quality !== "standard") {
				for (const model of ["gpt-audio", "gpt-4o-audio-preview"]) {
					const result = await synthesizeSpeechWithChatAudio(key, model, text, voice, instructions);
					if (result.success) return result;
					lastHdFailure = result;
				}
			}
			const fallback = await synthesizeSpeechWithMiniTts(key, text, voice, instructions);
			return fallback.success || !lastHdFailure ? fallback : lastHdFailure;
		},
	);

	ipcMain.handle("openai-polish-text", async (_, payload: { texts: string[] }) => {
		const key = await readOpenAIApiKey();
		if (!key)
			return { success: false, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
		const texts = Array.isArray(payload?.texts)
			? payload.texts.filter((entry): entry is string => typeof entry === "string")
			: [];
		if (texts.length === 0 || texts.length !== (payload?.texts?.length ?? 0)) {
			return { success: false, code: "NO_TEXT", message: "No transcript lines were provided." };
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 60_000);
		try {
			const response = await fetch("https://api.openai.com/v1/chat/completions", {
				method: "POST",
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-4o-mini",
					temperature: 0.2,
					response_format: { type: "json_object" },
					messages: [
						{
							role: "system",
							content:
								'You lightly clean speech transcripts for text-to-speech narration. For each input string, ONLY: remove pure filler sounds ("um", "uh", "嗯", "啊", "呃", "えー", "음") and remove immediately repeated duplicate words (e.g. "the the" → "the", "我们 我们" → "我们"). You MUST keep everything else verbatim — including discourse connectives and pronouns such as "那", "那个", "那么", "就是", "所以", "well", "so" — and never rephrase, add, summarize, reorder or translate anything. If a string needs no change, return it unchanged. Respond with ONLY a JSON object of the shape {"texts": [...]} where the array has exactly the same number of strings, in the same order.',
						},
						{ role: "user", content: JSON.stringify({ texts }) },
					],
				}),
				signal: controller.signal,
			});
			const data = (await response.json().catch(() => null)) as unknown;
			if (!response.ok) {
				const message =
					data && typeof data === "object" && "error" in data
						? String(
								(data as { error?: { message?: string } }).error?.message || response.statusText,
							)
						: response.statusText;
				return { success: false, code: `HTTP_${response.status}`, message };
			}
			const content = (data as { choices?: { message?: { content?: unknown } }[] } | null)
				?.choices?.[0]?.message?.content;
			const parsed = typeof content === "string" ? (JSON.parse(content) as unknown) : null;
			const polished = Array.isArray((parsed as { texts?: unknown })?.texts)
				? ((parsed as { texts: unknown[] }).texts as unknown[])
				: null;
			if (!polished || polished.length !== texts.length) {
				return {
					success: false,
					code: "BAD_RESPONSE",
					message: "Polish response did not match the transcript.",
				};
			}
			return {
				success: true,
				texts: polished.map((entry, index) =>
					typeof entry === "string" && entry.trim() ? entry : texts[index],
				),
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				code: "NETWORK_ERROR",
				message: controller.signal.aborted
					? "OpenAI text polishing timed out. Check your network connection and try again."
					: `Could not reach OpenAI: ${detail}`,
			};
		} finally {
			clearTimeout(timeout);
		}
	});

	ipcMain.handle(
		"openai-translate-text",
		async (_, payload: { texts: string[]; targetLanguage: string }) => {
			const key = await readOpenAIApiKey();
			if (!key)
				return { success: false, code: "NO_API_KEY", message: "OpenAI API key is not configured." };
			const texts = Array.isArray(payload?.texts)
				? payload.texts.filter((entry): entry is string => typeof entry === "string")
				: [];
			const targetLanguage =
				typeof payload?.targetLanguage === "string" ? payload.targetLanguage.trim() : "";
			if (texts.length === 0 || texts.length !== (payload?.texts?.length ?? 0)) {
				return { success: false, code: "NO_TEXT", message: "No transcript lines were provided." };
			}
			if (!targetLanguage) {
				return { success: false, code: "NO_LANGUAGE", message: "No target language was provided." };
			}

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 60_000);
			try {
				const response = await fetch("https://api.openai.com/v1/chat/completions", {
					method: "POST",
					headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
					body: JSON.stringify({
						model: "gpt-4o-mini",
						temperature: 0.2,
						response_format: { type: "json_object" },
						messages: [
							{
								role: "system",
								content: `You translate video narration scripts. Translate each input string into ${targetLanguage} as natural SPOKEN narration: keep the meaning and tone, keep roughly the same length so the timing still fits, and do not add, drop, summarize or reorder content. Respond with ONLY a JSON object of the shape {"texts": [...]} where the array has exactly the same number of strings, in the same order.`,
							},
							{ role: "user", content: JSON.stringify({ texts }) },
						],
					}),
					signal: controller.signal,
				});
				const data = (await response.json().catch(() => null)) as unknown;
				if (!response.ok) {
					const message =
						data && typeof data === "object" && "error" in data
							? String(
									(data as { error?: { message?: string } }).error?.message || response.statusText,
								)
							: response.statusText;
					return { success: false, code: `HTTP_${response.status}`, message };
				}
				const content = (data as { choices?: { message?: { content?: unknown } }[] } | null)
					?.choices?.[0]?.message?.content;
				const parsed = typeof content === "string" ? (JSON.parse(content) as unknown) : null;
				const translated = Array.isArray((parsed as { texts?: unknown })?.texts)
					? ((parsed as { texts: unknown[] }).texts as unknown[])
					: null;
				if (!translated || translated.length !== texts.length) {
					return {
						success: false,
						code: "BAD_RESPONSE",
						message: "Translation response did not match the transcript.",
					};
				}
				return {
					success: true,
					texts: translated.map((entry, index) =>
						typeof entry === "string" && entry.trim() ? entry : texts[index],
					),
				};
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				return {
					success: false,
					code: "NETWORK_ERROR",
					message: controller.signal.aborted
						? "OpenAI translation timed out. Check your network connection and try again."
						: `Could not reach OpenAI: ${detail}`,
				};
			} finally {
				clearTimeout(timeout);
			}
		},
	);

	ipcMain.handle(
		"save-voiceover-audio",
		async (_, payload: { videoPath: string; wavData: ArrayBuffer }) => {
			try {
				const sourcePath = await approveReadableVideoPath(payload?.videoPath);
				if (!sourcePath) {
					return { success: false, message: "Source video path is not approved" };
				}
				if (!payload?.wavData || payload.wavData.byteLength === 0) {
					return { success: false, message: "No voice-over audio data was provided" };
				}
				await fs.mkdir(VOICEOVER_AUDIO_DIR, { recursive: true });
				const parsed = path.parse(sourcePath);
				const hash = createHash("sha256").update(sourcePath).digest("hex").slice(0, 12);
				// Timestamped so regenerating busts the <audio> element's cache.
				const targetPath = path.join(
					VOICEOVER_AUDIO_DIR,
					`${parsed.name}.${hash}.voiceover.${Date.now()}.wav`,
				);
				const tempPath = `${targetPath}.${randomUUID()}.tmp`;
				try {
					await fs.writeFile(tempPath, Buffer.from(payload.wavData));
					await fs.rename(tempPath, targetPath);
				} finally {
					await fs.rm(tempPath, { force: true }).catch(() => undefined);
				}
				approveFilePath(targetPath);
				return {
					success: true,
					path: targetPath,
					fileUrl: pathToFileURL(targetPath).toString(),
				};
			} catch (error) {
				return {
					success: false,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"save-diagnostic",
		async (
			_,
			payload: { error: string; stack?: string; projectState: unknown; logs: string[] },
		) => {
			const { filePath, canceled } = await dialog.showSaveDialog({
				title: "Save Diagnostic File",
				defaultPath: `openscreen-diagnostic-${Date.now()}.json`,
				filters: [{ name: "JSON", extensions: ["json"] }],
			});

			if (canceled || !filePath) return { success: false, canceled: true };

			const diagnostic = {
				timestamp: new Date().toISOString(),
				appVersion: app.getVersion(),
				platform: process.platform,
				arch: process.arch,
				osRelease: os.release(),
				osVersion: os.version(),
				totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
				nodeVersion: process.versions.node,
				electronVersion: process.versions.electron,
				chromeVersion: process.versions.chrome,
				error: payload.error,
				stack: payload.stack,
				projectState: payload.projectState,
				recentLogs: payload.logs,
			};

			try {
				await fs.writeFile(filePath, JSON.stringify(diagnostic, null, 2), "utf-8");
				return { success: true, path: filePath };
			} catch (error) {
				console.error("Failed to write diagnostic file:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	registerNativeBridgeHandlers({
		getPlatform: () => process.platform,
		getCurrentProjectPath: () => currentProjectPath,
		getCurrentVideoPath: () => currentVideoPath,
		saveProjectFile,
		loadProjectFile,
		loadCurrentProjectFile,
		loadProjectFileFromPath,
		setCurrentVideoPath,
		getCurrentVideoPathResult,
		clearCurrentVideoPath,
		resolveAssetBasePath,
		resolveVideoPath: (videoPath?: string | null) =>
			normalizeVideoSourcePath(videoPath ?? currentVideoPath),
		loadCursorRecordingData: readCursorRecordingFile,
		loadCursorTelemetry: readCursorTelemetryFile,
	});
}
