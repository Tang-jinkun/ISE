import type { AgentContext, AgentTool, Artifact } from '@ise/agent-core'
import { EVENT_PLAN_ACCEPTED_ARTIFACT, NARRATIVE_PLAN_ARTIFACT } from '../contracts/artifactTypes.ts'
import { eventPlanSchema, type EventPlan } from '../contracts/eventPlan.ts'
import {
  narrativePlanInputJsonSchema,
  narrativePlanSchema,
  type NarrativePlan,
} from '../contracts/narrativePlan.ts'
import { fingerprint } from '../services/fingerprint.ts'

function requireAcceptedEventPlan(context: AgentContext, artifactId: string): Artifact<EventPlan> {
  const artifact = context.artifacts.get(artifactId)
  if (!artifact || artifact.type !== EVENT_PLAN_ACCEPTED_ARTIFACT || artifact.superseded) {
    throw new Error(`Accepted EventPlan not found: ${artifactId}`)
  }
  return { ...artifact, data: eventPlanSchema.parse(artifact.data) }
}

function assertExactAcceptedTuple(
  accepted: Artifact<EventPlan>,
  source: NarrativePlan['sourceEventPlan'],
): void {
  if (accepted.data.planId !== source.planId) throw new Error('Accepted EventPlan plan ID mismatch')
  if (accepted.data.version !== source.version || accepted.version !== source.version) {
    throw new Error('Accepted EventPlan version mismatch')
  }
  if (accepted.metadata?.fingerprint !== source.fingerprint || fingerprint(accepted.data) !== source.fingerprint) {
    throw new Error('Accepted EventPlan fingerprint mismatch')
  }
}

export function createScenePlanTools(): AgentTool[] {
  return [{
    name: 'propose_scene_plan',
    description: 'Validate a grounded NarrativePlan for an accepted EventPlan',
    risk: 'derive',
    inputSchema: narrativePlanInputJsonSchema,
    async execute(input, context) {
      const plan = narrativePlanSchema.parse(input)
      const accepted = requireAcceptedEventPlan(context, plan.sourceEventPlan.artifactId)
      assertExactAcceptedTuple(accepted, plan.sourceEventPlan)
      const units = new Map(accepted.data.eventUnits.map(unit => [unit.eventUnitId, unit]))
      for (const subtitle of plan.subtitles) {
        const unit = units.get(subtitle.eventUnitId)
        if (!unit) throw new Error(`Unknown EventUnit in NarrativePlan: ${subtitle.eventUnitId}`)
        const allowed = new Set(unit.evidenceRefs)
        if (subtitle.evidenceRefs.some(reference => !allowed.has(reference))) {
          throw new Error(`Narrative evidence is not linked: ${subtitle.subtitleId}`)
        }
      }
      for (const requirement of plan.sceneRequirements) {
        if (!units.has(requirement.eventUnitId)) {
          throw new Error(`Unknown EventUnit in scene requirement: ${requirement.eventUnitId}`)
        }
      }
      return {
        content: JSON.stringify({ narrativePlanId: plan.narrativePlanId }),
        artifacts: [{
          type: NARRATIVE_PLAN_ARTIFACT,
          createdBy: 'agent',
          logicalKey: `narrative-plan:${accepted.id}`,
          data: plan,
          metadata: { sourceEventPlan: plan.sourceEventPlan },
        }],
      }
    },
  }]
}
