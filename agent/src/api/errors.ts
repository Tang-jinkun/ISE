import { z } from 'zod'

export class AgentServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AgentServiceError'
  }
}

export function agentError(status: number, code: string, message = code, details?: unknown): AgentServiceError {
  return new AgentServiceError(status, code, message, details)
}

export function mapAgentError(error: unknown): AgentServiceError {
  if (error instanceof AgentServiceError) return error
  if (error instanceof z.ZodError) return agentError(400, 'INVALID_REQUEST', 'Request validation failed', error.issues)
  return agentError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Internal error')
}
