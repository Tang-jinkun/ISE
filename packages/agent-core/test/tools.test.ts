import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ArtifactStore,
  builtinActionTools,
  DomainStateStore,
  executeToolCall,
  PermissionManager,
  updateTodoListState,
  updateTodoListTool,
  readFileTool,
  writeFileTool,
  type AgentContext,
  type AgentTool,
  type GoalState,
} from '../src/index.ts'

test('default builtin action tools do not expose arbitrary shell execution', () => {
  assert.equal(builtinActionTools.some(tool => tool.name === 'shell'), false)
})

function context(workspace: string): AgentContext {
  const goal: GoalState = {
    objective: 'test',
    status: 'active',
    turnCount: 1,
    maxTurns: 5,
    evidence: [],
    remainingIssues: [],
    startedAt: new Date().toISOString(),
  }
  return {
    workspace,
    goal,
    artifacts: new ArtifactStore(),
    domainState: new DomainStateStore(),
  }
}

test('workspace tools reject path traversal', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-path-'))
  await assert.rejects(
    readFileTool.execute({ path: '../outside.txt' }, context(workspace)),
    /escapes workspace|ENOENT/,
  )
})

test('write tool writes inside workspace after approval policy', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-write-'))
  await mkdir(join(workspace, 'sub'))
  const ctx = context(workspace)
  const permissions = new PermissionManager({ approve: () => 'allow' })
  assert.equal(await permissions.check(writeFileTool, {}, ctx), 'allow')

  await writeFileTool.execute({ path: 'sub/result.txt', content: 'ok' }, ctx)
  assert.equal(await readFile(join(workspace, 'sub/result.txt'), 'utf8'), 'ok')
})

test('write tools are denied without explicit approval', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-deny-'))
  const permissions = new PermissionManager()
  assert.equal(await permissions.check(writeFileTool, {}, context(workspace)), 'deny')
})

test('structured allow exposes a trusted confirmation only during execute and apply', async () => {
  const ctx = context(process.cwd())
  let confirmationSeenByTool: string | undefined
  const tool: AgentTool = {
    name: 'create_user_record',
    description: 'Create a user-confirmed record',
    risk: 'write',
    inputSchema: { type: 'object' },
    async execute(_input, toolContext) {
      confirmationSeenByTool = toolContext.lastConsumedConfirmationId
      return {
        content: 'created',
        artifacts: [{
          id: 'confirmed-record',
          type: 'confirmed-record',
          createdBy: 'user',
          data: {},
          metadata: { confirmationId: toolContext.lastConsumedConfirmationId },
        }],
      }
    },
  }
  const permissions = new PermissionManager({
    approve: () => ({ decision: 'allow', confirmationId: 'confirm-call-1' }),
  })

  const execution = await executeToolCall({
    tool,
    call: { id: 'call-1', name: tool.name, input: { recordId: 'record-1' } },
    context: ctx,
    runId: 'run-1',
    turn: 1,
    guard: { check: (guardedTool, input, guardedContext) =>
      permissions.guard(guardedTool, input, guardedContext) },
  })

  assert.equal(execution.outcome, 'completed')
  assert.equal(confirmationSeenByTool, 'confirm-call-1')
  assert.equal(ctx.artifacts.get('confirmed-record')?.createdBy, 'user')
  assert.equal(ctx.artifacts.get('confirmed-record')?.metadata?.confirmationId, 'confirm-call-1')
  assert.equal(ctx.lastConsumedConfirmationId, undefined)
})

test('plain allow creates no trusted confirmation binding', async () => {
  const ctx = context(process.cwd())
  let confirmationSeenByTool: string | undefined
  const tool: AgentTool = {
    name: 'create_unbound_record',
    description: 'Attempt to create an unbound user record',
    risk: 'write',
    inputSchema: { type: 'object' },
    async execute(_input, toolContext) {
      confirmationSeenByTool = toolContext.lastConsumedConfirmationId
      return {
        content: 'created',
        artifacts: [{
          id: 'unbound-record',
          type: 'unbound-record',
          createdBy: 'user',
          data: {},
          metadata: { confirmationId: 'untrusted-self-assertion' },
        }],
      }
    },
  }
  const permissions = new PermissionManager({ approve: () => 'allow' })

  const execution = await executeToolCall({
    tool,
    call: { id: 'call-plain', name: tool.name, input: {} },
    context: ctx,
    runId: 'run-plain',
    turn: 1,
    guard: { check: (guardedTool, input, guardedContext) =>
      permissions.guard(guardedTool, input, guardedContext) },
  })

  assert.equal(execution.outcome, 'completed')
  assert.equal(confirmationSeenByTool, undefined)
  assert.equal(ctx.artifacts.get('unbound-record')?.createdBy, 'tool')
  assert.equal(ctx.lastConsumedConfirmationId, undefined)
})

test('trusted confirmation binding is cleared when tool execution fails', async () => {
  const ctx = context(process.cwd())
  let confirmationSeenByTool: string | undefined
  const tool: AgentTool = {
    name: 'failing_confirmed_write',
    description: 'Fail after observing confirmation',
    risk: 'write',
    inputSchema: { type: 'object' },
    async execute(_input, toolContext) {
      confirmationSeenByTool = toolContext.lastConsumedConfirmationId
      throw new Error('write failed')
    },
  }
  const permissions = new PermissionManager({
    approve: () => ({ decision: 'allow', confirmationId: 'confirm-failure' }),
  })

  const execution = await executeToolCall({
    tool,
    call: { id: 'call-failure', name: tool.name, input: {} },
    context: ctx,
    runId: 'run-failure',
    turn: 1,
    guard: { check: (guardedTool, input, guardedContext) =>
      permissions.guard(guardedTool, input, guardedContext) },
  })

  assert.equal(execution.outcome, 'failed')
  assert.equal(confirmationSeenByTool, 'confirm-failure')
  assert.equal(ctx.lastConsumedConfirmationId, undefined)
})

test('todo state normalizes items and enforces one in-progress item', () => {
  const update = updateTodoListState({
    previousState: {},
    now: '2026-06-25T00:00:00.000Z',
    items: [
      { content: 'Inspect scene data', activeForm: 'Inspecting scene data', status: 'in_progress' },
      { id: 'assess', content: 'Assess model readiness', status: 'pending' },
    ],
  })

  assert.deepEqual(update.patch, {
    agentTodoList: [
      {
        id: 'todo-1',
        content: 'Inspect scene data',
        activeForm: 'Inspecting scene data',
        status: 'in_progress',
        refs: [],
      },
      {
        id: 'assess',
        content: 'Assess model readiness',
        activeForm: 'Assess model readiness',
        status: 'pending',
        refs: [],
      },
    ],
    agentTodoListUpdatedAt: '2026-06-25T00:00:00.000Z',
  })

  assert.throws(
    () => updateTodoListState({
      previousState: {},
      items: [
        { content: 'First', status: 'in_progress' },
        { content: 'Second', status: 'in_progress' },
      ],
    }),
    /at most one in_progress/,
  )
})

test('todo state clears session working list when all items are completed', () => {
  const update = updateTodoListState({
    previousState: {
      agentTodoList: [{ id: 'old', content: 'Old task', activeForm: 'Old task', status: 'in_progress', refs: [] }],
    },
    items: [
      { id: 'done-1', content: 'Inspect scene data', activeForm: 'Inspecting scene data', status: 'completed' },
      { id: 'done-2', content: 'Assess model readiness', activeForm: 'Assessing model readiness', status: 'completed' },
    ],
  })

  assert.equal(update.result.cleared, true)
  assert.deepEqual(update.patch.agentTodoList, [])
})

test('todo tool updates working state without granting write permissions', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'clean-agent-todo-'))
  const ctx = context(workspace)
  const permissions = new PermissionManager()

  assert.equal(await permissions.check(updateTodoListTool, {}, ctx), 'allow')
  assert.equal(await permissions.check(writeFileTool, {}, ctx), 'deny')

  const result = await updateTodoListTool.execute({
    items: [
      { content: 'Plan a model run', activeForm: 'Planning a model run', status: 'in_progress' },
      { content: 'Run Carbon model', activeForm: 'Running Carbon model', status: 'pending' },
    ],
  }, ctx)
  ctx.domainState.applyPatch(result.statePatch ?? {})

  assert.equal((ctx.domainState.snapshot().agentTodoList as unknown[]).length, 2)
  assert.equal(await permissions.check(writeFileTool, {}, ctx), 'deny')
})
