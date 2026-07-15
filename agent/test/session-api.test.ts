import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelAdapter, ModelRequest, ModelResponse } from '@ise/agent-core'
import type { AuthorizedFile, NestGateway } from '../src/adapters/nestGateway.ts'
import { createHttpApp } from '../src/api/httpApp.ts'
import { AgentDatabase } from '../src/persistence/database.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'

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
