import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { ModelAdapter, ModelRequest, ModelResponse } from '@ise/agent-core'
import { SkillRegistry } from '@ise/skills-core'
import type { AuthorizedFile, NestGateway } from '../src/adapters/nestGateway.ts'
import { createHttpApp } from '../src/api/httpApp.ts'
import { AgentDatabase } from '../src/persistence/database.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'
import { PersistentArtifactStore } from '../src/persistence/persistentArtifactStore.ts'
import {
  COMPILED_RUNTIME_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  NARRATIVE_PLAN_ARTIFACT,
} from '../src/contracts/artifactTypes.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { EventBroker } from '../src/session/eventBroker.ts'
import { SessionAgentRunner } from '../src/session/sessionAgentRunner.ts'

class TestNestGateway implements NestGateway {
  readonly file: AuthorizedFile = {
    fileId: 'file-report-1', name: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 8, fingerprint: `sha256:${'1'.repeat(64)}`, bytes: Buffer.from('PK\u0003\u0004docx'),
  }
  async verifyBearer(authorization: string): Promise<{ subject: string }> {
    if (!authorization.startsWith('Bearer user-')) throw new Error('INVALID_BEARER')
    return { subject: authorization.slice('Bearer '.length) }
  }
  async readOwnedFile(fileId: string): Promise<AuthorizedFile> {
    if (fileId !== this.file.fileId) throw new Error('ATTACHMENT_NOT_FOUND')
    return { ...this.file, bytes: Buffer.from(this.file.bytes) }
  }
  async listAssetMetadata(): Promise<unknown> { return [] }
}

class BlockingModel implements ModelAdapter {
  readonly started: Promise<void>
  #resolveStarted!: () => void
  constructor() {
    this.started = new Promise(resolve => { this.#resolveStarted = resolve })
  }
  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.#resolveStarted()
    await new Promise<void>((_resolve, reject) => {
      const abort = () => reject(request.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      if (request.signal?.aborted) abort()
      else request.signal?.addEventListener('abort', abort, { once: true })
    })
    return { content: 'unreachable' }
  }
}

class ControllableModel implements ModelAdapter {
  readonly started: Promise<void>
  #resolveStarted!: () => void
  #resolve?: (response: ModelResponse) => void
  #reject?: (error: Error) => void

  constructor() {
    this.started = new Promise(resolve => { this.#resolveStarted = resolve })
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.#resolveStarted()
    return new Promise<ModelResponse>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      const abort = () => reject(request.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      if (request.signal?.aborted) abort()
      else request.signal?.addEventListener('abort', abort, { once: true })
    })
  }

  succeed(): void { this.#resolve?.({ content: 'completed' }) }
  fail(): void { this.#reject?.(new Error('model failed')) }
}

async function fixture(model: ModelAdapter = { complete: async () => ({ content: 'done' }) }) {
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  const repositories = new AgentRepositories(database)
  const nest = new TestNestGateway()
  const app = await createHttpApp({ repositories, nest, modelFactory: () => model })
  return { app, database, repositories, nest }
}

function bearer(subject: string) { return { authorization: `Bearer ${subject}` } }

async function createSession(app: Awaited<ReturnType<typeof createHttpApp>>, subject = 'user-1'): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/sessions', headers: bearer(subject), payload: {} })
  assert.equal(response.statusCode, 201)
  return response.json().sessionId as string
}

async function waitForTerminal(repositories: AgentRepositories, sessionId: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (!['queued', 'running'].includes(repositories.sessions.get(sessionId)?.status ?? '')) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for terminal session')
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

async function terminalFixture(t: TestContext, model: ControllableModel, persisted: boolean) {
  let failNextFlush = false
  let flushFaults = 0
  const path = persisted
    ? join(await mkdtemp(join(tmpdir(), 'ise-agent-terminal-')), 'agent.sqlite')
    : ':memory:'
  if (persisted) t.after(() => rm(join(path, '..'), { recursive: true, force: true }))
  const database = await AgentDatabase.open(path, 'sql.js', {
    beforeRename: () => {
      if (!failNextFlush) return
      failNextFlush = false
      flushFaults += 1
      throw new Error('INJECTED_TERMINAL_FLUSH_FAILURE')
    },
  })
  const repositories = new AgentRepositories(database)
  const session = repositories.sessions.create('user-1')
  const events = new EventBroker(repositories.events)
  const runner = new SessionAgentRunner({
    repositories,
    nest: new TestNestGateway(),
    modelFactory: () => model,
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    events,
  })
  return {
    database, repositories, session, events, runner,
    armFault: () => { failNextFlush = true },
    flushFaults: () => flushFaults,
  }
}

function collectEvents(events: EventBroker, sessionId: string) {
  const controller = new AbortController()
  const values: Array<{ id: string; type: string }> = []
  const done = (async () => {
    for await (const event of events.subscribe(sessionId, '0', controller.signal)) values.push(event)
  })()
  return { values, stop: async () => { controller.abort(); await done } }
}

function seedOldNarrative(repositories: AgentRepositories, sessionId: string): void {
  const store = new PersistentArtifactStore(sessionId, repositories.artifacts)
  const eventPlan = {
    schemaVersion: 'event-plan/v1' as const, planId: 'old-plan', documentId: 'old-document', version: 1,
    eventUnits: [{
      eventUnitId: 'old-unit', title: 'Old event', worldStateChange: 'Old state', participants: ['Old aircraft'],
      locationRefs: [], evidenceRefs: ['old-evidence'], inferenceRefs: [], uncertainties: [],
      narrativePurpose: 'Old narrative', importance: 'low' as const,
    }],
    omittedEvidence: [], warnings: [],
  }
  const hash = fingerprint(eventPlan)
  store.create({
    id: 'old-accepted', type: EVENT_PLAN_ACCEPTED_ARTIFACT, version: 1, createdBy: 'user',
    logicalKey: 'accepted-event-plan:old-plan', data: eventPlan,
    metadata: { planId: 'old-plan', documentId: 'old-document', version: 1, fingerprint: hash, status: 'accepted' },
  })
  store.create({
    id: 'old-narrative', type: NARRATIVE_PLAN_ARTIFACT, createdBy: 'agent',
    logicalKey: 'narrative-plan:old-accepted',
    data: {
      schemaVersion: 'narrative-plan/v1', narrativePlanId: 'old-narrative-plan',
      sourceEventPlan: { artifactId: 'old-accepted', planId: 'old-plan', version: 1, fingerprint: hash },
      targetDurationMs: 180_000,
      subtitles: [{ subtitleId: 'old-subtitle', eventUnitId: 'old-unit', text: 'Old state', evidenceRefs: ['old-evidence'], importance: 'low' }],
      sceneRequirements: [{
        requirementId: 'old-requirement', eventUnitId: 'old-unit', focusEntities: ['Old aircraft'], spatialRelations: [],
        stateChanges: ['status'], motionRequirements: [], attentionRequirements: [], requiredFacts: ['Old state'],
        forbiddenClaims: [], preferredTemplate: 'status_explanation',
      }],
    },
  })
}

test('create session returns only sessionId and idle status', async () => {
  const { app, database } = await fixture()
  const response = await app.inject({ method: 'POST', url: '/sessions', headers: bearer('user-1'), payload: {} })
  assert.equal(response.statusCode, 201)
  assert.deepEqual(Object.keys(response.json()).sort(), ['sessionId', 'status'])
  assert.equal(response.json().status, 'idle')
  const rejected = await app.inject({
    method: 'POST', url: '/sessions', headers: bearer('user-1'), payload: { objective: 'generate replay' },
  })
  assert.equal(rejected.statusCode, 400)
  const unauthorized = await app.inject({ method: 'POST', url: '/sessions', payload: {} })
  assert.equal(unauthorized.statusCode, 401)
  await app.close()
  database.close()
})

test('session ownership is checked on session, artifacts, and SSE', async () => {
  const { app, database } = await fixture()
  const sessionId = await createSession(app)
  for (const url of [`/sessions/${sessionId}`, `/sessions/${sessionId}/artifacts`, `/sessions/${sessionId}/events`]) {
    const response = await app.inject({ method: 'GET', url, headers: bearer('user-2') })
    assert.equal(response.statusCode, 404)
  }
  const missing = await app.inject({ method: 'GET', url: '/sessions/missing', headers: bearer('user-2') })
  assert.deepEqual(missing.json(), (await app.inject({ method: 'GET', url: `/sessions/${sessionId}`, headers: bearer('user-2') })).json())
  await app.close()
  database.close()
})

test('attachment is validated remotely before its stable metadata is persisted', async () => {
  const { app, database } = await fixture()
  const sessionId = await createSession(app)
  const response = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/attachments`, headers: bearer('user-1'), payload: { fileId: 'file-report-1' },
  })
  assert.equal(response.statusCode, 201)
  assert.deepEqual(response.json(), {
    attachmentId: response.json().attachmentId,
    fileId: 'file-report-1', name: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 8, fingerprint: `sha256:${'1'.repeat(64)}`,
  })
  await app.close()
  database.close()
})

test('message queues one run and interrupt aborts it', async () => {
  const blockingModel = new BlockingModel()
  const { app, database, repositories } = await fixture(blockingModel)
  const sessionId = await createSession(app)
  const queued = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'), payload: { content: 'generate event plan' },
  })
  assert.equal(queued.statusCode, 202)
  assert.equal(queued.json().status, 'queued')
  await blockingModel.started
  const second = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'), payload: { content: 'second' },
  })
  assert.equal(second.statusCode, 409)
  const interrupted = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/interrupt`, headers: bearer('user-1'), payload: {},
  })
  assert.deepEqual(interrupted.json(), { runId: queued.json().runId, status: 'cancelled' })
  assert.equal(repositories.sessions.get(sessionId)?.status, 'cancelled')
  assert.equal(repositories.events.after(sessionId, '0').at(-1)?.type, 'run.failed')
  await app.close()
  database.close()
})

test('Last-Event-ID accepts decimal integers only', async () => {
  const { app, database } = await fixture()
  const sessionId = await createSession(app)
  const response = await app.inject({
    method: 'GET', url: `/sessions/${sessionId}/events`, headers: { ...bearer('user-1'), 'last-event-id': '-1' },
  })
  assert.equal(response.statusCode, 400)
  await app.close()
  database.close()
})

test('ordinary and failed runs never compile a NarrativePlan left by an older run', async () => {
  for (const model of [
    { complete: async () => ({ content: 'ordinary response' }) },
    { complete: async () => { throw new Error('C:\\private\\prompt.json Bearer top-secret provider body') } },
  ] satisfies ModelAdapter[]) {
    const { app, database, repositories } = await fixture(model)
    const sessionId = await createSession(app)
    seedOldNarrative(repositories, sessionId)
    await app.inject({
      method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'), payload: { content: 'ordinary message' },
    })
    await waitForTerminal(repositories, sessionId)
    assert.equal(repositories.artifacts.list(sessionId).some(item => item.type === COMPILED_RUNTIME_ARTIFACT), false)
    assert.equal(repositories.events.after(sessionId, '0').some(event =>
      event.type === 'run.completed' && typeof event.data.runtimeArtifactId === 'string'), false)
    const persistedFailure = repositories.runs.get(repositories.sessions.get(sessionId)?.activeRunId ?? '')?.error
    assert.equal(/private|prompt\.json|Bearer|top-secret|provider body/i.test(JSON.stringify({
      events: repositories.events.after(sessionId, '0'), persistedFailure,
    })), false)
    await app.close()
    database.close()
  }
})

test('terminal flush failures publish no completed, failed, or interrupt event', async (t) => {
  for (const outcome of ['completed', 'failed', 'interrupt'] as const) {
    const model = new ControllableModel()
    const f = await terminalFixture(t, model, true)
    const live = collectEvents(f.events, f.session.id)
    await new Promise(resolve => setImmediate(resolve))
    const queued = f.runner.enqueue({
      sessionId: f.session.id,
      subject: 'user-1',
      authorization: 'Bearer user-1',
      content: outcome,
    })
    await model.started
    f.armFault()
    if (outcome === 'completed') model.succeed()
    else if (outcome === 'failed') model.fail()
    else assert.throws(() => f.runner.interrupt(f.session.id, 'user-1'), /INJECTED_TERMINAL_FLUSH_FAILURE/)
    await waitFor(() => f.flushFaults() > 0 || ['completed', 'failed', 'cancelled'].includes(
      f.repositories.runs.get(queued.runId)?.status ?? ''), `No terminal outcome for ${outcome}`)
    await new Promise(resolve => setTimeout(resolve, 20))
    const isTerminal = (event: { type: string }) => ['run.completed', 'run.failed'].includes(event.type)
    assert.equal(f.flushFaults(), 1, outcome)
    assert.deepEqual(live.values.filter(isTerminal), [], `${outcome} live`)
    assert.deepEqual(f.repositories.events.after(f.session.id, '0').filter(isTerminal), [], `${outcome} durable`)
    assert.deepEqual(f.events.replayAfter(f.session.id, '0').filter(isTerminal), [], `${outcome} replay`)
    await live.stop()
    if (['queued', 'running'].includes(f.repositories.runs.get(queued.runId)?.status ?? '')) {
      f.runner.interrupt(f.session.id, 'user-1')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    f.database.close()
  }
})

test('successful completed, failed, and interrupt paths publish one ordered terminal event', async (t) => {
  for (const outcome of ['completed', 'failed', 'interrupt'] as const) {
    const model = new ControllableModel()
    const f = await terminalFixture(t, model, false)
    const live = collectEvents(f.events, f.session.id)
    await new Promise(resolve => setImmediate(resolve))
    const queued = f.runner.enqueue({
      sessionId: f.session.id,
      subject: 'user-1',
      authorization: 'Bearer user-1',
      content: outcome,
    })
    await model.started
    if (outcome === 'completed') model.succeed()
    else if (outcome === 'failed') model.fail()
    else f.runner.interrupt(f.session.id, 'user-1')
    await waitFor(() => ['completed', 'failed', 'cancelled'].includes(
      f.repositories.runs.get(queued.runId)?.status ?? ''), `No successful terminal outcome for ${outcome}`)
    await waitFor(() => live.values.some(event => ['run.completed', 'run.failed'].includes(event.type)), `No live terminal event for ${outcome}`)
    const durable = f.repositories.events.after(f.session.id, '0')
    const terminals = durable.filter(event => ['run.completed', 'run.failed'].includes(event.type))
    assert.equal(terminals.length, 1, outcome)
    assert.equal(terminals[0]!.type, outcome === 'completed' ? 'run.completed' : 'run.failed', outcome)
    assert.ok(BigInt(terminals[0]!.id) > BigInt(durable.find(event => event.type === 'run.started')!.id), outcome)
    assert.equal(live.values.filter(event => ['run.completed', 'run.failed'].includes(event.type)).length, 1, outcome)
    await live.stop()
    f.database.close()
  }
})
