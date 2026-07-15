import type { AgentActionEvent, AgentEventSink, Diagnostic } from '@ise/agent-core'
import type { EventBroker } from './eventBroker.ts'

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('PUBLIC_EVENT_FIELD_REQUIRED')
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function diagnostics(value: unknown): Diagnostic[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (
      typeof record.code !== 'string'
      || typeof record.message !== 'string'
      || !['info', 'warning', 'error'].includes(String(record.severity))
    ) return []
    return [{
      code: record.code,
      message: record.message,
      severity: record.severity as Diagnostic['severity'],
      ...(Array.isArray(record.relatedArtifactIds)
        ? { relatedArtifactIds: record.relatedArtifactIds.filter((id): id is string => typeof id === 'string') }
        : {}),
    }]
  })
}

function publicArtifactMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const allowed = ['documentId', 'planId', 'version', 'fingerprint', 'sourceHash', 'sourceEventPlan']
  const output = Object.fromEntries(allowed.flatMap(key => input[key] === undefined ? [] : [[key, input[key]]]))
  return Object.keys(output).length > 0 ? output : undefined
}

export class PublicEventSink implements AgentEventSink {
  constructor(readonly sessionId: string, readonly broker: EventBroker) {}

  async emit(event: AgentActionEvent): Promise<void> {
    switch (event.eventType) {
      case 'run.started':
        this.broker.append(this.sessionId, event.runId, 'run.started', {
          runId: event.runId,
          status: 'running',
        })
        return
      case 'tool.started':
        this.broker.append(this.sessionId, event.runId, 'tool.started', {
          runId: event.runId,
          toolCallId: requiredString(event.toolCallId),
          toolName: requiredString(event.data?.tool),
          summary: event.summary,
        })
        return
      case 'tool.progress': {
        const toolName = optionalString(event.data?.tool)
        const message = optionalString(event.data?.message)
        const percentage = typeof event.data?.percentage === 'number' ? event.data.percentage : undefined
        this.broker.append(this.sessionId, event.runId, 'tool.progress', {
          runId: event.runId,
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
        this.broker.append(this.sessionId, event.runId, 'artifact.created', {
          runId: event.runId,
          artifactId: requiredString(event.data?.artifactId),
          artifactType: requiredString(event.data?.artifactType),
          ...(logicalKey ? { logicalKey } : {}),
          ...(metadata ? { metadata } : {}),
        })
        return
      }
      case 'run.failed':
        this.broker.append(this.sessionId, event.runId, 'run.failed', {
          runId: event.runId,
          status: 'failed',
          diagnostics: diagnostics(event.data?.diagnostics),
        })
        return
      default:
        return
    }
  }
}
