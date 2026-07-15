import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentHttpError,
  AgentProtocolError,
  approveAgentReview,
  attachAgentFile,
  createAgentSession,
  interruptAgentSession,
  listAgentArtifacts,
  rejectAgentReview,
  reviseEventPlan,
  sendAgentMessage,
  streamAgentEvents,
  type AgentEventUnit,
  type ReviewTupleBody
} from './agent';
import { tokenStorage } from './http';

const fetchMock = vi.fn<typeof fetch>();

function mockJsonResponse(status: number, payload: unknown): void {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  );
}

function mockTextResponse(status: number, payload: string): void {
  fetchMock.mockResolvedValueOnce(
    new Response(payload, {
      status,
      headers: { 'Content-Type': 'text/plain' }
    })
  );
}

function mockEventStream(chunks: string[]): void {
  const encoder = new TextEncoder();
  fetchMock.mockResolvedValueOnce(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        }
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    )
  );
}

async function collectEvents(chunks: string[]) {
  mockEventStream(chunks);
  const events = [];
  for await (const event of streamAgentEvents('session-1')) events.push(event);
  return events;
}

const reviewTuple: ReviewTupleBody = {
  artifactId: 'artifact-1',
  version: 3,
  fingerprint: `sha256:${'a'.repeat(64)}`
};

const eventUnits: AgentEventUnit[] = [
  {
    eventUnitId: 'event-1',
    title: 'Intercept',
    worldStateChange: 'Aircraft intercepts the target',
    participants: ['aircraft-1'],
    locationRefs: ['location-1'],
    realWorldTime: '2026-07-15T00:00:00Z',
    evidenceRefs: ['evidence-1'],
    inferenceRefs: [],
    uncertainties: [],
    narrativePurpose: 'Opening engagement',
    importance: 'high'
  }
];

describe('Agent REST client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    localStorage.clear();
    tokenStorage.setToken(tokenStorage.keys.access, 'jwt');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an empty session with POST, bearer auth, and no body or content type', async () => {
    const response = { sessionId: 'session-1', status: 'idle' as const };
    mockJsonResponse(201, response);

    await expect(createAgentSession()).resolves.toEqual(response);

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toMatch(/\/sessions$/);
    expect(init).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(init).not.toHaveProperty('body');
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer jwt'
      })
    );
    expect(init?.headers).not.toEqual(
      expect.objectContaining({ 'Content-Type': expect.anything() })
    );
  });

  it('sends the objective only through the message endpoint', async () => {
    mockJsonResponse(202, { runId: 'run-1', status: 'queued' });

    await sendAgentMessage('session-1', { content: 'Generate a 180 second replay' });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/sessions\/session-1\/messages$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Generate a 180 second replay' })
      })
    );
  });

  it('uses the frozen attachment route and body', async () => {
    const response = {
      attachmentId: 'attachment-1',
      fileId: 'file-1',
      name: 'report.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 42,
      fingerprint: `sha256:${'b'.repeat(64)}`
    };
    mockJsonResponse(201, response);

    await expect(
      attachAgentFile('session-1', { fileId: 'file-1' })
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/sessions\/session-1\/attachments$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fileId: 'file-1' })
      })
    );
  });

  it('returns the artifact list wire object without unwrapping it', async () => {
    const response = {
      artifacts: [
        {
          artifactId: 'artifact-1',
          type: 'event-plan/draft',
          version: 1,
          createdAt: '2026-07-15T00:00:00.000Z',
          createdBy: 'agent',
          superseded: false,
          data: { planId: 'plan-1' }
        }
      ]
    };
    mockJsonResponse(200, response);

    await expect(listAgentArtifacts('session-1')).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/sessions\/session-1\/artifacts$/),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('sends the exact review tuple to approve', async () => {
    mockJsonResponse(202, { runId: 'run-2', status: 'queued' });

    await approveAgentReview('session-1', 'review-1', reviewTuple);

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /\/sessions\/session-1\/reviews\/review-1\/approve$/
      ),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(reviewTuple)
      })
    );
  });

  it('sends the exact review tuple and optional reason to reject', async () => {
    const body = { ...reviewTuple, reason: 'Revise the ordering' };
    mockJsonResponse(200, { reviewId: 'review-1', status: 'rejected' });

    await rejectAgentReview('session-1', 'review-1', body);

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /\/sessions\/session-1\/reviews\/review-1\/reject$/
      ),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) })
    );
  });

  it('uses the frozen event-plan revision route and body', async () => {
    const response = {
      artifact: {
        artifactId: 'artifact-2',
        type: 'event-plan/draft',
        version: 4,
        createdAt: '2026-07-15T00:00:00.000Z',
        createdBy: 'user',
        superseded: false,
        data: { eventUnits }
      },
      review: { reviewId: 'review-2', ...reviewTuple, version: 4 }
    };
    const body = { baseArtifactId: 'artifact-1', eventUnits };
    mockJsonResponse(201, response);

    await expect(
      reviseEventPlan('session-1', 'artifact-1', body)
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /\/sessions\/session-1\/event-plans\/artifact-1\/revisions$/
      ),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) })
    );
  });

  it('interrupts with the required empty JSON body', async () => {
    mockJsonResponse(202, { runId: 'run-1', status: 'cancelled' });

    await interruptAgentSession('session-1');

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/sessions\/session-1\/interrupt$/),
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' })
      })
    );
  });

  it('reads the nested Agent JSON error contract', async () => {
    mockJsonResponse(409, {
      error: {
        code: 'STALE_REVIEW_TUPLE',
        message: 'The review tuple is stale',
        details: { expectedVersion: 4 }
      }
    });

    const error = await approveAgentReview(
      'session-1',
      'review-1',
      reviewTuple
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentHttpError);
    expect(error).toMatchObject({
      status: 409,
      code: 'STALE_REVIEW_TUPLE',
      message: 'The review tuple is stale',
      details: { expectedVersion: 4 }
    });
  });

  it('uses a generic non-JSON error without leaking the bearer token', async () => {
    const token = 'jwt-secret-that-must-not-leak';
    tokenStorage.setToken(tokenStorage.keys.access, token);
    mockTextResponse(502, '<html>bad gateway</html>');

    const error = await createAgentSession().catch(
      (caught: unknown) => caught
    );
    const [url] = fetchMock.mock.calls.at(-1)!;

    expect(error).toBeInstanceOf(AgentHttpError);
    expect(error).toMatchObject({
      status: 502,
      code: 'AGENT_HTTP_ERROR',
      message: 'Agent request failed with 502'
    });
    expect(String(url)).not.toContain(token);
    expect(String(error)).not.toContain(token);
  });
});

describe('Agent SSE client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    localStorage.clear();
    tokenStorage.setToken(tokenStorage.keys.access, 'jwt');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses split CRLF frames, multiple data lines, and heartbeat comments', async () => {
    await expect(
      collectEvents([
        ': heartbeat\r\n\r\nid: 7\r\nevent: artifact.created\r\nda',
        'ta: {"artifactId":\r\ndata: "artifact-1"}\r\n\r\n'
      ])
    ).resolves.toEqual([
      {
        id: '7',
        type: 'artifact.created',
        data: { artifactId: 'artifact-1' }
      }
    ]);
  });

  it.each([
    'run.started',
    'tool.started',
    'tool.progress',
    'artifact.created',
    'review.requested',
    'review.resolved',
    'compile.progress',
    'run.completed',
    'run.failed'
  ] as const)('accepts the public %s event type', async (type) => {
    await expect(
      collectEvents([`id: 1\nevent: ${type}\ndata: {}\n\n`])
    ).resolves.toEqual([{ id: '1', type, data: {} }]);
  });

  it('sends bearer and Last-Event-ID headers without putting the token in the URL', async () => {
    const token = 'jwt-secret-that-must-not-leak';
    tokenStorage.setToken(tokenStorage.keys.access, token);
    mockEventStream([]);

    for await (const _event of streamAgentEvents('session-1', {
      lastEventId: '6'
    })) {
      break;
    }

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toMatch(/\/sessions\/session-1\/events$/);
    expect(String(url)).not.toContain(token);
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        'Last-Event-ID': '6'
      })
    );
  });

  it('rejects malformed event JSON', async () => {
    mockEventStream(['id: 8\nevent: run.started\ndata: {bad-json}\n\n']);

    const error = await streamAgentEvents('session-1')
      .next()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentProtocolError);
    expect(error).toMatchObject({ code: 'INVALID_SSE_JSON' });
  });

  it('rejects unknown or internal event types', async () => {
    mockEventStream([
      'id: 9\nevent: message.delta\ndata: {"content":"hidden"}\n\n'
    ]);

    const error = await streamAgentEvents('session-1')
      .next()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentProtocolError);
    expect(error).toMatchObject({ code: 'UNKNOWN_EVENT_TYPE' });
  });

  it.each([
    ['id', 'event: run.started\ndata: {}\n\n'],
    ['type', 'id: 10\ndata: {}\n\n'],
    ['data', 'id: 10\nevent: run.started\n\n']
  ])('rejects an event missing %s', async (_field, frame) => {
    mockEventStream([frame]);

    const error = await streamAgentEvents('session-1')
      .next()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentProtocolError);
    expect(error).toMatchObject({ code: 'INVALID_SSE_EVENT' });
  });

  it('rejects a non-object data payload', async () => {
    mockEventStream(['id: 11\nevent: run.started\ndata: []\n\n']);

    const error = await streamAgentEvents('session-1')
      .next()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentProtocolError);
    expect(error).toMatchObject({ code: 'INVALID_SSE_DATA' });
  });

  it('rejects a partial frame at the end of the stream', async () => {
    mockEventStream(['id: 12\nevent: run.started\ndata: {}']);

    const error = await streamAgentEvents('session-1')
      .next()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentProtocolError);
    expect(error).toMatchObject({ code: 'TRUNCATED_SSE_EVENT' });
  });

  it('cancels and unlocks the reader when the consumer stops early', async () => {
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('id: 13\nevent: run.started\ndata: {}\n\n')
        );
      },
      cancel
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })
    );

    for await (const _event of streamAgentEvents('session-1')) break;

    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('rejects abort before yielding a second frame buffered in the same chunk', async () => {
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'id: 14\nevent: run.started\ndata: {}\n\n' +
              'id: 15\nevent: run.completed\ndata: {}\n\n'
          )
        );
      },
      cancel
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })
    );
    const controller = new AbortController();
    const reason = new DOMException('Session replaced', 'AbortError');
    const iterator = streamAgentEvents('session-1', {
      signal: controller.signal
    });

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { id: '14', type: 'run.started', data: {} }
    });
    controller.abort(reason);
    const outcome = await iterator.next().then(
      (value) => ({ status: 'resolved' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    );
    await iterator.return(undefined);

    expect(outcome).toEqual({ status: 'rejected', error: reason });
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(stream.locked).toBe(false);
  });

  it('cancels and unlocks the reader when the request is aborted', async () => {
    const cancel = vi.fn();
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        markReadStarted();
      },
      cancel
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })
    );
    const controller = new AbortController();
    const reason = new DOMException('Stopped', 'AbortError');
    const pending = streamAgentEvents('session-1', {
      signal: controller.signal
    }).next();

    await readStarted;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(stream.locked).toBe(false);
  });
});
