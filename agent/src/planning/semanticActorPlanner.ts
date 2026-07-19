import type { EvidenceIR, EvidenceRecord } from '../contracts/evidence.ts'
import type { EventPlan, EventUnit } from '../contracts/eventPlan.ts'
import type { ScenarioActorProfile, ScenarioPack } from '../contracts/scenarioPack.ts'
import type { ActorGroupIntent } from '../contracts/sceneBlueprint.ts'
import { fingerprint } from '../services/fingerprint.ts'
import { diagnostic } from '../services/runtimeDiagnostics.ts'
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
      quantityDecision: resolveQuantity({ entityName: profile.semanticEntityRef, entityAliases: profile.aliases, platformType: profile.role === 'fighter-formation' ? 'fighter' : profile.platformType, role: profile.role === 'fighter-formation' ? 'formation' : profile.role, evidence: evidenceScope(evidence, scoped), packRoleDefault: roleDefault(pack, profile.role) }),
      formationPattern: profile.formationPattern, leaderPolicy: profile.leaderPolicy, behaviorProfile: profile.behaviorProfile, lifecycle: 'scene-persistent', aliases: profile.aliases, participantAliases: profile.participantAliases, evidenceRefs: scoped.map(record => record.evidenceId), platformKind: profile.role.includes('warning') ? 'sensor' : 'aircraft', diagnostics: [],
    } satisfies ActorGroupIntent]
  })
}

function completedLaunch(value: string): boolean {
  if (/\b(?:did\s+not|didn't|not|never)\s+(?:launch(?:ed|ing)?|fire(?:d|ing)?)\b|\bfailed\s+to\s+(?:launch|fire)\b|\b(?:launch|fire)\b\s+(?:was\s+)?(?:cancelled|canceled|aborted)\b|\u672a\u53d1\u5c04|\u6ca1\u6709\u53d1\u5c04|\u53d6\u6d88\u53d1\u5c04/iu.test(value)) return false
  if (/\b(?:pre[-\s]?launch|fire[-\s]?control|prepare(?:d|s|ing)?|plan(?:ned|s|ning)?|authori[sz](?:e|ed|es|ing|ation)?)\b|\u53d1\u5c04\u51c6\u5907|\u51c6\u5907\u53d1\u5c04|\u8ba1\u5212\u53d1\u5c04|\u706b\u63a7\u5f00\u542f/iu.test(value)) return false
  return /\b(?:launch(?:es|ed|ing)?|fire(?:s|d|ing)?)\b|\u53d1\u5c04/iu.test(value)
}
function inferredKind(value: string): ActorGroupIntent['platformKind'] { if (/\b(?:(?:pl|aim|r)-?\d+[a-z0-9-]*|missile|weapon|rocket|bomb)\b/iu.test(value)) return 'weapon'; if (/\b(?:sensor|radar|aew|awacs|sentinel)\b/iu.test(value)) return 'sensor'; if (/\b(?:truck|vehicle|rescue|transport)\b/iu.test(value)) return 'vehicle'; return 'aircraft' }
function inferredRole(kind: ActorGroupIntent['platformKind'], value: string): string { if (kind === 'weapon') return 'weapon-launch'; if (kind === 'sensor') return 'sensor-support'; if (kind === 'vehicle') return /rescue|evacuat/iu.test(value) ? 'rescue-support' : 'vehicle-support'; return /formation|flight|squadron|deploy|aircraft|fighter/iu.test(value) ? 'fighter-formation' : 'aircraft-support' }
function faction(value: string, pack: ScenarioPack): string { return pack.factions.find(candidate => contains(value, candidate.aliases))?.factionId ?? 'faction:unknown' }
function location(record: EvidenceRecord, unit: EventUnit, pack: ScenarioPack): string { const found = pack.locationProfiles.find(profile => contains([text(record), ...unit.locationRefs].join('|'), profile.aliases)); return found?.locationId ?? record.locationExpression ?? unit.locationRefs[0] ?? 'location:unspecified' }

function genericGroups(
  eventPlan: EventPlan,
  evidence: EvidenceIR,
  pack: ScenarioPack,
  legacy: readonly ActorGroupIntent[],
): ActorGroupIntent[] {
  const claimed = new Set(legacy.flatMap(group => group.aliases.map(normalize)))
  const groups = new Map<string, ActorGroupIntent>()
  for (const unit of eventPlan.eventUnits) {
    const records = factual(evidence.records).filter(record => unit.evidenceRefs.includes(record.evidenceId))
    for (const record of records) for (const profile of pack.entityProfiles) {
      if (profile.platformKind === 'weapon' || claimed.has(normalize(profile.aliases[0] ?? ''))) continue
      if (!contains(text(record), profile.aliases) || record.routeExpression === undefined || directLaunchWeapon(record, unit) !== undefined) continue
      const matchedRecords = records.filter(candidate => contains(text(candidate), profile.aliases))
      const source = `${record.claim}|${unit.worldStateChange}|${unit.participants.join('|')}`
      const side = faction(source, pack); const role = inferredRole(profile.platformKind, source); const locationRef = location(record, unit, pack)
      const id = `group:${slug(`${side}-${profile.entityId}-${locationRef === 'location:unspecified' ? '' : locationRef}`)}`
      if (groups.has(id)) continue
      groups.set(id, { groupId: id, semanticEntityRef: profile.aliases[0]!, side, locationRef, platformType: profile.entityId, role,
        quantityDecision: resolveQuantity({ entityName: profile.aliases[0]!, entityAliases: profile.aliases, platformType: profile.platformKind, role: role === 'fighter-formation' ? 'formation' : role, evidence: evidenceScope(evidence, matchedRecords), packRoleDefault: roleDefault(pack, role) }),
        formationPattern: role === 'fighter-formation' ? 'formation' : 'single', leaderPolicy: role === 'fighter-formation' ? 'stable-first-member' : 'single-member', behaviorProfile: `${role}/v1`, lifecycle: 'scene-persistent', aliases: profile.aliases, participantAliases: profile.aliases, evidenceRefs: matchedRecords.map(item => item.evidenceId), platformKind: profile.platformKind, diagnostics: [] })
    }
  }
  return [...groups.values()]
}

function actorKey(group: Pick<ActorGroupIntent, 'semanticEntityRef' | 'side' | 'locationRef'>): string { return [group.semanticEntityRef, group.side, group.locationRef].map(normalize).join('|') }
function entityTokens(value: string): string[] { return value.normalize('NFKC').toLocaleLowerCase('en-US').split(/[^\p{L}\p{N}]+/u).filter(Boolean) }
function aliasesRouteEntity(value: string, routeEntity: string): boolean {
  const valueTokens = entityTokens(value)
  const routeTokens = entityTokens(routeEntity)
  if (valueTokens.length < routeTokens.length || valueTokens.length - routeTokens.length > 2) return false
  return routeTokens.every((token, index) => token === valueTokens[valueTokens.length - routeTokens.length + index])
}
function renderableEntity(value: string): boolean {
  if (/^(?:their|they|them|theirs|it|its|this|that|these|those)$/iu.test(value.trim())) return false
  return !/\b(?:(?:task|air|battle|carrier|strike|naval)\s+group|command|headquarters|coalition|force)\b/iu.test(value)
}
function directLaunchWeapon(record: EvidenceRecord, unit: EventUnit): string | undefined {
  const claim = record.claim
  const action = /\b(?:launch(?:es|ed|ing)?|fire(?:s|d|ing)?|intercept(?:s|ed|ing)?)\b|\u53d1\u5c04|\u62e6\u622a/iu.exec(claim)
  if (action === null || !completedLaunch(`${record.claim}|${unit.worldStateChange}`)) return undefined
  const actionEnd = (action.index ?? 0) + action[0].length
  return record.entities.find(entity => {
    const index = claim.toLocaleLowerCase('en-US').indexOf(entity.toLocaleLowerCase('en-US'))
    if (index < actionEnd) return false
    const localSuffix = claim.slice(index + entity.length, index + entity.length + 32)
    return inferredKind(entity) === 'weapon' || /\b(?:weapon|missile|rocket|bomb)\b/iu.test(localSuffix)
  })
}
function launchObject(entity: string, record: EvidenceRecord, unit: EventUnit): boolean {
  return normalize(directLaunchWeapon(record, unit) ?? '') === normalize(entity)
}

function discoveredGroups(eventPlan: EventPlan, evidence: EvidenceIR, pack: ScenarioPack, occupied: ReadonlySet<string>): ActorGroupIntent[] {
  const groups = new Map<string, ActorGroupIntent>()
  const knownAliases = new Set([
    ...pack.actorProfiles.flatMap(profile => profile.aliases),
    ...pack.entityProfiles.flatMap(profile => profile.aliases),
  ].map(normalize))
  const knownEntity = (value: string): boolean => {
    const candidate = normalize(value)
    return [...knownAliases].some(alias => candidate.includes(alias) || alias.includes(candidate))
  }
  const routeAnchors = eventPlan.eventUnits.flatMap(unit => factual(evidence.records)
    .filter(record => unit.evidenceRefs.includes(record.evidenceId) && record.routeExpression !== undefined)
    .flatMap(record => {
      const excluded = new Set([
        record.locationExpression,
        ...unit.locationRefs,
        ...pack.factions.flatMap(profile => profile.aliases),
      ].filter((value): value is string => value !== undefined).map(normalize))
      return record.entities
        .filter(entity => !excluded.has(normalize(entity)) && renderableEntity(entity) && inferredKind(entity) !== 'weapon')
        .map(entity => ({ entity, record, unit, locationRef: record.locationExpression ?? unit.locationRefs[0] ?? 'location:unspecified' }))
    }))
  for (const unit of eventPlan.eventUnits) {
    const records = factual(evidence.records).filter(record => unit.evidenceRefs.includes(record.evidenceId))
    for (const record of records) {
      const locations = [record.locationExpression, ...unit.locationRefs].filter((value): value is string => value !== undefined && value.length > 0)
      const locationRef = locations[0] ?? 'location:unspecified'
      const locationTokens = new Set(locations.map(normalize))
      const factionTokens = new Set(pack.factions.flatMap(profile => profile.aliases).map(normalize))
      const entities = record.entities.filter(entity => !locationTokens.has(normalize(entity)) && !factionTokens.has(normalize(entity)))
      const candidates = entities.length > 0 ? entities : unit.participants.filter(participant => contains(record.claim, [participant]))
      for (const entity of candidates) {
        if (!renderableEntity(entity) || knownEntity(entity)) continue
        const source = `${record.claim}|${unit.worldStateChange}|${unit.participants.join('|')}`
        const platformKind = inferredKind(entity)
        if (platformKind === 'weapon' || launchObject(entity, record, unit)) continue
        const anchor = routeAnchors.find(candidate => aliasesRouteEntity(entity, candidate.entity))
        const semanticEntityRef = anchor?.entity ?? entity
        const actorLocationRef = anchor?.locationRef ?? locationRef
        const quantityRecord = anchor?.record ?? record
        const quantityUnit = anchor?.unit ?? unit
        const identitySource = `${quantityRecord.claim}|${quantityUnit.worldStateChange}|${quantityUnit.participants.join('|')}`
        const actorKind = inferredKind(semanticEntityRef)
        const role = inferredRole(actorKind, identitySource); const side = faction(identitySource, pack); const groupId = `group:${slug(`${side}-${semanticEntityRef}-${actorLocationRef}`)}`
        const key = actorKey({ semanticEntityRef, side, locationRef: actorLocationRef })
        const existing = groups.get(groupId)
        if (existing !== undefined) {
          if (!existing.aliases.some(alias => normalize(alias) === normalize(entity))) existing.aliases.push(entity)
          if (!existing.participantAliases.some(alias => normalize(alias) === normalize(entity))) existing.participantAliases.push(entity)
          if (!existing.evidenceRefs.includes(record.evidenceId)) existing.evidenceRefs.push(record.evidenceId)
          continue
        }
        if (occupied.has(key)) continue
        const diagnostics = [
          ...(side === 'faction:unknown' ? [diagnostic('ACTOR_FACTION_UNRESOLVED', `Actor ${semanticEntityRef} has no grounded faction.`, 'warning')] : []),
          ...(actorLocationRef === 'location:unspecified' ? [diagnostic('ACTOR_LOCATION_UNRESOLVED', `Actor ${semanticEntityRef} has no grounded location.`, 'warning')] : []),
          ...(entities.length > 1 ? [diagnostic('ACTOR_IDENTITY_AMBIGUOUS', `Evidence ${record.evidenceId} names multiple generic entities.`, 'warning')] : []),
        ]
        const aliases = semanticEntityRef === entity ? [semanticEntityRef] : [semanticEntityRef, entity]
        groups.set(groupId, { groupId, semanticEntityRef, side, locationRef: actorLocationRef, platformType: actorKind, role,
          quantityDecision: resolveQuantity({ entityName: semanticEntityRef, entityAliases: aliases, platformType: actorKind, role: role === 'fighter-formation' ? 'formation' : role, evidence: evidenceScope(evidence, [quantityRecord]) }),
          formationPattern: role === 'fighter-formation' ? 'formation' : 'single', leaderPolicy: role === 'fighter-formation' ? 'stable-first-member' : 'single-member', behaviorProfile: `${role}/v1`, lifecycle: 'scene-persistent', aliases, participantAliases: [...aliases], evidenceRefs: [...new Set([quantityRecord.evidenceId, record.evidenceId])], platformKind: actorKind, diagnostics })
      }
    }
  }
  return [...groups.values()]
}

function weaponGroups(eventPlan: EventPlan, evidence: EvidenceIR, pack: ScenarioPack): ActorGroupIntent[] {
  return eventPlan.eventUnits.flatMap(unit => {
    const records = factual(evidence.records).filter(record => unit.evidenceRefs.includes(record.evidenceId) && completedLaunch(record.claim))
    if (records.length === 0 || !completedLaunch(unit.worldStateChange)) return []
    const directWeapon = records.map(record => directLaunchWeapon(record, unit)).find((entity): entity is string => entity !== undefined)
    const profile = pack.entityProfiles.find(candidate => candidate.platformKind === 'weapon' && records.some(record => contains(text(record), candidate.aliases)))
    const semanticEntityRef = directWeapon ?? profile?.aliases[0] ?? records.flatMap(record => record.entities).find(entity => inferredKind(entity) === 'weapon') ?? 'missile'
    const side = weaponFaction(unit, records, pack)
    return [{ groupId: `group:weapon-${slug(unit.eventUnitId)}`, semanticEntityRef, side, locationRef: unit.locationRefs[0] ?? records[0]?.locationExpression ?? 'location:unspecified', platformType: profile?.entityId ?? semanticEntityRef, role: 'weapon-launch', quantityDecision: resolveQuantity({ entityName: semanticEntityRef, entityAliases: profile?.aliases, platformType: 'weapon', role: 'launch', evidence: evidenceScope(evidence, records), packRoleDefault: roleDefault(pack, 'weapon-launch') }), formationPattern: 'single', leaderPolicy: 'single-member', behaviorProfile: weaponBehaviorProfile(unit, records, pack, side), lifecycle: `event-scoped:${unit.eventUnitId}`, aliases: profile?.aliases ?? [semanticEntityRef], participantAliases: profile?.aliases ?? [semanticEntityRef], evidenceRefs: records.map(record => record.evidenceId), platformKind: 'weapon', diagnostics: [] } satisfies ActorGroupIntent]
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

function weaponBehaviorProfile(
  unit: EventUnit,
  records: EvidenceRecord[],
  pack: ScenarioPack,
  side: string,
): string {
  const source = [unit.title, unit.worldStateChange, ...unit.participants, ...unit.locationRefs, ...records.map(text)].join('|')
  const candidates = pack.weaponBehaviorProfiles.filter(profile => profile.factionId === side)
  const counterSignal = /\bcounterattack\b|\bretaliat(?:e|ion|ing)\b|反击|反制/iu.test(source)
  const scored = candidates.map(profile => {
    const matchedTerms = profile.matchTerms.filter(term => contains(source, [term]))
    let score = matchedTerms.length
    // Counterattack is a semantic action, not merely another occurrence of
    // the word "intercept" in a route description. Give an explicit
    // retaliation signal precedence when profiles overlap.
    if (counterSignal && /counterattack|retaliat|反击|反制/iu.test(profile.behaviorProfile)) score += 4
    return { profile, score, matchedTerms }
  }).sort((left, right) =>
    right.score - left.score
    || right.matchedTerms.length - left.matchedTerms.length
    || right.matchedTerms.join('').length - left.matchedTerms.join('').length
    || left.profile.behaviorProfile.localeCompare(right.profile.behaviorProfile),
  )
  const selected = scored.find(item => item.score > 0)?.profile
  return selected?.behaviorProfile
    ?? candidates.find(profile => profile.matchTerms.length === 0)?.behaviorProfile
    ?? 'weapon-launch/v1'
}

export function planActorGroups(input: { eventPlan: EventPlan; evidence: EvidenceIR; pack: ScenarioPack }): ActorGroupIntent[] {
  const legacy = legacyGroups(input.eventPlan, input.evidence, input.pack)
  const profileGroups = [...legacy, ...genericGroups(input.eventPlan, input.evidence, input.pack, legacy)]
  const occupied = new Set(profileGroups.map(actorKey))
  return [...profileGroups, ...discoveredGroups(input.eventPlan, input.evidence, input.pack, occupied), ...weaponGroups(input.eventPlan, input.evidence, input.pack)]
}
