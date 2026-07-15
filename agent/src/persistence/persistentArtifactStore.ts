import {
  ArtifactStore,
  type Artifact,
  type ArtifactInput,
  type ArtifactRepository,
} from '@ise/agent-core'
import type { ArtifactRepositorySqlite } from './repositories.ts'

function toArtifactInput(artifact: Artifact): ArtifactInput {
  return {
    id: artifact.id,
    type: artifact.type,
    version: artifact.version,
    createdAt: artifact.createdAt,
    createdBy: artifact.createdBy,
    data: artifact.data,
    metadata: artifact.metadata,
    logicalKey: artifact.logicalKey,
    scopeKey: artifact.scopeKey ?? '',
    supersedes: artifact.supersedes,
    superseded: artifact.superseded,
  }
}

export class PersistentArtifactStore implements ArtifactRepository {
  readonly #memory = new ArtifactStore()
  readonly #createdInRun = new Set<string>()

  constructor(
    readonly sessionId: string,
    readonly repository: ArtifactRepositorySqlite,
    readonly runId?: string,
  ) {
    this.#memory.createMany(repository.listLedger(sessionId).map(toArtifactInput))
  }

  get currentScopeKey(): string { return this.#memory.currentScopeKey }
  set currentScopeKey(value: string) { this.#memory.currentScopeKey = value }

  create<T>(input: ArtifactInput<T>): Artifact<T> {
    return this.createMany([input])[0] as Artifact<T>
  }

  createMany(inputs: readonly ArtifactInput[]): Artifact[] {
    const created = this.#memory.createMany(inputs)
    if (this.runId) for (const artifact of created) this.#createdInRun.add(artifact.id)
    this.persist()
    return created
  }

  get<T = unknown>(id: string): Artifact<T> | undefined { return this.#memory.get<T>(id) }
  list(type?: string, options?: { scopeKey?: string; includeSuperseded?: boolean }): Artifact[] {
    return this.#memory.list(type, options)
  }
  delete(id: string): boolean {
    const changed = this.#memory.delete(id)
    if (changed) this.persist()
    return changed
  }

  private persist(): void {
    const provenance = this.runId
      ? new Map([...this.#createdInRun].map(artifactId => [artifactId, this.runId!]))
      : new Map<string, string>()
    this.repository.replaceLedger(
      this.sessionId,
      this.#memory.list(undefined, { includeSuperseded: true }),
      provenance,
    )
  }
}
