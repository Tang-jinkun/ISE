import type {
  AgentActionEvent,
  AgentContext,
  AgentEventSink,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  Diagnostic,
  RecoveryOption,
  ToolCall,
  ToolGuardDecision,
  ToolProgressEvent,
} from '../types.ts'
import type { Transcript } from '../transcript/Transcript.ts'
import {
  isStructuredToolError,
  renderStructuredToolFailure,
} from './StructuredToolError.ts'

export interface ToolExecutionHostOptions {
  context: AgentContext
  eventSink?: AgentEventSink
  runId: string
  turn: number
  transcript?: Transcript
  diagnostics?: Diagnostic[]
}

export interface ExecuteToolCallOptions extends ToolExecutionHostOptions {
  tool: AgentTool
  call: ToolCall
  toolCallMetadata?: Record<string, unknown>
  prepareInput?: (tool: AgentTool, input: unknown, context: AgentContext) => unknown
  guard?: {
    check: (tool: AgentTool, input: unknown, context: AgentContext) => Promise<'allow' | 'deny' | 'defer' | ToolGuardDecision>
  }
  onProgressMessage?: (message: AgentMessage) => void
}

export interface ExecuteToolCallResult {
  messages: AgentMessage[]
  result?: AgentToolResult
  deferred: boolean
  outcome: 'completed' | 'deferred' | 'denied' | 'failed'
}

export async function executeToolCall(options: ExecuteToolCallOptions): Promise<ExecuteToolCallResult> {
  const { tool, context, runId, turn, guard } = options
  let call = options.call
  const messages: AgentMessage[] = []
  const startedAt = Date.now()
  let trustedConfirmationId: string | undefined

  try {
    if (options.prepareInput) {
      call = { ...call, input: options.prepareInput(tool, call.input, context) }
    }
    options.transcript?.record('tool_call', call)
    await emit(options.eventSink, {
      runId,
      turn,
      eventType: 'tool.started',
      summary: `Started ${call.name}`,
      status: 'started',
      toolCallId: call.id,
      data: toolEventData(call.name, call.input, options.toolCallMetadata),
      timestamp: new Date().toISOString(),
    })

    if (guard) {
      const decision = normalizeGuardDecision(await guard.check(tool, call.input, context))
      if (decision.decision === 'defer') {
        context.goal.status = 'blocked'
        context.goal.remainingIssues = [decision.message ?? `Awaiting user confirmation for ${tool.name}`]
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: renderGuardFeedback(tool.name, decision),
          isError: true,
        })
        await emit(options.eventSink, {
          runId,
          turn,
          eventType: 'tool.deferred',
          summary: `Waiting for user confirmation before ${tool.name}`,
          status: 'waiting',
          toolCallId: call.id,
          data: {
            tool: tool.name,
            reason: decision.reason ?? 'confirmation_required',
            recoveryHint: decision.recoveryHint,
            recoveryOptions: sanitizeForEvent(recoveryOptionsForDecision(tool.name, decision)),
            toolCallMetadata: sanitizeForEvent(options.toolCallMetadata),
          },
          durationMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        })
        return { messages, deferred: true, outcome: 'deferred' }
      }
      if (decision.decision === 'deny') {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: renderGuardFeedback(tool.name, decision),
          isError: true,
        })
        await emit(options.eventSink, {
          runId,
          turn,
          eventType: 'tool.failed',
          summary: `Denied ${call.name}: ${decision.reason ?? 'permission_denied'}`,
          status: 'failed',
          toolCallId: call.id,
          data: {
            tool: tool.name,
            reason: decision.reason ?? 'permission_denied',
            message: decision.message,
            recoveryHint: decision.recoveryHint,
            recoveryOptions: sanitizeForEvent(recoveryOptionsForDecision(tool.name, decision)),
            toolCallMetadata: sanitizeForEvent(options.toolCallMetadata),
          },
          durationMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        })
        return { messages, deferred: false, outcome: 'denied' }
      }
      const confirmationId = decision.confirmationId?.trim()
      if (confirmationId) trustedConfirmationId = confirmationId
    }

    const onProgress = (event: ToolProgressEvent) => {
      options.onProgressMessage?.({
        role: 'user',
        content: event.message,
        hidden: true,
      })
      void emit(options.eventSink, {
        runId,
        turn,
        eventType: 'tool.progress',
        summary: event.message,
        status: 'completed',
        toolCallId: call.id,
        data: { message: event.message, percentage: event.percentage },
        timestamp: new Date().toISOString(),
      })
    }
    const previousConfirmationId = context.lastConsumedConfirmationId
    if (trustedConfirmationId) {
      context.lastConsumedConfirmationId = trustedConfirmationId
    } else {
      delete context.lastConsumedConfirmationId
    }
    const { result, content } = await (async () => {
      try {
        const result = await tool.execute(call.input, context, onProgress)
        const content = await applyToolResult({
          ...options,
          tool,
          call,
          result,
        })
        return { result, content }
      } finally {
        if (previousConfirmationId === undefined) {
          delete context.lastConsumedConfirmationId
        } else {
          context.lastConsumedConfirmationId = previousConfirmationId
        }
      }
    })()
    messages.push({
      role: 'tool',
      toolCallId: call.id,
      content,
      isError: false,
    })
    await emit(options.eventSink, {
      runId,
      turn,
      eventType: 'tool.completed',
      summary: `Completed ${call.name}`,
      status: 'completed',
      toolCallId: call.id,
      data: toolEventData(call.name, undefined, options.toolCallMetadata),
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
    if (result.hiddenMessages?.length) messages.push(...result.hiddenMessages)
    return { messages, result, deferred: false, outcome: 'completed' }
  } catch (error) {
    const structuredFailure = isStructuredToolError(error) ? error.failure : undefined
    const message = structuredFailure
      ? renderStructuredToolFailure(structuredFailure)
      : error instanceof Error ? error.message : String(error)
    messages.push({
      role: 'tool',
      toolCallId: call.id,
      content: message,
      isError: true,
    })
    await emit(options.eventSink, {
      runId,
      turn,
      eventType: 'tool.failed',
      summary: `Failed ${call.name}: ${message.slice(0, 200)}`,
      status: 'failed',
      toolCallId: call.id,
      data: {
        ...toolEventData(call.name, undefined, options.toolCallMetadata),
        error: structuredFailure?.message ?? message.slice(0, 200),
        ...(structuredFailure
          ? {
              reason: structuredFailure.reason,
              recoveryHint: structuredFailure.recoveryHint,
              recoveryOptions: sanitizeForEvent(structuredFailure.recoveryOptions ?? []),
              details: sanitizeForEvent(structuredFailure.details ?? {}),
            }
          : {}),
      },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
    return { messages, deferred: false, outcome: 'failed' }
  }
}

function toolEventData(
  toolName: string,
  input: unknown,
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = { tool: toolName }
  if (input !== undefined) data.input = sanitizeForEvent(input)
  if (metadata) data.toolCallMetadata = sanitizeForEvent(metadata)
  return data
}

function normalizeGuardDecision(
  decision: 'allow' | 'deny' | 'defer' | ToolGuardDecision,
): ToolGuardDecision {
  if (typeof decision !== 'string') return decision
  return { decision }
}

function renderGuardFeedback(toolName: string, decision: ToolGuardDecision): string {
  return JSON.stringify({
    type: 'tool_denial',
    tool: toolName,
    decision: decision.decision,
    reason: decision.reason ?? (decision.decision === 'defer' ? 'confirmation_required' : 'permission_denied'),
    message: decision.message ?? defaultGuardMessage(toolName, decision),
    recoveryHint: decision.recoveryHint,
    recoveryOptions: recoveryOptionsForDecision(toolName, decision),
  })
}

function defaultGuardMessage(toolName: string, decision: ToolGuardDecision): string {
  if (decision.decision === 'defer') {
    return `Tool ${toolName} requires user confirmation before it can continue.`
  }
  return `Tool ${toolName} is not available in the current tool surface or permission scope.`
}

function recoveryOptionsForDecision(toolName: string, decision: ToolGuardDecision): RecoveryOption[] {
  if (decision.recoveryOptions?.length) return decision.recoveryOptions
  switch (decision.reason) {
    case 'missing_facts':
      return [
        {
          code: 'read_business_facts',
          label: 'Read current business facts',
          description: 'Use visible read tools to inspect current scene facts, artifacts, and evidence before retrying.',
        },
        explainSupportedStatusOption(),
      ]
    case 'missing_confirmation':
    case 'confirmation_required':
      return [
        {
          code: 'request_confirmation',
          label: 'Request user confirmation',
          description: 'Use the visible confirmation tool for the current approved input anchors, or wait for the pending confirmation result.',
        },
        explainSupportedStatusOption(),
      ]
    case 'forbidden_side_effect':
      return [
        {
          code: 'explain_supported_status',
          label: 'Explain supported status',
          description: 'Explain what can be concluded from current evidence and what operation remains forbidden in this surface.',
        },
      ]
    case 'stale_surface':
      return [
        {
          code: 'refresh_surface',
          label: 'Refresh the business surface',
          description: 'Use visible tools in the current request. State changes only affect the next model request surface.',
        },
        explainSupportedStatusOption(),
      ]
    case 'insufficient_scope':
      return [
        {
          code: 'use_current_surface',
          label: 'Use current visible surface',
          description: 'The current surface does not have enough grounded scope for this action. Refresh evidence or use a currently visible tool.',
        },
        explainSupportedStatusOption(),
      ]
    case 'policy_denied':
    case 'tool_filter_denied':
      return [
        {
          code: 'use_current_surface',
          label: 'Use current visible surface',
          description: `Tool ${toolName} is outside the current surface. Use one of the visible tools for this SceneRepo turn.`,
        },
        explainSupportedStatusOption(),
      ]
    default:
      return [
        {
          code: 'retry_visible_tool',
          label: 'Retry with a visible tool',
          description: 'Use a tool currently listed in the model-facing tool surface.',
        },
        explainSupportedStatusOption(),
      ]
  }
}

function explainSupportedStatusOption(): RecoveryOption {
  return {
    code: 'explain_supported_status',
    label: 'Explain supported status',
    description: 'Stop and explain the supported status when the requested action cannot proceed in this surface.',
  }
}

export async function applyToolResult(options: ToolExecutionHostOptions & {
  tool: AgentTool
  call: ToolCall
  result: AgentToolResult
}): Promise<string> {
  const { context, tool, call, result, runId, turn } = options

  if (tool.persistResultAboveBytes && result.content.length > tool.persistResultAboveBytes) {
    const inputKey = JSON.stringify(call.input).slice(0, 120)
    const persisted = context.artifacts.create({
      type: 'tool-result',
      logicalKey: `tool-result:${tool.name}:${inputKey}`,
      createdBy: 'tool',
      metadata: { inputKey },
      data: { tool: tool.name, input: call.input, fullContent: result.content },
    })
    await emit(options.eventSink, {
      runId,
      turn,
      eventType: 'artifact.created',
      summary: `Persisted large output from ${tool.name} (${result.content.length} chars)`,
      status: 'completed',
      data: { artifactId: persisted.id, artifactType: 'tool-result' },
      timestamp: new Date().toISOString(),
    })
    const length = result.content.length
    const truncated = result.content.slice(0, 500)
    result.content = `${truncated}\n\n[Full result persisted as artifact "${persisted.id}" (${length} chars). Use get_artifact to retrieve if needed.]`
  }

  if (result.artifacts?.length) {
    for (const artifact of result.artifacts) {
      if (artifact.createdBy === 'user') {
        const isWriteOrExecute = tool.risk === 'write' || tool.risk === 'execute'
        const trustedConfirmationId = context.lastConsumedConfirmationId
        const hasConfirmationBinding =
          isWriteOrExecute &&
          typeof trustedConfirmationId === 'string' &&
          trustedConfirmationId.trim().length > 0 &&
          typeof artifact.metadata?.confirmationId === 'string' &&
          artifact.metadata.confirmationId === trustedConfirmationId
        if (!hasConfirmationBinding) {
          artifact.createdBy = 'tool'
        }
      }
    }
    const created = context.artifacts.createMany(result.artifacts)
    for (const artifact of created) {
      const artifactEventData: Record<string, unknown> = {
        artifactId: artifact.id,
        artifactType: artifact.type,
        logicalKey: artifact.logicalKey,
        metadata: artifact.metadata,
      }
      const artifactData = inlineArtifactDataForEvent(artifact.data)
      if (artifactData !== undefined) artifactEventData.artifactData = artifactData
      await emit(options.eventSink, {
        runId,
        turn,
        eventType: 'artifact.created',
        summary: `Created ${artifact.type} artifact`,
        status: 'completed',
        data: artifactEventData,
        timestamp: new Date().toISOString(),
      })
      options.transcript?.record('artifact', {
        action: 'created',
        id: artifact.id,
        type: artifact.type,
      })
    }
  }

  if (result.statePatch) {
    const state = context.domainState.applyPatch(result.statePatch)
    await emit(options.eventSink, {
      runId,
      turn,
      eventType: 'state.changed',
      summary: `Updated workflow state${typeof state.phase === 'string' ? ` to ${state.phase}` : ''}`,
      status: 'completed',
      data: { patch: result.statePatch },
      timestamp: new Date().toISOString(),
    })
    options.transcript?.record('state', {
      action: 'patched',
      patch: result.statePatch,
    })
  }

  if (result.goalUpdate) Object.assign(context.goal, result.goalUpdate)

  if (result.activateSkill) {
    context.skillScope = {
      name: result.activateSkill.name,
      allowedTools: new Set(result.activateSkill.allowedTools),
      activatedAtTurn: turn,
    }
    await emit(options.eventSink, {
      runId,
      turn,
      eventType: 'state.changed',
      summary: `Activated skill "${result.activateSkill.name}" with ${result.activateSkill.allowedTools.length} allowed tools`,
      status: 'completed',
      data: { skill: result.activateSkill.name, allowedTools: result.activateSkill.allowedTools },
      timestamp: new Date().toISOString(),
    })
  }

  if (result.diagnostics?.length) {
    options.diagnostics?.push(...result.diagnostics)
    for (const diag of result.diagnostics) {
      options.transcript?.record('diagnostic', diag)
      await emit(options.eventSink, {
        runId,
        turn,
        eventType: 'diagnostic.created',
        summary: diag.message,
        status: diag.severity === 'error' ? 'failed' : 'completed',
        data: { code: diag.code, severity: diag.severity },
        timestamp: new Date().toISOString(),
      })
    }
  }

  return result.content
}

function inlineArtifactDataForEvent(data: unknown): unknown {
  try {
    const encoded = JSON.stringify(data)
    if (!encoded || encoded.length > 20_000) return undefined
    return JSON.parse(encoded)
  } catch {
    return undefined
  }
}

async function emit(eventSink: AgentEventSink | undefined, event: AgentActionEvent): Promise<void> {
  try {
    await eventSink?.emit(event)
  } catch {
    // Observability must never prevent the Agent from completing its work.
  }
}

function summarizeText(value: string, maxLength = 1000): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact
}

export function sanitizeForEvent(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeForEvent(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 40)
        .map(([key, item]) => [
          key,
          /api.?key|token|secret|password|authorization/i.test(key)
            ? '[redacted]'
            : sanitizeForEvent(item, depth + 1),
        ]),
    )
  }
  if (typeof value === 'string') return summarizeText(value, 1000)
  return value
}
