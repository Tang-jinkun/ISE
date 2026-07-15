import {
  ArtifactStore,
  DomainStateStore,
  executeToolCall,
  type AgentContext,
  type AgentTool,
  type Artifact,
  type ArtifactInput,
  type ArtifactRepository,
} from '@ise/agent-core'
import type { AgentArtifactView, QueuedRunResponse, ReviewTuple, RevisionRequest } from '../api/contracts.ts'
import { agentError } from '../api/errors.ts'
import { toArtifactView } from '../api/sessionRoutes.ts'
import {
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  EVENT_PLAN_DRAFT_ARTIFACT,
} from '../contracts/artifactTypes.ts'
import { eventPlanSchema, type EventPlan } from '../contracts/eventPlan.ts'
import type { AgentRepositories, ReviewRecord } from '../persistence/repositories.ts'
import { createEventPlanTools } from '../tools/eventPlanTools.ts'
import type { EventBroker } from './eventBroker.ts'
import type { SessionAgentRunner } from './sessionAgentRunner.ts'

function requireTool(tools: readonly AgentTool[], name: string): AgentTool {
  const tool = tools.find(item => item.name === name)
  if (!tool) throw new Error(`Tool not found: ${name}`)
  return tool
}

function tuple(review: ReviewRecord): ReviewTuple {
  return {
    reviewId: review.id,
    artifactId: review.artifactId,
    version: review.artifactVersion,
    fingerprint: review.fingerprint,
  }
}

function artifactInput(artifact: Artifact): ArtifactInput {
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

export class ReviewService {
  readonly #sessionTails = new Map<string, Promise<void>>()

  constructor(
    readonly repositories: AgentRepositories,
    readonly events: EventBroker,
    readonly runner: SessionAgentRunner,
    readonly workspace: string,
  ) {}

  createForDraft(sessionId: string, runId: string, draft: Artifact): ReviewTuple {
    if (draft.type !== EVENT_PLAN_DRAFT_ARTIFACT) throw new Error('REVIEW_REQUIRES_EVENT_PLAN_DRAFT')
    const plan = eventPlanSchema.parse(draft.data)
    const fingerprint = draft.metadata?.fingerprint
    if (typeof fingerprint !== 'string') throw new Error('DRAFT_FINGERPRINT_MISSING')
    const review = this.repositories.transaction(() => {
      this.repositories.reviews.supersedePending(sessionId)
      const created = this.repositories.reviews.createPending({
        sessionId,
        artifactId: draft.id,
        artifactVersion: plan.version,
        fingerprint,
      })
      this.repositories.sessions.transition(sessionId, ['running', 'awaiting_review'], 'awaiting_review')
      this.appendAfterCommit(sessionId, runId, 'review.requested', tuple(created))
      return created
    })
    return tuple(review)
  }

  async approve(input: {
    sessionId: string
    subject: string
    authorization: string
    reviewId: string
    artifactId: string
    version: number
    fingerprint: string
  }): Promise<QueuedRunResponse> {
    return this.serialized(input.sessionId, async () => {
      this.repositories.sessions.requireOwned(input.sessionId, input.subject)
      const review = this.requireExactPending(input)
      const artifacts = this.temporaryArtifacts(input.sessionId)
      const existingIds = new Set(artifacts.list(undefined, { includeSuperseded: true }).map(artifact => artifact.id))
      const execution = await executeToolCall({
        tool: requireTool(createEventPlanTools(), 'accept_event_plan'),
        call: {
          id: `approve-${review.id}`,
          name: 'accept_event_plan',
          input: { draftArtifactId: review.artifactId, version: review.artifactVersion, fingerprint: review.fingerprint },
        },
        context: this.context(input.sessionId, artifacts),
        runId: `approval-${review.id}`,
        turn: 0,
        guard: { check: async () => ({ decision: 'allow', confirmationId: `review:${review.id}:${input.subject}` }) },
      })
      if (execution.outcome !== 'completed') throw agentError(409, 'EVENT_PLAN_APPROVAL_FAILED')
      const accepted = artifacts.list(EVENT_PLAN_ACCEPTED_ARTIFACT).find(artifact =>
        !existingIds.has(artifact.id) && artifact.metadata?.acceptedDraftArtifactId === review.artifactId)
      if (!accepted) throw agentError(409, 'EVENT_PLAN_APPROVAL_FAILED')
      const run = this.repositories.transaction(() => {
        this.repositories.reviews.resolve({
          sessionId: input.sessionId,
          reviewId: review.id,
          artifactId: review.artifactId,
          version: review.artifactVersion,
          fingerprint: review.fingerprint,
          status: 'approved',
          confirmationId: `review:${review.id}:${input.subject}`,
        })
        this.repositories.artifacts.replaceLedger(
          input.sessionId,
          artifacts.list(undefined, { includeSuperseded: true }),
        )
        const created = this.runner.createAfterApproval({
          sessionId: input.sessionId,
          subject: input.subject,
          acceptedArtifactId: accepted.id,
        })
        this.appendAfterCommit(input.sessionId, `approval-${review.id}`, 'review.resolved', {
          ...tuple(review), decision: 'approved',
        })
        return created
      })
      this.runner.startQueued(run.id, input.authorization)
      return { runId: run.id, status: 'queued' }
    })
  }

  async reject(input: {
    sessionId: string
    subject: string
    reviewId: string
    artifactId: string
    version: number
    fingerprint: string
    reason?: string
  }): Promise<{ reviewId: string; status: 'rejected' }> {
    return this.serialized(input.sessionId, async () => {
      this.repositories.sessions.requireOwned(input.sessionId, input.subject)
      const review = this.requireExactPending(input)
      this.repositories.transaction(() => {
        this.repositories.reviews.resolve({
          sessionId: input.sessionId,
          reviewId: review.id,
          artifactId: review.artifactId,
          version: review.artifactVersion,
          fingerprint: review.fingerprint,
          status: 'rejected',
          reason: input.reason,
        })
        this.repositories.sessions.transition(input.sessionId, ['awaiting_review'], 'completed')
        this.appendAfterCommit(input.sessionId, undefined, 'review.resolved', {
          ...tuple(review), decision: 'rejected', ...(input.reason ? { reason: input.reason } : {}),
        })
      })
      return { reviewId: review.id, status: 'rejected' }
    })
  }

  async revise(input: {
    sessionId: string
    subject: string
    baseArtifactId: string
    request: RevisionRequest
  }): Promise<{ artifact: AgentArtifactView; review: ReviewTuple }> {
    return this.serialized(input.sessionId, async () => {
      this.repositories.sessions.requireOwned(input.sessionId, input.subject)
      const row = this.repositories.artifacts.get(input.sessionId, input.baseArtifactId)
      if (!row || row.type !== EVENT_PLAN_DRAFT_ARTIFACT || row.superseded) throw agentError(404, 'EVENT_PLAN_DRAFT_NOT_FOUND')
      const pending = this.repositories.reviews.requirePendingForArtifact(input.sessionId, row.id)
      const base = eventPlanSchema.parse(row.data)
      const next = eventPlanSchema.parse({ ...base, version: base.version + 1, eventUnits: input.request.eventUnits })
      const artifacts = this.temporaryArtifacts(input.sessionId)
      const runId = `revision-${pending.id}`
      const execution = await executeToolCall({
        tool: requireTool(createEventPlanTools(), 'propose_event_plan'),
        call: { id: `revise-${base.planId}-${next.version}`, name: 'propose_event_plan', input: next },
        context: this.context(input.sessionId, artifacts),
        runId,
        turn: 0,
        guard: { check: async () => ({ decision: 'allow' }) },
      })
      if (execution.outcome !== 'completed') throw agentError(409, 'EVENT_PLAN_REVISION_FAILED')
      const revised = artifacts.list(EVENT_PLAN_DRAFT_ARTIFACT).find(artifact =>
        artifact.logicalKey === `event-plan:${base.planId}` && artifact.version === next.version)
      if (!revised) throw agentError(409, 'EVENT_PLAN_REVISION_FAILED')
      const review = this.repositories.transaction(() => {
        this.repositories.reviews.supersedeExact({
          sessionId: input.sessionId,
          reviewId: pending.id,
          artifactId: pending.artifactId,
          version: pending.artifactVersion,
          fingerprint: pending.fingerprint,
        })
        this.repositories.artifacts.replaceLedger(
          input.sessionId,
          artifacts.list(undefined, { includeSuperseded: true }),
        )
        const created = this.repositories.reviews.createPending({
          sessionId: input.sessionId,
          artifactId: revised.id,
          artifactVersion: next.version,
          fingerprint: String(revised.metadata?.fingerprint),
        })
        this.repositories.sessions.transition(input.sessionId, ['awaiting_review'], 'awaiting_review')
        this.appendAfterCommit(input.sessionId, runId, 'review.requested', tuple(created))
        return created
      })
      return { artifact: toArtifactView(revised), review: tuple(review) }
    })
  }

  private requireExactPending(input: {
    sessionId: string; reviewId: string; artifactId: string; version: number; fingerprint: string
  }): ReviewRecord {
    const review = this.repositories.reviews.get(input.sessionId, input.reviewId)
    if (!review) throw agentError(404, 'REVIEW_NOT_FOUND')
    if (
      review.status !== 'pending'
      || review.artifactId !== input.artifactId
      || review.artifactVersion !== input.version
      || review.fingerprint !== input.fingerprint
    ) throw agentError(409, 'STALE_REVIEW_TUPLE')
    return review
  }

  private context(sessionId: string, artifacts: ArtifactRepository): AgentContext {
    return {
      workspace: this.workspace,
      goal: {
        objective: 'Apply an exact reviewed EventPlan decision',
        status: 'active',
        turnCount: 0,
        maxTurns: 1,
        evidence: [],
        remainingIssues: [],
        startedAt: new Date().toISOString(),
      },
      artifacts,
      domainState: new DomainStateStore(this.repositories.sessions.readDomainState(sessionId)),
    }
  }

  private temporaryArtifacts(sessionId: string): ArtifactStore {
    const artifacts = new ArtifactStore()
    artifacts.createMany(this.repositories.artifacts.listLedger(sessionId).map(artifactInput))
    return artifacts
  }

  private appendAfterCommit(
    sessionId: string,
    runId: string | undefined,
    type: 'review.requested' | 'review.resolved',
    data: Record<string, unknown>,
  ): void {
    const event = this.events.record(sessionId, runId, type, data)
    this.repositories.afterCommit(() => this.events.publish(sessionId, event))
  }

  private async serialized<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#sessionTails.get(sessionId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => gate)
    this.#sessionTails.set(sessionId, tail)
    await previous
    try {
      return await work()
    } finally {
      release()
      if (this.#sessionTails.get(sessionId) === tail) this.#sessionTails.delete(sessionId)
    }
  }
}
