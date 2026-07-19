# Task 4 Cross-Document Compiler Proof Report

## Status

Implemented the deterministic real-DOCX vertical slice and fixed the generic defects it exposed. The focused vertical test passes without changing the fixture wording, expected actor count, target duration, North Sea data, or adding a scenario pack.

## Root Causes And Fixes

1. Generic actor discovery keyed persistent actors by raw evidence entity text and each record location. Route-bearing `Rafale`/`J-10` actors and later `Blue Rafale`/`Red J-10` mentions therefore became separate groups; organizational labels and pronouns were also renderable. Discovery now anchors identity to grounded route entities, coalesces faction-prefixed aliases and evidence into those anchors, retains route quantity/location, and rejects non-renderable labels.
2. The final compiler derived `totalDurationMs` from every output end, but validation then treated `narrativePlan.targetDurationMs` as a hard runtime cap. The scheduler still enforces narration and scheduled-visual fit; the redundant final cap was removed so required terminal interaction geometry may extend the canonical runtime.
3. Canonical `data_link.show` commands adapted to a SceneProject `data_link` discriminator while the acceptance contract requires `data-link`. New projects now emit `data-link`; the shared parser normalizes legacy `data_link` input for persisted-project compatibility, and direct web consumers use the canonical discriminator.
4. The final compiler copied every global AssetRegistry diagnostic into a scene. An unrelated seed alias warning containing `trajectory:minhas-j10ce-1` leaked legacy scenario text into the North Sea project. Registry diagnostics are now included only when they mention an asset actually referenced by the compiled scene; resolver diagnostics remain unchanged.

## RED/GREEN Evidence

- Actor identity RED: focused planner test returned four persistent groups (`Rafale`, `J-10`, `Blue Rafale`, `Red J-10`) instead of two route-bearing groups.
- Actor identity GREEN: `npx tsx --test --test-name-pattern="coalesces faction-prefixed aliases" test/semantic-actor-planner.test.ts` passed 1/1.
- Duration RED: focused compiler test failed with `RUNTIME_DURATION_EXCEEDED: 77800 exceeds 51800` after the scheduler had accepted the narration window.
- Duration GREEN: `npx tsx --test --test-name-pattern="canonical runtime duration expands" test/compiler.test.ts` passed 1/1.
- Track discriminator RED: focused adapter test received `data_link` instead of `data-link`.
- Track discriminator GREEN: `npx tsx --test --test-name-pattern="adapter exposes data-link" test/base-runtime-adapter.test.ts` passed 1/1; the two direct web runtime test files passed 35/35.
- Diagnostic scoping RED: focused compiler test found an unrelated `trajectory:unrelated-one` registry warning in runtime diagnostics.
- Diagnostic scoping GREEN: `npx tsx --test --test-name-pattern="omits registry diagnostics" test/compiler.test.ts` passed 1/1.
- Vertical GREEN: `npx tsx --test test/cross-document-start-end-flow.test.ts` passed 1/1, including 11 actors/routes/generated trajectories, grounded resolved/unresolved interactions, all required track types, and no Indo-Pak names.

## Verification Notes

- `packages/runtime-contracts/test/scene.test.ts`: 9/10 passed. The track/parser tests passed, including legacy input normalization. The unrelated JSON Schema test fails because its fixture omits the JSON-Schema-required defaulted `generatedTrajectories` property; this task did not change that behavior.
- `agent/test/semantic-actor-planner.test.ts`: the new alias regression and existing launch-target regression pass. Two existing pack-profile expectations fail in code paths bypassing the modified discovery branch; they were not expanded into this milestone.
- `packages/agent-core/src/cli.ts` was restored content-identical. The verified in-worktree `node_modules.incomplete` directory was removed; the valid dependency installation was not touched.

