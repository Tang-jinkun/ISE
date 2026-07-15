import {
  AgentRuntime,
  ArtifactStore,
  DomainStateStore,
  PermissionManager,
  type AgentEventSink,
  type AgentRunResult,
  type ArtifactRepository,
  type DomainStateRepository,
  type ModelAdapter,
  type PermissionDecision,
  type ToolGuardDecision,
  type ToolRegistry,
} from '@ise/agent-core'
import type { SkillRegistry } from '@ise/skills-core'
import { IseAgentProfile } from './IseAgentProfile.ts'

export interface IseAgentHostOptions {
  model: ModelAdapter
  tools: ToolRegistry
  skills: SkillRegistry
  workspace: string
  maxTurns?: number
  eventSink?: AgentEventSink
  approve?: (
    toolName: string,
    input: unknown,
  ) => PermissionDecision | ToolGuardDecision | Promise<PermissionDecision | ToolGuardDecision>
  artifacts?: ArtifactRepository
  domainState?: DomainStateRepository
  signal?: AbortSignal
}

export class IseAgentHost {
  constructor(readonly options: IseAgentHostOptions) {}

  run(objective: string): Promise<AgentRunResult> {
    const runtime = new AgentRuntime({
      model: this.options.model,
      tools: this.options.tools,
      skills: this.options.skills,
      workspace: this.options.workspace,
      maxTurns: this.options.maxTurns ?? 12,
      artifacts: this.options.artifacts ?? new ArtifactStore(),
      domainState: this.options.domainState ?? new DomainStateStore(),
      eventSink: this.options.eventSink,
      signal: this.options.signal,
      profile: IseAgentProfile,
      permissions: new PermissionManager({
        approve: (tool, input) => this.options.approve?.(tool.name, input) ?? 'deny',
      }),
    })
    return runtime.run(objective)
  }
}
