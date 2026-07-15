import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import test from 'node:test'
import type { AgentActionEvent } from '@ise/agent-core'
import { AgentDatabase } from '../src/persistence/database.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'
import { EventBroker, formatSse, writeSseSession } from '../src/session/eventBroker.ts'
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
    diagnostics: [{ code: 'RUN_FAILED', message: 'C:\\secret\\prompt.txt Bearer token provider body', severity: 'error' }],
    transcript: 'hidden',
  }))
  assert.deepEqual(repositories.events.after(session.id, '0')[0]?.data, {
    runId: 'run-1', status: 'failed',
    diagnostics: [{ code: 'RUN_FAILED', message: 'Agent run failed', severity: 'error' }],
  })
  assert.equal(/secret|prompt\.txt|Bearer|provider body/i.test(JSON.stringify(repositories.events.after(session.id, '0'))), false)
  database.close()
})

test('SSE backpressure exits on close or abort without waiting forever for drain', async () => {
  for (const reason of ['close', 'abort'] as const) {
    const stream = new Writable({ write: (_chunk, _encoding, callback) => callback() })
    stream.write = (() => false) as typeof stream.write
    const controller = new AbortController()
    let abortListeners = 0
    const originalAdd = controller.signal.addEventListener.bind(controller.signal)
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal)
    controller.signal.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'abort') abortListeners += 1
      originalAdd(type, listener, options)
    }) as AbortSignal['addEventListener']
    controller.signal.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === 'abort') abortListeners -= 1
      originalRemove(type, listener, options)
    }) as AbortSignal['removeEventListener']
    let generatorClosed = false
    async function* events() {
      try {
        yield { id: '1', type: 'run.started' as const, data: { runId: 'run-1' } }
      } finally {
        generatorClosed = true
      }
    }
    const writing = writeSseSession(stream, events(), controller.signal)
    await new Promise(resolve => setImmediate(resolve))
    if (reason === 'close') stream.emit('close')
    else controller.abort()
    const completed = await Promise.race([
      writing.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 50)),
    ])
    if (!completed) stream.emit('drain')
    await writing
    assert.equal(completed, true)
    assert.equal(generatorClosed, true)
    assert.equal(stream.listenerCount('drain'), 0)
    assert.equal(stream.listenerCount('close'), 0)
    assert.equal(stream.listenerCount('error'), 0)
    assert.equal(abortListeners, 0)
  }
})

test('SSE uses database id, event type, and payload-only data', () => {
  assert.equal(formatSse({ id: '7', type: 'artifact.created', data: { artifactId: 'artifact-1' } }),
    'id: 7\nevent: artifact.created\ndata: {"artifactId":"artifact-1"}\n\n')
})
