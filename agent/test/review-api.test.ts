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

const model: ModelAdapter = { complete: async () => ({ content: 'downstream queued' }) }
const nest: NestGateway = {
  verifyBearer: async authorization => ({ subject: authorization.slice('Bearer '.length) }),
  readOwnedFile: async () => { throw new Error('unused') },
  listAssetMetadata: async () => [],
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
  const app = await createHttpApp({ repositories, nest, modelFactory: () => model })
  return { app, database, repositories, sessionId: session.id, draft, review, plan }
}

function bearer() { return { authorization: 'Bearer user-1' } }

test('approve invokes accept_event_plan with a trusted exact binding', async () => {
  const f = await fixture()
  const response = await f.app.inject({
    method: 'POST', url: `/sessions/${f.sessionId}/reviews/${f.review.id}/approve`, headers: bearer(),
    payload: { artifactId: f.draft.id, version: 1, fingerprint: f.review.fingerprint },
  })
  assert.equal(response.statusCode, 202)
  const accepted = f.repositories.artifacts.list(f.sessionId).find(item => item.type === EVENT_PLAN_ACCEPTED_ARTIFACT)
  assert.equal(accepted?.createdBy, 'user')
  assert.equal(accepted?.metadata?.confirmationId, `review:${f.review.id}:user-1`)
  assert.equal(accepted?.metadata?.acceptedDraftArtifactId, f.draft.id)
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
  await f.app.close()
  f.database.close()
})

test('reject resolves only the exact tuple and preserves the draft', async () => {
  const f = await fixture()
  const response = await f.app.inject({
    method: 'POST', url: `/sessions/${f.sessionId}/reviews/${f.review.id}/reject`, headers: bearer(),
    payload: { artifactId: f.draft.id, version: 1, fingerprint: f.review.fingerprint, reason: 'needs changes' },
  })
  assert.deepEqual(response.json(), { reviewId: f.review.id, status: 'rejected' })
  assert.equal(f.repositories.artifacts.get(f.sessionId, f.draft.id)?.superseded, false)
  assert.equal(f.repositories.sessions.get(f.sessionId)?.status, 'completed')
  await f.app.close()
  f.database.close()
})
