import type { AgentTool } from '../types.ts'
import {
  updateTodoListState,
} from '../planning/TodoState.ts'

export const updateTodoListTool: AgentTool = {
  name: 'update_todo_list',
  description: [
    'Update the structured todo list for the current agent session.',
    'Use it for non-trivial multi-step work, user-requested plans, changing paths, or risky/conditional tasks.',
    'Do not use it for simple one-step answers or pure informational conversation.',
    'Todo items organize work only; they do not grant permissions, prove business facts, or trigger side effects.',
  ].join(' '),
  risk: 'control',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['content', 'status'],
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            activeForm: { type: 'string' },
            status: { enum: ['pending', 'in_progress', 'completed'] },
            refs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'id'],
                properties: {
                  kind: {
                    enum: ['work_point', 'work_item', 'artifact', 'run', 'pending_action', 'tool_call'],
                  },
                  id: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
  async execute(input, context) {
    const items = input && typeof input === 'object' && !Array.isArray(input)
      ? (input as { items?: unknown }).items
      : undefined
    const { patch, result } = updateTodoListState({
      previousState: context.domainState.snapshot(),
      items,
    })

    return {
      content: JSON.stringify({
        oldItems: result.oldItems,
        newItems: result.newItems,
        cleared: result.cleared,
        note: 'Todo updates organize agent work only. They do not authorize tools, prove business facts, or trigger model execution.',
      }),
      statePatch: patch,
    }
  },
}
