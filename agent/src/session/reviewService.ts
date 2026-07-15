import {
  executeToolCall,
  type AgentContext,
  type AgentTool,
  type Artifact,
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
import { PersistentArtifactStore } from '../persistence/persistentArtifactStore.ts'
import { PersistentDomainStateStore } from '../persistence/persistentDomainStateStore.ts'
import { createEventPlanTools } from '../tools/eventPlanTools.ts'
import type { EventBroker } from './eventBroker.ts'
import { PublicEventSink } from './publicEventSink.ts'
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

export class ReviewService {
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
      this.events.append(sessionId, runId, 'review.requested', tuple(created))
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
    this.repositories.sessions.requireOwned(input.sessionId, input.subject)
    const review = this.requireExactPending(input)
    const artifacts = new PersistentArtifactStore(input.sessionId, this.repositories.artifacts)
    const execution = await executeToolCall({
      tool: requireTool(createEventPlanTools(), 'accept_event_plan'),
      call: {
        id: `approve-${review.id}`,
        name: 'accept_event_plan',
        input: { draftArtifactId: review.artifactId, version: review.artifactVersion, fingerprint: review.fingerprint },
      },
      context: this.context(input.sessionId, artifacts),
      eventSink: new PublicEventSink(input.sessionId, this.events, `approval-${review.id}`),
      runId: `approval-${review.id}`,
      turn: 0,
      guard: { check: async () => ({ decision: 'allow', confirmationId: `review:${review.id}:${input.subject}` }) },
    })
    if (execution.outcome !== 'completed') throw agentError(409, 'EVENT_PLAN_APPROVAL_FAILED')
    const accepted = artifacts.list(EVENT_PLAN_ACCEPTED_ARTIFACT).find(artifact =>
      artifact.metadata?.acceptedDraftArtifactId === review.artifactId)
    if (!accepted) throw agentError(409, 'EVENT_PLAN_APPROVAL_FAILED')
    this.repositories.transaction(() => {
      this.repositories.reviews.resolve({
        sessionId: input.sessionId,
        reviewId: review.id,
        artifactId: review.artifactId,
        version: review.artifactVersion,
        fingerprint: review.fingerprint,
        status: 'approved',
        confirmationId: `review:${review.id}:${input.subject}`,
      })
      this.events.append(input.sessionId, `approval-${review.id}`, 'review.resolved', {
        ...tuple(review), decision: 'approved',
      })
    })
    return this.runner.enqueueAfterApproval({
      sessionId: input.sessionId,
      subject: input.subject,
      authorization: input.authorization,
      acceptedArtifactId: accepted.id,
    })
  }

  reject(input: {
    sessionId: string
    subject: string
    reviewId: string
    artifactId: string
    version: number
    fingerprint: string
    reason?: string
  }): { reviewId: string; status: 'rejected' } {
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
      this.events.append(input.sessionId, undefined, 'review.resolved', {
        ...tuple(review), decision: 'rejected', ...(input.reason ? { reason: input.reason } : {}),
      })
    })
    return { reviewId: review.id, status: 'rejected' }
  }

  async revise(input: {
    sessionId: string
    subject: string
    baseArtifactId: string
    request: RevisionRequest
  }): Promise<{ artifact: AgentArtifactView; review: ReviewTuple }> {
    this.repositories.sessions.requireOwned(input.sessionId, input.subject)
    const row = this.repositories.artifacts.get(input.sessionId, input.baseArtifactId)
    if (!row || row.type !== EVENT_PLAN_DRAFT_ARTIFACT || row.superseded) throw agentError(404, 'EVENT_PLAN_DRAFT_NOT_FOUND')
    const pending = this.repositories.reviews.requirePendingForArtifact(input.sessionId, row.id)
    const base = eventPlanSchema.parse(row.data)
    const next = eventPlanSchema.parse({ ...base, version: base.version + 1, eventUnits: input.request.eventUnits })
    const artifacts = new PersistentArtifactStore(input.sessionId, this.repositories.artifacts)
    const runId = `revision-${pending.id}`
    const execution = await executeToolCall({
      tool: requireTool(createEventPlanTools(), 'propose_event_plan'),
      call: { id: `revise-${base.planId}-${next.version}`, name: 'propose_event_plan', input: next },
      context: this.context(input.sessionId, artifacts),
      eventSink: new PublicEventSink(input.sessionId, this.events, runId),
      runId,
      turn: 0,
      guard: { check: async () => ({ decision: 'allow' }) },
    })
    if (execution.outcome !== 'completed') throw agentError(409, 'EVENT_PLAN_REVISION_FAILED')
    const revised = artifacts.list(EVENT_PLAN_DRAFT_ARTIFACT).find(artifact =>
      artifact.logicalKey === `event-plan:${base.planId}` && artifact.version === next.version)
    if (!revised) throw agentError(409, 'EVENT_PLAN_REVISION_FAILED')
    const review = this.createForDraft(input.sessionId, runId, revised)
    return { artifact: toArtifactView(revised), review }
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

  private context(sessionId: string, artifacts: PersistentArtifactStore): AgentContext {
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
      domainState: new PersistentDomainStateStore(sessionId, this.repositories.sessions),
    }
  }
}
