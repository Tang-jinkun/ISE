# Start/End Trajectory Synthesis for DOCX Scenes

## Goal

Allow a DOCX scene to produce playable model, warning-aircraft, and weapon
trajectories when the document provides grounded start/end positions but no
pre-authored trajectory JSON. The generated route must use the same canonical
trajectory contract as catalog routes, remain deterministic, and participate in
the existing interaction solver without fabricating a hit or collision.

The acceptance fixture is a new Indo-Pak air-interception report using the
available GLB set: Indian Netra AWACS, Pakistani E-3A Sentry, Indian Su-30MKI,
Indian Rafale, and Pakistani JF-17. It explicitly states formation quantities,
warning-aircraft data links, a missile launch, and one geometrically supported
aircraft kill.

## Constraints

- Keep the DOCX -> EvidenceIR -> EventPlan -> review -> runtime compiler flow.
- Prefer an exact catalog route when one exists.
- Generate a route only from grounded document evidence; never infer a route
  from a subtitle alone.
- Keep explicit quantities authoritative. Pack or global defaults apply only
  when the document has no reliable quantity.
- Generated routes must be auditable with source evidence references and a
  generation method.
- Only an interaction supported by time-and-space geometry may become `hit`,
  `collision`, or `destroyed`. Unsupported interactions remain `unresolved`.
- Runtime consumes canonical plans and does not know whether a route came from
  a catalog or the generator.
- Desktop Chromium is the only acceptance surface for this change.

## Architecture

```text
DOCX
  -> EvidenceIR (actor, count, start, end, timing, action)
  -> AssetResolver (GLB and catalog route resolution)
  -> TrajectoryResolver
       exact catalog route
       -> deterministic start/end synthesis
       -> grounded static marker
  -> InteractionSolver (including generated routes)
  -> CanonicalRuntimePlan -> SceneProjectConfig
```

`TrajectoryResolver` owns the fallback order. `StartEndTrajectorySynthesizer`
is scenario-independent and has no Indo-Pak names or aliases. Existing
scenario packs provide model metadata, role defaults, and route compatibility;
they do not own the interpolation algorithm.

## Input Contract

The resolver may create a `TrajectoryRequest` only when both endpoints are
grounded by evidence:

```ts
type TrajectoryRequest = {
  actorId: string;
  start: { coordinates: [number, number]; altitudeM?: number };
  end: { coordinates: [number, number]; altitudeM?: number };
  source: 'document';
  sourceRefs: string[];
  pathStyle: 'great_circle' | 'intercept';
  startMs: number;
  endMs: number;
  speedKmh?: number;
  targetActorId?: string;
};
```

The request is invalid when either endpoint, timing window, or actor identity is
missing. Invalid requests produce a scoped diagnostic and a static marker or
unresolved actor according to the existing resolver rules.

## Generated Route Contract

The synthesizer returns a standard trajectory asset plus provenance:

```ts
type GeneratedTrajectory = {
  trajectoryAssetId: string;
  sourceKind: 'generated';
  generationMethod: 'document-endpoints-v1';
  sourceRefs: string[];
  start: [number, number];
  end: [number, number];
  points: Array<{
    coordinates: [number, number];
    timeMs: number;
    altitudeM?: number;
  }>;
};
```

The first implementation uses deterministic spherical interpolation with
16-32 points, preserving monotonic time and endpoint equality. The point count
is derived from duration and distance, clamped to the range, so identical
inputs produce byte-stable output. Heading is derived from the next point and
does not require a second route format.

`great_circle` is used for aircraft and patrol movement. `intercept` uses the
launcher position and the target's position at the terminal time. It may use a
target terminal anchor, but it cannot declare a hit by itself; the interaction
solver must still find a temporal and spatial intersection within tolerance.

## Interaction Behavior

- Moving actors with catalog or generated routes are eligible for
  `InteractionSolver`.
- Static markers are never used as a geometric producer or target for a hit.
- A missile launch creates an event-scoped weapon actor and a generated
  intercept request when the document supplies a launcher and target anchor.
- A successful terminal intersection emits the existing impact/destroyment
  commands and a camera beat. A miss, ambiguous producer, or missing endpoint
  remains `unresolved` and emits no destruction effect.
- Data links are emitted as separate source/target tracks and may use generated
  aircraft routes without changing the runtime command schema.

## Asset Registration

The fixture uses these semantic asset entries, independent of filenames:

- `aircraft:india-netra-awacs` -> `indian_netra_awacs.glb`
- `aircraft:pakistan-e3a-sentry` -> `boeing_e-3a_sentry_awacs.glb`
- `aircraft:india-su30mki` -> `su-30_mki.glb`
- `aircraft:india-rafale` -> `dassault_rafale.glb`
- `aircraft:pakistan-jf17` -> `pakistan_jf_17_thunder.glb`

Catalog entries carry role, faction, aliases, and orientation calibration.
The resolver never infers ownership from a filename prefix.

## DOCX Acceptance Fixture

The fixture will contain four timed sections:

1. Both AWACS platforms patrol from explicit start to end coordinates and
   establish data links.
2. Indian Su-30MKI and Rafale formations launch from explicit bases while the
   Netra relays a target position.
3. A Su-30MKI launches one missile from its current position toward a named
   Pakistani JF-17; the report explicitly confirms terminal impact and loss.
4. A second approach remains unconfirmed, proving that the compiler leaves it
   unresolved instead of inventing a second kill.

Every formation quantity, route endpoint, launch actor, target actor, and
outcome is stated in factual prose. No trajectory JSON is attached to the
document.

## Verification

- DOCX structural parse confirms title and four timed sections.
- Unit tests cover deterministic interpolation, endpoint preservation, invalid
  endpoint fallback, generated-route catalog provenance, and temporal
  interception.
- A real DOCX export must contain GLB model bindings, generated trajectory
  assets, AWACS actors, a data-link track, one supported destruction, and one
  unresolved interaction.
- The exported `event-plan.json`, `canonical-runtime-plan.json`, and
  `scene-project.json` must parse against their schemas.
- One desktop preview is handed to the user for visual acceptance.

## Non-Goals

- No LLM-generated point lists.
- No automatic route generation from vague prose without two grounded endpoints.
- No mobile-specific work.
- No replacement of existing catalog routes.
