import {
  SkillTool,
  type SkillDefinition,
  type SkillExecutionContext,
  type SkillInvocationRecord,
  type SkillResourceContent,
} from '@ise/skills-core'
import {
  renderActiveSkillHiddenPrompt,
  renderActiveSkillReminderContent,
  renderActiveSkillReminderHiddenPrompt,
} from '../prompts/skillPrompts.ts'
import type { AgentMessage, AgentTool } from '../types.ts'

export interface SkillAgentToolOptions {
  availableTools: () => readonly string[]
  authorizeProjectSkill?: (skill: SkillDefinition) => boolean | Promise<boolean>
  readResource?: (skill: SkillDefinition, path: string) => SkillResourceContent | Promise<SkillResourceContent>
  runIsolated?: SkillExecutionContext['runIsolated']
  onInvocation?: (record: SkillInvocationRecord) => void
}

export function createSkillAgentTool(
  skillTool: SkillTool,
  options: SkillAgentToolOptions,
): AgentTool {
  return {
    name: 'skill',
    description: 'Load a relevant skill before acting on specialized tasks',
    risk: 'control',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['skill'],
      properties: {
        skill: { type: 'string' },
        args: { type: 'string' },
        resources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional skill resource paths such as examples/foo.md or references/bar.md',
        },
      },
    },
    async execute(input, context) {
      const parsed = input as { skill: string; args?: string; resources?: string[] }
      if (context.skillScope?.name === parsed.skill.replace(/^\/+/, '')) {
        return {
          content: renderActiveSkillReminderContent(context.skillScope.name),
          hiddenMessages: [{
            role: 'user',
            content: renderActiveSkillReminderHiddenPrompt(context.skillScope.name),
            hidden: true,
          } satisfies AgentMessage],
        }
      }
      const result = await skillTool.invokeModel(parsed, {
        availableTools: options.availableTools(),
        authorizeProjectSkill: options.authorizeProjectSkill,
        readResource: options.readResource,
        runIsolated: options.runIsolated,
        onInvocation: options.onInvocation,
      })
      if (result.type === 'isolated') {
        return { content: result.result }
      }
      return {
        content: `Skill "${result.skill}" loaded`,
        hiddenMessages: [
          {
            role: 'user',
            content: renderActiveSkillHiddenPrompt({
              skillName: result.skill,
              skillContent: result.message.content,
            }),
            hidden: true,
          },
        ],
        activateSkill: { name: result.skill, allowedTools: result.allowedTools },
      }
    },
  }
}
