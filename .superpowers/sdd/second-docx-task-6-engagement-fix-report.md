# Second DOCX Task 6 Engagement Fix Report

## Scope

Fixed generic split launch/outcome correlation and scene-beat weapon scoping without changing `agent/src/compiler/sceneCompiler.ts` or `agent/test/compiler.test.ts`.

## Root Cause

`outcomeScope` only admitted facts listed by the launch EventUnit. Later factual outcome EventUnits were therefore invisible to the launch intent. Scene-beat actor selection also matched every event-scoped weapon by its shared participant alias.

The fix uses EvidenceIR order, EventPlan evidence relations, EventUnit ordinal, and factual evidence kinds. An outcome is eligible only when it is linked by a later EventUnit and occurs before the next event-scoped weapon launch. Existing unresolved-outcome precedence and participant ambiguity diagnostics remain unchanged. Event-scoped weapons now bind only to their launch EventUnit or a beat whose evidence references their engagement lineage.

## TDD Evidence

### RED

Command:

```powershell
npx tsx --test --test-name-pattern="generic planning chains split weapon outcomes" test/scene-blueprint-planner.test.ts
```

Before the planner implementation, the test failed with:

```text
Expected: ['destroyed', 'unconfirmed']
Actual:   ['unconfirmed', 'unconfirmed']
```

The fixture uses invented Aster/Beryl factions, two event-scoped `PL-77Q` launches, split result/terminal-link EventUnits, and shared weapon participants. It asserts the first result beat carries only the first weapon and the later launch/result beats carry only the second.

### GREEN

The same focused command passed after the planner changes: 1 pass, 0 failures.

Additional verification:

```powershell
npx tsx --test test/engagement-intent-planner.test.ts
# 12 pass, 0 failures

npx tsx --test test/cross-document-start-end-flow.test.ts
# 1 pass, 0 failures
```

`test/scene-blueprint-planner.test.ts` ran 54 relevant/planner cases successfully, including the new regression. Its unrelated final choreography assertion failed because concurrent timing work changed compiler behavior; it was not modified by this task. Full `tsc --noEmit` is presently blocked by the concurrently modified `agent/test/compiler.test.ts` syntax error at line 986 (`TS1005: ',' expected`).

## Persisted Rebuild

Offline rebuild inputs came from session `6696577c-b530-4930-8197-5de738944cb4` accepted EventPlan, EvidenceIR, and NarrativePlan artifacts.

- `eu-blue-fox-01`: `destroyed`; evidence `ev-e31fefa0f6bb452d`, `ev-f12596ba86430a05`; weapon `group:weapon-eu-blue-fox-01`.
- `eu-red-fox-01`: `unconfirmed`; evidence `ev-0f565a213062813f`, `ev-f3fd0a8547194250`; weapon `group:weapon-eu-red-fox-01`.
- `eu-blue-fox-01` and `eu-blue-hit-01` reference only `group:weapon-eu-blue-fox-01`.
- `eu-red-fox-01` and `eu-red-miss-01` reference only `group:weapon-eu-red-fox-01`.

## Files

- `agent/src/planning/engagementIntentPlanner.ts`
- `agent/src/planning/sceneBlueprintPlanner.ts`
- `agent/test/scene-blueprint-planner.test.ts`

## Commit

- Implementation: `1fd1738` (`fix: correlate split engagement outcomes`)

## Coordinated Blocker Follow-Up

### Review Fixes

The coordinated Task 6 blocker wave extends the initial planner-only scope:

- Cross-unit outcomes now require a strong same-chain anchor. Unnumbered facts must identify both the event-scoped weapon and target with compatible EventUnit participants. A matching explicit weapon ordinal may cross a later launch boundary, but target-only ordinal text cannot resolve the missile.
- Multiple eligible outcome EventUnits or conflicting confirmed states remain `unconfirmed` and emit `ENGAGEMENT_OUTCOME_AMBIGUOUS`. Explicit unresolved wording retains precedence.
- Once an outcome EventUnit is uniquely anchored, all of its factual evidence is retained. Correlated chain-only facts such as terminal guidance are also retained, so their SceneBeats bind only the correct event-scoped weapon.
- `weaponEngagements` preserve full launch, outcome, and terminal-link evidence. Launch-bound fighter-to-missile relations intersect that lineage with the bound narration beat; empty intersections throw `CHOREOGRAPHY_RELATION_EVIDENCE_UNBOUND`.
- Final engagement camera, state, effect, and hide commands intersect the engagement lineage with their bound EventUnit. Empty intersections throw `COMMAND_EVIDENCE_UNBOUND`; `validatePlan` remains strict and unchanged.
- The shared timing allocator gives late source-clock terminal interactions enough model-follow time while preserving unresolved interaction status.

### RED Evidence

- Same-target unrelated destruction, including target-only ordinal text, incorrectly produced `destroyed` instead of `unconfirmed`.
- Competing eligible destroyed/intercepted outcome anchors incorrectly produced `destroyed` instead of an ambiguity diagnostic.
- A correlated terminal-guidance fact was absent from the engagement evidence lineage.
- The split red fighter-to-missile command failed with `COMMAND_EVIDENCE_INVALID` because it copied later outcome evidence into the launch EventUnit.
- After relation scoping, the launch-bound aftermath camera exposed the same invalid cross-event evidence copy.
- The late source-clock timing fixture failed with `NARRATION_VISUAL_DURATION_CONFLICT` before terminal-aware phase allocation.

### Final Verification

```powershell
npx tsx --test test/engagement-intent-planner.test.ts
# 16 pass, 0 fail

npx tsx --test --test-name-pattern="unrelated later destruction|competing confirmed outcomes|preserves correlated chain facts|explicit weapon ordinal" test/engagement-intent-planner.test.ts
# 4 pass, 0 fail

npx tsx --test --test-name-pattern="generic planning chains split weapon outcomes" test/scene-blueprint-planner.test.ts
# 1 pass, 0 fail

npx tsx --test test/cross-document-start-end-flow.test.ts
# 1 pass, 0 fail; includes final RuntimePlan and SceneProjectConfig validation

npx tsx --test --test-name-pattern="terminal interaction windows|missile launch follows|engagement intervals cover|destroyed engagement ends|chained interception" test/compiler.test.ts
# 5 pass, 0 fail
```

The full scene-blueprint planner command remains 54/55 because the unrelated existing synthesized-trajectory diagnostic test expects an exception that the current choreography compiler does not throw. Repository-wide `tsc --noEmit` also remains blocked by pre-existing type errors outside this blocker wave.

### Persisted SceneProject Rebuild

Session `6696577c-b530-4930-8197-5de738944cb4` was rebuilt offline from its accepted EventPlan, EvidenceIR, NarrativePlan, and AssetRegistry through a schema-validated `SceneProjectConfig` with 21 tracks.

- Outcomes: `destroyed`, `unconfirmed`.
- Blue engagement evidence: `ev-e31fefa0f6bb452d`, `ev-f12596ba86430a05`, `ev-22463a4466960116`.
- Red engagement evidence: `ev-0f565a213062813f`, `ev-f3fd0a8547194250`, `ev-02419d43e83d4fb7`.
- Blue launch relation and `data_link.show` command evidence: `ev-e31fefa0f6bb452d` only.
- Red launch relation and `data_link.show` command evidence: `ev-0f565a213062813f` only.

Coordinated blocker commit: pending.

## Same-EventUnit Anchor Review Fix

### Root Cause

The coordinated correlation predicate treated every factual record owned by the launch EventUnit as correlated. A target-only destruction, including text such as "the first target," could therefore resolve the engagement even though it did not identify the event-scoped weapon.

Only the launch record is now included unconditionally. Every other same-EventUnit fact must satisfy the same strong weapon/target anchor or explicit weapon-ordinal rule used across EventUnits. After one valid outcome anchor is established, other factual records in that anchored EventUnit may still contribute chain evidence.

### RED/GREEN Evidence

RED command:

```powershell
npx tsx --test --test-name-pattern="same-unit target-only ordinal" test/engagement-intent-planner.test.ts
```

Before the fix, the regression produced `destroyed`; the required result was `unconfirmed` with only the launch evidence retained.

GREEN results:

```powershell
npx tsx --test --test-name-pattern="same-unit target-only ordinal" test/engagement-intent-planner.test.ts
# 1 pass, 0 fail

npx tsx --test test/engagement-intent-planner.test.ts
# 17 pass, 0 fail

npx tsx --test --test-name-pattern="generic planning chains split weapon outcomes" test/scene-blueprint-planner.test.ts
# 1 pass, 0 fail

npx tsx --test test/cross-document-start-end-flow.test.ts
# 1 pass, 0 fail
```

The persisted session rebuilt offline through a schema-valid 21-track SceneProject with outcomes `destroyed`, `unconfirmed`. Blue and red engagement evidence remained the same complete three-record chains documented above.

Same-EventUnit review-fix commit: pending.
