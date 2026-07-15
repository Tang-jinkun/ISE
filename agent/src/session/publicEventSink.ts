import type { AgentActionEvent, AgentEventSink } from '@ise/agent-core'
import type { EventBroker } from './eventBroker.ts'
import { publicFailureDiagnostics } from '../services/publicFailures.ts'

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('PUBLIC_EVENT_FIELD_REQUIRED')
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function publicArtifactMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const allowed = ['documentId', 'planId', 'version', 'fingerprint', 'sourceHash', 'sourceEventPlan']
  const output = Object.fromEntries(allowed.flatMap(key => input[key] === undefined ? [] : [[key, input[key]]]))
  return Object.keys(output).length > 0 ? output : undefined
}

export class PublicEventSink implements AgentEventSink {
  constructor(
    readonly sessionId: string,
    readonly broker: EventBroker,
    readonly persistentRunId?: string,
  ) {}

  async emit(event: AgentActionEvent): Promise<void> {
    const runId = this.persistentRunId ?? event.runId
    switch (event.eventType) {
      case 'run.started':
        this.broker.append(this.sessionId, runId, 'run.started', {
          runId,
          status: 'running',
        })
        return
      case 'tool.started':
        this.broker.append(this.sessionId, runId, 'tool.started', {
          runId,
          toolCallId: requiredString(event.toolCallId),
          toolName: requiredString(event.data?.tool),
          summary: event.summary,
        })
        return
      case 'tool.progress': {
        const toolName = optionalString(event.data?.tool)
        const message = optionalString(event.data?.message)
        const percentage = typeof event.data?.percentage === 'number' ? event.data.percentage : undefined
        this.broker.append(this.sessionId, runId, 'tool.progress', {
          runId,
          toolCallId: requiredString(event.toolCallId),
          ...(toolName ? { toolName } : {}),
          ...(message ? { message } : {}),
          ...(percentage === undefined ? {} : { percentage }),
        })
        return
      }
      case 'artifact.created': {
        const metadata = publicArtifactMetadata(event.data?.metadata)
        const logicalKey = optionalString(event.data?.logicalKey)
        this.broker.append(this.sessionId, runId, 'artifact.created', {
          runId,
          artifactId: requiredString(event.data?.artifactId),
          artifactType: requiredString(event.data?.artifactType),
          ...(logicalKey ? { logicalKey } : {}),
          ...(metadata ? { metadata } : {}),
        })
        return
      }
      case 'run.failed':
        this.broker.append(this.sessionId, runId, 'run.failed', {
          runId,
          status: 'failed',
          diagnostics: publicFailureDiagnostics(event.data?.diagnostics),
        })
        return
      default:
        return
    }
  }
}
