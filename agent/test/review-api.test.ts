import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelAdapter } from '@ise/agent-core'
import type { NestGateway } from '../src/adapters/nestGateway.ts'
import { createHttpApp } from '../src/api/httpApp.ts'
import {
  EVIDENCE_IR_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  EVENT_PLAN_DRAFT_ARTIFACT,
} from '../src/contracts/artifactTypes.ts'
import { eventPlanSchema } from '../src/contracts/eventPlan.ts'
import { AgentDatabase } from '../src/persistence/database.ts'
import { PersistentArtifactStore } from '../src/persistence/persistentArtifactStore.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { EventBroker } from '../src/session/eventBroker.ts'

class RecordingEventBroker extends EventBroker {
  readonly published: Array<{ id: string; type: string; data: Record<string, unknown> }> = []
  override publish(sessionId: string, event: Parameters<EventBroker['publish']>[1]): void {
    this.published.push(event)
    super.publish(sessionId, event)
  }
}

const model: ModelAdapter = { complete: async () => ({ content: 'downstream queued' }) }
const nest: NestGateway = {
  verifyBearer: async authorization => ({ subject: authorization.slice('Bearer '.length) }),
  readOwnedFile: async () => { throw new Error('unused') },
  listAssetMetadata: async () => [],
  readTrajectoryAsset: async () => { throw new Error('unused') },
}

async function fixture() {
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  const repositories = new AgentRepositories(database)
  const session = repositories.sessions.create('user-1')
  repositories.sessions.transition(session.id, ['idle'], 'awaiting_review')
  const artifacts = new PersistentArtifactStore(session.id, repositories.artifacts)
  artifacts.create({
    id: 'evidence-1', type: EVIDENCE_IR_ARTIFACT, createdBy: 'tool',
    data: {
      schemaVersion: 'evidence-ir/v1', documentId: 'doc-1', records: [{
        evidenceId: 'ev-1', sourceRef: 'paragraph:1', claim: 'Aircraft deployed',
        kind: 'explicit_fact', entities: ['JF-17'], confidence: 1, ambiguities: [],
      }],
    },
  })
  const plan = eventPlanSchema.parse({
    schemaVersion: 'event-plan/v1', planId: 'plan-1', documentId: 'doc-1', version: 1,
    eventUnits: [
      {
        eventUnitId: 'unit-1', title: 'Deploy', worldStateChange: 'JF-17 deployed',
        participants: ['JF-17'], locationRefs: ['border'], evidenceRefs: ['ev-1'], inferenceRefs: [],
        uncertainties: [], narrativePurpose: 'Opening', importance: 'high',
      },
      {
        eventUnitId: 'unit-2', title: 'Engage', worldStateChange: 'JF-17 engaged',
        participants: ['JF-17'], locationRefs: ['border'], evidenceRefs: ['ev-1'], inferenceRefs: [],
        uncertainties: [], narrativePurpose: 'Engagement', importance: 'medium',
      },
    ],
    omittedEvidence: [], warnings: [],
  })
  const planFingerprint = fingerprint(plan)
  const draft = artifacts.create({
    id: 'draft-1', type: EVENT_PLAN_DRAFT_ARTIFACT, version: 1, createdBy: 'agent',
    logicalKey: 'event-plan:plan-1', data: plan,
    metadata: { planId: 'plan-1', documentId: 'doc-1', version: 1, fingerprint: planFingerprint, status: 'draft' },
  })
  const review = repositories.reviews.createPending({
    sessionId: session.id, artifactId: draft.id, artifactVersion: 1, fingerprint: planFingerprint,
  })
  const events = new RecordingEventBroker(repositories.events)
  const app = await createHttpApp({ repositories, nest, modelFactory: () => model, events })
  return { app, database, repositories, events, sessionId: session.id, draft, review, plan }
}

function bearer() { return { authorization: 'Bearer user-1' } }

function associateReviewWithGenerationTurn(f: Awaited<ReturnType<typeof fixture>>) {
  const origin = f.repositories.runs.createQueued(f.sessionId, 'generate')
  f.repositories.runs.finish(origin.id, 'completed', undefined, {
    outcome: { status: 'completed', finalAnswer: 'Event plan drafted' },
  })
  f.repositories.events.append(f.sessionId, origin.id, 'review.requested', {
    runId: origin.id,
    reviewId: f.review.id,
    artifactId: f.review.artifactId,
    version: f.review.artifactVersion,
    fingerprint: f.review.fingerprint,
  })
  return origin
}

test('approve invokes accept_event_plan with a trusted exact binding', async () => {
  const f = await fixture()
  const origin = associateReviewWithGenerationTurn(f)
  const response = await f.app.inject({
    method: 'POST', url: `/sessions/${f.sessionId}/reviews/${f.review.id}/approve`, headers: bearer(),
    payload: { artifactId: f.draft.id, version: 1, fingerprint: f.review.fingerprint },
  })
  assert.equal(response.statusCode, 202, response.body)
  const accepted = f.repositories.artifacts.list(f.sessionId).find(item => item.type === EVENT_PLAN_ACCEPTED_ARTIFACT)
  assert.equal(accepted?.createdBy, 'user')
  assert.equal(accepted?.metadata?.confirmationId, `review:${f.review.id}:user-1`)
  assert.equal(accepted?.metadata?.acceptedDraftArtifactId, f.draft.id)
  const reviewEvents = f.events.published.filter(event => ['artifact.created', 'review.resolved'].includes(event.type))
  assert.deepEqual(reviewEvents.map(event => event.type), ['artifact.created', 'review.resolved'])
  assert.deepEqual(Object.keys((reviewEvents[0]!.data.metadata ?? {}) as Record<string, unknown>).sort(),
    ['documentId', 'fingerprint', 'planId', 'version'])
  assert.deepEqual(reviewEvents.map(event => ({ runId: f.repositories.events.after(f.sessionId, '0')
    .find(record => record.id === event.id)?.runId, dataRunId: event.data.runId })), [
    { runId: origin.id, dataRunId: origin.id },
    { runId: origin.id, dataRunId: origin.id },
  ])
  const turns = await f.app.inject({ method: 'GET', url: `/sessions/${f.sessionId}/turns`, headers: bearer() })
  assert.equal(turns.json().turns.some((turn: { id: string }) => turn.id.startsWith('approval-')), false)
  assert.equal(turns.json().turns.find((turn: { id: string; activities: Array<{ type: string; summary: string }> }) => turn.id === origin.id)
    ?.activities.find(activity => activity.type === 'review')?.summary, '审核已通过')
  await f.app.close()
  f.database.close()
})

test('approve rejects a stale version without accepting anything', async () => {
  const f = await fixture()
  const response = await f.app.inject({
    method: 'POST', url: `/sessions/${f.sessionId}/reviews/${f.review.id}/approve`, headers: bearer(),
    payload: { artifactId: f.draft.id, version: 2, fingerprint: f.review.fingerprint },
  })
  assert.equal(response.statusCode, 409)
  assert.equal(f.repositories.artifacts.list(f.sessionId).some(item => item.type === EVENT_PLAN_ACCEPTED_ARTIFACT), false)
  await f.app.close()
  f.database.close()
})

test('revision creates version two and supersedes but does not mutate version one', async () => {
  const f = await fixture()
  const before = structuredClone(f.draft.data)
  const eventUnits = [...f.plan.eventUnits].reverse()
  const response = await f.app.inject({
    method: 'POST', url: `/sessions/${f.sessionId}/event-plans/${f.draft.id}/revisions`, headers: bearer(),
    payload: { baseArtifactId: f.draft.id, eventUnits },
  })
  assert.equal(response.statusCode, 201)
  assert.equal(response.json().artifact.version, 2)
  assert.deepEqual(f.repositories.artifacts.get(f.sessionId, f.draft.id)?.data, before)
  assert.equal(f.repositories.artifacts.get(f.sessionId, f.draft.id)?.superseded, true)
  assert.deepEqual(response.json().artifact.data.eventUnits, eventUnits)
  assert.deepEqual(f.events.published.filter(event => ['artifact.created', 'review.requested'].includes(event.type))
    .map(event => event.type), ['artifact.created', 'review.requested'])
  await f.app.close()
  f.database.close()
})

test('reject resolves only the exact tuple and preserves the draft', async () => {
  const f = await fixture()
  const origin = associateReviewWithGenerationTurn(f)
  const response = await f.app.inject({
    method: 'POST', url: `/sessions/${f.sessionId}/reviews/${f.review.id}/reject`, headers: bearer(),
    payload: { artifactId: f.draft.id, version: 1, fingerprint: f.review.fingerprint, reason: 'needs changes' },
  })
  assert.deepEqual(response.json(), { reviewId: f.review.id, status: 'rejected' })
  assert.equal(f.repositories.artifacts.get(f.sessionId, f.draft.id)?.superseded, false)
  assert.equal(f.repositories.sessions.get(f.sessionId)?.status, 'completed')
  const resolved = f.repositories.events.after(f.sessionId, '0').find(event => event.type === 'review.resolved')!
  assert.equal(resolved.runId, origin.id)
  assert.equal(resolved.data.runId, origin.id)
  const turns = await f.app.inject({ method: 'GET', url: `/sessions/${f.sessionId}/turns`, headers: bearer() })
  assert.equal(turns.json().turns.some((turn: { id: string }) => turn.id.startsWith('approval-')), false)
  assert.equal(turns.json().turns.find((turn: { id: string; activities: Array<{ summary: string }> }) => turn.id === origin.id)?.activities.at(-1)?.summary, '审核已拒绝')
  await f.app.close()
  f.database.close()
})

test('concurrent approve and reject leave only the winning decision effects', async () => {
  const f = await fixture()
  const tuple = { artifactId: f.draft.id, version: 1, fingerprint: f.review.fingerprint }
  const [approval, rejection] = await Promise.all([
    f.app.inject({
      method: 'POST', url: `/sessions/${f.sessionId}/reviews/${f.review.id}/approve`, headers: bearer(), payload: tuple,
    }),
    f.app.inject({
      method: 'POST', url: `/sessions/${f.sessionId}/reviews/${f.review.id}/reject`, headers: bearer(),
      payload: { ...tuple, reason: 'race' },
    }),
  ])
  assert.equal([approval.statusCode, rejection.statusCode].filter(status => status >= 200 && status < 300).length, 1)
  assert.equal([approval.statusCode, rejection.statusCode].filter(status => status === 409).length, 1)
  const review = f.repositories.reviews.get(f.sessionId, f.review.id)!
  const accepted = f.repositories.artifacts.list(f.sessionId).filter(item => item.type === EVENT_PLAN_ACCEPTED_ARTIFACT)
  const runCount = Number(f.repositories.database.prepare('SELECT COUNT(*) AS count FROM runs WHERE session_id = ?').get([f.sessionId])!.count)
  const resolved = f.repositories.events.after(f.sessionId, '0').filter(event => event.type === 'review.resolved')
  assert.equal(resolved.length, 1)
  assert.equal(accepted.length, review.status === 'approved' ? 1 : 0)
  assert.equal(runCount, review.status === 'approved' ? 1 : 0)
  await f.app.close()
  f.database.close()
})

test('concurrent revisions cannot mint the same next version', async () => {
  const f = await fixture()
  const request = {
    method: 'POST' as const,
    url: `/sessions/${f.sessionId}/event-plans/${f.draft.id}/revisions`,
    headers: bearer(),
    payload: { baseArtifactId: f.draft.id, eventUnits: [...f.plan.eventUnits].reverse() },
  }
  const responses = await Promise.all([f.app.inject(request), f.app.inject(request)])
  assert.equal(responses.filter(response => response.statusCode === 201).length, 1)
  assert.equal(responses.filter(response => [404, 409].includes(response.statusCode)).length, 1)
  const versions = f.repositories.artifacts.list(f.sessionId)
    .filter(item => item.type === EVENT_PLAN_DRAFT_ARTIFACT).map(item => item.version)
  assert.equal(versions.filter(version => version === 2).length, 1)
  await f.app.close()
  f.database.close()
})

test('approval rolls back accepted artifact, event, and decision when queued run creation fails', async () => {
  const f = await fixture()
  f.repositories.runs.createQueued = () => { throw new Error('INJECTED_RUN_CREATE_FAILURE') }
  const response = await f.app.inject({
    method: 'POST', url: `/sessions/${f.sessionId}/reviews/${f.review.id}/approve`, headers: bearer(),
    payload: { artifactId: f.draft.id, version: 1, fingerprint: f.review.fingerprint },
  })
  assert.equal(response.statusCode, 500)
  assert.equal(f.repositories.reviews.get(f.sessionId, f.review.id)?.status, 'pending')
  assert.equal(f.repositories.artifacts.list(f.sessionId).some(item => item.type === EVENT_PLAN_ACCEPTED_ARTIFACT), false)
  assert.equal(f.repositories.events.after(f.sessionId, '0').some(event => event.type === 'review.resolved'), false)
  assert.equal(f.repositories.events.after(f.sessionId, '0').some(event => event.type === 'artifact.created'), false)
  assert.equal(Number(f.repositories.database.prepare('SELECT COUNT(*) AS count FROM runs').get()!.count), 0)
  await f.app.close()
  f.database.close()
})

test('revision rolls back its artifact and old review mutation when pending review creation fails', async () => {
  const f = await fixture()
  f.repositories.reviews.createPending = () => { throw new Error('INJECTED_REVIEW_CREATE_FAILURE') }
  const response = await f.app.inject({
    method: 'POST', url: `/sessions/${f.sessionId}/event-plans/${f.draft.id}/revisions`, headers: bearer(),
    payload: { baseArtifactId: f.draft.id, eventUnits: [...f.plan.eventUnits].reverse() },
  })
  assert.equal(response.statusCode, 500)
  assert.equal(f.repositories.reviews.get(f.sessionId, f.review.id)?.status, 'pending')
  assert.deepEqual(f.repositories.artifacts.listLedger(f.sessionId)
    .filter(item => item.type === EVENT_PLAN_DRAFT_ARTIFACT).map(item => item.version), [1])
  assert.equal(f.repositories.events.after(f.sessionId, '0').some(event => event.type === 'review.requested'), false)
  assert.equal(f.repositories.events.after(f.sessionId, '0').some(event => event.type === 'artifact.created'), false)
  await f.app.close()
  f.database.close()
})
