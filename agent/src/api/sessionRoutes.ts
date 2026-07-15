import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { NestGateway } from '../adapters/nestGateway.ts'
import type { AgentArtifactView, AttachmentView, SessionView } from './contracts.ts'
import {
  attachFileSchema,
  emptyObjectSchema,
  sendMessageSchema,
} from './contracts.ts'
import { agentError } from './errors.ts'
import type { AgentRepositories, PersistedAttachmentRecord } from '../persistence/repositories.ts'
import type { EventBroker } from '../session/eventBroker.ts'
import { writeSseSession } from '../session/eventBroker.ts'
import type { SessionAgentRunner } from '../session/sessionAgentRunner.ts'

export interface SessionRouteOptions {
  repositories: AgentRepositories
  nest: NestGateway
  runner: SessionAgentRunner
  events: EventBroker
}

export async function requestIdentity(
  request: FastifyRequest,
  nest: NestGateway,
): Promise<{ subject: string; authorization: string }> {
  const authorization = request.headers.authorization
  if (!authorization || !/^Bearer\s+\S+$/.test(authorization)) throw agentError(401, 'INVALID_BEARER')
  try {
    return { ...(await nest.verifyBearer(authorization)), authorization }
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_BEARER') throw agentError(401, 'INVALID_BEARER')
    throw error
  }
}

function sessionId(request: FastifyRequest): string {
  return String((request.params as { sessionId?: string }).sessionId ?? '')
}

function toAttachmentView(row: PersistedAttachmentRecord): AttachmentView {
  return {
    attachmentId: row.id,
    fileId: row.fileId,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    fingerprint: row.fingerprint as `sha256:${string}`,
  }
}

function toArtifactView(row: ReturnType<AgentRepositories['artifacts']['listLedger']>[number]): AgentArtifactView {
  return {
    artifactId: row.id,
    type: row.type,
    version: row.version,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    ...(row.logicalKey ? { logicalKey: row.logicalKey } : {}),
    ...(row.supersedes ? { supersedes: row.supersedes } : {}),
    superseded: Boolean(row.superseded),
    data: row.data,
    ...(row.metadata ? { metadata: row.metadata } : {}),
  }
}

export async function registerSessionRoutes(app: FastifyInstance, options: SessionRouteOptions): Promise<void> {
  app.post('/sessions', async (request, reply) => {
    emptyObjectSchema.parse(request.body)
    const { subject } = await requestIdentity(request, options.nest)
    const session = options.repositories.sessions.create(subject)
    return reply.status(201).send({ sessionId: session.id, status: 'idle' })
  })

  app.get('/sessions/:sessionId', async (request) => {
    const { subject } = await requestIdentity(request, options.nest)
    const session = options.repositories.sessions.requireOwned(sessionId(request), subject)
    const view: SessionView = {
      sessionId: session.id,
      status: session.status,
      ...(session.activeRunId ? { activeRunId: session.activeRunId } : {}),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
    return view
  })

  app.post('/sessions/:sessionId/attachments', async (request, reply) => {
    const { subject, authorization } = await requestIdentity(request, options.nest)
    const id = sessionId(request)
    options.repositories.sessions.requireOwned(id, subject)
    const input = attachFileSchema.parse(request.body)
    const remote = await options.nest.readOwnedFile(input.fileId, authorization)
    return reply.status(201).send(toAttachmentView(options.repositories.attachments.create(id, remote)))
  })

  app.post('/sessions/:sessionId/messages', async (request, reply) => {
    const { subject, authorization } = await requestIdentity(request, options.nest)
    const input = sendMessageSchema.parse(request.body)
    return reply.status(202).send(options.runner.enqueue({
      sessionId: sessionId(request), subject, authorization, content: input.content,
    }))
  })

  app.get('/sessions/:sessionId/artifacts', async (request) => {
    const { subject } = await requestIdentity(request, options.nest)
    const id = sessionId(request)
    options.repositories.sessions.requireOwned(id, subject)
    return { artifacts: options.repositories.artifacts.listLedger(id).map(toArtifactView) }
  })

  app.post('/sessions/:sessionId/interrupt', async (request, reply) => {
    emptyObjectSchema.parse(request.body)
    const { subject } = await requestIdentity(request, options.nest)
    return reply.status(202).send(options.runner.interrupt(sessionId(request), subject))
  })

  app.get('/sessions/:sessionId/events', async (request, reply) => {
    const { subject } = await requestIdentity(request, options.nest)
    const id = sessionId(request)
    options.repositories.sessions.requireOwned(id, subject)
    const rawLastEventId = request.headers['last-event-id']
    const lastEventId = rawLastEventId === undefined ? '0' : String(rawLastEventId)
    if (!/^(0|[1-9][0-9]*)$/.test(lastEventId)) throw agentError(400, 'INVALID_LAST_EVENT_ID')

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    const controller = new AbortController()
    const close = () => controller.abort()
    request.raw.once('close', close)
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n')
    }, 15_000)
    heartbeat.unref()
    try {
      await writeSseSession(reply.raw, options.events.subscribe(id, lastEventId, controller.signal), controller.signal)
    } finally {
      clearInterval(heartbeat)
      request.raw.off('close', close)
      if (!reply.raw.destroyed) reply.raw.end()
    }
  })
}
