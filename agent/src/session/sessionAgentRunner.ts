import type { AgentContext, AgentRunResult, Artifact, ModelAdapter } from '@ise/agent-core'
import type { SkillRegistry } from '@ise/skills-core'
import type { NestGateway } from '../adapters/nestGateway.ts'
import type { QueuedRunResponse } from '../api/contracts.ts'
import { agentError } from '../api/errors.ts'
import {
  DOCUMENT_IR_ARTIFACT,
  EVIDENCE_IR_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  EVENT_PLAN_DRAFT_ARTIFACT,
} from '../contracts/artifactTypes.ts'
import {
  ASSET_REGISTRY_ARTIFACT,
  CHOREOGRAPHY_PLAN_ARTIFACT,
  COMPILED_RUNTIME_ARTIFACT,
  NARRATION_PLAN_ARTIFACT,
  NARRATIVE_PLAN_ARTIFACT,
  RESOLVED_SCENE_PLAN_ARTIFACT,
  SCENE_BLUEPRINT_ARTIFACT,
} from '../contracts/artifactTypes.ts'
import type { AgentRepositories, RunRecord } from '../persistence/repositories.ts'
import { SqlJsPersistenceError } from '../persistence/sqlJsDatabase.ts'
import { PersistentArtifactStore } from '../persistence/persistentArtifactStore.ts'
import { PersistentDomainStateStore } from '../persistence/persistentDomainStateStore.ts'
import { IseAgentHost } from '../runtime/IseAgentHost.ts'
import { createSessionToolRegistry } from '../runtime/toolAssembly.ts'
import { createAssetRegistrySnapshot } from '../services/assetRegistry.ts'
import {
  CompiledArtifactInvalidError,
  type CompiledRuntimeArtifactCandidate,
  validateCompiledRuntimeArtifact,
} from '../services/compiledRuntimeArtifact.ts'
import { CompilationError, diagnostic } from '../services/runtimeDiagnostics.ts'
import { publicFailureCode, publicFailureDiagnostics, publicFailureMessage } from '../services/publicFailures.ts'
import { createCompilerTools } from '../tools/compilerTools.ts'
import { capabilityManifest } from '../compiler/capabilityManifest.ts'
import { assetRegistrySnapshotSchema } from '../contracts/assetRegistry.ts'
import { narrativePlanSchema } from '../contracts/narrativePlan.ts'
import { evidenceIrSchema } from '../contracts/evidence.ts'
import { eventPlanSchema } from '../contracts/eventPlan.ts'
import type { DocumentIR } from '../contracts/document.ts'
import type { EvidenceIR } from '../contracts/evidence.ts'
import { sha256 } from '../services/fingerprint.ts'
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
  compilerToolsFactory?: typeof createCompilerTools
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
      const message = this.options.repositories.messages.append(input.sessionId, 'user', input.content)
      this.seedTextBriefIfNeeded(input.sessionId, message.id, input.content)
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
    const run = this.options.repositories.transaction(() => this.createAfterApproval(input))
    this.startQueued(run.id, input.authorization)
    return { runId: run.id, status: 'queued' }
  }

  createAfterApproval(input: {
    sessionId: string
    subject: string
    acceptedArtifactId: string
  }): RunRecord {
    this.options.repositories.sessions.requireOwned(input.sessionId, input.subject)
    const accepted = this.options.repositories.artifacts.get(input.sessionId, input.acceptedArtifactId)
    if (!accepted || accepted.type !== EVENT_PLAN_ACCEPTED_ARTIFACT || accepted.superseded) {
      throw agentError(409, 'ACCEPTED_EVENT_PLAN_NOT_FOUND')
    }
    const plan = eventPlanSchema.parse(accepted.data)
    const acceptedFingerprint = accepted.metadata?.fingerprint
    if (typeof acceptedFingerprint !== 'string') throw agentError(409, 'ACCEPTED_EVENT_PLAN_INVALID')
    const sourceEventPlan = {
      artifactId: accepted.id,
      planId: plan.planId,
      version: plan.version,
      fingerprint: acceptedFingerprint,
    }
    const created = this.options.repositories.runs.createQueued(
      input.sessionId,
      [
        'Create exactly one grounded NarrativePlan for the accepted EventPlan, then stop.',
        'Use only propose_scene_plan. Do not parse the document, propose or accept another EventPlan, or invoke compiler tools.',
        `Exact sourceEventPlan tuple: ${JSON.stringify(sourceEventPlan)}`,
        `Accepted EventPlan snapshot: ${JSON.stringify(plan)}`,
      ].join('\n'),
      { artifactId: accepted.id, version: plan.version, fingerprint: acceptedFingerprint },
    )
    this.options.repositories.sessions.transition(input.sessionId, ['awaiting_review'], 'queued', created.id)
    return created
  }

  startQueued(runId: string, authorization: string): void {
    queueMicrotask(() => void this.execute(runId, authorization))
  }

  interrupt(sessionId: string, subject: string): { runId: string; status: 'cancelled' } {
    const session = this.options.repositories.sessions.requireOwned(sessionId, subject)
    if (!session.activeRunId) throw agentError(409, 'NO_ACTIVE_RUN')
    const run = this.options.repositories.runs.get(session.activeRunId)
    if (!run || !['queued', 'running'].includes(run.status)) throw agentError(409, 'NO_ACTIVE_RUN')
    this.options.repositories.transaction(() => {
      this.options.repositories.runs.finish(run.id, 'cancelled', {
        code: 'RUN_CANCELLED', message: 'Run cancelled by the session owner',
      })
      this.options.repositories.sessions.transition(sessionId, ['queued', 'running'], 'cancelled')
      this.appendTerminalAfterCommit(sessionId, run.id, 'run.failed', {
        runId: run.id,
        status: 'cancelled',
        diagnostics: [{ code: 'RUN_CANCELLED', message: 'Run cancelled by the session owner', severity: 'error' }],
      })
    })
    this.#controllers.get(run.id)?.abort(new DOMException('Run cancelled', 'AbortError'))
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
      const artifacts = new PersistentArtifactStore(run.sessionId, this.options.repositories.artifacts, run.id)
      let compiledArtifactInvalid = false
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
          compilerToolsFactory: this.options.compilerToolsFactory,
          onCompiledArtifactInvalid: () => { compiledArtifactInvalid = true },
          skills: this.options.skills,
        }),
        skills: this.options.skills,
        workspace: this.options.workspace,
        artifacts,
        domainState: new PersistentDomainStateStore(run.sessionId, this.options.repositories.sessions),
        eventSink: new PublicEventSink(run.sessionId, this.events, run.id, false),
        signal: controller.signal,
      }).run(run.objective)
      if (compiledArtifactInvalid) throw new CompiledArtifactInvalidError()
      if (result.goal.status !== 'completed') {
        await this.finishFromThrownError(run.id, new Error(result.goal.remainingIssues.join('; ') || 'Agent run failed'), false)
        return
      }
      const runArtifacts = this.options.repositories.artifacts.listByRun(run.sessionId, run.id)
        .filter(artifact => !artifact.superseded)
      this.assertExpectedAccepted(run)
      const narrative = this.currentNarrative(run, runArtifacts)
      const compiled = narrative
        ? await this.compileNarrative(run, authorization, artifacts, narrative)
        : this.currentCompiled(run, runArtifacts)
      const drafts = runArtifacts.filter(artifact => artifact.type === EVENT_PLAN_DRAFT_ARTIFACT)
      if (drafts.length > 1) throw new CompilationError([diagnostic('RUN_OUTPUT_AMBIGUOUS', EVENT_PLAN_DRAFT_ARTIFACT)])
      const draft = drafts[0]
      await this.finishFromResult(run, result, compiled, draft)
    } catch (error) {
      if (!(error instanceof SqlJsPersistenceError)) {
        try {
          await this.finishFromThrownError(runId, error, controller.signal.aborted)
        } catch (terminalError) {
          if (!(terminalError instanceof SqlJsPersistenceError)) throw terminalError
        }
      }
    } finally {
      this.#controllers.delete(runId)
    }
  }

  private async finishFromResult(
    run: RunRecord,
    result: AgentRunResult,
    compiled?: Artifact,
    draft?: Artifact,
  ): Promise<void> {
    if (!compiled && !draft) {
      await this.finishFromThrownError(
        run.id,
        new CompilationError([diagnostic('RUN_OUTPUT_MISSING', 'Current run produced no validated output')]),
        false,
      )
      return
    }
    const summary = result.turnOutcome?.finalAnswer ?? result.goal.finalSummary
    if (compiled) {
      const { sceneProjectConfig } = this.validatedCompiledData(run, compiled)
      this.options.repositories.transaction(() => {
        if (summary?.trim()) this.options.repositories.messages.append(run.sessionId, 'assistant', summary.trim())
        this.options.repositories.runs.finish(run.id, 'completed')
        this.options.repositories.sessions.transition(run.sessionId, ['running'], 'completed')
        this.appendTerminalAfterCommit(run.sessionId, run.id, 'run.completed', {
          runId: run.id,
          status: 'completed',
          runtimeArtifactId: compiled.id,
          sceneProjectConfig,
        })
      })
      return
    }
    this.options.repositories.transaction(() => {
      if (summary?.trim()) this.options.repositories.messages.append(run.sessionId, 'assistant', summary.trim())
      this.options.repositories.runs.finish(run.id, 'completed')
      if (draft && this.#draftObserver) this.#draftObserver({ sessionId: run.sessionId, runId: run.id, draft })
      else this.options.repositories.sessions.transition(run.sessionId, ['running'], draft ? 'awaiting_review' : 'completed')
    })
  }

  private async finishFromThrownError(runId: string, error: unknown, aborted: boolean): Promise<void> {
    const run = this.options.repositories.runs.get(runId)
    if (!run || ['completed', 'failed', 'cancelled'].includes(run.status)) return
    const compilationDiagnostics = error instanceof CompilationError
      ? error.diagnostics
      : error instanceof CompiledArtifactInvalidError
        ? [diagnostic(error.code, 'Compiled runtime artifact failed validation')]
        : undefined
    const code = publicFailureCode(aborted ? 'RUN_CANCELLED' : compilationDiagnostics?.[0]?.code ?? 'AGENT_RUN_FAILED')
    const message = publicFailureMessage(code)
    const diagnostics = publicFailureDiagnostics(compilationDiagnostics ?? [{ code, severity: 'error' }])
    this.options.repositories.transaction(() => {
      if (code === 'COMPILED_ARTIFACT_INVALID') this.quarantineCurrentCompiled(run)
      this.options.repositories.runs.finish(run.id, aborted ? 'cancelled' : 'failed', { code, message, diagnostics })
      this.options.repositories.sessions.transition(
        run.sessionId,
        ['queued', 'running'],
        aborted ? 'cancelled' : 'failed',
      )
      this.appendTerminalAfterCommit(run.sessionId, run.id, 'run.failed', {
        runId: run.id,
        status: aborted ? 'cancelled' : 'failed',
        diagnostics,
      })
    })
  }

  private async compileNarrative(
    run: RunRecord,
    authorization: string,
    artifacts: PersistentArtifactStore,
    narrativeArtifact: Artifact,
  ): Promise<Artifact> {
    if (!run.expectedAccepted) throw new CompilationError([diagnostic('RUN_PROVENANCE_MISSING', run.id)])
    const acceptedArtifact = artifacts.get(run.expectedAccepted.artifactId)
    if (!acceptedArtifact || acceptedArtifact.type !== EVENT_PLAN_ACCEPTED_ARTIFACT || acceptedArtifact.superseded) {
      throw new CompilationError([diagnostic('RUN_PROVENANCE_MISSING', run.id)])
    }
    const acceptedPlan = eventPlanSchema.parse(acceptedArtifact.data)
    const evidenceCandidates = artifacts.list(EVIDENCE_IR_ARTIFACT)
      .map(artifact => ({ artifact, evidence: evidenceIrSchema.parse(artifact.data) }))
      .filter(candidate => candidate.evidence.documentId === acceptedPlan.documentId)
    if (evidenceCandidates.length === 0) {
      throw new CompilationError([diagnostic('EVIDENCE_IR_MISSING', acceptedPlan.documentId)])
    }
    if (evidenceCandidates.length > 1) {
      throw new CompilationError([diagnostic('EVIDENCE_IR_AMBIGUOUS', acceptedPlan.documentId)])
    }
    const evidenceArtifact = evidenceCandidates[0]!.artifact
    const narrativePlan = narrativePlanSchema.parse(narrativeArtifact.data)
    if (
      narrativePlan.sourceEventPlan.artifactId !== run.expectedAccepted.artifactId
      || narrativePlan.sourceEventPlan.version !== run.expectedAccepted.version
      || narrativePlan.sourceEventPlan.fingerprint !== run.expectedAccepted.fingerprint
    ) throw new CompilationError([diagnostic('NARRATIVE_PROVENANCE_MISMATCH', narrativeArtifact.id)])
    const snapshot = createAssetRegistrySnapshot(await this.options.nest.listAssetMetadata(authorization))
    const logicalKey = `asset-registry:${snapshot.registryVersion}`
    let registryArtifact = artifacts.list(ASSET_REGISTRY_ARTIFACT).find(item => item.logicalKey === logicalKey)
    if (!registryArtifact) {
      registryArtifact = artifacts.create({
        type: ASSET_REGISTRY_ARTIFACT,
        createdBy: 'tool',
        logicalKey,
        data: assetRegistrySnapshotSchema.parse(snapshot),
      })
      this.events.append(run.sessionId, run.id, 'artifact.created', {
        runId: run.id,
        artifactId: registryArtifact.id,
        artifactType: registryArtifact.type,
        logicalKey: registryArtifact.logicalKey,
      })
    }
    const compileTool = (this.options.compilerToolsFactory ?? createCompilerTools)({
      onCompileProgress: payload => this.events.append(run.sessionId, run.id, 'compile.progress', {
        runId: run.id,
        stage: payload.stage,
        percentage: payload.percentage,
      }),
    })[0]!
    const context = this.toolContext(run, artifacts)
    this.events.append(run.sessionId, run.id, 'tool.started', {
      runId: run.id,
      toolCallId: `compile-${run.id}`,
      toolName: compileTool.name,
      summary: 'Compile validated replay runtime',
    })
    const result = await compileTool.execute({
      eventPlanArtifactId: narrativePlan.sourceEventPlan.artifactId,
      evidenceArtifactId: evidenceArtifact.id,
      narrativePlanArtifactId: narrativeArtifact.id,
      assetRegistryArtifactId: registryArtifact.id,
      capabilityManifestVersion: capabilityManifest.version,
      assetRegistryVersion: snapshot.registryVersion,
    }, context)
    const returned = result.artifacts ?? []
    const expectedTypes = [
      NARRATION_PLAN_ARTIFACT,
      SCENE_BLUEPRINT_ARTIFACT,
      RESOLVED_SCENE_PLAN_ARTIFACT,
      CHOREOGRAPHY_PLAN_ARTIFACT,
      COMPILED_RUNTIME_ARTIFACT,
    ]
    const expectedTypeSet = new Set<string>(expectedTypes)
    const validSet = returned.length === expectedTypes.length
      && expectedTypes.every(type => returned.filter(artifact => artifact.type === type).length === 1)
      && returned.every(artifact => expectedTypeSet.has(artifact.type))
    if (!validSet) {
      throw new CompilationError([diagnostic('COMPILER_ARTIFACT_SET_INVALID', 'Compiler returned an invalid artifact set')])
    }
    const compiledInput = returned.find(artifact => artifact.type === COMPILED_RUNTIME_ARTIFACT)!
    this.validatedCompiledData(run, compiledInput as CompiledRuntimeArtifactCandidate)
    const persisted = artifacts.createMany(returned)
    for (const artifact of persisted) {
      this.events.append(run.sessionId, run.id, 'artifact.created', {
        runId: run.id,
        artifactId: artifact.id,
        artifactType: artifact.type,
        logicalKey: artifact.logicalKey,
      })
    }
    return persisted.find(artifact => artifact.type === COMPILED_RUNTIME_ARTIFACT)!
  }

  private toolContext(run: RunRecord, artifacts: PersistentArtifactStore): AgentContext {
    return {
      workspace: this.options.workspace,
      goal: {
        objective: run.objective,
        status: 'active',
        turnCount: 0,
        maxTurns: 1,
        evidence: [],
        remainingIssues: [],
        startedAt: run.createdAt,
      },
      artifacts,
      domainState: new PersistentDomainStateStore(run.sessionId, this.options.repositories.sessions),
    }
  }

  private appendTerminalAfterCommit(
    sessionId: string,
    runId: string,
    type: 'run.completed' | 'run.failed',
    data: Record<string, unknown>,
  ): void {
    const event = this.events.record(sessionId, runId, type, data)
    this.options.repositories.afterCommit(() => this.events.publish(sessionId, event))
  }

  private currentNarrative(run: RunRecord, artifacts: readonly Artifact[]): Artifact | undefined {
    if (!run.expectedAccepted) return undefined
    const candidates = artifacts.filter(artifact => artifact.type === NARRATIVE_PLAN_ARTIFACT)
    if (candidates.length > 1) throw new CompilationError([diagnostic('RUN_OUTPUT_AMBIGUOUS', NARRATIVE_PLAN_ARTIFACT)])
    const candidate = candidates[0]
    if (!candidate) return undefined
    const plan = narrativePlanSchema.parse(candidate.data)
    if (
      plan.sourceEventPlan.artifactId !== run.expectedAccepted.artifactId
      || plan.sourceEventPlan.version !== run.expectedAccepted.version
      || plan.sourceEventPlan.fingerprint !== run.expectedAccepted.fingerprint
    ) throw new CompilationError([diagnostic('NARRATIVE_PROVENANCE_MISMATCH', candidate.id)])
    return candidate
  }

  private assertExpectedAccepted(run: RunRecord): void {
    if (!run.expectedAccepted) return
    const accepted = this.options.repositories.artifacts.get(run.sessionId, run.expectedAccepted.artifactId)
    if (!accepted || accepted.type !== EVENT_PLAN_ACCEPTED_ARTIFACT) {
      throw new CompilationError([diagnostic('RUN_PROVENANCE_MISSING', run.id)])
    }
    const plan = eventPlanSchema.parse(accepted.data)
    if (
      plan.version !== run.expectedAccepted.version
      || accepted.version !== run.expectedAccepted.version
      || accepted.metadata?.fingerprint !== run.expectedAccepted.fingerprint
    ) throw new CompilationError([diagnostic('RUN_PROVENANCE_MISMATCH', run.id)])
  }

  private currentCompiled(run: RunRecord, artifacts: readonly Artifact[]): Artifact | undefined {
    if (!run.expectedAccepted) return undefined
    const candidates = artifacts.filter(artifact => artifact.type === COMPILED_RUNTIME_ARTIFACT)
    if (candidates.length > 1) throw new CompilationError([diagnostic('RUN_OUTPUT_AMBIGUOUS', COMPILED_RUNTIME_ARTIFACT)])
    const candidate = candidates[0]
    if (candidate) this.validatedCompiledData(run, candidate)
    return candidate
  }

  private validatedCompiledData(run: RunRecord, artifact: CompiledRuntimeArtifactCandidate) {
    try {
      return validateCompiledRuntimeArtifact(artifact, run.expectedAccepted?.artifactId)
    } catch (error) {
      if (error instanceof CompiledArtifactInvalidError) {
        throw new CompilationError([diagnostic(error.code, artifact.id)])
      }
      throw error
    }
  }

  private quarantineCurrentCompiled(run: RunRecord): void {
    const current = this.options.repositories.artifacts.listByRun(run.sessionId, run.id)
      .filter(artifact => artifact.type === COMPILED_RUNTIME_ARTIFACT)
    if (current.length === 0) return
    const currentIds = new Set(current.map(artifact => artifact.id))
    const ledger = this.options.repositories.artifacts.listLedger(run.sessionId)
    const byId = new Map(ledger.map(artifact => [artifact.id, artifact]))
    for (const artifact of current) {
      byId.get(artifact.id)!.superseded = true
      let predecessorId = artifact.supersedes
      while (predecessorId && currentIds.has(predecessorId)) predecessorId = byId.get(predecessorId)?.supersedes
      const predecessor = predecessorId ? byId.get(predecessorId) : undefined
      if (predecessor?.type !== COMPILED_RUNTIME_ARTIFACT || predecessor.logicalKey !== artifact.logicalKey) continue
      try {
        validateCompiledRuntimeArtifact(predecessor)
        predecessor.superseded = false
      } catch (error) {
        if (!(error instanceof CompiledArtifactInvalidError)) throw error
      }
    }
    this.options.repositories.artifacts.replaceLedger(run.sessionId, ledger)
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

  private seedTextBriefIfNeeded(sessionId: string, messageId: string, content: string): void {
    if (this.options.repositories.attachments.list(sessionId).length > 0) return
    if (
      this.options.repositories.artifacts
        .listLedger(sessionId)
        .some(artifact => artifact.type === EVIDENCE_IR_ARTIFACT && !artifact.superseded)
    ) return

    const documentId = `text-brief-${messageId}`
    const sourceRef = `user-message:${messageId}`
    const evidenceId = `evidence-${messageId}`
    const title = content.split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || 'User scene brief'
    const document: DocumentIR = {
      schemaVersion: 'document-ir/v1',
      documentId,
      title,
      sourceHash: sha256(content),
      sections: [],
      paragraphs: [{
        paragraphId: `paragraph-${messageId}`,
        sourceRef,
        sectionPath: [],
        text: content,
      }],
      tables: [],
      warnings: ['User-provided text brief; facts have not been independently verified.'],
    }
    const evidence: EvidenceIR = {
      schemaVersion: 'evidence-ir/v1',
      documentId,
      records: [{
        evidenceId,
        sourceRef,
        claim: content,
        kind: 'explicit_fact',
        entities: [],
        confidence: 1,
        ambiguities: ['User-provided scenario intent, not an independently verified report.'],
      }],
    }

    new PersistentArtifactStore(sessionId, this.options.repositories.artifacts).createMany([
      {
        type: DOCUMENT_IR_ARTIFACT,
        createdBy: 'user',
        logicalKey: `document:${documentId}`,
        data: document,
        metadata: { documentId, sourceHash: document.sourceHash, sourceKind: 'text-brief' },
      },
      {
        type: EVIDENCE_IR_ARTIFACT,
        createdBy: 'user',
        logicalKey: `evidence:${documentId}`,
        data: evidence,
        metadata: { documentId, sourceKind: 'text-brief' },
      },
    ])
  }
}
