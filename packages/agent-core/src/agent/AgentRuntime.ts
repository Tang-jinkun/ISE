import type { ResolvedSkillActivation, SkillRegistry } from '@ise/skills-core'
import type { TurnOutcome, TurnOutcomeStatus } from '../turnOutcome.ts'
import { ArtifactStore } from '../artifacts/ArtifactStore.ts'
import { PermissionManager } from '../permissions/PermissionManager.ts'
import { buildSystemPrompt } from '../prompts/buildSystemPrompt.ts'
import {
  renderEmptyToolInputSteeringPrompt,
  renderFinalAnswerGuardSteeringPrompt,
  renderNoToolCallSteeringPrompt,
} from '../prompts/runtimeSteeringPrompts.ts'
import { DomainStateStore } from '../state/DomainStateStore.ts'
import { ToolRegistry } from '../tools/ToolRegistry.ts'
import { Transcript } from '../transcript/Transcript.ts'
import type {
  AgentContext,
  AgentActionEvent,
  AgentMessage,
  AgentRunResult,
  AgentTool,
  ArtifactRepository,
  Diagnostic,
  DomainState,
  DomainStateRepository,
  GoalState,
  AgentEventSink,
  ModelAdapter,
  ModelResponse,
  ToolCall,
  AgentProfile,
  ModelToolDefinition,
  ToolGuardDecision,
  ToolCallResolution,
  ToolVisibilityDecision,
  FinalAnswerGuardResult,
} from '../types.ts'
import { StreamingToolExecutor } from './StreamingToolExecutor.ts'

export interface ToolSurfaceProvider {
  visibleTools(context: AgentContext, tools: readonly AgentTool[]): readonly ModelToolDefinition[]
  visibility?(tool: AgentTool, context: AgentContext): ToolVisibilityDecision
  guard?(tool: AgentTool, input: unknown, context: AgentContext): ToolGuardDecision | undefined | Promise<ToolGuardDecision | undefined>
  resolveToolCall?(call: ToolCall, context: AgentContext, tools: ToolRegistry): ToolCallResolution | undefined
}

export interface AgentRuntimeOptions {
  model: ModelAdapter
  tools: ToolRegistry
  skills: SkillRegistry
  workspace: string
  permissions?: PermissionManager
  artifacts?: ArtifactRepository
  domainState?: DomainStateRepository
  initialDomainState?: DomainState
  maxTurns?: number
  maxRepeatedToolCalls?: number
  eventSink?: AgentEventSink
  profile?: AgentProfile
  toolFilter?: (tool: ReturnType<ToolRegistry['list']>[number], context: AgentContext) => boolean
  toolSurfaceProvider?: ToolSurfaceProvider
  prepareToolInput?: (tool: AgentTool, input: unknown, context: AgentContext) => unknown
  signal?: AbortSignal
  initialSkill?: ResolvedSkillActivation
  finalAnswerGuard?: (answer: string, context: AgentContext) => FinalAnswerGuardResult
}

export class AgentRuntime {
  readonly #permissions: PermissionManager

  constructor(readonly options: AgentRuntimeOptions) {
    this.#permissions = options.permissions ?? new PermissionManager()
  }

  async run(objective: string): Promise<AgentRunResult> {
    const runId = createRunId()
    const goal: GoalState = {
      objective,
      status: 'active',
      turnCount: 0,
      maxTurns: this.options.maxTurns ?? 20,
      evidence: [],
      remainingIssues: [],
      startedAt: new Date().toISOString(),
    }
    const messages: AgentMessage[] = [
      { role: 'system', content: buildSystemPrompt(goal, this.options.skills, this.options.profile) },
      { role: 'user', content: objective },
      ...(this.options.initialSkill
        ? [{
            role: 'user' as const,
            hidden: true,
            content:
              `[Active user-selected skill: ${this.options.initialSkill.name}]\n\n` +
              this.options.initialSkill.instructions,
          }]
        : []),
    ]
    const transcript = new Transcript()
    const artifacts = this.options.artifacts ?? new ArtifactStore()
    const domainState =
      this.options.domainState ?? new DomainStateStore(this.options.initialDomainState)
    const diagnostics: Diagnostic[] = []
    const context: AgentContext = {
      workspace: this.options.workspace,
      goal,
      artifacts,
      domainState,
      skillScope: this.options.initialSkill
        ? {
            name: this.options.initialSkill.name,
            allowedTools: new Set(this.options.initialSkill.allowedTools),
            activatedAtTurn: 0,
          }
        : undefined,
      signal: this.options.signal,
    }
    const toolCallHistory: string[] = []
    const successfulToolCallHistory = new Set<string>()
    let noProgressCount = 0
    const maxNoProgressSteer = 2   // inject steering after this many no-progress turns
    const maxNoProgressStop = 4    // force stop after this many no-progress turns
    let failedToolName: string | undefined
    let failedToolCount = 0
    let finalAnswerRewriteAttempted = false
    await this.#emit({
      runId,
      turn: 0,
      eventType: 'run.started',
      summary: 'Agent run started',
      status: 'started',
      timestamp: new Date().toISOString(),
    })
    if (this.options.initialSkill) {
      await this.#emit({
        runId,
        turn: 0,
        eventType: 'skill.activated',
        summary: `Activated user-selected skill "${this.options.initialSkill.name}"`,
        status: 'completed',
        data: {
          skill: this.options.initialSkill.name,
          invocation: this.options.initialSkill.invocation,
          version: this.options.initialSkill.version,
          contentHash: this.options.initialSkill.contentHash,
          allowedTools: this.options.initialSkill.allowedTools,
        },
        timestamp: new Date().toISOString(),
      })
    }

    while (goal.status === 'active' && goal.turnCount < goal.maxTurns) {
      this.options.signal?.throwIfAborted()
      goal.turnCount++

      // Evidence Ledger: scope artifacts to this turn (+ active skill if any).
      artifacts.currentScopeKey = context.skillScope
        ? `turn:${goal.turnCount}:skill:${context.skillScope.name}`
        : `turn:${goal.turnCount}`

      const artifactCountBefore = artifacts.list().length
      const canonicalStateBefore = canonical(domainState.snapshot())
      const hadSkillScopeBefore = !!context.skillScope
      const diagnosticsCountBefore = diagnostics.length
      const goalStatusBefore = goal.status

      const visibleTools = this.#visibleToolDefinitions(context)
      const modelRequest = {
        messages,
        tools: visibleTools,
        signal: this.options.signal,
      }

      // Create executor for this turn.
      // toolGuard re-checks visibility (toolFilter/provider) AND permissions
      // at execution time — this is the enforcement that prevents hidden tools
      // from being executed even if the model guesses their names.
      const toolGuard = {
        check: async (tool: AgentTool, input: unknown, ctx: AgentContext): Promise<ToolGuardDecision> => {
          const visibility = this.#toolVisibility(tool, ctx)
          if (!visibility.visible) {
            return {
              decision: 'deny',
              reason: visibility.reason,
              message: visibility.message,
              recoveryHint: visibility.recoveryHint,
              recoveryOptions: visibility.recoveryOptions,
            }
          }
          const providerDecision = await this.options.toolSurfaceProvider?.guard?.(tool, input, ctx)
          if (providerDecision) return providerDecision
          return this.#permissions.guard(tool, input, ctx)
        },
      }
      const executor = new StreamingToolExecutor(
        this.options.tools,
        context,
        this.options.eventSink,
        runId,
        goal.turnCount,
        toolGuard,
        this.options.prepareToolInput,
        transcript,
        this.options.signal,
        this.options.toolSurfaceProvider?.resolveToolCall,
        visibleTools,
      )

      let response: ModelResponse

      if (this.options.model.completeStreaming) {
        // Streaming mode: reassemble the stream (emits incremental UI events)
        // into a full response, then execute via the shared path below.
        response = await this.#reassembleStream(modelRequest, runId, goal.turnCount)
      } else {
        response = await this.options.model.complete(modelRequest)
      }

      await this.#emit({
        runId,
        turn: goal.turnCount,
        eventType: 'model.responded',
        summary: response.toolCalls?.length
          ? `Model selected ${response.toolCalls.map(call => call.name).join(', ')}`
          : 'Model responded without a tool call',
        status: 'completed',
        data: {
          toolNames: response.toolCalls?.map(call => call.name) ?? [],
          hasVisibleContent: Boolean(response.content.trim()),
        },
        timestamp: new Date().toISOString(),
      })

      const assistant: AgentMessage = {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      }
      messages.push(assistant)
      transcript.record('message', assistant)

      if (!response.toolCalls?.length) {
        toolCallHistory.length = 0
        const naturalAnswer = response.content.trim()
        if (naturalAnswer) {
          const guardResult = this.options.finalAnswerGuard?.(naturalAnswer, context)
          if (guardResult && !guardResult.ok && !finalAnswerRewriteAttempted) {
            finalAnswerRewriteAttempted = true
            messages.push({
              role: 'user',
              content: renderFinalAnswerGuardSteeringPrompt(guardResult.reason),
              hidden: true,
            })
            transcript.record('message', {
              role: 'user',
              content: '[steering] final answer rewrite requested',
              hidden: true,
            })
            continue
          }
          goal.status = 'completed'
          goal.finalSummary = naturalAnswer
          break
        }
        messages.push({
          role: 'user',
          content: renderNoToolCallSteeringPrompt(),
          hidden: true,
        })
        transcript.record('message', {
          role: 'user',
          content: '[steering] empty assistant response without tool call',
          hidden: true,
        })
        continue
      }

      // Loop detection — MUST happen before tool execution to prevent
      // the triggering call from executing.
      const toolCallSignature = canonicalToolCalls(response.toolCalls)
      toolCallHistory.push(toolCallSignature)
      const maxRepeatedToolCalls = this.options.maxRepeatedToolCalls ?? 4
      const repeatedCycle = findRepeatedCycle(toolCallHistory, maxRepeatedToolCalls)
      if (repeatedCycle) {
        const summary = repeatedCycle.join(' -> ')
        const diagnostic: Diagnostic = {
          code: 'AGENT_REPEATED_TOOL_CALL_LOOP',
          message: `Detected a tool-call cycle repeated ${maxRepeatedToolCalls} times: ${summary}`,
          severity: 'error',
        }
        diagnostics.push(diagnostic)
        transcript.record('diagnostic', diagnostic)
        await this.#emit({
          runId,
          turn: goal.turnCount,
          eventType: 'loop.detected',
          summary: diagnostic.message,
          status: 'failed',
          data: { code: diagnostic.code },
          timestamp: new Date().toISOString(),
        })
        goal.status = 'failed'
        goal.remainingIssues.push(diagnostic.message)
        break
      }

      // Register and execute tools AFTER loop detection.
      // Both streaming and non-streaming paths converge here:
      // streaming collects tool calls from the stream, non-streaming gets them
      // from complete().  Either way, loop detection runs first.
      for (const call of response.toolCalls) {
        executor.addTool(call)
      }
      await executor.flush()

      // Collect tool results from executor.
      // Hidden messages (skill instructions, progress) are collected
      // separately and pushed AFTER all tool results, so they don't
      // interleave between assistant/tool message pairs.
      const pendingHiddenMessages: AgentMessage[] = []
      for (const msg of executor.getCompletedResults()) {
        if ('hidden' in msg && msg.hidden) {
          pendingHiddenMessages.push(msg)
          transcript.record('message', msg)
          continue
        }
        messages.push(msg)
        if (msg.role === 'tool') transcript.record('tool_result', msg)
      }

      // Wait for remaining tools
      for await (const msg of executor.getRemainingResults()) {
        if ('hidden' in msg && msg.hidden) {
          pendingHiddenMessages.push(msg)
          transcript.record('message', msg)
          continue
        }
        messages.push(msg)
        if (msg.role === 'tool') transcript.record('tool_result', msg)
      }

      // Push hidden messages after all tool results
      messages.push(...pendingHiddenMessages)

      // Check if blocked (permission deferred)
      if (executor.hasBlockedOnPermission()) {
        break
      }

      // Merge diagnostics collected by the executor (from tool result.diagnostics)
      if (executor.collectedDiagnostics.length > 0) {
        diagnostics.push(...executor.collectedDiagnostics)
      }

      // Per-tool failure loop detection: if the same tool fails 3 consecutive
      // times without producing new artifacts or state changes, stop the run.
      // This is a strict guard against a tool that is fundamentally broken.
      let observedNewToolResult = false
      {
        let toolFailedWithoutProgress = false
        for (const call of response.toolCalls) {
          const toolResult = [...messages].reverse().find(
            m => m.role === 'tool' && m.toolCallId === call.id,
          )
          if (toolResult?.role !== 'tool' || !toolResult.isError) {
            const successfulCallSignature = canonicalToolCalls([call])
            if (!successfulToolCallHistory.has(successfulCallSignature)) {
              successfulToolCallHistory.add(successfulCallSignature)
              observedNewToolResult = true
            }
            // Successful tool — reset per-tool failure counter
            failedToolName = undefined
            failedToolCount = 0
            continue
          }
          // Tool failed — check if it produced any side-effects
          const madeProgress =
            artifacts.list().length > artifactCountBefore ||
            canonical(domainState.snapshot()) !== canonicalStateBefore
          if (madeProgress) {
            failedToolName = undefined
            failedToolCount = 0
            continue
          }
          if (failedToolName === call.name) {
            failedToolCount++
          } else {
            failedToolName = call.name
            failedToolCount = 1
          }
          if (failedToolCount === 1 && isEmptyObject(call.input)) {
            const tool = this.options.tools.resolve(call.name)
            messages.push({
              role: 'user',
              content: renderEmptyToolInputSteeringPrompt({
                toolName: call.name,
                tool,
                requiredToolInputSummary,
              }),
              hidden: true,
            })
            transcript.record('message', { role: 'user', content: `[steering] ${call.name} requires non-empty input`, hidden: true })
          }
          if (failedToolCount >= 3) {
            const diagnostic: Diagnostic = {
              code: 'AGENT_TOOL_FAILURE_LOOP',
              message: `Tool ${call.name} failed ${failedToolCount} consecutive times without producing progress. Last error: ${summarizeText(toolResult.content)}`,
              severity: 'error',
            }
            diagnostics.push(diagnostic)
            transcript.record('diagnostic', diagnostic)
            await this.#emit({
              runId,
              turn: goal.turnCount,
              eventType: 'diagnostic.created',
              summary: diagnostic.message,
              status: 'failed',
              data: { code: diagnostic.code, tool: call.name, failedToolCount },
              timestamp: new Date().toISOString(),
            })
            goal.status = 'failed'
            goal.remainingIssues.push(diagnostic.message)
            toolFailedWithoutProgress = true
            break
          }
        }
        if (toolFailedWithoutProgress) break
      }

      // Diminishing-returns detection via a unified progress signal. A turn
      // counts as progress if ANY of these advanced: a new artifact (incl.
      // supersession), the domain state, an activated skill, a new diagnostic,
      // or the goal status (completed/blocked). Only genuinely-stuck turns — same
      // actions, no state change, no new evidence — count toward stopping.
      // NOTE: goal narration fields (progress/nextStep set by update_goal) are
      // intentionally NOT progress; spamming them is exactly the stuck loop
      // this guard catches.
      const progressMadeThisTurn =
        artifacts.list().length !== artifactCountBefore ||
        canonical(domainState.snapshot()) !== canonicalStateBefore ||
        observedNewToolResult ||
        (!!context.skillScope && !hadSkillScopeBefore) ||
        diagnostics.length > diagnosticsCountBefore ||
        goal.status !== goalStatusBefore
      if (!progressMadeThisTurn && goal.status === 'active') {
        noProgressCount++
        if (noProgressCount === maxNoProgressSteer) {
          messages.push({
            role: 'user',
            content: '你一直在重复相同操作，但没有产生新的证据或 artifacts。如果目标已经完成，现在用自然的简体中文回答。如果已经受阻，请改变方法，或用简体中文说明目前已有证据和具体阻塞点。',
            hidden: true,
          })
          transcript.record('message', { role: 'user', content: '[steering] diminishing-returns warning injected', hidden: true })
        }
        if (noProgressCount >= maxNoProgressStop) {
          const diagnostic: Diagnostic = {
            code: 'AGENT_NO_PROGRESS',
            message: `Agent made no progress (no new evidence or state change) for ${noProgressCount} consecutive turns — stopping.`,
            severity: 'error',
          }
          diagnostics.push(diagnostic)
          transcript.record('diagnostic', diagnostic)
          await this.#emit({
            runId,
            turn: goal.turnCount,
            eventType: 'diagnostic.created',
            summary: diagnostic.message,
            status: 'failed',
            data: { code: diagnostic.code, noProgressCount },
            timestamp: new Date().toISOString(),
          })
          goal.status = 'failed'
          goal.remainingIssues.push(diagnostic.message)
          break
        }
      } else {
        noProgressCount = 0
      }

      if (isGoalCompleted(goal) && goal.finalSummary?.trim() && this.options.finalAnswerGuard) {
        const finalAnswer = goal.finalSummary.trim()
        const guardResult = this.options.finalAnswerGuard(finalAnswer, context)
        if (!guardResult.ok && !finalAnswerRewriteAttempted) {
          finalAnswerRewriteAttempted = true
          goal.status = 'active'
          goal.finalSummary = undefined
          messages.push({
            role: 'user',
            content: renderFinalAnswerGuardSteeringPrompt(guardResult.reason),
            hidden: true,
          })
          transcript.record('message', {
            role: 'user',
            content: '[steering] final answer rewrite requested',
            hidden: true,
          })
          continue
        }
      }

      if (goal.status !== 'active') break
    }

    if (goal.status === 'active') {
      goal.status = 'failed'
      const recentToolCalls = transcript.events
        .filter(event => event.type === 'tool_call')
        .slice(-8)
        .map(event => summarizeToolCalls([event.data as ToolCall]))
      const trace = recentToolCalls.length
        ? ` Recent tool calls: ${recentToolCalls.join(' -> ')}`
        : ''
      const message = `Reached maximum turns (${goal.maxTurns}).${trace}`
      goal.remainingIssues.push(message)
      const diagnostic: Diagnostic = {
        code: 'AGENT_MAX_TURNS_REACHED',
        message,
        severity: 'error',
      }
      diagnostics.push(diagnostic)
      transcript.record('diagnostic', diagnostic)
      await this.#emit({
        runId,
        turn: goal.turnCount,
        eventType: 'diagnostic.created',
        summary: diagnostic.message,
        status: 'failed',
        data: { code: diagnostic.code },
        timestamp: new Date().toISOString(),
      })
    }
    const turnOutcome = buildTurnOutcome(goal, diagnostics)
    await this.#emit({
      runId,
      turn: goal.turnCount,
      summary: turnOutcome.finalAnswer,
      eventType:
        goal.status === 'completed'
          ? 'run.completed'
          : goal.status === 'blocked'
            ? 'run.paused'
            : 'run.failed',
      status: goal.status === 'completed' ? 'completed' : goal.status === 'blocked' ? 'waiting' : 'failed',
      data: { goalStatus: goal.status },
      timestamp: new Date().toISOString(),
    })
    transcript.record('goal', goal)
    return {
      runId,
      goal,
      turnOutcome,
      messages,
      transcript: transcript.events,
      artifacts: artifacts.list(),
      artifactLedger: artifacts.list(undefined, { includeSuperseded: true }),
      domainState: domainState.snapshot(),
      diagnostics,
    }
  }

  /**
   * Consume the model's streaming output, emit incremental UI events, and
   * reassemble it into a single ModelResponse.
   *
   * Tools are NOT executed here.  They are returned in the response so the
   * main loop runs loop detection BEFORE any tool side-effects — the same
   * ordering the non-streaming path guarantees.  The only streaming-specific
   * behaviour is the `model.streaming` events, which let the frontend render
   * text deltas and tool cards before the turn completes.
   */
  async #reassembleStream(
    request: { messages: readonly AgentMessage[]; tools: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[]; signal?: AbortSignal },
    runId: string,
    turn: number,
  ): Promise<ModelResponse> {
    let content = ''
    // Insertion order preserved; one entry per tool call, arguments accreted
    // across however many delta chunks the provider sends.
    const toolCalls = new Map<string, { name: string; arguments: string }>()

    for await (const chunk of this.options.model.completeStreaming!(request)) {
      switch (chunk.type) {
        case 'text':
          content += chunk.text
          await this.#emit({
            runId,
            turn,
            eventType: 'model.streaming',
            summary: chunk.text,
            status: 'completed',
            data: { text: chunk.text },
            timestamp: new Date().toISOString(),
          })
          break
        case 'tool_call_start':
          await this.#emit({
            runId,
            turn,
            eventType: 'model.streaming',
            summary: `tool_call: ${chunk.name}`,
            status: 'completed',
            data: { tool: chunk.name, tool_call_id: chunk.id },
            timestamp: new Date().toISOString(),
          })
          toolCalls.set(chunk.id, { name: chunk.name, arguments: '' })
          break
        case 'tool_call_delta': {
          const entry = toolCalls.get(chunk.id)
          if (entry) entry.arguments += chunk.argumentsDelta
          break
        }
        case 'done':
          break
      }
    }

    const calls = [...toolCalls.entries()].map(([id, tc]) => ({
      id,
      name: tc.name,
      input: parseArguments(tc.arguments),
    }))

    return {
      content,
      toolCalls: calls.length ? calls : undefined,
    }
  }

  #visibleToolDefinitions(context: AgentContext): readonly ModelToolDefinition[] {
    const tools = this.options.tools.list()
    if (this.options.toolSurfaceProvider) {
      return this.options.toolSurfaceProvider.visibleTools(
        context,
        tools.filter(tool => this.#baseToolVisibility(tool, context, { ignoreSkillScope: true }).visible),
      )
    }
    return tools
      .filter(tool => this.#toolVisibility(tool, context).visible)
      .map(tool => toolDefinition(tool))
  }

  #isToolVisible(tool: ReturnType<ToolRegistry['list']>[number], context: AgentContext): boolean {
    return this.#toolVisibility(tool, context).visible
  }

  #toolVisibility(tool: ReturnType<ToolRegistry['list']>[number], context: AgentContext): ToolVisibilityDecision {
    const providerDecision = this.options.toolSurfaceProvider?.visibility?.(tool, context)
    if (providerDecision) return providerDecision
    return this.#baseToolVisibility(tool, context)
  }

  #baseToolVisibility(
    tool: ReturnType<ToolRegistry['list']>[number],
    context: AgentContext,
    _options?: { ignoreSkillScope?: boolean },
  ): ToolVisibilityDecision {
    if (this.options.toolFilter && !this.options.toolFilter(tool, context)) {
      return {
        visible: false,
        reason: 'tool_filter_denied',
        message: `Tool ${tool.name} is not visible in the current business surface.`,
        recoveryHint: tool.policy?.visibility?.recoveryHint ??
          'Use one of the visible tools for this surface or explain the supported status.',
      }
    }
    return {
      visible: true,
      reason: 'visible',
      message: tool.policy?.visibility?.reason,
      recoveryHint: tool.policy?.visibility?.recoveryHint,
    }
  }

  async #emit(event: AgentActionEvent): Promise<void> {
    try {
      await this.options.eventSink?.emit(event)
    } catch {
      // Observability must never prevent the Agent from completing its work.
    }
  }
}

function toolDefinition(tool: AgentTool): ModelToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    metadata: {
      risk: tool.risk,
      visibilityReason: tool.policy?.visibility?.reason,
      recoveryHint: tool.policy?.visibility?.recoveryHint,
    },
  }
}

function buildTurnOutcome(
  goal: GoalState,
  diagnostics: readonly Diagnostic[],
): TurnOutcome {
  return {
    status: turnOutcomeStatus(goal.status),
    finalAnswer: finalAnswerFromGoal(goal),
    diagnostics: diagnostics.map(diagnostic => ({
      code: diagnostic.code,
      message: diagnostic.message,
      severity: diagnostic.severity,
    })),
    metadata: {
      goalStatus: goal.status,
      turnCount: goal.turnCount,
      evidenceCount: goal.evidence.length,
      remainingIssueCount: goal.remainingIssues.length,
    },
  }
}

function turnOutcomeStatus(status: GoalState['status']): TurnOutcomeStatus {
  if (status === 'completed') return 'completed'
  if (status === 'blocked') return 'awaiting_user'
  return 'failed'
}

function finalAnswerFromGoal(goal: GoalState): string {
  if (goal.finalSummary?.trim()) {
    return goal.finalSummary.trim()
  }
  const issues = goal.remainingIssues.map(issue => issue.trim()).filter(Boolean).join('; ')
  if (issues) return issues
  if (goal.progress?.trim()) return goal.progress.trim()
  return `Agent run ended with status ${goal.status}`
}

function isGoalCompleted(goal: GoalState): boolean {
  return goal.status === 'completed'
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function isEmptyObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
}

function requiredToolInputSummary(schema: Record<string, unknown>): Record<string, unknown> {
  const required = Array.isArray(schema.required) ? schema.required.filter(item => typeof item === 'string') : []
  const properties = schema.properties && typeof schema.properties === 'object'
    ? Object.fromEntries(
        required.map(key => [
          key,
          (schema.properties as Record<string, unknown>)[key],
        ]),
      )
    : undefined
  return {
    required,
    properties,
  }
}

function canonicalToolCalls(calls: readonly ToolCall[]): string {
  return calls.map(call => `${call.name}:${canonical(call.input)}`).join('|')
}

function findRepeatedCycle(history: readonly string[], repetitions: number): string[] | undefined {
  const maxCycleLength = Math.min(6, Math.floor(history.length / repetitions))
  for (let cycleLength = 1; cycleLength <= maxCycleLength; cycleLength++) {
    const cycle = history.slice(-cycleLength)
    const repeated = Array.from({ length: repetitions }, () => cycle).flat()
    if (
      history.length >= repeated.length &&
      history.slice(-repeated.length).every((signature, index) => signature === repeated[index])
    ) {
      return cycle
    }
  }
  return undefined
}

function summarizeToolCalls(calls: readonly ToolCall[]): string {
  return calls
    .map(call => {
      const input = canonical(call.input)
      return `${call.name}(${input.length > 160 ? `${input.slice(0, 157)}...` : input})`
    })
    .join(', ')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function createRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function summarizeText(value: string, maxLength = 500): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact
}
