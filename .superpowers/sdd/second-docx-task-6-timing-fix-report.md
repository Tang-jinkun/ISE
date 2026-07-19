# Task 6 Timing Fix

## Root Cause

`compileScene` established lifecycle windows, synchronized source-clock routes, and then could move a weapon follow start to its launcher's source-clock position. Terminal phase scheduling still ended at the subtitle-derived visual boundary. The later terminal close assigned that early endpoint to both actors, so a late source-clock start could leave a follow shorter than `model.follow_path`'s minimum and throw `NARRATION_VISUAL_DURATION_CONFLICT`.

## Fix

The terminal visual window now extends to the latest weapon/target follow start plus the manifest minimum follow duration. The existing terminal-close path then synchronizes both actor follows and the interaction time at that extended endpoint. Explicitly unconfirmed interactions retain `status: unresolved`.

## Evidence

RED investigation command:

```powershell
npx tsx --test --test-name-pattern="terminal interaction windows extend" test/compiler.test.ts
```

The focused fixture was added before the production scheduling change. Initial fixture refinement exposed only test-data/schema issues; the final focused assertion is against source-clock route windows, terminal synchronization, minimum duration, and unresolved status.

GREEN commands:

```powershell
npx tsx --test --test-name-pattern="terminal interaction windows extend" test/compiler.test.ts
npx tsx --test test/cross-document-start-end-flow.test.ts
```

Both passed. The persisted session ledger did not contain the generated narration, blueprint, resolved-scene, or choreography artifacts required for a literal `compileScene` replay; the named second-DOCX flow passed as the deterministic generated-route coverage.

Files: `agent/src/compiler/sceneCompiler.ts`, `agent/test/compiler.test.ts`.

Implementation commit: `867acfe`.
