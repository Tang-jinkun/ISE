import { tokenStorage } from './http';

const AGENT_BASE_URL = (
  (import.meta as any).env?.AGENT_BASE || '/SceneAgent'
).replace(/\/+$/, '');

export type SessionStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CreateSessionResponse = {
  sessionId: string;
  status: 'idle';
};

export type AttachmentView = {
  attachmentId: string;
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  fingerprint: `sha256:${string}`;
};

export type QueuedRunResponse = {
  runId: string;
  status: 'queued';
};

export type ModelProviderId =
  | 'deepseek'
  | 'openai'
  | 'qwen'
  | 'kimi'
  | 'zhipu'
  | 'openrouter'
  | 'siliconflow'
  | 'ollama'
  | 'lm-studio'
  | 'vllm'
  | 'custom';

export type ModelConfigInput = {
  provider: ModelProviderId;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
};

export type PublicModelConfig = {
  configured: boolean;
  provider: ModelProviderId | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
};

export type AgentArtifactView = {
  artifactId: string;
  type: string;
  version: number;
  createdAt: string;
  createdBy: 'user' | 'agent' | 'tool';
  logicalKey?: string;
  supersedes?: string;
  superseded: boolean;
  data: unknown;
  metadata?: Record<string, unknown>;
};

export type AgentArtifactListResponse = {
  artifacts: AgentArtifactView[];
};

export type ReviewTuple = {
  reviewId: string;
  artifactId: string;
  version: number;
  fingerprint: string;
};

export type ReviewTupleBody = Omit<ReviewTuple, 'reviewId'>;

export type AgentEventUnit = {
  eventUnitId: string;
  title: string;
  worldStateChange: string;
  participants: string[];
  locationRefs: string[];
  realWorldTime?: string;
  evidenceRefs: string[];
  inferenceRefs: string[];
  uncertainties: string[];
  narrativePurpose: string;
  importance: 'high' | 'medium' | 'low';
};

export type RevisionRequest = {
  baseArtifactId: string;
  eventUnits: AgentEventUnit[];
};

export type PublicAgentEventType =
  | 'run.started'
  | 'model.streaming'
  | 'tool.started'
  | 'tool.progress'
  | 'tool.completed'
  | 'tool.failed'
  | 'diagnostic.created'
  | 'artifact.created'
  | 'review.requested'
  | 'review.resolved'
  | 'compile.progress'
  | 'run.completed'
  | 'run.failed';

export type AgentEvent = {
  id: string;
  type: PublicAgentEventType;
  data: Record<string, unknown>;
};

export type AgentMessageView = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export type AgentTurnActivity = {
  id: string;
  type: 'thinking' | 'tool' | 'diagnostic';
  status: 'running' | 'completed' | 'failed';
  text?: string;
  name?: string;
  summary?: string;
  percentage?: number;
};

export type AgentTurnView = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  kind: 'generate' | 'answer';
  userMessage?: AgentMessageView;
  assistantMessage?: AgentMessageView;
  outcome?: {
    status: 'completed' | 'awaiting_user' | 'awaiting_dependency' | 'failed';
    finalAnswer: string;
    diagnostics?: Array<{ code: string; message: string; severity: 'info' | 'warning' | 'error' }>;
    metadata?: Record<string, unknown>;
  };
  activities: AgentTurnActivity[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export class AgentHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'AgentHttpError';
  }
}

export class AgentProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AgentProtocolError';
  }
}

type AgentRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  json?: unknown;
  signal?: AbortSignal;
};

type StreamAgentEventOptions = {
  lastEventId?: string;
  signal?: AbortSignal;
};

const PUBLIC_AGENT_EVENT_TYPES = new Set<PublicAgentEventType>([
  'run.started',
  'model.streaming',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
  'diagnostic.created',
  'artifact.created',
  'review.requested',
  'review.resolved',
  'compile.progress',
  'run.completed',
  'run.failed'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPublicAgentEventType(value: string): value is PublicAgentEventType {
  return PUBLIC_AGENT_EVENT_TYPES.has(value as PublicAgentEventType);
}

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function agentUrl(path: string): string {
  return `${AGENT_BASE_URL}${path}`;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function responseError(
  response: Response,
  payload: unknown,
  fallbackCode: string,
  fallbackMessage: string
): AgentHttpError {
  const nested = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  if (
    nested &&
    typeof nested.code === 'string' &&
    typeof nested.message === 'string'
  ) {
    return new AgentHttpError(
      response.status,
      nested.code,
      nested.message,
      nested.details
    );
  }
  return new AgentHttpError(
    response.status,
    fallbackCode,
    fallbackMessage
  );
}

async function agentRequest<T>(
  path: string,
  options: AgentRequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${tokenStorage.getToken(tokenStorage.keys.access)}`
  };
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    signal: options.signal
  };
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.json);
  }

  const response = await fetch(agentUrl(path), init);
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw responseError(
      response,
      payload,
      'AGENT_HTTP_ERROR',
      `Agent request failed with ${response.status}`
    );
  }
  return payload as T;
}

export const createAgentSession = (): Promise<CreateSessionResponse> =>
  agentRequest<CreateSessionResponse>('/sessions', {
    method: 'POST',
    json: {}
  });

export const attachAgentFile = (
  sessionId: string,
  body: { fileId: string }
): Promise<AttachmentView> =>
  agentRequest<AttachmentView>(
    `/sessions/${pathSegment(sessionId)}/attachments`,
    { method: 'POST', json: body }
  );

export const sendAgentMessage = (
  sessionId: string,
  body: { content: string }
): Promise<QueuedRunResponse> =>
  agentRequest<QueuedRunResponse>(
    `/sessions/${pathSegment(sessionId)}/messages`,
    { method: 'POST', json: body }
  );

export const listAgentArtifacts = (
  sessionId: string
): Promise<AgentArtifactListResponse> =>
  agentRequest<AgentArtifactListResponse>(
    `/sessions/${pathSegment(sessionId)}/artifacts`
  );

export const listAgentTurns = (
  sessionId: string
): Promise<{ turns: AgentTurnView[] }> =>
  agentRequest<{ turns: AgentTurnView[] }>(
    `/sessions/${pathSegment(sessionId)}/turns`
  );

export const approveAgentReview = (
  sessionId: string,
  reviewId: string,
  body: ReviewTupleBody
): Promise<QueuedRunResponse> =>
  agentRequest<QueuedRunResponse>(
    `/sessions/${pathSegment(sessionId)}/reviews/${pathSegment(reviewId)}/approve`,
    { method: 'POST', json: body }
  );

export const rejectAgentReview = (
  sessionId: string,
  reviewId: string,
  body: ReviewTupleBody & { reason?: string }
): Promise<{ reviewId: string; status: 'rejected' }> =>
  agentRequest<{ reviewId: string; status: 'rejected' }>(
    `/sessions/${pathSegment(sessionId)}/reviews/${pathSegment(reviewId)}/reject`,
    { method: 'POST', json: body }
  );

export const reviseEventPlan = (
  sessionId: string,
  artifactId: string,
  body: RevisionRequest
): Promise<{ artifact: AgentArtifactView; review: ReviewTuple }> =>
  agentRequest<{ artifact: AgentArtifactView; review: ReviewTuple }>(
    `/sessions/${pathSegment(sessionId)}/event-plans/${pathSegment(artifactId)}/revisions`,
    { method: 'POST', json: body }
  );

export const interruptAgentSession = (
  sessionId: string
): Promise<{ runId: string; status: 'cancelled' }> =>
  agentRequest<{ runId: string; status: 'cancelled' }>(
    `/sessions/${pathSegment(sessionId)}/interrupt`,
    { method: 'POST', json: {} }
  );

export const getModelConfig = (): Promise<PublicModelConfig> =>
  agentRequest<PublicModelConfig>('/model-config');

export const saveModelConfig = (
  body: ModelConfigInput
): Promise<PublicModelConfig> =>
  agentRequest<PublicModelConfig>('/model-config', {
    method: 'PUT',
    json: body
  });

export const clearModelConfig = (): Promise<PublicModelConfig> =>
  agentRequest<PublicModelConfig>('/model-config', { method: 'DELETE' });

export const discoverModels = (
  body: ModelConfigInput
): Promise<{ models: string[] }> =>
  agentRequest<{ models: string[] }>('/model-config/models', {
    method: 'POST',
    json: body
  });

export const testModelConfig = (
  body: ModelConfigInput
): Promise<{ ok: true; model: string; modelAvailable: boolean }> =>
  agentRequest<{ ok: true; model: string; modelAvailable: boolean }>(
    '/model-config/test',
    { method: 'POST', json: body }
  );

function parseSseFrame(frame: string): AgentEvent | undefined {
  let id: string | undefined;
  let type: string | undefined;
  const dataLines: string[] = [];
  let hasEventField = false;

  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'id') {
      hasEventField = true;
      id = value.trim();
    } else if (field === 'event') {
      hasEventField = true;
      type = value.trim();
    } else if (field === 'data') {
      hasEventField = true;
      dataLines.push(value);
    }
  }

  if (!hasEventField) return undefined;
  if (!id || !type || dataLines.length === 0) {
    throw new AgentProtocolError(
      'INVALID_SSE_EVENT',
      'Agent SSE event is missing id, event, or data'
    );
  }
  if (!isPublicAgentEventType(type)) {
    throw new AgentProtocolError(
      'UNKNOWN_EVENT_TYPE',
      `Agent SSE event ${id} has an unknown event type`
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join('\n')) as unknown;
  } catch {
    throw new AgentProtocolError(
      'INVALID_SSE_JSON',
      `Malformed SSE data for event ${id}`
    );
  }
  if (!isRecord(data)) {
    throw new AgentProtocolError(
      'INVALID_SSE_DATA',
      `Agent SSE event ${id} data must be an object`
    );
  }
  return { id, type, data };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let aborted = signal?.aborted ?? false;
  let cancellation: Promise<void> | undefined;
  const cancelReader = (reason?: unknown): Promise<void> => {
    cancellation ??= reader.cancel(reason).catch(() => undefined);
    return cancellation;
  };
  const onAbort = () => {
    aborted = true;
    void cancelReader(abortReason(signal!));
  };
  const throwIfAborted = () => {
    if (!signal || (!aborted && !signal.aborted)) return;
    aborted = true;
    throw abortReason(signal);
  };

  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (aborted) {
      const reason = abortReason(signal!);
      await cancelReader(reason);
      throw reason;
    }

    while (true) {
      const { done, value } = await reader.read();
      throwIfAborted();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) {
        buffer += decoder.decode();
        completed = true;
      }

      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary?.index !== undefined) {
        throwIfAborted();
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const event = parseSseFrame(frame);
        throwIfAborted();
        if (event) {
          yield event;
          throwIfAborted();
        }
        boundary = /\r?\n\r?\n/.exec(buffer);
      }

      if (done) {
        if (buffer.trim()) {
          throw new AgentProtocolError(
            'TRUNCATED_SSE_EVENT',
            'Agent SSE stream ended with a partial event'
          );
        }
        return;
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!completed) {
      await cancelReader(aborted && signal ? abortReason(signal) : undefined);
    }
    reader.releaseLock();
  }
}

export async function* streamAgentEvents(
  sessionId: string,
  options: StreamAgentEventOptions = {}
): AsyncGenerator<AgentEvent> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    Authorization: `Bearer ${tokenStorage.getToken(tokenStorage.keys.access)}`
  };
  if (options.lastEventId !== undefined) {
    headers['Last-Event-ID'] = options.lastEventId;
  }

  const response = await fetch(
    agentUrl(`/sessions/${pathSegment(sessionId)}/events`),
    { method: 'GET', headers, signal: options.signal }
  );
  if (!response.ok) {
    const payload = await readJsonPayload(response);
    throw responseError(
      response,
      payload,
      'SSE_CONNECT_FAILED',
      'Agent event stream is unavailable'
    );
  }
  if (!response.body) {
    throw new AgentHttpError(
      response.status,
      'SSE_CONNECT_FAILED',
      'Agent event stream is unavailable'
    );
  }
  yield* parseSseStream(response.body, options.signal);
}
