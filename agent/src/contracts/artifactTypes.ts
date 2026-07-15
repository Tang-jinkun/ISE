export const DOCUMENT_IR_ARTIFACT = 'ise.document-ir/v1'
export const EVIDENCE_IR_ARTIFACT = 'ise.evidence-ir/v1'
export const EVENT_PLAN_DRAFT_ARTIFACT = 'ise.event-plan-draft/v1'
export const EVENT_PLAN_ACCEPTED_ARTIFACT = 'ise.event-plan-accepted/v1'
export const NARRATIVE_PLAN_ARTIFACT = 'ise.narrative-plan/v1' as const
export const ASSET_REGISTRY_ARTIFACT = 'ise.asset-registry/v1' as const
export const COMPILED_RUNTIME_ARTIFACT = 'ise.canonical-runtime-plan/v1' as const

import type { SceneProjectConfig } from '@ise/runtime-contracts'
import type { CanonicalRuntimePlan } from './runtimePlan.ts'

export type CompiledRuntimeArtifactData = {
  runtimePlan: CanonicalRuntimePlan
  sceneProjectConfig: SceneProjectConfig
}
