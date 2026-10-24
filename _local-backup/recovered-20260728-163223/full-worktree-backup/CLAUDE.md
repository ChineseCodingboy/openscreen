# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OpenScreen is an open-source screen recorder + video editor (Screen Studio alternative), built as an Electron app with a React/Vite renderer. Recording, editing (zooms, cursor effects, annotations, captions, backgrounds), and export (MP4/GIF via WebCodecs) all happen locally. Note: the upstream repo is archived; a community fork lives at https://github.com/EtienneLescot/openscreen.

## Commands

```bash
npm run dev                  # Vite dev server + Electron (vite-plugin-electron)
npm run lint                 # biome check .
npm run lint:fix             # biome check --write .
npm run test                 # unit tests (Vitest, jsdom) — src/**/*.test.ts excluding *.browser.test.ts
npx vitest run path/to/file.test.ts   # run a single unit test file
npm run test:browser         # browser tests (Vitest + Playwright Chromium) — src/**/*.browser.test.ts
npm run test:browser:install # one-time Chromium install for browser tests
npm run test:e2e             # Playwright e2e tests in tests/e2e/
npm run i18n:check           # verify locale key coverage
npm run build:mac            # builds Swift ScreenCaptureKit helper first, then app
npm run build:win            # builds Windows WGC helper first, then app
```

Formatting is Biome (tabs, line width 100); husky + lint-staged run `biome check` on commit. Use Node/npm per `.nvmrc`. `AGENTS.md` holds general repo guidelines (naming, commit/PR conventions).

## Testing conventions (docs/tests/writing-tests.md)

- **Unit tests** (`vitest.config.ts`, jsdom): pure logic, hooks, i18n coverage. Co-locate as `foo.test.ts` next to `foo.ts`, or in `__tests__/`.
- **Browser tests** (`vitest.browser.config.ts`, real Chromium): anything needing `VideoDecoder`/`VideoEncoder`/`MediaRecorder`/`OffscreenCanvas`/WebGL/Pixi. Name `foo.browser.test.ts`. Fixtures live in `tests/fixtures/`, imported with Vite's `?url` suffix. 120s per-test timeout — keep fixture dimensions/bitrates small.
- `@/` alias resolves to `src/`.

## Architecture

### Multi-window Electron app

`electron/main.ts` boots the app; `electron/windows.ts` creates the windows. All windows load the same renderer bundle and route on the `?windowType=` query param in `src/App.tsx`:

- `hud-overlay` → `LaunchWindow` (recording HUD)
- `source-selector` → screen/window picker
- `countdown-overlay` → pre-record countdown
- `editor` (default) → `VideoEditor`

### Native bridge (docs/architecture/native-bridge.md)

Two IPC surfaces coexist:

- **Legacy**: `window.electronAPI` exposed by `electron/preload.ts`, handlers in `electron/ipc/handlers.ts`.
- **Unified native bridge** (preferred for new native features): renderer calls `src/native/client.ts` → single `native-bridge:invoke` channel with versioned contracts (`src/native/contracts.ts`) → registered in `electron/ipc/nativeBridge.ts` → domain services in `electron/native-bridge/services/*` → platform adapters (e.g. `electron/native-bridge/cursor/`). Runtime-native state lives in the main process (`electron/native-bridge/store.ts`); every response uses a consistent result envelope with stable error codes.

### Recording pipelines

Capture is platform-specific; everything downstream (editor/export) is shared:

- **macOS**: Swift helper binary using ScreenCaptureKit, source in `electron/native/screencapturekit/` (SwiftPM), built by `scripts/build-macos-screencapturekit-helper.mjs` into `electron/native/bin/`. Renderer side in `src/lib/nativeMacRecording.ts`.
- **Windows**: WGC (Windows Graphics Capture) helper, source in `electron/native/wgc-capture/`, built by `scripts/build-windows-wgc-helper.mjs`. Renderer side in `src/lib/nativeWindowsRecording.ts`. Various `test:wgc-*:win` scripts exercise it directly.
- **Linux / fallback**: browser pipeline (getDisplayMedia + MediaRecorder) via `src/hooks/useScreenRecorder.ts`.

Native pipelines also capture real cursor telemetry (shape/type/clicks) which powers cursor themes and click effects in the editor; the browser pipeline only records cursor position. Native capture is VFR — ScreenCaptureKit only emits frames when the screen changes — and the helpers honor the requested fps (renderer targets 60).

### Recording session artifacts

A native recording produces a family of sibling files next to `recording-<id>.mp4`:

- `recording-<id>.session.json` — the session manifest (`src/lib/recordingSession.ts`), including `audioStreams`/`audioTracks` metadata mapping mp4 audio track ordinals to their source (`"system"` | `"microphone"`). The editor relies on this to build audio timeline tracks — recordings can have 0–2 audio tracks and nothing about their order is hardcoded.
- `recording-<id>.mp4.diagnostics.json` — capture health (actual frame rate, frame/audio gap stats).
- `recording-<id>.cursor.json` — cursor telemetry samples.

For preview, individual audio tracks are extracted main-process-side via `electron/ipc/previewAudio.ts` (track selection logic is pure and unit-tested).

### Editor and export (renderer)

- `src/components/video-editor/VideoEditor.tsx` is the editor shell; `VideoPlayback.tsx` + `videoPlayback/` render the preview (zoom transforms, cursor rendering, motion smoothing); `timeline/` holds the timeline editor (`timelineCommands.ts`, `timelineMapper.ts` are the pure logic, well unit-tested).
- **Preview transport** (`videoPlayback/previewTransport.ts`): the screen **video element is the master clock** — the playhead follows `video.currentTime` via `resolveVideoMasterAdvance`; audio elements drift-correct against it. `videoEventHandlers.ts` guards playback: any `video.play()` not initiated through the imperative `VideoPlaybackRef.play()` is immediately paused, so never call raw `video.play()` from editor code — going around the ref causes a play/pause loop that makes the preview (and cursor/zoom effects, which follow the playhead) step frame-by-frame while audio keeps playing.
- Project save/load: `src/components/video-editor/projectPersistence.ts` (versioned, `PROJECT_VERSION` with migrations); editor state types in `types.ts`; undo/redo in `src/hooks/useEditorHistory.ts`.
- **Export**: `src/lib/exporter/` — WebCodecs-based pipeline (`videoExporter.ts` orchestrates `streamingDecoder.ts` → `frameRenderer.ts` (Pixi.js compositing) → `muxer.ts`/mediabunny; `audioEncoder.ts`, `gifExporter.ts` for GIF).
- **Captions**: `src/lib/captioning/` — on-device Whisper via `@xenova/transformers` in a worker, plus an OpenAI Whisper API backend (`openaiWhisper.ts`). `vite.config.ts` stubs Node builtins (`fs`, `path`, `url`, `onnxruntime-node`) so transformers can bundle for the renderer — don't remove those aliases.
- **i18n**: `src/i18n/locales/` (13 languages). New user-facing strings must be added to every locale; `npm run i18n:check` enforces key coverage.
