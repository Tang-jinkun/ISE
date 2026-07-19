import type { EvidenceIR, EvidenceRecord } from '../contracts/evidence.ts'
import type { EventPlan, EventUnit } from '../contracts/eventPlan.ts'
import type { ActorGroupIntent, EngagementIntent } from '../contracts/sceneBlueprint.ts'
import { fingerprint } from '../services/fingerprint.ts'
import { diagnostic, type CompilationDiagnostic } from '../services/runtimeDiagnostics.ts'

export interface PlanEngagementIntentsInput {
  eventPlan: EventPlan
  evidence: EvidenceIR
  actorGroups: readonly ActorGroupIntent[]
}

export interface EngagementIntentPlanningResult {
  intents: EngagementIntent[]
  diagnostics: CompilationDiagnostic[]
}

const actionPattern = /\b(?:launch(?:es|ed|ing)?|fire(?:s|d|ing)?|intercept(?:s|ed|ing)?)\b|\u53d1\u5c04|\u5f00\u706b|\u62e6\u622a/iu

export function completedLaunch(value: string): boolean {
  if (/\b(?:did\s+not|didn't|not|never)\s+(?:launch(?:ed|ing)?|fire(?:d|ing)?|intercept(?:ed|ing)?)\b|\bfailed\s+to\s+(?:launch|fire|intercept)\b|\b(?:launch|fire|intercept)\b\s+(?:was\s+)?(?:cancelled|canceled|aborted)\b|\u672a\u53d1\u5c04|\u6ca1\u6709\u53d1\u5c04|\u53d6\u6d88\u53d1\u5c04/iu.test(value)) return false
  if (/\b(?:pre[-\s]?launch|fire[-\s]?control|prepare(?:d|s|ing)?|plan(?:ned|s|ning)?|authori[sz](?:e|ed|es|ing|ation)?)\b|\u53d1\u5c04\u51c6\u5907|\u51c6\u5907\u53d1\u5c04|\u8ba1\u5212\u53d1\u5c04|\u706b\u63a7\u5f00\u542f/iu.test(value)) return false
  return actionPattern.test(value)
}

function statesNegatedDestruction(value: string): boolean {
  return /\b(?:(?:was|were|is|are)\s+(?:not|never)|(?:wasn't|weren't|isn't|aren't)|(?:not|never))\s+(?:destroyed|shot\s+down|eliminated|killed)\b|\bfailed\s+to\s+(?:destroy|eliminate|kill)\b|(?:\u672a|\u6ca1\u6709|\u5e76\u672a|\u5c1a\u672a)(?:\u80fd|\u88ab)?(?:\u51fb\u6bc1|\u6467\u6bc1)/iu.test(value)
}

export function statesUnresolvedOutcome(value: string): boolean {
  return statesNegatedDestruction(value) || /\b(?:unconfirmed|unresolved|not\s+(?:confirmed|verified)|could\s+not\s+be\s+(?:confirmed|verified)|outcome\s+(?:was\s+)?unknown)\b|\u672a\u786e\u8ba4|\u5c1a\u672a\u786e\u8ba4|\u7ed3\u679c\u4e0d\u660e|\u65e0\u6cd5\u786e\u8ba4/iu.test(value)
}

export function statesConfirmedDestruction(value: string): boolean {
  return !statesNegatedDestruction(value) && /\b(?:destroy(?:s|ed)|shot\s+down|eliminat(?:es|ed)|kill(?:s|ed))\b|\u51fb\u6bc1|\u6467\u6bc1/iu.test(value)
}

function statesConfirmedInterception(value: string): boolean {
  return /\b(?:successfully\s+)?intercepted\b|\binterception\s+(?:succeeded|was\s+confirmed)\b|\u6210\u529f\u62e6\u622a/iu.test(value)
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/[\s\-_.]+/g, '').toLocaleLowerCase('en-US')
}

function aliases(group: ActorGroupIntent): string[] {
  return [...new Set([group.semanticEntityRef, ...group.aliases, ...group.participantAliases].filter(Boolean))]
}

function matches(value: string, group: ActorGroupIntent): boolean {
  const text = normalize(value)
  return aliases(group).some(alias => text.includes(normalize(alias)))
}

function participantCandidates(value: string, groups: readonly ActorGroupIntent[]): ActorGroupIntent[] {
  return groups.filter(group => group.platformKind !== 'weapon' && matches(value, group))
}

function targetText(claim: string, action: RegExpExecArray): string | undefined {
  const suffix = claim.slice((action.index ?? 0) + action[0].length)
  if (/\bintercept(?:s|ed|ing)?\b|\u62e6\u622a/iu.test(action[0])) return suffix
  const marker = /\b(?:at|toward(?:s)?|against)\b|\bintercept(?:s|ed|ing)?\b|(?:\u5bf9|\u5411)/iu.exec(suffix)
  return marker === null ? undefined : suffix.slice((marker.index ?? 0) + marker[0].length)
}

function launchRecord(group: ActorGroupIntent, unit: EventUnit, evidence: EvidenceIR): EvidenceRecord | undefined {
  const groupEvidence = new Set(group.evidenceRefs)
  return evidence.records.find(record =>
    unit.evidenceRefs.includes(record.evidenceId)
    && groupEvidence.has(record.evidenceId)
    && (record.kind === 'explicit_fact' || record.kind === 'deterministic_derivation')
    && completedLaunch(record.claim),
  )
}

function outcomeScope(
  start: EvidenceRecord,
  evidence: EvidenceIR,
  eventPlan: EventPlan,
  unit: EventUnit,
  weaponLaunchEvidenceIds: ReadonlySet<string>,
): EvidenceRecord[] {
  const startIndex = evidence.records.findIndex(record => record.evidenceId === start.evidenceId)
  if (startIndex < 0) return [start]
  const eventUnitIndex = eventPlan.eventUnits.findIndex(candidate => candidate.eventUnitId === unit.eventUnitId)
  if (eventUnitIndex < 0) return [start]
  const tail = evidence.records.slice(startIndex + 1)
  const nextLaunch = tail.findIndex(record => weaponLaunchEvidenceIds.has(record.evidenceId))
  const linkedOutcomeEvidence = new Set(eventPlan.eventUnits
    .slice(eventUnitIndex + 1)
    .flatMap(candidate => candidate.evidenceRefs))
  return evidence.records
    .slice(startIndex, nextLaunch < 0 ? evidence.records.length : startIndex + 1 + nextLaunch)
    .filter(record => (unit.evidenceRefs.includes(record.evidenceId) || linkedOutcomeEvidence.has(record.evidenceId))
      && (record.kind === 'explicit_fact' || record.kind === 'deterministic_derivation'))
}

function outcome(records: readonly EvidenceRecord[], launch: EvidenceRecord): {
  assertedOutcome: EngagementIntent['assertedOutcome']
  evidenceRefs: string[]
} {
  const unresolved = records.filter(record => statesUnresolvedOutcome(record.claim))
  if (unresolved.length > 0) return { assertedOutcome: 'unconfirmed', evidenceRefs: unresolved.map(record => record.evidenceId) }
  const destroyed = records.filter(record => statesConfirmedDestruction(record.claim))
  if (destroyed.length > 0) return { assertedOutcome: 'destroyed', evidenceRefs: destroyed.map(record => record.evidenceId) }
  const intercepted = records.filter(record => statesConfirmedInterception(record.claim))
  if (intercepted.length > 0) return { assertedOutcome: 'intercepted', evidenceRefs: intercepted.map(record => record.evidenceId) }
  const assertedOutcome = /\bintercept(?:s|ed|ing)?\b|\u62e6\u622a/iu.test(launch.claim) ? 'interception' : 'unconfirmed'
  return { assertedOutcome, evidenceRefs: [] }
}

function intentId(eventUnitId: string, weaponGroupRef: string): string {
  return `engagement:${fingerprint({ eventUnitId, weaponGroupRef }).slice(7, 23)}`
}

function participantDiagnostic(unit: EventUnit, launcherCount: number, weaponCount: number, targetCount: number): CompilationDiagnostic {
  return diagnostic(
    'ENGAGEMENT_PARTICIPANT_UNRESOLVED',
    `Engagement ${unit.eventUnitId} requires one launcher, weapon, and target; resolved ${launcherCount} launcher groups, ${weaponCount} weapon groups, and ${targetCount} target groups.`,
    'warning',
    { eventUnitId: unit.eventUnitId },
  )
}

export function planEngagementIntents(input: PlanEngagementIntentsInput): EngagementIntentPlanningResult {
  const intents: EngagementIntent[] = []
  const diagnostics: CompilationDiagnostic[] = []
  const weaponGroups = input.actorGroups.filter(group => group.platformKind === 'weapon' && group.lifecycle.startsWith('event-scoped:'))
  const weaponLaunchEvidenceIds = new Set(weaponGroups.flatMap(group => {
    const eventUnitId = group.lifecycle.slice('event-scoped:'.length)
    const unit = input.eventPlan.eventUnits.find(candidate => candidate.eventUnitId === eventUnitId)
    const launch = unit === undefined ? undefined : launchRecord(group, unit, input.evidence)
    return launch === undefined ? [] : [launch.evidenceId]
  }))

  for (const unit of input.eventPlan.eventUnits) {
    const resolvedWeapons = weaponGroups
      .filter(group => group.lifecycle === `event-scoped:${unit.eventUnitId}`)
      .map(weapon => ({ weapon, launch: launchRecord(weapon, unit, input.evidence) }))
      .filter((candidate): candidate is { weapon: ActorGroupIntent; launch: EvidenceRecord } => candidate.launch !== undefined)
    if (resolvedWeapons.length === 0) continue
    const launch = resolvedWeapons[0]!.launch
    const action = actionPattern.exec(launch.claim)
    if (action === null) continue
    const actionIndex = action.index ?? 0
    const launcherGroups = participantCandidates(launch.claim.slice(0, actionIndex), input.actorGroups)
    const target = targetText(launch.claim, action)
    const targetGroups = target === undefined ? [] : participantCandidates(target, input.actorGroups)
    if (launcherGroups.length !== 1 || resolvedWeapons.length !== 1 || targetGroups.length !== 1) {
      diagnostics.push(participantDiagnostic(unit, launcherGroups.length, resolvedWeapons.length, targetGroups.length))
      continue
    }
    const weapon = resolvedWeapons[0]!.weapon
    const scopedOutcome = outcome(outcomeScope(launch, input.evidence, input.eventPlan, unit, weaponLaunchEvidenceIds), launch)
    intents.push({
      engagementIntentId: intentId(unit.eventUnitId, weapon.groupId),
      eventUnitId: unit.eventUnitId,
      launcherGroupRef: launcherGroups[0]!.groupId,
      weaponGroupRef: weapon.groupId,
      targetGroupRef: targetGroups[0]!.groupId,
      assertedOutcome: scopedOutcome.assertedOutcome,
      evidenceRefs: [...new Set([launch.evidenceId, ...scopedOutcome.evidenceRefs])],
    })
  }

  return { intents, diagnostics }
}
