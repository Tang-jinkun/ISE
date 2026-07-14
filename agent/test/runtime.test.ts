import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeModelAdapter, ToolRegistry } from '@ise/agent-core'
import { SkillRegistry } from '@ise/skills-core'
import { IseAgentHost } from '../src/runtime/IseAgentHost.ts'
import { IseAgentProfile } from '../src/runtime/IseAgentProfile.ts'

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
