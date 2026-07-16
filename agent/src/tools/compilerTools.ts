import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AgentContext, AgentTool, Artifact, ArtifactInput } from '@ise/agent-core'
import { BaseRuntimeAdapter } from '../adapters/baseRuntimeAdapter.ts'
import { capabilityManifest } from '../compiler/capabilityManifest.ts'
import { compileScene } from '../compiler/sceneCompiler.ts'
import {
  ASSET_REGISTRY_ARTIFACT,
  COMPILED_RUNTIME_ARTIFACT,
  EVIDENCE_IR_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  NARRATION_PLAN_ARTIFACT,
  NARRATIVE_PLAN_ARTIFACT,
  RESOLVED_SCENE_PLAN_ARTIFACT,
  SCENE_BLUEPRINT_ARTIFACT,
  type CompiledRuntimeArtifactData,
} from '../contracts/artifactTypes.ts'
import { assetRegistrySnapshotSchema } from '../contracts/assetRegistry.ts'
import { evidenceIrSchema } from '../contracts/evidence.ts'
import { eventPlanSchema } from '../contracts/eventPlan.ts'
import { narrativePlanSchema } from '../contracts/narrativePlan.ts'
import { canonicalRuntimePlanSchema, type CanonicalRuntimePlan } from '../contracts/runtimePlan.ts'
import { buildNarrationPlan } from '../planning/narrationPlanner.ts'
import { resolveSceneBlueprint } from '../planning/resolveSceneBlueprint.ts'
import { buildSceneBlueprint } from '../planning/sceneBlueprintPlanner.ts'
import { fingerprint } from '../services/fingerprint.ts'
import {
  CompiledArtifactInvalidError,
  validateCompiledRuntimeArtifact,
} from '../services/compiledRuntimeArtifact.ts'

export interface CompileProgressPayload {
  stage: 'narrative' | 'assets' | 'schedule' | 'validate' | 'adapt'
  percentage: 10 | 30 | 60 | 85 | 100
}

export interface CompilerToolOptions {
  onCompileProgress?: (payload: CompileProgressPayload) => void
  adaptRuntimePlan?: (runtimePlan: CanonicalRuntimePlan, artifactId: string) => unknown
  onCompiledArtifactInvalid?: () => void
}

const compileInputSchema = z.strictObject({
  eventPlanArtifactId: z.string().min(1),
  evidenceArtifactId: z.string().min(1),
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
      const evidenceArtifact = requireArtifact(context, requested.evidenceArtifactId, EVIDENCE_IR_ARTIFACT)
      const evidence = evidenceIrSchema.parse(evidenceArtifact.data)
      if (evidence.documentId !== eventPlan.documentId) throw new Error('EvidenceIR source document mismatch')
      options.onCompileProgress?.({ stage: 'assets', percentage: 30 })
      const registryArtifact = requireArtifact(context, requested.assetRegistryArtifactId, ASSET_REGISTRY_ARTIFACT)
      const assetRegistry = assetRegistrySnapshotSchema.parse(registryArtifact.data)
      if (assetRegistry.registryVersion !== requested.assetRegistryVersion) throw new Error('AssetRegistry version mismatch')
      if (requested.capabilityManifestVersion !== capabilityManifest.version) throw new Error('CapabilityManifest version mismatch')
      const narrationPlan = buildNarrationPlan({ eventPlan, narrativePlan })
      const sceneBlueprint = buildSceneBlueprint({ eventPlan, narrativePlan, narrationPlan, evidence })
      const resolvedScenePlan = resolveSceneBlueprint({ blueprint: sceneBlueprint, assetRegistry })
      const narrationArtifactId = randomUUID()
      const sceneBlueprintArtifactId = randomUUID()
      const resolvedScenePlanArtifactId = randomUUID()
      const narrationArtifact = {
        id: narrationArtifactId,
        type: NARRATION_PLAN_ARTIFACT,
        createdBy: 'tool' as const,
        logicalKey: `narration-plan:${narrationPlan.narrationPlanId}`,
        data: narrationPlan,
        metadata: {
          fingerprint: fingerprint(narrationPlan),
          eventPlanArtifactId: acceptedArtifact.id,
          narrativePlanArtifactId: narrativeArtifact.id,
          lineage: [acceptedArtifact.id, narrativeArtifact.id],
        },
      } satisfies ArtifactInput<typeof narrationPlan> & { id: string }
      const sceneBlueprintArtifact = {
        id: sceneBlueprintArtifactId,
        type: SCENE_BLUEPRINT_ARTIFACT,
        createdBy: 'tool' as const,
        logicalKey: `scene-blueprint:${sceneBlueprint.blueprintId}`,
        data: sceneBlueprint,
        metadata: {
          fingerprint: fingerprint(sceneBlueprint),
          narrationPlanArtifactId: narrationArtifactId,
          evidenceArtifactId: evidenceArtifact.id,
          lineage: [narrationArtifactId, evidenceArtifact.id],
        },
      } satisfies ArtifactInput<typeof sceneBlueprint> & { id: string }
      const resolvedSceneArtifact = {
        id: resolvedScenePlanArtifactId,
        type: RESOLVED_SCENE_PLAN_ARTIFACT,
        createdBy: 'tool' as const,
        logicalKey: `resolved-scene-plan:${resolvedScenePlan.resolvedScenePlanId}`,
        data: resolvedScenePlan,
        metadata: {
          fingerprint: fingerprint(resolvedScenePlan),
          sceneBlueprintArtifactId,
          assetRegistryArtifactId: registryArtifact.id,
          trajectoryCatalogFingerprint: resolvedScenePlan.trajectoryCatalogFingerprint,
          scenarioMappingFingerprint: resolvedScenePlan.scenarioMappingFingerprint,
          lineage: [sceneBlueprintArtifactId, registryArtifact.id],
        },
      } satisfies ArtifactInput<typeof resolvedScenePlan> & { id: string }
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
      const adapted = options.adaptRuntimePlan
        ? options.adaptRuntimePlan(runtimePlan, artifactId)
        : new BaseRuntimeAdapter().adapt(runtimePlan, artifactId)
      const candidate = {
        id: artifactId,
        type: COMPILED_RUNTIME_ARTIFACT,
        createdBy: 'tool' as const,
        logicalKey: `compiled-runtime:${acceptedArtifact.id}`,
        data: { runtimePlan, sceneProjectConfig: adapted },
        metadata: {
          eventPlanArtifactId: acceptedArtifact.id,
          evidenceArtifactId: evidenceArtifact.id,
          narrativePlanArtifactId: narrativeArtifact.id,
          narrationPlanArtifactId: narrationArtifactId,
          sceneBlueprintArtifactId,
          resolvedScenePlanArtifactId,
          assetRegistryArtifactId: registryArtifact.id,
          capabilityManifestVersion: capabilityManifest.version,
          assetRegistryVersion: assetRegistry.registryVersion,
        },
      }
      let data: CompiledRuntimeArtifactData
      try {
        data = validateCompiledRuntimeArtifact(candidate, acceptedArtifact.id)
      } catch (error) {
        if (error instanceof CompiledArtifactInvalidError) options.onCompiledArtifactInvalid?.()
        throw error
      }
      const artifact = { ...candidate, data } satisfies ArtifactInput<CompiledRuntimeArtifactData> & { id: string }
      options.onCompileProgress?.({ stage: 'adapt', percentage: 100 })
      return {
        content: JSON.stringify({ artifactId, valid: true, diagnostics: runtimePlan.diagnostics }),
        artifacts: [narrationArtifact, sceneBlueprintArtifact, resolvedSceneArtifact, artifact],
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
