# Dynamic Camera Task 3 Report

## Scope

Implemented subtitle-covering dynamic camera compilation in:

- `agent/src/compiler/choreographyCompiler.ts`
- `agent/src/compiler/sceneCompiler.ts`
- `agent/test/compiler.test.ts`

## RED

Command:

```powershell
npx tsx --test --test-name-pattern "dynamic camera" test/compiler.test.ts
```

Result: exit 1; 6 dynamic-camera tests failed as expected before the compiler implementation. The failures showed missing establishing shots, missing `camera.follow_*` tails, incomplete engagement coverage, and old terminal/aftermath timing.

## GREEN

Commands:

```powershell
node ..\node_modules\tsx\dist\cli.mjs --test --test-name-pattern "dynamic camera" test/compiler.test.ts
node ..\node_modules\tsx\dist\cli.mjs --test --test-name-pattern "automatic missile lifecycle|successful interception|phase cameras|interception phase cameras|multiple successful interceptions|actor lifecycle extends|engagement subtitle too short|grounded missile engagements|real cross-beat engagement|independent engagements|final Indo-Pak compiler" test/compiler.test.ts
npm run typecheck -w @ise/agent
git diff --check
```

Results:

- Dynamic-camera pattern: 6 passed, 0 failed.
- Existing missile lifecycle/cross-beat pattern: 11 passed, 0 failed.
- Agent typecheck: passed.
- Diff whitespace check: passed.

## Edge Checks

- Terminal and aftermath suppression now requires a target engagement in a strictly later scene beat; earlier and same-beat engagements do not match the predicate.
- Every generated dynamic follow is scheduled after its 1,000 ms transition. Interval admission requires transition plus follow minima, and the focused engagement test asserts each follow duration is at least its capability minimum.
- Engagement subtitle intervals are keyed by unique shot ID. A subtitle gets one establishing shot and every phase shot receives a distinct sequential interval; the existing independent-engagement test verifies the multi-engagement shot IDs remain unique.
- The establishing interval is fixed at 2,000 ms. The compiler rejects a subtitle unless every remaining phase interval can also contain both command minima; the focused test verifies the establishing reservation and full visual-window coverage.

## Concern

`npx` became unavailable after the RED run because the local npm installation could not resolve `walk-up-path`. The workspace-installed `tsx` CLI was used for all GREEN test runs. This was an environment/tooling issue; no package or lockfile changes were made.
