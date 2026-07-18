# Cross-Document Scene Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the DOCX-to-scene Agent work on a second, different document without compiler code changes, while exposing the complete public generation timeline in the new-script UI.

**Architecture:** Add a shared public activity projection for model, tool, compile, artifact, review, and diagnostic events. Select a data-only `ScenarioPack` from EvidenceIR, feed it into a scenario-independent `SemanticActorPlanner`, and resolve models/trajectories through the asset registry with explicit static fallbacks. Keep `InteractionSolver` and runtime contracts scenario-neutral.

**Tech Stack:** TypeScript, Fastify, sql.js persistence, React 19, Zustand, Vitest, Node test runner, Mammoth DOCX parsing, existing asset and trajectory registries.

## Global Constraints

- Preserve the existing DOCX/text -> EventPlan -> review -> runtime compiler pipeline.
- Never expose prompts, tool input, model identifiers, hidden reasoning, private chain-of-thought, or API keys.
- Keep explicit quantities authoritative; use auditable defaults only when the document has no reliable quantity.
- Unresolved or geometrically unsupported interactions must never become hit, collision, or destruction effects.
- Runtime consumes only canonical plans; it must not know about ScenarioPack selection.
- Desktop Chromium is the only acceptance surface; retain responsive code without new mobile work.
- During feature work run only focused tests, one real export per milestone, and one desktop preview; defer full regression and final Docker rebuild to the end.
- Preserve existing untracked user files in the root checkout and do not copy them into the feature worktree.

---

### Task 1: Public Generation Timeline

**Files:**
- Modify: `agent/src/api/contracts.ts`
- Modify: `agent/src/session/turnActivities.ts`
- Modify: `apps/web/src/api/agent.ts`
- Modify: `apps/web/src/pages/newScript/agentTurns.ts`
- Modify: `apps/web/src/pages/newScript/components/AgentTurn.tsx`
- Test: `agent/test/session-api.test.ts`
- Test: `apps/web/src/stores/agentSessionStore.test.ts`
- Test: `apps/web/src/pages/newScript/components/AgentTurn.test.tsx`

**Interfaces:**
- `AgentTurnActivity.type` becomes `thinking | tool | stage | artifact | review | diagnostic`.
- Stage activity: `{ id, type: 'stage', status, stage, summary, percentage? }`.
- Artifact activity: `{ id, type: 'artifact', status: 'completed', artifactType, artifactId, summary }`.
- Review activity: `{ id, type: 'review', status, summary }`.
- `projectTurnActivities(events, runStatus)` and `applyActivity(activities, event)` must produce equivalent arrays for the same public events.

- [ ] **Step 1: Add failing backend projection tests.**

  Add an event sequence containing `compile.progress`, `artifact.created`, `review.requested`, `review.resolved`, and existing tool events. Assert that the projected activity order is stage, artifact, review, and that private fields such as `data`, `prompt`, `model`, and `hiddenReasoning` do not appear.

- [ ] **Step 2: Run the focused backend test.**

  Run:

  ```powershell
  npx tsx --test test/session-api.test.ts
  ```

  Expected: the new projection assertion fails because compile, artifact, and review events are currently omitted.

- [ ] **Step 3: Implement the shared public activity variants.**

  Extend the public contracts and both projection paths. Map stage names `narrative`, `assets`, `schedule`, `validate`, and `adapt` to concise Chinese labels. Preserve the last tool activity as the mutable progress target and append immutable stage/artifact/review entries in event order.

- [ ] **Step 4: Add frontend rendering tests.**

  Render a completed turn containing stage, artifact, and review activities. Assert that the stage percentage, artifact display name, and review state are visible. Render a running turn and assert that it remains expanded. Render a completed latest turn and assert that it remains expanded until the user clicks the collapse button.

- [ ] **Step 5: Implement the timeline UI.**

  Keep the existing neutral/cyan styling and icons. Add a progress bar for `stage.percentage`, artifact labels derived from the allowlisted artifact type, and review states. Keep historical non-latest turns collapsible. Do not render raw event data or hidden model text.

- [ ] **Step 6: Run focused Web tests and commit.**

  Run:

  ```powershell
  npx vitest run src/pages/newScript/components/AgentTurn.test.tsx src/stores/agentSessionStore.test.ts
  ```

  Expected: the new timeline tests pass; pre-existing schema expectation failures are recorded separately if they remain. Commit:

  ```powershell
  git add agent/src/api/contracts.ts agent/src/session/turnActivities.ts apps/web/src/api/agent.ts apps/web/src/pages/newScript/agentTurns.ts apps/web/src/pages/newScript/components/AgentTurn.tsx agent/test/session-api.test.ts apps/web/src/stores/agentSessionStore.test.ts apps/web/src/pages/newScript/components/AgentTurn.test.tsx
  git commit -m "feat: expose agent generation timeline"
  ```

### Task 2: ScenarioPack Contracts and Registry

**Files:**
- Create: `agent/src/contracts/scenarioPack.ts`
- Create: `agent/src/services/scenarioPackRegistry.ts`
- Create: `agent/src/config/indoPakScenarioPack.ts`
- Modify: `agent/src/config/indoPakTrajectoryScenario.ts`
- Modify: `agent/src/contracts/sceneBlueprint.ts`
- Test: `agent/test/scenario-pack.test.ts`

**Interfaces:**
- `ScenarioPack` contains `schemaVersion`, `packId`, `displayName`, `matchRules`, `factions`, `entityProfiles`, `locationProfiles`, `routeBundles`, and `mediaProfiles`.
- `selectScenarioPack(eventPlan, evidence): { pack: ScenarioPack; diagnostics: Diagnostic[] }` selects one pack, returns `generic/v1` on no match, and returns `SCENARIO_PACK_AMBIGUOUS` on a score tie.
- `SceneBlueprint` gains an optional strict `scenarioPack: { packId: string; version: string }` field; it does not alter runtime command schemas.

- [ ] **Step 1: Add failing registry tests.**

  Cover exact Indo-Pak match, no-match generic fallback, tied match ambiguity, and deterministic selection for repeated identical EvidenceIR. Assert that the generic pack contains no country- or platform-specific entries.

- [ ] **Step 2: Run the focused registry test.**

  Run `npx tsx --test test/scenario-pack.test.ts`; expected failure is the missing contract and registry.

- [ ] **Step 3: Move current Indo-Pak aliases and route metadata into the data pack.**

  Preserve existing asset IDs, route bundle IDs, behavior profiles, and media aliases. Keep the source configuration as a data-only export; remove planner ownership of those tables.

- [ ] **Step 4: Implement deterministic pack scoring.**

  Score only normalized explicit entity and location evidence. Require one strict winner; emit `SCENARIO_PACK_NOT_MATCHED` for generic fallback and `SCENARIO_PACK_AMBIGUOUS` for ties. Never choose a pack from subtitle wording alone.

- [ ] **Step 5: Attach pack lineage and run tests.**

  Add the selected `packId` and version to the SceneBlueprint `scenarioPack` field and propagate it into resolved-plan lineage. Run the focused registry and existing scene blueprint tests. Commit:

  ```powershell
  git add agent/src/contracts/scenarioPack.ts agent/src/services/scenarioPackRegistry.ts agent/src/config/indoPakScenarioPack.ts agent/src/config/indoPakTrajectoryScenario.ts agent/src/contracts/sceneBlueprint.ts agent/test/scenario-pack.test.ts
  git commit -m "feat: add data-only scenario pack registry"
  ```

### Task 3: Scenario-Independent Semantic Actor Planner

**Files:**
- Create: `agent/src/planning/semanticActorPlanner.ts`
- Modify: `agent/src/planning/sceneBlueprintPlanner.ts`
- Modify: `agent/src/planning/quantityResolver.ts`
- Modify: `agent/src/contracts/sceneBlueprint.ts`
- Test: `agent/test/semantic-actor-planner.test.ts`
- Update: `agent/test/scene-blueprint-planner.test.ts`

**Interfaces:**
- `planActorGroups(input: { eventPlan: EventPlan; evidence: EvidenceIR; pack: ScenarioPack }): ActorGroupIntent[]` creates actors from structured participants, action subjects, evidence entities, roles, and locations.
- `resolveQuantity` remains the authority for explicit evidence > user value > pack role default > global default.
- `buildSceneBlueprint` becomes an orchestration function and contains no literal Indo-Pak entity, location, or platform alias.

- [ ] **Step 1: Add failing generic planner tests.**

  Use a fixture with two invented factions, an aircraft formation, a sensor aircraft, a rescue vehicle, and an event-scoped weapon. Assert stable group IDs, faction assignment, exact explicit quantity, default formation quantity, and no actor creation for an ungrounded participant.

- [ ] **Step 2: Run generic planner tests and confirm the current hard-coded planner fails.**

  Run `npx tsx --test test/semantic-actor-planner.test.ts test/scene-blueprint-planner.test.ts`; expected failure is that invented entities produce no groups.

- [ ] **Step 3: Implement semantic actor extraction.**

  Normalize aliases, collect factual records by evidence reference, infer platform kind and role from action vocabulary, derive faction from explicit actor/participant context, and preserve `faction:unknown` when ownership is ambiguous. Keep weapon actor creation event-scoped and delegate launcher/target/outcome to engagement normalization.

- [ ] **Step 4: Make quantity defaults pack-aware without changing precedence.**

  Read role defaults from the selected pack first, then use the existing global defaults. Keep the protections that prevent a single destroyed or emergency-landing aircraft from reducing a formation to one.

- [ ] **Step 5: Replace planner-owned Indo-Pak branches and run focused tests.**

  Route the existing Indo-Pak fixture through the pack plus generic planner and assert byte-stable SceneBlueprint output for frozen inputs. Commit:

  ```powershell
  git add agent/src/planning/semanticActorPlanner.ts agent/src/planning/sceneBlueprintPlanner.ts agent/src/planning/quantityResolver.ts agent/src/contracts/sceneBlueprint.ts agent/test/semantic-actor-planner.test.ts agent/test/scene-blueprint-planner.test.ts
  git commit -m "refactor: make actor planning scenario independent"
  ```

### Task 4: Generic Asset and Trajectory Resolution

**Files:**
- Create: `agent/src/services/actorAssetResolver.ts`
- Modify: `agent/src/services/trajectoryCatalog.ts`
- Modify: `agent/src/services/actorRouteAssigner.ts`
- Modify: `agent/src/planning/resolveSceneBlueprint.ts`
- Modify: `agent/src/compiler/sceneCompiler.ts`
- Test: `agent/test/actor-asset-resolver.test.ts`
- Update: `agent/test/trajectory-catalog.test.ts`

**Interfaces:**
- `resolveActorAssets(intent, pack, registry): ActorAssetResolution` returns `exact`, `compatible`, `static-fallback`, or `unresolved` with scoped diagnostics.
- Static fallback provides a model/marker at a grounded location but no fabricated trajectory.
- Route exhaustion remains a diagnostic; the resolver never duplicates one source route across two actors unless the catalog explicitly marks it reusable.

- [ ] **Step 1: Add failing resolution tests.**

  Cover exact pack match, unique compatible catalog match, ambiguous match, missing trajectory with grounded location, and missing model plus missing location. Assert the status and diagnostic code for each case.

- [ ] **Step 2: Implement resolver and catalog metadata.**

  Move side and semantic matching metadata out of filename prefixes and into catalog entries where available. Rank exact aliases before platform/role compatibility. Return static fallback for grounded positions and `unresolved` otherwise.

- [ ] **Step 3: Integrate resolver into blueprint resolution and compiler input.**

  Keep the existing command schema. Only emit movement commands for resolved trajectories; emit static spawn/marker commands for static fallback. Feed only grounded moving participants into InteractionSolver.

- [ ] **Step 4: Run focused resolver/compiler tests and commit.**

  Run:

  ```powershell
  npx tsx --test test/actor-asset-resolver.test.ts test/trajectory-catalog.test.ts test/compiler.test.ts
  ```

  Commit:

  ```powershell
  git add agent/src/services/actorAssetResolver.ts agent/src/services/trajectoryCatalog.ts agent/src/services/actorRouteAssigner.ts agent/src/planning/resolveSceneBlueprint.ts agent/src/compiler/sceneCompiler.ts agent/test/actor-asset-resolver.test.ts agent/test/trajectory-catalog.test.ts
  git commit -m "feat: resolve generic actors with explicit asset fallbacks"
  ```

### Task 5: Second DOCX Challenge and Real Export

**Files:**
- Create: `agent/test/fixtures/cross-document-air-rescue-report.docx`
- Create: `agent/test/cross-document-flow.test.ts`
- Modify: `.superpowers/sdd/run-real-docx-flow.ps1`
- Create: `.superpowers/sdd/cross-document-demo/README.md`

**Interfaces:**
- The fixture must use different factions, entities, locations, and event IDs from the Indo-Pak report, include an explicit formation quantity, a non-missile rescue/escort action, and one ordered interaction without an asserted hit.
- The flow test invokes the real parser and agent compiler, then validates `event-plan.json`, `canonical-runtime-plan.json`, and `scene-project.json` against their schemas.
- The script writes artifacts only under `.superpowers/sdd/cross-document-demo/` and never writes credentials to disk.

- [ ] **Step 1: Create the DOCX fixture with plain factual prose.**

  Use the workspace document tooling to create a small report titled “Coastal Air Rescue Exercise Review” with this exact body:

  ```text
  Coastal Air Rescue Exercise Review

  08:10 — Blue Coast Guard dispatched a four-aircraft Falcon formation from North Bay to escort a civilian rescue convoy toward the storm area. The formation leader remained the navigation anchor for the group.

  08:24 — Red Ridge surveillance aircraft detected the convoy and transmitted its position to the Red Ridge command post. No weapon launch was reported in this phase.

  08:37 — The Blue sensor aircraft relayed updated weather and position data to the Falcon formation while the rescue convoy changed course east. The two formations remained separated and visible on the same operational map.

  08:52 — A Red Ridge interceptor approached the convoy route, but the report does not establish a confirmed target lock, weapon launch, interception, or damage. This interaction is unresolved and must not be rendered as a hit.
  ```

  The fixture must be a real `.docx` file, not a renamed text file, and its package metadata must retain the title and four section headings.

- [ ] **Step 2: Add failing flow assertions.**

  Assert that the fixture produces at least one event unit, one subtitle, one actor or marker, a non-zero total duration, and an `unresolved` diagnostic for the unsupported interaction. Assert that no output contains the old Indo-Pak event IDs.

- [ ] **Step 3: Wire the real export script.**

  Reuse existing environment-injected model configuration and artifact export helpers. Persist only the three JSON artifacts and a run summary containing IDs, statuses, and diagnostic codes.

- [ ] **Step 4: Run one real export and one desktop preview.**

  Run the script from the feature worktree, inspect the three exported files, and open the generated scene through the existing desktop runtime harness. Confirm subtitles, at least one actor/marker, a non-empty timeline, and the public generation timeline.

- [ ] **Step 5: Commit the challenge fixture and flow harness.**

  ```powershell
  git add agent/test/fixtures/cross-document-air-rescue-report.docx agent/test/cross-document-flow.test.ts .superpowers/sdd/run-real-docx-flow.ps1 .superpowers/sdd/cross-document-demo/README.md
  git commit -m "test: prove cross-document docx scene generation"
  ```

### Task 6: Focused Verification and Handoff

**Files:**
- Verify: all files changed by Tasks 1-5
- Update: `docs/superpowers/plans/2026-07-18-cross-document-scenario-pack.md`

- [ ] **Step 1: Run the focused Agent verification.**

  Run `npx tsx --test test/scenario-pack.test.ts test/semantic-actor-planner.test.ts test/actor-asset-resolver.test.ts test/interaction-solver.test.ts test/cross-document-flow.test.ts` from `agent/`.

- [ ] **Step 2: Run the focused Web verification and typechecks.**

  Run `npx vitest run src/pages/newScript/components/AgentTurn.test.tsx src/stores/agentSessionStore.test.ts` from `apps/web/`, then run `npm run typecheck -w @ise/agent` and `npm run typecheck -w @ise/web`.

- [ ] **Step 3: Inspect generated artifacts and diagnostics.**

  Confirm the two documents have distinct source IDs, the second export has no fabricated hit/collision, and every `unresolved` diagnostic includes its actor, event unit, interaction, or stage scope.

- [ ] **Step 4: Record known baseline failures without masking them.**

  Keep the existing three compiler timing/camera assertion failures and four Web schema expectation failures separate unless a new change makes them blocking. Do not broaden the test run during this phase.

- [ ] **Step 5: Update this plan and commit the handoff.**

  Mark completed steps, record exact focused test counts and the generated scene URL, then commit:

  ```powershell
  git add docs/superpowers/plans/2026-07-18-cross-document-scenario-pack.md
  git commit -m "docs: record cross-document verification"
  ```
