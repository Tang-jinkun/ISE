# Narrative Duration Normalization Report

## Outcome

`propose_scene_plan` now raises `NarrativePlan.targetDurationMs` when the final
narration requires more time than the proposed target. It never lowers an
already sufficient target.

The deterministic floor is:

- the sum of narration beat duration estimates used by `buildNarrationPlan`;
- 1,000 ms between EventPlan units; and
- the `model.hide` minimum duration from the capability manifest.

The normalized target is returned in tool content and persisted in the
NarrativePlan artifact. A floor above the 600,000 ms schema limit fails with
the stable `NARRATIVE_DURATION_UNSUPPORTED` diagnostic. The scheduler and
final narration are unchanged.

## TDD Evidence

RED: `npm exec -- tsx --test test/narrative-plan.test.ts` failed the three new
tests because the target stayed at 180,000 ms, content omitted the target, and
an unsupported floor was accepted.

GREEN:

- NarrativePlan focused tests: 9 passed, 0 failed.
- Compiler duration regression tests: 36 passed, 0 failed.
- Agent TypeScript check: passed.
- `git diff --check`: passed.

## Files

- `agent/src/planning/narrationPlanner.ts`
- `agent/src/tools/scenePlanTools.ts`
- `agent/test/narrative-plan.test.ts`
