import assert from 'node:assert/strict'
import test from 'node:test'
import type { Artifact, ArtifactInput } from '@ise/agent-core'
import {
  EVIDENCE_IR_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  EVENT_PLAN_DRAFT_ARTIFACT,
} from '../src/contracts/artifactTypes.ts'
import { eventPlanSchema, type EventPlan } from '../src/contracts/eventPlan.ts'
import type { EvidenceIR, EvidenceRecord } from '../src/contracts/evidence.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { createEventPlanTools } from '../src/tools/eventPlanTools.ts'
import { testAgentContext } from './helpers.ts'

test('propose_event_plan rejects an unknown evidence reference', async () => {
  const context = testAgentContext()
  seedEvidence(context.artifacts.create.bind(context.artifacts), [evidenceRecord('ev-known')])
  const propose = eventPlanTool('propose_event_plan')

  await assert.rejects(
    propose.execute(eventPlan({ evidenceRefs: ['ev-missing'] }), context),
    /Unknown evidence reference: ev-missing/,
  )
})

test('propose_event_plan creates a fingerprinted draft and supersedes the prior version', async () => {
  const context = testAgentContext()
  seedEvidence(context.artifacts.create.bind(context.artifacts), [evidenceRecord('ev-known')])
  const propose = eventPlanTool('propose_event_plan')

  const firstResult = await propose.execute(eventPlan({ version: 1 }), context)
  const [first] = context.artifacts.createMany(firstResult.artifacts ?? [])
  const secondPlan = eventPlan({ version: 2 })
  const secondResult = await propose.execute(secondPlan, context)
  const [second] = context.artifacts.createMany(secondResult.artifacts ?? [])

  assert.ok(first)
  assert.ok(second)
  assert.equal(second.type, EVENT_PLAN_DRAFT_ARTIFACT)
  assert.equal(second.createdBy, 'agent')
  assert.equal(second.logicalKey, 'event-plan:plan-1')
  assert.equal(second.metadata?.fingerprint, fingerprint(secondPlan))
  assert.equal(second.metadata?.status, 'draft')
  assert.equal(second.supersedes, first.id)
  assert.equal(context.artifacts.get(first.id)?.superseded, true)
  assert.deepEqual(context.artifacts.list(EVENT_PLAN_DRAFT_ARTIFACT).map(item => item.id), [second.id])
})

test('propose_event_plan only accepts EvidenceIR model inferences as plain inference refs', async () => {
  const context = testAgentContext()
  seedEvidence(context.artifacts.create.bind(context.artifacts), [
    evidenceRecord('ev-fact'),
    evidenceRecord('ev-model', 'model_inference'),
  ])
  const propose = eventPlanTool('propose_event_plan')

  await assert.rejects(
    propose.execute(eventPlan({ evidenceRefs: [], inferenceRefs: ['ev-fact'] }), context),
    /Invalid inference reference: ev-fact/,
  )

  const result = await propose.execute(
    eventPlan({ evidenceRefs: [], inferenceRefs: ['ev-model'] }),
    context,
  )
  assert.equal(result.artifacts?.[0]?.type, EVENT_PLAN_DRAFT_ARTIFACT)
})

test('propose_event_plan requires uncertainty for every unit using a synthetic inference ref', async () => {
  const context = testAgentContext()
  seedEvidence(context.artifacts.create.bind(context.artifacts), [evidenceRecord('ev-known')])
  const propose = eventPlanTool('propose_event_plan')

  await assert.rejects(
    propose.execute(eventPlan({
      evidenceRefs: [],
      inferenceRefs: ['inference:aircraft-identity'],
      uncertainties: [],
    }), context),
    /Inference reference requires uncertainty: inference:aircraft-identity/,
  )

  const result = await propose.execute(eventPlan({
    evidenceRefs: [],
    inferenceRefs: ['inference:aircraft-identity'],
    uncertainties: ['Aircraft identity is not confirmed'],
  }), context)
  assert.equal(result.artifacts?.[0]?.type, EVENT_PLAN_DRAFT_ARTIFACT)
})

test('propose_event_plan requires active EvidenceIR for the same document', async () => {
  const context = testAgentContext()
  seedEvidence(
    context.artifacts.create.bind(context.artifacts),
    [evidenceRecord('ev-known')],
    'doc-other',
  )

  await assert.rejects(
    eventPlanTool('propose_event_plan').execute(eventPlan(), context),
    /No active EvidenceIR artifact found for document: doc-1/,
  )
})

test('accept_event_plan rejects version and requested fingerprint mismatches', async () => {
  const context = testAgentContext()
  seedEvidence(context.artifacts.create.bind(context.artifacts), [evidenceRecord('ev-known')])
  const draft = await proposeAndStore(context, eventPlan())
  const accept = eventPlanTool('accept_event_plan')
  const draftFingerprint = requiredFingerprint(draft)

  await assert.rejects(
    accept.execute({ draftArtifactId: draft.id, version: 2, fingerprint: draftFingerprint }, context),
    /Draft version mismatch/,
  )
  await assert.rejects(
    accept.execute({ draftArtifactId: draft.id, version: 1, fingerprint: 'sha256:not-the-draft' }, context),
    /Draft fingerprint mismatch/,
  )
})

test('accept_event_plan rejects a stored fingerprint that does not match draft data', async () => {
  const context = testAgentContext()
  const plan = eventPlan()
  const draft = context.artifacts.create<EventPlan>({
    type: EVENT_PLAN_DRAFT_ARTIFACT,
    createdBy: 'agent',
    logicalKey: `event-plan:${plan.planId}`,
    data: plan,
    metadata: {
      planId: plan.planId,
      documentId: plan.documentId,
      version: plan.version,
      fingerprint: 'sha256:stored-but-invalid',
      status: 'draft',
    },
  })

  await assert.rejects(
    eventPlanTool('accept_event_plan').execute({
      draftArtifactId: draft.id,
      version: draft.data.version,
      fingerprint: requiredFingerprint(draft),
    }, context),
    /Stored draft fingerprint does not match draft data/,
  )
})

test('accept_event_plan accepts the exact draft tuple without mutating the draft', async () => {
  const context = testAgentContext()
  seedEvidence(context.artifacts.create.bind(context.artifacts), [evidenceRecord('ev-known')])
  const firstDraft = await proposeAndStore(context, eventPlan({ version: 1 }))
  await proposeAndStore(context, eventPlan({ version: 2 }))
  const beforeAcceptance = context.artifacts.get<EventPlan>(firstDraft.id)
  assert.ok(beforeAcceptance)

  const result = await eventPlanTool('accept_event_plan').execute({
    draftArtifactId: firstDraft.id,
    version: firstDraft.data.version,
    fingerprint: requiredFingerprint(firstDraft),
  }, context)

  assert.deepEqual(context.artifacts.get<EventPlan>(firstDraft.id), beforeAcceptance)
  const [acceptedInput] = result.artifacts ?? []
  assert.ok(acceptedInput)
  assert.equal(acceptedInput.type, EVENT_PLAN_ACCEPTED_ARTIFACT)
  assert.equal(acceptedInput.createdBy, 'user')
  assert.equal(acceptedInput.logicalKey, 'accepted-event-plan:plan-1')
  assert.deepEqual(eventPlanSchema.parse(acceptedInput.data), firstDraft.data)
  assert.deepEqual(acceptedInput.metadata, {
    planId: 'plan-1',
    documentId: 'doc-1',
    version: 1,
    fingerprint: requiredFingerprint(firstDraft),
    acceptedDraftArtifactId: firstDraft.id,
    status: 'accepted',
  })
})

test('accept_event_plan requires the exact draft artifact ID', async () => {
  await assert.rejects(
    eventPlanTool('accept_event_plan').execute({
      draftArtifactId: 'missing-draft',
      version: 1,
      fingerprint: fingerprint(eventPlan()),
    }, testAgentContext()),
    /EventPlan draft not found: missing-draft/,
  )
})

test('event plan tools expose constrained risk and input contracts', () => {
  const propose = eventPlanTool('propose_event_plan')
  const accept = eventPlanTool('accept_event_plan')

  assert.equal(propose.risk, 'derive')
  assert.equal(accept.risk, 'write')
  assert.deepEqual(accept.inputSchema, {
    type: 'object',
    additionalProperties: false,
    required: ['draftArtifactId', 'version', 'fingerprint'],
    properties: {
      draftArtifactId: { type: 'string', minLength: 1 },
      version: { type: 'integer', minimum: 1 },
      fingerprint: { type: 'string', minLength: 1 },
    },
  })
  const properties = accept.inputSchema.properties
  assert.ok(properties && typeof properties === 'object')
  assert.equal(Object.prototype.hasOwnProperty.call(properties, 'model'), false)
})

function eventPlan(overrides: {
  version?: number
  evidenceRefs?: string[]
  inferenceRefs?: string[]
  uncertainties?: string[]
} = {}): EventPlan {
  return eventPlanSchema.parse({
    schemaVersion: 'event-plan/v1',
    planId: 'plan-1',
    documentId: 'doc-1',
    version: overrides.version ?? 1,
    eventUnits: [{
      eventUnitId: 'event-1',
      title: 'First engagement',
      worldStateChange: 'The opposing forces enter active engagement.',
      participants: ['Blue force', 'Red force'],
      locationRefs: ['location-border'],
      realWorldTime: '2025-05-07T10:00:00Z',
      evidenceRefs: overrides.evidenceRefs ?? ['ev-known'],
      inferenceRefs: overrides.inferenceRefs ?? [],
      uncertainties: overrides.uncertainties ?? [],
      narrativePurpose: 'Establish the opening engagement.',
      importance: 'high',
    }],
    omittedEvidence: [],
    warnings: [],
  })
}

function evidenceRecord(
  evidenceId: string,
  kind: EvidenceRecord['kind'] = 'explicit_fact',
): EvidenceRecord {
  return {
    evidenceId,
    sourceRef: `doc:doc-1:paragraph:${evidenceId}`,
    claim: `Claim for ${evidenceId}`,
    kind,
    entities: [],
    confidence: 1,
    ambiguities: [],
  }
}

function seedEvidence(
  create: (input: ArtifactInput<EvidenceIR>) => Artifact<EvidenceIR>,
  records: EvidenceRecord[],
  documentId = 'doc-1',
): Artifact<EvidenceIR> {
  return create({
    type: EVIDENCE_IR_ARTIFACT,
    createdBy: 'tool',
    logicalKey: `evidence:${documentId}`,
    data: {
      schemaVersion: 'evidence-ir/v1',
      documentId,
      records,
    },
    metadata: { documentId },
  })
}

function eventPlanTool(name: 'propose_event_plan' | 'accept_event_plan') {
  const tool = createEventPlanTools().find(item => item.name === name)
  assert.ok(tool)
  return tool
}

async function proposeAndStore(
  context: ReturnType<typeof testAgentContext>,
  plan: EventPlan,
): Promise<Artifact<EventPlan>> {
  const result = await eventPlanTool('propose_event_plan').execute(plan, context)
  const [draft] = context.artifacts.createMany(result.artifacts ?? [])
  assert.ok(draft)
  return context.artifacts.get<EventPlan>(draft.id)!
}

function requiredFingerprint(draft: Artifact<EventPlan>): string {
  const value = draft.metadata?.fingerprint
  assert.ok(typeof value === 'string')
  return value
}
