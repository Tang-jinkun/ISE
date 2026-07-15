# ISE Artifact Export And Scene Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the three exact Agent/runtime JSON artifacts from NewScript and play the persisted SceneProjectConfig through `/runtime-harness?sceneId=<id>`.

**Architecture:** A pure Web selector correlates the completed runtime artifact to its accepted EventPlan and validated SceneProjectConfig. A small download control renders in the existing NewScript header. RuntimeHarness gains a scene-backed config loader while retaining deterministic fixtures.

**Tech Stack:** TypeScript 5.9, React 19, Zustand 5, Vitest 4, Testing Library, `@ise/runtime-contracts`, existing Nest Scene API and SceneRuntime.

## Global Constraints

- Agent remains an independent TypeScript service; do not add model or compiler logic to Web/Nest.
- SceneProjectConfig is the sole editor, persistence, timeline, and playback data source.
- Supported tracks remain exactly `subtitle`, `image`, `video`, `marker`, `geojson`, `camera`, and `model`.
- Export only public artifact data already returned by the authenticated Agent API.
- Never export local paths, signed URLs, object names, binary bytes, hidden reasoning, or credentials.
- Preserve the current NewScript and harness layout, density, wording, and interaction style.
- Do not add manifest building, MinIO seed, media probing, GLB calibration, or credentials in this plan.

---

### Task 1: Exact Artifact JSON Exports

**Files:**
- Create: `apps/web/src/pages/newScript/artifactExports.ts`
- Create: `apps/web/src/pages/newScript/artifactExports.test.ts`
- Create: `apps/web/src/pages/newScript/components/ArtifactExportControls.tsx`
- Create: `apps/web/src/pages/newScript/components/ArtifactExportControls.test.tsx`
- Modify: `apps/web/src/pages/newScript/index.tsx`
- Modify: `apps/web/src/pages/newScript/newScript.integration.test.tsx`

**Interfaces:**
- Consumes: `AgentSessionState`, `AgentArtifactView`, and `sceneProjectConfigSchema`.
- Produces: `selectArtifactExports(state): ArtifactExports` and `downloadJson(filename, payload): void`.
- Produces filenames exactly `event-plan.json`, `canonical-runtime-plan.json`, and `scene-project.json`.

- [ ] **Step 1: Write selector and serialization RED tests**

Create artifacts for one accepted EventPlan and one completed compiled artifact. Assert the selector returns all three payloads only when session status and lineage match. Assert running/failed sessions, wrong artifact types, mismatched IDs, and malformed scene configs return unavailable exports. Assert serialization is two-space JSON plus `\n`.

```ts
expect(selectArtifactExports(completedState)).toEqual({
  eventPlan: accepted.data,
  runtimePlan: compiled.data.runtimePlan,
  sceneProject: compiled.data.sceneProjectConfig
});
expect(selectArtifactExports({ ...completedState, status: 'failed' }).sceneProject)
  .toBeUndefined();
expect(serializeJson({ ok: true })).toBe('{\n  "ok": true\n}\n');
```

- [ ] **Step 2: Run selector tests and verify RED**

Run: `npm run test -w @ise/web -- --run src/pages/newScript/artifactExports.test.ts`

Expected: FAIL because `artifactExports.ts` does not exist.

- [ ] **Step 3: Implement exact selection and download helpers**

Use exact constants for accepted and compiled artifact types. Require `status === 'completed'`, the exact `latestCompletedRuntimeArtifactId`, non-superseded compiled data, a string `runtimePlan.eventPlanArtifactId`, exact accepted artifact type, shared SceneProjectConfig parsing, and both lineage ID equalities. Return `undefined` per unavailable payload; never repair data.

```ts
export type ArtifactExports = {
  eventPlan?: Record<string, unknown>;
  runtimePlan?: Record<string, unknown>;
  sceneProject?: SceneProjectConfig;
};

export const serializeJson = (payload: unknown) => `${JSON.stringify(payload, null, 2)}\n`;
```

`downloadJson` creates `new Blob([serializeJson(payload)], { type: 'application/json;charset=utf-8' })`, clicks a temporary anchor with the exact filename, removes it, and revokes the object URL in `finally`.

- [ ] **Step 4: Write control and page integration RED tests**

Render controls without exports and assert all three are disabled. Render completed exports, click each command, and assert exact filename/payload pairs. In the existing NewScript integration fixture, hydrate the accepted and compiled artifacts, emit `run.completed` with only `runtimeArtifactId`, and assert the three commands become enabled.

- [ ] **Step 5: Implement compact controls in the existing header**

`ArtifactExportControls` receives `exports` and an injectable `download` callback for tests. Render three existing Button-style commands with `Download` icons and the labels `EventPlan`, `RuntimePlan`, `SceneProject`. In NewScript, compute exports from the same Zustand session slice used for `completedSceneConfig`; do not copy artifact data into component state.

- [ ] **Step 6: Verify Task 1**

Run: `npm run test -w @ise/web -- --run src/pages/newScript/artifactExports.test.ts src/pages/newScript/components/ArtifactExportControls.test.tsx src/pages/newScript/newScript.integration.test.tsx`

Expected: PASS.

Run: `npm run typecheck -w @ise/web`

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```powershell
git add apps/web/src/pages/newScript
git commit -m "feat(web): export reviewed runtime artifacts"
```

### Task 2: Persisted Scene Runtime Harness

**Files:**
- Modify: `apps/web/src/pages/RuntimeHarness.tsx`
- Create: `apps/web/src/pages/RuntimeHarness.test.tsx`
- Modify: `apps/web/e2e/generated-replay.spec.ts`

**Interfaces:**
- Consumes: `getScene(sceneId)` and `sceneProjectConfigSchema`.
- Produces: `/runtime-harness?sceneId=<id>` while retaining both fixture query values.
- Produces: one `RuntimeHarnessController({ config })` shared by scene and fixture sources.

- [ ] **Step 1: Write harness source RED tests**

Mock `getScene`, Mapbox, and `useSceneRuntime`. Assert `sceneId` takes precedence, the exact Scene ID is fetched, a valid config reaches the runtime hook, invalid configs render `role=alert`, and `fixture=runtime-main` never calls the API.

- [ ] **Step 2: Run harness tests and verify RED**

Run: `npm run test -w @ise/web -- --run src/pages/RuntimeHarness.test.tsx`

Expected: FAIL because RuntimeHarness ignores `sceneId`.

- [ ] **Step 3: Refactor the harness around a config prop**

Parse the query into fixture or scene source. Scene mode loads through `getScene`, validates at the boundary, and renders loading/blocking states. Pass `config`, not fixture name, into the existing controller. Replace all `fixtures[fixture]` duration/config reads with the config prop.

- [ ] **Step 4: Add the real-scene E2E entry**

Extend the existing generated replay spec to accept `ISE_E2E_SCENE_ID`. When provided with the already-required Mapbox/access tokens and running services, navigate to `/runtime-harness?sceneId=<encoded id>` and reuse the ready/play/seek/canvas checks. Missing prerequisites throw explicit errors; do not skip or fall back to a fixture.

- [ ] **Step 5: Verify Task 2**

Run: `npm run test -w @ise/web -- --run src/pages/RuntimeHarness.test.tsx src/hooks/useSceneRuntime.test.tsx`

Expected: PASS.

Run: `npm run test -w @ise/web -- --run`

Expected: PASS.

Run: `npm run typecheck -w @ise/web`

Expected: PASS.

Run: `npm run test:e2e -w @ise/web -- --list generated-replay.spec.ts`

Expected: PASS and list desktop/mobile cases. Actual browser execution remains blocked until Mapbox token, JWT, real Scene ID, API, manifest, and MinIO seed exist.

- [ ] **Step 6: Commit Task 2**

```powershell
git add apps/web/src/pages/RuntimeHarness.tsx apps/web/src/pages/RuntimeHarness.test.tsx apps/web/e2e/generated-replay.spec.ts
git commit -m "feat(web): load persisted scenes in runtime harness"
```

## Self-Review

- Spec coverage: both requested artifact visibility and persisted-scene harness are covered by separate tasks.
- Placeholder scan: no TBD/TODO or deferred implementation step exists.
- Type consistency: Task 1 exports public artifact DTO data; Task 2 consumes only shared SceneProjectConfig and the existing Scene API.
- Scope: real asset preparation remains in the already-approved Task 7 plan because it requires external media metadata and model calibration.
