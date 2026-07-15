import type { Artifact } from '@ise/agent-core'
import { sceneProjectConfigSchema } from '@ise/runtime-contracts'
import {
  COMPILED_RUNTIME_ARTIFACT,
  type CompiledRuntimeArtifactData,
} from '../contracts/artifactTypes.ts'
import { canonicalRuntimePlanSchema } from '../contracts/runtimePlan.ts'

export type CompiledRuntimeArtifactCandidate = Pick<Artifact, 'id' | 'type' | 'data' | 'metadata'>

export class CompiledArtifactInvalidError extends Error {
  readonly code = 'COMPILED_ARTIFACT_INVALID'

  constructor() {
    super('COMPILED_ARTIFACT_INVALID')
    this.name = 'CompiledArtifactInvalidError'
  }
}

function invalid(): never {
  throw new CompiledArtifactInvalidError()
}

export function validateCompiledRuntimeArtifact(
  artifact: CompiledRuntimeArtifactCandidate,
  expectedAcceptedArtifactId?: string,
): CompiledRuntimeArtifactData {
  if (artifact.type !== COMPILED_RUNTIME_ARTIFACT || !artifact.data || typeof artifact.data !== 'object') invalid()
  const data = artifact.data as Record<string, unknown>
  const runtimePlanResult = canonicalRuntimePlanSchema.safeParse(data.runtimePlan)
  const sceneProjectConfigResult = sceneProjectConfigSchema.safeParse(data.sceneProjectConfig)
  if (!runtimePlanResult.success || !sceneProjectConfigResult.success) invalid()

  const runtimePlan = runtimePlanResult.data
  const sceneProjectConfig = sceneProjectConfigResult.data
  const acceptedArtifactId = runtimePlan.eventPlanArtifactId
  if (
    sceneProjectConfig.runtimePlanArtifactId !== artifact.id
    || sceneProjectConfig.eventPlanArtifactId !== acceptedArtifactId
    || artifact.metadata?.eventPlanArtifactId !== acceptedArtifactId
    || (expectedAcceptedArtifactId !== undefined && expectedAcceptedArtifactId !== acceptedArtifactId)
  ) invalid()

  return { runtimePlan, sceneProjectConfig }
}
