# Continuous Motion, Entity Tracks, and Subtitle Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every generated actor moving throughout its narrated lifecycle, persist one editable model track per entity, and render readable glass-backed subtitles.

**Architecture:** Choreography declares actor-lifecycle motion coverage; final compilation resolves it against scheduled subtitle anchors. The runtime adapter persists entity-owned model tracks without changing the scene schema, while shared overlay and drag primitives receive focused presentation and interaction fixes.

**Tech Stack:** TypeScript, Zod, Node test runner, React, Vitest, Playwright, Docker Compose.

## Global Constraints

- Subtitle appears 800 ms before scene motion begins.
- A generated actor uses only its assigned catalog trajectory; no synthesized or looped route.
- One persisted model track per entity; existing `ise-scene/v1` single model tracks remain valid.
- Desktop Chromium is the only visual acceptance target.
- Do not write model credentials, JWTs, or signed asset URLs to source, logs, artifacts, or test output.

---

### Task 1: Actor-Lifecycle Motion Coverage

**Files:**
- Modify: `agent/src/contracts/choreographyPlan.ts`
- Modify: `agent/src/compiler/choreographyCompiler.ts`
- Modify: `agent/src/compiler/sceneCompiler.ts`
- Test: `agent/test/compiler.test.ts`
- Test: `agent/test/scene-generation-contracts.test.ts`

**Interfaces:**
- Produces: `MotionSegment.coverage: 'actor-lifecycle'`
- Produces: canonical `model.follow_path` ending at the final bound subtitle end, followed immediately by `model.hide`

- [ ] **Step 1: Write failing contract and compiler tests**

Add assertions equivalent to:

```ts
assert.equal(motion.coverage, 'actor-lifecycle')
assert.equal(follow.startMs, spawn.startMs + spawn.durationMs)
assert.equal(follow.startMs + follow.durationMs, lastSubtitle.startMs + lastSubtitle.durationMs)
assert.equal(hide.startMs, follow.startMs + follow.durationMs)
```

For the multi-actor fixture, assert every actor has one overlapping follow, a unique target, and its assigned unique trajectory.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx tsx --test --test-name-pattern "actor-lifecycle|full narrated lifecycle|exact multi-actor" test/compiler.test.ts test/scene-generation-contracts.test.ts
```

Expected: failure because `coverage` is absent and follow ends after 6,000 ms.

- [ ] **Step 3: Implement lifecycle timing resolution**

Add `coverage: z.literal('actor-lifecycle')` to `motionSegmentSchema`, emit it from `compileChoreography`, and add a focused helper in `sceneCompiler.ts` that receives the scheduled subtitles and commands. For each lifecycle it must replace follow duration and hide start using the first/last SceneBeat subtitle anchors. Reject windows shorter than `capabilityManifest.minimumDurations['model.follow_path']` with `NARRATION_VISUAL_DURATION_CONFLICT`, then recompute `totalDurationMs` from subtitle and command ends.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

### Task 2: Persist One Model Track per Entity

**Files:**
- Modify: `agent/src/adapters/baseRuntimeAdapter.ts`
- Test: `agent/test/base-runtime-adapter.test.ts`
- Modify: `apps/web/src/pages/Scene/components/Timeline.tsx`
- Test: `apps/web/src/pages/Scene/components/Timeline.test.tsx`

**Interfaces:**
- Consumes: `CanonicalRuntimePlan.entities` and model commands
- Produces: `track:model:<entityId>` with `label = entity.displayName`

- [ ] **Step 1: Write failing adapter and Timeline tests**

Build a two-entity runtime plan and assert:

```ts
const modelTracks = config.tracks.filter(track => track.type === 'model')
assert.equal(modelTracks.length, 2)
assert.deepEqual(modelTracks.map(track => track.label), ['JF-17 leader', 'JF-17 wingman 1'])
assert.ok(modelTracks.every(track => new Set(track.items.map(item => item.params.entityId)).size === 1))
```

Render two model tracks with simultaneous clips and assert both labels and clip ids are visible in distinct rows. Assert collision targets do not permit a model clip to move into a lane owned by a different `entityId`; horizontal timing edits remain enabled.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx tsx --test test/base-runtime-adapter.test.ts
npx vitest run src/pages/Scene/components/Timeline.test.tsx
```

Expected: adapter test reports one model track.

- [ ] **Step 3: Implement entity grouping**

Keep the existing type maps for non-model commands. Group model commands by their `params.entityId`, look up the matching runtime entity for the display label, and emit stable entity tracks after the camera track. Throw on a model command whose entity is absent rather than creating an unlabeled lane. In Timeline, infer a model lane owner from its items and exclude different-owner model lanes from drag collision targets; generic legacy model tracks remain renderable.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 commands. Expected: both suites pass.

### Task 3: Reliable Drag Completion and Subtitle Glass

**Files:**
- Modify: `apps/web/src/components/common/Dragger/index.tsx`
- Create: `apps/web/src/components/common/Dragger/Dragger.test.tsx`
- Modify: `apps/web/src/runtime/OverlayRuntime.ts`
- Test: `apps/web/src/runtime/__tests__/OverlayRuntime.test.ts`

**Interfaces:**
- Produces: `onDragEnd` and `onResizeEnd` with latest geometry/collisions
- Produces: shared glass subtitle presentation

- [ ] **Step 1: Write failing interaction and style tests**

Simulate mouse-down, mouse-move, and mouse-up and assert `onDragEnd` receives the moved x/y and collision ids. Simulate east resize and assert the final width. Extend the subtitle test with:

```ts
expect(bottom.style.width).toBe('max-content')
expect(bottom.style.backgroundColor).toBe('rgba(255, 255, 255, 0.84)')
expect(bottom.style.color).toBe('rgb(17, 24, 39)')
expect(bottom.style.backdropFilter).toContain('blur(12px)')
expect(bottom.style.overflowWrap).toBe('anywhere')
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx vitest run src/components/common/Dragger/Dragger.test.tsx src/runtime/__tests__/OverlayRuntime.test.ts
```

Expected: final geometry and glass style assertions fail.

- [ ] **Step 3: Implement latest-state refs and glass styles**

Track the latest drag/resize result in refs updated in move handlers; mouse-up must emit the refs and then reset them. Apply the exact style values from the design in `createSubtitle`, preserving positioning, `zIndex`, `pointerEvents`, and half-open activity intervals.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: both test files pass.

### Task 4: Real Flow and Desktop Acceptance

**Files:**
- Modify: `.superpowers/sdd/run-real-docx-flow.ps1`
- Modify: `.superpowers/sdd/test-run-real-docx-flow.ps1`
- Modify: `apps/web/e2e/generated-replay.spec.ts`

**Interfaces:**
- Validates: one model track and continuous follow interval per runtime entity
- Validates: readable subtitle bounds and styles in desktop Chromium

- [ ] **Step 1: Add failing invariant and E2E assertions**

The real-flow gate must reject entity/model-track count mismatch and any actor with a gap between follow end and hide start. E2E must assert 13 model tracks, moving positions at a late point in each sampled lifecycle, and subtitle computed background/color/blur plus viewport containment.

- [ ] **Step 2: Run invariant tests and verify RED**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\.superpowers\sdd\test-run-real-docx-flow.ps1
npx playwright test generated-replay.spec.ts --project=desktop-chromium
```

Expected: new model-track/style assertions fail before implementation is wired through.

- [ ] **Step 3: Regenerate and persist the real scene**

Rebuild Agent and Web with `.ise/docker.env`, run `run-real-docx-flow.ps1` with an in-memory short-lived JWT for the configured subject, and export the new seven artifacts plus Scene id.

- [ ] **Step 4: Run final verification**

Run Agent full tests/typecheck, Web 308+ tests/typecheck using Node >=20.19, API MinIO test, real-flow contract test, desktop Chromium E2E, Docker health, `git diff --check`, and secret scan. Expected: all pass with five healthy containers.
