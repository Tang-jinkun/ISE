import {
  type Diagnostic,
  diagnosticSchema,
  type SceneProjectConfig,
  sceneProjectConfigSchema,
} from '@ise/runtime-contracts';
import { create } from 'zustand';
import type { AgentArtifactView, AgentEvent, AgentTurnView, ReviewTuple, SessionStatus } from '@/api/agent';
import { applyAgentEventToTurns } from '@/pages/newScript/agentTurns';

const COMPILED_RUNTIME_ARTIFACT = 'ise.canonical-runtime-plan/v1';
const CANONICAL_EVENT_ID = /^(0|[1-9]\d*)$/;

export type AgentActivity = AgentEvent;
export type AgentReviewView = ReviewTuple;

export type AgentSessionState = {
  sessionId: string | null;
  status: SessionStatus;
  lastEventId?: string;
  activities: AgentActivity[];
  turns: AgentTurnView[];
  artifacts: Record<string, AgentArtifactView>;
  activeReview: AgentReviewView | null;
  diagnostics: Diagnostic[];
  compiledConfig: SceneProjectConfig | null;
  latestCompletedRuntimeArtifactId: string | null;
  open(sessionId: string): void;
  applyEvent(sessionId: string, event: AgentEvent): void;
  replaceArtifacts(sessionId: string, artifacts: AgentArtifactView[]): void;
  replaceTurns(sessionId: string, turns: AgentTurnView[]): void;
  ingestArtifacts(sessionId: string, artifacts: AgentArtifactView[]): void;
  setActiveReview(sessionId: string, review: ReviewTuple): void;
  recordDiagnostic(
    sessionId: string,
    diagnostic: Diagnostic,
    status?: Extract<SessionStatus, 'failed' | 'cancelled'>,
  ): void;
};

type SessionData = Pick<
  AgentSessionState,
  | 'sessionId'
  | 'status'
  | 'lastEventId'
  | 'activities'
  | 'turns'
  | 'artifacts'
  | 'activeReview'
  | 'diagnostics'
  | 'compiledConfig'
  | 'latestCompletedRuntimeArtifactId'
>;

const emptySession = (sessionId: string | null): SessionData => ({
  sessionId,
  status: 'idle',
  lastEventId: undefined,
  activities: [],
  turns: [],
  artifacts: {},
  activeReview: null,
  diagnostics: [],
  compiledConfig: null,
  latestCompletedRuntimeArtifactId: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  return typeof source[key] === 'string' ? source[key] : undefined;
}

function numberField(source: Record<string, unknown>, key: string): number | undefined {
  return typeof source[key] === 'number' && Number.isFinite(source[key]) ? source[key] : undefined;
}

function definedFields(entries: Array<readonly [string, unknown]>): Record<string, unknown> {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

function sanitizeDiagnostic(value: unknown): Diagnostic | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = definedFields([
    ['code', stringField(value, 'code')],
    ['severity', stringField(value, 'severity')],
    ['recoverable', typeof value.recoverable === 'boolean' ? value.recoverable : false],
    ['eventUnitId', stringField(value, 'eventUnitId')],
    ['commandId', stringField(value, 'commandId')],
    ['assetId', stringField(value, 'assetId')],
    ['message', stringField(value, 'message')],
  ]);
  const parsed = diagnosticSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function sanitizedDiagnostics(value: unknown): Diagnostic[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const diagnostic = sanitizeDiagnostic(item);
        return diagnostic ? [diagnostic] : [];
      })
    : [];
}

function reviewTuple(data: Record<string, unknown>): ReviewTuple | undefined {
  const reviewId = stringField(data, 'reviewId');
  const artifactId = stringField(data, 'artifactId');
  const version = numberField(data, 'version');
  const fingerprint = stringField(data, 'fingerprint');
  if (
    !reviewId ||
    !artifactId ||
    !Number.isInteger(version) ||
    version === undefined ||
    version < 1 ||
    !fingerprint
  ) {
    return undefined;
  }
  return { reviewId, artifactId, version, fingerprint };
}

function sanitizeEvent(event: AgentEvent): AgentActivity {
  const data = event.data;
  let publicData: Record<string, unknown>;
  switch (event.type) {
    case 'run.started':
      publicData = definedFields([
        ['runId', stringField(data, 'runId')],
        ['status', stringField(data, 'status')],
      ]);
      break;
    case 'model.streaming':
      publicData = definedFields([
        ['runId', stringField(data, 'runId')],
        ['text', stringField(data, 'text')],
      ]);
      break;
    case 'tool.started':
    case 'tool.progress':
    case 'tool.completed':
    case 'tool.failed':
      publicData = definedFields([
        ['runId', stringField(data, 'runId')],
        ['toolCallId', stringField(data, 'toolCallId')],
        ['toolName', stringField(data, 'toolName')],
        ['summary', stringField(data, 'summary')],
        ['message', stringField(data, 'message')],
        ['percentage', numberField(data, 'percentage')],
        ['current', numberField(data, 'current')],
        ['total', numberField(data, 'total')],
        ['progress', numberField(data, 'progress')],
      ]);
      break;
    case 'diagnostic.created':
      publicData = definedFields([
        ['runId', stringField(data, 'runId')],
        ['code', stringField(data, 'code')],
        ['severity', stringField(data, 'severity')],
        ['summary', stringField(data, 'summary')],
      ]);
      break;
    case 'artifact.created':
      publicData = definedFields([
        ['runId', stringField(data, 'runId')],
        ['artifactId', stringField(data, 'artifactId')],
        ['artifactType', stringField(data, 'artifactType')],
        ['type', stringField(data, 'type')],
        ['version', numberField(data, 'version')],
        ['logicalKey', stringField(data, 'logicalKey')],
      ]);
      break;
    case 'review.requested': {
      const tuple = reviewTuple(data);
      publicData = tuple ? { ...tuple } : {};
      break;
    }
    case 'review.resolved':
      publicData = definedFields([
        ['reviewId', stringField(data, 'reviewId')],
        ['artifactId', stringField(data, 'artifactId')],
        ['version', numberField(data, 'version')],
        ['status', stringField(data, 'status')],
      ]);
      break;
    case 'compile.progress':
      publicData = definedFields([
        ['runId', stringField(data, 'runId')],
        ['stage', stringField(data, 'stage')],
        ['message', stringField(data, 'message')],
        ['current', numberField(data, 'current')],
        ['total', numberField(data, 'total')],
        ['progress', numberField(data, 'progress')],
      ]);
      break;
    case 'run.completed':
      publicData = definedFields([
        ['runId', stringField(data, 'runId')],
        ['status', stringField(data, 'status')],
        ['runtimeArtifactId', stringField(data, 'runtimeArtifactId')],
        ['finalAnswer', stringField(data, 'finalAnswer')],
      ]);
      break;
    case 'run.failed':
      publicData = definedFields([
        ['runId', stringField(data, 'runId')],
        ['status', stringField(data, 'status')],
        ['diagnostics', sanitizedDiagnostics(data.diagnostics)],
      ]);
      break;
  }
  return { id: event.id, type: event.type, data: publicData };
}

function isNewerEventId(current: string | undefined, incoming: string): boolean {
  if (!CANONICAL_EVENT_ID.test(incoming)) return false;
  if (current === undefined) return true;
  return BigInt(incoming) > BigInt(current);
}

function artifactRecord(artifacts: AgentArtifactView[]): Record<string, AgentArtifactView> {
  return Object.fromEntries(artifacts.map((artifact) => [artifact.artifactId, artifact]));
}

function compiledConfigFrom(
  artifacts: Record<string, AgentArtifactView>,
  completedArtifactId: string | null,
): SceneProjectConfig | null {
  const completedArtifact = completedArtifactId ? artifacts[completedArtifactId] : undefined;
  const compiled = completedArtifactId
    ? completedArtifact?.type === COMPILED_RUNTIME_ARTIFACT
      ? completedArtifact
      : undefined
    : Object.values(artifacts)
        .filter((artifact) => artifact.type === COMPILED_RUNTIME_ARTIFACT && !artifact.superseded)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.artifactId.localeCompare(left.artifactId),
        )[0];
  if (!compiled || !isRecord(compiled.data)) return null;
  const parsed = sceneProjectConfigSchema.safeParse(compiled.data.sceneProjectConfig);
  return parsed.success ? parsed.data : null;
}

export const useAgentSessionStore = create<AgentSessionState>((set) => ({
  ...emptySession(null),

  open: (sessionId) =>
    set((state) => (state.sessionId === sessionId ? state : emptySession(sessionId))),

  applyEvent: (sessionId, event) =>
    set((state) => {
      if (state.sessionId !== sessionId || !isNewerEventId(state.lastEventId, event.id)) {
        return state;
      }

      const activity = sanitizeEvent(event);
      const next: Partial<AgentSessionState> = {
        lastEventId: event.id,
        activities: [...state.activities, activity],
        turns: applyAgentEventToTurns(state.turns, activity),
      };

      if (event.type === 'run.started' || event.type === 'compile.progress') {
        next.status = 'running';
      }
      if (event.type === 'review.requested') {
        const tuple = reviewTuple(event.data);
        if (tuple) {
          next.status = 'awaiting_review';
          next.activeReview = tuple;
        }
      }
      if (event.type === 'review.resolved') {
        next.activeReview = null;
        if (state.status === 'awaiting_review') next.status = 'running';
      }
      if (event.type === 'run.completed') {
        next.status = 'completed';
        const runtimeArtifactId = stringField(event.data, 'runtimeArtifactId');
        next.latestCompletedRuntimeArtifactId = runtimeArtifactId ?? null;
        next.compiledConfig = runtimeArtifactId
          ? compiledConfigFrom(state.artifacts, runtimeArtifactId)
          : null;
      }
      if (event.type === 'run.failed') {
        next.status = event.data.status === 'cancelled' ? 'cancelled' : 'failed';
        next.diagnostics = sanitizedDiagnostics(event.data.diagnostics);
      }

      return next;
    }),

  replaceArtifacts: (sessionId, artifacts) =>
    set((state) => {
      if (state.sessionId !== sessionId) return state;
      const nextArtifacts = artifactRecord(artifacts);
      return {
        artifacts: nextArtifacts,
        compiledConfig: compiledConfigFrom(nextArtifacts, state.latestCompletedRuntimeArtifactId),
      };
    }),

  replaceTurns: (sessionId, turns) =>
    set((state) => state.sessionId === sessionId ? { turns: structuredClone(turns) } : state),

  ingestArtifacts: (sessionId, artifacts) =>
    set((state) => {
      if (state.sessionId !== sessionId) return state;
      const nextArtifacts = {
        ...state.artifacts,
        ...artifactRecord(artifacts),
      };
      return {
        artifacts: nextArtifacts,
        compiledConfig: compiledConfigFrom(nextArtifacts, state.latestCompletedRuntimeArtifactId),
      };
    }),

  setActiveReview: (sessionId, review) =>
    set((state) =>
      state.sessionId === sessionId
        ? { activeReview: review, status: 'awaiting_review' }
        : state,
    ),

  recordDiagnostic: (sessionId, diagnostic, status) =>
    set((state) => {
      if (state.sessionId !== sessionId) return state;
      return {
        diagnostics: [...state.diagnostics, diagnostic],
        ...(status ? { status } : {}),
      };
    }),
}));
