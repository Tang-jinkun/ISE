# Continuous Motion Task 4 Report

## Scope

- Strengthened `Assert-FinalDomainInvariants` for one model track per RuntimePlan entity, one entity id per model track, and contiguous spawn/follow/hide lifecycles.
- Strengthened persisted desktop Chromium acceptance for 13 model tracks, one entity per track, three independently sampled follow windows, and subtitle computed style plus 16 px horizontal overlay gutters.
- Modified only the three required gate files before producing this report.

## TDD Evidence

### RED: real-flow contract

Command:

```powershell
powershell -ExecutionPolicy Bypass -File .\.superpowers\sdd\test-run-real-docx-flow.ps1
```

Observed before editing `run-real-docx-flow.ps1`:

- Exit code: `1`
- Failure: `Missing final artifact contract marker: SceneProjectConfig must contain exactly one model track per RuntimePlan entity.`
- This was the expected failure because the new invariant contract marker existed in the test before the gate implementation.

### GREEN: real-flow contract

The same command completed with exit code `0` after the minimal invariant implementation. Output summary:

```text
EMPTY_ARTIFACT_LEDGER=ok
TRANSIENT_BRIDGE_RETRY=ok
ACCESS_TOKEN_SELECTION=ok
ORDERED_DICTIONARY_PROPERTY=ok
EVENT_UNIT_COPY=ok
CORRELATED_ARTIFACT_SELECTION=ok
FINAL_DOMAIN_INVARIANTS=ok
FINAL_ARTIFACT_EXPORT=ok
```

The contract fixture also proved rejection of model-track count drift, multiple entity ids in one model track, an incomplete lifecycle, a follow start differing from spawn end, and a follow end differing from hide start.

### Persisted desktop E2E

The new persisted desktop assertions were added before the invariant gate implementation. The track/style acceptance body was not run because the current process had no `ISE_E2E_SCENE_ID`, and the current API database contained no existing Scene. This task explicitly prohibited regenerating a Scene, so no replacement Scene was created. A focused invocation stopped at the missing Scene id precondition before reaching the new assertions; it is not counted as a runtime behavior RED or GREEN.

Playwright discovery remained valid:

```powershell
npm run test:e2e -w @ise/web -- --list --project=desktop-chromium e2e/generated-replay.spec.ts
```

- Exit code: `0`
- Discovered: `2 tests in 1 file`, including the persisted desktop replay.

## Verification

```powershell
npm run typecheck -w @ise/web
```

- Exit code: `0`
- Result: `tsc --noEmit` completed without diagnostics.

```powershell
git diff --check
```

- Exit code: `0`
- Result: no whitespace errors; Git emitted only the repository line-ending warnings.

## Self-Review

- Existing actor-count, unique-route, media, diagnostic, correlation, lineage, export, and secret gates remain intact.
- The new lifecycle checks operate on persisted SceneProjectConfig model-track items and require exactly one spawn, follow, and hide per entity with both timing boundaries contiguous.
- Follow samples are strictly inside at least three windows; each selected window samples after 6,000 ms when its end permits it, and each actor must change both position and quaternion.
- Subtitle acceptance checks the exact white-glass background, deep text color, blur, 16 px font size, and both horizontal clearances against the desktop runtime overlay.
- No external model was invoked, Web was not rebuilt, no Scene was generated, and no credential or JWT was printed or written.

## Commit

- Gate changes: `396b560` (`test: strengthen continuous motion acceptance gates`)
- This report is committed separately so it can record the gate commit hash.

## Concerns

- Persisted track/style E2E remains to be executed against an operator-provided real Scene and access token. The environment had no reusable Scene, and creating one was outside Task 4 authority.
