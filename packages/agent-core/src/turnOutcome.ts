export type TurnOutcomeStatus =
  | 'completed'
  | 'awaiting_user'
  | 'awaiting_dependency'
  | 'failed'

export interface TurnOutcomeDiagnostic {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface TurnOutcome {
  status: TurnOutcomeStatus
  finalAnswer: string
  diagnostics?: TurnOutcomeDiagnostic[]
  metadata?: Record<string, unknown>
}
