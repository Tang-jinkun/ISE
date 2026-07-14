import { z } from 'zod'
import type { AgentTool } from '../types.ts'

const updateGoalSchema = z.object({
  progress: z.string().min(1),
  nextStep: z.string().optional(),
})

export const updateGoalTool: AgentTool = {
  name: 'update_goal',
  description: 'Record progress toward the current objective',
  risk: 'control',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['progress'],
    properties: {
      progress: { type: 'string' },
      nextStep: { type: 'string' },
    },
  },
  async execute(input) {
    const parsed = updateGoalSchema.parse(input)
    return {
      content: 'Goal progress updated',
      goalUpdate: parsed,
    }
  },
}
