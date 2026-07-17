# Dynamic Camera Task 2 Report

## Scope

- `apps/web/src/runtime/MapRuntime.ts`
- `apps/web/src/runtime/SceneRuntime.ts`
- `apps/web/src/runtime/__tests__/MapRuntime.test.ts`
- `apps/web/src/runtime/__tests__/SceneRuntime.test.ts`
- `apps/web/src/runtime/__tests__/helpers/fakes.ts`
- `apps/web/src/runtime/__tests__/runtimeFixtures.test.ts` (required exhaustive static-camera narrowing)

## Red Evidence

The required focused command was run before implementation:

```text
npm run test -w @ise/web -- --run src/runtime/__tests__/MapRuntime.test.ts src/runtime/__tests__/SceneRuntime.test.ts
```

Vitest could not discover either test file because Node `v20.17.0` cannot load the installed `html-encoding-sniffer` dependency: it performs a CommonJS `require()` of the ESM module `@exodus/bytes/encoding-lite.js` and exits with `ERR_REQUIRE_ESM`. Re-running after implementation produced the same pre-test worker bootstrap failure.

## Green Evidence

```text
npm run typecheck -w @ise/web
```

Completed successfully with exit code 0.

## Implemented Behavior

- Scene frames now apply models, collect snapshots, apply map base/camera, trails, data links, and overlays in that order.
- Map camera base application receives immutable model snapshots.
- Static camera behavior remains on the existing reducer and uses `jumpTo`.
- Actor follow uses the current visible snapshot, a deterministic heading look-ahead, and configured zoom/pitch/bearing.
- Group follow fits visible requested members, supports one-member max zoom, bounds padding, zoom clamps, and undefined `cameraForBounds` fallback.
- Dynamic camera transitions blend from the immediately preceding camera policy, including a preceding dynamic policy evaluated from current snapshots.
- FakeMap supports deterministic `cameraForBounds` tests.

## Concerns

- Focused Vitest execution is blocked before test discovery by the workspace Node/dependency compatibility issue above. No dependency, Docker, compiler, or Agent files were changed to work around it.
- The approved fixture dependency only narrows its legacy static-camera assertion; it does not change fixture data or runtime behavior.
