import type { EventPlan } from '../contracts/eventPlan.ts'
import {
  narrationPlanSchema,
  type NarrationBeat,
  type NarrationPlan,
} from '../contracts/narrationPlan.ts'
import type { NarrativePlan, TemplateName } from '../contracts/narrativePlan.ts'
import { fingerprint } from '../services/fingerprint.ts'

export interface BuildNarrationPlanInput {
  eventPlan: EventPlan
  narrativePlan: NarrativePlan
}

const templateBeatRoles: Partial<Record<TemplateName, NarrationBeat['beatRole']>> = {
  deployment: 'setup',
  attack_chain: 'action',
  interception: 'action',
  electronic_warfare: 'action',
  counterattack: 'turning_point',
  withdrawal: 'result',
  return_and_summary: 'summary',
  generic_movement: 'transition',
  status_explanation: 'setup',
}

export function estimatedNarrationDurationMs(text: string, importance: NarrationBeat['importance']): number {
  const hanCharacters = [...text].filter(character => /\p{Script=Han}/u.test(character)).length
  const spokenMs = Math.ceil(hanCharacters / 4) * 1_000
  const observationMs = importance === 'high' ? 2_000 : importance === 'medium' ? 1_000 : 0
  return Math.max(4_000, spokenMs) + observationMs
}

export function minimumNarrativeDurationMs(
  eventPlan: EventPlan,
  narrativePlan: NarrativePlan,
  requiredPostRollMs: number,
): number {
  const narrationDurationMs = narrativePlan.subtitles.reduce(
    (total, subtitle) => total + estimatedNarrationDurationMs(subtitle.text, subtitle.importance),
    0,
  )
  const transitionDurationMs = Math.max(0, eventPlan.eventUnits.length - 1) * 1_000
  return narrationDurationMs + transitionDurationMs + requiredPostRollMs
}

function assertSourceBinding(eventPlan: EventPlan, narrativePlan: NarrativePlan): void {
  const source = narrativePlan.sourceEventPlan
  const expectedFingerprint = fingerprint(eventPlan)
  if (
    source.planId !== eventPlan.planId
    || source.version !== eventPlan.version
    || source.fingerprint !== expectedFingerprint
  ) {
    throw new Error(`SOURCE_EVENT_PLAN_MISMATCH: ${source.artifactId}`)
  }
}

export function buildNarrationPlan(input: BuildNarrationPlanInput): NarrationPlan {
  assertSourceBinding(input.eventPlan, input.narrativePlan)
  const eventUnits = new Map(input.eventPlan.eventUnits.map(unit => [unit.eventUnitId, unit]))
  const requirements = new Map(input.narrativePlan.sceneRequirements.map(requirement => [requirement.eventUnitId, requirement]))

  const beats = input.narrativePlan.subtitles.flatMap((subtitle, index) => {
    const eventUnit = eventUnits.get(subtitle.eventUnitId)
    if (!eventUnit || subtitle.evidenceRefs.some(ref => !eventUnit.evidenceRefs.includes(ref))) return []
    const requirement = requirements.get(subtitle.eventUnitId)
    const fallbackRole: NarrationBeat['beatRole'] = index === 0
      ? 'setup'
      : index === input.narrativePlan.subtitles.length - 1 ? 'summary' : 'action'
    return [{
      subtitleId: subtitle.subtitleId,
      eventUnitId: subtitle.eventUnitId,
      text: subtitle.text,
      evidenceRefs: [...subtitle.evidenceRefs],
      beatRole: requirement?.preferredTemplate
        ? templateBeatRoles[requirement.preferredTemplate] ?? fallbackRole
        : fallbackRole,
      attentionTarget: requirement?.focusEntities[0] ?? eventUnit.participants[0] ?? eventUnit.title,
      importance: subtitle.importance,
      estimatedDurationMs: estimatedNarrationDurationMs(subtitle.text, subtitle.importance),
    } satisfies NarrationBeat]
  })

  if (beats.length === 0) throw new Error('NO_GROUNDED_NARRATION_BEATS')
  const identity = fingerprint({
    sourceEventPlanId: input.eventPlan.planId,
    sourceEventPlanFingerprint: input.narrativePlan.sourceEventPlan.fingerprint,
    sourceNarrativePlanId: input.narrativePlan.narrativePlanId,
    beats,
  })
  return narrationPlanSchema.parse({
    schemaVersion: 'ise.narration-plan/v1',
    narrationPlanId: `narration:${identity.slice('sha256:'.length, 'sha256:'.length + 16)}`,
    sourceEventPlanId: input.eventPlan.planId,
    sourceEventPlanFingerprint: input.narrativePlan.sourceEventPlan.fingerprint,
    sourceNarrativePlanId: input.narrativePlan.narrativePlanId,
    beats,
    diagnostics: [],
  })
}
