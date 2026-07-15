import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  FakeModelAdapter,
  ToolRegistry,
  createSkillAgentTool,
  type AgentTool,
} from '@ise/agent-core'
import { SkillLoader, SkillRegistry, SkillTool } from '@ise/skills-core'
import {
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  EVENT_PLAN_DRAFT_ARTIFACT,
} from '../src/contracts/artifactTypes.ts'
import { eventPlanSchema } from '../src/contracts/eventPlan.ts'
import { IseAgentHost } from '../src/runtime/IseAgentHost.ts'
import { AttachmentRegistry } from '../src/services/attachmentRegistry.ts'
import { parseBattleReport } from '../src/services/documentParser.ts'
import { createDocumentTools } from '../src/tools/documentTools.ts'
import { createEventPlanTools } from '../src/tools/eventPlanTools.ts'

const fixture = new URL('./fixtures/印巴边境空中对抗行动战后复盘报告.docx', import.meta.url)
const projectSkillsDir = fileURLToPath(new URL('../skills/', import.meta.url))

test('root Agent turns a registered battle report into one reviewable five-unit draft', async () => {
  const parsed = await parseBattleReport(await readFile(fixture))
  const eventSpecs = [
    {
      evidenceIndex: 11,
      title: '印方兵力展开',
      worldStateChange: '印方多个航空兵基地由待命状态转入分批出动和边境集结状态。',
      participants: ['苏-30MKI编队', '阵风战斗机编队'],
      locationRefs: ['印方航空兵基地', '边境方向'],
    },
    {
      evidenceIndex: 12,
      title: '巴方升空拦截',
      worldStateChange: '巴方前线航空兵由地面待命转入升空拦截，边境空域由常态警戒转为高强度对峙。',
      participants: ['JF-17编队', '预警机', '地面雷达'],
      locationRefs: ['预定拦截空域', '边境附近空域'],
    },
    {
      evidenceIndex: 13,
      title: '双方进入实质性交锋',
      worldStateChange: '印方首轮导弹发射使双方态势由空中对峙转入实质性交锋。',
      participants: ['印方预警机', '苏-30MKI编队', '巴方前线战机'],
      locationRefs: ['边境附近空域'],
    },
    {
      evidenceIndex: 18,
      title: '巴方恢复目标跟踪',
      worldStateChange: '巴方由被动规避转为重新掌握目标，具备组织反击的条件。',
      participants: ['巴方预警机', 'JF-17战机'],
      locationRefs: ['交战空域'],
    },
    {
      evidenceIndex: 19,
      title: '印方编队转入撤离',
      worldStateChange: '局部空中态势发生变化，印方其余战机开始转向本方一侧撤离。',
      participants: ['印方其余战机'],
      locationRefs: ['局部空中交战区域', '印方一侧'],
    },
  ] as const
  const evidenceIds = eventSpecs.map(spec => parsed.evidence.records[spec.evidenceIndex]?.evidenceId)
  assert.equal(evidenceIds.length, 5)
  assert.ok(evidenceIds.every((evidenceId): evidenceId is string => evidenceId !== undefined))

  const attachments = new AttachmentRegistry()
  const attachment = await attachments.register(fixture)
  const eventUnits = eventSpecs.map((spec, index) => ({
    eventUnitId: `event-${index + 1}`,
    title: spec.title,
    worldStateChange: spec.worldStateChange,
    participants: [...spec.participants],
    locationRefs: [...spec.locationRefs],
    evidenceRefs: [evidenceIds[index]!],
    inferenceRefs: [],
    uncertainties: [],
    narrativePurpose: `呈现第 ${index + 1} 个世界状态变化`,
    importance: index === 3 ? 'high' as const : 'medium' as const,
  }))
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{
        id: 'skill-1',
        name: 'skill',
        input: { skill: 'generate-battle-replay' },
      }],
    },
    {
      content: '',
      toolCalls: [{
        id: 'parse-1',
        name: 'parse_battle_report',
        input: { fileId: attachment.fileId },
      }],
    },
    {
      content: '',
      toolCalls: [{
        id: 'inspect-1',
        name: 'inspect_report_evidence',
        input: { documentId: parsed.document.documentId, limit: 20 },
      }],
    },
    {
      content: '',
      toolCalls: [{
        id: 'propose-1',
        name: 'propose_event_plan',
        input: {
          schemaVersion: 'event-plan/v1',
          planId: 'plan-battle-replay-1',
          documentId: parsed.document.documentId,
          version: 1,
          eventUnits,
          omittedEvidence: parsed.evidence.records
            .map(record => record.evidenceId)
            .filter(evidenceId => !evidenceIds.includes(evidenceId)),
          warnings: [],
        },
      }],
    },
    { content: '事件计划草稿已准备好，请审阅后再决定是否接受。' },
  ])

  const loader = new SkillLoader({ projectSkillsDir })
  const loaded = await loader.load()
  assert.deepEqual(loaded.diagnostics, [])
  const skills = new SkillRegistry()
  skills.replace(loaded.skills)
  assert.ok(skills.resolve('generate-battle-replay'))
  const registered = [
    ...createDocumentTools(attachments),
    ...createEventPlanTools(),
    ...['inspect_replay_assets', 'propose_scene_plan', 'compile_replay_runtime', 'validate_replay_runtime']
      .map(name => ({
        name,
        description: 'Downstream tool surface fixture',
        risk: 'derive',
        inputSchema: { type: 'object' },
        async execute() { return { content: 'not exercised in EventPlan flow' } },
      }) satisfies AgentTool),
  ]
  const tools = new ToolRegistry(registered)
  tools.register(createSkillAgentTool(new SkillTool(skills), {
    availableTools: () => registered.map(tool => tool.name),
    authorizeProjectSkill: () => true,
  }))

  const result = await new IseAgentHost({
    model,
    tools,
    skills,
    workspace: fileURLToPath(new URL('..', import.meta.url)),
    approve: () => 'defer',
  }).run(`请根据附件 ${attachment.fileId} 生成战斗复盘事件计划。`)

  const toolSequence = result.messages
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.toolCalls?.map(call => call.name) ?? [])
  assert.deepEqual(toolSequence, [
    'skill',
    'parse_battle_report',
    'inspect_report_evidence',
    'propose_event_plan',
  ])
  assert.ok(
    result.messages
      .filter(message => message.role === 'tool')
      .every(message => !message.isError),
  )
  const inspectedEvidence = result.messages.find(
    message => message.role === 'tool' && message.toolCallId === 'inspect-1',
  )
  assert.ok(inspectedEvidence)
  assert.ok(evidenceIds.every(evidenceId => inspectedEvidence.content.includes(evidenceId)))
  assert.equal(result.turnOutcome?.finalAnswer, '事件计划草稿已准备好，请审阅后再决定是否接受。')

  const drafts = result.artifacts.filter(artifact => artifact.type === EVENT_PLAN_DRAFT_ARTIFACT)
  assert.equal(drafts.length, 1)
  const draft = eventPlanSchema.parse(drafts[0]!.data)
  assert.equal(draft.eventUnits.length, 5)
  assert.deepEqual(draft.eventUnits.flatMap(unit => unit.evidenceRefs), evidenceIds)
  assert.equal(
    result.artifacts.filter(artifact => artifact.type === EVENT_PLAN_ACCEPTED_ARTIFACT).length,
    0,
  )
})
