import { SkillError } from './errors.ts'
import { createHash } from 'node:crypto'
import type {
  InvocationKind,
  SkillDefinition,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillInvocationRecord,
} from './types.ts'

export class SkillExecutor {
  readonly #approvedProjectSkills = new Set<string>()

  async execute(
    skill: SkillDefinition,
    args: string,
    invocation: InvocationKind,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const activeSkills = context.activeSkills ?? new Set<string>()
    if (activeSkills.has(skill.name)) {
      throw new SkillError(
        `Skill "${skill.name}" is already running`,
        'RECURSIVE_INVOCATION',
      )
    }

    const tools = narrowTools(skill, context.availableTools, skill.allowedTools)
    let authorization: SkillInvocationRecord['authorization'] = 'not-required'
    let outcome: SkillInvocationRecord['outcome'] = 'error'

    if (skill.source === 'project' && !this.#approvedProjectSkills.has(identity(skill))) {
      const approved = await context.authorizeProjectSkill?.(skill)
      authorization = approved ? 'approved' : 'denied'
      if (!approved) {
        outcome = 'denied'
        context.onInvocation?.(record(skill, invocation, authorization, tools, outcome))
        throw new SkillError(
          `Project skill "${skill.name}" was not authorized`,
          'AUTHORIZATION_DENIED',
        )
      }
      this.#approvedProjectSkills.add(identity(skill))
    } else if (skill.source === 'project') {
      authorization = 'approved'
    }

    activeSkills.add(skill.name)
    try {
      const resources = await loadRequestedResources(skill, context)
      const instructions = appendResources(substituteArgs(skill.instructions, args), resources)
      let result: SkillExecutionResult
      if (skill.execution === 'isolated') {
        if (!context.runIsolated) {
          throw new SkillError(
            `Skill "${skill.name}" requires an isolated runner`,
            'ISOLATED_RUNNER_REQUIRED',
          )
        }
        result = {
          type: 'isolated',
          skill: skill.name,
          result: await context.runIsolated({
            skill,
            instructions,
            allowedTools: tools,
          }),
          allowedTools: tools,
        }
      } else {
        result = {
          type: 'inline',
          skill: skill.name,
          message: { role: 'user', content: instructions },
          allowedTools: tools,
        }
      }
      outcome = 'success'
      return result
    } finally {
      activeSkills.delete(skill.name)
      context.onInvocation?.(record(skill, invocation, authorization, tools, outcome))
    }
  }
}

async function loadRequestedResources(
  skill: SkillDefinition,
  context: SkillExecutionContext,
): Promise<{ path: string; content: string }[]> {
  const requested = context.requestedResources ?? []
  if (requested.length === 0) return []
  if (!context.readResource) {
    throw new SkillError(
      `Skill "${skill.name}" requested resources, but no resource reader is configured`,
      'RESOURCE_READER_REQUIRED',
    )
  }
  const unique = [...new Set(requested)]
  const resources = []
  for (const path of unique) {
    const resource = await context.readResource(skill, path)
    resources.push({ path: resource.path, content: resource.content })
  }
  return resources
}

function appendResources(
  instructions: string,
  resources: readonly { path: string; content: string }[],
): string {
  if (resources.length === 0) return instructions
  return [
    instructions,
    '## Requested Skill Resources',
    ...resources.map(resource => [
      `### ${resource.path}`,
      resource.content.trim(),
    ].join('\n\n')),
  ].join('\n\n')
}

function narrowTools(
  skill: SkillDefinition,
  availableTools: readonly string[],
  requestedTools?: readonly string[],
): string[] {
  if (!requestedTools) return [...new Set(availableTools)]
  const available = new Set(availableTools)
  const missing = [...new Set(requestedTools)].filter(tool => !available.has(tool))
  if (missing.length > 0) {
    throw new SkillError(
      `Skill "${skill.name}" declares unavailable allowed tools: ${missing.join(', ')}`,
      'MISSING_ALLOWED_TOOLS',
    )
  }
  const requested = new Set(requestedTools)
  return [...new Set(availableTools)].filter(tool => requested.has(tool))
}

function substituteArgs(instructions: string, args: string): string {
  return instructions.replaceAll('{{args}}', () => args)
}

function identity(skill: SkillDefinition): string {
  const contentHash = createHash('sha256')
    .update(skill.instructions)
    .digest('hex')
  return `${skill.filePath ?? skill.name}:${skill.version ?? ''}:${contentHash}`
}

function record(
  skill: SkillDefinition,
  invocation: InvocationKind,
  authorization: SkillInvocationRecord['authorization'],
  tools: string[],
  outcome: SkillInvocationRecord['outcome'],
): SkillInvocationRecord {
  return {
    skill: skill.name,
    source: skill.source,
    version: skill.version,
    invocation,
    execution: skill.execution,
    authorization,
    tools,
    timestamp: new Date().toISOString(),
    outcome,
  }
}
