import { z } from 'zod'
import type {
  AgentContext,
  AgentTool,
  Artifact,
  ArtifactInput,
} from '@ise/agent-core'
import {
  EVIDENCE_IR_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  EVENT_PLAN_DRAFT_ARTIFACT,
} from '../contracts/artifactTypes.ts'
import { eventPlanSchema, type EventPlan } from '../contracts/eventPlan.ts'
import { evidenceIrSchema, type EvidenceRecord } from '../contracts/evidence.ts'
import { fingerprint } from '../services/fingerprint.ts'

const acceptInputSchema = z.object({
  draftArtifactId: z.string().min(1),
  version: z.number().int().positive(),
  fingerprint: z.string().min(1),
}).strict()

const eventUnitInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'eventUnitId',
    'title',
    'worldStateChange',
    'participants',
    'locationRefs',
    'evidenceRefs',
    'inferenceRefs',
    'uncertainties',
    'narrativePurpose',
    'importance',
  ],
  properties: {
    eventUnitId: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    worldStateChange: { type: 'string', minLength: 1 },
    participants: { type: 'array', items: { type: 'string', minLength: 1 } },
    locationRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
    realWorldTime: { type: 'string', minLength: 1 },
    evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
    inferenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
    uncertainties: { type: 'array', items: { type: 'string' } },
    narrativePurpose: { type: 'string', minLength: 1 },
    importance: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
} as const

const proposeEventPlanInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'planId',
    'documentId',
    'version',
    'eventUnits',
    'omittedEvidence',
    'warnings',
  ],
  properties: {
    schemaVersion: { type: 'string', const: 'event-plan/v1' },
    planId: { type: 'string', minLength: 1 },
    documentId: { type: 'string', minLength: 1 },
    version: { type: 'integer', minimum: 1 },
    eventUnits: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: eventUnitInputSchema,
    },
    omittedEvidence: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const

const acceptEventPlanInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['draftArtifactId', 'version', 'fingerprint'],
  properties: {
    draftArtifactId: { type: 'string', minLength: 1 },
    version: { type: 'integer', minimum: 1 },
    fingerprint: { type: 'string', minLength: 1 },
  },
} as const

function activeEvidenceRecords(context: AgentContext, documentId: string): EvidenceRecord[] {
  const evidence = context.artifacts
    .list(EVIDENCE_IR_ARTIFACT)
    .map(artifact => evidenceIrSchema.parse(artifact.data))
    .filter(item => item.documentId === documentId)

  if (evidence.length === 0) {
    throw new Error(`No active EvidenceIR artifact found for document: ${documentId}`)
  }

  return evidence.flatMap(item => item.records)
}

function requireDraft(context: AgentContext, artifactId: string): Artifact<EventPlan> {
  const draft = context.artifacts.get(artifactId)
  if (!draft || draft.type !== EVENT_PLAN_DRAFT_ARTIFACT) {
    throw new Error(`EventPlan draft not found: ${artifactId}`)
  }

  return {
    ...draft,
    data: eventPlanSchema.parse(draft.data),
  }
}

function activeDraftForPlan(context: AgentContext, planId: string): Artifact<EventPlan> | undefined {
  const logicalKey = `event-plan:${planId}`
  const draft = context.artifacts
    .list(EVENT_PLAN_DRAFT_ARTIFACT)
    .find(artifact => artifact.logicalKey === logicalKey)
  if (!draft) return undefined

  return {
    ...draft,
    data: eventPlanSchema.parse(draft.data),
  }
}

export function createEventPlanTools(): AgentTool[] {
  const propose: AgentTool = {
    name: 'propose_event_plan',
    description: 'Validate a grounded EventPlan and create a reviewable draft artifact',
    inputSchema: proposeEventPlanInputSchema,
    risk: 'derive',
    async execute(input, context) {
      const plan = eventPlanSchema.parse(input)
      const predecessor = activeDraftForPlan(context, plan.planId)
      if (!predecessor && plan.version !== 1) {
        throw new Error(`First EventPlan draft version must be 1: ${plan.planId}`)
      }
      if (predecessor && plan.version !== predecessor.data.version + 1) {
        throw new Error(
          `EventPlan version must follow active version ${predecessor.data.version} ` +
          `with version ${predecessor.data.version + 1}: ${plan.planId}`,
        )
      }

      const evidenceRecords = activeEvidenceRecords(context, plan.documentId)
      const recordsById = new Map(evidenceRecords.map(record => [record.evidenceId, record]))
      const modelInferenceIds = new Set(
        evidenceRecords
          .filter(record => record.kind === 'model_inference')
          .map(record => record.evidenceId),
      )

      for (const unit of plan.eventUnits) {
        for (const evidenceRef of unit.evidenceRefs) {
          const evidence = recordsById.get(evidenceRef)
          if (!evidence) {
            throw new Error(`Unknown evidence reference: ${evidenceRef}`)
          }
          if (
            evidence.kind !== 'explicit_fact' &&
            evidence.kind !== 'deterministic_derivation'
          ) {
            throw new Error(`Evidence reference is not factual: ${evidenceRef}`)
          }
        }

        const hasUncertainty = unit.uncertainties.some(value => value.trim().length > 0)
        if (unit.inferenceRefs.length > 0 && !hasUncertainty) {
          throw new Error(
            `EventUnit with inference references requires uncertainty: ${unit.eventUnitId}`,
          )
        }
        for (const inferenceRef of unit.inferenceRefs) {
          if (modelInferenceIds.has(inferenceRef)) continue
          if (inferenceRef.startsWith('inference:')) {
            continue
          }
          throw new Error(`Invalid inference reference: ${inferenceRef}`)
        }
      }

      const planFingerprint = fingerprint(plan)
      const artifact: ArtifactInput<EventPlan> = {
        type: EVENT_PLAN_DRAFT_ARTIFACT,
        version: plan.version,
        createdBy: 'agent',
        logicalKey: `event-plan:${plan.planId}`,
        data: plan,
        metadata: {
          planId: plan.planId,
          documentId: plan.documentId,
          version: plan.version,
          fingerprint: planFingerprint,
          status: 'draft',
        },
      }

      return {
        content: JSON.stringify({
          planId: plan.planId,
          version: plan.version,
          fingerprint: planFingerprint,
        }),
        artifacts: [artifact],
      }
    },
  }

  const accept: AgentTool = {
    name: 'accept_event_plan',
    description: 'Accept the exact reviewed EventPlan draft tuple',
    inputSchema: acceptEventPlanInputSchema,
    risk: 'write',
    async execute(input, context) {
      const requested = acceptInputSchema.parse(input)
      const confirmationId = context.lastConsumedConfirmationId?.trim()
      if (!confirmationId) {
        throw new Error('accept_event_plan requires a trusted user confirmation binding')
      }
      const draft = requireDraft(context, requested.draftArtifactId)

      if (requested.version !== draft.data.version) {
        throw new Error(
          `Draft version mismatch: expected ${draft.data.version}, received ${requested.version}`,
        )
      }

      const storedFingerprint = draft.metadata?.fingerprint
      if (storedFingerprint !== requested.fingerprint) {
        throw new Error('Draft fingerprint mismatch')
      }
      if (fingerprint(draft.data) !== storedFingerprint) {
        throw new Error('Stored draft fingerprint does not match draft data')
      }

      const artifact: ArtifactInput<EventPlan> = {
        type: EVENT_PLAN_ACCEPTED_ARTIFACT,
        version: draft.data.version,
        createdBy: 'user',
        logicalKey: `accepted-event-plan:${draft.data.planId}`,
        data: draft.data,
        metadata: {
          planId: draft.data.planId,
          documentId: draft.data.documentId,
          version: draft.data.version,
          fingerprint: requested.fingerprint,
          acceptedDraftArtifactId: draft.id,
          confirmationId,
          status: 'accepted',
        },
      }

      return {
        content: JSON.stringify({
          planId: draft.data.planId,
          version: draft.data.version,
          fingerprint: requested.fingerprint,
          acceptedDraftArtifactId: draft.id,
        }),
        artifacts: [artifact],
      }
    },
  }

  return [propose, accept]
}
