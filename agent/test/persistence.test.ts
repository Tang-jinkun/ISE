import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { AgentDatabase } from '../src/persistence/database.ts'
import { PersistentArtifactStore } from '../src/persistence/persistentArtifactStore.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'

async function memoryRepositories() {
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  return { database, repositories: new AgentRepositories(database) }
}

async function databasePath(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ise-agent-db-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return join(directory, 'agent.sqlite')
}

test('foreign subjects cannot observe whether a session exists', async () => {
  const { database, repositories } = await memoryRepositories()
  const session = repositories.sessions.create('user-1')
  assert.throws(() => repositories.sessions.requireOwned(session.id, 'user-2'), (error: unknown) =>
    error instanceof Error && error.message.includes('SESSION_NOT_FOUND'))
  assert.throws(() => repositories.sessions.requireOwned('missing', 'user-2'), (error: unknown) =>
    error instanceof Error && error.message.includes('SESSION_NOT_FOUND'))
  database.close()
})

test('only one queued or running run exists per session', async () => {
  const { database, repositories } = await memoryRepositories()
  const session = repositories.sessions.create('user-1')
  repositories.runs.createQueued(session.id, 'first')
  assert.throws(() => repositories.runs.createQueued(session.id, 'second'), /ACTIVE_RUN_EXISTS/)
  database.close()
})

test('event ids are durable and replay in ascending order', async (t) => {
  const path = await databasePath(t)
  const firstDatabase = await AgentDatabase.open(path, 'sql.js')
  const firstRepositories = new AgentRepositories(firstDatabase)
  const session = firstRepositories.sessions.create('user-1')
  const first = firstRepositories.events.append(session.id, undefined, 'run.started', { runId: 'run-1' })
  const second = firstRepositories.events.append(session.id, undefined, 'tool.started', { toolName: 'parse_battle_report' })
  firstDatabase.close()

  const reopened = await AgentDatabase.open(path, 'sql.js')
  const events = new AgentRepositories(reopened).events.after(session.id, first.id)
  assert.deepEqual(events.map(event => event.id), [second.id])
  reopened.close()
})

test('persistent artifact store retains superseded ledger state after reopen', async (t) => {
  const path = await databasePath(t)
  const firstDatabase = await AgentDatabase.open(path, 'sql.js')
  const firstRepositories = new AgentRepositories(firstDatabase)
  const session = firstRepositories.sessions.create('user-1')
  const store = new PersistentArtifactStore(session.id, firstRepositories.artifacts)
  store.create({ id: 'v1', type: 'plan', logicalKey: 'plan:1', createdBy: 'agent', data: { version: 1 } })
  store.create({ id: 'v2', type: 'plan', logicalKey: 'plan:1', createdBy: 'agent', data: { version: 2 } })
  firstDatabase.close()

  const reopenedDatabase = await AgentDatabase.open(path, 'sql.js')
  const reopened = new PersistentArtifactStore(session.id, new AgentRepositories(reopenedDatabase).artifacts)
  assert.equal(reopened.get('v1')?.superseded, true)
  assert.deepEqual(reopened.list('plan').map(item => item.id), ['v2'])
  reopenedDatabase.close()
})

test('compare-and-set transitions reject stale state and recovery fails interrupted runs', async () => {
  const { database, repositories } = await memoryRepositories()
  const session = repositories.sessions.create('user-1')
  const run = repositories.runs.createQueued(session.id, 'objective')
  repositories.sessions.transition(session.id, ['idle'], 'queued', run.id)
  repositories.runs.markRunning(run.id)
  repositories.sessions.transition(session.id, ['queued'], 'running', run.id)
  assert.throws(() => repositories.sessions.transition(session.id, ['queued'], 'completed'), /SESSION_STATE_CONFLICT/)

  repositories.recoverInterruptedRuns()
  assert.equal(repositories.runs.get(run.id)?.status, 'failed')
  assert.equal(repositories.runs.get(run.id)?.error?.code, 'SERVICE_RESTARTED_DURING_RUN')
  assert.equal(repositories.sessions.get(session.id)?.activeRunId, undefined)
  assert.equal(repositories.sessions.get(session.id)?.status, 'failed')
  database.close()
})
