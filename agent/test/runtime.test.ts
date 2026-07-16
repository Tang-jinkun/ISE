import assert from 'node:assert/strict'
import test from 'node:test'
import { ArtifactStore, FakeModelAdapter, ToolRegistry, type AgentTool } from '@ise/agent-core'
import { SkillRegistry } from '@ise/skills-core'
import {
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  EVENT_PLAN_DRAFT_ARTIFACT,
} from '../src/contracts/artifactTypes.ts'
import { eventPlanSchema, type EventPlan } from '../src/contracts/eventPlan.ts'
import { IseAgentHost } from '../src/runtime/IseAgentHost.ts'
import { IseAgentProfile } from '../src/runtime/IseAgentProfile.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { createEventPlanTools } from '../src/tools/eventPlanTools.ts'

test('ISE host uses the domain profile and completes a natural answer', async () => {
  const model = new FakeModelAdapter([{ content: '已读取当前输入，但还没有可接受的事件计划。' }])
  const host = new IseAgentHost({
    model,
    tools: new ToolRegistry(),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  })

  const result = await host.run('检查当前输入。')

  assert.equal(result.goal.status, 'completed')
  assert.equal(result.turnOutcome?.finalAnswer, '已读取当前输入，但还没有可接受的事件计划。')
  const systemMessage = model.requests[0]?.messages[0]
  assert.equal(systemMessage?.role, 'system')
  assert.match(systemMessage.content, /ISE battle-review scene generation agent/)
  assert.match(systemMessage.content, /EventUnit 描述世界状态变化/)
  assert.equal(IseAgentProfile.id, 'ise-battle-replay-agent')
  assert.match(IseAgentProfile.planningPolicy ?? '', /证据/)
})

test('ISE profile grounds every EventUnit and marks inference uncertainty', () => {
  const planningPolicy = IseAgentProfile.planningPolicy ?? ''

  assert.match(planningPolicy, /每个 EventUnit/)
  assert.match(planningPolicy, /evidenceRefs/)
  assert.match(planningPolicy, /inferenceRefs/)
  assert.match(planningPolicy, /至少一个/)
  assert.match(planningPolicy, /uncertainty/)
})

test('ISE host binds a structured approval to the exact accepted draft tuple', async () => {
  const { artifacts, draft, exactInput } = seededDraft()
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{
        id: 'accept-1',
        name: 'accept_event_plan',
        input: exactInput,
      }],
    },
    { content: 'Event plan accepted.' },
  ])
  const approvals: Array<{ toolName: string; input: unknown }> = []

  const result = await new IseAgentHost({
    model,
    tools: new ToolRegistry(createEventPlanTools()),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    artifacts,
    approve: (toolName, input) => {
      approvals.push({ toolName, input })
      return { decision: 'allow', confirmationId: 'confirm-runtime-accept' }
    },
  }).run('Accept the reviewed event plan.')

  assert.deepEqual(approvals, [{ toolName: 'accept_event_plan', input: exactInput }])
  const accepted = result.artifacts.filter(
    artifact => artifact.type === EVENT_PLAN_ACCEPTED_ARTIFACT,
  )
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0]?.createdBy, 'user')
  assert.equal(accepted[0]?.version, draft.data.version)
  assert.deepEqual({
    confirmationId: accepted[0]?.metadata?.confirmationId,
    draftArtifactId: accepted[0]?.metadata?.acceptedDraftArtifactId,
    version: accepted[0]?.metadata?.version,
    fingerprint: accepted[0]?.metadata?.fingerprint,
  }, {
    confirmationId: 'confirm-runtime-accept',
    draftArtifactId: exactInput.draftArtifactId,
    version: exactInput.version,
    fingerprint: exactInput.fingerprint,
  })
  const acceptDefinition = model.requests[0]?.tools.find(
    definition => definition.name === 'accept_event_plan',
  )
  const properties = acceptDefinition?.inputSchema.properties
  assert.ok(properties && typeof properties === 'object')
  assert.deepEqual(Object.keys(properties), ['draftArtifactId', 'version', 'fingerprint'])
  assert.equal(Object.prototype.hasOwnProperty.call(properties, 'confirmationId'), false)
})

test('ISE host plain allow cannot create an accepted event plan without a binding', async () => {
  const { artifacts, exactInput } = seededDraft()
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{
        id: 'accept-plain',
        name: 'accept_event_plan',
        input: exactInput,
      }],
    },
    { content: 'The event plan was not accepted.' },
  ])

  const result = await new IseAgentHost({
    model,
    tools: new ToolRegistry(createEventPlanTools()),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    artifacts,
    approve: () => 'allow',
  }).run('Accept the reviewed event plan.')

  assert.equal(
    result.artifacts.filter(artifact => artifact.type === EVENT_PLAN_ACCEPTED_ARTIFACT).length,
    0,
  )
  const toolResult = result.messages.find(
    message => message.role === 'tool' && message.toolCallId === 'accept-plain',
  )
  assert.ok(toolResult && toolResult.role === 'tool')
  assert.equal(toolResult.isError, true)
  assert.match(toolResult.content, /trusted user confirmation binding/i)
})

test('ISE host allows more than twelve distinct evidence observations', async () => {
  const inspectTool: AgentTool = {
    name: 'inspect_evidence',
    description: 'Inspect one evidence record',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute(input) {
      return { content: `Evidence ${(input as { index: number }).index}` }
    },
  }
  const model = new FakeModelAdapter([
    ...Array.from({ length: 13 }, (_, index) => ({
      content: '',
      toolCalls: [{ id: String(index), name: 'inspect_evidence', input: { index } }],
    })),
    { content: 'Evidence analysis completed.' },
  ])

  const result = await new IseAgentHost({
    model,
    tools: new ToolRegistry([inspectTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  }).run('Inspect the evidence before producing a plan.')

  assert.equal(result.goal.status, 'completed')
  assert.equal(result.goal.turnCount, 14)
})

function seededDraft(): {
  artifacts: ArtifactStore
  draft: ReturnType<ArtifactStore['create']> & { data: EventPlan }
  exactInput: { draftArtifactId: string; version: number; fingerprint: string }
} {
  const artifacts = new ArtifactStore()
  const plan = eventPlanSchema.parse({
    schemaVersion: 'event-plan/v1',
    planId: 'runtime-plan-1',
    documentId: 'runtime-doc-1',
    version: 1,
    eventUnits: [{
      eventUnitId: 'runtime-event-1',
      title: 'Opening engagement',
      worldStateChange: 'The opposing forces enter active engagement.',
      participants: ['Blue force', 'Red force'],
      locationRefs: ['border'],
      evidenceRefs: ['runtime-evidence-1'],
      inferenceRefs: [],
      uncertainties: [],
      narrativePurpose: 'Establish the engagement.',
      importance: 'high',
    }],
    omittedEvidence: [],
    warnings: [],
  })
  const draftFingerprint = fingerprint(plan)
  const draft = artifacts.create<EventPlan>({
    id: 'runtime-draft-1',
    type: EVENT_PLAN_DRAFT_ARTIFACT,
    version: plan.version,
    createdBy: 'agent',
    logicalKey: `event-plan:${plan.planId}`,
    data: plan,
    metadata: {
      planId: plan.planId,
      documentId: plan.documentId,
      version: plan.version,
      fingerprint: draftFingerprint,
      status: 'draft',
    },
  })
  return {
    artifacts,
    draft,
    exactInput: {
      draftArtifactId: draft.id,
      version: plan.version,
      fingerprint: draftFingerprint,
    },
  }
}
