# Session API Regression Report

## Outcome

The four deterministic `session-api` failures were caused by a stale test
fixture, not a session or compiler behavior regression. The fixture supplied a
single low-importance English subtitle, whose deterministic duration is 4,000
ms. After the 800 ms subtitle visual lead and model spawn, less than the 4,000
ms minimum follow-path window remained, so the compiler correctly raised
`NARRATION_VISUAL_DURATION_CONFLICT` before producing resolved artifacts.

The shared session fixture now marks that subtitle as high importance. Its
6,000 ms duration covers the visual lead, spawn, and minimum follow-path
window, allowing each test to reach the artifact persistence or malformed
artifact behavior it is intended to verify. No production code or assertions
were weakened.

## Evidence

RED:

- `test/session-api.test.ts`: 18 passed, 4 failed.
- Temporary diagnostic tracing identified the first thrown error as
  `NARRATION_VISUAL_DURATION_CONFLICT: actor:pakistan-jf17:leader` from
  `sceneCompiler.ts` before adapter validation or artifact persistence.

GREEN:

- Session API focused tests: 22 passed, 0 failed.
- Compiler focused tests: 37 passed, 0 failed.
- Agent TypeScript check: passed.
- `git diff --check`: passed.

## Files

- `agent/test/session-api.test.ts`
