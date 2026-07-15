import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AgentContext, AgentTool, Artifact } from '@ise/agent-core'
import { sceneProjectConfigSchema } from '@ise/runtime-contracts'
import { BaseRuntimeAdapter } from '../adapters/baseRuntimeAdapter.ts'
import { capabilityManifest } from '../compiler/capabilityManifest.ts'
import { compileScene } from '../compiler/sceneCompiler.ts'
import {
  ASSET_REGISTRY_ARTIFACT,
  COMPILED_RUNTIME_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  NARRATIVE_PLAN_ARTIFACT,
  type CompiledRuntimeArtifactData,
} from '../contracts/artifactTypes.ts'
import { assetRegistrySnapshotSchema } from '../contracts/assetRegistry.ts'
import { eventPlanSchema } from '../contracts/eventPlan.ts'
import { narrativePlanSchema } from '../contracts/narrativePlan.ts'
import { canonicalRuntimePlanSchema } from '../contracts/runtimePlan.ts'
import { fingerprint } from '../services/fingerprint.ts'
import { validateCompiledRuntimeArtifact } from '../services/compiledRuntimeArtifact.ts'

export interface CompileProgressPayload {
  stage: 'narrative' | 'assets' | 'schedule' | 'validate' | 'adapt'
  percentage: 10 | 30 | 60 | 85 | 100
}

export interface CompilerToolOptions {
  onCompileProgress?: (payload: CompileProgressPayload) => void
}

const compileInputSchema = z.strictObject({
  eventPlanArtifactId: z.string().min(1),
  narrativePlanArtifactId: z.string().min(1),
  assetRegistryArtifactId: z.string().min(1),
  capabilityManifestVersion: z.literal('ise-capabilities/v1'),
  assetRegistryVersion: z.string().regex(/^sha256:[0-9a-f]{64}$/),
})
const validateInputSchema = z.strictObject({ artifactId: z.string().min(1) })

function requireArtifact(context: AgentContext, id: string, type: string): Artifact {
  const artifact = context.artifacts.get(id)
  if (!artifact || artifact.type !== type || artifact.superseded) throw new Error(`Required artifact not found: ${id}`)
  return artifact
}

export function createCompilerTools(options: CompilerToolOptions = {}): AgentTool[] {
  const compile: AgentTool = {
    name: 'compile_replay_runtime',
    description: 'Deterministically compile accepted replay artifacts into a validated scene configuration',
    risk: 'derive',
    inputSchema: z.toJSONSchema(compileInputSchema, { target: 'draft-2020-12' }),
    async execute(input, context) {
      const requested = compileInputSchema.parse(input)
      options.onCompileProgress?.({ stage: 'narrative', percentage: 10 })
      const acceptedArtifact = requireArtifact(context, requested.eventPlanArtifactId, EVENT_PLAN_ACCEPTED_ARTIFACT)
      const eventPlan = eventPlanSchema.parse(acceptedArtifact.data)
      const acceptedFingerprint = acceptedArtifact.metadata?.fingerprint
      if (typeof acceptedFingerprint !== 'string' || fingerprint(eventPlan) !== acceptedFingerprint) {
        throw new Error('Accepted EventPlan fingerprint mismatch')
      }
      const narrativeArtifact = requireArtifact(context, requested.narrativePlanArtifactId, NARRATIVE_PLAN_ARTIFACT)
      const narrativePlan = narrativePlanSchema.parse(narrativeArtifact.data)
      if (
        narrativePlan.sourceEventPlan.artifactId !== acceptedArtifact.id
        || narrativePlan.sourceEventPlan.planId !== eventPlan.planId
        || narrativePlan.sourceEventPlan.version !== eventPlan.version
        || narrativePlan.sourceEventPlan.fingerprint !== acceptedFingerprint
      ) throw new Error('NarrativePlan source EventPlan mismatch')
      options.onCompileProgress?.({ stage: 'assets', percentage: 30 })
      const registryArtifact = requireArtifact(context, requested.assetRegistryArtifactId, ASSET_REGISTRY_ARTIFACT)
      const assetRegistry = assetRegistrySnapshotSchema.parse(registryArtifact.data)
      if (assetRegistry.registryVersion !== requested.assetRegistryVersion) throw new Error('AssetRegistry version mismatch')
      if (requested.capabilityManifestVersion !== capabilityManifest.version) throw new Error('CapabilityManifest version mismatch')
      options.onCompileProgress?.({ stage: 'schedule', percentage: 60 })
      const runtimePlan = canonicalRuntimePlanSchema.parse(compileScene({
        eventPlanArtifactId: acceptedArtifact.id,
        narrativePlanArtifactId: narrativeArtifact.id,
        assetRegistryArtifactId: registryArtifact.id,
        eventPlan,
        narrativePlan,
        assetRegistry,
      }))
      options.onCompileProgress?.({ stage: 'validate', percentage: 85 })
      const artifactId = randomUUID()
      const sceneProjectConfig = sceneProjectConfigSchema.parse(new BaseRuntimeAdapter().adapt(runtimePlan, artifactId))
      options.onCompileProgress?.({ stage: 'adapt', percentage: 100 })
      const data: CompiledRuntimeArtifactData = { runtimePlan, sceneProjectConfig }
      return {
        content: JSON.stringify({ artifactId, valid: true, diagnostics: runtimePlan.diagnostics }),
        artifacts: [{
          id: artifactId,
          type: COMPILED_RUNTIME_ARTIFACT,
          createdBy: 'tool',
          logicalKey: `compiled-runtime:${acceptedArtifact.id}`,
          data,
          metadata: {
            eventPlanArtifactId: acceptedArtifact.id,
            narrativePlanArtifactId: narrativeArtifact.id,
            assetRegistryArtifactId: registryArtifact.id,
            capabilityManifestVersion: capabilityManifest.version,
            assetRegistryVersion: assetRegistry.registryVersion,
          },
        }],
      }
    },
  }

  const validate: AgentTool = {
    name: 'validate_replay_runtime',
    description: 'Reparse a stored compiled runtime artifact without repairing it',
    risk: 'read',
    isConcurrencySafe: true,
    inputSchema: z.toJSONSchema(validateInputSchema, { target: 'draft-2020-12' }),
    async execute(input, context) {
      const requested = validateInputSchema.parse(input)
      const artifact = requireArtifact(context, requested.artifactId, COMPILED_RUNTIME_ARTIFACT)
      const { runtimePlan } = validateCompiledRuntimeArtifact(artifact)
      return { content: JSON.stringify({ valid: true, artifactId: artifact.id, diagnostics: runtimePlan.diagnostics }) }
    },
  }
  return [compile, validate]
}
