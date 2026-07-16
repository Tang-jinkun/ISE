import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { AgentTool, ModelAdapter, ModelRequest, ModelResponse } from '@ise/agent-core'
import { SkillRegistry } from '@ise/skills-core'
import type { AuthorizedFile, NestGateway } from '../src/adapters/nestGateway.ts'
import { BaseRuntimeAdapter } from '../src/adapters/baseRuntimeAdapter.ts'
import { createHttpApp } from '../src/api/httpApp.ts'
import { AgentDatabase } from '../src/persistence/database.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'
import { PersistentArtifactStore } from '../src/persistence/persistentArtifactStore.ts'
import {
  COMPILED_RUNTIME_ARTIFACT,
  ASSET_REGISTRY_ARTIFACT,
  DOCUMENT_IR_ARTIFACT,
  EVIDENCE_IR_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  EVENT_PLAN_DRAFT_ARTIFACT,
  NARRATIVE_PLAN_ARTIFACT,
  type CompiledRuntimeArtifactData,
} from '../src/contracts/artifactTypes.ts'
import { canonicalRuntimePlanSchema } from '../src/contracts/runtimePlan.ts'
import { capabilityManifest } from '../src/compiler/capabilityManifest.ts'
import { createAssetRegistrySnapshot } from '../src/services/assetRegistry.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { EventBroker } from '../src/session/eventBroker.ts'
import { SessionAgentRunner } from '../src/session/sessionAgentRunner.ts'
import { createCompilerTools, type CompilerToolOptions } from '../src/tools/compilerTools.ts'

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

class CompilerCallingModel implements ModelAdapter {
  input: Record<string, unknown> | undefined
  #step = 0

  async complete(): Promise<ModelResponse> {
    if (this.#step++ === 0) {
      assert.ok(this.input)
      return {
        content: '',
        toolCalls: [{ id: 'compile-invalid', name: 'compile_replay_runtime', input: this.input }],
      }
    }
    return { content: 'Compiler attempt finished.' }
  }
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

async function terminalFixture(
  t: TestContext,
  model: ModelAdapter,
  persisted: boolean,
  options: { compilerToolsFactory?: typeof createCompilerTools } = {},
) {
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
    compilerToolsFactory: options.compilerToolsFactory,
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

function prepareAcceptedRun(f: Awaited<ReturnType<typeof terminalFixture>>): string {
  const plan = {
    schemaVersion: 'event-plan/v1' as const,
    planId: 'terminal-plan',
    documentId: 'terminal-document',
    version: 1,
    eventUnits: [{
      eventUnitId: 'terminal-unit', title: 'Terminal', worldStateChange: 'Terminal state',
      participants: ['Unit'], locationRefs: [], evidenceRefs: ['terminal-evidence'], inferenceRefs: [],
      uncertainties: [], narrativePurpose: 'Terminal test', importance: 'low' as const,
    }],
    omittedEvidence: [], warnings: [],
  }
  const accepted = new PersistentArtifactStore(f.session.id, f.repositories.artifacts).create({
    id: `terminal-accepted-${f.session.id}`,
    type: EVENT_PLAN_ACCEPTED_ARTIFACT,
    version: 1,
    createdBy: 'user',
    logicalKey: 'accepted-event-plan:terminal-plan',
    data: plan,
    metadata: { planId: plan.planId, documentId: plan.documentId, version: 1, fingerprint: fingerprint(plan) },
  })
  f.repositories.sessions.transition(f.session.id, ['idle'], 'awaiting_review')
  return accepted.id
}

test('downstream run objective includes the exact accepted tuple and EventPlan snapshot', async (t) => {
  const model = new ControllableModel()
  const f = await terminalFixture(t, model, false)
  const acceptedArtifactId = prepareAcceptedRun(f)
  const accepted = f.repositories.artifacts.get(f.session.id, acceptedArtifactId)!
  const queued = f.runner.enqueueAfterApproval({
    sessionId: f.session.id,
    subject: 'user-1',
    authorization: 'Bearer user-1',
    acceptedArtifactId,
  })
  await model.started

  const objective = f.repositories.runs.get(queued.runId)!.objective
  assert.match(objective, /Use only propose_scene_plan/)
  assert.match(objective, new RegExp(acceptedArtifactId))
  assert.match(objective, /"planId":"terminal-plan"/)
  assert.match(objective, new RegExp(String(accepted.metadata?.fingerprint)))
  assert.match(objective, /"title":"Terminal"/)

  f.runner.interrupt(f.session.id, 'user-1')
  await waitForTerminal(f.repositories, f.session.id)
  await new Promise(resolve => setTimeout(resolve, 20))
  f.database.close()
})

type CompiledFixtureVariant =
  | 'runtime-schema'
  | 'scene-schema'
  | 'self-reference'
  | 'runtime-lineage'
  | 'scene-lineage'
  | 'metadata-lineage'

function persistCompiled(
  f: Awaited<ReturnType<typeof terminalFixture>>,
  acceptedArtifactId: string,
  options: { artifactId?: string; runId?: string; variant?: CompiledFixtureVariant } = {},
): string {
  const artifactId = options.artifactId ?? `terminal-compiled-${options.runId}`
  const validRuntimePlan = canonicalRuntimePlanSchema.parse({
    schemaVersion: 'canonical-runtime-plan/v1',
    planId: 'terminal-runtime-plan',
    sourceDocumentId: 'terminal-document',
    eventPlanArtifactId: acceptedArtifactId,
    eventPlanId: 'terminal-plan',
    narrativePlanId: 'terminal-narrative-plan',
    capabilityManifestVersion: 'ise-capabilities/v1',
    assetRegistryVersion: 'terminal-assets-v1',
    totalDurationMs: 1,
    entities: [],
    subtitles: [],
    commands: [],
    informationCards: [],
    lineage: [],
    diagnostics: [],
  })
  let runtimePlan: unknown = validRuntimePlan
  const sceneProjectConfig = new BaseRuntimeAdapter().adapt(validRuntimePlan, artifactId)
  const metadata: Record<string, unknown> = { eventPlanArtifactId: acceptedArtifactId }
  if (options.variant === 'runtime-schema') {
    runtimePlan = { leaked: 'Bearer top-secret ZodError invalid_type runtimePlan' }
  } else if (options.variant === 'scene-schema') {
    Object.assign(sceneProjectConfig, { tracks: 'Bearer top-secret ZodError invalid_type sceneProjectConfig' })
  } else if (options.variant === 'self-reference') {
    sceneProjectConfig.runtimePlanArtifactId = 'other-runtime-artifact'
  } else if (options.variant === 'runtime-lineage') {
    validRuntimePlan.eventPlanArtifactId = 'other-accepted-artifact'
  } else if (options.variant === 'scene-lineage') {
    sceneProjectConfig.eventPlanArtifactId = 'other-accepted-artifact'
  } else if (options.variant === 'metadata-lineage') {
    metadata.eventPlanArtifactId = 'other-accepted-artifact'
  }
  const store = new PersistentArtifactStore(f.session.id, f.repositories.artifacts)
  const compiled = store.create({
    id: artifactId,
    type: COMPILED_RUNTIME_ARTIFACT,
    createdBy: 'tool',
    logicalKey: `compiled-runtime:${acceptedArtifactId}`,
    data: {
      runtimePlan,
      sceneProjectConfig,
    },
    metadata,
  })
  if (options.runId) {
    f.repositories.artifacts.replaceLedger(
      f.session.id,
      f.repositories.artifacts.listLedger(f.session.id),
      new Map([[compiled.id, options.runId]]),
    )
  }
  return compiled.id
}

function persistNarrative(
  f: Awaited<ReturnType<typeof terminalFixture>>,
  acceptedArtifactId: string,
  runId?: string,
): string {
  const accepted = f.repositories.artifacts.get(f.session.id, acceptedArtifactId)!
  const narrative = new PersistentArtifactStore(f.session.id, f.repositories.artifacts, runId).create({
    id: `terminal-narrative-${runId ?? 'tool-call'}`,
    type: NARRATIVE_PLAN_ARTIFACT,
    createdBy: 'agent',
    logicalKey: `narrative-plan:${acceptedArtifactId}`,
    data: {
      schemaVersion: 'narrative-plan/v1',
      narrativePlanId: 'terminal-narrative-plan',
      sourceEventPlan: {
        artifactId: acceptedArtifactId,
        planId: 'terminal-plan',
        version: 1,
        fingerprint: accepted.metadata!.fingerprint,
      },
      targetDurationMs: 180_000,
      subtitles: [{
        subtitleId: 'terminal-subtitle',
        eventUnitId: 'terminal-unit',
        text: 'Terminal state',
        evidenceRefs: ['terminal-evidence'],
        importance: 'low',
      }],
      sceneRequirements: [{
        requirementId: 'terminal-requirement',
        eventUnitId: 'terminal-unit',
        focusEntities: ['Unit'],
        spatialRelations: [],
        stateChanges: ['status explanation'],
        motionRequirements: [],
        attentionRequirements: ['show status'],
        requiredFacts: ['Terminal state'],
        forbiddenClaims: [],
        preferredTemplate: 'status_explanation',
      }],
    },
  })
  return narrative.id
}

function persistAssetRegistry(
  f: Awaited<ReturnType<typeof terminalFixture>>,
): { artifactId: string; registryVersion: string } {
  const snapshot = createAssetRegistrySnapshot([])
  const artifact = new PersistentArtifactStore(f.session.id, f.repositories.artifacts).create({
    id: 'terminal-asset-registry',
    type: ASSET_REGISTRY_ARTIFACT,
    createdBy: 'tool',
    logicalKey: `asset-registry:${snapshot.registryVersion}`,
    data: snapshot,
  })
  return { artifactId: artifact.id, registryVersion: snapshot.registryVersion }
}

function corruptingCompilerToolsFactory(options: CompilerToolOptions = {}): AgentTool[] {
  const tools = createCompilerTools(options)
  const compile = tools[0]!
  return [{
    ...compile,
    async execute(input, context, onProgress) {
      const result = await compile.execute(input, context, onProgress)
      const artifact = result.artifacts?.[0]
      assert.ok(artifact)
      const data = artifact.data as CompiledRuntimeArtifactData
      data.sceneProjectConfig.runtimePlanArtifactId = 'malformed-after-tool-validation'
      return result
    },
  }, ...tools.slice(1)]
}

function invalidAdapterCompilerToolsFactory(options: CompilerToolOptions = {}): AgentTool[] {
  return createCompilerTools({
    ...options,
    adaptRuntimePlan(runtimePlan, artifactId) {
      return {
        ...new BaseRuntimeAdapter().adapt(runtimePlan, artifactId),
        runtimePlanArtifactId: 'malformed-before-tool-return',
      }
    },
  })
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

test('model factory snapshots the owning subject when a turn starts', async () => {
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  const repositories = new AgentRepositories(database)
  const modelInputs: Array<{ sessionId: string; subject: string }> = []
  const app = await createHttpApp({
    repositories,
    nest: new TestNestGateway(),
    modelFactory: input => {
      modelInputs.push(input as unknown as { sessionId: string; subject: string })
      return { complete: async () => ({ content: 'done' }) }
    },
  })
  const sessionId = await createSession(app, 'user-model-owner')

  const response = await app.inject({
    method: 'POST',
    url: `/sessions/${sessionId}/messages`,
    headers: bearer('user-model-owner'),
    payload: { content: '生成态势场景' },
  })
  assert.equal(response.statusCode, 202)
  await waitFor(() => modelInputs.length === 1, 'Model factory was not called')

  assert.deepEqual(modelInputs, [{ sessionId, subject: 'user-model-owner' }])
  await app.close()
  database.close()
})

test('turns endpoint returns linked public messages and persisted outcome', async () => {
  const f = await fixture()
  const sessionId = await createSession(f.app)
  const user = f.repositories.messages.append(sessionId, 'user', '这个场景有多长？')
  const run = f.repositories.runs.createQueued(sessionId, 'answer', undefined, {
    kind: 'answer',
    userMessageId: user.id,
  })
  f.repositories.runs.markRunning(run.id)
  const assistant = f.repositories.messages.append(sessionId, 'assistant', '场景时长为 180 秒。')
  f.repositories.runs.finish(run.id, 'completed', undefined, {
    assistantMessageId: assistant.id,
    outcome: { status: 'completed', finalAnswer: assistant.content },
  })
  f.repositories.events.append(sessionId, run.id, 'model.streaming', {
    runId: run.id, text: '我先检查当前场景。', hiddenReasoning: 'secret',
  })
  f.repositories.events.append(sessionId, run.id, 'model.streaming', {
    runId: run.id, text: '已取得时长证据。',
  })
  f.repositories.events.append(sessionId, run.id, 'tool.started', {
    runId: run.id, toolCallId: 'tool-1', toolName: 'inspect_replay_assets', summary: '检查场景资源',
  })
  f.repositories.events.append(sessionId, run.id, 'tool.completed', {
    runId: run.id, toolCallId: 'tool-1', toolName: 'inspect_replay_assets', summary: '检查完成',
  })

  const response = await f.app.inject({
    method: 'GET',
    url: `/sessions/${sessionId}/turns`,
    headers: bearer('user-1'),
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    turns: [{
      id: run.id,
      status: 'completed',
      kind: 'answer',
      userMessage: {
        id: user.id,
        role: 'user',
        content: user.content,
        createdAt: user.createdAt,
      },
      assistantMessage: {
        id: assistant.id,
        role: 'assistant',
        content: assistant.content,
        createdAt: assistant.createdAt,
      },
      outcome: { status: 'completed', finalAnswer: assistant.content },
      activities: [
        {
          id: 'thinking-1', type: 'thinking', status: 'completed',
          text: '我先检查当前场景。已取得时长证据。',
        },
        {
          id: 'tool-1', type: 'tool', status: 'completed', name: 'inspect_replay_assets',
          summary: '检查完成',
        },
      ],
      createdAt: run.createdAt,
      startedAt: f.repositories.runs.get(run.id)!.startedAt,
      finishedAt: f.repositories.runs.get(run.id)!.finishedAt,
    }],
  })
  f.database.close()
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

test('a text-only message seeds user brief evidence before the run starts', async () => {
  const blockingModel = new BlockingModel()
  const { app, database, repositories } = await fixture(blockingModel)
  const sessionId = await createSession(app)
  const queued = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'), payload: { content: 'generate event plan' },
  })
  assert.equal(queued.statusCode, 202)
  assert.equal(queued.json().status, 'queued')
  await blockingModel.started
  const document = repositories.artifacts.listLedger(sessionId)
    .find(artifact => artifact.type === DOCUMENT_IR_ARTIFACT)
  const evidence = repositories.artifacts.listLedger(sessionId)
    .find(artifact => artifact.type === EVIDENCE_IR_ARTIFACT)
  assert.ok(document)
  assert.ok(evidence)
  assert.equal((document.data as { paragraphs: Array<{ text: string }> }).paragraphs[0]?.text, 'generate event plan')
  assert.equal((evidence.data as { records: Array<{ claim: string }> }).records[0]?.claim, 'generate event plan')
  const queuedRun = repositories.runs.get(queued.json().runId)!
  assert.match(queuedRun.objective, /Active artifact IDs: \[[^\]]+\]/)
  assert.equal(queuedRun.kind, 'generate')
  assert.equal(repositories.messages.get(queuedRun.userMessageId!)?.content, 'generate event plan')
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

test('ordinary model success without a current draft or compiled artifact fails structurally', async () => {
  const secretAnswer = 'ordinary answer with Bearer top-secret provider body'
  const { app, database, repositories } = await fixture({ complete: async () => ({ content: secretAnswer }) })
  const sessionId = await createSession(app)
  seedOldNarrative(repositories, sessionId)
  new PersistentArtifactStore(sessionId, repositories.artifacts).create({
    id: 'last-valid', type: COMPILED_RUNTIME_ARTIFACT, createdBy: 'tool',
    logicalKey: 'compiled-runtime:prior', data: { prior: true },
  })
  const queued = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'), payload: { content: 'ordinary message' },
  })
  await waitForTerminal(repositories, sessionId)
  const run = repositories.runs.get(queued.json().runId)!
  const events = repositories.events.after(sessionId, '0')
  assert.equal(run.status, 'failed')
  assert.equal(repositories.sessions.get(sessionId)?.status, 'failed')
  assert.equal(run.error?.code, 'RUN_OUTPUT_MISSING')
  assert.equal(events.some(event => event.type === 'run.completed'), false)
  assert.equal(events.filter(event => event.type === 'run.failed').length, 1)
  assert.equal(events.some(event => typeof event.data.runtimeArtifactId === 'string'), false)
  assert.deepEqual(repositories.artifacts.listByRun(sessionId, run.id)
    .filter(item => item.type === COMPILED_RUNTIME_ARTIFACT), [])
  assert.deepEqual(repositories.artifacts.list(sessionId)
    .filter(item => item.type === COMPILED_RUNTIME_ARTIFACT && !item.superseded).map(item => item.id), ['last-valid'])
  assert.equal(repositories.messages.listRecent(sessionId).some(message => message.content.includes(secretAnswer)), false)
  assert.equal(/Bearer|top-secret|provider body/i.test(JSON.stringify({ events, error: run.error })), false)
  await app.close()
  database.close()
})

test('a factual question about an existing scene completes as an answer turn without new artifacts', async () => {
  const finalAnswer = '当前场景总时长为 180 秒。'
  const { app, database, repositories } = await fixture({ complete: async () => ({ content: finalAnswer }) })
  const sessionId = await createSession(app)
  new PersistentArtifactStore(sessionId, repositories.artifacts).create({
    id: 'existing-runtime', type: COMPILED_RUNTIME_ARTIFACT, createdBy: 'tool',
    logicalKey: 'compiled-runtime:existing', data: { sceneProjectConfig: { totalDurationMs: 180_000 } },
  })

  const queued = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'),
    payload: { content: '这个场景有多长？' },
  })
  await waitForTerminal(repositories, sessionId)

  const run = repositories.runs.get(queued.json().runId)!
  assert.equal(run.kind, 'answer')
  assert.match(run.objective, /Current scene evidence snapshot:/)
  assert.match(run.objective, /"totalDurationMs":180000/)
  assert.equal(run.status, 'completed')
  assert.equal(run.outcome?.finalAnswer, finalAnswer)
  assert.equal(repositories.messages.get(run.assistantMessageId!)?.content, finalAnswer)
  assert.deepEqual(repositories.artifacts.listByRun(sessionId, run.id), [])
  assert.equal(repositories.events.after(sessionId, '0').at(-1)?.data.finalAnswer, finalAnswer)
  await app.close()
  database.close()
})

test('a mutation request about an existing scene remains a generation turn', async () => {
  const { app, database, repositories } = await fixture({ complete: async () => ({ content: '已经调整。' }) })
  const sessionId = await createSession(app)
  new PersistentArtifactStore(sessionId, repositories.artifacts).create({
    id: 'existing-runtime', type: COMPILED_RUNTIME_ARTIFACT, createdBy: 'tool',
    logicalKey: 'compiled-runtime:existing', data: { sceneProjectConfig: { totalDurationMs: 180_000 } },
  })

  const queued = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'),
    payload: { content: '把第二段视频延后 3 秒' },
  })
  await waitForTerminal(repositories, sessionId)

  const run = repositories.runs.get(queued.json().runId)!
  assert.equal(run.kind, 'generate')
  assert.equal(run.status, 'failed')
  assert.equal(run.error?.code, 'RUN_OUTPUT_MISSING')
  await app.close()
  database.close()
})

test('an answer turn preserves a pending EventPlan review', async () => {
  const { app, database, repositories } = await fixture({
    complete: async () => ({ content: '当前草稿包含一个事件单元。' }),
  })
  const sessionId = await createSession(app)
  new PersistentArtifactStore(sessionId, repositories.artifacts).create({
    id: 'draft-for-review', type: EVENT_PLAN_DRAFT_ARTIFACT, createdBy: 'agent',
    logicalKey: 'event-plan:draft', data: { eventUnits: [{ eventUnitId: 'event-1' }] },
  })
  const pending = repositories.reviews.createPending({
    sessionId,
    artifactId: 'draft-for-review',
    artifactVersion: 1,
    fingerprint: `sha256:${'a'.repeat(64)}`,
  })
  repositories.sessions.transition(sessionId, ['idle'], 'awaiting_review')

  const queued = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'),
    payload: { content: '当前草稿有几个事件？' },
  })
  await waitForTerminal(repositories, sessionId)

  assert.equal(repositories.runs.get(queued.json().runId)?.status, 'completed')
  assert.equal(repositories.sessions.get(sessionId)?.status, 'awaiting_review')
  assert.equal(repositories.reviews.listPending(sessionId)[0]?.id, pending.id)
  await app.close()
  database.close()
})

test('failed runs never compile a NarrativePlan left by an older run', async () => {
  const model: ModelAdapter = {
    complete: async () => { throw new Error('C:\\private\\prompt.json Bearer top-secret provider body') },
  }
  const { app, database, repositories } = await fixture(model)
  const sessionId = await createSession(app)
  seedOldNarrative(repositories, sessionId)
  const queued = await app.inject({
    method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'), payload: { content: 'ordinary message' },
  })
  await waitForTerminal(repositories, sessionId)
  const run = repositories.runs.get(queued.json().runId)!
  assert.equal(run.status, 'failed')
  assert.deepEqual(repositories.artifacts.listByRun(sessionId, run.id)
    .filter(item => item.type === COMPILED_RUNTIME_ARTIFACT), [])
  assert.equal(repositories.events.after(sessionId, '0').some(event => event.type === 'run.completed'), false)
  assert.equal(/private|prompt\.json|Bearer|top-secret|provider body/i.test(JSON.stringify({
    events: repositories.events.after(sessionId, '0'), error: run.error,
  })), false)
  await app.close()
  database.close()
})

test('invalid current-run compiled artifacts fail structurally and preserve the last valid artifact', async (t) => {
  const cases: Array<{ name: string; variant: CompiledFixtureVariant }> = [
    { name: 'runtime schema', variant: 'runtime-schema' },
    { name: 'scene schema', variant: 'scene-schema' },
    { name: 'scene self-reference', variant: 'self-reference' },
    { name: 'runtime accepted lineage', variant: 'runtime-lineage' },
    { name: 'scene accepted lineage', variant: 'scene-lineage' },
    { name: 'metadata accepted lineage', variant: 'metadata-lineage' },
  ]
  for (const current of cases) {
    const model = new ControllableModel()
    const f = await terminalFixture(t, model, false)
    const acceptedArtifactId = prepareAcceptedRun(f)
    persistCompiled(f, acceptedArtifactId, { artifactId: 'last-valid' })
    const queued = f.runner.enqueueAfterApproval({
      sessionId: f.session.id,
      subject: 'user-1',
      authorization: 'Bearer user-1',
      acceptedArtifactId,
    })
    await model.started
    const invalidArtifactId = persistCompiled(f, acceptedArtifactId, {
      runId: queued.runId,
      variant: current.variant,
    })
    model.succeed()
    await waitForTerminal(f.repositories, f.session.id)

    const run = f.repositories.runs.get(queued.runId)!
    const events = f.repositories.events.after(f.session.id, '0')
    const terminalEvents = events.filter(event => ['run.completed', 'run.failed'].includes(event.type))
    assert.equal(run.status, 'failed', current.name)
    assert.equal(f.repositories.sessions.get(f.session.id)?.status, 'failed', current.name)
    assert.equal(run.error?.code, 'COMPILED_ARTIFACT_INVALID', current.name)
    assert.equal(run.error?.message, 'Replay compilation failed', current.name)
    assert.deepEqual(terminalEvents.map(event => event.type), ['run.failed'], current.name)
    assert.equal((terminalEvents[0]!.data.diagnostics as { code: string }[])[0]?.code, 'COMPILED_ARTIFACT_INVALID', current.name)
    assert.equal(terminalEvents.some(event => typeof event.data.runtimeArtifactId === 'string'), false, current.name)
    assert.equal(/Bearer|top-secret|ZodError|invalid_type|runtimePlan/i.test(JSON.stringify({ error: run.error, terminalEvents })), false, current.name)
    assert.deepEqual(f.repositories.artifacts.listLedger(f.session.id)
      .filter(item => item.type === COMPILED_RUNTIME_ARTIFACT && !item.superseded)
      .map(item => item.id), ['last-valid'], current.name)
    assert.equal(f.repositories.artifacts.get(f.session.id, invalidArtifactId)?.superseded, true, current.name)
    assert.equal(f.repositories.artifacts.get(f.session.id, 'last-valid')?.superseded, false, current.name)
    f.database.close()
  }
})

test('malformed compiler output fails before compiled persistence or publication', async (t) => {
  for (const current of [
    { name: 'invalid adapter output', factory: invalidAdapterCompilerToolsFactory },
    { name: 'corrupted tool return', factory: corruptingCompilerToolsFactory },
  ]) {
    const model = new ControllableModel()
    const f = await terminalFixture(t, model, false, {
      compilerToolsFactory: current.factory,
    })
    const acceptedArtifactId = prepareAcceptedRun(f)
    persistCompiled(f, acceptedArtifactId, { artifactId: 'last-valid' })
    const queued = f.repositories.transaction(() => f.runner.createAfterApproval({
      sessionId: f.session.id, subject: 'user-1', acceptedArtifactId,
    }))
    persistNarrative(f, acceptedArtifactId, queued.id)
    f.runner.startQueued(queued.id, 'Bearer user-1')
    await model.started

    model.succeed()
    await waitForTerminal(f.repositories, f.session.id)

    const run = f.repositories.runs.get(queued.id)!
    const events = f.repositories.events.after(f.session.id, '0')
    assert.equal(run.status, 'failed', current.name)
    assert.equal(run.error?.code, 'COMPILED_ARTIFACT_INVALID', current.name)
    assert.equal(run.error?.message, 'Replay compilation failed', current.name)
    assert.equal(events.some(event => event.type === 'run.completed'), false, current.name)
    assert.equal(events.some(event => event.type === 'artifact.created'
      && event.data.artifactType === COMPILED_RUNTIME_ARTIFACT), false, current.name)
    assert.deepEqual(f.repositories.artifacts.listByRun(f.session.id, queued.id)
      .filter(item => item.type === COMPILED_RUNTIME_ARTIFACT), [], current.name)
    assert.deepEqual(f.repositories.artifacts.listLedger(f.session.id)
      .filter(item => item.type === COMPILED_RUNTIME_ARTIFACT && !item.superseded)
      .map(item => item.id), ['last-valid'], current.name)
    f.database.close()
  }
})

test('model-invoked malformed compiler output retains its stable failure code', async (t) => {
  const model = new CompilerCallingModel()
  const f = await terminalFixture(t, model, false, {
    compilerToolsFactory: invalidAdapterCompilerToolsFactory,
  })
  const acceptedArtifactId = prepareAcceptedRun(f)
  persistCompiled(f, acceptedArtifactId, { artifactId: 'last-valid' })
  const narrativePlanArtifactId = persistNarrative(f, acceptedArtifactId)
  const registry = persistAssetRegistry(f)
  model.input = {
    eventPlanArtifactId: acceptedArtifactId,
    narrativePlanArtifactId,
    assetRegistryArtifactId: registry.artifactId,
    capabilityManifestVersion: capabilityManifest.version,
    assetRegistryVersion: registry.registryVersion,
  }
  const queued = f.runner.enqueueAfterApproval({
    sessionId: f.session.id,
    subject: 'user-1',
    authorization: 'Bearer user-1',
    acceptedArtifactId,
  })

  await waitForTerminal(f.repositories, f.session.id)

  const run = f.repositories.runs.get(queued.runId)!
  const events = f.repositories.events.after(f.session.id, '0')
  assert.equal(run.status, 'failed')
  assert.equal(run.error?.code, 'COMPILED_ARTIFACT_INVALID')
  assert.equal(run.error?.message, 'Replay compilation failed')
  assert.equal(events.some(event => event.type === 'run.completed'), false)
  assert.equal(events.some(event => event.type === 'artifact.created'
    && event.data.artifactType === COMPILED_RUNTIME_ARTIFACT), false)
  assert.deepEqual(f.repositories.artifacts.listByRun(f.session.id, queued.runId)
    .filter(item => item.type === COMPILED_RUNTIME_ARTIFACT), [])
  assert.deepEqual(f.repositories.artifacts.listLedger(f.session.id)
    .filter(item => item.type === COMPILED_RUNTIME_ARTIFACT && !item.superseded)
    .map(item => item.id), ['last-valid'])
  f.database.close()
})

test('terminal flush failures publish no completed, failed, or interrupt event', async (t) => {
  for (const outcome of ['completed', 'failed', 'interrupt'] as const) {
    const model = new ControllableModel()
    const f = await terminalFixture(t, model, true)
    const live = collectEvents(f.events, f.session.id)
    await new Promise(resolve => setImmediate(resolve))
    const acceptedArtifactId = outcome === 'completed' ? prepareAcceptedRun(f) : undefined
    const queued = acceptedArtifactId
      ? f.runner.enqueueAfterApproval({
        sessionId: f.session.id, subject: 'user-1', authorization: 'Bearer user-1', acceptedArtifactId,
      })
      : f.runner.enqueue({
        sessionId: f.session.id, subject: 'user-1', authorization: 'Bearer user-1', content: outcome,
      })
    await model.started
    if (acceptedArtifactId) persistCompiled(f, acceptedArtifactId, { runId: queued.runId })
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
    const acceptedArtifactId = outcome === 'completed' ? prepareAcceptedRun(f) : undefined
    const queued = acceptedArtifactId
      ? f.runner.enqueueAfterApproval({
        sessionId: f.session.id, subject: 'user-1', authorization: 'Bearer user-1', acceptedArtifactId,
      })
      : f.runner.enqueue({
        sessionId: f.session.id, subject: 'user-1', authorization: 'Bearer user-1', content: outcome,
      })
    await model.started
    if (acceptedArtifactId) persistCompiled(f, acceptedArtifactId, { runId: queued.runId })
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
    if (outcome === 'completed') {
      const completedRun = f.repositories.runs.get(queued.runId)!
      assert.equal(completedRun.outcome?.status, 'completed')
      assert.ok(completedRun.outcome?.finalAnswer)
      assert.equal(
        f.repositories.messages.get(completedRun.assistantMessageId!)?.content,
        completedRun.outcome?.finalAnswer,
      )
      assert.equal(terminals[0]!.data.finalAnswer, completedRun.outcome?.finalAnswer)
    }
    await live.stop()
    f.database.close()
  }
})
