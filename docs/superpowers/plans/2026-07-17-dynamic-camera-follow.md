# Dynamic Camera Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic `camera.follow_actor` and `camera.follow_group` commands and generate them across complete subtitle windows.

**Architecture:** Agent choreography selects explicit subjects and timing; shared contracts preserve those commands; Web runtime calculates camera state from current model snapshots. Existing static camera transitions remain compatible.

**Tech Stack:** TypeScript, Zod, Node test runner, Vitest, Mapbox GL, Playwright desktop Chromium.

## Global Constraints

- Feature delivery precedes broad regression; run only the named focused tests and one real desktop replay.
- Runtime camera state must be deterministic after seek and replay.
- The runtime must never infer narrative subjects; entity IDs come from compiled commands.
- Existing `ise-scene/v1` static camera projects remain valid.
- Desktop Chromium only.

---

### Task 1: Shared and Canonical Camera Contracts

**Files:**
- Modify: `packages/runtime-contracts/src/scene.ts`
- Modify: `packages/runtime-contracts/test/scene.test.ts`
- Modify: `agent/src/contracts/runtimePlan.ts`
- Modify: `agent/test/contracts.test.ts`
- Modify: `agent/src/adapters/baseRuntimeAdapter.ts`
- Modify: `agent/test/base-runtime-adapter.test.ts`

**Interfaces:**
- Produces strict `camera.follow_actor` and `camera.follow_group` parameter unions.
- Preserves both commands as camera track items through `BaseRuntimeAdapter`.

- [ ] Add failing tests that parse both command shapes, reject unknown entity IDs and inverted zoom bounds, and adapt both commands.
- [ ] Run `npm exec -w @ise/runtime-contracts -- tsx --test test/scene.test.ts` and the named Agent contract/adapter tests; confirm failure is caused by missing follow types.
- [ ] Add the two command types and strict parameter schemas. Add scene-level entity-reference and group-uniqueness validation.
- [ ] Extend `commandTrackType` and `commandToItem` so both map to the camera track unchanged.
- [ ] Re-run only the focused contract and adapter tests.

### Task 2: Dynamic Camera Runtime

**Files:**
- Modify: `apps/web/src/runtime/MapRuntime.ts`
- Modify: `apps/web/src/runtime/SceneRuntime.ts`
- Modify: `apps/web/src/runtime/__tests__/MapRuntime.test.ts`
- Modify: `apps/web/src/runtime/__tests__/SceneRuntime.test.ts`
- Modify: `apps/web/src/runtime/__tests__/helpers/fakes.ts`

**Interfaces:**
- `MapRuntime.applyBase(timeMs, snapshots)` consumes `readonly ModelEntityFrameSnapshot[]`.
- Actor follow produces a fixed-zoom state centered on the current visible actor.
- Group follow uses `map.cameraForBounds` with padding and clamps.

- [ ] Add failing MapRuntime tests for actor movement, group fit, hidden-subject fallback, and seek/replay determinism.
- [ ] Add a failing SceneRuntime order assertion: model apply and snapshot must precede map apply.
- [ ] Run the two focused Vitest files and confirm the expected failures.
- [ ] Implement follow-state selection and deterministic boundary blending in MapRuntime.
- [ ] Reorder SceneRuntime frame application and pass snapshots to MapRuntime.
- [ ] Re-run only the two focused Vitest files and Web typecheck.

### Task 3: Subtitle-Covering Director Compilation

**Files:**
- Modify: `agent/src/compiler/choreographyCompiler.ts`
- Modify: `agent/src/compiler/sceneCompiler.ts`
- Modify: `agent/test/compiler.test.ts`
- Modify: `agent/test/scene-blueprint-planner.test.ts`

**Interfaces:**
- Choreography retains an establishing shot before engagement phases.
- Compiler emits nonoverlapping dynamic follow commands spanning each subtitle visual window.
- Cross-beat interceptions do not terminate the incoming weapon in its launch subtitle.

- [ ] Add failing compiler tests for establishing-shot retention, full subtitle camera coverage, global active-actor subjects, distributed phases, and surviving interception aftermath subjects.
- [ ] Run the named compiler tests and confirm failures reflect the current static/four-second behavior.
- [ ] Retain establishing shots and identify upstream weapons intercepted by later engagements.
- [ ] Compile actor/group follow commands after subtitle and lifecycle scheduling; divide engagement windows among supported shots.
- [ ] Move impact, hide, and destroyed-state commands to the corresponding distributed terminal/aftermath times.
- [ ] Re-run only compiler and scene-blueprint planner tests plus Agent typecheck.

### Task 4: Real Vertical Slice

**Files:**
- Modify: `apps/web/e2e/generated-replay.spec.ts`
- Regenerate ignored artifacts: `.superpowers/sdd/real-demo/*.json`

**Interfaces:**
- Persisted scene includes both dynamic follow kinds.
- Formerly empty subtitle tails keep at least one referenced GLB within the desktop canvas.

- [ ] Add a focused persisted-scene assertion for follow command counts and visible referenced models near the ends of subtitles 2, 4, 6, and 8.
- [ ] Re-export once with `.superpowers/sdd/export-latest-valid-vertical-slice.ts` using a process-only JWT.
- [ ] Run only the focused `desktop-chromium` dynamic-camera test.
- [ ] Inspect one global-tail and one engagement-tail screenshot.
- [ ] Commit implementation and push through `127.0.0.1:7897`.

