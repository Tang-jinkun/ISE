# Task 5 Report

Status: DONE

Commit message: `feat: compile multi-actor choreography`

## Implemented

- Added `expandActorGroups(groups): ActorInstance[]` and made scene resolution use it as the single actor-expansion implementation.
- Added deterministic `compileChoreography(input): ChoreographyPlan` with exact resolved actors, beat-bounded lifecycles, catalog-route motion, same-group formation segments, narration-bound shots, 800 ms subtitle lead constraints, lineage, and explicit rejection of unbound or synthesized actors/routes.
- Split the prior compiler into an explicitly named `compileLegacyScene` for isolated template tests and a strict final-domain `compileScene` requiring NarrationPlan, SceneBlueprint, ResolvedScenePlan, and ChoreographyPlan.
- Compiled one runtime entity, spawn, catalog-route follow, and hide per ActorInstance. Exact scenario model bundles determine model assets and aircraft/missile kinds.
- Framed each shot with the union of all subject route bounds, including center and zoom.
- Preserved deterministic image, video, geojson, marker, information-card, camera, and subtitle behavior without changing CanonicalRuntimePlan v1 or SceneProjectConfig v1.
- Scheduled final NarrationPlan subtitles without rewriting or shortening them. Visual commands begin at least 800 ms after their EventUnit subtitle; impossible schedules fail with `NARRATION_VISUAL_DURATION_CONFLICT`.
- Added the typed ChoreographyPlan artifact between ResolvedScenePlan and compiled runtime. Compiler metadata and runtime lineage carry all final-domain artifact IDs.
- Made session compilation validate exactly one each of the five ordered artifacts before one atomic `createMany`, then publish five ordered `artifact.created` events.
- Updated only directly impacted compiler/session/service-flow fixtures to provide grounded actors, complete registered route bundles, exact models, and route bounds.

## TDD Evidence

### Choreography RED/GREEN

- RED command: `..\node_modules\.bin\tsx.cmd --test test\scene-blueprint-planner.test.ts`
- RED result: exit 1, `ERR_MODULE_NOT_FOUND` for `src/compiler/choreographyCompiler.ts`.
- GREEN result: 24/24 passed after adding actor expansion and choreography compilation.
- Later RED/GREEN: `TRAJECTORY_SYNTHESIZED` was accepted by the first implementation; the added regression failed with `Missing expected exception`, then passed after fail-fast rejection.

### Runtime Compiler RED/GREEN

- RED command: `..\node_modules\.bin\tsx.cmd --test --test-name-pattern="final Indo-Pak compiler" test\compiler.test.ts`
- RED result: exit 1. The legacy compiler returned three semantic entities (`entity:pl-15e-missile`, `entity:rafale`, `entity:su-30mki`) instead of the 15 authoritative ActorInstance IDs.
- GREEN result: the focused Indo-Pak regression passed with 15 actors, exact unique routes, one spawn/hide per actor, union camera framing, final subtitles, image/video commands, no synthesis, and full lineage.

### Scheduler RED/GREEN

- RED 1: named export `SUBTITLE_VISUAL_LEAD_MS` was missing.
- RED 2: after exporting the constant alone, command start was `0` instead of `800`, and the required duration conflict was not thrown.
- GREEN: both lead and conflict tests passed.
- Self-review RED/GREEN: a 30.5 second medium final subtitle was shortened to 29.5 seconds to fit a 30 second target. The regression failed with `Missing expected exception`, then passed after restricting the shortening retry to the legacy NarrativePlan path.

### Tool/Session RED/GREEN

- Compiler-tool RED: final-domain inputs were undefined at the strict compiler boundary because the real tool had not created/passed ChoreographyPlan.
- Session RED: zero final artifacts were persisted because compilation failed before the expected atomic batch.
- GREEN: compiler tool returned exactly five artifacts in dependency order with `choreographyPlanArtifactId`; session persisted one five-artifact batch and published five ordered creation events.

## Verification

- Focused choreography/compiler/adapter/session gate:
  - Command: `..\node_modules\.bin\tsx.cmd --test test\scene-blueprint-planner.test.ts test\compiler.test.ts test\base-runtime-adapter.test.ts test\session-api.test.ts`
  - Result: 79 tests, 79 passed, 0 failed, 0 skipped.
- End-to-end service-flow gate:
  - Command: `..\node_modules\.bin\tsx.cmd --test test\agent-service-flow.test.ts`
  - Result: 4 tests, 4 passed, 0 failed.
- Full Agent suite:
  - Command: `npm test`
  - Result: 190 tests, 189 passed, 0 failed, 1 skipped.
- Agent typecheck:
  - Command: `npm run typecheck`
  - Result: exit 0.
- Whitespace validation:
  - Command: `git diff --check`
  - Result: exit 0; Git emitted line-ending conversion notices only.

## Self-Review

- Actor count comes only from Task 4B resolved actors; unused route capacity creates no entities.
- Every actor is bound exactly once to lifecycle/entity/route assignment and receives a first follow command on its exact catalog route.
- Missing beat bindings, missing exact assets/bounds, route duplication/capacity failure, illustrative routes, and synthesis diagnostics fail explicitly.
- Weapon actors remain visible and routed without inventing launcher, target, or outcome facts; weapon engagements stay empty when ungrounded.
- Real compilerTools/session execution calls only strict final-domain `compileScene`; `compileLegacyScene` is imported only by isolated compatibility template tests.
- Existing SceneProjectConfig v1 and runtime player contracts were not changed.
- No Web/UI, runtime-player internals, raw assets, credentials, or `apps/web/test-results/` files were modified or staged.

## Concerns

- One pre-existing symbolic-link test remains skipped because Windows did not grant symbolic-link creation permission. This is unrelated to Task 5.
- The real compiler is intentionally bound to `indoPakTrajectoryScenario` for this scenario slice; broader scenario selection remains outside Task 5.
