import assert from 'node:assert/strict'
import test from 'node:test'
import type { EvidenceIR } from '../src/contracts/evidence.ts'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import { sceneBlueprintSchema, type ActorGroupIntent } from '../src/contracts/sceneBlueprint.ts'
import { planEngagementIntents } from '../src/planning/engagementIntentPlanner.ts'

function actorGroup(input: {
  groupId: string
  aliases: string[]
  side: string
  kind?: ActorGroupIntent['platformKind']
  lifecycle?: string
  evidenceRefs?: string[]
}): ActorGroupIntent {
  const kind = input.kind ?? 'aircraft'
  return {
    groupId: input.groupId,
    semanticEntityRef: input.aliases[0]!,
    evidenceRefs: input.evidenceRefs ?? [],
    side: input.side,
    locationRef: 'location:test',
    platformType: kind,
    role: kind === 'weapon' ? 'weapon-launch' : 'formation',
    quantityDecision: {
      value: 1,
      constraint: 'exact',
      source: 'evidence',
      evidenceRefs: input.evidenceRefs ?? [],
      reason: 'Test fixture',
    },
    formationPattern: 'single',
    leaderPolicy: 'single-member',
    behaviorProfile: `${kind}/v1`,
    lifecycle: input.lifecycle ?? 'scene-persistent',
    aliases: input.aliases,
    participantAliases: input.aliases,
    platformKind: kind,
    diagnostics: [],
  }
}

function fixture(): {
  eventPlan: EventPlan
  evidence: EvidenceIR
  actorGroups: ActorGroupIntent[]
} {
  const evidence: EvidenceIR = {
    schemaVersion: 'evidence-ir/v1',
    documentId: 'doc:northern-passage',
    records: [
      {
        evidenceId: 'ev:launch-1', sourceRef: 'docx:p4',
        claim: 'Blue Rafale launched one PL-15E missile at Red J-10.',
        kind: 'explicit_fact', entities: ['Blue Rafale', 'PL-15E', 'Red J-10'], confidence: 1, ambiguities: [],
      },
      {
        evidenceId: 'ev:outcome-1', sourceRef: 'docx:p5',
        claim: 'The first PL-15E destroyed the targeted Red J-10.',
        kind: 'explicit_fact', entities: ['PL-15E', 'Red J-10'], confidence: 1, ambiguities: [],
      },
      {
        evidenceId: 'ev:launch-2', sourceRef: 'docx:p6',
        claim: 'Red J-10 fired one PL-15E missile toward Blue Rafale.',
        kind: 'explicit_fact', entities: ['Red J-10', 'PL-15E', 'Blue Rafale'], confidence: 1, ambiguities: [],
      },
      {
        evidenceId: 'ev:outcome-2', sourceRef: 'docx:p7',
        claim: 'The second PL-15E outcome was unconfirmed; a report that Blue Rafale was destroyed was not verified.',
        kind: 'explicit_fact', entities: ['PL-15E', 'Blue Rafale'], confidence: 1, ambiguities: [],
      },
    ],
  }
  const eventPlan: EventPlan = {
    schemaVersion: 'event-plan/v1', planId: 'event-plan:northern-passage', documentId: evidence.documentId,
    version: 1, omittedEvidence: [], warnings: [],
    eventUnits: [
      {
        eventUnitId: 'event:launch-1', title: 'First launch',
        worldStateChange: 'Blue Rafale launches a missile at Red J-10.',
        participants: ['Blue Rafale', 'PL-15E', 'Red J-10'], locationRefs: [],
        evidenceRefs: ['ev:launch-1', 'ev:outcome-1'], inferenceRefs: [], uncertainties: [],
        narrativePurpose: 'Show the first engagement', importance: 'high',
      },
      {
        eventUnitId: 'event:launch-2', title: 'Second launch',
        worldStateChange: 'Red J-10 fires a missile toward Blue Rafale.',
        participants: ['Red J-10', 'PL-15E', 'Blue Rafale'], locationRefs: [],
        evidenceRefs: ['ev:launch-2', 'ev:outcome-2'], inferenceRefs: [], uncertainties: [],
        narrativePurpose: 'Show the counter-engagement', importance: 'high',
      },
    ],
  }
  const actorGroups = [
    actorGroup({ groupId: 'group:blue-awacs', aliases: ['Blue E-3A', 'E-3A'], side: 'blue', kind: 'sensor' }),
    actorGroup({ groupId: 'group:blue-rafale', aliases: ['Blue Rafale', 'Rafale'], side: 'blue' }),
    actorGroup({ groupId: 'group:red-j10', aliases: ['Red J-10', 'J-10'], side: 'red' }),
    actorGroup({ groupId: 'group:weapon-launch-1', aliases: ['PL-15E'], side: 'blue', kind: 'weapon', lifecycle: 'event-scoped:event:launch-1', evidenceRefs: ['ev:launch-1'] }),
    actorGroup({ groupId: 'group:weapon-launch-2', aliases: ['PL-15E'], side: 'red', kind: 'weapon', lifecycle: 'event-scoped:event:launch-2', evidenceRefs: ['ev:launch-2'] }),
  ]
  return { eventPlan, evidence, actorGroups }
}

test('plans evidence-backed group relations for confirmed and unconfirmed engagements', () => {
  const planning = planEngagementIntents(fixture())

  assert.deepEqual(planning.intents.map(intent => ({
    launcher: intent.launcherGroupRef,
    weapon: intent.weaponGroupRef,
    target: intent.targetGroupRef,
    outcome: intent.assertedOutcome,
  })), [
    { launcher: 'group:blue-rafale', weapon: 'group:weapon-launch-1', target: 'group:red-j10', outcome: 'destroyed' },
    { launcher: 'group:red-j10', weapon: 'group:weapon-launch-2', target: 'group:blue-rafale', outcome: 'unconfirmed' },
  ])
  assert.deepEqual(planning.intents.map(intent => intent.evidenceRefs), [
    ['ev:launch-1', 'ev:outcome-1'],
    ['ev:launch-2', 'ev:outcome-2'],
  ])
  assert.deepEqual(planning.diagnostics, [])
})

test('does not plan an engagement for a negated launch', () => {
  const input = fixture()
  input.evidence.records[0] = {
    ...input.evidence.records[0]!,
    claim: 'Blue Rafale did not launch a PL-15E missile at Red J-10.',
  }
  input.eventPlan.eventUnits[0] = {
    ...input.eventPlan.eventUnits[0]!,
    worldStateChange: 'Blue Rafale did not launch a missile at Red J-10.',
  }

  const planning = planEngagementIntents(input)

  assert.deepEqual(planning.intents.map(intent => intent.eventUnitId), ['event:launch-2'])
  assert.deepEqual(planning.diagnostics, [])
})

test('resolves the direct object of a completed intercept action as the target', () => {
  const input = fixture()
  input.eventPlan.eventUnits = input.eventPlan.eventUnits.slice(0, 1)
  input.eventPlan.eventUnits[0] = {
    ...input.eventPlan.eventUnits[0]!,
    worldStateChange: 'Blue Rafale intercepted Red J-10 using a PL-15E missile.',
    evidenceRefs: ['ev:launch-1'],
  }
  input.evidence.records = [{
    ...input.evidence.records[0]!,
    claim: 'Blue Rafale intercepted Red J-10 using one PL-15E missile.',
  }]
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')

  const planning = planEngagementIntents(input)

  assert.deepEqual(planning.intents.map(intent => ({
    launcher: intent.launcherGroupRef,
    target: intent.targetGroupRef,
    outcome: intent.assertedOutcome,
  })), [{ launcher: 'group:blue-rafale', target: 'group:red-j10', outcome: 'intercepted' }])
  assert.deepEqual(planning.diagnostics, [])
})

test('omits an intent and emits a scoped diagnostic for an ambiguous launcher', () => {
  const input = fixture()
  input.eventPlan.eventUnits = input.eventPlan.eventUnits.slice(0, 1)
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')
  input.actorGroups.push(actorGroup({ groupId: 'group:blue-rafale-spare', aliases: ['Blue Rafale'], side: 'blue' }))

  const planning = planEngagementIntents(input)

  assert.deepEqual(planning.intents, [])
  assert.deepEqual(planning.diagnostics.map(item => ({ code: item.code, eventUnitId: item.eventUnitId })), [{
    code: 'ENGAGEMENT_PARTICIPANT_UNRESOLVED',
    eventUnitId: 'event:launch-1',
  }])
})

test('omits an intent and emits a scoped diagnostic for an ambiguous target', () => {
  const input = fixture()
  input.eventPlan.eventUnits = input.eventPlan.eventUnits.slice(0, 1)
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')
  input.actorGroups.push(actorGroup({ groupId: 'group:red-j10-spare', aliases: ['Red J-10'], side: 'red' }))

  const planning = planEngagementIntents(input)

  assert.deepEqual(planning.intents, [])
  assert.deepEqual(planning.diagnostics.map(item => ({ code: item.code, eventUnitId: item.eventUnitId })), [{
    code: 'ENGAGEMENT_PARTICIPANT_UNRESOLVED',
    eventUnitId: 'event:launch-1',
  }])
})

test('explicit unresolved wording wins over destruction wording', () => {
  const planning = planEngagementIntents(fixture())

  assert.equal(planning.intents[1]?.assertedOutcome, 'unconfirmed')
  assert.notEqual(planning.intents[1]?.assertedOutcome, 'destroyed')
})

test('does not confirm destruction from English negated destruction evidence', () => {
  const input = fixture()
  input.eventPlan.eventUnits = input.eventPlan.eventUnits.slice(0, 1)
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')
  input.evidence.records[1] = {
    ...input.evidence.records[1]!,
    claim: 'The Red J-10 was not destroyed.',
  }

  const planning = planEngagementIntents(input)

  assert.equal(planning.intents[0]?.assertedOutcome, 'unconfirmed')
  assert.deepEqual(planning.intents[0]?.evidenceRefs, ['ev:launch-1', 'ev:outcome-1'])
})

test('does not confirm destruction from Chinese negated destruction evidence', () => {
  const input = fixture()
  input.eventPlan.eventUnits = input.eventPlan.eventUnits.slice(0, 1)
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')
  input.evidence.records[1] = {
    ...input.evidence.records[1]!,
    claim: '\u76ee\u6807\u672a\u88ab\u51fb\u6bc1\u3002',
  }

  const planning = planEngagementIntents(input)

  assert.equal(planning.intents[0]?.assertedOutcome, 'unconfirmed')
  assert.deepEqual(planning.intents[0]?.evidenceRefs, ['ev:launch-1', 'ev:outcome-1'])
})

test('does not assert an outcome from illustrative evidence', () => {
  const input = fixture()
  input.eventPlan.eventUnits = input.eventPlan.eventUnits.slice(0, 1)
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')
  input.evidence.records[1] = { ...input.evidence.records[1]!, kind: 'illustrative' }

  const planning = planEngagementIntents(input)

  assert.equal(planning.intents[0]?.assertedOutcome, 'unconfirmed')
  assert.deepEqual(planning.intents[0]?.evidenceRefs, ['ev:launch-1'])
})

test('does not assert an outcome from evidence outside the launch event', () => {
  const input = fixture()
  input.eventPlan.eventUnits = [{
    ...input.eventPlan.eventUnits[0]!,
    evidenceRefs: ['ev:launch-1'],
  }]
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')

  const planning = planEngagementIntents(input)

  assert.equal(planning.intents[0]?.assertedOutcome, 'unconfirmed')
  assert.deepEqual(planning.intents[0]?.evidenceRefs, ['ev:launch-1'])
})

test('does not correlate an unrelated later destruction to a weapon launch', () => {
  const input = fixture()
  input.eventPlan.eventUnits = [
    { ...input.eventPlan.eventUnits[0]!, evidenceRefs: ['ev:launch-1'] },
    {
      ...input.eventPlan.eventUnits[0]!,
      eventUnitId: 'event:unrelated-destruction',
      title: 'Unrelated loss',
      worldStateChange: 'The first Red J-10 was destroyed in a runway accident.',
      participants: ['Red J-10'],
      evidenceRefs: ['ev:outcome-1'],
    },
  ]
  input.evidence.records = [
    input.evidence.records[0]!,
    {
      ...input.evidence.records[1]!,
      claim: 'The first Red J-10 was destroyed in a runway accident unrelated to any missile.',
      entities: ['Red J-10'],
    },
  ]
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')

  const planning = planEngagementIntents(input)

  assert.equal(planning.intents[0]?.assertedOutcome, 'unconfirmed')
  assert.deepEqual(planning.intents[0]?.evidenceRefs, ['ev:launch-1'])
  assert.deepEqual(planning.diagnostics, [])
})

test('does not correlate same-unit target-only ordinal destruction to the launch', () => {
  const input = fixture()
  input.eventPlan.eventUnits = [input.eventPlan.eventUnits[0]!]
  input.evidence.records = [
    input.evidence.records[0]!,
    {
      ...input.evidence.records[1]!,
      claim: 'The first Red J-10 was destroyed in a runway accident unrelated to any missile.',
      entities: ['Red J-10'],
    },
  ]
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')

  const planning = planEngagementIntents(input)

  assert.equal(planning.intents[0]?.assertedOutcome, 'unconfirmed')
  assert.deepEqual(planning.intents[0]?.evidenceRefs, ['ev:launch-1'])
  assert.deepEqual(planning.diagnostics, [])
})

test('keeps competing confirmed outcomes unresolved and emits a scoped ambiguity diagnostic', () => {
  const input = fixture()
  input.eventPlan.eventUnits = [
    { ...input.eventPlan.eventUnits[0]!, evidenceRefs: ['ev:launch-1'] },
    { ...input.eventPlan.eventUnits[0]!, eventUnitId: 'event:destroyed-outcome', title: 'Destroyed outcome',
      worldStateChange: 'The weapon destroyed its target.', evidenceRefs: ['ev:outcome-1'] },
    { ...input.eventPlan.eventUnits[0]!, eventUnitId: 'event:intercepted-outcome', title: 'Intercepted outcome',
      worldStateChange: 'The weapon intercepted its target.', evidenceRefs: ['ev:outcome-competing'] },
  ]
  input.evidence.records = [
    input.evidence.records[0]!,
    {
      ...input.evidence.records[1]!,
      claim: 'The PL-15E destroyed the targeted Red J-10.',
      entities: ['PL-15E', 'Red J-10'],
    },
    {
      evidenceId: 'ev:outcome-competing', sourceRef: 'docx:p5',
      claim: 'The PL-15E successfully intercepted the targeted Red J-10.',
      kind: 'explicit_fact', entities: ['PL-15E', 'Red J-10'], confidence: 1, ambiguities: [],
    },
  ]
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')

  const planning = planEngagementIntents(input)

  assert.equal(planning.intents[0]?.assertedOutcome, 'unconfirmed')
  assert.deepEqual(planning.intents[0]?.evidenceRefs, [
    'ev:launch-1',
    'ev:outcome-1',
    'ev:outcome-competing',
  ])
  assert.deepEqual(planning.diagnostics.map(item => ({ code: item.code, eventUnitId: item.eventUnitId })), [{
    code: 'ENGAGEMENT_OUTCOME_AMBIGUOUS',
    eventUnitId: 'event:launch-1',
  }])
})

test('preserves correlated chain facts that do not state the outcome', () => {
  const input = fixture()
  input.eventPlan.eventUnits = [
    { ...input.eventPlan.eventUnits[0]!, evidenceRefs: ['ev:launch-1'] },
    {
      ...input.eventPlan.eventUnits[0]!,
      eventUnitId: 'event:terminal-guidance',
      title: 'Terminal guidance',
      worldStateChange: 'The first missile receives terminal guidance.',
      evidenceRefs: ['ev:terminal-guidance'],
    },
    {
      ...input.eventPlan.eventUnits[0]!,
      eventUnitId: 'event:first-outcome',
      title: 'First outcome',
      worldStateChange: 'The target is confirmed destroyed.',
      evidenceRefs: ['ev:outcome-1'],
    },
  ]
  input.evidence.records = [
    input.evidence.records[0]!,
    {
      evidenceId: 'ev:terminal-guidance', sourceRef: 'docx:p4',
      claim: 'The first PL-15E receives terminal guidance until impact.',
      kind: 'explicit_fact', entities: ['PL-15E'], confidence: 1, ambiguities: [],
    },
    {
      ...input.evidence.records[1]!,
      claim: 'The first PL-15E destroyed the targeted Red J-10.',
      entities: ['PL-15E', 'Red J-10'],
    },
  ]
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')

  const planning = planEngagementIntents(input)

  assert.equal(planning.intents[0]?.assertedOutcome, 'destroyed')
  assert.deepEqual(planning.intents[0]?.evidenceRefs, [
    'ev:launch-1',
    'ev:terminal-guidance',
    'ev:outcome-1',
  ])
})

test('uses an explicit weapon ordinal to correlate an outcome after a later launch', () => {
  const input = fixture()
  input.eventPlan.eventUnits = [
    { ...input.eventPlan.eventUnits[0]!, evidenceRefs: ['ev:launch-1'] },
    { ...input.eventPlan.eventUnits[1]!, evidenceRefs: ['ev:launch-2'] },
    {
      ...input.eventPlan.eventUnits[0]!,
      eventUnitId: 'event:first-late-outcome',
      title: 'First weapon late outcome',
      worldStateChange: 'The first weapon destroyed its target.',
      evidenceRefs: ['ev:outcome-1'],
    },
  ]
  input.evidence.records = [
    input.evidence.records[0]!,
    input.evidence.records[2]!,
    {
      ...input.evidence.records[1]!,
      claim: 'The first PL-15E destroyed the targeted Red J-10.',
      entities: ['PL-15E', 'Red J-10'],
    },
  ]

  const planning = planEngagementIntents(input)

  assert.deepEqual(planning.intents.map(intent => ({
    eventUnitId: intent.eventUnitId,
    outcome: intent.assertedOutcome,
    evidenceRefs: intent.evidenceRefs,
  })), [
    {
      eventUnitId: 'event:launch-1',
      outcome: 'destroyed',
      evidenceRefs: ['ev:launch-1', 'ev:outcome-1'],
    },
    {
      eventUnitId: 'event:launch-2',
      outcome: 'unconfirmed',
      evidenceRefs: ['ev:launch-2'],
    },
  ])
})

test('omits an intent when multiple weapon groups resolve to one launch', () => {
  const input = fixture()
  input.eventPlan.eventUnits = input.eventPlan.eventUnits.slice(0, 1)
  input.actorGroups = input.actorGroups.filter(group => group.groupId !== 'group:weapon-launch-2')
  const weapon = input.actorGroups.find(group => group.groupId === 'group:weapon-launch-1')!
  input.actorGroups.push({ ...weapon, groupId: 'group:weapon-launch-1-duplicate' })

  const planning = planEngagementIntents(input)

  assert.deepEqual(planning.intents, [])
  assert.deepEqual(planning.diagnostics.map(item => ({ code: item.code, eventUnitId: item.eventUnitId })), [{
    code: 'ENGAGEMENT_PARTICIPANT_UNRESOLVED',
    eventUnitId: 'event:launch-1',
  }])
  assert.match(planning.diagnostics[0]?.message ?? '', /2 weapon groups/)
})

test('defaults engagement intents for scene blueprints created before the field existed', () => {
  const blueprint = sceneBlueprintSchema.parse({
    schemaVersion: 'ise.scene-blueprint/v1',
    blueprintId: 'blueprint:legacy',
    sourceNarrationPlanId: 'narration:legacy',
    sourceNarrationFingerprint: `sha256:${'0'.repeat(64)}`,
    actorGroups: [],
    sceneBeats: [],
    diagnostics: [],
  })

  assert.deepEqual(blueprint.engagementIntents, [])
})
