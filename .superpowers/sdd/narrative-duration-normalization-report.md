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

## Review Follow-up: Shared Estimator

The scheduler's exported `subtitleDurationMs` now delegates to
`estimatedNarrationDurationMs` in the narration planner. This removes the
second Han-character and importance formula while preserving the scheduler's
public API and dependency direction.

The parity regression compares real `buildNarrationPlan` beat estimates with
real `scheduleNarrative` subtitle durations for high, medium, and low
importance, including Han-character rounding boundaries. It initially passed
against the matching duplicate implementations. A controlled mutation from
four to five Han characters per second in the scheduler made the test fail at
the expected low-importance boundary (`4,000` instead of `5,000`), proving the
test detects formula drift. The mutation was then removed before the shared
estimator implementation.

Follow-up verification:

- NarrativePlan and compiler focused tests: 46 passed, 0 failed.
- Agent TypeScript check: passed.
- `git diff --check`: passed.
