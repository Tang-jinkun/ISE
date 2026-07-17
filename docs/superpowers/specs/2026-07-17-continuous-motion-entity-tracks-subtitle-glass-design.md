# Continuous Motion, Entity Tracks, and Subtitle Glass Design

## Objective

Make generated replay scenes remain visually active for the full narrated interval, expose simultaneous model actions as independently editable entity tracks, and keep subtitles readable over all map imagery.

## Current Failure

- Final scene compilation emits one `model.follow_path` per actor with a fixed 6,000 ms duration. The runtime correctly reaches the route end and then holds the model there until `model.hide`.
- `BaseRuntimeAdapter` groups every command only by track type. All model commands therefore share `track:model`, and Timeline renders simultaneous clips at the same vertical position.
- Subtitle DOM has positioning only. It has no explicit foreground, background, spacing, wrapping, or blur treatment.
- `Dragger` reports original props and empty collisions on mouse-up, so a visible drag can persist the old timing or fail to identify the target lane.

## Design

### Motion Semantics

`MotionSegment` gains the required policy `coverage: "actor-lifecycle"`. It states that the assigned catalog trajectory is fitted once across the actor's visible lifecycle; the runtime must not loop or synthesize a route.

The final compiler resolves that policy after subtitle scheduling:

1. Spawn starts at the first bound subtitle's visual lead (`subtitle.startMs + 800`).
2. Follow starts when spawn ends.
3. Follow ends at the end of the last bound subtitle.
4. Hide starts exactly when follow ends.
5. If the available follow window is below the capability minimum, compilation fails with `NARRATION_VISUAL_DURATION_CONFLICT`.

This keeps the existing subtitle-first visual lead while preventing any stationary gap during the actor's narrated lifecycle. Each actor retains its own registered trajectory, heading, pitch, and quaternion sampling.

### Persisted Track Layout

`BaseRuntimeAdapter` continues to emit one track for subtitle, image, video, marker, geojson, and camera types. Model commands are grouped by `params.entityId`, producing one persisted model track per entity:

- `trackId`: `track:model:<entityId>`
- `label`: the entity display name
- `items`: only that entity's spawn, follow, state, and hide commands

The existing `ise-scene/v1` schema already permits multiple tracks of the same type. Existing single-model-track scenes remain valid and playable. `ModelRuntime` already flattens all visible model tracks, so playback behavior needs no compatibility branch.

Timeline renders each model track as a separate row. Same-time clips therefore align horizontally on separate rows instead of covering each other. Model clips may move only between compatible model rows; their `entityId` remains authoritative.

### Editing Reliability

`Dragger` keeps the latest drag/resize rectangle, collisions, and guides in refs. Mouse-up emits those final values rather than the original props. Focused DOM tests simulate drag and resize completion and assert the emitted final coordinates.

### Subtitle Treatment

The shared `OverlayRuntime.createSubtitle` applies a quiet white glass surface:

- deep gray text, 16 px, weight 500, line-height 1.6, letter spacing 0
- `rgba(255, 255, 255, 0.84)` background
- 12 px blur with light saturation, including WebKit fallback
- 8 px radius, 1 px light border, restrained shadow
- 10 px by 16 px padding
- max-content width capped by both `maxWidthPct` and 16 px viewport gutters
- centered pre-wrapped text with anywhere overflow protection

Because Preview, Scene, and RuntimeHarness share `OverlayRuntime`, the treatment is consistent in all playback surfaces.

## Verification

- Compiler tests prove every actor's follow interval ends at its last subtitle end and hide starts there.
- Multi-actor tests prove concurrent follows overlap in time while retaining unique targets and routes.
- Adapter tests prove N entities produce N model tracks and legacy single-track scenes still parse.
- Dragger tests prove final drag/resize geometry and collisions are emitted.
- Overlay tests prove glass and width styles.
- Real DOCX flow must regenerate seven artifacts, persist a new Scene, and pass desktop Chromium checks for image, decoded video, 13 moving GLBs, unique routes, orientation changes, camera changes, visible separate model rows, and readable subtitle bounds.

