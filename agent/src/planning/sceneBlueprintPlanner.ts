import type { EvidenceIR, EvidenceRecord } from '../contracts/evidence.ts'
import type { EventPlan, EventUnit } from '../contracts/eventPlan.ts'
import type { NarrationPlan } from '../contracts/narrationPlan.ts'
import type { NarrativePlan, SceneRequirement } from '../contracts/narrativePlan.ts'
import { indoPakTrajectoryScenario } from '../config/indoPakTrajectoryScenario.ts'
import {
  sceneBlueprintSchema,
  type ActorGroup,
  type SceneBlueprint,
} from '../contracts/sceneBlueprint.ts'
import { fingerprint } from '../services/fingerprint.ts'
import { diagnostic } from '../services/runtimeDiagnostics.ts'
import { resolveQuantity } from './quantityResolver.ts'

export interface BuildSceneBlueprintInput {
  eventPlan: EventPlan
  narrativePlan: NarrativePlan
  narrationPlan: NarrationPlan
  evidence: EvidenceIR
}

interface FighterDefinition {
  groupId: string
  entityName: string
  aliases: string[]
  side: string
  locationAliases: string[]
  formationPattern: string
}

const currentFighters: FighterDefinition[] = [
  {
    groupId: 'group:india-su30-adampur',
    entityName: '苏-30MKI',
    aliases: ['苏-30MKI', 'Su-30MKI', 'SU-30MKI'],
    side: 'india',
    locationAliases: ['阿达姆普尔', 'Adampur'],
    formationPattern: 'finger-four',
  },
  {
    groupId: 'group:india-rafale-ambala',
    entityName: '阵风',
    aliases: ['阵风', 'Rafale'],
    side: 'india',
    locationAliases: ['安巴拉', 'Ambala'],
    formationPattern: 'finger-four',
  },
]

const jf17Aliases = ['JF-17', 'JF17']
const minhasAliases = ['米纳斯', 'Minhas', 'Minas']
const rafikiAliases = ['拉菲基', 'Rafiki']
const sideFormationParticipantLabels: Readonly<Record<string, readonly string[]>> = {
  india: ['印方编队'],
  pakistan: ['巴方编队', '巴方拦截编队'],
}
const bothSidesAwacsAliases = ['双方预警机', '印巴双方预警机', 'Indian and Pakistani AWACS']
const awacsDefinitions = [
  {
    groupId: 'group:india-netra-awacs',
    entityName: 'Netra AEW&CS',
    aliases: ['印方预警机', '印度预警机', 'Netra', 'Netra AEW&CS'],
    side: 'india',
    locationRef: 'location:india-awacs',
    behaviorProfile: 'awacs-support/india/v1',
  },
  {
    groupId: 'group:pakistan-awacs-proxy',
    entityName: '巴方预警机（通用示意模型）',
    aliases: ['巴方预警机', '巴基斯坦预警机', 'Saab 2000 Erieye', 'ZDK-03'],
    side: 'pakistan',
    locationRef: 'location:pakistan-awacs',
    behaviorProfile: 'awacs-support/pakistan/v1',
  },
] as const

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/[\s‐‑‒–—―_-]+/g, '').toLocaleLowerCase('en-US')
}

function includesAlias(value: string, aliases: readonly string[]): boolean {
  const candidate = normalized(value)
  return aliases.some(alias => candidate.includes(normalized(alias)))
}

function recordText(record: EvidenceRecord): string {
  return [record.claim, record.locationExpression ?? '', ...record.entities].join('|')
}

function factualRecords(evidence: EvidenceIR): EvidenceRecord[] {
  return evidence.records.filter(record => record.kind === 'explicit_fact' || record.kind === 'deterministic_derivation')
}

function entityRecords(evidence: EvidenceIR, aliases: readonly string[]): EvidenceRecord[] {
  return factualRecords(evidence).filter(record => includesAlias(record.claim, aliases))
}

function groundedLocation(
  evidence: EvidenceIR,
  entityAliases: readonly string[],
  locationAliases: readonly string[],
): string | undefined {
  const record = entityRecords(evidence, entityAliases).find(candidate => includesAlias(recordText(candidate), locationAliases))
  if (!record) return undefined
  return locationAliases.find(alias => includesAlias(recordText(record), [alias]))
}

function scopedEvidence(evidence: EvidenceIR, records: EvidenceRecord[]): EvidenceIR {
  return { ...evidence, records }
}

function fighterGroup(
  definition: FighterDefinition,
  evidence: EvidenceIR,
  locationRef: string,
  quantityEvidence = evidence,
): ActorGroup {
  return {
    groupId: definition.groupId,
    semanticEntityRef: definition.entityName,
    side: definition.side,
    locationRef,
    platformType: definition.entityName,
    role: 'fighter-formation',
    quantityDecision: resolveQuantity({
      entityName: definition.entityName,
      entityAliases: definition.aliases,
      platformType: 'fighter',
      role: 'formation',
      evidence: quantityEvidence,
    }),
    formationPattern: definition.formationPattern,
    leaderPolicy: 'stable-first-member',
    behaviorProfile: 'fighter-formation/v1',
    lifecycle: 'scene-persistent',
  }
}

function fighterGroups(evidence: EvidenceIR): ActorGroup[] {
  const groups: ActorGroup[] = []
  for (const definition of currentFighters) {
    const records = entityRecords(evidence, definition.aliases)
    const locationRef = groundedLocation(evidence, definition.aliases, definition.locationAliases)
    if (records.length === 0 || !locationRef) continue
    groups.push(fighterGroup(definition, evidence, locationRef, scopedEvidence(evidence, records)))
  }

  const jf17Records = entityRecords(evidence, jf17Aliases)
  if (jf17Records.length === 0) return groups
  const minhas = groundedLocation(evidence, jf17Aliases, minhasAliases)
  const rafiki = groundedLocation(evidence, jf17Aliases, rafikiAliases)
  if (minhas && rafiki) {
    groups.push(fighterGroup({
      groupId: 'group:pakistan-jf17-minhas', entityName: 'JF-17', aliases: jf17Aliases,
      side: 'pakistan', locationAliases: minhasAliases, formationPattern: 'finger-four',
    }, evidence, minhas, scopedEvidence(evidence, jf17Records.filter(record => includesAlias(recordText(record), minhasAliases)))))
    groups.push(fighterGroup({
      groupId: 'group:pakistan-jf17-rafiki', entityName: 'JF-17', aliases: jf17Aliases,
      side: 'pakistan', locationAliases: rafikiAliases, formationPattern: 'finger-four',
    }, evidence, rafiki, scopedEvidence(evidence, jf17Records.filter(record => includesAlias(recordText(record), rafikiAliases)))))
  } else {
    const locationRef = minhas ?? rafiki
    if (locationRef) groups.push(fighterGroup({
      groupId: 'group:pakistan-jf17', entityName: 'JF-17', aliases: jf17Aliases,
      side: 'pakistan', locationAliases: [], formationPattern: 'finger-four',
    }, evidence, locationRef, scopedEvidence(evidence, jf17Records)))
  }
  return groups
}

function awacsGroups(eventPlan: EventPlan, evidence: EvidenceIR): ActorGroup[] {
  const linkedEvidenceIds = new Set(eventPlan.eventUnits.flatMap(unit => unit.evidenceRefs))
  const linkedRecords = factualRecords(evidence).filter(record => linkedEvidenceIds.has(record.evidenceId))
  return awacsDefinitions.flatMap(definition => {
    const records = linkedRecords.filter(record => includesAlias(
      recordText(record),
      [...definition.aliases, ...bothSidesAwacsAliases],
    ))
    if (records.length === 0) return []
    return [{
      groupId: definition.groupId,
      semanticEntityRef: definition.entityName,
      side: definition.side,
      locationRef: definition.locationRef,
      platformType: 'awacs',
      role: 'early-warning-support',
      quantityDecision: resolveQuantity({
        entityName: definition.entityName,
        entityAliases: definition.aliases,
        platformType: 'awacs',
        role: 'early-warning-support',
        evidence: scopedEvidence(evidence, records),
      }),
      formationPattern: 'single',
      leaderPolicy: 'single-member',
      behaviorProfile: definition.behaviorProfile,
      lifecycle: 'scene-persistent',
    } satisfies ActorGroup]
  })
}

function isExplicitLaunch(unit: EventUnit, completedLaunchRecords: EvidenceRecord[]): boolean {
  if (!isCompletedLaunchText(unit.worldStateChange)) return false
  return completedLaunchRecords.length > 0
}

function isCompletedLaunchText(value: string): boolean {
  if (/\b(?:did\s+not|didn't|not)\s+(?:launch(?:ed|ing)?|fire(?:d|ing)?)\b|\b(?:was|were|is|are|be|been|being)\s+(?:not|never)\s+(?:launch(?:ed|ing)?|fire(?:d|ing)?)\b|\bfailed\s+to\s+(?:launch|fire)\b|\b(?:launch|fire)\b\s+(?:was\s+)?(?:cancelled|canceled|aborted)\b|未发射|没有发射|取消发射|中止发射|发射取消|发射中止/iu.test(value)) return false
  if (/发射准备|准备发射|计划发射|授权发射|发射阵位|火控开启|预发射|pre[-\s]?launch|fire[-\s]?control|\bprepare(?:d|s|ing)?\b|\bplan(?:ned|s|ning)?\b|\bauthori[sz](?:e|ed|es|ing|ation)?\b/iu.test(value)) return false
  return /\blaunch(?:es|ed|ing)?\b|\bfire(?:s|d|ing)?\b|发射/iu.test(value)
}

function weaponEntity(records: EvidenceRecord[]): string {
  const explicitEntity = records.flatMap(record => record.entities)
    .find(entity => /\b(?:pl|aim|r)[-‐‑‒–—―]?\d+[a-z0-9-]*/iu.test(entity))
  if (explicitEntity) return explicitEntity

  const groundedText = records.map(recordText).join('|')
  const modelRef = groundedText.match(/\b(?:pl|aim|r)[-‐‑‒–—―]?\d+[a-z0-9-]*/iu)?.[0]
  return modelRef ?? 'missile'
}

function weaponSide(unit: EventUnit, records: EvidenceRecord[]): 'india' | 'pakistan' | 'unknown' {
  const sourceTexts = [...records.map(record => record.claim), unit.worldStateChange]
  for (const text of sourceTexts) {
    const launchIndex = text.search(/\blaunch(?:es|ed|ing)?\b|\bfire(?:s|d|ing)?\b|发射/iu)
    if (launchIndex < 0) continue
    const prefix = text.slice(0, launchIndex)
    if (/\b(?:was|were|is|are|be|been|being)\s*$/iu.test(prefix) || /被[^。；，,]{0,40}$/u.test(prefix)) continue
    const launcherCandidates = [
      ...jf17Aliases.map(alias => ({ alias, side: 'pakistan' as const })),
      ...currentFighters.flatMap(fighter => fighter.aliases.map(alias => ({ alias, side: 'india' as const }))),
      { alias: '巴方', side: 'pakistan' as const },
      { alias: 'Pakistan', side: 'pakistan' as const },
      { alias: '印方', side: 'india' as const },
      { alias: 'India', side: 'india' as const },
    ]
      .map(candidate => ({ ...candidate, index: text.toLocaleLowerCase('en-US').lastIndexOf(candidate.alias.toLocaleLowerCase('en-US'), launchIndex) }))
      .filter(candidate => candidate.index >= 0 && !/[.;；]/u.test(text.slice(candidate.index + candidate.alias.length, launchIndex)))
      .filter(candidate => !/\b(?:and|before|after|while|then|engage(?:d|s|ment)?)\b|\b(?:a|the)\s+missile\b/iu.test(
        text.slice(candidate.index + candidate.alias.length, launchIndex)))
      .sort((left, right) => right.index - left.index)
    if (launcherCandidates[0]) return launcherCandidates[0].side
  }
  return 'unknown'
}

function weaponBehaviorProfile(unit: EventUnit, records: EvidenceRecord[], side: string): string {
  if (side === 'india') return 'weapon-launch/india-first-strike/v1'
  if (side !== 'pakistan') return 'weapon-launch/v1'
  const groundedText = [unit.worldStateChange, ...records.map(recordText)].join('|')
  const intercept = /intercept|incoming missile|拦截|来袭导弹/iu.test(groundedText)
  const counterattack = /counterattack|rafale|阵风|反击/iu.test(groundedText)
  if (intercept === counterattack) return 'weapon-launch/v1'
  return intercept
    ? 'weapon-launch/pakistan-intercept/v1'
    : 'weapon-launch/pakistan-counterattack/v1'
}

function slug(value: string): string {
  const ascii = value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || fingerprint(value).slice('sha256:'.length, 'sha256:'.length + 12)
}

function weaponGroups(eventPlan: EventPlan, evidence: EvidenceIR): ActorGroup[] {
  return eventPlan.eventUnits.flatMap(unit => {
    const completedLaunchRecords = factualRecords(evidence)
      .filter(record => unit.evidenceRefs.includes(record.evidenceId))
      .filter(record => isCompletedLaunchText(record.claim))
    if (!isExplicitLaunch(unit, completedLaunchRecords)) return []
    const entityName = weaponEntity(completedLaunchRecords)
    const side = weaponSide(unit, completedLaunchRecords)
    return [{
      groupId: `group:weapon-${slug(unit.eventUnitId)}`,
      semanticEntityRef: entityName,
      side,
      locationRef: unit.locationRefs[0] ?? 'location:unspecified',
      platformType: entityName,
      role: 'weapon-launch',
      quantityDecision: resolveQuantity({
        entityName,
        platformType: 'weapon',
        role: 'launch',
        evidence: scopedEvidence(evidence, completedLaunchRecords),
      }),
      formationPattern: 'single',
      leaderPolicy: 'single-member',
      behaviorProfile: weaponBehaviorProfile(unit, completedLaunchRecords, side),
      lifecycle: `event-scoped:${unit.eventUnitId}`,
    } satisfies ActorGroup]
  })
}

function participantSide(participant: string): 'india' | 'pakistan' | undefined {
  const candidate = normalized(participant)
  if (candidate.startsWith(normalized('印方'))) return 'india'
  if (candidate.startsWith(normalized('巴方'))) return 'pakistan'
  return undefined
}

function scenarioAliasesForFighter(group: ActorGroup): string[] {
  const exactBundleId = group.groupId.replace(/^group:/, 'formation:')
  const exactBundle = indoPakTrajectoryScenario.bundles.find(bundle => bundle.bundleId === exactBundleId)
  if (exactBundle) return exactBundle.semanticEntityAliases
  return indoPakTrajectoryScenario.bundles
    .filter(bundle => bundle.bundleId.startsWith(`formation:${group.side}-`)
      && bundle.semanticEntityAliases.some(alias => normalized(alias) === normalized(group.semanticEntityRef)))
    .flatMap(bundle => bundle.semanticEntityAliases)
}

function participantMatchesFighter(participant: string, group: ActorGroup): boolean {
  if (group.role !== 'fighter-formation') return false
  const genericLabels = sideFormationParticipantLabels[group.side] ?? []
  if (genericLabels.some(label => normalized(participant) === normalized(label))) return true
  const side = participantSide(participant)
  if (side && side !== group.side) return false
  return includesAlias(participant, scenarioAliasesForFighter(group))
}

function unitNamesAwacs(unit: EventUnit, group: ActorGroup): boolean {
  if (group.role !== 'early-warning-support') return false
  const texts = [unit.title, unit.worldStateChange, ...unit.participants]
  if (texts.some(text => includesAlias(text, bothSidesAwacsAliases))) return true
  const definition = awacsDefinitions.find(candidate => candidate.side === group.side)
  return definition !== undefined && texts.some(text => includesAlias(text, definition.aliases))
}

function actorRefsForUnit(unit: EventUnit, groups: ActorGroup[]): string[] {
  return groups.filter(group => {
    if (group.lifecycle === `event-scoped:${unit.eventUnitId}`) return true
    return unitNamesAwacs(unit, group) || unit.participants.some(participant =>
      normalized(participant) === normalized(group.semanticEntityRef)
      || participantMatchesFighter(participant, group))
  }).map(group => group.groupId)
}

function fidelity(actorRefs: string[], groups: ActorGroup[]): 'evidence' | 'deterministic' | 'default' | 'user' {
  const sources = actorRefs.flatMap(ref => groups.find(group => group.groupId === ref)?.quantityDecision.source ?? [])
  if (sources.includes('user')) return 'user'
  if (sources.includes('default')) return 'default'
  return sources.length > 0 ? 'evidence' : 'deterministic'
}

function sceneRequirementByEvent(narrativePlan: NarrativePlan): Map<string, SceneRequirement> {
  return new Map(narrativePlan.sceneRequirements.map(requirement => [requirement.eventUnitId, requirement]))
}

function mediaIntentsForTemplate(template: SceneRequirement['preferredTemplate']): string[] {
  switch (template) {
    case 'deployment':
    case 'status_explanation':
      return ['image']
    case 'attack_chain':
    case 'electronic_warfare':
    case 'return_and_summary':
      return ['video', 'image']
    case 'interception':
    case 'counterattack':
    case 'withdrawal':
      return ['video']
    default:
      return []
  }
}

function assertNarrationBinding(input: BuildSceneBlueprintInput): void {
  if (
    input.narrationPlan.sourceEventPlanId !== input.eventPlan.planId
    || input.narrationPlan.sourceEventPlanFingerprint !== fingerprint(input.eventPlan)
    || input.narrationPlan.sourceNarrativePlanId !== input.narrativePlan.narrativePlanId
  ) throw new Error('SOURCE_NARRATION_PLAN_MISMATCH')
}

export function buildSceneBlueprint(input: BuildSceneBlueprintInput): SceneBlueprint {
  assertNarrationBinding(input)
  const groups = [
    ...fighterGroups(input.evidence),
    ...awacsGroups(input.eventPlan, input.evidence),
    ...weaponGroups(input.eventPlan, input.evidence),
  ]
  const eventUnits = new Map(input.eventPlan.eventUnits.map(unit => [unit.eventUnitId, unit]))
  const requirements = sceneRequirementByEvent(input.narrativePlan)
  const hasImageIntent = input.narrationPlan.beats.some(beat =>
    mediaIntentsForTemplate(requirements.get(beat.eventUnitId)?.preferredTemplate).includes('image'))
  const sceneBeats = input.narrationPlan.beats.map((beat, index) => {
    const unit = eventUnits.get(beat.eventUnitId)
    if (!unit) throw new Error(`UNKNOWN_EVENT_UNIT: ${beat.eventUnitId}`)
    const requirement = requirements.get(beat.eventUnitId)
    const actorRefs = actorRefsForUnit(unit, groups)
    const mediaIntents = mediaIntentsForTemplate(requirement?.preferredTemplate)
    if (!hasImageIntent && index === input.narrationPlan.beats.length - 1) mediaIntents.push('image')
    return {
      sceneBeatId: `scene-beat:${slug(beat.subtitleId)}`,
      subtitleId: beat.subtitleId,
      eventUnitId: beat.eventUnitId,
      purpose: unit.narrativePurpose,
      actorRefs,
      behaviorIntents: [...(requirement?.motionRequirements ?? [])],
      spatialConstraints: [...(requirement?.spatialRelations ?? [])],
      stateTransitions: [...(requirement?.stateChanges ?? [])],
      cameraIntent: requirement?.attentionRequirements[0] ?? `focus:${beat.attentionTarget}`,
      mediaIntents,
      requiredFacts: [...(requirement?.requiredFacts ?? [])],
      forbiddenClaims: [...(requirement?.forbiddenClaims ?? [])],
      fidelity: fidelity(actorRefs, groups),
      priority: beat.importance,
    }
  })

  const diagnostics = []
  if (groups.some(group => group.platformType === '苏-30MKI')) diagnostics.push(diagnostic(
    'SCENARIO_LOCAL_CALLSIGN_MAPPING',
    'Vampire is a scenario-local Su-30MKI callsign, not a global synonym.',
    'warning',
  ))
  if (groups.some(group => group.platformType === 'JF-17')) diagnostics.push(diagnostic(
    'OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY',
    'Current-scenario J-10CE route labels map to report JF-17 actors without creating a global synonym.',
    'warning',
  ))

  const narrationFingerprint = fingerprint(input.narrationPlan)
  const identity = fingerprint({
    sourceNarrationPlanId: input.narrationPlan.narrationPlanId,
    sourceNarrationFingerprint: narrationFingerprint,
    actorGroups: groups,
    sceneBeats,
    diagnostics,
  })
  return sceneBlueprintSchema.parse({
    schemaVersion: 'ise.scene-blueprint/v1',
    blueprintId: `blueprint:${identity.slice('sha256:'.length, 'sha256:'.length + 16)}`,
    sourceNarrationPlanId: input.narrationPlan.narrationPlanId,
    sourceNarrationFingerprint: narrationFingerprint,
    actorGroups: groups,
    sceneBeats,
    diagnostics,
  })
}
