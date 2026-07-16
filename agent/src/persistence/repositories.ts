import { randomUUID } from 'node:crypto'
import type { Artifact, TurnOutcome } from '@ise/agent-core'
import type { AuthorizedFile } from '../adapters/nestGateway.ts'
import type { PublicAgentEventType, SessionStatus } from '../api/contracts.ts'
import { agentError } from '../api/errors.ts'
import { canonicalJson } from '../services/fingerprint.ts'
import type { AgentDatabase } from './database.ts'
import type { ReviewStatusRow, RunStatusRow } from './schema.ts'

function now(): string { return new Date().toISOString() }
function json(value: unknown): string { return canonicalJson(value) }
function parseJson<T>(value: unknown): T { return JSON.parse(String(value)) as T }
function optionalString(value: unknown): string | undefined { return value === null || value === undefined ? undefined : String(value) }
function requiredString(value: unknown): string { return String(value) }
function requiredNumber(value: unknown): number { return Number(value) }

export interface SessionRecord {
  id: string
  subject: string
  status: SessionStatus
  activeRunId?: string
  domainState: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export class SessionRepository {
  constructor(private readonly database: AgentDatabase) {}

  create(subject: string): SessionRecord {
    const id = randomUUID()
    const timestamp = now()
    this.database.transaction(() => this.database.prepare(
      `INSERT INTO sessions(id,subject,status,domain_state_json,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
    ).run([id, subject, 'idle', '{}', timestamp, timestamp]))
    return this.requireOwned(id, subject)
  }

  get(id: string): SessionRecord | undefined {
    const row = this.database.prepare('SELECT * FROM sessions WHERE id = ?').get([id])
    return row ? this.toRecord(row) : undefined
  }

  requireOwned(id: string, subject: string): SessionRecord {
    const row = this.database.prepare('SELECT * FROM sessions WHERE id = ? AND subject = ?').get([id, subject])
    if (!row) throw agentError(404, 'SESSION_NOT_FOUND')
    return this.toRecord(row)
  }

  transition(id: string, allowed: readonly SessionStatus[], status: SessionStatus, activeRunId?: string): SessionRecord {
    if (allowed.length === 0) throw new Error('SESSION_STATE_CONFLICT')
    const placeholders = allowed.map(() => '?').join(',')
    const result = this.database.transaction(() => this.database.prepare(
      `UPDATE sessions SET status = ?, active_run_id = ?, updated_at = ? WHERE id = ? AND status IN (${placeholders})`,
    ).run([status, activeRunId ?? null, now(), id, ...allowed]))
    if (result.changes !== 1) throw agentError(409, 'SESSION_STATE_CONFLICT')
    return this.get(id)!
  }

  readDomainState(id: string): Record<string, unknown> {
    const row = this.database.prepare('SELECT domain_state_json FROM sessions WHERE id = ?').get([id])
    if (!row) throw agentError(404, 'SESSION_NOT_FOUND')
    return parseJson(row.domain_state_json)
  }

  writeDomainState(id: string, state: Record<string, unknown>): void {
    const result = this.database.transaction(() => this.database.prepare(
      'UPDATE sessions SET domain_state_json = ?, updated_at = ? WHERE id = ?',
    ).run([json(state), now(), id]))
    if (result.changes !== 1) throw agentError(404, 'SESSION_NOT_FOUND')
  }

  private toRecord(row: Record<string, unknown>): SessionRecord {
    return {
      id: requiredString(row.id),
      subject: requiredString(row.subject),
      status: requiredString(row.status) as SessionStatus,
      ...(optionalString(row.active_run_id) ? { activeRunId: optionalString(row.active_run_id) } : {}),
      domainState: parseJson(row.domain_state_json),
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at),
    }
  }
}

export interface MessageRecord { id: string; sessionId: string; role: 'user' | 'assistant'; content: string; createdAt: string }
export class MessageRepository {
  constructor(private readonly database: AgentDatabase) {}
  append(sessionId: string, role: 'user' | 'assistant', content: string): MessageRecord {
    const record = { id: randomUUID(), sessionId, role, content, createdAt: now() }
    this.database.transaction(() => this.database.prepare(
      'INSERT INTO session_messages(id,session_id,role,content,created_at) VALUES(?,?,?,?,?)',
    ).run([record.id, sessionId, role, content, record.createdAt]))
    return record
  }
  get(id: string): MessageRecord | undefined {
    const row = this.database.prepare('SELECT * FROM session_messages WHERE id = ?').get([id])
    return row ? this.toRecord(row) : undefined
  }
  listRecent(sessionId: string, limit = 12): MessageRecord[] {
    return this.database.prepare(
      'SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    ).all([sessionId, limit]).reverse().map(row => this.toRecord(row))
  }
  private toRecord(row: Record<string, unknown>): MessageRecord {
    return {
      id: requiredString(row.id), sessionId: requiredString(row.session_id),
      role: requiredString(row.role) as 'user' | 'assistant', content: requiredString(row.content),
      createdAt: requiredString(row.created_at),
    }
  }
}

export interface PersistedAttachmentRecord {
  id: string; sessionId: string; fileId: string; name: string; mimeType: string
  size: number; fingerprint: string; createdAt: string
}
export class AttachmentRepository {
  constructor(private readonly database: AgentDatabase) {}
  create(sessionId: string, file: AuthorizedFile): PersistedAttachmentRecord {
    const record: PersistedAttachmentRecord = {
      id: randomUUID(), sessionId, fileId: file.fileId, name: file.name, mimeType: file.mimeType,
      size: file.size, fingerprint: file.fingerprint, createdAt: now(),
    }
    try {
      this.database.transaction(() => this.database.prepare(
        'INSERT INTO session_attachments(id,session_id,file_id,name,mime_type,size,fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?)',
      ).run([record.id, sessionId, record.fileId, record.name, record.mimeType, record.size, record.fingerprint, record.createdAt]))
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw agentError(409, 'ATTACHMENT_EXISTS')
      throw error
    }
    return record
  }
  get(sessionId: string, fileId: string): PersistedAttachmentRecord | undefined {
    const row = this.database.prepare('SELECT * FROM session_attachments WHERE session_id = ? AND file_id = ?').get([sessionId, fileId])
    return row ? this.toRecord(row) : undefined
  }
  list(sessionId: string): PersistedAttachmentRecord[] {
    return this.database.prepare('SELECT * FROM session_attachments WHERE session_id = ? ORDER BY created_at,id').all([sessionId]).map(row => this.toRecord(row))
  }
  private toRecord(row: Record<string, unknown>): PersistedAttachmentRecord {
    return {
      id: requiredString(row.id), sessionId: requiredString(row.session_id), fileId: requiredString(row.file_id),
      name: requiredString(row.name), mimeType: requiredString(row.mime_type), size: requiredNumber(row.size),
      fingerprint: requiredString(row.fingerprint), createdAt: requiredString(row.created_at),
    }
  }
}

export interface RunRecord {
  id: string; sessionId: string; objective: string; status: RunStatusRow
  startedAt?: string; finishedAt?: string; error?: Record<string, unknown>
  expectedAccepted?: { artifactId: string; version: number; fingerprint: string }
  kind: 'generate' | 'answer'; userMessageId?: string; assistantMessageId?: string
  outcome?: TurnOutcome
  createdAt: string
}
export class RunRepository {
  constructor(private readonly database: AgentDatabase) {}
  createQueued(
    sessionId: string,
    objective: string,
    expectedAccepted?: { artifactId: string; version: number; fingerprint: string },
    turn?: { kind: 'generate' | 'answer'; userMessageId?: string },
  ): RunRecord {
    const id = randomUUID()
    try {
      this.database.transaction(() => this.database.prepare(
        `INSERT INTO runs(
          id,session_id,objective,status,expected_accepted_artifact_id,expected_accepted_version,
          expected_accepted_fingerprint,request_kind,user_message_id,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ).run([
        id, sessionId, objective, 'queued', expectedAccepted?.artifactId ?? null,
        expectedAccepted?.version ?? null, expectedAccepted?.fingerprint ?? null,
        turn?.kind ?? 'generate', turn?.userMessageId ?? null, now(),
      ]))
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw agentError(409, 'ACTIVE_RUN_EXISTS')
      throw error
    }
    return this.get(id)!
  }
  get(id: string): RunRecord | undefined {
    const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get([id])
    return row ? this.toRecord(row) : undefined
  }
  listBySession(sessionId: string): RunRecord[] {
    return this.database.prepare(
      'SELECT * FROM runs WHERE session_id = ? ORDER BY created_at ASC, id ASC',
    ).all([sessionId]).map(row => this.toRecord(row))
  }
  markRunning(id: string): RunRecord {
    const result = this.database.transaction(() => this.database.prepare(
      `UPDATE runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`,
    ).run([now(), id]))
    if (result.changes !== 1) throw agentError(409, 'RUN_STATE_CONFLICT')
    return this.get(id)!
  }
  finish(
    id: string,
    status: 'completed' | 'failed' | 'cancelled',
    error?: Record<string, unknown>,
    turn?: { assistantMessageId?: string; outcome?: TurnOutcome },
  ): RunRecord {
    const result = this.database.transaction(() => this.database.prepare(
      `UPDATE runs SET status = ?, finished_at = ?, error_json = ?, assistant_message_id = ?, outcome_json = ?
       WHERE id = ? AND status IN ('queued','running')`,
    ).run([
      status, now(), error === undefined ? null : json(error), turn?.assistantMessageId ?? null,
      turn?.outcome === undefined ? null : json(turn.outcome), id,
    ]))
    if (result.changes !== 1) throw agentError(409, 'RUN_STATE_CONFLICT')
    return this.get(id)!
  }
  private toRecord(row: Record<string, unknown>): RunRecord {
    return {
      id: requiredString(row.id), sessionId: requiredString(row.session_id), objective: requiredString(row.objective),
      status: requiredString(row.status) as RunStatusRow,
      ...(optionalString(row.started_at) ? { startedAt: optionalString(row.started_at) } : {}),
      ...(optionalString(row.finished_at) ? { finishedAt: optionalString(row.finished_at) } : {}),
      ...(optionalString(row.error_json) ? { error: parseJson(row.error_json) } : {}),
      ...(optionalString(row.expected_accepted_artifact_id) ? { expectedAccepted: {
        artifactId: requiredString(row.expected_accepted_artifact_id),
        version: requiredNumber(row.expected_accepted_version),
        fingerprint: requiredString(row.expected_accepted_fingerprint),
      } } : {}),
      kind: optionalString(row.request_kind) === 'answer' ? 'answer' : 'generate',
      ...(optionalString(row.user_message_id) ? { userMessageId: optionalString(row.user_message_id) } : {}),
      ...(optionalString(row.assistant_message_id) ? { assistantMessageId: optionalString(row.assistant_message_id) } : {}),
      ...(optionalString(row.outcome_json) ? { outcome: parseJson<TurnOutcome>(row.outcome_json) } : {}),
      createdAt: requiredString(row.created_at),
    }
  }
}

export interface EventRecord {
  id: string; sessionId: string; runId?: string; type: PublicAgentEventType
  data: Record<string, unknown>; createdAt: string
}
export class EventRepository {
  constructor(private readonly database: AgentDatabase) {}
  append(sessionId: string, runId: string | undefined, type: PublicAgentEventType, data: Record<string, unknown>): EventRecord {
    const createdAt = now()
    return this.database.transaction(() => {
      this.database.prepare('INSERT INTO events(session_id,run_id,type,data_json,created_at) VALUES(?,?,?,?,?)')
        .run([sessionId, runId ?? null, type, json(data), createdAt])
      const id = requiredString(this.database.prepare('SELECT last_insert_rowid() AS id').get()!.id)
      return { id, sessionId, ...(runId ? { runId } : {}), type, data: structuredClone(data), createdAt }
    })
  }
  after(sessionId: string, lastId: string): EventRecord[] {
    return this.database.prepare('SELECT * FROM events WHERE session_id = ? AND id > ? ORDER BY id ASC')
      .all([sessionId, Number(lastId)]).map(row => this.toRecord(row))
  }
  listByRun(sessionId: string, runId: string): EventRecord[] {
    return this.database.prepare(
      'SELECT * FROM events WHERE session_id = ? AND run_id = ? ORDER BY id ASC',
    ).all([sessionId, runId]).map(row => this.toRecord(row))
  }
  private toRecord(row: Record<string, unknown>): EventRecord {
    return {
      id: requiredString(row.id), sessionId: requiredString(row.session_id),
      ...(optionalString(row.run_id) ? { runId: optionalString(row.run_id) } : {}),
      type: requiredString(row.type) as PublicAgentEventType,
      data: parseJson(row.data_json), createdAt: requiredString(row.created_at),
    }
  }
}

export class ArtifactRepositorySqlite {
  constructor(private readonly database: AgentDatabase) {}
  replaceLedger(
    sessionId: string,
    artifacts: readonly Artifact[],
    createdByRun: ReadonlyMap<string, string> = new Map(),
  ): void {
    this.database.transaction(() => {
      const existingRunIds = new Map(this.database.prepare(
        'SELECT id,run_id FROM artifacts WHERE session_id = ? AND run_id IS NOT NULL',
      ).all([sessionId]).map(row => [requiredString(row.id), requiredString(row.run_id)]))
      this.database.prepare('DELETE FROM artifacts WHERE session_id = ?').run([sessionId])
      const insert = this.database.prepare(`INSERT INTO artifacts(
        id,session_id,run_id,type,version,created_at,created_by,data_json,metadata_json,
        logical_key,scope_key,supersedes,superseded
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      for (const artifact of artifacts) {
        insert.run([
          artifact.id, sessionId, createdByRun.get(artifact.id) ?? existingRunIds.get(artifact.id) ?? null,
          artifact.type, artifact.version, artifact.createdAt, artifact.createdBy,
          json(artifact.data), artifact.metadata === undefined ? null : json(artifact.metadata),
          artifact.logicalKey ?? null, artifact.scopeKey ?? null, artifact.supersedes ?? null,
          artifact.superseded ? 1 : 0,
        ])
      }
    })
  }
  listLedger(sessionId: string): Artifact[] {
    return this.database.prepare('SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at,id').all([sessionId]).map(row => this.toArtifact(row))
  }
  list(sessionId: string): Artifact[] { return this.listLedger(sessionId) }
  listByRun(sessionId: string, runId: string): Artifact[] {
    return this.database.prepare(
      'SELECT * FROM artifacts WHERE session_id = ? AND run_id = ? ORDER BY created_at,id',
    ).all([sessionId, runId]).map(row => this.toArtifact(row))
  }
  get(sessionId: string, id: string): Artifact | undefined {
    const row = this.database.prepare('SELECT * FROM artifacts WHERE session_id = ? AND id = ?').get([sessionId, id])
    return row ? this.toArtifact(row) : undefined
  }
  private toArtifact(row: Record<string, unknown>): Artifact {
    return {
      id: requiredString(row.id), type: requiredString(row.type), version: requiredNumber(row.version),
      createdAt: requiredString(row.created_at), createdBy: requiredString(row.created_by) as Artifact['createdBy'],
      data: parseJson(row.data_json),
      ...(optionalString(row.metadata_json) ? { metadata: parseJson<Record<string, unknown>>(row.metadata_json) } : {}),
      ...(optionalString(row.logical_key) ? { logicalKey: optionalString(row.logical_key) } : {}),
      ...(optionalString(row.scope_key) ? { scopeKey: optionalString(row.scope_key) } : {}),
      ...(optionalString(row.supersedes) ? { supersedes: optionalString(row.supersedes) } : {}),
      superseded: requiredNumber(row.superseded) === 1,
    }
  }
}

export interface ReviewRecord {
  id: string; sessionId: string; artifactId: string; artifactVersion: number; fingerprint: string
  status: ReviewStatusRow; confirmationId?: string; reason?: string; createdAt: string; resolvedAt?: string
}
export class ReviewRepository {
  constructor(private readonly database: AgentDatabase) {}
  createPending(input: { sessionId: string; artifactId: string; artifactVersion: number; fingerprint: string }): ReviewRecord {
    const id = randomUUID()
    this.database.transaction(() => this.database.prepare(
      `INSERT INTO reviews(id,session_id,artifact_id,artifact_version,fingerprint,status,created_at) VALUES(?,?,?,?,?,'pending',?)`,
    ).run([id, input.sessionId, input.artifactId, input.artifactVersion, input.fingerprint, now()]))
    return this.get(input.sessionId, id)!
  }
  get(sessionId: string, id: string): ReviewRecord | undefined {
    const row = this.database.prepare('SELECT * FROM reviews WHERE session_id = ? AND id = ?').get([sessionId, id])
    return row ? this.toRecord(row) : undefined
  }
  requirePendingForArtifact(sessionId: string, artifactId: string): ReviewRecord {
    const row = this.database.prepare(`SELECT * FROM reviews WHERE session_id = ? AND artifact_id = ? AND status = 'pending'`).get([sessionId, artifactId])
    if (!row) throw agentError(404, 'REVIEW_NOT_FOUND')
    return this.toRecord(row)
  }
  listPending(sessionId: string): ReviewRecord[] {
    return this.database.prepare(`SELECT * FROM reviews WHERE session_id = ? AND status = 'pending' ORDER BY created_at,id`).all([sessionId]).map(row => this.toRecord(row))
  }
  resolve(input: { sessionId: string; reviewId: string; artifactId: string; version: number; fingerprint: string; status: 'approved' | 'rejected'; confirmationId?: string; reason?: string }): ReviewRecord {
    const result = this.database.transaction(() => this.database.prepare(`UPDATE reviews SET status = ?, confirmation_id = ?, reason = ?, resolved_at = ?
      WHERE id = ? AND session_id = ? AND status = 'pending' AND artifact_id = ? AND artifact_version = ? AND fingerprint = ?`).run([
      input.status, input.confirmationId ?? null, input.reason ?? null, now(), input.reviewId,
      input.sessionId, input.artifactId, input.version, input.fingerprint,
    ]))
    if (result.changes !== 1) throw agentError(409, 'STALE_REVIEW_TUPLE')
    return this.get(input.sessionId, input.reviewId)!
  }
  supersedePending(sessionId: string): void {
    this.database.transaction(() => this.database.prepare(`UPDATE reviews SET status = 'superseded', resolved_at = ? WHERE session_id = ? AND status = 'pending'`).run([now(), sessionId]))
  }
  supersedeExact(input: {
    sessionId: string; reviewId: string; artifactId: string; version: number; fingerprint: string
  }): void {
    const result = this.database.transaction(() => this.database.prepare(`UPDATE reviews
      SET status = 'superseded', resolved_at = ?
      WHERE id = ? AND session_id = ? AND status = 'pending'
        AND artifact_id = ? AND artifact_version = ? AND fingerprint = ?`).run([
      now(), input.reviewId, input.sessionId, input.artifactId, input.version, input.fingerprint,
    ]))
    if (result.changes !== 1) throw agentError(409, 'STALE_REVIEW_TUPLE')
  }
  private toRecord(row: Record<string, unknown>): ReviewRecord {
    return {
      id: requiredString(row.id), sessionId: requiredString(row.session_id), artifactId: requiredString(row.artifact_id),
      artifactVersion: requiredNumber(row.artifact_version), fingerprint: requiredString(row.fingerprint),
      status: requiredString(row.status) as ReviewStatusRow,
      ...(optionalString(row.confirmation_id) ? { confirmationId: optionalString(row.confirmation_id) } : {}),
      ...(optionalString(row.reason) ? { reason: optionalString(row.reason) } : {}),
      createdAt: requiredString(row.created_at),
      ...(optionalString(row.resolved_at) ? { resolvedAt: optionalString(row.resolved_at) } : {}),
    }
  }
}

export class AgentRepositories {
  readonly sessions: SessionRepository
  readonly messages: MessageRepository
  readonly attachments: AttachmentRepository
  readonly runs: RunRepository
  readonly events: EventRepository
  readonly artifacts: ArtifactRepositorySqlite
  readonly reviews: ReviewRepository
  readonly #afterCommitFrames: (() => void)[][] = []

  constructor(readonly database: AgentDatabase) {
    this.sessions = new SessionRepository(database)
    this.messages = new MessageRepository(database)
    this.attachments = new AttachmentRepository(database)
    this.runs = new RunRepository(database)
    this.events = new EventRepository(database)
    this.artifacts = new ArtifactRepositorySqlite(database)
    this.reviews = new ReviewRepository(database)
  }

  transaction<T>(work: () => T): T {
    const callbacks: (() => void)[] = []
    this.#afterCommitFrames.push(callbacks)
    let result: T
    try {
      result = this.database.transaction(work)
    } catch (error) {
      this.#afterCommitFrames.pop()
      throw error
    }
    this.#afterCommitFrames.pop()
    const parent = this.#afterCommitFrames.at(-1)
    if (parent) parent.push(...callbacks)
    else for (const callback of callbacks) callback()
    return result
  }

  afterCommit(callback: () => void): void {
    const frame = this.#afterCommitFrames.at(-1)
    if (frame) frame.push(callback)
    else callback()
  }

  recoverInterruptedRuns(): void {
    this.database.transaction(() => {
      const interrupted = this.database.prepare(`SELECT id,session_id FROM runs WHERE status IN ('queued','running')`).all()
      const failure = json({ code: 'SERVICE_RESTARTED_DURING_RUN', message: 'Service restarted during run' })
      for (const row of interrupted) {
        this.database.prepare(`UPDATE runs SET status = 'failed', finished_at = ?, error_json = ? WHERE id = ?`).run([now(), failure, row.id as string])
        this.database.prepare(`UPDATE sessions SET status = 'failed', active_run_id = NULL, updated_at = ? WHERE id = ?`).run([now(), row.session_id as string])
      }
      this.database.prepare(`UPDATE sessions SET status = 'failed', active_run_id = NULL, updated_at = ?
        WHERE status IN ('queued','running') AND NOT EXISTS (
          SELECT 1 FROM runs WHERE runs.id = sessions.active_run_id AND runs.status IN ('queued','running')
        )`).run([now()])
      this.database.prepare(`UPDATE sessions SET status = 'failed', active_run_id = NULL, updated_at = ?
        WHERE status = 'awaiting_review' AND NOT EXISTS (
          SELECT 1 FROM reviews WHERE reviews.session_id = sessions.id AND reviews.status = 'pending'
        )`).run([now()])
    })
  }
}
