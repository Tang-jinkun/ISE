import { EventEmitter, once } from 'node:events'
import type { Writable } from 'node:stream'
import type { AgentEventEnvelope, PublicAgentEventType } from '../api/contracts.ts'
import type { EventRepository, EventRecord } from '../persistence/repositories.ts'

function toEnvelope(row: EventRecord): AgentEventEnvelope {
  return { id: row.id, type: row.type, data: structuredClone(row.data) }
}

class AsyncQueue<T> {
  readonly #values: T[] = []
  readonly #waiters: ((result: IteratorResult<T>) => void)[] = []
  #closed = false

  push(value: T): void {
    if (this.#closed) return
    const waiter = this.#waiters.shift()
    if (waiter) waiter({ done: false, value })
    else this.#values.push(value)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined })
  }

  next(signal?: AbortSignal): Promise<IteratorResult<T>> {
    const value = this.#values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.#closed || signal?.aborted) return Promise.resolve({ done: true, value: undefined })
    return new Promise(resolve => {
      const onAbort = () => {
        const index = this.#waiters.indexOf(waiter)
        if (index >= 0) this.#waiters.splice(index, 1)
        resolve({ done: true, value: undefined })
      }
      const waiter = (result: IteratorResult<T>) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }
      this.#waiters.push(waiter)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

export class EventBroker {
  readonly #emitter = new EventEmitter()

  constructor(readonly events: EventRepository) {
    this.#emitter.setMaxListeners(0)
  }

  append(
    sessionId: string,
    runId: string | undefined,
    type: PublicAgentEventType,
    data: Record<string, unknown>,
  ): AgentEventEnvelope {
    const event = toEnvelope(this.events.append(sessionId, runId, type, data))
    this.#emitter.emit(sessionId, event)
    return event
  }

  replayAfter(sessionId: string, lastEventId: string): AgentEventEnvelope[] {
    return this.events.after(sessionId, lastEventId).map(toEnvelope)
  }

  async *subscribe(sessionId: string, lastEventId: string, signal?: AbortSignal): AsyncGenerator<AgentEventEnvelope> {
    let highWater = BigInt(lastEventId)
    const queue = new AsyncQueue<AgentEventEnvelope>()
    const onEvent = (event: AgentEventEnvelope) => {
      if (BigInt(event.id) > highWater) queue.push(event)
    }
    this.#emitter.on(sessionId, onEvent)
    try {
      for (const event of this.replayAfter(sessionId, lastEventId)) {
        if (BigInt(event.id) <= highWater) continue
        highWater = BigInt(event.id)
        yield event
      }
      while (!signal?.aborted) {
        const next = await queue.next(signal)
        if (next.done) break
        if (BigInt(next.value.id) <= highWater) continue
        highWater = BigInt(next.value.id)
        yield next.value
      }
    } finally {
      queue.close()
      this.#emitter.off(sessionId, onEvent)
    }
  }
}

export function formatSse(event: AgentEventEnvelope): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
}

export async function writeSseSession(
  stream: Writable,
  events: AsyncIterable<AgentEventEnvelope>,
  signal?: AbortSignal,
): Promise<void> {
  for await (const event of events) {
    if (signal?.aborted || stream.destroyed) break
    if (!stream.write(formatSse(event))) await once(stream, 'drain')
  }
}
