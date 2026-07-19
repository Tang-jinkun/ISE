# Start/End Trajectory Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate playable GLB aircraft, AWACS, missile, and supported destruction scenes from a DOCX that supplies grounded start/end positions without requiring pre-authored trajectory JSON.

**Architecture:** Extend EvidenceIR with a structured document route expression. Resolve exact model/catalog assets first, then synthesize deterministic trajectory assets from grounded endpoints. Carry generated trajectory geometry through resolved plans and canonical runtime plans into SceneProjectConfig, where the browser resolves embedded routes before the remote asset catalog.

**Tech Stack:** TypeScript, Zod, Node test runner, React runtime, `python-docx`, Mammoth DOCX parsing, existing asset registry and compiler contracts.

## Global Constraints

- Keep the DOCX -> EvidenceIR -> EventPlan -> review -> runtime compiler flow.
- Prefer an exact catalog route when one exists.
- Generate a route only from grounded document evidence; never infer a route from a subtitle alone.
- Keep explicit quantities authoritative. Pack or global defaults apply only when the document has no reliable quantity.
- Generated routes must be auditable with source evidence references and a generation method.
- Only an interaction supported by time-and-space geometry may become `hit`, `collision`, or `destroyed`. Unsupported interactions remain `unresolved`.
- Runtime consumes canonical plans and does not know whether a route came from a catalog or the generator.
- Desktop Chromium is the only acceptance surface for this change.
- Do not put credentials, signed URLs, or API keys into manifests, DOCX files, generated JSON, or commits.

---

### Task 1: Parse Grounded Start/End Evidence

**Files:**
- Modify: `agent/src/contracts/evidence.ts`
- Modify: `agent/src/services/documentParser.ts`
- Modify: `agent/src/contracts/sceneBlueprint.ts`
- Modify: `agent/src/planning/sceneBlueprintPlanner.ts`
- Test: `agent/test/document-parser.test.ts`
- Test: `agent/test/scene-blueprint-planner.test.ts`

**Interfaces:**
- Add `routeExpressionSchema` with `start` and `end` coordinate tuples and optional `pathStyle`.
- Add optional `routeExpression` to `EvidenceRecord`.
- Preserve `ActorGroup.evidenceRefs` in the serialized blueprint so the resolver can bind routes to evidence without re-reading raw prose.

- [ ] **Step 1: Add failing parser and blueprint assertions.**

  Use a paragraph containing `from coordinates:75.100,30.100 to coordinates:76.200,31.200` and assert that the evidence record has exact start/end tuples. Build a blueprint and assert the matching actor group retains that evidence reference.

- [ ] **Step 2: Run the focused parser tests and confirm failure.**

  Run:

  ```powershell
  npx tsx --test test/document-parser.test.ts test/scene-blueprint-planner.test.ts
  ```

  Expected failure: `routeExpression` is absent and actor groups do not expose evidence references.

- [ ] **Step 3: Implement route extraction and propagation.**

  Parse one start/end pair per factual paragraph, normalize longitude/latitude ordering, set `pathStyle: 'intercept'` only when the claim contains a launch/intercept phrase, and otherwise use `great_circle`. Copy group evidence references into the blueprint without changing existing quantity precedence.

- [ ] **Step 4: Re-run focused tests and commit.**

  Run the command from Step 2 and require all existing plus new assertions to pass. Commit:

  ```powershell
  git add agent/src/contracts/evidence.ts agent/src/services/documentParser.ts agent/src/contracts/sceneBlueprint.ts agent/src/planning/sceneBlueprintPlanner.ts agent/test/document-parser.test.ts agent/test/scene-blueprint-planner.test.ts
  git commit -m "feat: preserve grounded route evidence"
  ```

### Task 2: Deterministic Trajectory Synthesis

**Files:**
- Create: `agent/src/services/startEndTrajectorySynthesizer.ts`
- Modify: `agent/src/contracts/trajectoryCatalog.ts`
- Modify: `agent/src/contracts/resolvedScenePlan.ts`
- Modify: `agent/src/services/actorAssetResolver.ts`
- Modify: `agent/src/planning/resolveSceneBlueprint.ts`
- Test: `agent/test/start-end-trajectory-synthesizer.test.ts`
- Test: `agent/test/actor-asset-resolver.test.ts`

**Interfaces:**
- Export `synthesizeStartEndTrajectory(request: TrajectoryRequest): GeneratedTrajectory`.
- Add `sourceKind: 'generated'` to route assignments.
- Add `generatedTrajectoryAssets` to `ResolvedScenePlan`, each with an asset ID, standard trajectory metadata, points, generation method, and source references.

- [ ] **Step 1: Add failing synthesizer tests.**

  Assert deterministic byte-identical output for repeated input, exact first/last coordinates, strictly increasing times, 16-32 points, and a rejected request when an endpoint or duration is missing. Add an intercept case where the terminal point equals the target anchor.

- [ ] **Step 2: Run the synthesizer test and confirm failure.**

  Run `npx tsx --test test/start-end-trajectory-synthesizer.test.ts`; expected failure is the missing synthesizer module.

- [ ] **Step 3: Implement spherical interpolation and provenance.**

  Use normalized longitude deltas, linear time interpolation, altitude interpolation when both endpoints provide altitude, and a stable point-count clamp. Derive a content-addressed `trajectory:generated-<digest>` ID and return `sourceKind: 'generated'` with `generationMethod: 'document-endpoints-v1'`.

- [ ] **Step 4: Integrate route resolution after exact catalog lookup.**

  Resolve exact model aliases from the asset registry before generic compatibility matching. For each active actor group with a grounded route expression, synthesize one route per actor instance, create a generated formation bundle, and add generated assignments. Keep static fallback when no route expression exists and unresolved when neither model nor grounded location is available.

- [ ] **Step 5: Run focused Agent tests and commit.**

  Run:

  ```powershell
  npx tsx --test test/start-end-trajectory-synthesizer.test.ts test/actor-asset-resolver.test.ts test/scene-blueprint-planner.test.ts test/interaction-solver.test.ts
  ```

  Commit:

  ```powershell
  git add agent/src/services/startEndTrajectorySynthesizer.ts agent/src/contracts/trajectoryCatalog.ts agent/src/contracts/resolvedScenePlan.ts agent/src/services/actorAssetResolver.ts agent/src/planning/resolveSceneBlueprint.ts agent/test/start-end-trajectory-synthesizer.test.ts agent/test/actor-asset-resolver.test.ts
  git commit -m "feat: synthesize routes from grounded endpoints"
  ```

### Task 3: Carry Generated Geometry Into Runtime

**Files:**
- Modify: `agent/src/contracts/runtimePlan.ts`
- Modify: `agent/src/compiler/choreographyCompiler.ts`
- Modify: `agent/src/compiler/sceneCompiler.ts`
- Modify: `agent/src/tools/compilerTools.ts`
- Modify: `agent/src/adapters/baseRuntimeAdapter.ts`
- Modify: `packages/runtime-contracts/src/scene.ts`
- Modify: `apps/web/src/hooks/useSceneRuntime.ts`
- Test: `agent/test/compiler.test.ts`
- Test: `agent/test/contracts.test.ts`
- Test: `apps/web/src/runtime/__tests__/trajectory.test.ts`

**Interfaces:**
- Add `generatedTrajectories` to canonical runtime plans and scene configs. Each item contains `assetId`, standard trajectory metadata, points, `generationMethod`, and `sourceRefs`.
- `useSceneRuntime` builds an in-memory `blob:` access record for embedded trajectories before calling `/asset-catalog/:id/access`.

- [ ] **Step 1: Add failing compiler/runtime assertions.**

  Compile a generated route and assert the canonical plan and adapted scene config contain its points. Assert that the Web runtime resolver returns embedded trajectory metadata without making a catalog request.

- [ ] **Step 2: Implement effective registry and embedded access.**

  Let choreography and scene compilation read generated routes through an in-memory effective registry, while preserving the source registry fingerprint in lineage. The runtime adapter copies generated geometry into the scene config. The Web hook creates/revokes blob URLs with `application/vnd.ise.trajectory+json` metadata and leaves catalog assets unchanged.

- [ ] **Step 3: Run focused compiler and Web runtime tests.**

  Run:

  ```powershell
  npx tsx --test test/compiler.test.ts test/contracts.test.ts
  npx vitest run src/runtime/__tests__/trajectory.test.ts
  ```

- [ ] **Step 4: Commit the runtime handoff.**

  ```powershell
  git add agent/src/contracts/runtimePlan.ts agent/src/compiler/choreographyCompiler.ts agent/src/compiler/sceneCompiler.ts agent/src/tools/compilerTools.ts agent/src/adapters/baseRuntimeAdapter.ts packages/runtime-contracts/src/scene.ts apps/web/src/hooks/useSceneRuntime.ts agent/test/compiler.test.ts agent/test/contracts.test.ts apps/web/src/runtime/__tests__/trajectory.test.ts
  git commit -m "feat: carry generated trajectories into runtime"
  ```

### Task 4: New Indo-Pak DOCX and GLB Manifest Coverage

**Files:**
- Create: `agent/test/fixtures/start-end-indo-pak-interception.docx`
- Modify: `provenance/asset-source-map.json`
- Modify: `provenance/asset-model-calibration.json`
- Modify: `provenance/assets.seed.json`
- Modify: `agent/test/fixtures/public-asset-catalog.json`
- Create: `agent/test/start-end-docx-flow.test.ts`

**Interfaces:**
- Use semantic IDs `model:netra-awacs`, `model:awacs-generic-e3a`, `model:su30mki`, `model:rafale`, `model:jf17`.
- The DOCX contains four timed sections and no attached route JSON.

- [ ] **Step 1: Create the fixture with `python-docx`.**

  Use the `standard_business_brief` preset: Calibri 11pt, 1 inch margins, 6pt body spacing, explicit Heading 1/2 spacing, and a compact facts table. Include explicit quantities, endpoints, data links, one confirmed missile impact, and one unresolved approach.

- [ ] **Step 2: Render and inspect the DOCX.**

  Run the workspace document dependency loader, then:

  ```powershell
  python C:\Users\t\.codex\plugins\cache\openai-primary-runtime\documents\26.715.12143\skills\documents\render_docx.py agent\test\fixtures\start-end-indo-pak-interception.docx --output_dir .superpowers\sdd\start-end-docx-render
  ```

  Inspect every generated page PNG. If LibreOffice is unavailable, structurally parse the OOXML and record the render limitation.

- [ ] **Step 3: Register the downloaded GLBs and calibrations.**

  Copy only the five named GLBs from `E:\Github\ISE\newGLB` into the asset source root used by the manifest, add stable source-map entries and calibrations, rebuild `provenance/assets.seed.json`, and assert that no manifest entry contains a URL or secret.

- [ ] **Step 4: Add DOCX flow assertions.**

  Parse the fixture and assert AWACS/model IDs, explicit formation quantities, route expressions, one generated missile route, one `destroyed` interaction, one `unresolved` interaction, and no static-only fallback for the named aircraft.

- [ ] **Step 5: Run focused fixture tests and commit.**

  Run `npx tsx --test test/start-end-docx-flow.test.ts test/document-parser.test.ts test/asset-registry.test.ts`, then commit the fixture and manifest changes.

### Task 5: Real Export and Desktop Handoff

**Files:**
- Modify: `.superpowers/sdd/run-real-docx-flow.ps1`
- Create: `.superpowers/sdd/start-end-interception-demo/README.md`

- [ ] **Step 1: Extend real-flow invariants.**

  Accept both catalog and generated route assignments, require at least one AWACS model, at least one missile model, one generated route, one supported destroyed interaction, and one unresolved interaction. Do not weaken the existing Indo-Pak fixture invariants.

- [ ] **Step 2: Run one real DOCX export.**

  Use the existing process-environment model configuration and export only under `.superpowers/sdd/start-end-interception-demo/`. Validate `event-plan.json`, `canonical-runtime-plan.json`, and `scene-project.json` against schemas and scan output for secrets.

- [ ] **Step 3: Persist a user-visible scene and hand off preview.**

  Persist the exact `scene-project.json` under the main local account, then provide `/preview?projectId=<id>` and `/scene?projectId=<id>`. Do not run mobile acceptance or broad E2E; the user performs the desktop visual check.

- [ ] **Step 4: Record focused verification and commit.**

  Run the synthesizer, compiler, flow, and one desktop route-entry check. Record known historical failures separately in `.superpowers/sdd/progress.md`, update the implementation plan, and commit.
