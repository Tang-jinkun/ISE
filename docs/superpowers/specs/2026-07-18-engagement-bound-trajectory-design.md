# Engagement-Bound Trajectory Design

## Goal

Make DOCX-described weapon interactions compile as one closed relation: launcher -> weapon -> target -> interaction window. A weapon route must not play as an unrelated catalog path.

## Design

`compileChoreography` normalizes event-scoped lifecycle identifiers so equivalent event ids such as `eu-04` and `eu-004` bind to the same scene beat. It emits a `WeaponEngagement` for every weapon-launch group whose behavior profile describes an interaction, including the Pakistani interception weapon.

`compileScene` keeps the engagement as the source of truth for timing and computes an optional `spatialBinding` for the weapon route. The binding contains the launcher-relative longitude/latitude/altitude offset at launch. It is derived from catalog samples, never hard-coded per scenario.

The runtime applies the binding to the sampled position and trail while preserving the source route shape and heading. The existing hybrid timing solver remains responsible for shared interaction windows. If an interaction cannot be resolved, the command carries `status: unresolved` and no impact effect is synthesized.

## Protocol changes

`model.follow_path.params.timing` may include `spatialBinding` with `anchorEntityId`, `longitudeOffsetDeg`, `latitudeOffsetDeg`, and `altitudeOffsetM`.

The binding is optional for legacy routes and required for resolved weapon launches when a launcher and weapon route are available.

## Verification

Focused compiler tests must assert that the first Pakistani intercept produces an engagement with launcher, weapon, target, a shared sync group, and a spatial binding. Runtime tests must assert that the bound weapon starts at the launcher-relative anchor while retaining its route direction.
