import assert from 'node:assert/strict'
import test from 'node:test'
import type { EvidenceIR } from '../src/contracts/evidence.ts'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import type { NarrativePlan } from '../src/contracts/narrativePlan.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { buildNarrationPlan } from '../src/planning/narrationPlanner.ts'
import { resolveQuantity } from '../src/planning/quantityResolver.ts'
import { buildSceneBlueprint } from '../src/planning/sceneBlueprintPlanner.ts'

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
        worldStateChange: 'Pakistan launches a PL-15E missile',
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
        evidenceId: 'ev-launch', sourceRef: 'docx:p7', claim: '巴方发射PL-15E导弹。',
        kind: 'explicit_fact', entities: ['JF-17', 'PL-15E导弹'], locationExpression: '米纳斯',
        confidence: 1, ambiguities: [],
      },
    ]),
  }
}

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
