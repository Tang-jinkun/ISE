# Ordinal Final-Domain Invariants Report

## Scope

- Hardened only the identity, route, and lineage comparisons in `Assert-FinalDomainInvariants`.
- Added ordinal equality, containment, uniqueness, and set-equality helpers without lowercasing values or rewriting artifacts.
- Preserved the existing actor-count, media, diagnostics, model-track, lifecycle, and visual-lead gates.

## TDD Evidence

### RED

Command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.superpowers\sdd\test-run-real-docx-flow.ps1
```

Before the production edit, the contract exited `1` and reported all six missing case-sensitive boundaries:

```text
Expected final-domain rejections: case-drift assignment actor reference, case-drift choreography actor id, case-drift runtime entity id, case-drift follow command entity id, case-drift assignment route reference, case-drift runtime lineage artifact id
```

This proved that PowerShell's default comparisons accepted case-only drift across resolved actor assignments, choreography actors, RuntimePlan entities, follow commands, route references, and lineage artifact ids.

### GREEN

The same contract command exited `0` after the ordinal helper integration. It emitted:

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

## Verification

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.superpowers\sdd\run-real-docx-flow.ps1 -DryRun
```

- Exit code: `0`
- Result: one `DRY_RUN_OK` marker; no service connection or HTTP request was attempted.

```powershell
git diff --check
```

- Exit code: `0`
- Result: no whitespace errors; only repository line-ending warnings were emitted.

No model, service, real DOCX flow, or E2E command was run for this review fix.
