import { resolve } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ModelAdapter } from '@ise/agent-core'
import { SkillLoader, SkillRegistry } from '@ise/skills-core'
import type { NestGateway } from '../adapters/nestGateway.ts'
import type { AgentRepositories } from '../persistence/repositories.ts'
import { EventBroker } from '../session/eventBroker.ts'
import { SessionAgentRunner } from '../session/sessionAgentRunner.ts'
import { ReviewService } from '../session/reviewService.ts'
import { mapAgentError } from './errors.ts'
import { registerReviewRoutes } from './reviewRoutes.ts'
import { registerSessionRoutes } from './sessionRoutes.ts'

export interface CreateHttpAppOptions {
  repositories: AgentRepositories
  nest: NestGateway
  modelFactory: (sessionId: string) => ModelAdapter
  skills?: SkillRegistry
  workspace?: string
}

async function loadSkills(): Promise<SkillRegistry> {
  const loaded = await new SkillLoader({
    userSkillsDir: resolve('.no-user-skills'),
    projectSkillsDir: resolve('agent', 'skills'),
  }).load()
  const error = loaded.diagnostics.find(item => item.severity === 'error')
  if (error) throw new Error(`Skill load failed: ${error.message}`)
  const registry = new SkillRegistry()
  registry.replace(loaded.skills)
  return registry
}

export async function createHttpApp(options: CreateHttpAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const events = new EventBroker(options.repositories.events)
  const runner = new SessionAgentRunner({
    repositories: options.repositories,
    nest: options.nest,
    modelFactory: options.modelFactory,
    skills: options.skills ?? await loadSkills(),
    workspace: options.workspace ?? process.cwd(),
    events,
  })
  const reviews = new ReviewService(options.repositories, events, runner, options.workspace ?? process.cwd())
  runner.setDraftObserver(input => reviews.createForDraft(input.sessionId, input.runId, input.draft))
  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapAgentError(error)
    void reply.status(mapped.status).send({
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details === undefined ? {} : { details: mapped.details }),
      },
    })
  })
  await registerSessionRoutes(app, { repositories: options.repositories, nest: options.nest, runner, events })
  await registerReviewRoutes(app, { nest: options.nest, reviews })
  return app
}
