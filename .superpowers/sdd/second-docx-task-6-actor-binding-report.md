# Second DOCX Task 6 Actor Binding Report

## Scope

Persistent semantic actors now bind to a SceneBeat when their grounded evidence intersects the EventUnit evidence and the participant wording shares an identity term with the semantic actor, in addition to the existing participant-alias match. The identity-term guard prevents a broad EventUnit from activating every actor mentioned by its multiple evidence records. Event-scoped weapon and engagement-chain binding is unchanged.

## Root Cause

`actorRefsForUnit` selected all non-event-scoped groups only by participant alias. The persisted EventPlan named `Blue E-3A Sentry AWACS`, while the semantic group was `Boeing E-3A Sentry AWACS`; both referenced `ev-03ae8893c7df99ac`. The alias predicate could not match the manufacturer difference, so no AWACS actor was active for patrol or data-link beats.

## TDD Evidence

RED:

```powershell
npx tsx --test --test-name-pattern="binds persistent actors by shared grounded evidence" test/scene-blueprint-planner.test.ts
```

The new regression failed before the implementation change:

```text
AssertionError: assert.ok(beat.actorRefs.includes(awacs.groupId))
```

The fixture uses a participant without the manufacturer token and a persistent actor group grounded by the same evidence record. It also creates a separate persistent relay actor and asserts that the relay group is not bound to the AWACS EventUnit.

GREEN:

```powershell
npx tsx --test --test-name-pattern="binds persistent actors by shared grounded evidence" test/scene-blueprint-planner.test.ts
# 1 pass, 0 fail

npx tsx --test test/cross-document-start-end-flow.test.ts
# 1 pass, 0 fail
```

The complete planner file ran with 55 pass and 1 unrelated existing failure: `compileChoreography rejects synthesized trajectory diagnostics instead of hiding them` expected an exception that the current choreography compiler does not throw. The failure is outside this actor-binding change and was not modified.

## Persisted Offline Rebuild

Session `f023640d-2a17-4d67-945f-e6965f40f9b7` was rebuilt offline from its active accepted EventPlan, EvidenceIR, NarrativePlan, and AssetRegistry using the current deterministic planner, resolver, choreography compiler, scene compiler, and runtime adapter.

- Resolved actors: `11`
- Generated routes: `11`
- AWACS model: `model:awacs-generic-e3a`
- Engagement outcomes: `destroyed`, `unconfirmed`
- Runtime interactions: `1` resolved, `1` unresolved

Generated outputs are ignored under `agent/.superpowers/sdd/offline-f023-rebuild`.

## Files

- `agent/src/planning/sceneBlueprintPlanner.ts`
- `agent/test/scene-blueprint-planner.test.ts`
- `.superpowers/sdd/second-docx-task-6-actor-binding-report.md`
