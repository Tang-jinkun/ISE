# Task 6 Timing Fix

## Root Cause

`compileScene` established lifecycle windows, synchronized source-clock routes, and then could move a weapon follow start to its launcher's source-clock position. Terminal phase scheduling still ended at the subtitle-derived visual boundary. The later terminal close assigned that early endpoint to both actors, so a late source-clock start could leave a follow shorter than `model.follow_path`'s minimum and throw `NARRATION_VISUAL_DURATION_CONFLICT`.

## Fix

Phase scheduling now allocates each camera interval explicitly. A terminal phase grows until its actual endpoint reaches the latest weapon/target follow start plus the model-follow minimum, and every trailing phase retains at least its own camera interval minimum. The existing terminal-close path then synchronizes both actor follows and the interaction time at that endpoint. Explicitly unconfirmed interactions retain `status: unresolved`.

## Evidence

RED investigation command:

```powershell
npx tsx --test --test-name-pattern="terminal interaction windows extend" test/compiler.test.ts
```

The late-boundary fixture uses independent same-clock routes, a 91,000 ms source offset, and long actor lifecycles. Before the terminal-aware allocator it failed with:

```text
NARRATION_VISUAL_DURATION_CONFLICT: actor:weapon-intercept:leader
```

The final assertions require the interaction time to equal the actual terminal shot end, that endpoint to be at least the latest actor follow start plus 4,000 ms, synchronized weapon/target ends, and unresolved source status.

GREEN commands:

```powershell
npx tsx --test --test-name-pattern="terminal interaction windows|missile launch follows|engagement intervals cover|destroyed engagement ends|chained interception" test/compiler.test.ts
npx tsx --test test/cross-document-start-end-flow.test.ts
```

The timing cluster passed 5/5 and the cross-document vertical passed 1/1. The persisted session ledger did not contain the generated narration, blueprint, resolved-scene, or choreography artifacts required for a literal `compileScene` replay; the named second-DOCX flow passed as the deterministic generated-route coverage.

Files: `agent/src/compiler/sceneCompiler.ts`, `agent/test/compiler.test.ts`.

Initial implementation commit: `867acfe`. Terminal-boundary correction commit: pending.
