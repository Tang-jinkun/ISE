import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ArtifactStore,
  builtinActionTools,
  DomainStateStore,
  PermissionManager,
  updateTodoListState,
  updateTodoListTool,
  readFileTool,
  writeFileTool,
  type AgentContext,
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
