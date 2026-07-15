# ISE Artifact Export And Scene Harness Design

## Goal

Make the real Agent output inspectable as `event-plan.json`, `canonical-runtime-plan.json`, and `scene-project.json`, then let `/runtime-harness` play the same persisted SceneProjectConfig by Scene ID.

## Scope

- Add browser downloads only; do not add Agent or Nest download endpoints.
- Export the exact accepted EventPlan referenced by the current completed runtime artifact.
- Export `runtimePlan` and `sceneProjectConfig` from that same compiled artifact.
- Keep `/runtime-harness?fixture=runtime-main|runtime-catalog` unchanged for deterministic tests.
- Add `/runtime-harness?sceneId=<id>` for the real persisted Scene path.
- Do not build the asset manifest, seed MinIO, calibrate GLBs, probe videos, or add credentials in this change.

## Artifact Selection

The browser store already holds public artifact DTOs and the authoritative `latestCompletedRuntimeArtifactId`. Selection is valid only when:

1. Session status is `completed`.
2. `artifacts[latestCompletedRuntimeArtifactId]` has type `ise.canonical-runtime-plan/v1` and is not superseded.
3. Its data contains record-shaped `runtimePlan` and a `sceneProjectConfig` accepted by `sceneProjectConfigSchema`.
4. `runtimePlan.eventPlanArtifactId` names an artifact of type `ise.event-plan-accepted/v1` with record-shaped data.
5. `sceneProjectConfig.runtimePlanArtifactId` equals the compiled artifact ID and `sceneProjectConfig.eventPlanArtifactId` equals the referenced accepted artifact ID.

No newest-by-date guessing is allowed once a completed runtime ID exists. A failed or running session exposes no runtime/scene export from a retained older artifact.

## UI

Add a compact `ArtifactExportControls` group beside the existing Save and Convert controls in NewScript. It contains three download commands labeled `EventPlan`, `RuntimePlan`, and `SceneProject`, each with the existing Lucide download icon. Controls remain disabled until their exact payload is available; the surrounding page layout and panels do not change.

Downloads use UTF-8 JSON, two-space indentation, and a trailing newline. Object URLs are revoked immediately after the synthetic anchor click.

## Scene Harness

`RuntimeHarness` parses the query into one discriminated source:

- `{ kind: 'fixture', fixture: 'runtime-main' | 'runtime-catalog' }`
- `{ kind: 'scene', sceneId: string }`

`sceneId` takes precedence over `fixture`. Scene mode calls the authenticated Nest `getScene`, validates `response.data.config` with `sceneProjectConfigSchema`, and mounts the existing harness controller with that config. Invalid IDs, request failures, and invalid configs produce a blocking alert; they never fall back to a fixture.

The controller remains responsible only for Mapbox, runtime lifecycle, and controls. It receives `config: SceneProjectConfig` instead of indexing the fixture table internally.

## Error Handling

- Invalid or mismatched artifacts keep the corresponding export disabled.
- Blob/download failures surface the existing message error UI without exposing artifact internals.
- Scene harness fetch/schema failures render a blocking alert.
- Missing Mapbox token remains runtime status `error`; no test skip or fake canvas is introduced.

## Verification

- Unit-test exact artifact correlation, failure-state gating, accepted EventPlan selection, and JSON serialization.
- Integration-test the three visible downloads from a completed NewScript session.
- Unit-test harness query precedence and real Scene config loading with mocked API/runtime/map boundaries.
- Run focused tests, full Web tests, and Web typecheck.

## Out Of Scope

Asset manifest generation, MinIO seed, JWT provisioning, Mapbox credentials, browser codec measurement, GLB calibration, video export, new track types, and server-side ZIP/download APIs.
