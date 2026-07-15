import type { AgentRunResult, Artifact, ModelAdapter } from '@ise/agent-core'
import type { SkillRegistry } from '@ise/skills-core'
import type { NestGateway } from '../adapters/nestGateway.ts'
import type { QueuedRunResponse } from '../api/contracts.ts'
import { agentError } from '../api/errors.ts'
import { EVENT_PLAN_DRAFT_ARTIFACT } from '../contracts/artifactTypes.ts'
import type { AgentRepositories, RunRecord } from '../persistence/repositories.ts'
import { PersistentArtifactStore } from '../persistence/persistentArtifactStore.ts'
import { PersistentDomainStateStore } from '../persistence/persistentDomainStateStore.ts'
import { IseAgentHost } from '../runtime/IseAgentHost.ts'
import { createSessionToolRegistry } from '../runtime/toolAssembly.ts'
import { createAssetRegistrySnapshot } from '../services/assetRegistry.ts'
import { EventBroker } from './eventBroker.ts'
import { PublicEventSink } from './publicEventSink.ts'
import { SessionAttachmentReader } from './sessionAttachmentReader.ts'

export interface SessionAgentRunnerOptions {
  repositories: AgentRepositories
  nest: NestGateway
  modelFactory: (sessionId: string) => ModelAdapter
  skills: SkillRegistry
  workspace: string
  events?: EventBroker
}

export class SessionAgentRunner {
  readonly events: EventBroker
  readonly #controllers = new Map<string, AbortController>()
  #draftObserver?: (input: { sessionId: string; runId: string; draft: Artifact }) => void

  constructor(readonly options: SessionAgentRunnerOptions) {
    this.events = options.events ?? new EventBroker(options.repositories.events)
  }

  setDraftObserver(observer: (input: { sessionId: string; runId: string; draft: Artifact }) => void): void {
    this.#draftObserver = observer
  }

  enqueue(input: {
    sessionId: string
    subject: string
    authorization: string
    content: string
  }): QueuedRunResponse {
    const run = this.options.repositories.transaction(() => {
      this.options.repositories.sessions.requireOwned(input.sessionId, input.subject)
      this.options.repositories.messages.append(input.sessionId, 'user', input.content)
      const created = this.options.repositories.runs.createQueued(
        input.sessionId,
        this.buildBoundedObjective(input.sessionId, input.content),
      )
      this.options.repositories.sessions.transition(
        input.sessionId,
        ['idle', 'awaiting_review', 'completed', 'failed', 'cancelled'],
        'queued',
        created.id,
      )
      return created
    })
    queueMicrotask(() => void this.execute(run.id, input.authorization))
    return { runId: run.id, status: 'queued' }
  }

  enqueueAfterApproval(input: {
    sessionId: string
    subject: string
    authorization: string
    acceptedArtifactId: string
  }): QueuedRunResponse {
    const run = this.options.repositories.transaction(() => {
      this.options.repositories.sessions.requireOwned(input.sessionId, input.subject)
      const created = this.options.repositories.runs.createQueued(
        input.sessionId,
        `Create exactly one grounded NarrativePlan for accepted EventPlan artifact ${input.acceptedArtifactId} through propose_scene_plan, then stop.`,
      )
      this.options.repositories.sessions.transition(input.sessionId, ['awaiting_review'], 'queued', created.id)
      return created
    })
    queueMicrotask(() => void this.execute(run.id, input.authorization))
    return { runId: run.id, status: 'queued' }
  }

  interrupt(sessionId: string, subject: string): { runId: string; status: 'cancelled' } {
    const session = this.options.repositories.sessions.requireOwned(sessionId, subject)
    if (!session.activeRunId) throw agentError(409, 'NO_ACTIVE_RUN')
    const run = this.options.repositories.runs.get(session.activeRunId)
    if (!run || !['queued', 'running'].includes(run.status)) throw agentError(409, 'NO_ACTIVE_RUN')
    this.#controllers.get(run.id)?.abort(new DOMException('Run cancelled', 'AbortError'))
    this.options.repositories.transaction(() => {
      this.options.repositories.runs.finish(run.id, 'cancelled', {
        code: 'RUN_CANCELLED', message: 'Run cancelled by the session owner',
      })
      this.options.repositories.sessions.transition(sessionId, ['queued', 'running'], 'cancelled')
      this.events.append(sessionId, run.id, 'run.failed', {
        runId: run.id,
        status: 'cancelled',
        diagnostics: [{ code: 'RUN_CANCELLED', message: 'Run cancelled by the session owner', severity: 'error' }],
      })
    })
    return { runId: run.id, status: 'cancelled' }
  }

  private async execute(runId: string, authorization: string): Promise<void> {
    const controller = new AbortController()
    this.#controllers.set(runId, controller)
    try {
      const current = this.options.repositories.runs.get(runId)
      if (!current || !['queued', 'running'].includes(current.status)) return
      const run = current.status === 'queued' ? this.options.repositories.runs.markRunning(runId) : current
      if (current.status === 'queued') {
        this.options.repositories.sessions.transition(run.sessionId, ['queued'], 'running', run.id)
      }
      const artifacts = new PersistentArtifactStore(run.sessionId, this.options.repositories.artifacts)
      const result = await new IseAgentHost({
        model: this.options.modelFactory(run.sessionId),
        tools: createSessionToolRegistry({
          attachmentReader: new SessionAttachmentReader(
            run.sessionId,
            authorization,
            this.options.repositories.attachments,
            this.options.nest,
          ),
          loadAssetSnapshot: async () => createAssetRegistrySnapshot(
            await this.options.nest.listAssetMetadata(authorization),
          ),
          onCompileProgress: payload => this.events.append(run.sessionId, run.id, 'compile.progress', {
            runId: run.id,
            stage: payload.stage,
            percentage: payload.percentage,
          }),
        }),
        skills: this.options.skills,
        workspace: this.options.workspace,
        artifacts,
        domainState: new PersistentDomainStateStore(run.sessionId, this.options.repositories.sessions),
        eventSink: new PublicEventSink(run.sessionId, this.events, run.id),
        signal: controller.signal,
      }).run(run.objective)
      await this.finishFromResult(run, result)
    } catch (error) {
      await this.finishFromThrownError(runId, error, controller.signal.aborted)
    } finally {
      this.#controllers.delete(runId)
    }
  }

  private async finishFromResult(run: RunRecord, result: AgentRunResult): Promise<void> {
    if (result.goal.status !== 'completed') {
      await this.finishFromThrownError(run.id, new Error(result.goal.remainingIssues.join('; ') || 'Agent run failed'), false)
      return
    }
    const summary = result.turnOutcome?.finalAnswer ?? result.goal.finalSummary
    const draft = result.artifacts.find(artifact => artifact.type === EVENT_PLAN_DRAFT_ARTIFACT)
    this.options.repositories.transaction(() => {
      if (summary?.trim()) this.options.repositories.messages.append(run.sessionId, 'assistant', summary.trim())
      this.options.repositories.runs.finish(run.id, 'completed')
      if (!draft) this.options.repositories.sessions.transition(run.sessionId, ['running'], 'completed')
    })
    if (draft) {
      if (this.#draftObserver) this.#draftObserver({ sessionId: run.sessionId, runId: run.id, draft })
      else this.options.repositories.sessions.transition(run.sessionId, ['running'], 'awaiting_review')
    }
  }

  private async finishFromThrownError(runId: string, error: unknown, aborted: boolean): Promise<void> {
    const run = this.options.repositories.runs.get(runId)
    if (!run || ['completed', 'failed', 'cancelled'].includes(run.status)) return
    const code = aborted ? 'RUN_CANCELLED' : 'AGENT_RUN_FAILED'
    const message = error instanceof Error ? error.message : String(error)
    this.options.repositories.transaction(() => {
      this.options.repositories.runs.finish(run.id, aborted ? 'cancelled' : 'failed', { code, message })
      this.options.repositories.sessions.transition(
        run.sessionId,
        ['queued', 'running'],
        aborted ? 'cancelled' : 'failed',
      )
      this.events.append(run.sessionId, run.id, 'run.failed', {
        runId: run.id,
        status: aborted ? 'cancelled' : 'failed',
        diagnostics: [{ code, message, severity: 'error' }],
      })
    })
  }

  private buildBoundedObjective(sessionId: string, content: string): string {
    const messages = this.options.repositories.messages.listRecent(sessionId, 12)
      .map(message => ({ role: message.role, content: message.content }))
    const artifactIds = this.options.repositories.artifacts.listLedger(sessionId)
      .filter(artifact => !artifact.superseded).map(artifact => artifact.id).sort()
    const attachmentIds = this.options.repositories.attachments.list(sessionId).map(item => item.fileId).sort()
    return [
      'Handle the current ISE session objective using only registered tools and active artifacts.',
      `Current message: ${content}`,
      `Visible messages: ${JSON.stringify(messages)}`,
      `Active artifact IDs: ${JSON.stringify(artifactIds)}`,
      `Attachment file IDs: ${JSON.stringify(attachmentIds)}`,
    ].join('\n')
  }
}
