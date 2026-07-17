# Task 3 Report: Reliable Drag Completion and Subtitle Glass

## Status

PASS. Task 3 is implemented and its required focused tests, Web typecheck, and diff check pass.

## Root Cause

- `Dragger` installed document listeners from a render whose `isDragging` / `isResizing` values were still false. The following state render also removed those listeners, so real document mouse-move events could be ignored. Even when completion ran, it emitted the original controlled props with empty collision metadata instead of the last movement result.
- `OverlayRuntime.createSubtitle` only applied positioning and activity styles. It did not provide a content-width cap or a readable foreground, glass background, spacing, wrapping, blur, border, and shadow treatment.

## Files

- `apps/web/src/components/common/Dragger/index.tsx`
- `apps/web/src/components/common/Dragger/Dragger.test.tsx`
- `apps/web/src/runtime/OverlayRuntime.ts`
- `apps/web/src/runtime/__tests__/OverlayRuntime.test.ts`
- `.superpowers/sdd/continuous-motion-task-3-report.md`

## RED Evidence

Node: `v24.14.0`

- `Dragger.test.tsx`: 2 tests failed. After real mouse-down and document mouse-move events, `onDrag` and `onResize` had both been called 0 times.
- `OverlayRuntime.test.ts`: 1 of 18 tests failed. The subtitle retained `maxWidth: 60%` instead of `min(60%, calc(100% - 32px))`.

## GREEN Evidence

- Focused Vitest: 2 files passed, 20 tests passed.
- Web typecheck: `tsc --noEmit` exited 0.
- `git diff --check` and staged diff checks exited 0.

## Commit

Implementation commit: `f2c3b17c27b538e1b5c310aa15f7e5fec6fcd286`

## Concerns

- The optional focused Biome check cannot start because the repository currently has conflicting root configurations at the repository root and `apps/web/biome.json`. This task did not modify either configuration. The required Vitest, TypeScript, and diff checks pass.
- Git reports that LF files may be converted to CRLF the next time it touches them; `git diff --check` reports no whitespace errors.

## Task 2/3 Joint Review Follow-up

### Root Cause

The active document listeners were installed by effects that only depended on `isDragging` or `isResizing`. A parent rerender during a gesture updated the component props but did not replace those listeners, so their closures kept the gesture-start axis, snapping and collision targets, validation function, resize constraints, and completion callbacks.

### RED Evidence

Node: `v24.14.0`

- Focused `Dragger.test.tsx`: 2 of 4 tests failed.
- The drag listener called the initial validation with unsnapped, unrestricted coordinates `(39, 59)` instead of the rerendered validation with the latest axis and snapped coordinates `(40, 20)`.
- The resize listener called the initial callback with `width: 55` instead of applying the rerendered `maxW: 40` constraint and latest callback.

### Fix

The document listeners now use stable wrapper functions that dispatch through refs updated on every render. Move and mouse-up handling therefore read the latest props and callbacks while the refs holding final geometry, collisions, and guides remain continuous for the gesture.

### GREEN Evidence

- Focused `Dragger.test.tsx`: 1 file passed, 4 tests passed.
- Web typecheck: `tsc --noEmit` exited 0.
- `git diff --check` exited 0.

### Follow-up Concerns

None beyond the existing repository Biome configuration and line-ending notes above.
