import type { Diagnostic } from '@ise/agent-core'

const publicCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/
const knownPublicCode = /^(?:AGENT_RUN_FAILED|RUN_[A-Z0-9_]+|ASSET_[A-Z0-9_]+|REQUIRED_ASSET_[A-Z0-9_]+|OPTIONAL_ASSET_[A-Z0-9_]+|COMPILED_[A-Z0-9_]+|COMPILATION_[A-Z0-9_]+|RUNTIME_[A-Z0-9_]+|NARRATIVE_[A-Z0-9_]+|CAPABILITY_[A-Z0-9_]+|COMMAND_[A-Z0-9_]+|LINEAGE_[A-Z0-9_]+|OUTPUT_[A-Z0-9_]+|DUPLICATE_[A-Z0-9_]+|ENTITY_[A-Z0-9_]+|EVENT_UNIT_[A-Z0-9_]+|SOURCE_EVENT_PLAN_[A-Z0-9_]+)$/

export function publicFailureCode(value: unknown): string {
  return typeof value === 'string' && publicCodePattern.test(value) && knownPublicCode.test(value)
    ? value
    : 'AGENT_RUN_FAILED'
}

export function publicFailureMessage(code: string): string {
  if (code === 'RUN_CANCELLED') return 'Run cancelled by the session owner'
  if (/ASSET|COMPIL|RUNTIME|NARRATIVE|CAPABILITY|COMMAND|LINEAGE|OUTPUT/.test(code)) {
    return 'Replay compilation failed'
  }
  return 'Agent run failed'
}

export function publicFailureDiagnostics(value: unknown): Array<Pick<Diagnostic, 'code' | 'message' | 'severity'>> {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ code: 'AGENT_RUN_FAILED', message: 'Agent run failed', severity: 'error' }]
  }
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const code = publicFailureCode(record.code)
    return [{
      code,
      message: publicFailureMessage(code),
      severity: record.severity === 'warning' ? 'warning' as const : 'error' as const,
    }]
  })
}
