import type { RecoveryOption } from '../types.ts'

export interface StructuredToolFailureDetails {
  missingEvidence?: string[]
  missingPreconditions?: string[]
  clarificationNeeded?: boolean
  [key: string]: unknown
}

export interface StructuredToolFailure {
  type: string
  tool?: string
  reason: string
  message: string
  recoveryHint?: string
  recoveryOptions?: RecoveryOption[]
  details?: StructuredToolFailureDetails
}

export class StructuredToolError extends Error {
  readonly failure: StructuredToolFailure

  constructor(failure: StructuredToolFailure) {
    super(JSON.stringify(failure))
    this.name = 'StructuredToolError'
    this.failure = failure
  }
}

export function isStructuredToolError(error: unknown): error is StructuredToolError {
  return error instanceof StructuredToolError
}

export function renderStructuredToolFailure(failure: StructuredToolFailure): string {
  return JSON.stringify({
    type: failure.type,
    tool: failure.tool,
    reason: failure.reason,
    message: failure.message,
    recoveryHint: failure.recoveryHint,
    recoveryOptions: failure.recoveryOptions ?? [],
    details: failure.details,
  })
}
