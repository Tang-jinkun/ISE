import type { EvidenceIR, EvidenceRecord } from '../contracts/evidence.ts'
import type { EventPlan, EventUnit } from '../contracts/eventPlan.ts'
import type { NarrationPlan } from '../contracts/narrationPlan.ts'
import type { NarrativePlan, SceneRequirement } from '../contracts/narrativePlan.ts'
import type { ScenarioActorProfile, ScenarioPack } from '../contracts/scenarioPack.ts'
import { sceneBlueprintSchema, type ActorGroup, type SceneBlueprint } from '../contracts/sceneBlueprint.ts'
import { fingerprint } from '../services/fingerprint.ts'
import { selectScenarioPack } from '../services/scenarioPackRegistry.ts'
import { diagnostic } from '../services/runtimeDiagnostics.ts'
import { resolveQuantity } from './quantityResolver.ts'

export interface BuildSceneBlueprintInput { eventPlan: EventPlan; narrativePlan: NarrativePlan; narrationPlan: NarrationPlan; evidence: EvidenceIR }

function normalized(value: string): string { return value.normalize('NFKC').replace(/[\s\-_]+/g, '').toLocaleLowerCase('en-US') }
function includesAlias(value: string, aliases: readonly string[]): boolean { const text = normalized(value); return aliases.some(alias => text.includes(normalized(alias))) }
function recordText(record: EvidenceRecord): string { return [record.claim, record.locationExpression ?? '', ...record.entities].join('|') }
function factualRecords(evidence: EvidenceIR): EvidenceRecord[] { return evidence.records.filter(record => record.kind === 'explicit_fact' || record.kind === 'deterministic_derivation') }
function scopedEvidence(evidence: EvidenceIR, records: EvidenceRecord[]): EvidenceIR { return { ...evidence, records } }
function slug(value: string): string { const ascii = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); return ascii || fingerprint(value).slice(7, 19) }

function profileRecords(profile: ScenarioActorProfile, linkedIds: Set<string>, evidence: EvidenceIR): EvidenceRecord[] {
  return factualRecords(evidence).filter(record => (!profile.linkedEvidenceOnly || linkedIds.has(record.evidenceId))
    && includesAlias(recordText(record), [...profile.aliases, ...profile.sharedEvidenceAliases]))
}

function profileLocation(profile: ScenarioActorProfile, records: EvidenceRecord[]): string | undefined {
  if (profile.locationAliases.length === 0) return profile.locationRef
  const record = records.find(candidate => includesAlias(recordText(candidate), profile.locationAliases))
  return record === undefined ? undefined : profile.locationAliases.find(alias => includesAlias(recordText(record), [alias]))
}

function persistentGroups(eventPlan: EventPlan, evidence: EvidenceIR, pack: ScenarioPack): ActorGroup[] {
  const linkedIds = new Set(eventPlan.eventUnits.flatMap(unit => unit.evidenceRefs))
  return pack.actorProfiles.flatMap(profile => {
    const records = profileRecords(profile, linkedIds, evidence)
    const locationRef = profileLocation(profile, records)
    if (records.length === 0 || locationRef === undefined) return []
    const locationRecords = profile.locationAliases.length === 0
      ? records
      : records.filter(record => includesAlias(recordText(record), profile.locationAliases))
    return [{
      groupId: profile.groupId, semanticEntityRef: profile.semanticEntityRef, side: profile.factionId, locationRef,
      platformType: profile.platformType, role: profile.role,
      quantityDecision: resolveQuantity({ entityName: profile.semanticEntityRef, entityAliases: profile.aliases, platformType: profile.role === 'fighter-formation' ? 'fighter' : profile.platformType, role: profile.role, evidence: scopedEvidence(evidence, locationRecords) }),
      formationPattern: profile.formationPattern, leaderPolicy: profile.leaderPolicy, behaviorProfile: profile.behaviorProfile, lifecycle: 'scene-persistent',
    } satisfies ActorGroup]
  })
}

function completedLaunch(value: string): boolean {
  if (/\b(?:did\s+not|didn't|not)\s+(?:launch(?:ed|ing)?|fire(?:d|ing)?)\b|\b(?:was|were|is|are|be|been|being)\s+(?:not|never)\s+(?:launch(?:ed|ing)?|fire(?:d|ing)?)\b|\bfailed\s+to\s+(?:launch|fire)\b|\b(?:launch|fire)\b\s+(?:was\s+)?(?:cancelled|canceled|aborted)\b|未发射|没有发射|取消发射|中止发射|发射取消|发射中止/iu.test(value)) return false
  if (/发射准备|准备发射|计划发射|授权发射|发射阵位|火控开启|预发射|pre[-\s]?launch|fire[-\s]?control|\bprepare(?:d|s|ing)?\b|\bplan(?:ned|s|ning)?\b|\bauthori[sz](?:e|ed|es|ing|ation)?\b/iu.test(value)) return false
  return /\blaunch(?:es|ed|ing)?\b|\bfire(?:s|d|ing)?\b|发射/iu.test(value)
}
function weaponEntity(records: EvidenceRecord[]): string { return records.flatMap(record => record.entities).find(entity => /\b(?:pl|aim|r)[-]?\d+[a-z0-9-]*/iu.test(entity)) ?? records.map(recordText).join('|').match(/\b(?:pl|aim|r)[-]?\d+[a-z0-9-]*/iu)?.[0] ?? 'missile' }
function weaponFaction(unit: EventUnit, records: EvidenceRecord[], pack: ScenarioPack): string {
  for (const text of [...records.map(record => record.claim), unit.worldStateChange]) {
    const index = text.search(/\blaunch(?:es|ed|ing)?\b|\bfire(?:s|d|ing)?\b|发射/iu); if (index < 0) continue
    const prefix = text.slice(0, index)
    if (/\b(?:was|were|is|are|be|been|being)\s*$/iu.test(prefix) || /被[^。；，]{0,40}$/u.test(prefix)) continue
    const candidates = pack.actorProfiles.flatMap(profile => profile.aliases.map(alias => ({ factionId: profile.factionId, alias, index: text.toLocaleLowerCase('en-US').lastIndexOf(alias.toLocaleLowerCase('en-US'), index) })))
      .concat(pack.factions.flatMap(faction => faction.aliases.map(alias => ({ factionId: faction.factionId, alias, index: text.toLocaleLowerCase('en-US').lastIndexOf(alias.toLocaleLowerCase('en-US'), index) }))))
      .filter(candidate => candidate.index >= 0)
      .filter(candidate => !/\b(?:and|before|after|while|then|engage(?:d|s|ment)?)\b|\b(?:a|the)\s+missile\b/iu.test(text.slice(candidate.index + candidate.alias.length, index)))
      .sort((left, right) => right.index - left.index)
    if (candidates[0] !== undefined) return candidates[0].factionId
  }
  return 'unknown'
}
function weaponBehavior(unit: EventUnit, records: EvidenceRecord[], factionId: string, pack: ScenarioPack): string {
  const text = [unit.worldStateChange, ...records.map(recordText)].join('|')
  const candidates = pack.weaponBehaviorProfiles.filter(profile => profile.factionId === factionId)
  const matched = candidates.filter(profile => profile.matchTerms.length > 0 && profile.matchTerms.some(term => includesAlias(text, [term])))
  return matched.length === 1 ? matched[0]!.behaviorProfile : candidates.find(profile => profile.matchTerms.length === 0)?.behaviorProfile ?? 'weapon-launch/v1'
}
function weaponGroups(eventPlan: EventPlan, evidence: EvidenceIR, pack: ScenarioPack): ActorGroup[] {
  return eventPlan.eventUnits.flatMap(unit => {
    const records = factualRecords(evidence).filter(record => unit.evidenceRefs.includes(record.evidenceId) && completedLaunch(record.claim))
    if (records.length === 0 || !completedLaunch(unit.worldStateChange)) return []
    const semanticEntityRef = weaponEntity(records); const side = weaponFaction(unit, records, pack)
    return [{ groupId: `group:weapon-${slug(unit.eventUnitId)}`, semanticEntityRef, side, locationRef: unit.locationRefs[0] ?? 'location:unspecified', platformType: semanticEntityRef, role: 'weapon-launch', quantityDecision: resolveQuantity({ entityName: semanticEntityRef, platformType: 'weapon', role: 'launch', evidence: scopedEvidence(evidence, records) }), formationPattern: 'single', leaderPolicy: 'single-member', behaviorProfile: weaponBehavior(unit, records, side, pack), lifecycle: `event-scoped:${unit.eventUnitId}` } satisfies ActorGroup]
  })
}
function actorRefsForUnit(unit: EventUnit, groups: ActorGroup[], pack: ScenarioPack): string[] { return groups.filter(group => {
  if (group.lifecycle === `event-scoped:${unit.eventUnitId}`) return true
  const profile = pack.actorProfiles.find(candidate => candidate.groupId === group.groupId)
  const aliases = profile?.participantAliases ?? [group.semanticEntityRef]
  return unit.participants.some(participant => includesAlias(participant, aliases))
}).map(group => group.groupId) }
function fidelity(actorRefs: string[], groups: ActorGroup[]): 'evidence' | 'deterministic' | 'default' | 'user' { const sources = actorRefs.map(ref => groups.find(group => group.groupId === ref)?.quantityDecision.source); return sources.includes('user') ? 'user' : sources.includes('default') ? 'default' : sources.length > 0 ? 'evidence' : 'deterministic' }
function requirements(plan: NarrativePlan): Map<string, SceneRequirement> { return new Map(plan.sceneRequirements.map(requirement => [requirement.eventUnitId, requirement])) }
function media(template: SceneRequirement['preferredTemplate'] | undefined): string[] { return template === 'deployment' || template === 'status_explanation' ? ['image'] : template === 'attack_chain' || template === 'electronic_warfare' || template === 'return_and_summary' ? ['video', 'image'] : ['interception', 'counterattack', 'withdrawal'].includes(template ?? '') ? ['video'] : [] }
function assertNarrationBinding(input: BuildSceneBlueprintInput): void { if (input.narrationPlan.sourceEventPlanId !== input.eventPlan.planId || input.narrationPlan.sourceEventPlanFingerprint !== fingerprint(input.eventPlan) || input.narrationPlan.sourceNarrativePlanId !== input.narrativePlan.narrativePlanId) throw new Error('SOURCE_NARRATION_PLAN_MISMATCH') }

export function buildSceneBlueprint(input: BuildSceneBlueprintInput): SceneBlueprint {
  assertNarrationBinding(input)
  const selection = selectScenarioPack(input.eventPlan, input.evidence); const pack = selection.pack
  const groups = [...persistentGroups(input.eventPlan, input.evidence, pack), ...weaponGroups(input.eventPlan, input.evidence, pack)]
  const units = new Map(input.eventPlan.eventUnits.map(unit => [unit.eventUnitId, unit])); const byEvent = requirements(input.narrativePlan)
  const hasImage = input.narrationPlan.beats.some(beat => media(byEvent.get(beat.eventUnitId)?.preferredTemplate).includes('image'))
  const sceneBeats = input.narrationPlan.beats.map((beat, index) => { const unit = units.get(beat.eventUnitId); if (!unit) throw new Error(`UNKNOWN_EVENT_UNIT: ${beat.eventUnitId}`); const requirement = byEvent.get(beat.eventUnitId); const mediaIntents = media(requirement?.preferredTemplate); if (!hasImage && index === input.narrationPlan.beats.length - 1) mediaIntents.push('image'); const actorRefs = actorRefsForUnit(unit, groups, pack); return { sceneBeatId: `scene-beat:${slug(beat.subtitleId)}`, subtitleId: beat.subtitleId, eventUnitId: beat.eventUnitId, purpose: unit.narrativePurpose, actorRefs, behaviorIntents: [...(requirement?.motionRequirements ?? [])], spatialConstraints: [...(requirement?.spatialRelations ?? [])], stateTransitions: [...(requirement?.stateChanges ?? [])], cameraIntent: requirement?.attentionRequirements[0] ?? `focus:${beat.attentionTarget}`, mediaIntents, requiredFacts: [...(requirement?.requiredFacts ?? [])], forbiddenClaims: [...(requirement?.forbiddenClaims ?? [])], fidelity: fidelity(actorRefs, groups), priority: beat.importance } })
  const diagnostics = [...selection.diagnostics, ...groups.flatMap(group => pack.actorProfiles.find(profile => profile.groupId === group.groupId)?.diagnostics.map(item => diagnostic(item.code, item.message, 'warning')) ?? [])].filter((item, index, items) => items.findIndex(candidate => candidate.code === item.code && candidate.message === item.message) === index)
  const narrationFingerprint = fingerprint(input.narrationPlan); const scenarioPack = { packId: pack.packId, version: pack.version }
  const identity = fingerprint({ sourceNarrationPlanId: input.narrationPlan.narrationPlanId, sourceNarrationFingerprint: narrationFingerprint, scenarioPack, actorGroups: groups, sceneBeats, diagnostics })
  return sceneBlueprintSchema.parse({ schemaVersion: 'ise.scene-blueprint/v1', blueprintId: `blueprint:${identity.slice(7, 23)}`, sourceNarrationPlanId: input.narrationPlan.narrationPlanId, sourceNarrationFingerprint: narrationFingerprint, scenarioPack, actorGroups: groups, sceneBeats, diagnostics })
}
