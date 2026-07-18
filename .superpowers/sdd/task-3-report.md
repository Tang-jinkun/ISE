# Task 3 Report: Scenario-Independent Semantic Actor Planner

## Scope

- Added `agent/src/planning/semanticActorPlanner.ts`.
- Reduced `sceneBlueprintPlanner.ts` to pack selection, semantic-plan orchestration, runtime projection, and beat assembly.
- Added pack-aware quantity defaults while retaining explicit evidence, then user value, then pack role default, then global default precedence.
- Added `ActorGroupIntent` planning metadata which is intentionally not serialized into `SceneBlueprint`.

## TDD Evidence

### RED

Command:

```powershell
npx tsx --test test/semantic-actor-planner.test.ts test/scene-blueprint-planner.test.ts
```

Before implementation this failed with `ERR_MODULE_NOT_FOUND` for `src/planning/semanticActorPlanner.ts`. The existing planner tests passed; the new generic actor-planning test could not load the missing planned API.

### GREEN

The same focused command passed after implementation:

```text
tests 52
pass 52
fail 0
```

This includes the frozen Indo-Pak planner suite and two invented-faction semantic-planner tests. The generic fixture verifies stable group IDs, faction assignment, exact explicit quantity, pack formation default, aircraft/sensor/vehicle roles, event-scoped weapons, and that an ungrounded participant produces no actor.

## Review Notes

- `sceneBlueprintPlanner.ts` now contains no Indo-Pak entity, faction, location, or platform literal branches.
- Legacy pack `actorProfiles` preserve current Indo-Pak actor IDs and output; general entity profiles supply the cross-scenario actor path.
- Weapon actor planning remains event-scoped. It does not create launcher, target, hit, or outcome relations.
- `npx tsc --noEmit` still reports one pre-existing unrelated implicit-any error in `test/review-api.test.ts:120`; focused planner tests are green.

## Review Fixes

- Added evidence-backed discovery for `generic/v1`: unmatched factual entities now create stable actor groups without assigning a model or route. Unknown faction and missing/ambiguous location or identity are emitted as public planning diagnostics.
- Normalized `fighter-formation` pack profiles to the quantity resolver's `formation` role, preserving the protection against treating a single destruction as the full formation count.
- Quantity conflict behavior now preserves exact evidence over a conflicting user value; the returned reason records the conflict so scene compilation continues.
- Added a real unmatched `buildSceneBlueprint` test, an English numeric aircraft count assertion, and a profile-formation destruction regression.

Focused verification after the review fixes:

```text
tests 54
pass 54
fail 0
```
