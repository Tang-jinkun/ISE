import {
  ArtifactStore,
  DomainStateStore,
  type AgentContext,
} from '@ise/agent-core'

export function testAgentContext(): AgentContext {
  return {
    workspace: process.cwd(),
    goal: {
      objective: 'test',
      status: 'active',
      turnCount: 0,
      maxTurns: 10,
      evidence: [],
      remainingIssues: [],
      startedAt: new Date(0).toISOString(),
    },
    artifacts: new ArtifactStore(),
    domainState: new DomainStateStore(),
  }
}
