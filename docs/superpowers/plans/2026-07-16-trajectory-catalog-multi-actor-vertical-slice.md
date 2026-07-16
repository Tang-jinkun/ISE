# Trajectory Catalog Multi-Actor Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the real Indo-Pak DOCX into subtitle-led, reviewable multi-aircraft choreography that assigns only registered existing trajectories and persists a playable Scene.

**Architecture:** Keep the current model-generated `NarrativePlan` as a compatibility input, then deterministically derive the final `NarrationPlan -> SceneBlueprint -> ResolvedScenePlan -> ChoreographyPlan` artifacts before compiling the existing runtime commands. The first vertical slice keeps `CanonicalRuntimePlan v1` and `SceneProjectConfig v1` at the player boundary because both already support multiple entities; the new final-domain artifacts are versioned now so later v2 tracks do not require replacing the semantic pipeline.

**Phase Boundary:** This slice persists, exports and displays the SceneBlueprint but does not yet add a second blocking review state to the session API. EventPlan approval remains the blocking gate; the follow-up review-state plan will pause between the already-versioned SceneBlueprint and ResolvedScenePlan without changing their contracts or the compiler below them.

**Tech Stack:** TypeScript 5.9, Zod 4, Node.js 20, NestJS 10, React 19, Zustand, Vitest/Jest/Node test runner, Playwright desktop Chromium, MinIO.

## Global Constraints

- DOCX exact quantities are authoritative; missing fighter-formation quantities use default `4`, and each unquantified launch uses default `1`.
- A default quantity is always marked `source: "default"` and never added to factual subtitle text.
- The first visual command for a NarrationBeat starts at least `800ms` after its subtitle starts.
- Register all 18 aircraft and 3 missile trajectories; unused catalog capacity must not create extra actors.
- The current Indo-Pak compilation must produce no synthesized trajectory and no silent route reuse.
- `Vampire` is a scenario-local Su-30MKI callsign; J-10CE route labels map to current-scenario JF-17 actors with an explicit diagnostic, never through a global synonym.
- Raw GLB, MP4, PNG and trajectory payloads remain uncommitted; Git stores manifests, calibration, mappings and repair provenance only.
- Preserve current SceneProjectConfig v1 and current Scene playback compatibility while the upstream final artifacts are introduced.
- Preserve the current frontend design language; add a compact unframed blueprint summary, not a separate test UI.
- Run only desktop Chromium E2E acceptance; retain existing responsive code without new mobile work.
- API credentials are process environment only and must never appear in files, logs, commits or responses.

---

### Task 1: Curate and Register the Complete Trajectory Catalog

**Files:**
- Create: `packages/runtime-contracts/src/trajectoryCuration.ts`
- Create: `packages/runtime-contracts/test/trajectory-curation.test.ts`
- Modify: `packages/runtime-contracts/src/assets.ts`
- Modify: `packages/runtime-contracts/src/prepareAssetForUpload.ts`
- Modify: `packages/runtime-contracts/src/index.ts`
- Modify: `packages/runtime-contracts/package.json`
- Modify: `apps/api/src/cli/build-asset-manifest.ts`
- Modify: `apps/api/src/cli/build-asset-manifest.spec.ts`
- Modify: `apps/api/src/cli/seed-assets.spec.ts`
- Modify: `provenance/asset-source-map.json`
- Modify: `provenance/assets.seed.json`
- Modify: `provenance/ASSET-SEED.md`

**Interfaces:**
- Consumes: raw operator trajectory bytes and optional `TrajectoryCuration` embedded in the trajectory manifest entry.
- Produces: `prepareTrajectorySource(assetId, sourceBytes, curation): Promise<PreparedTrajectorySource>` used identically by manifest build and seed upload.

- [ ] **Step 1: Write failing curation and upload-equivalence tests**

```ts
const curation = {
  policyId: 'trajectory.shift-suffix/v1',
  expectedSourceFingerprint: rawFingerprint,
  startIndex: 91,
  deltaMs: 2_000,
} as const

const first = await prepareTrajectorySource('trajectory:ambala-su30mki-1', rawBytes, curation)
const second = await prepareTrajectorySource('trajectory:ambala-su30mki-1', rawBytes, curation)
assert.deepEqual(first, second)
assert.equal(first.normalized.points[90]!.timeMs + 1_000, first.normalized.points[91]!.timeMs)
assert.equal(first.repair?.affectedRange.startIndex, 91)
assert.equal(first.repair?.deltaMs, 2_000)
```

- [ ] **Step 2: Run the focused tests and confirm the helper is absent**

Run: `npx tsx --test packages/runtime-contracts/test/trajectory-curation.test.ts`

Expected: FAIL because `prepareTrajectorySource` and `trajectoryCurationSchema` do not exist.

- [ ] **Step 3: Add the strict versioned curation contract and shared preparation helper**

```ts
export const trajectoryCurationSchema = z.strictObject({
  policyId: z.literal('trajectory.shift-suffix/v1'),
  expectedSourceFingerprint: fingerprintSchema,
  startIndex: z.number().int().positive(),
  deltaMs: z.number().int().positive(),
})

export type PreparedTrajectorySource = {
  bytes: Uint8Array
  normalized: NormalizedTrajectory
  repair?: {
    policyId: 'trajectory.shift-suffix/v1'
    affectedRange: { startIndex: number; endIndex: number }
    deltaMs: number
  }
}
```

`prepareTrajectorySource` must verify `expectedSourceFingerprint`, shift timestamps only from `startIndex`, preserve every latitude/longitude/altitude and array position, normalize once, and return the exact canonical bytes used by both `buildAssetManifest()` and `prepareAssetForUpload()`.

The real source-map curation tuple is:

```json
{
  "policyId": "trajectory.shift-suffix/v1",
  "expectedSourceFingerprint": "sha256:ba6e0167c0d31e1141a6890bf033e1e671f1f364e7109471f28c7ab000a95995",
  "startIndex": 91,
  "deltaMs": 2000
}
```

- [ ] **Step 4: Replace the hard-coded invalid trajectory branch**

Delete `reversedOptionalTrajectoryId` and the `availability: "invalid"` branch from `build-asset-manifest.ts`. Extend the source-map parser with an optional `trajectoryCuration` field, call `prepareTrajectorySource`, and include the curation record in trajectory metadata.

- [ ] **Step 5: Register all 21 stable trajectory IDs**

```ts
const expectedTrajectoryIds = [
  'trajectory:adampur-vampire-1', 'trajectory:adampur-vampire-2',
  'trajectory:adampur-vampire-3', 'trajectory:adampur-vampire-4',
  'trajectory:ambala-rafale-1', 'trajectory:ambala-rafale-2',
  'trajectory:ambala-rafale-3', 'trajectory:ambala-rafale-4',
  'trajectory:ambala-su30mki-1', 'trajectory:ambala-su30mki-2',
  'trajectory:minhas-j10ce-1', 'trajectory:minhas-j10ce-2',
  'trajectory:minhas-j10ce-3', 'trajectory:minhas-j10ce-4',
  'trajectory:rafiki-j10ce-1', 'trajectory:rafiki-j10ce-2',
  'trajectory:rafiki-j10ce-3', 'trajectory:rafiki-j10ce-4',
  'trajectory:pakistan-missile-1', 'trajectory:pakistan-strike-missile-2',
  'trajectory:india-missile-1',
] as const
```

Update the frozen source-map test from 22 total assets to 39 total assets and assert exactly these 21 trajectory IDs.

- [ ] **Step 6: Build the real manifest and verify all trajectories are available**

Run:

```powershell
$env:ISE_ASSET_SOURCE_ROOT = (Resolve-Path '.').Path
npm run assets:build-manifest -w @ise/api
npm run assets:validate -- provenance/assets.seed.json
```

Expected: 21 trajectory entries, all `availability: "available"`; Su-30MKI-1 contains the curation record; raw paths and secrets are absent.

- [ ] **Step 7: Run focused package and API tests**

Run: `npm test -w @ise/runtime-contracts && npm test -w @ise/api -- --runInBand build-asset-manifest seed-assets`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add packages/runtime-contracts apps/api/src/cli provenance
git commit -m "feat: register complete trajectory catalog"
```

### Task 2: Add Final Actor, Blueprint, and Route Assignment Contracts

**Files:**
- Create: `agent/src/contracts/narrationPlan.ts`
- Create: `agent/src/contracts/sceneBlueprint.ts`
- Create: `agent/src/contracts/resolvedScenePlan.ts`
- Create: `agent/src/contracts/choreographyPlan.ts`
- Create: `agent/src/contracts/trajectoryCatalog.ts`
- Create: `agent/test/scene-generation-contracts.test.ts`
- Modify: `agent/src/contracts/artifactTypes.ts`
- Modify: `agent/package.json`

**Interfaces:**
- Consumes: accepted `EventPlan`, compatibility `NarrativePlan`, EvidenceIR and AssetRegistry snapshot.
- Produces: strict Zod schemas and types for `NarrationPlan`, `QuantityDecision`, `ActorGroup`, `ActorInstance`, `SceneBlueprint`, `FormationBundle`, `ActorRouteAssignment`, `ResolvedScenePlan` and `ChoreographyPlan`.

- [ ] **Step 1: Write failing strict-schema tests**

```ts
assert.equal(quantityDecisionSchema.parse({
  value: 4, constraint: 'exact', source: 'default', evidenceRefs: [],
  defaultPolicyId: 'fighter-formation/v1', reason: 'No explicit quantity',
}).value, 4)

assert.equal(sceneBlueprintSchema.safeParse({
  schemaVersion: 'ise.scene-blueprint/v1',
  blueprintId: 'blueprint:1',
  sourceNarrationPlanId: 'narration:1',
  sourceNarrationFingerprint: fingerprint,
  actorGroups: [], sceneBeats: [], diagnostics: [],
  unexpected: true,
}).success, false)
```

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `npx tsx --test agent/test/scene-generation-contracts.test.ts`

Expected: FAIL because the new contracts do not exist.

- [ ] **Step 3: Implement strict final-domain schemas**

Use these stable discriminants and IDs:

```ts
type QuantitySource = 'evidence' | 'user' | 'default'
type QuantityConstraint = 'exact' | 'at_least' | 'plural' | 'unknown'
type RouteSourceKind = 'attachment' | 'catalog' | 'user' | 'illustrative'

type ActorRouteAssignment = {
  actorInstanceRef: string
  formationBundleRef: string
  trajectoryAssetRef: `trajectory:${string}`
  segmentId: string
  resamplePolicy: 'preserve-source-samples'
  timeMapping: { mode: 'fit-window'; startMs: number; durationMs: number }
  spatialPathMode: 'preserve'
  sourceKind: RouteSourceKind
  matchReason: string
  lineage: string[]
}
```

All schemas are `z.strictObject`. `SceneBlueprint` must bind a NarrationPlan fingerprint; `ResolvedScenePlan` must bind Blueprint, catalog and scenario-mapping fingerprints.

- [ ] **Step 4: Add artifact type constants**

```ts
export const NARRATION_PLAN_ARTIFACT = 'ise.narration-plan/v1' as const
export const SCENE_BLUEPRINT_ARTIFACT = 'ise.scene-blueprint/v1' as const
export const RESOLVED_SCENE_PLAN_ARTIFACT = 'ise.resolved-scene-plan/v1' as const
export const CHOREOGRAPHY_PLAN_ARTIFACT = 'ise.choreography-plan/v1' as const
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -w @ise/agent -- scene-generation-contracts.test.ts && npm run typecheck -w @ise/agent`

Expected: PASS.

```powershell
git add agent/src/contracts agent/test/scene-generation-contracts.test.ts
git commit -m "feat: define scene generation artifacts"
```

### Task 3: Build the Scenario Trajectory Catalog and Deterministic Route Assigner

**Files:**
- Create: `agent/src/config/indoPakTrajectoryScenario.ts`
- Create: `agent/src/services/trajectoryCatalog.ts`
- Create: `agent/src/services/formationBundleResolver.ts`
- Create: `agent/src/services/actorRouteAssigner.ts`
- Create: `agent/test/trajectory-catalog.test.ts`

**Interfaces:**
- Consumes: `AssetRegistrySnapshot`, `ActorGroup[]`, scenario mapping `indo-pak/v1`.
- Produces: `buildTrajectoryCatalog(snapshot)`, `resolveFormationBundles(groups, catalog, mapping)` and `assignActorRoutes(instances, bundles)`.

- [ ] **Step 1: Write failing catalog capacity and uniqueness tests**

```ts
const assignments = assignActorRoutes(instances, resolvedBundles)
assert.equal(assignments.length, instances.length)
assert.equal(new Set(assignments.map(item => item.trajectoryAssetRef)).size, assignments.length)
assert.equal(assignments.some(item => item.sourceKind === 'illustrative'), false)
assert.throws(() => assignActorRoutes([...instances, overflow], resolvedBundles),
  /TRAJECTORY_BUNDLE_CAPACITY_EXCEEDED/)
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx tsx --test agent/test/trajectory-catalog.test.ts`

Expected: FAIL because the catalog services do not exist.

- [ ] **Step 3: Define the current scenario bundles**

```ts
export const indoPakTrajectoryScenario = scenarioTrajectoryMappingSchema.parse({
  schemaVersion: 'ise.scenario-trajectory-mapping/v1',
  scenarioId: 'indo-pak/v1',
  bundles: [
    bundle('formation:india-su30-adampur', 'model:su30mki', vampireIds,
      ['苏-30MKI', '苏-30MKI编队'], ['Vampire is a scenario-local callsign']),
    bundle('formation:india-rafale-ambala', 'model:rafale', rafaleIds,
      ['阵风', '阵风战斗机', '阵风编队']),
    bundle('formation:pakistan-jf17-minhas', 'model:jf17', minhasIds,
      ['JF-17', 'JF-17编队'], ['Operator route label is J-10CE']),
    bundle('formation:pakistan-jf17-rafiki', 'model:jf17', rafikiIds,
      ['JF-17', 'JF-17编队'], ['Operator route label is J-10CE']),
    bundle('reserve:india-su30-ambala', 'model:su30mki', ambalaSu30Ids,
      ['苏-30MKI'], ['Reserve capacity; does not create actors']),
    bundle('weapon:indo-pak-missiles', 'model:pl15e', missileIds, ['导弹']),
  ],
})
```

- [ ] **Step 4: Implement deterministic matching and assignment**

Match only normalized exact scenario aliases plus actor location. Sort actor instances by stable ID and route IDs by catalog order. Do not use substring fuzzy matching in this service. Return `TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED` or `TRAJECTORY_BUNDLE_CAPACITY_EXCEEDED`; never fall back to `selectAsset()`.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -w @ise/agent -- trajectory-catalog.test.ts && npm run typecheck -w @ise/agent`

Expected: PASS.

```powershell
git add agent/src/config agent/src/services agent/test/trajectory-catalog.test.ts
git commit -m "feat: assign actors to trajectory bundles"
```

### Task 4: Derive Subtitle-Led Narration and Reviewable Scene Blueprint

**Files:**
- Create: `agent/src/planning/quantityResolver.ts`
- Create: `agent/src/planning/narrationPlanner.ts`
- Create: `agent/src/planning/sceneBlueprintPlanner.ts`
- Create: `agent/src/planning/resolveSceneBlueprint.ts`
- Create: `agent/test/scene-blueprint-planner.test.ts`
- Modify: `agent/src/tools/compilerTools.ts`
- Modify: `agent/src/session/sessionAgentRunner.ts`

**Interfaces:**
- Consumes: accepted EventPlan artifact, NarrativePlan artifact, active EvidenceIR artifact, AssetRegistry artifact.
- Produces: fingerprinted NarrationPlan, SceneBlueprint and ResolvedScenePlan artifacts before runtime compilation.

- [ ] **Step 1: Write failing quantity and subtitle-binding tests**

```ts
assert.deepEqual(resolveQuantity('4架阵风战斗机', '阵风', fighterPolicy), {
  value: 4, constraint: 'exact', source: 'evidence', evidenceRefs: ['ev-1'],
  reason: 'Explicit quantity adjacent to entity',
})
assert.equal(resolveQuantity('苏-30MKI编队率先升空', '苏-30MKI', fighterPolicy).value, 4)
assert.equal(resolveQuantity('苏-30MKI编队率先升空', '苏-30MKI', fighterPolicy).source, 'default')
assert.ok(blueprint.sceneBeats.every(beat => beat.subtitleId))
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @ise/agent -- scene-blueprint-planner.test.ts`

Expected: FAIL because planners do not exist.

- [ ] **Step 3: Implement EvidenceIR quantity resolution**

Support Arabic integers and Chinese `一` through `十` immediately adjacent to `架/枚/个`. Exact evidence beats defaults; user override beats defaults but conflicts with exact evidence. Defaults are:

```ts
export const defaultQuantityPolicies = {
  'fighter-formation/v1': 4,
  'single-node/v1': 1,
  'single-launch/v1': 1,
} as const
```

- [ ] **Step 4: Implement the compatibility-to-final planners**

`buildNarrationPlan()` copies grounded subtitles, adds `beatRole`, `attentionTarget` and duration estimate, then fingerprints the result. `buildSceneBlueprint()` expands semantic groups, splits current JF-17 actors by Minhas/Rafiki location, binds every SceneBeat to one subtitle, and records route-label diagnostics. `resolveSceneBlueprint()` expands stable actor IDs and invokes Task 3 route services.

- [ ] **Step 5: Persist intermediates before compile**

Extend the compile input with the exact active `evidenceArtifactId`. Extend the compiler tool result to return the four intermediate artifacts plus the final compiled artifact. Put `narrationPlanArtifactId`, `sceneBlueprintArtifactId`, `resolvedScenePlanArtifactId`, and `choreographyPlanArtifactId` in compiled metadata. Update `SessionAgentRunner.compileNarrative()` to select the active EvidenceIR for the same document, create all returned artifacts, identify exactly one `COMPILED_RUNTIME_ARTIFACT`, and publish `artifact.created` for each.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -w @ise/agent -- scene-blueprint-planner.test.ts compiler.test.ts session-api.test.ts`

Expected: PASS.

```powershell
git add agent/src/planning agent/src/tools/compilerTools.ts agent/src/session/sessionAgentRunner.ts agent/test
git commit -m "feat: derive subtitle-led scene blueprints"
```

### Task 5: Compile Multi-Actor Choreography With Subtitle Lead

**Files:**
- Create: `agent/src/compiler/actorExpansion.ts`
- Create: `agent/src/compiler/choreographyCompiler.ts`
- Modify: `agent/src/compiler/sceneCompiler.ts`
- Modify: `agent/src/compiler/templates.ts`
- Modify: `agent/src/compiler/scheduler.ts`
- Modify: `agent/src/contracts/runtimePlan.ts`
- Modify: `agent/test/compiler.test.ts`
- Modify: `agent/test/base-runtime-adapter.test.ts`

**Interfaces:**
- Consumes: ResolvedScenePlan plus current EventPlan/NarrationPlan and AssetRegistry.
- Produces: ChoreographyPlan and current CanonicalRuntimePlan v1 with one stable entity and unique follow path per ActorInstance.

- [ ] **Step 1: Replace the old single-entity regression test with multi-actor assertions**

```ts
const plan = compileScene(currentIndoPakInput())
const follows = plan.commands.filter(command => command.type === 'model.follow_path')
const firstRouteByEntity = new Map<string, string>()
for (const command of follows) {
  if (!firstRouteByEntity.has(command.params.entityId)) {
    firstRouteByEntity.set(command.params.entityId, command.params.trajectoryAssetId)
  }
}
assert.ok(plan.entities.length >= 4)
assert.equal(new Set(firstRouteByEntity.values()).size, firstRouteByEntity.size)
assert.equal(plan.diagnostics.some(item => item.code === 'TRAJECTORY_SYNTHESIZED'), false)
for (const subtitle of plan.subtitles) {
  const firstVisual = plan.commands
    .filter(command => command.eventUnitId === subtitle.eventUnitId)
    .sort((left, right) => left.startMs - right.startMs)[0]
  if (firstVisual) assert.ok(firstVisual.startMs >= subtitle.startMs + 800)
}
```

- [ ] **Step 2: Run and confirm the single-entity compiler fails**

Run: `npm test -w @ise/agent -- compiler.test.ts`

Expected: FAIL because `templates.spawnAndFollow()` still accepts one entity and one trajectory.

- [ ] **Step 3: Expand stable actors and lifecycles**

Generate IDs as `actor:<group-slug>:leader` and `actor:<group-slug>:wingman-<n>`. Create one spawn at first appearance, one or more explicit motion segments, state transitions on the same actor, and one hide at lifecycle end. Do not recreate actors per EventUnit.

- [ ] **Step 4: Compile group commands and group camera bounds**

Replace `TemplateContext.entity` with `actors: Array<{ actor: RuntimeEntity; route: ActorRouteAssignment }>` and make `spawnAndFollow()` emit commands for all entries. Compute camera bounds as the union of assigned catalog bounds and keep existing trajectory-aware zoom/pitch profiles.

- [ ] **Step 5: Enforce the subtitle lead in the scheduler**

```ts
export const SUBTITLE_VISUAL_LEAD_MS = 800
const visualStartMs = subtitleStartMs + SUBTITLE_VISUAL_LEAD_MS
```

Schedule commands from `visualStartMs`; retain the current minimum command durations and fail with `NARRATION_VISUAL_DURATION_CONFLICT` when the window cannot fit.

- [ ] **Step 6: Run compiler and adapter tests and commit**

Run: `npm test -w @ise/agent -- compiler.test.ts base-runtime-adapter.test.ts && npm run typecheck -w @ise/agent`

Expected: PASS with multiple entities/model items and unique trajectories.

```powershell
git add agent/src/compiler agent/src/contracts/runtimePlan.ts agent/test
git commit -m "feat: compile multi-actor choreography"
```

### Task 6: Expose Blueprint Review Data and JSON Exports in the Existing UI

**Files:**
- Create: `apps/web/src/pages/newScript/components/SceneBlueprintSummary.tsx`
- Create: `apps/web/src/pages/newScript/components/SceneBlueprintSummary.test.tsx`
- Modify: `apps/web/src/pages/newScript/index.tsx`
- Modify: `apps/web/src/pages/newScript/artifactExports.ts`
- Modify: `apps/web/src/pages/newScript/artifactExports.test.ts`
- Modify: `apps/web/src/pages/newScript/components/ArtifactExportControls.tsx`
- Modify: `apps/web/src/pages/newScript/components/ArtifactExportControls.test.tsx`

**Interfaces:**
- Consumes: hydrated `ise.narration-plan/v1`, `ise.scene-blueprint/v1`, `ise.resolved-scene-plan/v1`, compiled runtime and SceneProject artifacts.
- Produces: compact blueprint summary plus explicit JSON downloads.

- [ ] **Step 1: Write failing artifact selection and summary tests**

```ts
expect(selectArtifactExports(state)).toMatchObject({
  eventPlan: expect.any(Object),
  narrationPlan: expect.any(Object),
  sceneBlueprint: expect.any(Object),
  resolvedScenePlan: expect.any(Object),
  runtimePlan: expect.any(Object),
  sceneProject: expect.any(Object),
})
expect(screen.getByText('苏-30MKI编队')).toBeVisible()
expect(screen.getByText('4 架 · 默认策略')).toBeVisible()
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @ise/web -- artifactExports SceneBlueprintSummary`

Expected: FAIL because the blueprint artifacts are not selected or rendered.

- [ ] **Step 3: Add lineage-safe artifact selection and downloads**

Add downloads named `narration-plan.json`, `scene-blueprint.json`, and `resolved-scene-plan.json`; retain `event-plan.json`, `canonical-runtime-plan.json`, and `scene-project.json`. Select only active artifacts whose source IDs/fingerprints match the completed runtime chain.

- [ ] **Step 4: Add the compact blueprint summary**

Render subtitle text, actor group name, count, quantity source, behavior labels, route bundle and warnings in an unframed table/list inside the existing Narrative panel. Use current typography, borders, colors and Lucide icons; do not add a separate page, nested cards or mobile-specific layout work.

- [ ] **Step 5: Run frontend tests and commit**

Run: `npm test -w @ise/web -- artifactExports ArtifactExportControls SceneBlueprintSummary newScript.integration`

Expected: PASS.

```powershell
git add apps/web/src/pages/newScript
git commit -m "feat: show scene blueprint generation summary"
```

### Task 7: Seed MinIO and Prove the Real DOCX Desktop Playback

**Files:**
- Modify: `.superpowers/sdd/run-real-docx-flow.ps1`
- Modify: `apps/web/e2e/generated-replay.spec.ts`
- Modify: `apps/web/src/runtime/testing/runtimeFixtures.ts`
- Do not commit: `apps/web/test-results/`, raw source assets, local environment files.

**Interfaces:**
- Consumes: running API, Agent, Web and MinIO services; real DOCX; process environment credentials.
- Produces: persisted Scene plus visible JSON exports and desktop Playwright evidence.

- [ ] **Step 1: Extend the real-flow assertions**

```powershell
Assert-True ($sceneBlueprint.actorGroups.Count -gt 1) 'Expected multiple actor groups'
Assert-True (($resolved.actorRouteAssignments.trajectoryAssetRef | Sort-Object -Unique).Count -eq $resolved.actorRouteAssignments.Count) 'Routes must be unique'
Assert-True (($resolved.fallbackTrajectoryRecipes | Measure-Object).Count -eq 0) 'Current scene must not synthesize routes'
Assert-True ($firstVisual.startMs -ge ($subtitle.startMs + 800)) 'Subtitle must lead its scene response'
```

- [ ] **Step 2: Upload the complete validated manifest**

Run with service credentials supplied only in the current process environment:

```powershell
$env:ASSET_MANIFEST_PATH = (Resolve-Path 'provenance/assets.seed.json').Path
$env:ASSET_SOURCE_DIR = (Resolve-Path '.').Path
npm run assets:seed -w @ise/api
```

Expected: all 21 trajectory object uploads succeed and API public catalog reports them available.

- [ ] **Step 3: Run backend verification**

Run: `npm run typecheck && npm test -w @ise/runtime-contracts && npm test -w @ise/agent && npm test -w @ise/api -- --runInBand`

Expected: PASS.

- [ ] **Step 4: Run the real DOCX flow**

Run: `powershell -ExecutionPolicy Bypass -File .\.superpowers\sdd\run-real-docx-flow.ps1`

Expected: `event-plan.json`, `narration-plan.json`, `scene-blueprint.json`, `resolved-scene-plan.json`, `canonical-runtime-plan.json`, and `scene-project.json` are exported; the Scene is persisted.

- [ ] **Step 5: Run desktop-only Playwright acceptance**

Run: `npm run test:e2e -w @ise/web -- e2e/generated-replay.spec.ts --project=desktop-chromium`

Expected: visible subtitles lead scene actions; multiple aircraft GLBs move on unique paths with heading/pitch follow; camera changes; image and video tracks appear; pause, seek and replay work.

- [ ] **Step 6: Final commit and push**

```powershell
git add .superpowers/sdd/run-real-docx-flow.ps1 apps/web/e2e/generated-replay.spec.ts apps/web/src/runtime/testing/runtimeFixtures.ts
git commit -m "test: prove real multi-actor docx replay"
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
```
