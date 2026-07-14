import type { TurnOutcome } from './turnOutcome.ts'
export type { AgentProfile } from './profiles/AgentProfile.ts'

export type ToolRisk = 'control' | 'read' | 'derive' | 'write' | 'execute'

export type ToolVisibilityReason =
  | 'visible'
  | 'tool_filter_denied'
  | 'policy_denied'
  | 'missing_facts'
  | 'missing_confirmation'
  | 'forbidden_side_effect'
  | 'stale_surface'
  | 'insufficient_scope'
  | 'not_in_current_tool_surface'

export type ToolGuardDenialReason =
  | ToolVisibilityReason
  | 'permission_denied'
  | 'confirmation_required'
  | 'invalid_tool_input'

export interface RecoveryOption {
  code:
    | 'read_business_facts'
    | 'request_confirmation'
    | 'use_current_surface'
  | 'refresh_surface'
  | 'load_relevant_skill'
  | 'explain_supported_status'
  | 'ask_user_clarification'
  | 'retry_visible_tool'
  | 'produce_required_evidence'
  label: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface ToolVisibilityDecision {
  visible: boolean
  reason: ToolVisibilityReason
  message?: string
  recoveryHint?: string
  recoveryOptions?: RecoveryOption[]
}

export interface ToolGuardDecision {
  decision: 'allow' | 'deny' | 'defer'
  /** Trusted host-side binding for this exact allowed tool call. */
  confirmationId?: string
  reason?: ToolGuardDenialReason
  message?: string
  recoveryHint?: string
  recoveryOptions?: RecoveryOption[]
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export interface ToolCallResolution {
  tool: AgentTool
  call: ToolCall
  metadata?: Record<string, unknown>
}

export type AgentMessage =
  | { role: 'system' | 'user'; content: string; hidden?: boolean }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; isError?: boolean }

export interface ModelToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type ModelResponseFormat =
  | { type: 'text' }
  | {
      type: 'json_schema'
      jsonSchema: {
        name: string
        schema: Record<string, unknown>
        strict?: boolean
      }
    }

export interface ModelRequest {
  messages: readonly AgentMessage[]
  tools: readonly ModelToolDefinition[]
  responseFormat?: ModelResponseFormat
  signal?: AbortSignal
}

export interface ModelResponse {
  content: string
  toolCalls?: ToolCall[]
}

export type FinalAnswerGuardResult =
  | { ok: true }
  | { ok: false; reason: string }

// ── Streaming ────────────────────────────────────────────────────────────────

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argumentsDelta: string }
  | { type: 'done' }

export interface ModelAdapter {
  complete(request: ModelRequest): Promise<ModelResponse>
  /** Optional streaming variant. Falls back to complete() if not implemented. */
  completeStreaming?(request: ModelRequest): AsyncIterable<StreamChunk>
}

// ── Tool Progress ────────────────────────────────────────────────────────────

export interface ToolProgressEvent {
  message: string
  percentage?: number
}

export interface GoalState {
  objective: string
  status: 'active' | 'completed' | 'blocked' | 'failed'
  turnCount: number
  maxTurns: number
  progress?: string
  nextStep?: string
  finalSummary?: string
  evidence: string[]
  remainingIssues: string[]
  startedAt: string
}

export interface SkillScope {
  name: string
  allowedTools: Set<string>
  activatedAtTurn: number
}

export type ArtifactCreator = 'user' | 'agent' | 'tool'

export interface Artifact<T = unknown> {
  id: string
  type: string
  version: number
  createdAt: string
  createdBy: ArtifactCreator
  data: T
  metadata?: Record<string, unknown>
  // ── Evidence Ledger ──
  /**
   * Stable identity of the logical entity this artifact represents. Two
   * artifacts with the same logicalKey are versions of the same thing — a
   * newer one supersedes the older, regardless of which turn produced it.
   * Defaults to `id` when not set. scopeKey is NOT part of identity.
   */
  logicalKey?: string
  /** Scope key "turn:N" or "turn:N:skill:name". Provenance only. Injected by runtime. */
  scopeKey?: string
  /** ID of the artifact this one supersedes (version chain). */
  supersedes?: string
  /** True when a newer artifact has superseded this one. */
  superseded?: boolean
}

export interface ArtifactInput<T = unknown> {
  id?: string
  type: string
  version?: number
  createdAt?: string
  createdBy: ArtifactCreator
  data: T
  metadata?: Record<string, unknown>
  /** See Artifact.logicalKey. Defaults to `id` when omitted. */
  logicalKey?: string
  scopeKey?: string
  supersedes?: string
  /**
   * Set on rehydration (restoring a persisted ledger): preserve the
   * artifact's superseded flag verbatim instead of recomputing supersedes.
   */
  superseded?: boolean
}

export type DomainState = Record<string, unknown>
export type DomainStatePatch = Record<string, unknown>

export interface Diagnostic {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
  relatedArtifactIds?: string[]
}

export interface AgentActionEvent {
  runId: string
  turn: number
  eventType:
    | 'run.started'
    | 'model.responded'
    | 'model.streaming'
    | 'tool.started'
    | 'tool.progress'
    | 'tool.completed'
    | 'tool.deferred'
    | 'tool.failed'
    | 'state.changed'
    | 'artifact.created'
    | 'diagnostic.created'
    | 'skill.activated'
    | 'loop.detected'
    | 'run.paused'
    | 'run.completed'
    | 'run.failed'
  summary: string
  status: 'started' | 'waiting' | 'completed' | 'failed'
  toolCallId?: string
  data?: Record<string, unknown>
  durationMs?: number
  timestamp: string
}

export interface AgentEventSink {
  emit(event: AgentActionEvent): Promise<void>
}

export interface ArtifactRepository {
  create<T>(input: ArtifactInput<T>): Artifact<T>
  createMany(inputs: readonly ArtifactInput[]): Artifact[]
  get<T = unknown>(id: string): Artifact<T> | undefined
  list(type?: string, options?: { scopeKey?: string; includeSuperseded?: boolean }): Artifact[]
  /** Set by the runtime at the start of each turn for scope-aware writes. */
  currentScopeKey: string
  /** @deprecated Use scope-aware supersession. */
  delete(id: string): boolean
}

export interface DomainStateRepository {
  snapshot<T extends DomainState = DomainState>(): T
  applyPatch(patch: DomainStatePatch): DomainState
}

export interface AgentContext {
  workspace: string
  goal: GoalState
  artifacts: ArtifactRepository
  domainState: DomainStateRepository
  skillScope?: SkillScope
  signal?: AbortSignal
  /** Set by the worker when it consumes a user confirmation; read by tools
   *  that mint user-authored artifacts (confirmation-record, disambiguation)
   *  so the artifact carries a cryptographic binding to the specific
   *  confirmation, not just the tool's risk profile. */
  lastConsumedConfirmationId?: string
  /** Execution-scoped metadata for the currently running resolved tool call. */
  currentToolCallMetadata?: Record<string, unknown>
}

export interface AgentToolResult {
  content: string
  artifacts?: ArtifactInput[]
  statePatch?: DomainStatePatch
  diagnostics?: Diagnostic[]
  sceneRepoCandidates?: SceneRepoProvisionalCandidate[]
  hiddenMessages?: AgentMessage[]
  activateSkill?: { name: string; allowedTools: string[] }
  goalUpdate?: Partial<
    Pick<
      GoalState,
      | 'status'
      | 'progress'
      | 'nextStep'
      | 'finalSummary'
      | 'evidence'
      | 'remainingIssues'
    >
  >
}

export interface SceneRepoProvisionalCandidate {
  recordType: 'observation_candidate' | 'semantic_definition_candidate' | 'result_candidate'
  contentType: string
  payload?: Record<string, unknown>
  pointer?: Record<string, unknown>
  contentHash?: string
  semanticHash?: string
  fingerprints?: Record<string, string>
  lineage?: {
    usedStableRecordIds?: string[]
    usedProvisionalIds?: string[]
    usedRefNames?: string[]
    inputFingerprints?: Record<string, string>
  }
}

export interface AgentToolPolicy {
  visibility?: {
    reason?: string
    recoveryHint?: string
  }
  scope?: {
    /**
     * Domains in which this tool may be exposed to the model. Tool scope is
     * declared by the tool assembly layer, never inferred from its name.
     */
    domains: string[]
    capabilities?: string[]
  }
  presentation?: {
    /**
     * User-facing result surface produced by this tool. This is intentionally
     * generic so domain tools can publish maps, summaries, downloads, or
     * reports without making workflow gates depend on tool-specific names.
     */
    kind: string
    artifactTypes?: string[]
  }
  completion?: {
    /**
     * Artifact evidence that proves this tool can complete a turn. Hosts should
     * evaluate this declaratively instead of hard-coding tool or artifact names
     * into completion gates.
     */
    terminalEvidence?: {
      artifactTypes: string[]
      description?: string
      stages?: string[]
    }[]
  }
  confirmation?: {
    /**
     * Controls what the host should do after the user approves a deferred
     * protected tool call.
     *
     * - execute-approved-input: execute the exact deferred input before asking
     *   the model to continue.
     * - resume-model: keep the approval for the next model-planned tool call.
     */
    approvedAction?: 'execute-approved-input' | 'resume-model'
    /**
     * When true, the host may complete the current turn immediately after the
     * approved tool input executes successfully instead of resuming model
     * planning. Use this for write tools whose approved side effect already
     * satisfies the user's request.
     */
    completeAfterApprovedExecution?: boolean
    continueAfterApprovedExecution?: {
      maxSteps?: number
      nextTool?: string
      inputFromResult?: (input: {
        nextTool: AgentTool
        approvedTool: AgentTool
        approvedInput: unknown
        result: AgentToolResult
      }) => unknown
    }
    summary?: (input: unknown, state: DomainState) => Record<string, unknown> | undefined
    ui?: (input: unknown, state: DomainState) => Record<string, unknown> | undefined
    successMessage?: (result: AgentToolResult) => string
  }
  mutation?: {
    /**
     * Artifact types whose facts are refreshed by this tool after it mutates
     * backend state. Hosts and workflow gates can use this as a declarative
     * contract instead of relying on tool-name-specific assumptions.
     */
    refreshesArtifacts?: string[]
  }
}

export interface AgentTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  risk: ToolRisk
  policy?: AgentToolPolicy
  /**
   * When true, this tool may execute concurrently with other safe tools.
   * Must ONLY be true when the tool has zero side-effects: no state patches,
   * no artifact writes, no backend mutations.  Defaults to false.
   * Do NOT derive this from `risk` — a 'read' tool may still mutate domain state.
   */
  isConcurrencySafe?: boolean
  /** If set and result.content exceeds this many bytes, the full content is
   *  persisted as a `tool-result` artifact and only a compact pointer is
   *  returned to the model. Keeps the context window lean for large outputs. */
  persistResultAboveBytes?: number
  /**
   * Deterministically binds validated turn state into the model-proposed
   * tool input. Explicit structured values may override model guesses.
   */
  bindStructuredInput?: (
    input: unknown,
    context: StructuredToolInputContext,
  ) => unknown
  execute(input: unknown, context: AgentContext, onProgress?: (event: ToolProgressEvent) => void): Promise<AgentToolResult>
}

export interface StructuredToolInputSlot {
  key: string
  value?: unknown
  state: 'resolved' | 'cleared' | 'missing'
  source: string
  confidence: number
  explicitlyChanged: boolean
  reason?: string
  metadata?: Readonly<Record<string, unknown>>
}

export interface StructuredToolInputContext {
  resolvedSlots: Readonly<Record<string, StructuredToolInputSlot>>
  groundedTurnId: string
  taskId?: string
  metadata?: Readonly<Record<string, unknown>>
}

export interface TranscriptEvent {
  timestamp: string
  type:
    | 'message'
    | 'tool_call'
    | 'tool_result'
    | 'permission'
    | 'goal'
    | 'artifact'
    | 'state'
    | 'diagnostic'
  data: unknown
}

export interface AgentRunResult {
  runId: string
  goal: GoalState
  turnOutcome?: TurnOutcome
  messages: AgentMessage[]
  transcript: TranscriptEvent[]
  /** Active evidence set (superseded artifacts excluded). For gates/reports. */
  artifacts: Artifact[]
  /**
   * Full append-only ledger including superseded artifacts. Persisted at
   * checkpoint so the version history survives a resume; rehydrated via
   * ArtifactStore.createMany (entries carry scopeKey → rehydration path).
   */
  artifactLedger: Artifact[]
  domainState: DomainState
  diagnostics: Diagnostic[]
}
