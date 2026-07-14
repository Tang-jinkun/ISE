export type SkillSource = 'builtin' | 'user' | 'project'
export type SkillExecution = 'inline' | 'isolated'
export type InvocationKind = 'model' | 'user'

export interface SkillDefinition {
  name: string
  description: string
  whenToUse?: string
  intentTags?: string[]
  triggerExamples?: string[]
  argumentHint?: string
  applicableDomains?: string[]
  applicableActions?: string[]
  instructions: string
  source: SkillSource
  allowedTools?: string[]
  userInvocable: boolean
  modelInvocable: boolean
  execution: SkillExecution
  version?: string
  rootDir?: string
  filePath?: string
  resources?: SkillResourceSummary[]
}

export type SkillResourceKind = 'example' | 'reference'

export interface SkillResourceSummary {
  kind: SkillResourceKind
  path: string
  bytes: number
}

export interface SkillResourceContent extends SkillResourceSummary {
  content: string
}

export interface SkillSummary {
  name: string
  description: string
  whenToUse?: string
  intentTags?: string[]
  triggerExamples?: string[]
  argumentHint?: string
  applicableDomains?: string[]
  applicableActions?: string[]
  source: SkillSource
  execution: SkillExecution
  version?: string
  userInvocable: boolean
  modelInvocable: boolean
}

export interface ResolvedSkillActivation {
  name: string
  invocation: InvocationKind
  args: string
  instructions: string
  allowedTools: string[]
  source: SkillSource
  execution: SkillExecution
  version?: string
  contentHash: string
}

export interface SkillDiagnostic {
  severity: 'error' | 'warning'
  message: string
  path?: string
}

export interface SkillLoadResult {
  skills: SkillDefinition[]
  diagnostics: SkillDiagnostic[]
}

export interface SkillInvocationRecord {
  skill: string
  source: SkillSource
  version?: string
  invocation: InvocationKind
  execution: SkillExecution
  authorization: 'not-required' | 'approved' | 'denied'
  tools: string[]
  timestamp: string
  outcome: 'success' | 'denied' | 'error'
}

export interface SkillExecutionContext {
  availableTools: readonly string[]
  activeSkills?: Set<string>
  requestedResources?: readonly string[]
  authorizeProjectSkill?: (skill: SkillDefinition) => boolean | Promise<boolean>
  readResource?: (skill: SkillDefinition, path: string) => SkillResourceContent | Promise<SkillResourceContent>
  runIsolated?: (input: {
    skill: SkillDefinition
    instructions: string
    allowedTools: readonly string[]
  }) => string | Promise<string>
  onInvocation?: (record: SkillInvocationRecord) => void
}

export type SkillExecutionResult =
  | {
      type: 'inline'
      skill: string
      message: { role: 'user'; content: string }
      allowedTools: string[]
    }
  | {
      type: 'isolated'
      skill: string
      result: string
      allowedTools: string[]
    }

export interface SkillToolInput {
  skill: string
  args?: string
  resources?: string[]
}
