# Runtime Route Snapshot Report

## Scope

Expose route provenance from `ModelRuntime.getFrameSnapshot()` without changing model motion, interpolation, or visibility behavior.

## TDD Evidence

- RED: `npm run test -w @ise/web -- src/runtime/__tests__/ModelRuntime.test.ts`
  failed only the new route-provenance assertion because snapshots omitted
  `defaultTrajectoryAssetId` and `trajectoryAssetId` (18 passed, 1 failed).
- GREEN: the same focused command passed all 19 tests after the minimal runtime change.

## Implementation

- `ModelFrameState` records the asset id used by the latest successful `setTrajectory` call.
- `ModelEntityFrameSnapshot` always exposes the entity's configured
  `defaultTrajectoryAssetId` when present.
- Applied frame snapshots expose the active `trajectoryAssetId`, including the
  default route during spawn and the command route during `model.follow_path`.

## Verification

- Focused ModelRuntime tests: 19/19 passed.
- Web TypeScript check: passed.
- `git diff --check`: passed (repository line-ending warnings only).
- Playwright and services were not run, as required by the task brief.
