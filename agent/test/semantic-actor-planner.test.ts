import assert from 'node:assert/strict'
import test from 'node:test'
import type { EvidenceIR } from '../src/contracts/evidence.ts'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import type { NarrativePlan } from '../src/contracts/narrativePlan.ts'
import type { ScenarioPack } from '../src/contracts/scenarioPack.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { buildNarrationPlan } from '../src/planning/narrationPlanner.ts'
import { planActorGroups } from '../src/planning/semanticActorPlanner.ts'
import { buildSceneBlueprint } from '../src/planning/sceneBlueprintPlanner.ts'
import { genericScenarioPack } from '../src/services/scenarioPackRegistry.ts'
import { indoPakScenarioPack } from '../src/config/indoPakScenarioPack.ts'

const pack: ScenarioPack = {
  schemaVersion: 'ise-scenario-pack/v1', packId: 'aurora-borealis/v1', version: '1', displayName: 'Aurora and Borealis',
  matchRules: [],
  factions: [
    { factionId: 'aurora', aliases: ['Aurora'], displayName: 'Aurora' },
    { factionId: 'borealis', aliases: ['Borealis'], displayName: 'Borealis' },
  ],
  entityProfiles: [
    { entityId: 'falcon', aliases: ['Falcon'], platformKind: 'aircraft', modelAssetAliases: [] },
    { entityId: 'sentinel', aliases: ['Sentinel'], platformKind: 'sensor', modelAssetAliases: [] },
    { entityId: 'rescue-truck', aliases: ['Rescue Truck'], platformKind: 'vehicle', modelAssetAliases: [] },
    { entityId: 'arrow', aliases: ['Arrow'], platformKind: 'weapon', modelAssetAliases: [] },
  ],
  locationProfiles: [{ locationId: 'location:delta', aliases: ['Delta Base'] }],
  routeBundles: [], mediaProfiles: [], actorProfiles: [], weaponBehaviorProfiles: [],
  quantityDefaults: [{ role: 'fighter-formation', value: 3, policyId: 'aurora-formation/v1' }],
}

const evidence: EvidenceIR = {
  schemaVersion: 'evidence-ir/v1', documentId: 'doc:aurora', records: [
    { evidenceId: 'ev-falcon', sourceRef: 'docx:p1', claim: 'Aurora deploys 5架 Falcon aircraft from Delta Base.', kind: 'explicit_fact', entities: ['Aurora', 'Falcon', 'Delta Base'], locationExpression: 'Delta Base', confidence: 1, ambiguities: [] },
    { evidenceId: 'ev-sentinel', sourceRef: 'docx:p2', claim: 'Aurora Sentinel monitors the corridor.', kind: 'explicit_fact', entities: ['Aurora', 'Sentinel'], confidence: 1, ambiguities: [] },
    { evidenceId: 'ev-rescue', sourceRef: 'docx:p3', claim: 'Borealis Rescue Truck evacuates personnel.', kind: 'explicit_fact', entities: ['Borealis', 'Rescue Truck'], confidence: 1, ambiguities: [] },
    { evidenceId: 'ev-arrow', sourceRef: 'docx:p4', claim: 'Aurora launches one Arrow weapon.', kind: 'explicit_fact', entities: ['Aurora', 'Arrow'], confidence: 1, ambiguities: [] },
  ],
}

const eventPlan: EventPlan = {
  schemaVersion: 'event-plan/v1', planId: 'event-plan:aurora', documentId: 'doc:aurora', version: 1, omittedEvidence: [], warnings: [],
  eventUnits: [
    { eventUnitId: 'event:deploy', title: 'Deployment', worldStateChange: 'Aurora Falcon formation deploys.', participants: ['Aurora Falcon formation', 'Ungrounded Ghost'], locationRefs: ['Delta Base'], evidenceRefs: ['ev-falcon'], inferenceRefs: [], uncertainties: [], narrativePurpose: 'deployment', importance: 'high' },
    { eventUnitId: 'event:monitor', title: 'Monitoring', worldStateChange: 'Sentinel monitors.', participants: ['Aurora Sentinel'], locationRefs: [], evidenceRefs: ['ev-sentinel'], inferenceRefs: [], uncertainties: [], narrativePurpose: 'monitor', importance: 'medium' },
    { eventUnitId: 'event:rescue', title: 'Rescue', worldStateChange: 'Rescue Truck evacuates.', participants: ['Borealis Rescue Truck'], locationRefs: [], evidenceRefs: ['ev-rescue'], inferenceRefs: [], uncertainties: [], narrativePurpose: 'rescue', importance: 'medium' },
    { eventUnitId: 'event:launch', title: 'Launch', worldStateChange: 'Aurora launches Arrow.', participants: ['Aurora', 'Arrow'], locationRefs: [], evidenceRefs: ['ev-arrow'], inferenceRefs: [], uncertainties: [], narrativePurpose: 'launch', importance: 'high' },
  ],
}

test('plans generic grounded semantic actors with exact and pack default quantities', () => {
  const groups = planActorGroups({ eventPlan, evidence, pack })

  assert.deepEqual(groups.map(group => group.groupId), [
    'group:aurora-falcon-location-delta',
    'group:aurora-sentinel',
    'group:borealis-rescue-truck',
    'group:weapon-event-launch',
  ])
  assert.deepEqual(groups[0]?.quantityDecision, {
    value: 5, constraint: 'exact', source: 'evidence', evidenceRefs: ['ev-falcon'], reason: 'Explicit quantity adjacent to entity',
  })
  assert.equal(groups[0]?.side, 'aurora')
  assert.equal(groups.some(group => group.semanticEntityRef === 'Aurora'), false)
  assert.equal(groups[0]?.role, 'fighter-formation')
  assert.equal(groups[1]?.quantityDecision.value, 1)
  assert.equal(groups[2]?.platformKind, 'vehicle')
  assert.equal(groups.some(group => group.semanticEntityRef === 'Ungrounded Ghost'), false)
  assert.equal(groups[3]?.lifecycle, 'event-scoped:event:launch')
})

test('uses a pack role default when a grounded formation has no explicit quantity', () => {
  const noQuantity = { ...evidence, records: evidence.records.map(record => record.evidenceId === 'ev-falcon'
    ? { ...record, claim: 'Aurora deploys Falcon aircraft from Delta Base.' }
    : record) }
  const group = planActorGroups({ eventPlan, evidence: noQuantity, pack })[0]
  assert.deepEqual(group?.quantityDecision, {
    value: 3, constraint: 'unknown', source: 'default', evidenceRefs: [], defaultPolicyId: 'aurora-formation/v1', reason: 'No explicit quantity; applied aurora-formation/v1',
  })
})

test('buildSceneBlueprint creates an evidence-backed actor for an unmatched document', () => {
  const unmatchedEvidence: EvidenceIR = {
    schemaVersion: 'evidence-ir/v1', documentId: 'doc:unmatched', records: [
      { evidenceId: 'ev-orbit', sourceRef: 'docx:p1', claim: 'Four Surveyor aircraft depart Harbor Field.', kind: 'explicit_fact', entities: ['Surveyor aircraft', 'Harbor Field'], locationExpression: 'Harbor Field', confidence: 1, ambiguities: [] },
    ],
  }
  const unmatchedPlan: EventPlan = {
    schemaVersion: 'event-plan/v1', planId: 'event-plan:unmatched', documentId: 'doc:unmatched', version: 1, omittedEvidence: [], warnings: [],
    eventUnits: [{ eventUnitId: 'event:orbit', title: 'Survey', worldStateChange: 'Surveyor aircraft form a patrol.', participants: ['Surveyor aircraft'], locationRefs: ['Harbor Field'], evidenceRefs: ['ev-orbit'], inferenceRefs: [], uncertainties: [], narrativePurpose: 'survey', importance: 'high' }],
  }
  const narrativePlan: NarrativePlan = {
    schemaVersion: 'narrative-plan/v1', narrativePlanId: 'narrative:unmatched', targetDurationMs: 10_000,
    sourceEventPlan: { artifactId: 'accepted:event-plan:unmatched:v1', planId: unmatchedPlan.planId, version: 1, fingerprint: fingerprint(unmatchedPlan) },
    subtitles: [{ subtitleId: 'subtitle:orbit', eventUnitId: 'event:orbit', text: 'Surveyors begin their patrol.', evidenceRefs: ['ev-orbit'], importance: 'high' }],
    sceneRequirements: [{ requirementId: 'requirement:orbit', eventUnitId: 'event:orbit', focusEntities: ['Surveyor aircraft'], spatialRelations: [], stateChanges: [], motionRequirements: [], attentionRequirements: ['show surveyors'], requiredFacts: [], forbiddenClaims: [], preferredTemplate: 'deployment' }],
  }
  const planning = { eventPlan: unmatchedPlan, narrativePlan, evidence: unmatchedEvidence }
  const blueprint = buildSceneBlueprint({ ...planning, narrationPlan: buildNarrationPlan(planning) })

  assert.equal(blueprint.scenarioPack?.packId, 'generic/v1')
  assert.ok(blueprint.actorGroups.length > 0)
  assert.equal(blueprint.actorGroups[0]?.locationRef, 'Harbor Field')
  assert.equal(blueprint.actorGroups[0]?.quantityDecision.value, 4)
})

test('keeps a profile formation default when one fighter is destroyed', () => {
  const formationPack: ScenarioPack = {
    ...pack,
    actorProfiles: [{ groupId: 'group:aurora-falcon-delta', semanticEntityRef: 'Falcon', aliases: ['Falcon'], factionId: 'aurora', locationAliases: ['Delta Base'], locationRef: 'location:delta', platformType: 'Falcon', role: 'fighter-formation', formationPattern: 'formation', leaderPolicy: 'stable-first-member', behaviorProfile: 'fighter-formation/v1', linkedEvidenceOnly: false, participantAliases: ['Falcon'], sharedEvidenceAliases: [], diagnostics: [] }],
  }
  const destructionEvidence: EvidenceIR = { ...evidence, records: [{ evidenceId: 'ev-loss', sourceRef: 'docx:p5', claim: 'One Falcon aircraft is destroyed near Delta Base.', kind: 'explicit_fact', entities: ['Falcon', 'Delta Base'], locationExpression: 'Delta Base', confidence: 1, ambiguities: [] }] }
  const groups = planActorGroups({ eventPlan, evidence: destructionEvidence, pack: formationPack })
  assert.equal(groups.find(group => group.groupId === 'group:aurora-falcon-delta')?.quantityDecision.value, 3)
})

test('creates only an event-scoped weapon for an unmatched missile launch', () => {
  const launchEvidence: EvidenceIR = { schemaVersion: 'evidence-ir/v1', documentId: 'doc:launch', records: [{ evidenceId: 'ev-launch', sourceRef: 'docx:p1', claim: 'Patrol launches a PL-99 missile.', kind: 'explicit_fact', entities: ['Patrol', 'PL-99 missile'], confidence: 1, ambiguities: [] }] }
  const launchPlan: EventPlan = { schemaVersion: 'event-plan/v1', planId: 'event-plan:launch', documentId: 'doc:launch', version: 1, omittedEvidence: [], warnings: [], eventUnits: [{ eventUnitId: 'event:launch', title: 'Launch', worldStateChange: 'Patrol launches a PL-99 missile.', participants: ['Patrol', 'PL-99 missile'], locationRefs: [], evidenceRefs: ['ev-launch'], inferenceRefs: [], uncertainties: [], narrativePurpose: 'launch', importance: 'high' }] }
  const groups = planActorGroups({ eventPlan: launchPlan, evidence: launchEvidence, pack: genericScenarioPack })
  const weapons = groups.filter(group => group.platformKind === 'weapon')
  assert.equal(weapons.length, 1)
  assert.equal(weapons[0]?.lifecycle, 'event-scoped:event:launch')
})

test('keeps a neutral named launch object event-scoped', () => {
  const launchEvidence: EvidenceIR = { schemaVersion: 'evidence-ir/v1', documentId: 'doc:arrow', records: [{ evidenceId: 'ev-arrow', sourceRef: 'docx:p1', claim: 'Patrol launches an Arrow weapon.', kind: 'explicit_fact', entities: ['Patrol', 'Arrow'], confidence: 1, ambiguities: [] }] }
  const launchPlan: EventPlan = { schemaVersion: 'event-plan/v1', planId: 'event-plan:arrow', documentId: 'doc:arrow', version: 1, omittedEvidence: [], warnings: [], eventUnits: [{ eventUnitId: 'event:launch', title: 'Launch', worldStateChange: 'Patrol launches an Arrow weapon.', participants: ['Patrol', 'Arrow'], locationRefs: [], evidenceRefs: ['ev-arrow'], inferenceRefs: [], uncertainties: [], narrativePurpose: 'launch', importance: 'high' }] }
  const groups = planActorGroups({ eventPlan: launchPlan, evidence: launchEvidence, pack: genericScenarioPack })
  assert.equal(groups.some(group => group.semanticEntityRef === 'Arrow' && group.lifecycle === 'scene-persistent'), false)
  assert.deepEqual(groups.filter(group => group.platformKind === 'weapon').map(group => [group.lifecycle, group.semanticEntityRef, group.evidenceRefs]), [['event-scoped:event:launch', 'Arrow', ['ev-arrow']]])
})

test('keeps a target after a neutral named launch object as a persistent actor', () => {
  const launchEvidence: EvidenceIR = { schemaVersion: 'evidence-ir/v1', documentId: 'doc:engagement', records: [{ evidenceId: 'ev-engagement', sourceRef: 'docx:p1', claim: 'Falcon launches an Arrow weapon at Hawk aircraft.', kind: 'explicit_fact', entities: ['Falcon', 'Arrow', 'Hawk aircraft'], confidence: 1, ambiguities: [] }] }
  const launchPlan: EventPlan = { schemaVersion: 'event-plan/v1', planId: 'event-plan:engagement', documentId: 'doc:engagement', version: 1, omittedEvidence: [], warnings: [], eventUnits: [{ eventUnitId: 'event:launch', title: 'Launch', worldStateChange: 'Falcon launches an Arrow weapon at Hawk aircraft.', participants: ['Falcon', 'Arrow', 'Hawk aircraft'], locationRefs: [], evidenceRefs: ['ev-engagement'], inferenceRefs: [], uncertainties: [], narrativePurpose: 'launch', importance: 'high' }] }
  const groups = planActorGroups({ eventPlan: launchPlan, evidence: launchEvidence, pack: genericScenarioPack })
  assert.equal(groups.some(group => group.semanticEntityRef === 'Arrow' && group.lifecycle === 'scene-persistent'), false)
  assert.ok(groups.some(group => group.semanticEntityRef === 'Hawk aircraft' && group.lifecycle === 'scene-persistent'))
  assert.equal(groups.find(group => group.platformKind === 'weapon')?.semanticEntityRef, 'Arrow')
})

test('prefers counterattack semantics when an event also mentions an intercept route', () => {
  const counterEvidence: EvidenceIR = {
    schemaVersion: 'evidence-ir/v1', documentId: 'doc:indo-pak-counter', records: [{
      evidenceId: 'ev-counter', sourceRef: 'docx:p1',
      claim: '巴基斯坦JF-17发射第二枚PL-15E导弹，反击印度Rafale编队，沿拦截航线飞向目标。',
      kind: 'explicit_fact', entities: ['巴基斯坦JF-17', 'PL-15E', '印度Rafale编队'], confidence: 1, ambiguities: [],
    }],
  }
  const counterPlan: EventPlan = {
    schemaVersion: 'event-plan/v1', planId: 'event-plan:indo-pak-counter', documentId: 'doc:indo-pak-counter', version: 1,
    omittedEvidence: [], warnings: [], eventUnits: [{
      eventUnitId: 'event:counter', title: '反击发射',
      worldStateChange: '巴基斯坦JF-17发射第二枚PL-15E导弹，反击印度Rafale编队，沿拦截航线飞向目标。',
      participants: ['巴基斯坦JF-17', 'PL-15E', '印度Rafale编队'], locationRefs: [], evidenceRefs: ['ev-counter'],
      inferenceRefs: [], uncertainties: [], narrativePurpose: 'counterattack', importance: 'high',
    }],
  }
  const weapon = planActorGroups({ eventPlan: counterPlan, evidence: counterEvidence, pack: indoPakScenarioPack })
    .find(group => group.platformKind === 'weapon')
  assert.equal(weapon?.behaviorProfile, 'weapon-launch/pakistan-counterattack/v1')
})

test('discovers an unclaimed rescue actor alongside a resolved pack fighter', () => {
  const partialPack: ScenarioPack = { ...pack, entityProfiles: [], actorProfiles: [{ groupId: 'group:aurora-falcon-delta', semanticEntityRef: 'Falcon', aliases: ['Falcon'], factionId: 'aurora', locationAliases: ['Delta Base'], locationRef: 'location:delta', platformType: 'Falcon', role: 'fighter-formation', formationPattern: 'formation', leaderPolicy: 'stable-first-member', behaviorProfile: 'fighter-formation/v1', linkedEvidenceOnly: false, participantAliases: ['Falcon'], sharedEvidenceAliases: [], diagnostics: [] }] }
  const groups = planActorGroups({ eventPlan, evidence, pack: partialPack })
  assert.ok(groups.some(group => group.groupId === 'group:aurora-falcon-delta'))
  assert.ok(groups.some(group => group.semanticEntityRef === 'Rescue Truck'))
  assert.equal(groups.some(group => group.semanticEntityRef === 'Aurora' || group.semanticEntityRef === 'Borealis'), false)
  assert.equal(groups.find(group => group.semanticEntityRef === 'Rescue Truck')?.diagnostics.some(item => item.code === 'ACTOR_FACTION_UNRESOLVED'), false)
})
