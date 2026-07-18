import assert from 'node:assert/strict'
import test from 'node:test'
import type { EvidenceIR } from '../src/contracts/evidence.ts'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import type { ScenarioPack } from '../src/contracts/scenarioPack.ts'
import { planActorGroups } from '../src/planning/semanticActorPlanner.ts'

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
