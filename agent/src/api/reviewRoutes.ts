import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { NestGateway } from '../adapters/nestGateway.ts'
import { revisionRequestSchema, reviewDecisionSchema, reviewRejectionSchema } from './contracts.ts'
import { agentError } from './errors.ts'
import { requestIdentity } from './sessionRoutes.ts'
import type { ReviewService } from '../session/reviewService.ts'

function params(request: FastifyRequest): { sessionId: string; reviewId?: string; artifactId?: string } {
  const value = request.params as Record<string, string | undefined>
  return { sessionId: value.sessionId ?? '', reviewId: value.reviewId, artifactId: value.artifactId }
}

export async function registerReviewRoutes(
  app: FastifyInstance,
  options: { nest: NestGateway; reviews: ReviewService },
): Promise<void> {
  app.post('/sessions/:sessionId/reviews/:reviewId/approve', async (request, reply) => {
    const route = params(request)
    const { subject, authorization } = await requestIdentity(request, options.nest)
    const body = reviewDecisionSchema.parse(request.body)
    return reply.status(202).send(await options.reviews.approve({
      sessionId: route.sessionId,
      reviewId: route.reviewId ?? '',
      subject,
      authorization,
      ...body,
    }))
  })

  app.post('/sessions/:sessionId/reviews/:reviewId/reject', async (request) => {
    const route = params(request)
    const { subject } = await requestIdentity(request, options.nest)
    const body = reviewRejectionSchema.parse(request.body)
    return options.reviews.reject({
      sessionId: route.sessionId,
      reviewId: route.reviewId ?? '',
      subject,
      ...body,
    })
  })

  app.post('/sessions/:sessionId/event-plans/:artifactId/revisions', async (request, reply) => {
    const route = params(request)
    const { subject } = await requestIdentity(request, options.nest)
    const body = revisionRequestSchema.parse(request.body)
    if (route.artifactId !== body.baseArtifactId) throw agentError(400, 'ARTIFACT_ID_MISMATCH')
    return reply.status(201).send(await options.reviews.revise({
      sessionId: route.sessionId,
      subject,
      baseArtifactId: route.artifactId ?? '',
      request: body,
    }))
  })
}
