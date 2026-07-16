import type { AgentTurnActivity } from '../api/contracts.ts'
import type { EventRecord, RunRecord } from '../persistence/repositories.ts'

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === 'string' && data[key].length > 0 ? data[key] : undefined
}

function numberField(data: Record<string, unknown>, key: string): number | undefined {
  return typeof data[key] === 'number' && Number.isFinite(data[key]) ? data[key] : undefined
}

function failureDiagnostics(data: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(data.diagnostics)
    ? data.diagnostics.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : []
}

function settleThinking(activities: AgentTurnActivity[]): void {
  const last = activities.at(-1)
  if (last?.type === 'thinking' && last.status === 'running') last.status = 'completed'
}

export function projectTurnActivities(
  events: readonly EventRecord[],
  runStatus: RunRecord['status'],
): AgentTurnActivity[] {
  const activities: AgentTurnActivity[] = []
  for (const event of events) {
    const data = event.data
    if (event.type === 'model.streaming') {
      const text = stringField(data, 'text')
      if (!text) continue
      const last = activities.at(-1)
      if (last?.type === 'thinking' && last.status === 'running') last.text = `${last.text ?? ''}${text}`
      else activities.push({
        id: `thinking-${activities.filter(item => item.type === 'thinking').length + 1}`,
        type: 'thinking',
        status: 'running',
        text,
      })
      continue
    }
    if (event.type === 'tool.started') {
      settleThinking(activities)
      const id = stringField(data, 'toolCallId') ?? `tool-${event.id}`
      if (!activities.some(item => item.type === 'tool' && item.id === id)) {
        activities.push({
          id,
          type: 'tool',
          status: 'running',
          name: stringField(data, 'toolName') ?? 'tool',
          ...(stringField(data, 'summary') ? { summary: stringField(data, 'summary') } : {}),
        })
      }
      continue
    }
    if (event.type === 'tool.progress' || event.type === 'tool.completed' || event.type === 'tool.failed') {
      settleThinking(activities)
      const id = stringField(data, 'toolCallId') ?? `tool-${event.id}`
      let tool = activities.find(item => item.type === 'tool' && item.id === id)
      if (!tool) {
        tool = { id, type: 'tool', status: 'running', name: stringField(data, 'toolName') ?? 'tool' }
        activities.push(tool)
      }
      tool.status = event.type === 'tool.failed' ? 'failed' : event.type === 'tool.completed' ? 'completed' : 'running'
      tool.name = stringField(data, 'toolName') ?? tool.name
      tool.summary = stringField(data, 'summary') ?? stringField(data, 'message') ?? tool.summary
      tool.percentage = numberField(data, 'percentage') ?? tool.percentage
      continue
    }
    if (event.type === 'diagnostic.created') {
      settleThinking(activities)
      activities.push({
        id: `diagnostic-${event.id}`,
        type: 'diagnostic',
        status: stringField(data, 'severity') === 'error' ? 'failed' : 'completed',
        summary: stringField(data, 'summary') ?? '智能体执行状态已更新',
      })
      continue
    }
    if (event.type === 'run.failed') {
      settleThinking(activities)
      for (const [index, item] of failureDiagnostics(data).entries()) {
        activities.push({
          id: `diagnostic-${event.id}-${index + 1}`,
          type: 'diagnostic',
          status: stringField(item, 'severity') === 'error' ? 'failed' : 'completed',
          ...(stringField(item, 'code') ? { code: stringField(item, 'code') } : {}),
          summary: stringField(item, 'message') ?? '智能体执行失败',
        })
      }
    }
  }
  if (!['queued', 'running'].includes(runStatus)) settleThinking(activities)
  return activities
}
