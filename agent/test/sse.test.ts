import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentActionEvent } from '@ise/agent-core'
import { AgentDatabase } from '../src/persistence/database.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'
import { EventBroker, formatSse } from '../src/session/eventBroker.ts'
import { PublicEventSink } from '../src/session/publicEventSink.ts'

async function fixture() {
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  const repositories = new AgentRepositories(database)
  const session = repositories.sessions.create('user-1')
  return { database, repositories, session, broker: new EventBroker(repositories.events) }
}

function coreEvent(eventType: AgentActionEvent['eventType'], data?: Record<string, unknown>): AgentActionEvent {
  return {
    runId: 'run-1', turn: 1, eventType, summary: 'summary', status: eventType === 'run.failed' ? 'failed' : 'started',
    toolCallId: eventType.startsWith('tool.') ? 'call-1' : undefined,
    data,
    timestamp: new Date(0).toISOString(),
  }
}

test('replay then live delivery has no gap or duplicate', async () => {
  const { database, session, broker } = await fixture()
  broker.append(session.id, 'run-1', 'run.started', { runId: 'run-1', status: 'running' })
  const stream = broker.subscribe(session.id, '0')
  const first = await stream.next()
  broker.append(session.id, 'run-1', 'tool.started', {
    runId: 'run-1', toolCallId: 'call-1', toolName: 'parse_battle_report',
  })
  const second = await stream.next()
  assert.deepEqual([first.value?.id, second.value?.id], ['1', '2'])
  await stream.return(undefined)
  database.close()
})

test('public sink drops model and hidden runtime events and projects public fields', async () => {
  const { database, repositories, session, broker } = await fixture()
  const sink = new PublicEventSink(session.id, broker)
  await sink.emit(coreEvent('model.streaming', { token: 'secret' }))
  await sink.emit(coreEvent('model.responded', { prompt: 'secret' }))
  await sink.emit(coreEvent('tool.started', { tool: 'inspect_report_evidence', input: { authorization: 'secret' } }))
  const recorded = repositories.events.after(session.id, '0')
  assert.deepEqual(recorded.map(event => event.type), ['tool.started'])
  assert.deepEqual(recorded[0]?.data, {
    runId: 'run-1', toolCallId: 'call-1', toolName: 'inspect_report_evidence', summary: 'summary',
  })
  assert.equal(JSON.stringify(recorded).includes('secret'), false)
  database.close()
})

test('run failures expose structured diagnostics without raw error input', async () => {
  const { database, repositories, session, broker } = await fixture()
  const sink = new PublicEventSink(session.id, broker)
  await sink.emit(coreEvent('run.failed', {
    diagnostics: [{ code: 'RUN_FAILED', message: 'failed', severity: 'error' }],
    transcript: 'hidden',
  }))
  assert.deepEqual(repositories.events.after(session.id, '0')[0]?.data, {
    runId: 'run-1', status: 'failed',
    diagnostics: [{ code: 'RUN_FAILED', message: 'failed', severity: 'error' }],
  })
  database.close()
})

test('SSE uses database id, event type, and payload-only data', () => {
  assert.equal(formatSse({ id: '7', type: 'artifact.created', data: { artifactId: 'artifact-1' } }),
    'id: 7\nevent: artifact.created\ndata: {"artifactId":"artifact-1"}\n\n')
})
