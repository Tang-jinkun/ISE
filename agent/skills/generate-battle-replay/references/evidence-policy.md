# Evidence Policy

## Explicit fact

An explicit fact must quote a claim from the report and retain that claim's `sourceRef`. Put its EvidenceIR ID in `evidenceRefs`; do not strengthen or complete the wording.

Example:

- Quoted claim: “行动开始后，印方多个航空兵基地先后进入出动状态。”
- sourceRef: `doc:doc-943504a71482656a:paragraph:11`
- Allowed fact: “印方多个航空兵基地进入出动状态。”

This quote supports the change in readiness state only. It does not establish aircraft counts, equipment condition, damage, or victory.

## Deterministic derivation

A deterministic derivation normalizes explicit facts without adding a new factual claim. Relative ordering, such as event B following event A, is allowed only when the cited source refs establish that ordering. Preserve every source ref used by the derivation.

Example:

- Input source refs: `doc:doc-943504a71482656a:paragraph:11` and `doc:doc-943504a71482656a:paragraph:12`.
- The first says the Indian bases entered sortie status; the second says Pakistan organized takeoff after detecting the Indian formation activity.
- Derived normalization: “印方进入出动状态后，巴方组织前线航空兵升空。”

This is relative-order normalization from the cited statements. It does not supply an unreported clock time or causal mechanism.

## Model inference

A model inference is an interpretation rather than a report fact. Put its reference in `inferenceRefs`, mark the interpretation explicitly uncertain, and add a concrete entry to `uncertainties`. Never move an inference into `evidenceRefs`.

Example:

- Source: `doc:doc-943504a71482656a:paragraph:18` states that target tracking was restored, but does not identify the technical cause.
- Interpretation: “备用通信或数据转发可能参与了目标跟踪恢复。”
- inferenceRefs: `inference:tracking-recovery-cause`
- uncertainties: “报告未说明目标跟踪恢复的具体技术原因。”

The interpretation must remain uncertain and must not be presented as a quoted report finding.

## Illustrative expression

An illustrative expression is a non-factual presentation choice, such as an approximate route or camera choice. It must never appear as a report fact, and it must not be used to claim a location, maneuver, hit, damage state, or result that the report does not support.

Examples:

- Illustrative route: draw a smooth arc between a named base and the reported interception area for scene continuity. This is a display choice and must not be written as the aircraft's actual route.
- Camera choice: use a high oblique view to keep both formations legible. This is not a report fact and must not appear in `evidenceRefs`.

## Negative examples

The following current SRT mistakes are prohibited as report facts unless explicit evidence supports the exact claim:

- invented pilot dialogue;
- `XX` quantities or any other unverified count;
- “准确命中”;
- “全面溃败”;
- equipment naming that conflicts with registered assets.

Also do not factualize unverified equipment damage, hits, or victory claims. Keep them omitted or represent a necessary interpretation with `inferenceRefs` and matching `uncertainties`.
