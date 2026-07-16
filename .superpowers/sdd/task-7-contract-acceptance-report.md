# Task 7A Contract Acceptance Report

Status: COMPLETE FOR PRE-SERVICE ACCEPTANCE PREPARATION

## Changed files

- `.superpowers/sdd/run-real-docx-flow.ps1`
- `.superpowers/sdd/test-run-real-docx-flow.ps1`
- `apps/web/e2e/generated-replay.spec.ts`
- `.superpowers/sdd/task-7-contract-acceptance-report.md`

`apps/web/src/runtime/testing/runtimeFixtures.ts` was not changed because persisted SceneProjectConfig inspection provides the required multi-actor coverage without weakening the non-persisted smoke test.

## RED evidence

1. `powershell -ExecutionPolicy Bypass -File .\.superpowers\sdd\test-run-real-docx-flow.ps1`
   - Exit 1: `Missing function under test: Select-CorrelatedArtifacts`.
   - This proved the AST/helper test required the missing correlated-selection and export helpers before implementation.
2. The same helper command after adding final-schema markers:
   - Exit 1: `Missing final artifact contract marker: narrationPlanSchema`.
   - This proved the validator did not yet cover the final-domain schemas.
3. The same helper command with an ordered-dictionary regression fixture:
   - Exit 1: `Expected ordered dictionary properties to be readable.`
   - Minimal reproduction showed direct property count `2`, while `Get-PropertyValue` returned null because ordered dictionary keys are not PSObject properties.
4. `powershell -ExecutionPolicy Bypass -File .\.superpowers\sdd\run-real-docx-flow.ps1 -DryRun`
   - Exit 1 before the dictionary fix: `REAL_DEMO_FINAL_DOMAIN_INVALID: The generated scene must contain multiple actor groups and one route assignment per resolved actor.`
   - The single `IDictionary` access branch fixed the root cause; no invariant was weakened.
5. Independent-review token regression, using the helper command:
   - Exit 1: `Missing function under test: Get-FlowAccessToken`.
   - The GREEN behavior reuses a nonblank process `ISE_E2E_ACCESS_TOKEN` with zero registration requests and retains one randomized `/auth/register` request when the process token is absent.
6. Independent-review persisted replay regression, using the helper command:
   - Exit 1: `Persisted desktop acceptance must exercise runtime replay.`
   - The GREEN E2E observes replay below 500ms, then requires playback to advance again and pauses it.
7. Independent-review Preview camera regression, using the helper command:
   - Exit 1: `Persisted desktop acceptance is missing dynamic Preview camera marker: function cameraAcceptanceTimes`.
   - The GREEN E2E rejects the old `2_000` and `15_750` thresholds, derives two bounded samples from visible camera tracks, and seeks the Preview timeline playhead directly.
8. Real-flow transient bridge regression, using the helper command:
   - Exit 1 on the first probe: `NEST_BRIDGE_FAILED: session polling failed with HTTP 502.`
   - The second successful probe was never reached, reproducing the real DOCX run's zero-tolerance polling failure.
   - GREEN tolerates at most three consecutive `NEST_BRIDGE_FAILED` probes, resets after any nonthrowing probe, throws the fourth unchanged, and throws every other error immediately.
   - Deadline coverage uses a nonzero one-second deadline and a 1.2-second native `Thread.Sleep` inside the first failing probe; the result is `REAL_DEMO_WAIT_TIMEOUT` with `probeCount = 1`, proving no second probe and no deadline reset.

## GREEN evidence

- PowerShell helper test: exit 0, 8 markers printed.
  - `EMPTY_ARTIFACT_LEDGER=ok`
  - `TRANSIENT_BRIDGE_RETRY=ok`
  - `ACCESS_TOKEN_SELECTION=ok`
  - `ORDERED_DICTIONARY_PROPERTY=ok`
  - `EVENT_UNIT_COPY=ok`
  - `CORRELATED_ARTIFACT_SELECTION=ok`
  - `FINAL_DOMAIN_INVARIANTS=ok`
  - `FINAL_ARTIFACT_EXPORT=ok`
- Real flow dry run: exit 0.
  - Validated the source DOCX, origins and repository markers, all seven authoritative Zod artifact schemas, SceneProjectConfig, final-domain invariants, and secret/source-path rejection.
  - Confirmed no service connection or HTTP request was attempted.
- `npm run typecheck -w @ise/web`: exit 0 (`tsc --noEmit`).
- `npm run test:e2e -w @ise/web -- --project=desktop-chromium --list`: exit 0.
  - 4 desktop tests discovered in 2 files.
  - Both generated replay tests were discovered under `desktop-chromium`.

## Contract coverage

- Selects one active accepted EventPlan, NarrationPlan, SceneBlueprint, ResolvedScenePlan, ChoreographyPlan, and compiled artifact through exact metadata IDs.
- Checks metadata/data lineage through compiled RuntimePlan and SceneProjectConfig.
- Parses all seven JSON values through repository Zod schemas before Scene persistence.
- Requires multiple groups and actors, one unique catalog route per actor, no fallback recipe or synthesized trajectory diagnostic, exact runtime actor/route correspondence, image and video commands, and an 800ms subtitle-to-visual lead.
- Secret/source-path scans run before persistence and again over all seven exports plus `scene-id.txt`.
- Exports exactly seven BOM-free UTF-8 JSON names plus `scene-id.txt`.
- Reuses `ISE_E2E_ACCESS_TOKEN` when supplied so the flow and persisted E2E share one user, while preserving secret-safe random registration as the fallback.
- Retries only transient `NEST_BRIDGE_FAILED` polling errors, with a three-consecutive-error budget and no expansion to other HTTP or business failures.
- Persisted desktop acceptance reads the loaded SceneProjectConfig, derives image/video, overlapping two-aircraft follow-path, and two visible camera-transition sample times, asserts unique persisted entity/routes, finite snapshots, two moving same-ID aircraft, orientation change, real media decode/play, replay reset/progression, canvas movement, controls, camera movement through direct Preview seeking, and Preview framing.

## Concerns

- The actual persisted desktop browser run is intentionally deferred until API/Agent/Web services, seeded assets, `ISE_E2E_ACCESS_TOKEN`, `PUBLIC_MAPBOX_TOKEN`, and `ISE_E2E_SCENE_ID` are available. Only Playwright discovery was run in this task.
- `npx biome check e2e/generated-replay.spec.ts` could not run because the current Web Biome configuration reports that no ignore file exists in `apps/web`; the required Web typecheck and Playwright discovery both pass.
- Pre-existing untracked `apps/web/test-results/` content was not read, modified, staged, or deleted.
