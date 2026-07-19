# Second DOCX Task 6 Generic Interaction Validator Report

## Scope

The real DOCX export validator now associates resolved `RuntimeInteraction` records with confirmed choreography weapon engagements by exact ordinal `engagementId`. The runtime contract intentionally has no `targetRef`; `targetRef` remains only on choreography engagements. No agent compiler code changed.

## Root Cause

`Assert-FinalDomainInvariants` compared resolved generic runtime interactions to confirmed weapon engagements using `targetRef`. `runtimeInteractionSchema` is a strict object that defines `engagementId` and intentionally omits `targetRef`, so the real export from session `91b3019b-5f2e-4ac0-965f-b5e6d5eec032` failed even after compiling successfully.

## TDD Evidence

RED:

```powershell
& .\.superpowers\sdd\test-run-real-docx-flow.ps1
```

After changing the focused fixture to a resolved interaction with `engagementId` and no `targetRef`, the unmodified validator failed as expected:

```text
REAL_DEMO_FINAL_DOMAIN_INVALID: Resolved generic interactions must correspond one-to-one with confirmed weapon engagements by targetRef.
```

GREEN:

```powershell
& .\.superpowers\sdd\test-run-real-docx-flow.ps1
```

The focused PowerShell harness passed all 9 printed checks. Its generic interaction fixture now uses contract-realistic `engagementId` values and explicitly rejects:

- duplicate resolved interaction engagement IDs at equal counts;
- unknown resolved interaction engagement IDs at equal counts;
- resolved interactions for unconfirmed engagements at equal counts; and
- missing resolved interactions for confirmed engagements.

## Implementation

The existing resolved-versus-confirmed count check remains. The validator then requires ordinal set equality between resolved interaction `engagementId` values and confirmed choreography `engagementId` values. The set helper also rejects duplicates and invalid identifier values, providing the required one-to-one mapping without changing either runtime or choreography schemas.

## Files

- `.superpowers/sdd/run-real-docx-flow.ps1`
- `.superpowers/sdd/test-run-real-docx-flow.ps1`
- `.superpowers/sdd/second-docx-task-6-validator-report.md`
