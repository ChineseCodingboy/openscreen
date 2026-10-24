# Repository Guidelines

## Project Structure & Module Organization

OpenScreen is an Electron application with a React/Vite renderer. `electron/` contains the main process, preload code, IPC handlers, native bridge, and platform capture helpers. Renderer code lives in `src/`: editor UI is under `src/components/video-editor/`, reusable hooks in `src/hooks/`, media and export logic in `src/lib/`, and translations in `src/i18n/locales/`. Runtime files belong in `public/`; imported assets in `src/assets/`; helper scripts in `scripts/`. Keep unit tests beside their source or in a nearby `__tests__/` directory. Playwright flows and media fixtures live in `tests/e2e/` and `tests/fixtures/`. Do not edit generated `dist/`, `dist-electron/`, or `release/` output.

## Build, Test, and Development Commands

Use Node 22.22.1 and npm 10.9.4 (see `.nvmrc` and `package.json`), then run `npm ci`.

- `npm run dev` starts Vite and Electron for local development.
- `npm run lint` checks the tree with Biome; `npm run lint:fix` applies safe fixes.
- `npm run test` runs jsdom-based Vitest tests once; `npm run test:watch` watches them.
- `npm run test:browser` runs real-Chromium Vitest tests. First run `npm run test:browser:install`.
- `npm run test:e2e` executes Playwright specs in `tests/e2e/`.
- `npm run i18n:check` verifies that locale keys remain aligned.
- `npm run build-vite` type-checks and builds without packaging. Use `build:mac`, `build:win`, or `build:linux` for platform packages.

## Coding Style & Naming Conventions

TypeScript is strict. Biome enforces tabs, LF endings, double quotes, and a 100-column limit for supported files; run it before committing. Prefer `@/` imports for long paths into `src/`. Name React components and component files in `PascalCase`, functions and variables in `camelCase`, and constants in descriptive camelCase or `UPPER_SNAKE_CASE`. Avoid unused declarations and unexplained `any`; comment only where behavior is not evident from the code.

## Testing Guidelines

Name unit tests `*.test.ts` or `*.test.tsx`. Use `*.browser.test.ts` for WebCodecs, MediaRecorder, canvas, WebGL, or Pixi behavior that requires Chromium. Keep fixtures small because export tests are CPU-bound. No numeric coverage threshold is configured, but every behavior change should include focused regression coverage and relevant platform smoke testing.

## Commit & Pull Request Guidelines

History mixes short imperative summaries with scoped Conventional Commit forms; prefer clear messages such as `fix(export): preserve audio timestamps`. Use focused branches such as `feature/webcam-mirroring`. Pull requests should follow `.github/pull_request_template.md`: explain the change and motivation, classify it, link issues, list verification steps, and attach screenshots or video for visible behavior. Complete a self-review and note platform-specific testing or limitations.
