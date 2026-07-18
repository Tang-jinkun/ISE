import type { EvidenceIR, EvidenceRecord } from '../contracts/evidence.ts'
import type { EventPlan, EventUnit } from '../contracts/eventPlan.ts'
import type { ScenarioActorProfile, ScenarioPack } from '../contracts/scenarioPack.ts'
import type { ActorGroupIntent } from '../contracts/sceneBlueprint.ts'
import { fingerprint } from '../services/fingerprint.ts'
import { resolveQuantity } from './quantityResolver.ts'

function normalize(value: string): string { return value.normalize('NFKC').replace(/[\s\-_.]+/g, '').toLocaleLowerCase('en-US') }
function contains(value: string, aliases: readonly string[]): boolean { const text = normalize(value); return aliases.some(alias => text.includes(normalize(alias))) }
function text(record: EvidenceRecord): string { return [record.claim, record.locationExpression ?? '', ...record.entities].join('|') }
function factual(records: readonly EvidenceRecord[]): EvidenceRecord[] { return records.filter(record => record.kind === 'explicit_fact' || record.kind === 'deterministic_derivation') }
function evidenceScope(evidence: EvidenceIR, records: EvidenceRecord[]): EvidenceIR { return { ...evidence, records } }
function slug(value: string): string { const ascii = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); return ascii || fingerprint(value).slice(7, 19) }
function roleDefault(pack: ScenarioPack, role: string): { value: number; policyId: string } | undefined { const found = pack.quantityDefaults?.find(candidate => candidate.role === role); return found === undefined ? undefined : { value: found.value, policyId: found.policyId } }

function profileRecords(profile: ScenarioActorProfile, linkedIds: Set<string>, evidence: EvidenceIR): EvidenceRecord[] {
  return factual(evidence.records).filter(record => (!profile.linkedEvidenceOnly || linkedIds.has(record.evidenceId)) && contains(text(record), [...profile.aliases, ...profile.sharedEvidenceAliases]))
}

function legacyGroups(eventPlan: EventPlan, evidence: EvidenceIR, pack: ScenarioPack): ActorGroupIntent[] {
  const linkedIds = new Set(eventPlan.eventUnits.flatMap(unit => unit.evidenceRefs))
  return pack.actorProfiles.flatMap(profile => {
    const records = profileRecords(profile, linkedIds, evidence)
    const locationRecord = profile.locationAliases.length === 0 ? records[0] : records.find(record => contains(text(record), profile.locationAliases))
    if (locationRecord === undefined) return []
    const scoped = profile.locationAliases.length === 0 ? records : records.filter(record => contains(text(record), profile.locationAliases))
    return [{
      groupId: profile.groupId, semanticEntityRef: profile.semanticEntityRef, side: profile.factionId, locationRef: profile.locationAliases.length === 0 ? profile.locationRef : profile.locationAliases.find(alias => contains(text(locationRecord), [alias])) ?? profile.locationRef,
      platformType: profile.platformType, role: profile.role,
      quantityDecision: resolveQuantity({ entityName: profile.semanticEntityRef, entityAliases: profile.aliases, platformType: profile.role === 'fighter-formation' ? 'fighter' : profile.platformType, role: profile.role, evidence: evidenceScope(evidence, scoped), packRoleDefault: roleDefault(pack, profile.role) }),
      formationPattern: profile.formationPattern, leaderPolicy: profile.leaderPolicy, behaviorProfile: profile.behaviorProfile, lifecycle: 'scene-persistent', aliases: profile.aliases, participantAliases: profile.participantAliases, evidenceRefs: scoped.map(record => record.evidenceId), platformKind: profile.role.includes('warning') ? 'sensor' : 'aircraft',
    } satisfies ActorGroupIntent]
  })
}

function completedLaunch(value: string): boolean {
  if (/\b(?:did\s+not|didn't|not|never)\s+(?:launch(?:ed|ing)?|fire(?:d|ing)?)\b|\bfailed\s+to\s+(?:launch|fire)\b|\b(?:launch|fire)\b\s+(?:was\s+)?(?:cancelled|canceled|aborted)\b|\u672a\u53d1\u5c04|\u6ca1\u6709\u53d1\u5c04|\u53d6\u6d88\u53d1\u5c04/iu.test(value)) return false
  if (/\b(?:pre[-\s]?launch|fire[-\s]?control|prepare(?:d|s|ing)?|plan(?:ned|s|ning)?|authori[sz](?:e|ed|es|ing|ation)?)\b|\u53d1\u5c04\u51c6\u5907|\u51c6\u5907\u53d1\u5c04|\u8ba1\u5212\u53d1\u5c04|\u706b\u63a7\u5f00\u542f/iu.test(value)) return false
  return /\b(?:launch(?:es|ed|ing)?|fire(?:s|d|ing)?)\b|\u53d1\u5c04/iu.test(value)
}
function inferredKind(value: string): ActorGroupIntent['platformKind'] { if (/\b(?:missile|weapon|rocket|bomb)\b/iu.test(value)) return 'weapon'; if (/\b(?:sensor|radar|aew|awacs|sentinel)\b/iu.test(value)) return 'sensor'; if (/\b(?:truck|vehicle|rescue|transport)\b/iu.test(value)) return 'vehicle'; return 'aircraft' }
function inferredRole(kind: ActorGroupIntent['platformKind'], value: string): string { if (kind === 'weapon') return 'weapon-launch'; if (kind === 'sensor') return 'sensor-support'; if (kind === 'vehicle') return /rescue|evacuat/iu.test(value) ? 'rescue-support' : 'vehicle-support'; return /formation|flight|squadron|deploy|aircraft|fighter/iu.test(value) ? 'fighter-formation' : 'aircraft-support' }
function faction(value: string, pack: ScenarioPack): string { return pack.factions.find(candidate => contains(value, candidate.aliases))?.factionId ?? 'faction:unknown' }
function location(record: EvidenceRecord, unit: EventUnit, pack: ScenarioPack): string { const found = pack.locationProfiles.find(profile => contains([text(record), ...unit.locationRefs].join('|'), profile.aliases)); return found?.locationId ?? unit.locationRefs[0] ?? record.locationExpression ?? 'location:unspecified' }

function genericGroups(eventPlan: EventPlan, evidence: EvidenceIR, pack: ScenarioPack): ActorGroupIntent[] {
  const claimed = new Set(pack.actorProfiles.flatMap(profile => profile.aliases.map(normalize)))
  const groups = new Map<string, ActorGroupIntent>()
  for (const unit of eventPlan.eventUnits) {
    const records = factual(evidence.records).filter(record => unit.evidenceRefs.includes(record.evidenceId))
    for (const record of records) for (const profile of pack.entityProfiles) {
      if (profile.platformKind === 'weapon' || claimed.has(normalize(profile.aliases[0] ?? ''))) continue
      if (!contains(text(record), profile.aliases)) continue
      const source = `${record.claim}|${unit.worldStateChange}|${unit.participants.join('|')}`
      const side = faction(source, pack); const role = inferredRole(profile.platformKind, source); const locationRef = location(record, unit, pack)
      const id = `group:${slug(`${side}-${profile.entityId}-${locationRef === 'location:unspecified' ? '' : locationRef}`)}`
      if (groups.has(id)) continue
      groups.set(id, { groupId: id, semanticEntityRef: profile.aliases[0]!, side, locationRef, platformType: profile.entityId, role,
        quantityDecision: resolveQuantity({ entityName: profile.aliases[0]!, entityAliases: profile.aliases, platformType: profile.platformKind, role: role === 'fighter-formation' ? 'formation' : role, evidence: evidenceScope(evidence, records), packRoleDefault: roleDefault(pack, role) }),
        formationPattern: role === 'fighter-formation' ? 'formation' : 'single', leaderPolicy: role === 'fighter-formation' ? 'stable-first-member' : 'single-member', behaviorProfile: `${role}/v1`, lifecycle: 'scene-persistent', aliases: profile.aliases, participantAliases: profile.aliases, evidenceRefs: records.map(item => item.evidenceId), platformKind: profile.platformKind })
    }
  }
  return [...groups.values()]
}

function weaponGroups(eventPlan: EventPlan, evidence: EvidenceIR, pack: ScenarioPack): ActorGroupIntent[] {
  return eventPlan.eventUnits.flatMap(unit => {
    const records = factual(evidence.records).filter(record => unit.evidenceRefs.includes(record.evidenceId) && completedLaunch(record.claim))
    if (records.length === 0 || !completedLaunch(unit.worldStateChange)) return []
    const profile = pack.entityProfiles.find(candidate => candidate.platformKind === 'weapon' && records.some(record => contains(text(record), candidate.aliases)))
    const semanticEntityRef = profile?.aliases[0] ?? records.flatMap(record => record.entities).find(entity => inferredKind(entity) === 'weapon') ?? 'missile'
    const side = weaponFaction(unit, records, pack)
    return [{ groupId: `group:weapon-${slug(unit.eventUnitId)}`, semanticEntityRef, side, locationRef: unit.locationRefs[0] ?? records[0]?.locationExpression ?? 'location:unspecified', platformType: profile?.entityId ?? semanticEntityRef, role: 'weapon-launch', quantityDecision: resolveQuantity({ entityName: semanticEntityRef, entityAliases: profile?.aliases, platformType: 'weapon', role: 'launch', evidence: evidenceScope(evidence, records), packRoleDefault: roleDefault(pack, 'weapon-launch') }), formationPattern: 'single', leaderPolicy: 'single-member', behaviorProfile: pack.weaponBehaviorProfiles.find(candidate => candidate.factionId === side && candidate.matchTerms.some(term => contains([unit.worldStateChange, ...records.map(text)].join('|'), [term])))?.behaviorProfile ?? pack.weaponBehaviorProfiles.find(candidate => candidate.factionId === side && candidate.matchTerms.length === 0)?.behaviorProfile ?? 'weapon-launch/v1', lifecycle: `event-scoped:${unit.eventUnitId}`, aliases: profile?.aliases ?? [semanticEntityRef], participantAliases: profile?.aliases ?? [semanticEntityRef], evidenceRefs: records.map(record => record.evidenceId), platformKind: 'weapon' } satisfies ActorGroupIntent]
  })
}

function weaponFaction(unit: EventUnit, records: EvidenceRecord[], pack: ScenarioPack): string {
  for (const candidateText of [...records.map(record => record.claim), unit.worldStateChange]) {
    const match = /\b(?:launch(?:es|ed|ing)?|fire(?:s|d|ing)?)\b|\u53d1\u5c04/iu.exec(candidateText)
    if (match === null) continue
    const prefix = candidateText.slice(0, match.index)
    if (/\b(?:was|were|is|are|be|been|being)\s*$/iu.test(prefix)) return 'unknown'
    const candidates = [
      ...pack.factions.flatMap(profile => profile.aliases.map(alias => ({ factionId: profile.factionId, alias }))),
      ...pack.actorProfiles.flatMap(profile => profile.aliases.map(alias => ({ factionId: profile.factionId, alias }))),
    ].map(candidate => ({ ...candidate, index: prefix.toLocaleLowerCase('en-US').lastIndexOf(candidate.alias.toLocaleLowerCase('en-US')) }))
      .filter(candidate => candidate.index >= 0)
      .filter(candidate => !/\b(?:and|before|after|while|then|engage(?:d|s|ment)?)\b/iu.test(prefix.slice(candidate.index + candidate.alias.length)))
      .sort((left, right) => right.index - left.index)
    if (candidates[0] !== undefined) return candidates[0].factionId
  }
  return 'unknown'
}

export function planActorGroups(input: { eventPlan: EventPlan; evidence: EvidenceIR; pack: ScenarioPack }): ActorGroupIntent[] {
  return [...legacyGroups(input.eventPlan, input.evidence, input.pack), ...genericGroups(input.eventPlan, input.evidence, input.pack), ...weaponGroups(input.eventPlan, input.evidence, input.pack)]
}
