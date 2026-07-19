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
