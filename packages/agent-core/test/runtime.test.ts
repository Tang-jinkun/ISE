import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SkillRegistry, SkillTool } from '@ise/skills-core'
import {
  AgentRuntime,
  ArtifactStore,
  DomainStateStore,
  FakeModelAdapter,
  PermissionManager,
  ToolRegistry,
  createSkillAgentTool,
  executeToolCall,
  readFileTool,
  updateGoalTool,
  writeFileTool,
  updateTodoListTool,
  type AgentContext,
  type AgentActionEvent,
  type AgentTool,
} from '../src/index.ts'
import { StreamingToolExecutor } from '../src/agent/StreamingToolExecutor.ts'

test('agent proactively selects a skill, acts, and answers naturally', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-'))
  await writeFile(join(workspace, 'note.txt'), 'old content', 'utf8')

  const skills = new SkillRegistry()
  skills.replace([
    {
      name: 'edit-note',
      description: 'Use when updating note.txt',
      instructions: 'Read note.txt, then replace it with the requested content: {{args}}',
      source: 'user',
      allowedTools: ['read_file', 'write_file'],
      userInvocable: true,
      modelInvocable: true,
      execution: 'inline',
      resources: [{
        kind: 'example',
        path: 'examples/edit.md',
        bytes: 21,
      }],
    },
  ])

  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{
        id: '1',
        name: 'skill',
        input: {
          skill: 'edit-note',
          args: 'new content',
          resources: ['examples/edit.md'],
        },
      }],
    },
    {
      content: '',
      toolCalls: [{ id: '2', name: 'read_file', input: { path: 'note.txt' } }],
    },
    {
      content: '',
      toolCalls: [
        {
          id: '3',
          name: 'write_file',
          input: { path: 'note.txt', content: 'new content' },
        },
      ],
    },
    {
      content: 'Updated note.txt',
    },
  ])

  const tools = new ToolRegistry([readFileTool, writeFileTool, updateGoalTool])
  tools.register(
    createSkillAgentTool(new SkillTool(skills), {
      availableTools: () => ['read_file', 'write_file'],
      readResource: (_skill, path) => ({
        kind: 'example',
        path,
        bytes: 21,
        content: '# Edit Example\n',
      }),
    }),
  )

  const result = await new AgentRuntime({
    model,
    tools,
    skills,
    workspace,
    permissions: new PermissionManager({ approve: () => 'allow' }),
  }).run('Update note.txt to new content')

  assert.equal(result.goal.status, 'completed')
  assert.equal(await readFile(join(workspace, 'note.txt'), 'utf8'), 'new content')
  assert.match(model.requests[0]!.messages[0]!.content, /edit-note/)
  assert.doesNotMatch(model.requests[0]!.messages[0]!.content, /Read note\.txt/)
  assert.ok(
    model.requests[1]!.messages.some(
      message => message.role === 'user' && message.hidden && /Read note\.txt/.test(message.content),
    ),
  )
  assert.ok(
    model.requests[1]!.messages.some(
      message => message.role === 'user' && message.hidden && /# Edit Example/.test(message.content),
    ),
  )
  const secondRequestMessages = model.requests[1]!.messages
  const skillToolResultIndex = secondRequestMessages.findIndex(
    message => message.role === 'tool' && message.toolCallId === '1',
  )
  const skillInstructionsIndex = secondRequestMessages.findIndex(
    message => message.role === 'user' && message.hidden,
  )
  assert.ok(skillToolResultIndex >= 0)
  assert.ok(skillInstructionsIndex > skillToolResultIndex)
  assert.deepEqual(
    model.requests[1]!.tools.map(tool => tool.name).sort(),
    ['read_file', 'skill', 'update_goal', 'write_file'].sort(),
  )
})

test('user-selected skill is active before the first model request', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-initial-skill-'))
  await writeFile(join(workspace, 'note.txt'), 'evidence', 'utf8')
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{ id: 'read', name: 'read_file', input: { path: 'note.txt' } }],
    },
    {
      content: 'Read with the selected skill.',
    },
  ])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([readFileTool, writeFileTool]),
    skills: new SkillRegistry(),
    workspace,
    initialSkill: {
      name: 'read-only',
      invocation: 'user',
      args: 'read note.txt',
      instructions: 'Read note.txt and report the evidence.',
      allowedTools: ['read_file'],
      source: 'user',
      execution: 'inline',
      contentHash: 'hash',
    },
  }).run('Read note.txt')

  assert.equal(result.goal.status, 'completed')
  assert.equal(model.requests[0]?.tools.some(tool => tool.name === 'read_file'), true)
  assert.equal(model.requests[0]?.tools.some(tool => tool.name === 'write_file'), true)
  assert.equal(
    model.requests[0]?.messages.some(message =>
      message.role === 'user' &&
      message.content.includes('[Active user-selected skill: read-only]')
    ),
    true,
  )
})

test('runtime uses default software profile unless an explicit profile is supplied', async () => {
  const defaultModel = new FakeModelAdapter([
    {
      content: 'done',
    },
  ])
  await new AgentRuntime({
    model: defaultModel,
    tools: new ToolRegistry(),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  }).run('Check default profile')

  assert.match(
    defaultModel.requests[0]?.messages[0]?.content ?? '',
    /autonomous software agent operating inside a restricted workspace/,
  )
  assert.match(
    defaultModel.requests[0]?.messages[0]?.content ?? '',
    /Use Simplified Chinese for all user-visible narration/,
  )

  const customModel = new FakeModelAdapter([
    {
      content: 'done',
    },
  ])
  await new AgentRuntime({
    model: customModel,
    tools: new ToolRegistry(),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    profile: {
      id: 'test-profile',
      rolePrompt: 'You are a domain-specific test agent.',
      planningPolicy: '- Keep domain facts grounded.',
      toolUsePolicy: '- Use only visible domain tools.',
      completionPolicy: '- Answer naturally when the objective is complete.',
      narrationPolicy: '- Narrate briefly.',
    },
  }).run('Check custom profile')

  const systemPrompt = customModel.requests[0]?.messages[0]?.content ?? ''
  assert.match(systemPrompt, /domain-specific test agent/)
  assert.match(systemPrompt, /Keep domain facts grounded/)
  assert.doesNotMatch(systemPrompt, /autonomous software agent operating inside a restricted workspace/)
  assert.doesNotMatch(systemPrompt, /Use Simplified Chinese for all user-visible narration/)
})

test('runtime lets the model progressively update todo for complex work', async () => {
  const model = new FakeModelAdapter([
    {
      content: 'This has multiple steps, so I will track the work before acting.',
      toolCalls: [{
        id: 'todo-1',
        name: 'update_todo_list',
        input: {
          items: [
            { content: 'Inspect available evidence', activeForm: 'Inspecting available evidence', status: 'in_progress' },
            { content: 'Assess the requested action', activeForm: 'Assessing the requested action', status: 'pending' },
            { content: 'Summarize the supported next step', activeForm: 'Summarizing the supported next step', status: 'pending' },
          ],
        },
      }],
    },
    {
      content: 'Evidence has been inspected, so I will advance the checklist.',
      toolCalls: [{
        id: 'todo-2',
        name: 'update_todo_list',
        input: {
          items: [
            { content: 'Inspect available evidence', activeForm: 'Inspecting available evidence', status: 'completed' },
            { content: 'Assess the requested action', activeForm: 'Assessing the requested action', status: 'in_progress' },
            { content: 'Summarize the supported next step', activeForm: 'Summarizing the supported next step', status: 'pending' },
          ],
        },
      }],
    },
    {
      content: 'The work is complete.',
    },
  ])

  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([updateTodoListTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  }).run('Inspect evidence, assess the action, and summarize the next step')

  assert.equal(result.goal.status, 'completed')
  assert.deepEqual(
    (result.domainState.agentTodoList as Array<{ status: string }>).map(item => item.status),
    ['completed', 'in_progress', 'pending'],
  )
})

test('runtime can answer simple work without creating todo state', async () => {
  const model = new FakeModelAdapter([
    {
      content: 'Simple answer.',
    },
  ])

  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([updateTodoListTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  }).run('What is 1+1?')

  assert.equal(result.goal.status, 'completed')
  assert.equal(result.domainState.agentTodoList, undefined)
  assert.equal(model.requests[0]?.tools.some(tool => tool.name === 'update_todo_list'), true)
})

test('direct tool executor applies the same tool result contract as runtime', async () => {
  const artifacts = new ArtifactStore()
  const domainState = new DomainStateStore({ phase: 'before' })
  const events: string[] = []
  const context: AgentContext = {
    workspace: process.cwd(),
    goal: {
      objective: 'direct',
      status: 'active' as const,
      turnCount: 1,
      maxTurns: 1,
      evidence: [],
      remainingIssues: [],
      startedAt: new Date().toISOString(),
    },
    artifacts,
    domainState,
    lastConsumedConfirmationId: 'confirm-1',
  }
  const tool: AgentTool = {
    name: 'direct_contract_tool',
    description: 'test direct execution',
    risk: 'write',
    inputSchema: { type: 'object' },
    persistResultAboveBytes: 8,
    async execute(_input, _context, onProgress) {
      onProgress?.({ message: 'halfway', percentage: 50 })
      return {
        content: '0123456789abcdef',
        artifacts: [{
          type: 'direct-artifact',
          createdBy: 'user',
          data: { ok: true },
          metadata: { confirmationId: 'confirm-1' },
        }],
        statePatch: { phase: 'after' },
        diagnostics: [{ code: 'DIRECT_INFO', message: 'direct diagnostic', severity: 'info' }],
        hiddenMessages: [{ role: 'user', hidden: true, content: 'hidden instruction' }],
        goalUpdate: { progress: 'direct progress' },
      }
    },
  }

  const result = await executeToolCall({
    tool,
    call: { id: 'call-1', name: tool.name, input: { a: 1 } },
    context,
    runId: 'run-direct',
    turn: 1,
    eventSink: { emit: async event => { events.push(event.eventType) } },
  })

  assert.equal(result.messages.some(message => message.role === 'tool' && !message.isError), true)
  assert.equal(result.messages.some(message => message.role === 'user' && message.hidden), true)
  assert.equal(artifacts.list('direct-artifact')[0]?.createdBy, 'user')
  assert.equal(artifacts.list('tool-result').length, 1)
  assert.equal(domainState.snapshot().phase, 'after')
  assert.equal(context.goal.progress, 'direct progress')
  assert.ok(events.includes('tool.started'))
  assert.ok(events.includes('tool.progress'))
  assert.ok(events.includes('artifact.created'))
  assert.ok(events.includes('state.changed'))
  assert.ok(events.includes('diagnostic.created'))
  assert.ok(events.includes('tool.completed'))
})

test('prepared tool input is used consistently for permission, audit, and execution', async () => {
  const observed: {
    permission?: unknown
    event?: unknown
    execution?: unknown
  } = {}
  const context: AgentContext = {
    workspace: process.cwd(),
    goal: {
      objective: 'execute with grounded input',
      status: 'active',
      turnCount: 1,
      maxTurns: 1,
      evidence: [],
      remainingIssues: [],
      startedAt: new Date().toISOString(),
    },
    artifacts: new ArtifactStore(),
    domainState: new DomainStateStore(),
  }
  const tool: AgentTool = {
    name: 'grounded_write',
    description: 'test prepared input boundary',
    risk: 'write',
    inputSchema: { type: 'object' },
    async execute(input) {
      observed.execution = input
      return { content: 'done' }
    },
  }

  const result = await executeToolCall({
    tool,
    call: {
      id: 'grounded-write-1',
      name: tool.name,
      input: { specificDate: '2026-06-10' },
    },
    prepareInput: (_tool, input) => ({
      ...(input as Record<string, unknown>),
      specificDate: '2026-06-09',
    }),
    guard: {
      check: async (_tool, input) => {
        observed.permission = input
        return 'allow'
      },
    },
    context,
    runId: 'run-grounded-write',
    turn: 1,
    eventSink: {
      emit: async event => {
        if (event.eventType === 'tool.started') observed.event = event.data?.input
      },
    },
  })

  const expected = { specificDate: '2026-06-09' }
  assert.equal(result.outcome, 'completed')
  assert.deepEqual(observed.permission, expected)
  assert.deepEqual(observed.event, expected)
  assert.deepEqual(observed.execution, expected)
})

test('runtime emits recovery options without tool prescriptions for missing facts', async () => {
  const context: AgentContext = {
    workspace: process.cwd(),
    goal: {
      objective: 'inspect before acting',
      status: 'active',
      turnCount: 1,
      maxTurns: 1,
      evidence: [],
      remainingIssues: [],
      startedAt: new Date().toISOString(),
    },
    artifacts: new ArtifactStore(),
    domainState: new DomainStateStore(),
  }
  const tool: AgentTool = {
    name: 'guarded_read',
    description: 'Guarded read',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      return { content: 'unreachable' }
    },
  }

  const result = await executeToolCall({
    tool,
    call: { id: 'guarded-read-1', name: tool.name, input: {} },
    context,
    runId: 'run-guarded-read',
    turn: 1,
    guard: {
      check: async () => ({
        decision: 'deny',
        reason: 'missing_facts',
        message: 'Current facts are missing.',
      }),
    },
  })

  const denial = JSON.parse(result.messages.find(message => message.role === 'tool')?.content ?? '{}')
  assert.equal(denial.reason, 'missing_facts')
  assert.equal(denial.recoveryOptions.some((option: { tool?: string }) => option.tool), false)
})

test('reloading the active inline skill is idempotent', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-skill-repeat-'))
  const skills = new SkillRegistry()
  skills.replace([
    {
      name: 'inspect-request',
      description: 'Inspect with read tools',
      instructions: 'Inspect the current request before answering.',
      source: 'user',
      allowedTools: ['read_file'],
      userInvocable: true,
      modelInvocable: true,
      execution: 'inline',
    },
  ])

  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{ id: '1', name: 'skill', input: { skill: 'inspect-request' } }],
    },
    {
      content: '',
      toolCalls: [{ id: '2', name: 'skill', input: { skill: 'inspect-request' } }],
    },
    {
      content: 'Finished with the active skill.',
    },
  ])

  const tools = new ToolRegistry()
  tools.register(
    createSkillAgentTool(new SkillTool(skills), {
      availableTools: () => ['read_file'],
    }),
  )

  const result = await new AgentRuntime({
    model,
    tools,
    skills,
    workspace,
  }).run('Inspect the request')

  assert.equal(result.goal.status, 'completed')
  assert.ok(
    model.requests[2]!.messages.some(
      message =>
        message.role === 'tool' &&
        message.toolCallId === '2' &&
        /already active/.test(message.content),
    ),
  )
})

test('active skill records allowed tools without hiding the ambient tool surface', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-scope-'))
  const skills = new SkillRegistry()
  skills.replace([
    {
      name: 'read-only',
      description: 'Read-only inspection',
      instructions: 'Only inspect.',
      source: 'user',
      allowedTools: ['read_file'],
      userInvocable: true,
      modelInvocable: true,
      execution: 'inline',
    },
  ])
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{ id: '1', name: 'skill', input: { skill: 'read-only' } }],
    },
    {
      content: '',
      toolCalls: [{ id: '2', name: 'write_file', input: { path: 'x.txt', content: 'x' } }],
    },
    {
      content: 'Write allowed by normal permissions.',
    },
  ])
  const tools = new ToolRegistry([readFileTool, writeFileTool])
  tools.register(
    createSkillAgentTool(new SkillTool(skills), {
      availableTools: () => ['read_file', 'write_file'],
    }),
  )

  const result = await new AgentRuntime({
    model,
    tools,
    skills,
    workspace,
    permissions: new PermissionManager({ approve: () => 'allow' }),
  }).run('Try a forbidden write')

  assert.equal(result.goal.status, 'completed')
  assert.equal(await readFile(join(workspace, 'x.txt'), 'utf8'), 'x')
  assert.equal(model.requests[1]!.tools.some(tool => tool.name === 'write_file'), true)
  assert.equal(
    result.messages.some(
      message => message.role === 'tool' &&
        message.content.includes('"type":"tool_denial"'),
    ),
    false,
  )
})

test('tool surface provider can advertise a refreshed domain tool while a skill is active', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-surface-skill-'))
  const skills = new SkillRegistry()
  skills.replace([
    {
      name: 'inspect-only',
      description: 'Inspect-only skill',
      instructions: 'Inspect only through the current business surface.',
      source: 'user',
      allowedTools: ['read_file'],
      userInvocable: true,
      modelInvocable: true,
      execution: 'inline',
    },
  ])
  const inspectDataTool: AgentTool = {
    name: 'inspect_data',
    description: 'Inspect data',
    risk: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async execute() {
      return { content: 'inspected' }
    },
  }
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{ id: '1', name: 'skill', input: { skill: 'inspect-only' } }],
    },
    {
      content: 'Visible surface inspected.',
    },
  ])
  const tools = new ToolRegistry([inspectDataTool])
  tools.register(
    createSkillAgentTool(new SkillTool(skills), {
      availableTools: () => ['read_file', 'inspect_data'],
    }),
  )

  await new AgentRuntime({
    model,
    tools,
    skills,
    workspace,
    toolSurfaceProvider: {
      visibleTools: (_context, visibleTools) => visibleTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        metadata: {},
      })),
    },
  }).run('Inspect current data')

  assert.equal(model.requests[1]?.tools.some(tool => tool.name === 'inspect_data'), true)
})

test('runtime completes naturally when assistant answers without tool calls', async () => {
  const model = new FakeModelAdapter([{ content: '已经根据当前证据完成回答。' }])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry(),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    maxTurns: 4,
  }).run('Answer directly')

  assert.equal(result.goal.status, 'completed')
  assert.equal(result.goal.finalSummary, '已经根据当前证据完成回答。')
  assert.ok(result.turnOutcome)
  assert.equal(result.turnOutcome.status, 'completed')
  assert.equal(result.turnOutcome.finalAnswer, '已经根据当前证据完成回答。')
  assert.equal(model.requests.length, 1)
})

test('runtime steers after an empty no-tool response and then completes naturally', async () => {
  const model = new FakeModelAdapter([
    { content: '' },
    { content: '现在直接回答用户。' },
  ])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry(),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    maxTurns: 3,
  }).run('Answer after steering')

  assert.equal(result.goal.status, 'completed')
  assert.equal(result.goal.finalSummary, '现在直接回答用户。')
  assert.equal(model.requests.length, 2)
  assert.ok(model.requests[1]?.messages.some(message =>
    message.role === 'user' && message.content.includes('继续推进当前目标')
  ))
})

test('runtime fails safely when max turns are reached', async () => {
  const model = new FakeModelAdapter([{ content: '' }])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry(),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    maxTurns: 1,
  }).run('Never-ending goal')

  assert.equal(result.goal.status, 'failed')
  assert.match(result.goal.remainingIssues[0]!, /maximum turns/)
  assert.equal(result.diagnostics[0]?.code, 'AGENT_MAX_TURNS_REACHED')
})

test('runtime stops consecutive identical tool-call loops before max turns', async () => {
  const validateTool: AgentTool = {
    name: 'validate_submission',
    description: 'Validate the current submission',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      return { content: 'Validation passed' }
    },
  }
  const repeatedResponse = {
    content: 'Validating',
    toolCalls: [
      {
        id: 'ignored-by-loop-signature',
        name: 'validate_submission',
        input: { modelId: 'example' },
      },
    ],
  }
  const model = new FakeModelAdapter(Array.from({ length: 20 }, () => repeatedResponse))
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([validateTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    maxTurns: 20,
    maxRepeatedToolCalls: 3,
  }).run('Validate the binding once')

  assert.equal(result.goal.status, 'failed')
  assert.equal(result.goal.turnCount, 3)
  assert.equal(result.diagnostics[0]?.code, 'AGENT_REPEATED_TOOL_CALL_LOOP')
  assert.match(result.goal.remainingIssues[0]!, /validate_submission/)
  assert.equal(
    result.transcript.filter(event => event.type === 'tool_call').length,
    2,
    'the repeated call that triggers the guard must not execute',
  )
})

test('runtime stops a repeated multi-tool cycle before max turns', async () => {
  const tools = ['inspect_inputs', 'validate_submission'].map<AgentTool>(name => ({
    name,
    description: name,
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      return { content: `${name} completed` }
    },
  }))
  const model = new FakeModelAdapter(
    Array.from({ length: 20 }, (_, index) => ({
      content: '',
      toolCalls: [{
        id: String(index),
        name: tools[index % tools.length]!.name,
        input: { modelId: 'example' },
      }],
    })),
  )
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry(tools),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    maxTurns: 20,
    maxRepeatedToolCalls: 3,
  }).run('Validate the binding once')

  assert.equal(result.goal.status, 'failed')
  // Diminishing-returns (4 no-artifact turns) fires before cycle detection (6 turns).
  assert.equal(result.goal.turnCount, 4)
  assert.equal(result.diagnostics[0]?.code, 'AGENT_NO_PROGRESS')
})

test('runtime stops one tool after three varied failures without progress', async () => {
  const failingTool: AgentTool = {
    name: 'submit_report',
    description: 'Submit a report',
    risk: 'control',
    inputSchema: { type: 'object' },
    async execute() {
      throw new Error('Required evidence is incomplete')
    },
  }
  const model = new FakeModelAdapter(
    Array.from({ length: 10 }, (_, index) => ({
      content: '',
      toolCalls: [{
        id: String(index),
        name: 'submit_report',
        input: { attempt: index },
      }],
    })),
  )
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([failingTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    maxTurns: 10,
  }).run('Submit the report')

  assert.equal(result.goal.status, 'failed')
  assert.equal(result.goal.turnCount, 3)
  assert.equal(result.diagnostics[0]?.code, 'AGENT_TOOL_FAILURE_LOOP')
  assert.match(result.goal.remainingIssues[0]!, /failed 3 consecutive times/)
})

test('runtime steers the model after an empty required tool input fails', async () => {
  let sawSteering = false
  const submitTool: AgentTool = {
    name: 'submit_report',
    description: 'Submit a report',
    risk: 'control',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['reportId'],
      properties: { reportId: { type: 'string' } },
    },
    async execute(input) {
      if (!(input as { reportId?: unknown }).reportId) throw new Error('reportId is required')
      return { content: 'submitted' }
    },
  }
  const model = {
    async complete(request: Parameters<FakeModelAdapter['complete']>[0]) {
      sawSteering ||= request.messages.some(message =>
        message.role === 'user' &&
        message.hidden === true &&
        /Required arguments\/schema/.test(message.content)
      )
      return sawSteering
        ? { content: '', toolCalls: [{ id: '2', name: 'submit_report', input: { reportId: 'report-1' } }] }
        : { content: '', toolCalls: [{ id: '1', name: 'submit_report', input: {} }] }
    },
  }

  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([submitTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    maxTurns: 3,
  }).run('Submit the report')

  assert.equal(sawSteering, true)
  assert.equal(result.messages.some(message =>
    message.role === 'user' &&
    message.hidden === true &&
    /reportId/.test(message.content)
  ), true)
  assert.equal(result.messages.some(message => message.role === 'tool' && message.content === 'submitted'), true)
})

test('runtime pauses when tool permission is deferred', async () => {
  const model = new FakeModelAdapter([
    { content: '', toolCalls: [{ id: '1', name: 'write_file', input: { path: 'x', content: 'y' } }] },
  ])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([writeFileTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    permissions: new PermissionManager({ approve: () => 'defer' }),
  }).run('Write a file after confirmation')

  assert.equal(result.goal.status, 'blocked')
  assert.match(result.goal.remainingIssues[0]!, /requires user confirmation/)
})

test('runtime refuses a registered tool hidden by the workflow filter', async () => {
  let executed = false
  const hiddenTool: AgentTool = {
    name: 'hidden_execute',
    description: 'Hidden execution tool',
    risk: 'control',
    inputSchema: { type: 'object' },
    async execute() {
      executed = true
      return { content: 'executed' }
    },
  }
  const model = new FakeModelAdapter([
    { content: '', toolCalls: [{ id: '1', name: 'hidden_execute', input: {} }] },
    { content: 'Hidden tool unavailable.' },
  ])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([hiddenTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    toolFilter: () => false,
  }).run('Do not execute hidden tools')

  assert.equal(executed, false)
  assert.equal(result.goal.status, 'completed')
  const denial = JSON.parse(result.messages.find(message => message.role === 'tool')?.content ?? '{}')
  assert.equal(denial.type, 'tool_denial')
  assert.equal(denial.reason, 'tool_filter_denied')
  assert.equal(denial.tool, 'hidden_execute')
  assert.deepEqual(denial.recoveryOptions.map((option: { code: string }) => option.code), [
    'use_current_surface',
    'explain_supported_status',
  ])
  assert.equal(denial.recoveryOptions.some((option: { tool?: string }) => option.tool), false)
})

test('streaming executor denies registered tools omitted from the model-visible surface without a guard', async () => {
  let executed = false
  const hiddenTool: AgentTool = {
    name: 'hidden_execute',
    description: 'Hidden execution tool',
    risk: 'execute',
    inputSchema: { type: 'object' },
    async execute() {
      executed = true
      return { content: 'executed' }
    },
  }
  const context: AgentContext = {
    workspace: process.cwd(),
    goal: {
      objective: 'executor hidden tool test',
      status: 'active',
      turnCount: 1,
      maxTurns: 1,
      evidence: [],
      remainingIssues: [],
      startedAt: new Date().toISOString(),
    },
    artifacts: new ArtifactStore(),
    domainState: new DomainStateStore({}),
  }
  const executor = new StreamingToolExecutor(
    new ToolRegistry([hiddenTool]),
    context,
    undefined,
    'run-hidden-tool',
    1,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [{
      name: 'visible_status',
      description: 'Visible tool status surface',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    }],
  )

  executor.addTool({ id: 'hidden-1', name: 'hidden_execute', input: {} })
  await executor.flush()
  const messages = [...executor.getCompletedResults()]
  const denial = JSON.parse(messages.find(message => message.role === 'tool')?.content ?? '{}')

  assert.equal(executed, false)
  assert.equal(denial.type, 'tool_denial')
  assert.equal(denial.tool, 'hidden_execute')
  assert.equal(denial.reason, 'not_in_current_tool_surface')
  assert.deepEqual(denial.recoveryOptions.map((option: { code: string }) => option.code), [
    'use_current_surface',
    'explain_supported_status',
  ])
  assert.equal(denial.recoveryOptions.some((option: { tool?: string }) => option.tool), false)
})

test('streaming executor unknown-tool denial recovery options do not name tools', async () => {
  const context: AgentContext = {
    workspace: process.cwd(),
    goal: {
      objective: 'executor unknown tool test',
      status: 'active',
      turnCount: 1,
      maxTurns: 1,
      evidence: [],
      remainingIssues: [],
      startedAt: new Date().toISOString(),
    },
    artifacts: new ArtifactStore(),
    domainState: new DomainStateStore({}),
  }
  const executor = new StreamingToolExecutor(
    new ToolRegistry(),
    context,
    undefined,
    'run-unknown-tool',
    1,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [{
      name: 'visible_status',
      description: 'Visible tool status surface',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    }],
  )

  executor.addTool({ id: 'unknown-1', name: 'result_ready', input: {} })
  await executor.flush()
  const messages = [...executor.getCompletedResults()]
  const denial = JSON.parse(messages.find(message => message.role === 'tool')?.content ?? '{}')

  assert.equal(denial.type, 'tool_denial')
  assert.equal(denial.tool, 'result_ready')
  assert.equal(denial.reason, 'not_in_current_tool_surface')
  assert.deepEqual(denial.recoveryOptions.map((option: { code: string }) => option.code), [
    'use_current_surface',
    'explain_supported_status',
  ])
  assert.equal(denial.recoveryOptions.some((option: { tool?: string }) => option.tool), false)
})

test('streaming executor does not cancel queued siblings for continuity-only refresh markers', async () => {
  let releaseFirstTool!: () => void
  const firstStarted = new Promise<void>(resolveStarted => {
    releaseFirstTool = resolveStarted
  })
  const executionOrder: string[] = []
  const context: AgentContext = {
    workspace: process.cwd(),
    goal: {
      objective: 'executor refresh marker test',
      status: 'active',
      turnCount: 1,
      maxTurns: 1,
      evidence: [],
      remainingIssues: [],
      startedAt: new Date().toISOString(),
    },
    artifacts: new ArtifactStore(),
    domainState: new DomainStateStore({}),
  }
  const continuityOnlyTool: AgentTool = {
    name: 'continuity_only',
    description: 'Updates continuity only',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      executionOrder.push('continuity_only')
      await firstStarted
      return {
        content: 'continuity changed',
        statePatch: {
          _toolSurfaceRefreshRequired: {
            reason: 'business_continuity_changed',
            createdAt: new Date().toISOString(),
          },
        },
      }
    },
  }
  const siblingTool: AgentTool = {
    name: 'valid_sibling',
    description: 'Valid sibling work',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      executionOrder.push('valid_sibling')
      return { content: 'sibling executed' }
    },
  }
  const executor = new StreamingToolExecutor(
    new ToolRegistry([continuityOnlyTool, siblingTool]),
    context,
    undefined,
    'run-continuity-marker',
    1,
  )

  executor.addTool({ id: 'continuity-1', name: 'continuity_only', input: {} })
  executor.addTool({ id: 'sibling-1', name: 'valid_sibling', input: {} })
  releaseFirstTool()
  await executor.flush()
  const messages = [...executor.getCompletedResults()]

  assert.deepEqual(executionOrder, ['continuity_only', 'valid_sibling'])
  assert.equal(messages.some(message =>
    message.role === 'tool' &&
    message.toolCallId === 'sibling-1' &&
    message.isError
  ), false)
  assert.equal(messages.some(message =>
    message.role === 'tool' &&
    message.toolCallId === 'sibling-1' &&
    message.content === 'sibling executed'
  ), true)
})

test('runtime can expose a dynamic tool surface provider', async () => {
  const inspectTool: AgentTool = {
    name: 'inspect_data',
    description: 'Inspect data',
    risk: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async execute() {
      return { content: 'inspected' }
    },
  }
  const hiddenTool: AgentTool = {
    name: 'hidden_write',
    description: 'Hidden write',
    risk: 'write',
    inputSchema: { type: 'object' },
    async execute() {
      return { content: 'wrote' }
    },
  }
  const model = new FakeModelAdapter([
    { content: '', toolCalls: [{ id: '1', name: 'inspect_data', input: {} }] },
    { content: 'Done' },
  ])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([inspectTool, hiddenTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    toolSurfaceProvider: {
      visibleTools: (_context, tools) => tools
        .filter(tool => tool.name === 'inspect_data')
        .map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          metadata: { reason: 'test-surface' },
        })),
      visibility: tool => tool.name === 'inspect_data'
        ? { visible: true, reason: 'visible' }
        : {
            visible: false,
            reason: 'policy_denied',
            message: `${tool.name} is outside the test surface.`,
            recoveryHint: 'Use inspect_data or explain the supported status.',
          },
    },
  }).run('Inspect data')

  assert.equal(result.goal.status, 'completed')
  assert.deepEqual(model.requests[0]?.tools.map(tool => tool.name).sort(), ['inspect_data'])
  assert.equal(model.requests[0]?.tools.some(tool => tool.name === 'hidden_write'), false)
})

test('runtime tool surface provider resolves model-facing view calls to underlying tools', async () => {
  const underlyingCalls: unknown[] = []
  const events: AgentActionEvent[] = []
  const underlyingTool: AgentTool = {
    name: 'underlying_fetch',
    description: 'Underlying fetch',
    risk: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['sceneId'],
      properties: {
        sceneId: { type: 'string' },
        userQuery: { type: 'string' },
      },
    },
    async execute(input) {
      underlyingCalls.push(input)
      return { content: JSON.stringify({ input }) }
    },
  }
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{
        id: 'view-1',
        name: 'fetch_current_scene',
        input: { sceneId: 'model-supplied-scene', userQuery: 'status' },
      }],
    },
    {
      content: 'Done',
    },
  ])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([underlyingTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    toolSurfaceProvider: {
      visibleTools: () => [{
        name: 'fetch_current_scene',
        description: 'Fetch current scene',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { userQuery: { type: 'string' } },
        },
      }],
      visibility: tool => ({ visible: tool.name === 'fetch_current_scene', reason: 'visible' }),
      resolveToolCall: (call, _context, registry) => {
        if (call.name !== 'fetch_current_scene') return undefined
        const tool = registry.resolve('underlying_fetch')
        assert.ok(tool)
        const input = call.input && typeof call.input === 'object' && !Array.isArray(call.input)
          ? call.input as Record<string, unknown>
          : {}
        return {
          tool: {
            ...tool,
            name: 'fetch_current_scene',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: { userQuery: { type: 'string' } },
            },
            async execute(effectiveInput, context, onProgress) {
              return tool.execute(effectiveInput, context, onProgress)
            },
          },
          call: {
            ...call,
            input: {
              ...input,
              sceneId: 'fixed-scene',
            },
          },
          metadata: {
            surfaceId: 'surface-1',
            surfaceRevision: 7,
            workpointId: 'workpoint-1',
            viewName: 'fetch_current_scene',
            underlyingTool: 'underlying_fetch',
            effectiveInput: {
              ...input,
              sceneId: 'fixed-scene',
            },
          },
        }
      },
    },
    eventSink: {
      emit: async event => { events.push(event) },
    },
  }).run('Fetch current scene')

  assert.equal(result.goal.status, 'completed')
  assert.deepEqual(model.requests[0]?.tools.map(tool => tool.name).sort(), ['fetch_current_scene'])
  assert.deepEqual(underlyingCalls, [{ sceneId: 'fixed-scene', userQuery: 'status' }])
  const started = events.find(event => event.eventType === 'tool.started' && event.toolCallId === 'view-1')
  assert.equal(started?.data?.tool, 'fetch_current_scene')
  assert.deepEqual((started?.data?.toolCallMetadata as { viewName?: unknown; underlyingTool?: unknown; effectiveInput?: unknown } | undefined), {
    surfaceId: 'surface-1',
    surfaceRevision: 7,
    workpointId: 'workpoint-1',
    viewName: 'fetch_current_scene',
    underlyingTool: 'underlying_fetch',
    effectiveInput: {
      sceneId: 'fixed-scene',
      userQuery: 'status',
    },
  })
})

test('runtime toolFilter still limits dynamic tool surface provider visibility', async () => {
  const hiddenTool: AgentTool = {
    name: 'hidden_read',
    description: 'Hidden read',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      return { content: 'hidden' }
    },
  }
  const model = new FakeModelAdapter([
    { content: 'Done' },
  ])

  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([hiddenTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    toolFilter: tool => tool.name !== 'hidden_read',
    toolSurfaceProvider: {
      visibleTools: (_context, tools) => tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        metadata: { reason: 'provider' },
      })),
      visibility: tool => tool.name === 'hidden_read'
        ? { visible: true, reason: 'visible' }
        : { visible: true, reason: 'visible' },
    },
  }).run('Answer')

  assert.equal(result.goal.status, 'completed')
  assert.deepEqual(model.requests[0]?.tools.map(tool => tool.name), [])
})

test('update_goal records progress without terminating the objective', async () => {
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{
        id: '1',
        name: 'update_goal',
        input: { progress: 'Submitting report', nextStep: 'Submit it' },
      }],
    },
    {
      content: 'Report submitted',
    },
  ])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([updateGoalTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  }).run('Submit a report')

  assert.equal(result.goal.status, 'completed')
  assert.equal(result.goal.progress, 'Submitting report')
  assert.equal(result.goal.finalSummary, 'Report submitted')
  assert.equal(result.turnOutcome?.status, 'completed')
  assert.equal(result.turnOutcome?.finalAnswer, 'Report submitted')
  assert.equal(result.turnOutcome?.metadata?.goalStatus, 'completed')
})

test('runtime retries one natural answer when final answer guard rejects the summary', async () => {
  const model = new FakeModelAdapter([
    {
      content: 'SceneRepo persistence complete',
    },
    {
      content: '当前场景中共有 159 个 ADE。',
    },
  ])

  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry(),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    finalAnswerGuard: answer => /SceneRepo/i.test(answer)
      ? { ok: false, reason: '答案包含内部术语。' }
      : { ok: true },
  }).run('Answer the user question')

  assert.equal(result.goal.status, 'completed')
  assert.equal(result.goal.finalSummary, '当前场景中共有 159 个 ADE。')
  assert.equal(result.turnOutcome?.finalAnswer, '当前场景中共有 159 个 ADE。')
  assert.ok(result.messages.some(message =>
    message.role === 'user' &&
    message.hidden === true &&
    message.content.includes('不适合直接展示给用户')
  ))
})

test('runtime persists tool artifacts, domain state patches, and diagnostics', async () => {
  const inspectDataTool: AgentTool = {
    name: 'inspect_data',
    description: 'Inspect a data asset',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      return {
        content: 'Inspected data record',
        artifacts: [
          {
            id: 'record-card',
            type: 'data-card',
            createdBy: 'tool',
            data: { assetType: 'record', sampledValues: [1, 2] },
          },
        ],
        statePatch: {
          phase: 'inputs-reviewed',
          items: { primary: { status: 'candidate-found', artifactId: 'record-card' } },
        },
        diagnostics: [
          {
            code: 'VALUES_SAMPLED',
            message: 'Sampled two values',
            severity: 'info',
            relatedArtifactIds: ['record-card'],
          },
        ],
      }
    },
  }
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{ id: '1', name: 'inspect_data', input: {} }],
    },
    {
      content: 'Inspected data',
    },
  ])

  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([inspectDataTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  }).run('Inspect the available data')

  assert.equal(result.artifacts[0]?.id, 'record-card')
  assert.deepEqual(result.domainState, {
    phase: 'inputs-reviewed',
    items: { primary: { status: 'candidate-found', artifactId: 'record-card' } },
  })
  assert.equal(result.diagnostics[0]?.code, 'VALUES_SAMPLED')
  assert.ok(result.transcript.some(event => event.type === 'artifact'))
  assert.ok(result.transcript.some(event => event.type === 'state'))
  assert.ok(result.transcript.some(event => event.type === 'diagnostic'))
})

test('runtime emits auditable action events without exposing sensitive tool input', async () => {
  const events: Array<{ eventType: string; data?: Record<string, unknown> }> = []
  const inspectTool: AgentTool = {
    name: 'inspect_data',
    description: 'Inspect data',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      return { content: 'Inspection completed' }
    },
  }
  const model = new FakeModelAdapter([
    {
      content: '',
      toolCalls: [{ id: '1', name: 'inspect_data', input: { path: 'input.dat', apiKey: 'secret' } }],
    },
    {
      content: 'Done',
    },
  ])

  await new AgentRuntime({
    model,
    tools: new ToolRegistry([inspectTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    eventSink: { emit: async event => { events.push(event) } },
  }).run('Inspect the data')

  assert.deepEqual(
    events.filter(event => event.eventType.startsWith('tool.')).map(event => event.eventType),
    ['tool.started', 'tool.completed'],
  )
  const input = events.find(event => event.eventType === 'tool.started')?.data?.input as Record<string, unknown>
  assert.equal(input.apiKey, '[redacted]')
  assert.equal(events.at(-1)?.eventType, 'run.completed')
})

// ── P0 Regression Tests ──────────────────────────────────────────────────────
// These tests guard the runtime execution contract fixed in
// fix/runtime-execution-contract.  See docs/suggestion0609.md for context.

test('P0: hidden tool cannot execute even if model guesses its name', async () => {
  // The model asks for 'secret_admin' which is registered but filtered out by
  // toolFilter.  The executor must re-check visibility at execution time and
  // deny it — even though the tool exists in the registry.
  let secretExecuted = false
  const secretTool: AgentTool = {
    name: 'secret_admin',
    description: 'Admin-only tool',
    risk: 'execute',
    inputSchema: { type: 'object' },
    async execute() {
      secretExecuted = true
      return { content: 'admin action taken' }
    },
  }
  const model = new FakeModelAdapter([
    // Model guesses the hidden tool name
    { content: '', toolCalls: [{ id: '1', name: 'secret_admin', input: {} }] },
    { content: 'Hidden tool unavailable.' },
  ])
  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([secretTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    toolFilter: () => false,
  }).run('Try to guess the hidden tool')

  assert.equal(secretExecuted, false, 'Hidden tool must not execute')
  assert.ok(
    result.messages.some(m => m.role === 'tool' && m.content.includes('"type":"tool_denial"')),
    'Tool result should return a structured denial',
  )
})

test('P0: skill activation preserves normal permission handling for subsequent turns', async () => {
  // The read-only skill declares read_file as its preferred/preauthorized tool.
  // After activation, write_file remains available and normal permissions decide
  // whether it may execute.
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-skill-permission-'))
  const skills = new SkillRegistry()
  skills.replace([{
    name: 'read-only',
    description: 'Read-only inspection',
    instructions: 'Only inspect files.',
    source: 'user',
    allowedTools: ['read_file'],
    userInvocable: true,
    modelInvocable: true,
    execution: 'inline',
  }])

  let writeFileExecuted = false
  const guardedWriteFile: AgentTool = {
    ...writeFileTool,
    async execute(input, context) {
      writeFileExecuted = true
      return writeFileTool.execute(input, context)
    },
  }

  const model = new FakeModelAdapter([
    // Turn 1: activate the skill
    { content: '', toolCalls: [{ id: '1', name: 'skill', input: { skill: 'read-only' } }] },
    // Turn 2: try to write (outside the skill's declared tools)
    { content: '', toolCalls: [{ id: '2', name: 'write_file', input: { path: 'x.txt', content: 'bad' } }] },
    // Turn 3: answer naturally
    { content: 'Write handled by permission policy.' },
  ])

  const tools = new ToolRegistry([readFileTool, guardedWriteFile])
  tools.register(createSkillAgentTool(new SkillTool(skills), {
    availableTools: () => ['read_file', 'write_file'],
  }))

  const result = await new AgentRuntime({
    model,
    tools,
    skills,
    workspace,
    permissions: new PermissionManager({ approve: () => 'allow' }),
  }).run('Inspect files with read-only skill')

  assert.equal(result.goal.status, 'completed')
  assert.equal(writeFileExecuted, true, 'write_file should remain available after skill activation')
  assert.equal(await readFile(join(workspace, 'x.txt'), 'utf8'), 'bad')
  assert.equal(
    result.messages.some(m => m.role === 'tool' && m.content.includes('"type":"tool_denial"')),
    false,
    'Skill activation should not produce tool denials when normal permissions allow the call',
  )
})

test('P0: tool diagnostics appear in final run result', async () => {
  // A tool that returns diagnostics — they must appear in result.diagnostics.
  const diagnosticTool: AgentTool = {
    name: 'check_data',
    description: 'Check data quality',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      return {
        content: 'Data check complete',
        diagnostics: [
          { code: 'MISSING_CRS', message: 'CRS metadata is missing', severity: 'warning' as const },
          { code: 'LOW_COVERAGE', message: 'Only 60% spatial coverage', severity: 'info' as const },
        ],
      }
    },
  }

  const model = new FakeModelAdapter([
    { content: '', toolCalls: [{ id: '1', name: 'check_data', input: {} }] },
    { content: 'Checked data' },
  ])

  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([diagnosticTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  }).run('Check data quality')

  assert.equal(result.goal.status, 'completed')
  const codes = result.diagnostics.map(d => d.code)
  assert.ok(codes.includes('MISSING_CRS'), 'MISSING_CRS diagnostic should be present')
  assert.ok(codes.includes('LOW_COVERAGE'), 'LOW_COVERAGE diagnostic should be present')
  assert.ok(
    result.transcript.some(e => e.type === 'diagnostic'),
    'Transcript should record diagnostic events',
  )
})

test('P0: two state-mutating read tools do not execute concurrently', async () => {
  // Both tools are risk:'read' but mutate domain state.  If they ran
  // concurrently the state patches would race.  The executor must run them
  // sequentially because isConcurrencySafe defaults to false.
  const executionOrder: string[] = []
  const stateSnapshot = () => JSON.stringify(result?.domainState ?? {})

  let result: Awaited<ReturnType<AgentRuntime['run']>> | undefined

  const toolA: AgentTool = {
    name: 'set_model',
    description: 'Set the active model',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      executionOrder.push('set_model:start')
      await new Promise(resolve => setTimeout(resolve, 10))
      executionOrder.push('set_model:end')
      return { content: 'Model set', statePatch: { modelId: 'carbon' } }
    },
  }
  const toolB: AgentTool = {
    name: 'set_scene',
    description: 'Set the active scene',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      executionOrder.push('set_scene:start')
      await new Promise(resolve => setTimeout(resolve, 10))
      executionOrder.push('set_scene:end')
      return { content: 'Scene set', statePatch: { sceneId: 'scene-1' } }
    },
  }

  const model = new FakeModelAdapter([
    // Both tools in one turn — must NOT run concurrently
    { content: '', toolCalls: [
      { id: '1', name: 'set_model', input: {} },
      { id: '2', name: 'set_scene', input: {} },
    ]},
    { content: 'Done' },
  ])

  result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([toolA, toolB]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  }).run('Set model and scene')

  assert.equal(result.goal.status, 'completed')
  // Verify sequential execution: A fully finishes before B starts
  assert.deepEqual(executionOrder, [
    'set_model:start', 'set_model:end',
    'set_scene:start', 'set_scene:end',
  ], 'State-mutating read tools must execute sequentially, not concurrently')
  // Both state patches should be applied (no race)
  assert.deepEqual(result.domainState, { modelId: 'carbon', sceneId: 'scene-1' })
})

test('P0: permission deferred stops remaining tools from producing side-effects', async () => {
  // Tool A is auto-approved, tool B requires approval (deferred).  After B is
  // deferred the run pauses — tool C must NOT execute.
  let toolCExecuted = false

  const toolA: AgentTool = {
    name: 'safe_read',
    description: 'Safe read',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() {
      return { content: 'Read OK', artifacts: [{ id: 'read-card', type: 'data-card', createdBy: 'tool' as const, data: {} }] }
    },
  }
  const toolB: AgentTool = {
    name: 'needs_approval',
    description: 'Needs approval',
    risk: 'write',
    inputSchema: { type: 'object' },
    async execute() {
      return { content: 'Should not reach here' }
    },
  }
  const toolC: AgentTool = {
    name: 'after_approval',
    description: 'Runs after approval',
    risk: 'write',
    inputSchema: { type: 'object' },
    async execute() {
      toolCExecuted = true
      return { content: 'Side effect happened' }
    },
  }

  const model = new FakeModelAdapter([
    // Three tools in one turn — B will be deferred, C must not run
    { content: '', toolCalls: [
      { id: '1', name: 'safe_read', input: {} },
      { id: '2', name: 'needs_approval', input: {} },
      { id: '3', name: 'after_approval', input: {} },
    ]},
  ])

  const result = await new AgentRuntime({
    model,
    tools: new ToolRegistry([toolA, toolB, toolC]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    permissions: new PermissionManager({
      approve: (tool) => tool.name === 'needs_approval' ? 'defer' : 'allow',
    }),
  }).run('Do something that needs approval')

  assert.equal(result.goal.status, 'blocked')
  assert.equal(toolCExecuted, false, 'Tool C must not execute after B is deferred')
  assert.ok(
    result.messages.some(m =>
      m.role === 'tool' &&
      m.content.includes('"type":"tool_denial"') &&
      m.content.includes('"decision":"defer"')
    ),
    'Should see deferred message for tool B',
  )
})

// ── Streaming Semantics Tests ────────────────────────────────────────────────
// These tests lock down the contract: the streaming path emits incremental UI
// events (model.streaming) while consuming the model stream, but defers tool
// execution until after loop detection.  This ordering is explicitly chosen
// for correctness — tools must not start until after loop detection — and
// these tests guard that invariant from being silently reverted.

test('streaming events arrive before tool execution within each turn', async () => {
  // Each turn: model.streaming events (tool cards) must all arrive before
  // tool.started for that turn.  Across turns the events interleave —
  // turn 2's stream starts after turn 1's tools finish — which is correct.
  const events: Array<Record<string, unknown>> = []
  const inspectTool: AgentTool = {
    name: 'inspect_data',
    description: 'Inspect data',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() { return { content: 'inspected' } },
  }
  const model = new FakeModelAdapter([
    { content: '', toolCalls: [{ id: '1', name: 'inspect_data', input: { path: 'data.csv' } }] },
    { content: 'Done' },
  ])

  await new AgentRuntime({
    model,
    tools: new ToolRegistry([inspectTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    eventSink: { emit: async event => { events.push(event as unknown as Record<string, unknown>) } },
  }).run('Inspect data')

  // Split the event stream into turns using tool.started as boundaries.
  // Within each turn, all model.streaming events must precede tool.started.
  const turns: Array<{ streaming: number; toolStarted: number }> = []
  let turnStreaming = 0
  for (let i = 0; i < events.length; i++) {
    if (events[i].eventType === 'model.streaming') turnStreaming++
    if (events[i].eventType === 'tool.started') {
      turns.push({ streaming: turnStreaming, toolStarted: i })
      turnStreaming = 0
    }
  }

  assert.ok(turns.length >= 1, 'Should have at least 1 tool-executing turn')
  for (const turn of turns) {
    assert.ok(turn.streaming > 0, `Each turn must have model.streaming events before tool.started (got ${turn.streaming})`)
  }
})

test('streaming emits both text and tool-call card events', async () => {
  const events: Array<Record<string, unknown>> = []
  const inspectTool: AgentTool = {
    name: 'inspect_data',
    description: 'Inspect data',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute() { return { content: 'inspected' } },
  }
  const model = new FakeModelAdapter([
    { content: '', toolCalls: [{ id: '1', name: 'inspect_data', input: { path: 'data.csv' } }] },
    { content: 'Done' },
  ])

  await new AgentRuntime({
    model,
    tools: new ToolRegistry([inspectTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    eventSink: { emit: async event => { events.push(event as unknown as Record<string, unknown>) } },
  }).run('Inspect data')

  const streamingEvents = events.filter(e => e.eventType === 'model.streaming')
  assert.ok(streamingEvents.length > 0, 'Should have model.streaming events')

  const toolCards = streamingEvents.filter(e => String(e.summary).startsWith('tool_call:'))
  assert.ok(toolCards.length > 0, 'Should emit tool_call card events for the frontend')
  assert.ok(
    toolCards.every(e => e.data && typeof e.data === 'object' && 'tool' in (e.data as object)),
    'Tool card events must include tool name in data',
  )
})

test('streaming text events are emitted as unclassified activity text', async () => {
  const events: AgentActionEvent[] = []
  const model = new FakeModelAdapter([
    { content: 'Hello there.' },
  ])

  await new AgentRuntime({
    model,
    tools: new ToolRegistry(),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    eventSink: { emit: async event => { events.push(event) } },
  }).run('Say hello')

  const textEvents = events.filter(event => event.eventType === 'model.streaming' && event.data?.text)
  assert.ok(textEvents.length > 0)
  assert.ok(textEvents.every(event => !('presentation' in (event.data ?? {}))))
})

test('streaming accumulates multiple argument deltas correctly', async () => {
  // FakeModelAdapter splits arguments into 7-char deltas.
  // If reassembly is broken, the parsed tool input will be truncated or wrong.
  const events: Array<Record<string, unknown>> = []
  let capturedInput: unknown = null
  const longInputTool: AgentTool = {
    name: 'long_input',
    description: 'Takes a long input',
    risk: 'read',
    inputSchema: { type: 'object' },
    async execute(_input: Record<string, unknown>) {
      capturedInput = _input
      return { content: 'ok' }
    },
  }
  const bigInput = { path: '/very/long/path/to/some/deeply/nested/data/file.csv', format: 'csv', options: { delimiter: ',', header: true } }
  const model = new FakeModelAdapter([
    { content: '', toolCalls: [{ id: '1', name: 'long_input', input: bigInput }] },
    { content: 'Done' },
  ])

  await new AgentRuntime({
    model,
    tools: new ToolRegistry([longInputTool]),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
    eventSink: { emit: async event => { events.push(event as unknown as Record<string, unknown>) } },
  }).run('Run long input tool')

  assert.deepEqual(capturedInput, bigInput, 'Tool must receive the full reconstructed input, not a truncated fragment')
})
