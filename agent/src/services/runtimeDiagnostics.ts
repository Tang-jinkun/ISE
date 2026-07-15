import { diagnosticSchema, type Diagnostic } from '@ise/runtime-contracts'

export const compilationDiagnosticSchema = diagnosticSchema
export type CompilationDiagnostic = Diagnostic

export function diagnostic(
  code: string,
  message: string,
  severity: 'warning' | 'error' = 'error',
  details: Partial<Pick<Diagnostic, 'eventUnitId' | 'commandId' | 'assetId'>> = {},
): CompilationDiagnostic {
  return diagnosticSchema.parse({
    code,
    severity,
    recoverable: severity === 'warning',
    message,
    ...details,
  })
}

export class CompilationError extends Error {
  constructor(readonly diagnostics: CompilationDiagnostic[]) {
    super(diagnostics.map(item => `${item.code}: ${item.message}`).join('; '))
    this.name = 'CompilationError'
  }
}
