import { z } from 'zod'

export const todoStatusSchema = z.enum(['pending', 'in_progress', 'completed'])

export const todoRefSchema = z.object({
  kind: z.enum(['work_point', 'work_item', 'artifact', 'run', 'pending_action', 'tool_call']),
  id: z.string().min(1),
}).strict()

export const todoItemSchema = z.object({
  id: z.string().min(1).optional(),
  content: z.string().min(1),
  activeForm: z.string().min(1).optional(),
  status: todoStatusSchema,
  refs: z.array(todoRefSchema).default([]),
}).strict()

export const todoListInputSchema = z.object({
  items: z.array(todoItemSchema),
}).strict()

export type TodoStatus = z.infer<typeof todoStatusSchema>
export type TodoRef = z.infer<typeof todoRefSchema>
export type TodoItem = z.infer<typeof todoItemSchema>
export type TodoListInput = z.infer<typeof todoListInputSchema>

export interface NormalizedTodoItem {
  id: string
  content: string
  activeForm: string
  status: TodoStatus
  refs: TodoRef[]
}

export interface TodoListState {
  items: NormalizedTodoItem[]
  updatedAt: string
}

export interface TodoListUpdateResult {
  oldItems: NormalizedTodoItem[]
  newItems: NormalizedTodoItem[]
  cleared: boolean
}

export function readTodoListState(
  state: Record<string, unknown>,
): NormalizedTodoItem[] {
  const parsed = z.array(todoItemSchema).safeParse(state.agentTodoList)
  if (!parsed.success) return []
  return normalizeTodoItems(parsed.data)
}

export function updateTodoListState(input: {
  previousState: Record<string, unknown>
  items: unknown
  now?: string
}): {
  patch: Record<string, unknown>
  result: TodoListUpdateResult
} {
  const oldItems = readTodoListState(input.previousState)
  const parsed = todoListInputSchema.parse({ items: input.items })
  const normalized = normalizeTodoItems(parsed.items)
  const allDone = normalized.length > 0 && normalized.every(item => item.status === 'completed')
  const newItems = allDone ? [] : normalized
  const now = input.now ?? new Date().toISOString()

  return {
    patch: {
      agentTodoList: newItems,
      agentTodoListUpdatedAt: now,
    },
    result: {
      oldItems,
      newItems,
      cleared: allDone,
    },
  }
}

export function normalizeTodoItems(items: readonly TodoItem[]): NormalizedTodoItem[] {
  const inProgressCount = items.filter(item => item.status === 'in_progress').length
  if (inProgressCount > 1) {
    throw new Error('Todo list can have at most one in_progress item.')
  }

  return items.map((item, index) => ({
    id: item.id?.trim() || `todo-${index + 1}`,
    content: item.content.trim(),
    activeForm: item.activeForm?.trim() || item.content.trim(),
    status: item.status,
    refs: item.refs,
  }))
}
