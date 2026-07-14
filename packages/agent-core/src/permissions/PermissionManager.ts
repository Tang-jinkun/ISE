import type {
  AgentContext,
  AgentTool,
  ToolGuardDecision,
  ToolRisk,
} from '../types.ts'

export type PermissionDecision = 'allow' | 'deny' | 'defer'

export interface PermissionManagerOptions {
  approve?: (
    tool: AgentTool,
    input: unknown,
    context: AgentContext,
  ) => PermissionDecision | ToolGuardDecision | Promise<PermissionDecision | ToolGuardDecision>
}

export class PermissionManager {
  constructor(readonly options: PermissionManagerOptions = {}) {}

  async check(
    tool: AgentTool,
    input: unknown,
    context: AgentContext,
  ): Promise<PermissionDecision> {
    if (tool.risk === 'control' || tool.risk === 'read' || tool.risk === 'derive') return 'allow'
    const decision = (await this.options.approve?.(tool, input, context)) ?? 'deny'
    return typeof decision === 'string' ? decision : decision.decision
  }

  async guard(
    tool: AgentTool,
    input: unknown,
    context: AgentContext,
  ): Promise<ToolGuardDecision> {
    if (tool.risk === 'control' || tool.risk === 'read' || tool.risk === 'derive') {
      return { decision: 'allow' }
    }
    const decision = (await this.options.approve?.(tool, input, context)) ?? 'deny'
    if (typeof decision !== 'string') return decision
    if (decision === 'allow') return { decision: 'allow' }
    if (decision === 'defer') {
      return {
        decision: 'defer',
        reason: 'confirmation_required',
        message: `Tool ${tool.name} requires user confirmation before it can continue.`,
        recoveryHint: 'Wait for the user confirmation result before retrying protected execution or explain the supported status.',
      }
    }
    return {
      decision: 'deny',
      reason: 'permission_denied',
      message: `Tool ${tool.name} is not permitted by the current permission policy.`,
      recoveryHint: 'Use read-only tools to gather evidence or explain the supported status.',
    }
  }
}

export function defaultRiskApproval(risk: ToolRisk): PermissionDecision {
  return risk === 'control' || risk === 'read' || risk === 'derive' ? 'allow' : 'deny'
}
