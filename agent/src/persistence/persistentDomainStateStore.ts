import {
  DomainStateStore,
  type DomainState,
  type DomainStatePatch,
  type DomainStateRepository,
} from '@ise/agent-core'
import type { SessionRepository } from './repositories.ts'

export class PersistentDomainStateStore implements DomainStateRepository {
  readonly #memory: DomainStateStore
  constructor(readonly sessionId: string, readonly sessions: SessionRepository) {
    this.#memory = new DomainStateStore(sessions.readDomainState(sessionId))
  }
  snapshot<T extends DomainState = DomainState>(): T { return this.#memory.snapshot<T>() }
  applyPatch(patch: DomainStatePatch): DomainState {
    const state = this.#memory.applyPatch(patch)
    this.sessions.writeDomainState(this.sessionId, state)
    return state
  }
}
