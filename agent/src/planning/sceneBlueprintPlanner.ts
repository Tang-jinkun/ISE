import type { EvidenceIR } from '../contracts/evidence.ts'
import type { EventPlan, EventUnit } from '../contracts/eventPlan.ts'
import type { NarrationPlan } from '../contracts/narrationPlan.ts'
import type { NarrativePlan, SceneRequirement } from '../contracts/narrativePlan.ts'
import { sceneBlueprintSchema, type ActorGroup, type ActorGroupIntent, type SceneBlueprint } from '../contracts/sceneBlueprint.ts'
import { fingerprint } from '../services/fingerprint.ts'
import { selectScenarioPack } from '../services/scenarioPackRegistry.ts'
import { diagnostic } from '../services/runtimeDiagnostics.ts'
import { planActorGroups } from './semanticActorPlanner.ts'

export interface BuildSceneBlueprintInput { eventPlan: EventPlan; narrativePlan: NarrativePlan; narrationPlan: NarrationPlan; evidence: EvidenceIR }

function normalized(value: string): string { return value.normalize('NFKC').replace(/[\s\-_]+/g, '').toLocaleLowerCase('en-US') }
function includesAlias(value: string, aliases: readonly string[]): boolean { const text = normalized(value); return aliases.some(alias => text.includes(normalized(alias))) }
function slug(value: string): string { const ascii = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); return ascii || fingerprint(value).slice(7, 19) }
function actorRefsForUnit(unit: EventUnit, groups: ActorGroupIntent[]): string[] { return groups.filter(group => group.lifecycle === `event-scoped:${unit.eventUnitId}` || unit.participants.some(participant => includesAlias(participant, group.participantAliases))).map(group => group.groupId) }
function fidelity(actorRefs: string[], groups: ActorGroup[]): 'evidence' | 'deterministic' | 'default' | 'user' { const sources = actorRefs.map(ref => groups.find(group => group.groupId === ref)?.quantityDecision.source); return sources.includes('user') ? 'user' : sources.includes('default') ? 'default' : sources.length > 0 ? 'evidence' : 'deterministic' }
function requirements(plan: NarrativePlan): Map<string, SceneRequirement> { return new Map(plan.sceneRequirements.map(requirement => [requirement.eventUnitId, requirement])) }
function media(template: SceneRequirement['preferredTemplate'] | undefined): string[] { return template === 'deployment' || template === 'status_explanation' ? ['image'] : template === 'attack_chain' || template === 'electronic_warfare' || template === 'return_and_summary' ? ['video', 'image'] : ['interception', 'counterattack', 'withdrawal'].includes(template ?? '') ? ['video'] : [] }
function assertNarrationBinding(input: BuildSceneBlueprintInput): void { if (input.narrationPlan.sourceEventPlanId !== input.eventPlan.planId || input.narrationPlan.sourceEventPlanFingerprint !== fingerprint(input.eventPlan) || input.narrationPlan.sourceNarrativePlanId !== input.narrativePlan.narrativePlanId) throw new Error('SOURCE_NARRATION_PLAN_MISMATCH') }

export function buildSceneBlueprint(input: BuildSceneBlueprintInput): SceneBlueprint {
  assertNarrationBinding(input)
  const selection = selectScenarioPack(input.eventPlan, input.evidence); const pack = selection.pack
  const intents = planActorGroups({ eventPlan: input.eventPlan, evidence: input.evidence, pack })
  const groups: ActorGroup[] = intents.map(({ aliases: _aliases, participantAliases: _participants, evidenceRefs: _evidenceRefs, platformKind: _platformKind, diagnostics: _diagnostics, ...group }) => group)
  const units = new Map(input.eventPlan.eventUnits.map(unit => [unit.eventUnitId, unit])); const byEvent = requirements(input.narrativePlan)
  const hasImage = input.narrationPlan.beats.some(beat => media(byEvent.get(beat.eventUnitId)?.preferredTemplate).includes('image'))
  const sceneBeats = input.narrationPlan.beats.map((beat, index) => {
    const unit = units.get(beat.eventUnitId); if (!unit) throw new Error(`UNKNOWN_EVENT_UNIT: ${beat.eventUnitId}`)
    const requirement = byEvent.get(beat.eventUnitId); const mediaIntents = media(requirement?.preferredTemplate)
    if (!hasImage && index === input.narrationPlan.beats.length - 1) mediaIntents.push('image')
    const actorRefs = actorRefsForUnit(unit, intents)
    return { sceneBeatId: `scene-beat:${slug(beat.subtitleId)}`, subtitleId: beat.subtitleId, eventUnitId: beat.eventUnitId, purpose: unit.narrativePurpose, actorRefs, behaviorIntents: [...(requirement?.motionRequirements ?? [])], spatialConstraints: [...(requirement?.spatialRelations ?? [])], stateTransitions: [...(requirement?.stateChanges ?? [])], cameraIntent: requirement?.attentionRequirements[0] ?? `focus:${beat.attentionTarget}`, mediaIntents, requiredFacts: [...(requirement?.requiredFacts ?? [])], forbiddenClaims: [...(requirement?.forbiddenClaims ?? [])], fidelity: fidelity(actorRefs, groups), priority: beat.importance }
  })
  const diagnostics = [...selection.diagnostics, ...intents.flatMap(intent => intent.diagnostics), ...groups.flatMap(group => pack.actorProfiles.find(profile => profile.groupId === group.groupId)?.diagnostics.map(item => diagnostic(item.code, item.message, 'warning')) ?? [])].filter((item, index, items) => items.findIndex(candidate => candidate.code === item.code && candidate.message === item.message) === index)
  const narrationFingerprint = fingerprint(input.narrationPlan); const scenarioPack = { packId: pack.packId, version: pack.version }
  const identity = fingerprint({ sourceNarrationPlanId: input.narrationPlan.narrationPlanId, sourceNarrationFingerprint: narrationFingerprint, scenarioPack, actorGroups: groups, sceneBeats, diagnostics })
  return sceneBlueprintSchema.parse({ schemaVersion: 'ise.scene-blueprint/v1', blueprintId: `blueprint:${identity.slice(7, 23)}`, sourceNarrationPlanId: input.narrationPlan.narrationPlanId, sourceNarrationFingerprint: narrationFingerprint, scenarioPack, actorGroups: groups, sceneBeats, diagnostics })
}
