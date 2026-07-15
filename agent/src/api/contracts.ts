import { z } from 'zod'
import { eventPlanSchema, type EventPlan } from '../contracts/eventPlan.ts'

export const sessionStatusSchema = z.enum([
  'idle', 'queued', 'running', 'awaiting_review', 'completed', 'failed', 'cancelled',
])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const createSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.literal('idle'),
}).strict()
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>

export type SessionView = {
  sessionId: string
  status: SessionStatus
  activeRunId?: string
  createdAt: string
  updatedAt: string
}

export type AttachmentView = {
  attachmentId: string
  fileId: string
  name: string
  mimeType: string
  size: number
  fingerprint: `sha256:${string}`
}

export type QueuedRunResponse = { runId: string; status: 'queued' }

export type AgentArtifactView = {
  artifactId: string
  type: string
  version: number
  createdAt: string
  createdBy: 'user' | 'agent' | 'tool'
  logicalKey?: string
  supersedes?: string
  superseded: boolean
  data: unknown
  metadata?: Record<string, unknown>
}

export type ReviewTuple = {
  reviewId: string
  artifactId: string
  version: number
  fingerprint: string
}

export type RevisionRequest = {
  baseArtifactId: string
  eventUnits: EventPlan['eventUnits']
}

export const publicAgentEventTypeSchema = z.enum([
  'run.started', 'tool.started', 'tool.progress', 'artifact.created', 'review.requested',
  'review.resolved', 'compile.progress', 'run.completed', 'run.failed',
])
export type PublicAgentEventType = z.infer<typeof publicAgentEventTypeSchema>

export type AgentEventEnvelope = {
  id: string
  type: PublicAgentEventType
  data: Record<string, unknown>
}

export type AgentErrorBody = {
  error: { code: string; message: string; details?: unknown }
}

export const emptyObjectSchema = z.object({}).strict()
export const sendMessageSchema = z.object({ content: z.string().trim().min(1).max(20_000) }).strict()
export const attachFileSchema = z.object({
  fileId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
}).strict()
export const reviewDecisionSchema = z.object({
  artifactId: z.string().min(1),
  version: z.number().int().positive(),
  fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict()
export const reviewRejectionSchema = reviewDecisionSchema.extend({
  reason: z.string().trim().min(1).max(2_000).optional(),
}).strict()
export const revisionRequestSchema = z.object({
  baseArtifactId: z.string().min(1),
  eventUnits: eventPlanSchema.shape.eventUnits,
}).strict()
