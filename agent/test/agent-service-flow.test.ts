import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelAdapter, ModelRequest, ModelResponse } from '@ise/agent-core'
import { sceneProjectConfigSchema } from '@ise/runtime-contracts'
import type { AuthorizedFile, NestGateway } from '../src/adapters/nestGateway.ts'
import { createHttpApp } from '../src/api/httpApp.ts'
import type { ReviewTuple } from '../src/api/contracts.ts'
import {
  COMPILED_RUNTIME_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  EVENT_PLAN_DRAFT_ARTIFACT,
  NARRATIVE_PLAN_ARTIFACT,
  type CompiledRuntimeArtifactData,
} from '../src/contracts/artifactTypes.ts'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import { AgentDatabase } from '../src/persistence/database.ts'
import { PersistentArtifactStore } from '../src/persistence/persistentArtifactStore.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'
import { parseBattleReport } from '../src/services/documentParser.ts'
import { fingerprint, sha256 } from '../src/services/fingerprint.ts'

const hash = `sha256:${'2'.repeat(64)}`

class FlowModel implements ModelAdapter {
  #step = 0
  constructor(
    readonly sessionId: string,
    readonly repositories: AgentRepositories,
    readonly documentId: string,
    readonly evidenceIds: string[],
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const objective = request.messages.find(message => message.role === 'user' && !message.hidden)?.content ?? ''
    if (objective.includes('Create exactly one grounded NarrativePlan')) return this.downstream()
    return this.firstRun()
  }

  private firstRun(): ModelResponse {
    if (this.#step++ === 0) return {
      content: '', toolCalls: [{ id: 'parse-1', name: 'parse_battle_report', input: { fileId: 'file-report-1' } }],
    }
    if (this.#step === 2) {
      const units = this.evidenceIds.slice(0, 2).map((evidenceId, index) => ({
        eventUnitId: `unit-${index + 1}`, title: `Event ${index + 1}`, worldStateChange: `JF-17 state ${index + 1}`,
        participants: ['JF-17'], locationRefs: ['border'], evidenceRefs: [evidenceId], inferenceRefs: [],
        uncertainties: [], narrativePurpose: `Explain ${index + 1}`, importance: index === 0 ? 'high' as const : 'medium' as const,
      }))
      return { content: '', toolCalls: [{
        id: 'propose-1', name: 'propose_event_plan', input: {
          schemaVersion: 'event-plan/v1', planId: 'flow-plan-1', documentId: this.documentId,
          version: 1, eventUnits: units, omittedEvidence: [], warnings: [],
        },
      }] }
    }
    return { content: 'Draft ready for review.' }
  }

  private downstream(): ModelResponse {
    if (this.#step++ > 0) return { content: 'Narrative plan prepared.' }
    const accepted = this.repositories.artifacts.listLedger(this.sessionId)
      .find(item => item.type === EVENT_PLAN_ACCEPTED_ARTIFACT && !item.superseded)
    assert.ok(accepted)
    const plan = accepted.data as EventPlan
    return { content: '', toolCalls: [{
      id: 'narrative-1', name: 'propose_scene_plan', input: {
        schemaVersion: 'narrative-plan/v1', narrativePlanId: 'flow-narrative-1',
        sourceEventPlan: {
          artifactId: accepted.id, planId: plan.planId, version: plan.version,
          fingerprint: accepted.metadata?.fingerprint,
        },
        targetDurationMs: 180_000,
        subtitles: plan.eventUnits.map((unit, index) => ({
          subtitleId: `subtitle-${index + 1}`, eventUnitId: unit.eventUnitId,
          text: unit.worldStateChange, evidenceRefs: unit.evidenceRefs, importance: unit.importance,
        })),
        sceneRequirements: plan.eventUnits.map((unit, index) => ({
          requirementId: `requirement-${index + 1}`, eventUnitId: unit.eventUnitId,
          focusEntities: ['JF-17'], spatialRelations: [], stateChanges: ['status explanation'],
          motionRequirements: [], attentionRequirements: ['show status'], requiredFacts: [unit.worldStateChange],
          forbiddenClaims: ['invented outcome'], preferredTemplate: 'status_explanation',
        })),
      },
    }] }
  }
}

class FlowNest implements NestGateway {
  constructor(readonly file: AuthorizedFile, readonly modelAvailability: 'available' | 'missing') {}
  async verifyBearer(authorization: string) { return { subject: authorization.slice('Bearer '.length) } }
  async readOwnedFile(fileId: string) {
    if (fileId !== this.file.fileId) throw new Error('not found')
    return { ...this.file, bytes: Buffer.from(this.file.bytes) }
  }
  async listAssetMetadata() {
    return [{
      assetId: 'model:jf17', kind: 'model', displayName: 'JF-17', aliases: [], fingerprint: hash,
      sourceRelativePath: 'assets/jf17.glb', objectName: 'models/jf17.glb', size: 10,
      availability: this.modelAvailability, criticality: 'required', fallbackAssetIds: [], allowFallback: false,
      mediaType: 'model/gltf-binary',
      model: { scale: 1, rotationOffsetDeg: [0, 0, 0], altitudeOffsetM: 0, entityTypes: ['aircraft'] },
    }]
  }
}

async function service(modelAvailability: 'available' | 'missing' = 'available') {
  const fixtureNames = await readdir(new URL('./fixtures/', import.meta.url))
  const bytes = await readFile(new URL(`./fixtures/${fixtureNames.find(name => name.endsWith('.docx'))!}`, import.meta.url))
  const parsed = await parseBattleReport(bytes)
  const evidenceIds = parsed.evidence.records.filter(item => item.kind === 'explicit_fact').slice(0, 2).map(item => item.evidenceId)
  assert.equal(evidenceIds.length, 2)
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  const repositories = new AgentRepositories(database)
  const nest = new FlowNest({
    fileId: 'file-report-1', name: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: bytes.length, fingerprint: sha256(bytes) as `sha256:${string}`, bytes,
  }, modelAvailability)
  const app = await createHttpApp({
    repositories,
    nest,
    modelFactory: ({ sessionId }) => new FlowModel(sessionId, repositories, parsed.document.documentId, evidenceIds),
  })
  return { app, database, repositories }
}

const headers = { authorization: 'Bearer user-1' }

async function waitForEvent(
  repositories: AgentRepositories,
  sessionId: string,
  type: string,
  after = '0',
  runId?: string,
) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const event = repositories.events.after(sessionId, after).find(item => item.type === type && (!runId || item.data.runId === runId))
    if (event) return event
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${type}`)
}

async function draftAndRevise(f: Awaited<ReturnType<typeof service>>) {
  const created = await f.app.inject({ method: 'POST', url: '/sessions', headers, payload: {} })
  const sessionId = created.json().sessionId as string
  await f.app.inject({ method: 'POST', url: `/sessions/${sessionId}/attachments`, headers, payload: { fileId: 'file-report-1' } })
  await f.app.inject({ method: 'POST', url: `/sessions/${sessionId}/messages`, headers, payload: { content: 'Parse report and propose EventPlan' } })
  const requested = await waitForEvent(f.repositories, sessionId, 'review.requested')
  const review = requested.data as ReviewTuple
  const draft = f.repositories.artifacts.get(sessionId, review.artifactId)!
  const plan = draft.data as EventPlan
  const revised = await f.app.inject({
    method: 'POST', url: `/sessions/${sessionId}/event-plans/${draft.id}/revisions`, headers,
    payload: { baseArtifactId: draft.id, eventUnits: [...plan.eventUnits].reverse() },
  })
  assert.equal(revised.statusCode, 201)
  return { sessionId, requested, revision: revised.json() as { review: ReviewTuple } }
}

test('DOCX to revision to exact approval to compiled scene survives event reconnect', async () => {
  const f = await service()
  const flow = await draftAndRevise(f)
  const approval = await f.app.inject({
    method: 'POST', url: `/sessions/${flow.sessionId}/reviews/${flow.revision.review.reviewId}/approve`, headers,
    payload: {
      artifactId: flow.revision.review.artifactId,
      version: flow.revision.review.version,
      fingerprint: flow.revision.review.fingerprint,
    },
  })
  assert.equal(approval.statusCode, 202)
  const completed = await waitForEvent(f.repositories, flow.sessionId, 'run.completed', flow.requested.id, approval.json().runId)
  const downstreamRun = f.repositories.runs.get(approval.json().runId)!
  assert.equal(downstreamRun.expectedAccepted?.artifactId, (f.repositories.artifacts.listLedger(flow.sessionId)
    .find(item => item.type === EVENT_PLAN_ACCEPTED_ARTIFACT && !item.superseded))?.id)
  assert.ok(f.repositories.artifacts.listByRun(flow.sessionId, downstreamRun.id)
    .some(item => item.type === COMPILED_RUNTIME_ARTIFACT))
  assert.deepEqual(sceneProjectConfigSchema.parse(completed.data.sceneProjectConfig), completed.data.sceneProjectConfig)
  const compiled = f.repositories.artifacts.get(flow.sessionId, completed.data.runtimeArtifactId as string)!
  assert.deepEqual((compiled.data as CompiledRuntimeArtifactData).sceneProjectConfig, completed.data.sceneProjectConfig)
  assert.equal(JSON.stringify(compiled).includes('https://'), false)
  const downstreamEvents = f.repositories.events.after(flow.sessionId, flow.requested.id)
  assert.ok(downstreamEvents.every(event => BigInt(event.id) > BigInt(flow.requested.id)))
  const compileStarted = downstreamEvents.find(event =>
    event.type === 'tool.started' && event.data.toolName === 'compile_replay_runtime')
  assert.ok(compileStarted)
  assert.ok(downstreamEvents.some(event =>
    event.type === 'tool.completed' && event.data.toolCallId === compileStarted.data.toolCallId))
  await f.app.close()
  f.database.close()
})

test('draft review observer failure cannot leave a completed run with a running session', async () => {
  const f = await service()
  f.repositories.reviews.createPending = () => { throw new Error('INJECTED_REVIEW_OBSERVER_FAILURE') }
  const created = await f.app.inject({ method: 'POST', url: '/sessions', headers, payload: {} })
  const sessionId = created.json().sessionId as string
  await f.app.inject({ method: 'POST', url: `/sessions/${sessionId}/attachments`, headers, payload: { fileId: 'file-report-1' } })
  const queued = await f.app.inject({
    method: 'POST', url: `/sessions/${sessionId}/messages`, headers, payload: { content: 'Parse report and propose EventPlan' },
  })
  const failed = await waitForEvent(f.repositories, sessionId, 'run.failed', '0', queued.json().runId)
  assert.equal(failed.data.status, 'failed')
  assert.equal(f.repositories.runs.get(queued.json().runId)?.status, 'failed')
  assert.equal(f.repositories.sessions.get(sessionId)?.status, 'failed')
  assert.equal(f.repositories.reviews.listPending(sessionId).length, 0)
  assert.equal(f.repositories.events.after(sessionId, '0').some(event => event.type === 'review.requested'), false)
  await f.app.close()
  f.database.close()
})

test('a second approval compiles only artifacts created for its accepted tuple', async () => {
  const f = await service()
  const flow = await draftAndRevise(f)
  const firstApproval = await f.app.inject({
    method: 'POST', url: `/sessions/${flow.sessionId}/reviews/${flow.revision.review.reviewId}/approve`, headers,
    payload: {
      artifactId: flow.revision.review.artifactId,
      version: flow.revision.review.version,
      fingerprint: flow.revision.review.fingerprint,
    },
  })
  await waitForEvent(f.repositories, flow.sessionId, 'run.completed', '0', firstApproval.json().runId)

  const priorNarrativeIds = new Set(f.repositories.artifacts.listLedger(flow.sessionId)
    .filter(item => item.type === NARRATIVE_PLAN_ARTIFACT).map(item => item.id))
  const activeDraft = f.repositories.artifacts.listLedger(flow.sessionId)
    .find(item => item.type === EVENT_PLAN_DRAFT_ARTIFACT && !item.superseded)!
  const priorPlan = activeDraft.data as EventPlan
  const nextPlan = { ...priorPlan, version: priorPlan.version + 1, eventUnits: [...priorPlan.eventUnits].reverse() }
  const nextFingerprint = fingerprint(nextPlan)
  const nextDraft = new PersistentArtifactStore(flow.sessionId, f.repositories.artifacts).create({
    type: EVENT_PLAN_DRAFT_ARTIFACT,
    version: nextPlan.version,
    createdBy: 'agent',
    logicalKey: activeDraft.logicalKey,
    data: nextPlan,
    metadata: {
      planId: nextPlan.planId,
      documentId: nextPlan.documentId,
      version: nextPlan.version,
      fingerprint: nextFingerprint,
      status: 'draft',
    },
  })
  const nextReview = f.repositories.reviews.createPending({
    sessionId: flow.sessionId,
    artifactId: nextDraft.id,
    artifactVersion: nextPlan.version,
    fingerprint: nextFingerprint,
  })
  f.repositories.sessions.transition(flow.sessionId, ['completed'], 'awaiting_review')
  const secondApproval = await f.app.inject({
    method: 'POST', url: `/sessions/${flow.sessionId}/reviews/${nextReview.id}/approve`, headers,
    payload: { artifactId: nextDraft.id, version: nextPlan.version, fingerprint: nextFingerprint },
  })
  const completed = await waitForEvent(f.repositories, flow.sessionId, 'run.completed', '0', secondApproval.json().runId)
  const secondRun = f.repositories.runs.get(secondApproval.json().runId)!
  const accepted = f.repositories.artifacts.get(flow.sessionId, secondRun.expectedAccepted!.artifactId)!
  assert.equal(accepted.version, nextPlan.version)
  const createdBySecondRun = f.repositories.artifacts.listByRun(flow.sessionId, secondRun.id)
  const narrative = createdBySecondRun.find(item => item.type === NARRATIVE_PLAN_ARTIFACT)!
  assert.equal((narrative.data as { sourceEventPlan: { artifactId: string } }).sourceEventPlan.artifactId, accepted.id)
  assert.equal(priorNarrativeIds.has(narrative.id), false)
  const compiled = f.repositories.artifacts.get(flow.sessionId, completed.data.runtimeArtifactId as string)!
  assert.equal(compiled.metadata?.eventPlanArtifactId, accepted.id)
  await f.app.close()
  f.database.close()
})

test('required asset failure emits run.failed and keeps prior compiled artifact active', async () => {
  const f = await service('missing')
  const flow = await draftAndRevise(f)
  new PersistentArtifactStore(flow.sessionId, f.repositories.artifacts).create({
    id: 'last-valid', type: COMPILED_RUNTIME_ARTIFACT, createdBy: 'tool', logicalKey: 'compiled-runtime:prior', data: { prior: true },
  })
  const approval = await f.app.inject({
    method: 'POST', url: `/sessions/${flow.sessionId}/reviews/${flow.revision.review.reviewId}/approve`, headers,
    payload: {
      artifactId: flow.revision.review.artifactId,
      version: flow.revision.review.version,
      fingerprint: flow.revision.review.fingerprint,
    },
  })
  const failed = await waitForEvent(f.repositories, flow.sessionId, 'run.failed', '0', approval.json().runId)
  assert.equal(failed.data.status, 'failed')
  assert.ok((failed.data.diagnostics as { code: string }[]).some(item => item.code === 'REQUIRED_ASSET_MISSING'))
  assert.deepEqual(f.repositories.artifacts.listLedger(flow.sessionId)
    .filter(item => item.type === COMPILED_RUNTIME_ARTIFACT && !item.superseded).map(item => item.id), ['last-valid'])
  await f.app.close()
  f.database.close()
})
