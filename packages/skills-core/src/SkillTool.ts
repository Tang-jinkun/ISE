import { SkillError } from './errors.ts'
import { SkillExecutor } from './SkillExecutor.ts'
import { SkillRegistry } from './SkillRegistry.ts'
import type {
  InvocationKind,
  ResolvedSkillActivation,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillToolInput,
} from './types.ts'

export class SkillTool {
  constructor(
    readonly registry: SkillRegistry,
    readonly executor = new SkillExecutor(),
  ) {}

  async invokeModel(
    input: SkillToolInput,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    return this.#invoke(input, context, 'model')
  }

  async invokeUser(
    input: SkillToolInput,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    return this.#invoke(input, context, 'user')
  }

  async resolve(
    input: SkillToolInput,
    invocation: InvocationKind,
    context: SkillExecutionContext,
  ): Promise<ResolvedSkillActivation> {
    const result = await this.#invoke(input, context, invocation)
    if (result.type !== 'inline') {
      throw new SkillError(
        `Skill "${result.skill}" uses isolated execution and cannot be pre-activated inline`,
        'ISOLATED_RUNNER_REQUIRED',
      )
    }
    const skill = this.registry.resolve(input.skill)
    if (!skill) throw new SkillError(`Unknown skill: ${input.skill}`, 'UNKNOWN_SKILL')
    const { createHash } = await import('node:crypto')
    return {
      name: result.skill,
      invocation,
      args: input.args ?? '',
      instructions: result.message.content,
      allowedTools: result.allowedTools,
      source: skill.source,
      execution: skill.execution,
      version: skill.version,
      contentHash: createHash('sha256').update(skill.instructions).digest('hex'),
    }
  }

  asModelTool(context: SkillExecutionContext) {
    return {
      name: 'skill',
      description: 'Load and execute an available skill by name',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['skill'],
        properties: {
          skill: { type: 'string', description: 'Skill name' },
          args: { type: 'string', description: 'Optional literal arguments' },
        },
      },
      execute: (input: SkillToolInput) => this.invokeModel(input, context),
    } as const
  }

  async #invoke(
    input: SkillToolInput,
    context: SkillExecutionContext,
    invocation: 'model' | 'user',
  ): Promise<SkillExecutionResult> {
    const name = input.skill.trim().replace(/^\/+/, '')
    const skill = this.registry.resolve(name)
    if (!skill) throw new SkillError(`Unknown skill: ${name}`, 'UNKNOWN_SKILL')

    const invocable =
      invocation === 'model' ? skill.modelInvocable : skill.userInvocable
    if (!invocable) {
      throw new SkillError(
        `Skill "${name}" cannot be invoked by ${invocation}`,
        'NOT_INVOCABLE',
      )
    }

    return this.executor.execute(skill, input.args ?? '', invocation, {
      ...context,
      requestedResources: input.resources ?? [],
      readResource: context.readResource ?? readFilesystemResource,
    })
  }
}

async function readFilesystemResource(skill: import('./types.ts').SkillDefinition, path: string) {
  if (!skill.rootDir) {
    throw new SkillError(
      `Skill "${skill.name}" does not have filesystem resources`,
      'RESOURCE_READER_REQUIRED',
    )
  }
  const { lstat, readFile, realpath } = await import('node:fs/promises')
  const { isAbsolute, join, relative, sep } = await import('node:path')
  const summary = skill.resources?.find(resource => resource.path === path)
  if (!summary) throw new SkillError(`Skill resource is not registered: ${path}`, 'UNKNOWN_SKILL')
  const filePath = join(skill.rootDir, path)
  const [realRoot, realFile] = await Promise.all([realpath(skill.rootDir), realpath(filePath)])
  const rel = relative(realRoot, realFile)
  if (!(rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)))) {
    throw new SkillError(`Skill resource escapes root: ${path}`, 'RESOURCE_READER_REQUIRED')
  }
  const stat = await lstat(realFile)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new SkillError(`Skill resource must be a regular file: ${path}`, 'RESOURCE_READER_REQUIRED')
  }
  return { ...summary, content: await readFile(realFile, 'utf8') }
}
