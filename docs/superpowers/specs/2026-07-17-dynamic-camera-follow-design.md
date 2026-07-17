# Dynamic Camera Follow Design

## Goal

Keep a grounded actor, formation, engagement pair, or global tactical group visibly framed for the full subtitle interval. Generated scenes must no longer hold a stale static camera after the referenced models have moved or hidden.

## Scope

This change adds two runtime commands while preserving existing `camera.transition` scenes:

- `camera.follow_actor`: continuously frame one visible entity.
- `camera.follow_group`: continuously fit the visible members of an explicit entity set.

The first version uses fixed bearing, deterministic current-time sampling, bounded zoom, and a declarative active interval. Orbit, free-camera physics, user-authored splines, and mobile acceptance are out of scope.

## Contracts

Canonical RuntimePlan adds the two command types. SceneProject camera items retain the legacy static parameter shape and add two strict action-discriminated shapes:

```text
camera.follow_actor
  entityId
  framing: tracking | close
  zoom
  pitch
  bearing
  lookAheadMs
  transitionMs

camera.follow_group
  entityIds[]
  framing: global | formation | engagement
  paddingPx
  minZoom
  maxZoom
  pitch
  bearing
  transitionMs
```

Every referenced entity must exist. Group IDs must be unique. `minZoom` may not exceed `maxZoom`. The item duration is the follow lifetime, so seek and replay do not depend on an imperative release command.

## Runtime

`SceneRuntime` applies models before cameras on every frame. It then passes the immutable model snapshots to `MapRuntime`.

For actor follow, `MapRuntime` selects the visible entity, offsets the center toward the current heading using `lookAheadMs`, and applies the configured zoom, pitch, and bearing. For group follow, it filters to visible entities and fits their current coordinates with padding and zoom clamps. If no requested subject is visible, it retains the last valid camera state for that frame rather than jumping to an empty location.

Camera state remains a deterministic function of scene time and current model snapshots. Runtime code uses `jumpTo`; it does not start a new `easeTo` animation every frame. During the first `transitionMs` of a follow item, it deterministically blends the previous camera policy and the new policy using the current snapshots.

## Compiler

Choreography always retains an establishing shot for an engagement beat, then appends supported engagement phases. The final compiler emits follow commands after subtitle scheduling:

- ordinary beat: one `follow_group` or `follow_actor` covering subtitle visual lead through subtitle end;
- global beat: include every actor whose lifecycle overlaps the subtitle, not only one side's leader proxies;
- engagement beat: divide the full visual window across establishing, launch, midcourse, terminal, and aftermath shots;
- an upstream weapon later targeted by a separate interception does not emit its own premature terminal/aftermath phase;
- interception aftermath follows surviving launcher/weapon or the active tactical group, never only the target hidden at terminal;
- destruction aftermath follows the destroyed target until the end of its shot, then hides it.

The compiler chooses subjects. The runtime never guesses narrative meaning.

## Compatibility

Existing static camera items continue to parse and play unchanged. `BaseRuntimeAdapter` maps all three camera command types into the existing camera track. No new track type or Scene schema version is required.

## Focused Verification

- runtime-contracts accepts both follow shapes and rejects unknown, duplicate, or inverted references;
- MapRuntime follows moving actor/group snapshots and produces identical states after seek/replay;
- SceneRuntime proves model snapshots are produced before camera application;
- compiler emits follow items covering every subtitle visual tail and delays interception/destruction outcomes to their supported beat;
- one real DOCX re-export contains dynamic camera items and one desktop Chromium replay confirms visible GLBs at formerly empty subtitle tails.

