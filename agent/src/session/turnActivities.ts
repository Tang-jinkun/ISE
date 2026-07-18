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

const STAGE_SUMMARIES: Record<string, string> = {
  narrative: '梳理叙事结构',
  assets: '匹配场景素材',
  schedule: '编排场景时间',
  validate: '校验场景约束',
  adapt: '生成播放配置',
}

const ARTIFACT_SUMMARIES: Record<string, string> = {
  'ise.event-plan-draft/v1': '事件计划草案',
  'ise.event-plan-accepted/v1': '事件计划',
  'ise.narration-plan/v1': '叙事计划',
  'ise.scene-blueprint/v1': '场景蓝图',
  'ise.resolved-scene-plan/v1': '场景解析',
  'ise.choreography-plan/v1': '动作编排',
  'ise.canonical-runtime-plan/v1': '运行时计划',
}

function stageSummary(stage: string | undefined): string {
  return stage ? STAGE_SUMMARIES[stage] ?? '处理场景生成' : '处理场景生成'
}

function artifactSummary(artifactType: string | undefined): string {
  return artifactType ? ARTIFACT_SUMMARIES[artifactType] ?? '场景产物' : '场景产物'
}

function reviewSummary(status: string | undefined): string {
  if (status === 'approved') return '审核已通过'
  if (status === 'rejected') return '审核已拒绝'
  return '等待审核确认'
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
    if (event.type === 'compile.progress') {
      settleThinking(activities)
      const stage = stringField(data, 'stage')
      activities.push({
        id: `stage-${event.id}`,
        type: 'stage',
        status: 'completed',
        ...(stage ? { stage } : {}),
        summary: stageSummary(stage),
        ...(numberField(data, 'progress') !== undefined ? { percentage: numberField(data, 'progress') } : {}),
      })
      continue
    }
    if (event.type === 'artifact.created') {
      settleThinking(activities)
      const artifactType = stringField(data, 'artifactType') ?? stringField(data, 'type')
      const artifactId = stringField(data, 'artifactId')
      activities.push({
        id: `artifact-${event.id}`,
        type: 'artifact',
        status: 'completed',
        ...(artifactType ? { artifactType } : {}),
        ...(artifactId ? { artifactId } : {}),
        summary: artifactSummary(artifactType),
      })
      continue
    }
    if (event.type === 'review.requested') {
      settleThinking(activities)
      const reviewId = stringField(data, 'reviewId')
      activities.push({
        id: `review-${reviewId ?? event.id}`,
        type: 'review',
        status: 'running',
        summary: reviewSummary(undefined),
      })
      continue
    }
    if (event.type === 'review.resolved') {
      settleThinking(activities)
      const reviewId = stringField(data, 'reviewId')
      const review = activities.find(item => item.type === 'review' && item.id === `review-${reviewId}`)
      if (review) {
        review.status = 'completed'
        review.summary = reviewSummary(stringField(data, 'status'))
      } else {
        activities.push({
          id: `review-${reviewId ?? event.id}`,
          type: 'review',
          status: 'completed',
          summary: reviewSummary(stringField(data, 'status')),
        })
      }
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
