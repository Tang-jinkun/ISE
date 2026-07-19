# Task 5 Report: Generic Real-Flow Interaction Validation

## Scope

- Modified only `.superpowers/sdd/run-real-docx-flow.ps1` and `.superpowers/sdd/test-run-real-docx-flow.ps1`.
- Did not modify compiler code or DOCX files.

## RED Evidence

Added a generic generated fixture with two generated route assignments, E-3A AWACS and PL-15E missile model assets, one destroyed choreography engagement, and one resolved plus one unresolved runtime interaction. The fixture also supplies scene entities so generic validation continues into the shared model-track and lifecycle checks.

Command:

```powershell
powershell -ExecutionPolicy Bypass -File .\.superpowers\sdd\test-run-real-docx-flow.ps1
```

Result: exit code `1` with the intended pre-change failure:

```text
REAL_DEMO_FINAL_DOMAIN_INVALID: Generic scenes may not fabricate resolved interactions.
```

## Change

Removed the GenericMode resolved-interaction prohibition and its early return from `Assert-FinalDomainInvariants`. Generic artifacts now retain the grounded-actor and marker/follow checks, then continue through the shared model-track, lifecycle, command, lineage, and schema invariants.

The test includes a negative mutation that changes the unconfirmed interaction to a second resolved interaction while preserving only one destroyed engagement. It expects `REAL_DEMO_FINAL_DOMAIN_INVALID`.

## Fixture Alignment

The prior fixture did not provide `SceneProjectConfig.entities`, despite shared model-track validation requiring it. It also expected generated trajectory diagnostics to be rejected even though document-grounded generated trajectories are first-class for `-StartEndScenario`. The stale diagnostic mutation is now a fallback-recipe mutation, which remains invalid.

The dry-run test creates and removes a minimal valid DOCX in the system temporary directory, then passes its path explicitly. No DOCX file is added to the repository.

## GREEN Evidence

Ran the same focused command after the change:

```powershell
powershell -ExecutionPolicy Bypass -File .\.superpowers\sdd\test-run-real-docx-flow.ps1
```

Result: exit code `0`.

```text
EMPTY_ARTIFACT_LEDGER=ok
TRANSIENT_BRIDGE_RETRY=ok
ACCESS_TOKEN_SELECTION=ok
ORDERED_DICTIONARY_PROPERTY=ok
EVENT_UNIT_COPY=ok
CORRELATED_ARTIFACT_SELECTION=ok
FINAL_DOMAIN_INVARIANTS=ok
FINAL_ARTIFACT_EXPORT=ok
COMPLETE_DRY_RUN_ENTRY_POINT=ok
```

## Verification Summary

- RED: confirmed the new fixture failed specifically on the former generic resolved-interaction ban.
- GREEN: the focused PowerShell fixture passed after the generic ban and early return were removed.
- `git diff --check`: passed.
