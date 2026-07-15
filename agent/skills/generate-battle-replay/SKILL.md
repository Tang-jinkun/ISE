---
name: generate-battle-replay
description: Convert a same-domain battle-review document into an evidence-linked EventPlan for geographic scene generation.
when-to-use: Use when the user uploads or references an air-combat review report and asks to extract, revise, or prepare replay events.
allowed-tools:
  - parse_battle_report
  - inspect_report_evidence
  - propose_event_plan
  - accept_event_plan
  - inspect_replay_assets
  - propose_scene_plan
  - compile_replay_runtime
  - validate_replay_runtime
user-invocable: true
model-invocable: true
execution: inline
version: 1.0.0
---

# Battle Replay Event Planning

Read the document through `parse_battle_report`. Inspect bounded evidence before selecting events.

Build 5 to 10 EventUnits when the document supports them. Each EventUnit must describe one complete world-state change, not a camera shot or editor command.

Use `evidenceRefs` for explicit source facts. Use `inferenceRefs` plus `uncertainties` when an interpretation is necessary. Never convert unverified counts, dialogue, equipment damage, hits, or victory claims into facts.

Submit the complete draft through `propose_event_plan`. Do not call `accept_event_plan` until the user has reviewed the exact draft version and fingerprint.

Keep preparation, engagement, withdrawal, and summary content proportional to the user's target duration. Omit repetitive background and record the omitted evidence IDs.

NarrativePlan contains evidence-linked subtitles and semantic scene requirements only.
Never invent asset IDs, playback timestamps, runtime commands, URLs, object names, or file paths.
Only deterministic tools may resolve assets, schedule playback, compile commands, and adapt SceneProjectConfig.
