import assert from 'node:assert/strict'
import test from 'node:test'
import type { EvidenceIR } from '../src/contracts/evidence.ts'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import type { NarrativePlan } from '../src/contracts/narrativePlan.ts'
import type { AssetRegistryEntry, AssetRegistrySnapshot } from '../src/contracts/assetRegistry.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { CompilationError, diagnostic } from '../src/services/runtimeDiagnostics.ts'
import { buildNarrationPlan } from '../src/planning/narrationPlanner.ts'
import { resolveQuantity } from '../src/planning/quantityResolver.ts'
import { buildSceneBlueprint } from '../src/planning/sceneBlueprintPlanner.ts'
import { resolveSceneBlueprint } from '../src/planning/resolveSceneBlueprint.ts'
import { indoPakTrajectoryScenario } from '../src/config/indoPakTrajectoryScenario.ts'
import { buildTrajectoryCatalog } from '../src/services/trajectoryCatalog.ts'
import { compileChoreography } from '../src/compiler/choreographyCompiler.ts'

function evidence(records: EvidenceIR['records']): EvidenceIR {
  return { schemaVersion: 'evidence-ir/v1', documentId: 'doc-indo-pak', records }
}

const quantityEvidence = evidence([
  {
    evidenceId: 'ev-rafale-count',
    sourceRef: 'docx:p4',
    claim: '4架阵风战斗机从安巴拉升空。',
    kind: 'explicit_fact',
    entities: ['阵风', '安巴拉'],
    locationExpression: '安巴拉',
    confidence: 1,
    ambiguities: [],
  },
  {
    evidenceId: 'ev-su30-count',
    sourceRef: 'docx:p5',
    claim: '四架苏-30MKI战斗机从阿达姆普尔起飞。',
    kind: 'explicit_fact',
    entities: ['苏-30MKI', '阿达姆普尔'],
    locationExpression: '阿达姆普尔',
    confidence: 1,
    ambiguities: [],
  },
])

test('resolves an Arabic exact quantity from evidence associated with the entity', () => {
  assert.deepEqual(resolveQuantity({
    entityName: '阵风',
    platformType: 'fighter',
    role: 'formation',
    evidence: quantityEvidence,
  }), {
    value: 4,
    constraint: 'exact',
    source: 'evidence',
    evidenceRefs: ['ev-rafale-count'],
    reason: 'Explicit quantity adjacent to entity',
  })
})

test('resolves a Chinese exact quantity from evidence associated with the entity', () => {
  assert.deepEqual(resolveQuantity({
    entityName: '苏-30MKI',
    platformType: 'fighter',
    role: 'formation',
    evidence: quantityEvidence,
  }), {
    value: 4,
    constraint: 'exact',
    source: 'evidence',
    evidenceRefs: ['ev-su30-count'],
    reason: 'Explicit quantity adjacent to entity',
  })
})

test('associates an exact quantity with the requested entity in a multi-quantity claim', () => {
  const decision = resolveQuantity({
    entityName: 'PL-15E导弹',
    platformType: 'weapon',
    role: 'launch',
    evidence: evidence([{
      evidenceId: 'ev-mixed-counts', sourceRef: 'docx:p8',
      claim: '2架JF-17战斗机发射1枚PL-15E导弹。', kind: 'explicit_fact',
      entities: ['JF-17', 'PL-15E导弹'], confidence: 1, ambiguities: [],
    }]),
  })
  assert.equal(decision.value, 1)
  assert.equal(decision.source, 'evidence')
})

test('does not apply an aircraft quantity to an unquantified missile in the same claim', () => {
  assert.deepEqual(resolveQuantity({
    entityName: 'PL-15E导弹',
    platformType: 'weapon',
    role: 'launch',
    evidence: evidence([{
      evidenceId: 'ev-aircraft-only-count', sourceRef: 'docx:p8',
      claim: '2架JF-17战斗机发射PL-15E导弹。', kind: 'explicit_fact',
      entities: ['JF-17', 'PL-15E导弹'], confidence: 1, ambiguities: [],
    }]),
  }), {
    value: 1,
    constraint: 'unknown',
    source: 'default',
    evidenceRefs: [],
    defaultPolicyId: 'single-launch/v1',
    reason: 'No explicit quantity; applied single-launch/v1',
  })
})

test('does not apply the nearest other fighter quantity to an unquantified fighter', () => {
  const decision = resolveQuantity({
    entityName: '阵风',
    platformType: 'fighter',
    role: 'formation',
    evidence: evidence([{
      evidenceId: 'ev-other-fighter-count', sourceRef: 'docx:p5',
      claim: '2架苏-30MKI战斗机与阵风编队共同升空。', kind: 'explicit_fact',
      entities: ['苏-30MKI', '阵风'], confidence: 1, ambiguities: [],
    }]),
  })
  assert.equal(decision.value, 4)
  assert.equal(decision.source, 'default')
})

test('does not treat one destroyed fighter as the full formation quantity', () => {
  const decision = resolveQuantity({
    entityName: '阵风',
    platformType: 'fighter',
    role: 'formation',
    evidence: evidence([{
      evidenceId: 'ev-rafale-loss', sourceRef: 'docx:p9',
      claim: 'PL-15E命中并击毁一架印方阵风战机。', kind: 'explicit_fact',
      entities: ['PL-15E', '阵风'], confidence: 1, ambiguities: [],
    }]),
  })

  assert.equal(decision.value, 4)
  assert.equal(decision.source, 'default')
})

test('does not treat one emergency-landing fighter as the full formation quantity', () => {
  const decision = resolveQuantity({
    entityName: '苏-30MKI',
    platformType: 'fighter',
    role: 'formation',
    evidence: evidence([{
      evidenceId: 'ev-su30-landing', sourceRef: 'docx:p10',
      claim: '撤离过程中一架受损印方苏-30MKI实施紧急迫降。', kind: 'explicit_fact',
      entities: ['苏-30MKI'], confidence: 1, ambiguities: [],
    }]),
  })

  assert.equal(decision.value, 4)
  assert.equal(decision.source, 'default')
})

test('does not partially parse unsupported compound Chinese numerals', () => {
  assert.deepEqual(resolveQuantity({
    entityName: 'JF-17',
    platformType: 'fighter',
    role: 'formation',
    evidence: evidence([{
      evidenceId: 'ev-unsupported-chinese-count', sourceRef: 'docx:p5',
      claim: '十一架JF-17战斗机升空。', kind: 'explicit_fact',
      entities: ['JF-17'], confidence: 1, ambiguities: [],
    }]),
  }), {
    value: 4,
    constraint: 'unknown',
    source: 'default',
    evidenceRefs: [],
    defaultPolicyId: 'fighter-formation/v1',
    reason: 'No explicit quantity; applied fighter-formation/v1',
  })
})

test('does not partially parse a supported token after an unsupported Chinese numeral', () => {
  assert.deepEqual(resolveQuantity({
    entityName: 'JF-17',
    platformType: 'fighter',
    role: 'formation',
    evidence: evidence([{
      evidenceId: 'ev-unsupported-shorthand-count', sourceRef: 'docx:p5',
      claim: '廿一架JF-17战斗机升空。', kind: 'explicit_fact',
      entities: ['JF-17'], confidence: 1, ambiguities: [],
    }]),
  }), {
    value: 4,
    constraint: 'unknown',
    source: 'default',
    evidenceRefs: [],
    defaultPolicyId: 'fighter-formation/v1',
    reason: 'No explicit quantity; applied fighter-formation/v1',
  })
})

test('uses the auditable fighter formation default without factual evidence refs', () => {
  assert.deepEqual(resolveQuantity({
    entityName: 'JF-17',
    platformType: 'fighter',
    role: 'formation',
    evidence: evidence([{
      evidenceId: 'ev-jf17', sourceRef: 'docx:p6', claim: 'JF-17编队升空。',
      kind: 'explicit_fact', entities: ['JF-17'], confidence: 1, ambiguities: [],
    }]),
  }), {
    value: 4,
    constraint: 'unknown',
    source: 'default',
    evidenceRefs: [],
    defaultPolicyId: 'fighter-formation/v1',
    reason: 'No explicit quantity; applied fighter-formation/v1',
  })
})

test('uses the single-launch default for each explicit unquantified launch', () => {
  assert.deepEqual(resolveQuantity({
    entityName: 'PL-15E导弹',
    platformType: 'weapon',
    role: 'launch',
    evidence: evidence([{
      evidenceId: 'ev-launch', sourceRef: 'docx:p9', claim: '巴方发射PL-15E导弹。',
      kind: 'explicit_fact', entities: ['PL-15E导弹'], confidence: 1, ambiguities: [],
    }]),
  }), {
    value: 1,
    constraint: 'unknown',
    source: 'default',
    evidenceRefs: [],
    defaultPolicyId: 'single-launch/v1',
    reason: 'No explicit quantity; applied single-launch/v1',
  })
})

test('rejects a user value that conflicts with an exact evidence quantity', () => {
  assert.throws(() => resolveQuantity({
    entityName: '阵风',
    platformType: 'fighter',
    role: 'formation',
    evidence: quantityEvidence,
    userValue: 3,
  }), /FACTUAL_QUANTITY_CONFLICT/)
})

test('uses a valid user value instead of a default', () => {
  const decision = resolveQuantity({
    entityName: 'JF-17',
    platformType: 'fighter',
    role: 'formation',
    evidence: evidence([]),
    userValue: 2,
  })
  assert.deepEqual(decision, {
    value: 2,
    constraint: 'exact',
    source: 'user',
    evidenceRefs: [],
    reason: 'User quantity overrides default policy',
  })
})

function planningFixture(): {
  eventPlan: EventPlan
  narrativePlan: NarrativePlan
  evidence: EvidenceIR
} {
  const eventPlan: EventPlan = {
    schemaVersion: 'event-plan/v1',
    planId: 'event-plan:indo-pak',
    documentId: 'doc-indo-pak',
    version: 3,
    eventUnits: [
      {
        eventUnitId: 'event:deployment',
        title: 'Fighter deployment',
        worldStateChange: 'Indian and Pakistani fighter formations become airborne',
        participants: ['苏-30MKI', '阵风', 'JF-17'],
        locationRefs: ['阿达姆普尔', '安巴拉', '米纳斯', '拉菲基'],
        evidenceRefs: ['ev-su30', 'ev-rafale', 'ev-jf17-locations'],
        inferenceRefs: [],
        uncertainties: [],
        narrativePurpose: 'Establish the opposing fighter formations',
        importance: 'high',
      },
      {
        eventUnitId: 'event:launch',
        title: 'Missile launch',
        worldStateChange: 'Pakistan launches a PL-15E missile to intercept an incoming missile',
        participants: ['JF-17', 'PL-15E导弹'],
        locationRefs: ['米纳斯'],
        evidenceRefs: ['ev-launch'],
        inferenceRefs: [],
        uncertainties: [],
        narrativePurpose: 'Show the explicit weapon launch',
        importance: 'high',
      },
    ],
    omittedEvidence: [],
    warnings: [],
  }
  const eventPlanFingerprint = fingerprint(eventPlan)
  const narrativePlan: NarrativePlan = {
    schemaVersion: 'narrative-plan/v1',
    narrativePlanId: 'narrative:indo-pak',
    sourceEventPlan: {
      artifactId: 'accepted:event-plan:indo-pak:v3',
      planId: eventPlan.planId,
      version: eventPlan.version,
      fingerprint: eventPlanFingerprint,
    },
    targetDurationMs: 180_000,
    subtitles: [
      {
        subtitleId: 'subtitle:deployment',
        eventUnitId: 'event:deployment',
        text: '印方苏-30MKI与阵风编队升空，巴方JF-17从米纳斯和拉菲基出动。',
        evidenceRefs: ['ev-su30', 'ev-rafale', 'ev-jf17-locations'],
        importance: 'high',
      },
      {
        subtitleId: 'subtitle:launch',
        eventUnitId: 'event:launch',
        text: '随后，巴方发射PL-15E导弹。',
        evidenceRefs: ['ev-launch'],
        importance: 'high',
      },
      {
        subtitleId: 'subtitle:ungrounded',
        eventUnitId: 'event:launch',
        text: 'This claim is not grounded and must not be copied.',
        evidenceRefs: ['ev-not-linked-to-event'],
        importance: 'low',
      },
    ],
    sceneRequirements: [
      {
        requirementId: 'requirement:deployment',
        eventUnitId: 'event:deployment',
        focusEntities: ['苏-30MKI', '阵风', 'JF-17'],
        spatialRelations: ['depart from grounded bases'],
        stateChanges: ['grounded to airborne'],
        motionRequirements: ['formation departure'],
        attentionRequirements: ['show all grounded formations'],
        requiredFacts: ['Fighter formations deploy from the named locations'],
        forbiddenClaims: ['Unreported aircraft quantities'],
        preferredTemplate: 'deployment',
      },
      {
        requirementId: 'requirement:launch',
        eventUnitId: 'event:launch',
        focusEntities: ['PL-15E导弹'],
        spatialRelations: ['launch from the Pakistani formation'],
        stateChanges: ['stored to launched'],
        motionRequirements: ['weapon launch'],
        attentionRequirements: ['follow the launched weapon'],
        requiredFacts: ['A missile is launched'],
        forbiddenClaims: ['Confirmed target destruction'],
        preferredTemplate: 'attack_chain',
      },
    ],
  }
  return {
    eventPlan,
    narrativePlan,
    evidence: evidence([
      {
        evidenceId: 'ev-su30', sourceRef: 'docx:p4',
        claim: '2架苏-30MKI战斗机从阿达姆普尔升空。', kind: 'explicit_fact',
        entities: ['苏-30MKI', '阿达姆普尔'], locationExpression: '阿达姆普尔',
        confidence: 1, ambiguities: [],
      },
      {
        evidenceId: 'ev-rafale', sourceRef: 'docx:p4',
        claim: '4架阵风战斗机从安巴拉升空。', kind: 'explicit_fact',
        entities: ['阵风', '安巴拉'], locationExpression: '安巴拉', confidence: 1, ambiguities: [],
      },
      {
        evidenceId: 'ev-jf17-locations', sourceRef: 'docx:p5',
        claim: 'JF-17编队分别从米纳斯和拉菲基出动。', kind: 'explicit_fact',
        entities: ['JF-17', '米纳斯', '拉菲基'], locationExpression: '米纳斯、拉菲基',
        confidence: 1, ambiguities: [],
      },
      {
        evidenceId: 'ev-launch', sourceRef: 'docx:p7', claim: 'Pakistan launches a PL-15E missile to intercept an incoming missile.',
        kind: 'explicit_fact', entities: ['JF-17', 'PL-15E导弹'], locationExpression: '米纳斯',
        confidence: 1, ambiguities: [],
      },
    ]),
  }
}

function blueprintWithEnglishAliasQuantities() {
  const fixture = planningFixture()
  fixture.evidence = {
    ...fixture.evidence,
    records: fixture.evidence.records.map(record => {
      if (record.evidenceId === 'ev-su30') return {
        ...record,
        claim: '2架Su-30MKI fighters depart from Adampur.',
        entities: ['Su-30MKI', 'Adampur'],
        locationExpression: 'Adampur',
      }
      if (record.evidenceId === 'ev-rafale') return {
        ...record,
        claim: '3架Rafale fighters depart from Ambala.',
        entities: ['Rafale', 'Ambala'],
        locationExpression: 'Ambala',
      }
      return record
    }),
  }
  const narrationPlan = buildNarrationPlan(fixture)
  return buildSceneBlueprint({ ...fixture, narrationPlan })
}

test('uses exact Su-30MKI quantity from English alias evidence with canonical actor identity', () => {
  const group = blueprintWithEnglishAliasQuantities().actorGroups
    .find(candidate => candidate.groupId === 'group:india-su30-adampur')

  assert.equal(group?.semanticEntityRef, '苏-30MKI')
  assert.deepEqual(group?.quantityDecision, {
    value: 2,
    constraint: 'exact',
    source: 'evidence',
    evidenceRefs: ['ev-su30'],
    reason: 'Explicit quantity adjacent to entity',
  })
})

test('uses exact Rafale quantity from English alias evidence with canonical actor identity', () => {
  const group = blueprintWithEnglishAliasQuantities().actorGroups
    .find(candidate => candidate.groupId === 'group:india-rafale-ambala')

  assert.equal(group?.semanticEntityRef, '阵风')
  assert.deepEqual(group?.quantityDecision, {
    value: 3,
    constraint: 'exact',
    source: 'evidence',
    evidenceRefs: ['ev-rafale'],
    reason: 'Explicit quantity adjacent to entity',
  })
})

test('buildNarrationPlan preserves grounded subtitles and binds the accepted EventPlan fingerprint', () => {
  const { eventPlan, narrativePlan } = planningFixture()
  const narration = buildNarrationPlan({ eventPlan, narrativePlan })

  assert.equal(narration.sourceEventPlanId, eventPlan.planId)
  assert.equal(narration.sourceEventPlanFingerprint, fingerprint(eventPlan))
  assert.equal(narration.sourceNarrativePlanId, narrativePlan.narrativePlanId)
  assert.deepEqual(narration.beats.map(({ subtitleId, eventUnitId, text, evidenceRefs }) => ({
    subtitleId, eventUnitId, text, evidenceRefs,
  })), narrativePlan.subtitles.slice(0, 2).map(({ subtitleId, eventUnitId, text, evidenceRefs }) => ({
    subtitleId, eventUnitId, text, evidenceRefs,
  })))
  assert.ok(narration.beats.every(beat => beat.estimatedDurationMs > 0))
})

test('every primary SceneBeat binds one existing subtitle and its EventUnit', () => {
  const fixture = planningFixture()
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })
  const subtitles = new Map(narrationPlan.beats.map(beat => [beat.subtitleId, beat.eventUnitId]))

  assert.equal(blueprint.sourceNarrationPlanId, narrationPlan.narrationPlanId)
  assert.equal(blueprint.sourceNarrationFingerprint, fingerprint(narrationPlan))
  assert.ok(blueprint.sceneBeats.length > 0)
  assert.ok(blueprint.sceneBeats.every(beat => beat.subtitleId !== undefined))
  for (const beat of blueprint.sceneBeats) {
    assert.equal(subtitles.get(beat.subtitleId!), beat.eventUnitId)
  }
})

test('derives media intents for each narrative template and enriches the final beat', () => {
  const fixture = planningFixture()
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })

  assert.deepEqual(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:deployment')?.mediaIntents,
    ['image'],
  )
  assert.deepEqual(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:launch')?.mediaIntents,
    ['video', 'image'],
  )
})

function planningFixtureWithParticipants(
  participantsByEvent: Partial<Record<string, string[]>>,
) {
  const fixture = planningFixture()
  for (const unit of fixture.eventPlan.eventUnits) {
    const participants = participantsByEvent[unit.eventUnitId]
    if (participants) unit.participants = [...participants]
  }
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)
  return fixture
}

function planningFixtureWithAwacs() {
  const fixture = planningFixture()
  fixture.eventPlan.eventUnits.push(
    {
      eventUnitId: 'event:india-awacs',
      title: 'Indian early warning support',
      worldStateChange: '印方Netra预警机提供早期预警支援。',
      participants: ['印方预警机'],
      locationRefs: ['印方预警机驻留点'],
      evidenceRefs: ['ev-india-awacs'],
      inferenceRefs: [],
      uncertainties: [],
      narrativePurpose: 'Show Indian early-warning support',
      importance: 'high',
    },
    {
      eventUnitId: 'event:pakistan-awacs',
      title: 'Pakistani early warning support',
      worldStateChange: '巴方Saab 2000 Erieye预警机提供早期预警支援。',
      participants: ['巴方预警机'],
      locationRefs: ['巴方预警机驻留点'],
      evidenceRefs: ['ev-pakistan-awacs'],
      inferenceRefs: [],
      uncertainties: [],
      narrativePurpose: 'Show Pakistani early-warning support',
      importance: 'high',
    },
  )
  fixture.evidence.records.push(
    {
      evidenceId: 'ev-india-awacs', sourceRef: 'docx:p3',
      claim: '印方Netra AEW&CS预警机提供早期预警支援。', kind: 'explicit_fact',
      entities: ['印方预警机', 'Netra AEW&CS'], confidence: 1, ambiguities: [],
    },
    {
      evidenceId: 'ev-pakistan-awacs', sourceRef: 'docx:p3',
      claim: '巴方Saab 2000 Erieye预警机提供早期预警支援。', kind: 'explicit_fact',
      entities: ['巴方预警机', 'Saab 2000 Erieye'], confidence: 1, ambiguities: [],
    },
  )
  fixture.narrativePlan.subtitles.push(
    {
      subtitleId: 'subtitle:india-awacs', eventUnitId: 'event:india-awacs',
      text: '印方Netra预警机提供早期预警支援。', evidenceRefs: ['ev-india-awacs'], importance: 'high',
    },
    {
      subtitleId: 'subtitle:pakistan-awacs', eventUnitId: 'event:pakistan-awacs',
      text: '巴方预警机提供早期预警支援。', evidenceRefs: ['ev-pakistan-awacs'], importance: 'high',
    },
  )
  fixture.narrativePlan.sceneRequirements.push(
    {
      requirementId: 'requirement:india-awacs', eventUnitId: 'event:india-awacs',
      focusEntities: ['印方预警机'], spatialRelations: ['stationary support position'],
      stateChanges: [], motionRequirements: ['hold position'], attentionRequirements: ['show Indian AWACS'],
      requiredFacts: ['Indian early-warning support'], forbiddenClaims: [], preferredTemplate: 'deployment',
    },
    {
      requirementId: 'requirement:pakistan-awacs', eventUnitId: 'event:pakistan-awacs',
      focusEntities: ['巴方预警机'], spatialRelations: ['stationary support position'],
      stateChanges: [], motionRequirements: ['hold position'], attentionRequirements: ['show Pakistani AWACS'],
      requiredFacts: ['Pakistani early-warning support'], forbiddenClaims: ['Pakistan operates E-3A'],
      preferredTemplate: 'deployment',
    },
  )
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)
  return fixture
}

test('creates one persistent AWACS group per evidenced side and binds only the corresponding beats', () => {
  const fixture = planningFixtureWithAwacs()
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })
  const awacs = blueprint.actorGroups.filter(group => group.role === 'early-warning-support')

  assert.deepEqual(awacs.map(group => ({
    id: group.groupId,
    entity: group.semanticEntityRef,
    side: group.side,
    quantity: group.quantityDecision,
    formation: group.formationPattern,
    leader: group.leaderPolicy,
    profile: group.behaviorProfile,
    lifecycle: group.lifecycle,
  })), [
    {
      id: 'group:india-netra-awacs', entity: 'Netra AEW&CS', side: 'india',
      quantity: {
        value: 1, constraint: 'unknown', source: 'default', evidenceRefs: [],
        defaultPolicyId: 'single-node/v1', reason: 'No explicit quantity; applied single-node/v1',
      },
      formation: 'single', leader: 'single-member', profile: 'awacs-support/india/v1', lifecycle: 'scene-persistent',
    },
    {
      id: 'group:pakistan-awacs-proxy', entity: '巴方预警机（通用示意模型）', side: 'pakistan',
      quantity: {
        value: 1, constraint: 'unknown', source: 'default', evidenceRefs: [],
        defaultPolicyId: 'single-node/v1', reason: 'No explicit quantity; applied single-node/v1',
      },
      formation: 'single', leader: 'single-member', profile: 'awacs-support/pakistan/v1', lifecycle: 'scene-persistent',
    },
  ])
  assert.deepEqual(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:india-awacs')?.actorRefs,
    ['group:india-netra-awacs'],
  )
  assert.deepEqual(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:pakistan-awacs')?.actorRefs,
    ['group:pakistan-awacs-proxy'],
  )
})

test('does not create or bind either side for an unqualified generic AWACS fact', () => {
  const fixture = planningFixture()
  fixture.eventPlan.eventUnits[0]!.participants = ['预警机']
  fixture.eventPlan.eventUnits[0]!.evidenceRefs = ['ev-generic-awacs']
  fixture.evidence.records = [{
    evidenceId: 'ev-generic-awacs', sourceRef: 'docx:p3', claim: '预警机提供早期预警支援。',
    kind: 'explicit_fact', entities: ['预警机'], confidence: 1, ambiguities: ['Side is unspecified'],
  }]
  fixture.narrativePlan.subtitles[0]!.evidenceRefs = ['ev-generic-awacs']
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })
  assert.deepEqual(blueprint.actorGroups.filter(group => group.role === 'early-warning-support'), [])
  assert.equal(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:deployment')?.actorRefs
      .some(ref => ref.includes('awacs')),
    false,
  )
})

test('creates an event-scoped generic missile actor from grounded launch facts when participants omit the weapon', () => {
  const fixture = planningFixtureWithParticipants({
    'event:launch': ['巴方JF-17编队'],
  })
  const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
  launch.worldStateChange = 'Pakistan launches a missile toward the opposing formation'
  fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
    ? {
        ...record,
        claim: '巴方JF-17编队发射导弹，攻击对方编队。',
        entities: ['巴方JF-17编队'],
      }
    : record)
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })
  const weapon = blueprint.actorGroups.find(group => group.role === 'weapon-launch')

  assert.deepEqual(weapon, {
    groupId: 'group:weapon-event-launch',
    semanticEntityRef: 'missile',
    side: 'pakistan',
    locationRef: '米纳斯',
    platformType: 'missile',
    role: 'weapon-launch',
    quantityDecision: {
      value: 1,
      constraint: 'unknown',
      source: 'default',
      evidenceRefs: [],
      defaultPolicyId: 'single-launch/v1',
      reason: 'No explicit quantity; applied single-launch/v1',
    },
    formationPattern: 'single',
    leaderPolicy: 'single-member',
    behaviorProfile: 'weapon-launch/v1',
    lifecycle: 'event-scoped:event:launch',
  })
  assert.equal(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:launch')?.actorRefs.includes(weapon!.groupId),
    true,
  )
})

test('uses generic missile when only ungrounded event text or participants name a specific missile model', () => {
  const fixture = planningFixtureWithParticipants({
    'event:launch': ['巴方JF-17编队', 'PL-15E导弹'],
  })
  const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
  launch.title = 'PL-15E missile launch'
  launch.worldStateChange = 'Pakistan launches a PL-15E missile'
  fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
    ? {
        ...record,
        claim: '巴方JF-17编队发射导弹。',
        entities: ['巴方JF-17编队'],
      }
    : record)
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })
  const weapon = blueprint.actorGroups.find(group => group.role === 'weapon-launch')

  assert.equal(weapon?.semanticEntityRef, 'missile')
  assert.equal(weapon?.platformType, 'missile')
})

test('uses only completed factual launch records when linked launch claims conflict', () => {
  const fixture = planningFixtureWithParticipants({
    'event:launch': ['印方阵风编队', '巴方JF-17编队'],
  })
  const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
  launch.worldStateChange = 'Pakistan launches a missile.'
  launch.evidenceRefs = ['ev-launch-negative', 'ev-launch-positive']
  fixture.evidence.records = fixture.evidence.records.flatMap(record => record.evidenceId === 'ev-launch'
    ? [
        {
          ...record,
          evidenceId: 'ev-launch-negative',
          claim: 'India did not launch a PL-15 missile.',
          entities: ['India', 'PL-15 missile'],
        },
        {
          ...record,
          evidenceId: 'ev-launch-positive',
          claim: 'Pakistan launches a missile.',
          entities: ['Pakistan'],
        },
      ]
    : [record])
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })
  const weapon = blueprint.actorGroups.find(group => group.role === 'weapon-launch')

  assert.equal(weapon?.semanticEntityRef, 'missile')
  assert.equal(weapon?.side, 'pakistan')
  assert.deepEqual(weapon?.quantityDecision.evidenceRefs, [])
})

test('derives exact scenario-local behavior profiles for grounded missile launch roles', () => {
  const cases = [
    {
      state: 'India launches a missile as the first strike.',
      claim: 'India launches a missile as the first strike.',
      participants: ['印方苏-30MKI编队'],
      expected: 'weapon-launch/india-first-strike/v1',
    },
    {
      state: 'Pakistan launches a missile to intercept an incoming missile.',
      claim: 'Pakistan launches a missile to intercept an incoming missile.',
      participants: ['巴方JF-17编队'],
      expected: 'weapon-launch/pakistan-intercept/v1',
    },
    {
      state: 'Pakistan launches a missile in counterattack against Rafale.',
      claim: 'Pakistan launches a missile in counterattack against Rafale.',
      participants: ['巴方JF-17编队'],
      expected: 'weapon-launch/pakistan-counterattack/v1',
    },
  ]
  for (const { state, claim, participants, expected } of cases) {
    const fixture = planningFixtureWithParticipants({ 'event:launch': participants })
    const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
    launch.worldStateChange = state
    fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
      ? { ...record, claim, entities: participants }
      : record)
    fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

    const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })

    assert.equal(blueprint.actorGroups.find(group => group.role === 'weapon-launch')?.behaviorProfile, expected)
  }
})

test('derives the weapon side from the launcher rather than an earlier opposing target participant', () => {
  const fixture = planningFixtureWithParticipants({
    'event:launch': ['印方阵风编队', '巴方JF-17编队'],
  })
  const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
  launch.worldStateChange = 'Pakistani JF-17 launches a missile at the Indian Rafale formation'
  fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
    ? {
        ...record,
        claim: '巴方JF-17编队发射导弹，攻击印方阵风编队。',
        entities: ['巴方JF-17编队', '印方阵风编队'],
      }
    : record)
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })

  assert.equal(blueprint.actorGroups.find(group => group.role === 'weapon-launch')?.side, 'pakistan')
})

test('derives the weapon side when launcher actions continue across a comma', () => {
  const fixture = planningFixtureWithParticipants({
    'event:launch': ['巴方预警机', '巴方JF-17', '巴方拦截导弹', '印方来袭导弹'],
  })
  const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
  const claim = '巴方预警力量发现来袭导弹后向前线JF-17编队发布威胁信息；JF-17编队调整航向和队形，发射一枚拦截导弹。'
  launch.worldStateChange = claim
  fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
    ? { ...record, claim, entities: ['巴方JF-17', '巴方拦截导弹', '印方来袭导弹'] }
    : record)
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })
  const weapon = blueprint.actorGroups.find(group => group.role === 'weapon-launch')

  assert.equal(weapon?.side, 'pakistan')
  assert.equal(weapon?.behaviorProfile, 'weapon-launch/pakistan-intercept/v1')
})

test('keeps weapon side unknown when no launcher can be identified', () => {
  const fixture = planningFixtureWithParticipants({
    'event:launch': ['印方阵风编队', '巴方JF-17编队'],
  })
  const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
  launch.worldStateChange = 'A missile is launched during the engagement'
  fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
    ? {
        ...record,
        claim: '交战中发射导弹。',
        entities: [],
      }
    : record)
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })

  assert.equal(blueprint.actorGroups.find(group => group.role === 'weapon-launch')?.side, 'unknown')
})

test('does not create weapon actors for preparatory Chinese or English launch language', () => {
  const cases = [
    { state: '巴方完成导弹发射准备，火控开启。', claim: '巴方完成导弹发射准备，火控开启。' },
    { state: 'Pakistan plans to launch a missile.', claim: 'Pakistan plans to launch a missile.' },
  ]
  for (const { state, claim } of cases) {
    const fixture = planningFixtureWithParticipants({ 'event:launch': ['巴方JF-17编队'] })
    const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
    launch.worldStateChange = state
    fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
      ? { ...record, claim, entities: ['巴方JF-17编队'] }
      : record)
    fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

    const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })

    assert.equal(blueprint.actorGroups.some(group => group.role === 'weapon-launch'), false, state)
  }
})

test('does not create weapon actors for negated, cancelled, or aborted launch claims', () => {
  const cases = [
    'Pakistan did not launch a missile.',
    'The missile was not launched.',
    'The missile was never launched.',
    'The missile failed to launch.',
    'The missile launch was cancelled.',
    'The missile launch was aborted.',
    '巴方未发射导弹。',
    '巴方没有发射导弹。',
    '巴方取消发射导弹。',
  ]
  for (const claim of cases) {
    const fixture = planningFixtureWithParticipants({ 'event:launch': ['巴方JF-17编队'] })
    const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
    launch.worldStateChange = claim
    fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
      ? { ...record, claim, entities: ['巴方JF-17编队'] }
      : record)
    fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

    const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })

    assert.equal(blueprint.actorGroups.some(group => group.role === 'weapon-launch'), false, claim)
  }
})

test('allows a completed launch when only the title contains pre-launch language', () => {
  const fixture = planningFixtureWithParticipants({ 'event:launch': ['巴方JF-17编队'] })
  const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
  launch.title = 'Pre-launch checks'
  launch.worldStateChange = 'Pakistan launches a missile.'
  fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
    ? { ...record, claim: 'Pakistan launches a missile.', entities: ['巴方JF-17编队'] }
    : record)
  fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })

  assert.equal(blueprint.actorGroups.some(group => group.role === 'weapon-launch'), true)
})

test('keeps weapon side unknown for passive or non-attributable launch language with both sides mentioned', () => {
  const cases = [
    'Pakistani JF-17 and Indian Rafale engaged before a missile was launched.',
    'Pakistani JF-17 and Indian Rafale engaged before a missile launched.',
  ]
  for (const claim of cases) {
    const fixture = planningFixtureWithParticipants({
      'event:launch': ['巴方JF-17编队', '印方阵风编队'],
    })
    const launch = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'event:launch')!
    launch.worldStateChange = claim
    fixture.evidence.records = fixture.evidence.records.map(record => record.evidenceId === 'ev-launch'
      ? {
          ...record,
          claim,
          entities: ['巴方JF-17编队', '印方阵风编队'],
        }
      : record)
    fixture.narrativePlan.sourceEventPlan.fingerprint = fingerprint(fixture.eventPlan)

    const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })

    assert.equal(blueprint.actorGroups.find(group => group.role === 'weapon-launch')?.side, 'unknown', claim)
  }
})

test('binds scenario-local platform formation labels to their known fighter groups', () => {
  const fixture = planningFixtureWithParticipants({
    'event:deployment': ['印方苏-30MKI编队', '印方阵风编队', '巴方JF-17编队'],
  })
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })

  assert.deepEqual(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:deployment')?.actorRefs,
    [
      'group:india-su30-adampur',
      'group:india-rafale-ambala',
      'group:pakistan-jf17-minhas',
      'group:pakistan-jf17-rafiki',
    ],
  )
})

test('binds only every fighter group on the explicitly named generic side', () => {
  const cases = [
    {
      participant: '印方编队',
      expected: ['group:india-su30-adampur', 'group:india-rafale-ambala'],
    },
    {
      participant: '巴方编队',
      expected: ['group:pakistan-jf17-minhas', 'group:pakistan-jf17-rafiki'],
    },
  ]
  for (const { participant, expected } of cases) {
    const fixture = planningFixtureWithParticipants({ 'event:deployment': [participant] })
    const narrationPlan = buildNarrationPlan(fixture)
    const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })
    assert.deepEqual(
      blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:deployment')?.actorRefs,
      expected,
      participant,
    )
  }
})

test('binds the controlled Pakistani interceptor-formation label to Pakistani fighters', () => {
  const fixture = planningFixtureWithParticipants({ 'event:deployment': ['巴方拦截编队'] })
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })

  assert.deepEqual(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:deployment')?.actorRefs,
    ['group:pakistan-jf17-minhas', 'group:pakistan-jf17-rafiki'],
  )
})

test('does not expand an Indian early-warning-aircraft label to Indian fighters', () => {
  const fixture = planningFixtureWithParticipants({ 'event:deployment': ['印方预警机'] })
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })

  assert.deepEqual(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:deployment')?.actorRefs,
    [],
  )
})

test('real participant forms bind every resolved actor and compile deterministic choreography', () => {
  const fixture = planningFixtureWithParticipants({
    'event:deployment': ['印方苏-30MKI编队', '印方阵风编队', '巴方编队'],
    'event:launch': ['巴方JF-17编队', 'PL-15E导弹'],
  })
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })
  const assetRegistry = resolutionRegistry()
  const resolvedScenePlan = resolveSceneBlueprint({ blueprint, assetRegistry })
  const choreography = compileChoreography({
    narrationPlan,
    sceneBlueprint: blueprint,
    resolvedScenePlan,
    assetRegistry,
  })
  const repeatedBlueprint = buildSceneBlueprint({ ...fixture, narrationPlan })
  const repeatedResolvedScenePlan = resolveSceneBlueprint({
    blueprint: repeatedBlueprint,
    assetRegistry,
  })
  const repeatedChoreography = compileChoreography({
    narrationPlan,
    sceneBlueprint: repeatedBlueprint,
    resolvedScenePlan: repeatedResolvedScenePlan,
    assetRegistry,
  })

  assert.equal(JSON.stringify(repeatedBlueprint), JSON.stringify(blueprint))
  assert.equal(JSON.stringify(repeatedChoreography), JSON.stringify(choreography))
  assert.deepEqual(choreography.actorInstances, resolvedScenePlan.resolvedActors)
  for (const actor of resolvedScenePlan.resolvedActors) {
    assert.ok(
      blueprint.sceneBeats.some(beat => beat.actorRefs.includes(actor.actorGroupRef)),
      actor.actorInstanceId,
    )
  }
  const weaponGroup = blueprint.actorGroups.find(group => group.role === 'weapon-launch')
  assert.ok(weaponGroup)
  assert.equal(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:deployment')?.actorRefs.includes(weaponGroup.groupId),
    false,
  )
  assert.equal(
    blueprint.sceneBeats.find(beat => beat.eventUnitId === 'event:launch')?.actorRefs.includes(weaponGroup.groupId),
    true,
  )
})

test('splits JF-17 into Minhas and Rafiki groups only when both locations are grounded', () => {
  const fixture = planningFixture()
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })
  const jf17Groups = blueprint.actorGroups.filter(group => group.platformType === 'JF-17')

  assert.deepEqual(jf17Groups.map(group => group.groupId), [
    'group:pakistan-jf17-minhas',
    'group:pakistan-jf17-rafiki',
  ])
  assert.deepEqual(jf17Groups.map(group => group.locationRef), ['米纳斯', '拉菲基'])
  assert.ok(jf17Groups.every(group => group.quantityDecision.value === 4))
})

test('does not create actors for spare routes or scenario-local catalog labels', () => {
  const fixture = planningFixture()
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })

  assert.deepEqual(blueprint.actorGroups.map(group => group.groupId), [
    'group:india-su30-adampur',
    'group:india-rafale-ambala',
    'group:pakistan-jf17-minhas',
    'group:pakistan-jf17-rafiki',
    'group:weapon-event-launch',
  ])
  assert.equal(blueprint.actorGroups.some(group => /vampire|j-?10ce/i.test(group.semanticEntityRef)), false)
  assert.deepEqual(blueprint.diagnostics.map(item => item.code), [
    'SCENARIO_LOCAL_CALLSIGN_MAPPING',
    'OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY',
  ])
})

test('planning is byte-identical for the same inputs and defaults never rewrite subtitles', () => {
  const fixture = planningFixture()
  const firstNarration = buildNarrationPlan(fixture)
  const firstBlueprint = buildSceneBlueprint({ ...fixture, narrationPlan: firstNarration })
  const secondNarration = buildNarrationPlan(fixture)
  const secondBlueprint = buildSceneBlueprint({ ...fixture, narrationPlan: secondNarration })

  assert.equal(JSON.stringify(firstNarration), JSON.stringify(secondNarration))
  assert.equal(JSON.stringify(firstBlueprint), JSON.stringify(secondBlueprint))
  assert.deepEqual(firstNarration.beats.map(beat => beat.text), fixture.narrativePlan.subtitles.slice(0, 2).map(item => item.text))
  const launchGroup = firstBlueprint.actorGroups.find(group => group.groupId === 'group:weapon-event-launch')
  assert.equal(launchGroup?.quantityDecision.defaultPolicyId, 'single-launch/v1')
  assert.deepEqual(launchGroup?.quantityDecision.evidenceRefs, [])
})

test('resolves shared entity quantities within each grounded location', () => {
  const fixture = planningFixture()
  fixture.evidence = evidence([
    {
      evidenceId: 'ev-jf17-minhas', sourceRef: 'docx:p1', claim: '2架JF-17 fighters depart from Minhas.',
      kind: 'explicit_fact', entities: ['JF-17', 'Minhas'], locationExpression: 'Minhas', confidence: 1, ambiguities: [],
    },
    {
      evidenceId: 'ev-jf17-rafiki', sourceRef: 'docx:p2', claim: '4架JF-17 fighters depart from Rafiki.',
      kind: 'explicit_fact', entities: ['JF-17', 'Rafiki'], locationExpression: 'Rafiki', confidence: 1, ambiguities: [],
    },
  ])
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })

  assert.deepEqual(blueprint.actorGroups.filter(group => group.groupId.includes('jf17')).map(group => [group.groupId, group.quantityDecision.value]), [
    ['group:pakistan-jf17-minhas', 2],
    ['group:pakistan-jf17-rafiki', 4],
  ])
})

test('buildSceneBlueprint records the selected ScenarioPack lineage', () => {
  const fixture = planningFixture()
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan: buildNarrationPlan(fixture) })

  assert.deepEqual(blueprint.scenarioPack, {
    packId: 'indo-pak-air-combat/v1',
    version: '1',
  })
})

const routeIds = [
  ...Array.from({ length: 4 }, (_, index) => `trajectory:adampur-vampire-${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `trajectory:ambala-rafale-${index + 1}`),
  ...Array.from({ length: 2 }, (_, index) => `trajectory:ambala-su30mki-${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `trajectory:minhas-j10ce-${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `trajectory:rafiki-j10ce-${index + 1}`),
  'trajectory:india-missile-1',
  'trajectory:pakistan-missile-1',
  'trajectory:pakistan-strike-missile-2',
] as const

const registryHash = `sha256:${'7'.repeat(64)}`

function resolutionRegistry(): AssetRegistrySnapshot {
  const assets: AssetRegistryEntry[] = routeIds.map((assetId, index) => ({
    assetId,
    kind: 'trajectory',
    displayName: assetId,
    aliases: [],
    fingerprint: `sha256:${(index + 1).toString(16).padStart(64, '0')}`,
    size: 10,
    availability: 'available',
    criticality: 'required',
    fallbackAssetIds: [],
    allowFallback: false,
    mediaType: 'application/vnd.ise.trajectory+json',
    trajectory: {
      format: 'ise-trajectory/v1',
      timeUnit: 'ms',
      coordinateOrder: 'lng-lat-alt',
      startTimeMs: 0,
      endTimeMs: 180_000,
      monotonic: true,
    },
  }))
  return { schemaVersion: 'asset-registry/v1', registryVersion: registryHash, assets, diagnostics: [] }
}

function resolvedFixture() {
  const fixture = planningFixture()
  const narrationPlan = buildNarrationPlan(fixture)
  const blueprint = buildSceneBlueprint({ ...fixture, narrationPlan })
  const assetRegistry = resolutionRegistry()
  return { blueprint, assetRegistry, resolved: resolveSceneBlueprint({ blueprint, assetRegistry }) }
}

test('resolveSceneBlueprint expands exact quantities into stable leaders and wingmen deterministically', () => {
  const first = resolvedFixture()
  const second = resolveSceneBlueprint({ blueprint: first.blueprint, assetRegistry: first.assetRegistry })

  assert.equal(JSON.stringify(first.resolved), JSON.stringify(second))
  assert.equal(first.resolved.resolvedActors.length, 15)
  assert.deepEqual(first.resolved.resolvedActors.slice(0, 2).map(actor => actor.actorInstanceId), [
    'actor:india-rafale-ambala:leader',
    'actor:india-rafale-ambala:wingman-1',
  ])
  assert.equal(first.resolved.resolvedActors.filter(actor => actor.role === 'leader').length, 5)
  assert.equal(first.resolved.actorRouteAssignments.length, first.resolved.resolvedActors.length)
})

test('resolveSceneBlueprint assigns unique registered routes with exact source fingerprints and no fallback', () => {
  const { blueprint, assetRegistry, resolved } = resolvedFixture()
  const assignedRoutes = resolved.actorRouteAssignments.map(assignment => assignment.trajectoryAssetRef)

  assert.equal(new Set(assignedRoutes).size, assignedRoutes.length)
  assert.equal(resolved.actorRouteAssignments.every(assignment => assignment.sourceKind === 'catalog'), true)
  assert.deepEqual(resolved.fallbackTrajectoryRecipes, [])
  assert.equal(resolved.sourceBlueprintId, blueprint.blueprintId)
  assert.equal(resolved.sourceBlueprintFingerprint, fingerprint(blueprint))
  assert.equal(resolved.trajectoryCatalogFingerprint, buildTrajectoryCatalog(assetRegistry).fingerprint)
  assert.notEqual(resolved.scenarioMappingFingerprint, '')
  assert.deepEqual(resolved.scenarioPack, blueprint.scenarioPack)
  assert.equal(resolved.diagnostics.some(item => item.message.includes('Vampire')), true)
  assert.equal(resolved.diagnostics.some(item => item.message.includes('J-10CE')), true)
})

test('resolveSceneBlueprint propagates route capacity exhaustion instead of synthesizing routes', () => {
  const fixture = resolvedFixture()
  const actorGroups = fixture.blueprint.actorGroups.map(group => group.groupId === 'group:india-rafale-ambala'
    ? { ...group, quantityDecision: { ...group.quantityDecision, value: 5 } }
    : group)

  assert.throws(
    () => resolveSceneBlueprint({ blueprint: { ...fixture.blueprint, actorGroups }, assetRegistry: fixture.assetRegistry }),
    (error: unknown) => error instanceof CompilationError
      && error.diagnostics.some(item => item.code === 'TRAJECTORY_BUNDLE_CAPACITY_EXCEEDED'),
  )
})

test('resolveSceneBlueprint rejects unknown ScenarioPack lineage and supports legacy blueprints without lineage', () => {
  const fixture = resolvedFixture()
  assert.throws(
    () => resolveSceneBlueprint({ blueprint: { ...fixture.blueprint, scenarioPack: { packId: 'missing/v1', version: '1' } }, assetRegistry: fixture.assetRegistry }),
    (error: unknown) => error instanceof CompilationError && error.diagnostics.some(item => item.code === 'SCENARIO_PACK_UNAVAILABLE'),
  )
  const legacy = resolveSceneBlueprint({ blueprint: { ...fixture.blueprint, scenarioPack: undefined }, assetRegistry: fixture.assetRegistry })
  assert.equal(legacy.scenarioPack, undefined)
  assert.equal(legacy.resolvedActors.length, fixture.resolved.resolvedActors.length)
})

test('compileChoreography preserves every resolved actor with stable beat-bounded lifecycles', () => {
  const fixture = resolvedFixture()
  const first = compileChoreography({
    narrationPlan: buildNarrationPlan(planningFixture()),
    sceneBlueprint: fixture.blueprint,
    resolvedScenePlan: fixture.resolved,
    assetRegistry: fixture.assetRegistry,
  })
  const second = compileChoreography({
    narrationPlan: buildNarrationPlan(planningFixture()),
    sceneBlueprint: fixture.blueprint,
    resolvedScenePlan: fixture.resolved,
    assetRegistry: fixture.assetRegistry,
  })

  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.deepEqual(first.actorInstances, fixture.resolved.resolvedActors)
  assert.equal(first.actorLifecycles.length, fixture.resolved.resolvedActors.length)
  for (const actor of fixture.resolved.resolvedActors) {
    const references = fixture.blueprint.sceneBeats
      .filter(beat => beat.actorRefs.includes(actor.actorGroupRef))
      .map(beat => beat.sceneBeatId)
    assert.ok(references.length > 0, actor.actorInstanceId)
    assert.deepEqual(
      first.actorLifecycles.filter(item => item.actorInstanceRef === actor.actorInstanceId),
      [{
        actorInstanceRef: actor.actorInstanceId,
        firstSceneBeatRef: references[0],
        lastSceneBeatRef: references.at(-1),
      }],
    )
  }
  assert.equal(first.sourceResolvedScenePlanFingerprint, fingerprint(fixture.resolved))
})

test('compileChoreography gives every actor catalog-route motion and same-group formation segments', () => {
  const fixture = resolvedFixture()
  const choreography = compileChoreography({
    narrationPlan: buildNarrationPlan(planningFixture()),
    sceneBlueprint: fixture.blueprint,
    resolvedScenePlan: fixture.resolved,
    assetRegistry: fixture.assetRegistry,
  })

  for (const actor of fixture.resolved.resolvedActors) {
    const assignment = fixture.resolved.actorRouteAssignments.find(
      item => item.actorInstanceRef === actor.actorInstanceId,
    )
    assert.ok(assignment)
    assert.equal(assignment.sourceKind, 'catalog')
    assert.ok(choreography.motionSegments.some(segment =>
      segment.actorInstanceRef === actor.actorInstanceId
      && segment.routeAssignmentRef === assignment.segmentId))
  }
  assert.equal(
    new Set(fixture.resolved.actorRouteAssignments.map(item => item.trajectoryAssetRef)).size,
    fixture.resolved.resolvedActors.length,
  )
  for (const formation of choreography.formationSegments) {
    const groups = new Set(formation.actorInstanceRefs.map(actorId =>
      fixture.resolved.resolvedActors.find(actor => actor.actorInstanceId === actorId)?.actorGroupRef))
    assert.equal(groups.size, 1)
    assert.ok(formation.actorInstanceRefs.length > 1)
  }
  assert.ok(choreography.formationSegments.length > 0)
  assert.deepEqual(choreography.weaponEngagements, [])
})

test('compileChoreography binds one shot and exact 800ms visual lead to every narration beat', () => {
  const planning = planningFixture()
  const narrationPlan = buildNarrationPlan(planning)
  const fixture = resolvedFixture()
  const choreography = compileChoreography({
    narrationPlan,
    sceneBlueprint: fixture.blueprint,
    resolvedScenePlan: fixture.resolved,
    assetRegistry: fixture.assetRegistry,
  })

  assert.equal(choreography.shotPlan.length, narrationPlan.beats.length)
  for (const beat of narrationPlan.beats) {
    const sceneBeat = fixture.blueprint.sceneBeats.find(item => item.subtitleId === beat.subtitleId)
    assert.ok(sceneBeat)
    const expectedSubjects = fixture.resolved.resolvedActors
      .filter(actor => sceneBeat.actorRefs.includes(actor.actorGroupRef))
      .map(actor => actor.actorInstanceId)
    assert.deepEqual(
      choreography.shotPlan.find(shot => shot.subtitleId === beat.subtitleId)?.subjectRefs,
      expectedSubjects,
    )
    assert.deepEqual(
      choreography.timeConstraints.filter(constraint => constraint.subjectRef === beat.subtitleId),
      [{
        constraintId: `time:${beat.subtitleId}:subtitle-visual-lead`,
        subjectRef: beat.subtitleId,
        kind: 'subtitle-visual-lead',
        valueMs: 800,
      }],
    )
  }
})

test('compileChoreography keeps an actorless subtitle beat by using the nearest scene subjects', () => {
  const planning = planningFixture()
  planning.narrativePlan.subtitles.splice(2, 0, {
    subtitleId: 'subtitle:status',
    eventUnitId: 'event:launch',
    text: 'The status explanation remains grounded in the launch event.',
    evidenceRefs: ['ev-launch'],
    importance: 'medium',
  })
  const narrationPlan = buildNarrationPlan(planning)
  const generatedBlueprint = buildSceneBlueprint({ ...planning, narrationPlan })
  const sceneBeats = generatedBlueprint.sceneBeats.map((beat, index) => index === 2
    ? { ...beat, actorRefs: [] }
    : beat)
  const blueprint = { ...generatedBlueprint, sceneBeats }
  const assetRegistry = resolutionRegistry()
  const resolvedScenePlan = resolveSceneBlueprint({ blueprint, assetRegistry })

  const choreography = compileChoreography({
    narrationPlan,
    sceneBlueprint: blueprint,
    resolvedScenePlan,
    assetRegistry,
  })

  const previous = choreography.shotPlan.find(shot => shot.subtitleId === 'subtitle:launch')
  const status = choreography.shotPlan.find(shot => shot.subtitleId === 'subtitle:status')
  assert.ok(previous)
  assert.ok(status)
  assert.deepEqual(status.subjectRefs, previous.subjectRefs)
  assert.deepEqual(status.sceneBeatRefs, [sceneBeats[2]!.sceneBeatId])
  for (const actorInstanceRef of status.subjectRefs) {
    assert.equal(
      choreography.actorLifecycles.find(item => item.actorInstanceRef === actorInstanceRef)?.lastSceneBeatRef,
      sceneBeats[2]!.sceneBeatId,
    )
  }
})

test('compileChoreography rejects synthesized trajectory diagnostics instead of hiding them', () => {
  const planning = planningFixture()
  const narrationPlan = buildNarrationPlan(planning)
  const fixture = resolvedFixture()
  const resolvedScenePlan = {
    ...fixture.resolved,
    diagnostics: [
      ...fixture.resolved.diagnostics,
      diagnostic('TRAJECTORY_SYNTHESIZED', 'Synthetic route is forbidden'),
    ],
  }

  assert.throws(() => compileChoreography({
    narrationPlan,
    sceneBlueprint: fixture.blueprint,
    resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  }), (error: unknown) => error instanceof CompilationError
    && error.diagnostics.some(item => item.code === 'CHOREOGRAPHY_ROUTE_ASSIGNMENT_INVALID'))
})
