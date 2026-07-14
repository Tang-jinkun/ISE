import type {
  AgentContext,
  AgentEventSink,
  AgentMessage,
  AgentTool,
  Diagnostic,
  ModelToolDefinition,
  ToolCall,
  ToolCallResolution,
  ToolGuardDecision,
} from '../types.ts'
import type { ToolRegistry } from '../tools/ToolRegistry.ts'
import type { Transcript } from '../transcript/Transcript.ts'
import { executeToolCall } from './ToolExecutionHost.ts'

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

interface TrackedTool {
  call: ToolCall
  tool: AgentTool | undefined
  metadata?: Record<string, unknown>
  status: ToolStatus
  isConcurrencySafe: boolean
  registeredButNotVisible: boolean
  promise?: Promise<void>
  results?: AgentMessage[]
  pendingProgress: AgentMessage[]
}

export interface ToolExecutorResult {
  messages: AgentMessage[]
  diagnostics: Diagnostic[]
}

/**
 * Executes tools as they stream in with concurrency control.
 *
 * Runtime contract — every tool execution passes through `toolGuard`, which
 * re-checks tool visibility (tool surface/provider filters) AND permissions at
 * execution time, not just at advertisement time.  This prevents the model
 * from executing hidden tools even if it guesses their names.
 *
 * Concurrency model (currently serial; opt-in for future parallelism):
 * - Tools with `isConcurrencySafe === true` MAY execute in parallel, but
 *   this capability is NOT yet used — no GSMS tool declares it, and the
 *   default is false. All tools currently execute one at a time.
 * - `isConcurrencySafe` is an explicit opt-in on the AgentTool interface;
 *   it is NOT derived from `risk`.
 *
 * Results are buffered and yielded in tool-registration order.
 *
 * Ported from Claude Code's StreamingToolExecutor.
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private hasErrored = false
  private erroredToolDescription = ''
  private siblingAbortController: AbortController
  private discarded = false
  private progressAvailableResolve?: () => void
  private readonly diagnostics: Diagnostic[] = []
  private processQueueRunning = false
  private processQueueDone: Promise<void> = Promise.resolve()
  private resolveProcessQueueDone?: () => void

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly context: AgentContext,
    private readonly eventSink?: AgentEventSink,
    private readonly runId = '',
    private readonly turn = 0,
    private readonly toolGuard?: {
      check: (tool: AgentTool, input: unknown, context: AgentContext) => Promise<'allow' | 'deny' | 'defer' | ToolGuardDecision>
    },
    private readonly prepareToolInput?: (tool: AgentTool, input: unknown, context: AgentContext) => unknown,
    private readonly transcript?: Transcript,
    parentSignal?: AbortSignal,
    private readonly resolveToolCall?: (call: ToolCall, context: AgentContext, tools: ToolRegistry) => ToolCallResolution | undefined,
    private readonly modelVisibleTools?: readonly ModelToolDefinition[],
  ) {
    this.siblingAbortController = new AbortController()
    if (parentSignal) {
      parentSignal.addEventListener('abort', () => {
        this.siblingAbortController.abort(parentSignal.reason)
      })
    }
  }

  discard(): void {
    this.discarded = true
  }

  /**
   * Register a tool call. Starts executing immediately if conditions allow.
   */
  addTool(call: ToolCall): void {
    const isLegalToolName = this.isLegalToolName(call.name)
    const registeredTool = this.toolRegistry.resolve(call.name)
    const registeredButNotVisible = Boolean(this.modelVisibleTools && !isLegalToolName && registeredTool)
    const resolution = isLegalToolName || registeredTool
      ? this.resolveToolCall?.(call, this.context, this.toolRegistry)
      : undefined
    const effectiveCall = resolution?.call ?? call
    const tool = isLegalToolName || registeredTool
      ? resolution?.tool ?? this.toolRegistry.resolve(effectiveCall.name)
      : undefined
    const isConcurrencySafe = tool?.isConcurrencySafe === true

    this.tools.push({
      call: effectiveCall,
      tool,
      metadata: resolution?.metadata,
      status: 'queued',
      isConcurrencySafe,
      registeredButNotVisible,
      pendingProgress: [],
    })

    // Start processing if not already running.
    if (!this.processQueueRunning) {
      this.processQueueRunning = true
      this.processQueueDone = new Promise<void>(resolve => {
        this.resolveProcessQueueDone = resolve
      })
      void this.processQueue()
    }
  }

  /**
   * Wait for all pending tool executions to complete.
   * In non-streaming mode, call this after addTool() to ensure all tools
   * have finished and their results are in the messages array before
   * continuing to the next turn.
   */
  async flush(): Promise<void> {
    while (this.processQueueRunning) {
      await this.processQueueDone
    }
  }

  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')
    return (
      executingTools.length === 0 ||
      (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
    )
  }

  private async processQueue(): Promise<void> {
    try {
      let i = 0
      while (i < this.tools.length) {
        const tool = this.tools[i]
        if (!tool || tool.status !== 'queued') { i++; continue }

        // Stop processing if a previous tool deferred permission — the run
        // is now blocked and remaining tools must not execute.
        // Mark remaining queued tools as completed with cancellation so
        // getCompletedResults() can yield them and transition to 'yielded'.
        if (this.context.goal.status === 'blocked') {
          for (const remaining of this.tools.slice(i)) {
            if (remaining.status === 'queued') {
              remaining.status = 'completed'
              remaining.results = [{
                role: 'tool',
                toolCallId: remaining.call.id,
                content: 'Cancelled: run is blocked pending user confirmation',
                isError: true,
              }]
            }
          }
          break
        }

        if (this.canExecuteTool(tool.isConcurrencySafe)) {
          await this.executeTrackedTool(tool)
        } else {
          if (!tool.isConcurrencySafe) break
          i++
        }
      }
    } finally {
      this.processQueueRunning = false
      this.resolveProcessQueueDone?.()
    }
  }

  private async executeTrackedTool(tracked: TrackedTool): Promise<void> {
    // Don't start executing if the run is already blocked (e.g. a sibling
    // tool deferred permission).
    if (this.context.goal.status === 'blocked') {
      tracked.status = 'completed'
      tracked.results = [{
        role: 'tool',
        toolCallId: tracked.call.id,
        content: 'Cancelled: run is blocked pending user confirmation',
        isError: true,
      }]
      return
    }

    tracked.status = 'executing'

    const collectResults = async () => {
      const messages: AgentMessage[] = []

      // Check abort state
      if (this.discarded || this.hasErrored || this.siblingAbortController.signal.aborted) {
        const reason = this.discarded
          ? 'Streaming fallback - tool execution discarded'
          : this.hasErrored
            ? `Cancelled: parallel tool call ${this.erroredToolDescription} errored`
            : 'Cancelled'
        messages.push({
          role: 'tool',
          toolCallId: tracked.call.id,
          content: reason,
          isError: true,
        })
        tracked.results = messages
        tracked.status = 'completed'
        return
      }

      // Tool not found or not advertised in this model request — do NOT echo
      // the full registry. It is safe to name only the current model-facing
      // tools because the model already received them in this request.
      if (!tracked.tool) {
        messages.push({
          role: 'tool',
          toolCallId: tracked.call.id,
          content: renderUnknownToolDenial(tracked.call.name, this.modelVisibleTools),
          isError: true,
        })
        tracked.results = messages
        tracked.status = 'completed'
        return
      }

      const tool = tracked.tool

      const previousToolCallMetadata = this.context.currentToolCallMetadata
      this.context.currentToolCallMetadata = tracked.metadata
      let execution: Awaited<ReturnType<typeof executeToolCall>>
      try {
        execution = await executeToolCall({
          tool,
          call: tracked.call,
          toolCallMetadata: tracked.metadata,
          context: this.context,
          eventSink: this.eventSink,
          runId: this.runId,
          turn: this.turn,
          guard: this.guardForTrackedTool(tracked),
          prepareInput: this.prepareToolInput,
          transcript: this.transcript,
          diagnostics: this.diagnostics,
          onProgressMessage: message => {
            tracked.pendingProgress.push(message)
            if (this.progressAvailableResolve) {
              this.progressAvailableResolve()
              this.progressAvailableResolve = undefined
            }
          },
        })
      } finally {
        this.context.currentToolCallMetadata = previousToolCallMetadata
      }
      messages.push(...execution.messages)
      if (execution.deferred) {
        this.siblingAbortController.abort('permission_deferred')
      }
      if (execution.outcome === 'failed') {
        this.hasErrored = true
        this.erroredToolDescription = tracked.call.name
        this.siblingAbortController.abort('sibling_error')
      }
      if (execution.outcome === 'completed' && shouldRefreshToolSurface(this.context.domainState.snapshot())) {
        this.cancelQueuedToolsAfterRefresh()
      }

      tracked.results = messages
      tracked.status = 'completed'
    }

    const promise = collectResults()
    tracked.promise = promise
    await promise
  }

  private guardForTrackedTool(tracked: TrackedTool): {
    check: (tool: AgentTool, input: unknown, context: AgentContext) => Promise<'allow' | 'deny' | 'defer' | ToolGuardDecision>
  } | undefined {
    if (!tracked.registeredButNotVisible) return this.toolGuard
    return {
      check: async (tool, input, context) => {
        const decision = await this.toolGuard?.check(tool, input, context)
        if (decision !== undefined && !isAllowGuardDecision(decision)) return decision
        return {
          decision: 'deny',
          reason: 'not_in_current_tool_surface',
          message: `Tool ${tool.name} is registered but is not in the current model-visible tool surface.`,
          recoveryHint: 'Use only tools listed in the current model request.',
          recoveryOptions: [
            {
              code: 'use_current_surface',
              label: 'Use current visible surface',
              description: 'Choose one of the tools exposed in the current model request.',
            },
            {
              code: 'explain_supported_status',
              label: 'Explain supported status',
              description: 'Stop and explain the supported status when the requested action cannot proceed in this surface.',
            },
          ],
        }
      },
    }
  }

  /**
   * Get completed results that haven't been yielded yet (non-blocking).
   * Yields progress messages immediately regardless of tool completion status.
   * Results are yielded in tool registration order.
   */
  *getCompletedResults(): Generator<AgentMessage, void> {
    if (this.discarded) return

    for (const tool of this.tools) {
      // Always yield pending progress messages immediately
      while (tool.pendingProgress.length > 0) {
        yield tool.pendingProgress.shift()!
      }

      if (tool.status === 'yielded') continue

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'
        yield* tool.results
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break
      }
    }
  }

  /**
   * Wait for remaining tools and yield their results as they complete.
   */
  async *getRemainingResults(): AsyncGenerator<AgentMessage, void> {
    if (this.discarded) return

    while (this.hasUnfinishedTools()) {
      await this.processQueue()

      for (const result of this.getCompletedResults()) {
        yield result
      }

      if (
        this.hasExecutingTools() &&
        !this.hasCompletedResults() &&
        !this.hasPendingProgress()
      ) {
        const executingPromises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)

        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })

        if (executingPromises.length > 0) {
          await Promise.race([...executingPromises, progressPromise])
        }
      }
    }

    for (const result of this.getCompletedResults()) {
      yield result
    }
  }

  private hasPendingProgress(): boolean {
    return this.tools.some(t => t.pendingProgress.length > 0)
  }

  private hasCompletedResults(): boolean {
    return this.tools.some(t => t.status === 'completed')
  }

  private hasExecutingTools(): boolean {
    return this.tools.some(t => t.status === 'executing')
  }

  private hasUnfinishedTools(): boolean {
    return this.tools.some(t => t.status !== 'yielded')
  }

  hasBlockedOnPermission(): boolean {
    return this.context.goal.status === 'blocked'
  }

  private isLegalToolName(toolName: string): boolean {
    if (!this.modelVisibleTools) return true
    return this.modelVisibleTools.some(tool => tool.name === toolName)
  }

  private cancelQueuedToolsAfterRefresh(): void {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue
      tool.status = 'completed'
      tool.results = [{
        role: 'tool',
        toolCallId: tool.call.id,
        content: 'Cancelled: business ToolView changed; the next model request will continue with the refreshed tool surface.',
        isError: true,
      }]
    }
  }

  /**
   * Diagnostics collected from tool results during this executor's lifetime.
   */
  get collectedDiagnostics(): readonly Diagnostic[] {
    return this.diagnostics
  }

}

function shouldRefreshToolSurface(state: Record<string, unknown>): boolean {
  const marker = state._toolSurfaceRefreshRequired
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false
  return (marker as Record<string, unknown>).reason === 'scene_business_facts_changed'
}

function isAllowGuardDecision(
  decision: 'allow' | 'deny' | 'defer' | ToolGuardDecision,
): boolean {
  return decision === 'allow' || (typeof decision === 'object' && decision.decision === 'allow')
}

function renderUnknownToolDenial(
  toolName: string,
  modelVisibleTools?: readonly ModelToolDefinition[],
): string {
  const legalTools = modelVisibleTools?.map(tool => ({
    name: tool.name,
    description: tool.description,
  }))
  return JSON.stringify({
    type: 'tool_denial',
    tool: toolName,
    decision: 'deny',
    reason: 'not_in_current_tool_surface',
    message: `本次调用的 ${toolName} 工具不合法；它不在当前模型请求的合法工具列表中。请查看当前合法工具后重新选择。`,
    recoveryHint: '只能调用当前模型请求 tools 列表中精确出现的工具名。不要把上下文里的阶段名、证据类型、能力名、对象类型、id、摘要或历史文本当作工具名。',
    ...(legalTools ? { legalTools } : {}),
    recoveryOptions: [
      {
        code: 'use_current_surface',
        label: 'Use current visible surface',
        description: 'Choose one of the tools exposed in the current model request.',
      },
      {
        code: 'explain_supported_status',
        label: 'Explain supported status',
        description: 'Stop and explain the supported status when the requested action cannot proceed in this surface.',
      },
    ],
  })
}
