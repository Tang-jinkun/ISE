import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentArtifactView,
  type AgentEvent,
  AgentHttpError,
  AgentProtocolError,
  listAgentArtifacts,
  streamAgentEvents,
} from '@/api/agent';
import { useAgentSessionStore } from '@/stores/agentSessionStore';
import { useAgentSession } from './useAgentSession';

vi.mock('@/api/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/agent')>();
  return {
    ...actual,
    listAgentArtifacts: vi.fn(),
    streamAgentEvents: vi.fn(),
  };
});

const listArtifactsMock = vi.mocked(listAgentArtifacts);
const streamEventsMock = vi.mocked(streamAgentEvents);

const compiledConfig: SceneProjectConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'document-1',
  eventPlanArtifactId: 'event-plan-1',
  runtimePlanArtifactId: 'runtime-plan-1',
  totalDurationMs: 0,
  entities: [],
  tracks: [],
  diagnostics: [],
};

function artifact(artifactId: string, type: string, data: unknown): AgentArtifactView {
  return {
    artifactId,
    type,
    version: 1,
    createdAt: '2026-07-15T00:00:00.000Z',
    createdBy: 'agent',
    superseded: false,
    data,
  };
}

async function* emptyStream(): AsyncGenerator<AgentEvent> {}

async function* eventStream(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) yield event;
}

async function* failedStream(error: unknown): AsyncGenerator<AgentEvent> {
  for (const event of [] as AgentEvent[]) yield event;
  throw error;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useAgentSession', () => {
  beforeEach(() => {
    useAgentSessionStore.setState(useAgentSessionStore.getInitialState(), true);
    listArtifactsMock.mockReset();
    streamEventsMock.mockReset();
    listArtifactsMock.mockResolvedValue({ artifacts: [] });
    streamEventsMock.mockImplementation(() => emptyStream());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hydrates artifacts on resume and after artifact and review events', async () => {
    const compiled = artifact('compiled-1', 'ise.canonical-runtime-plan/v1', {
      sceneProjectConfig: compiledConfig,
    });
    listArtifactsMock
      .mockResolvedValueOnce({ artifacts: [] })
      .mockResolvedValueOnce({ artifacts: [compiled] })
      .mockResolvedValueOnce({
        artifacts: [compiled, artifact('draft-1', 'ise.event-plan-draft/v1', { eventUnits: [] })],
      });
    streamEventsMock.mockImplementation(() =>
      eventStream([
        {
          id: '1',
          type: 'artifact.created',
          data: {
            artifactId: 'compiled-1',
            artifactType: 'ise.canonical-runtime-plan/v1',
            version: 1,
          },
        },
        {
          id: '2',
          type: 'review.requested',
          data: {
            reviewId: 'review-1',
            artifactId: 'draft-1',
            version: 1,
            fingerprint: `sha256:${'a'.repeat(64)}`,
          },
        },
      ]),
    );

    renderHook(() => useAgentSession('session-1'));

    await waitFor(() => expect(listArtifactsMock).toHaveBeenCalledTimes(3));
    expect(listArtifactsMock).toHaveBeenNthCalledWith(1, 'session-1');
    expect(useAgentSessionStore.getState().compiledConfig).toEqual(compiledConfig);
    expect(useAgentSessionStore.getState().artifacts).toHaveProperty('draft-1');
  });

  it('reads Last-Event-ID only from the current same-session state', async () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.applyEvent('session-1', {
      id: '7',
      type: 'run.started',
      data: { runId: 'run-1' },
    });

    renderHook(() => useAgentSession('session-1'));

    await waitFor(() => expect(streamEventsMock).toHaveBeenCalledTimes(1));
    expect(streamEventsMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ lastEventId: '7' }),
    );
  });

  it('does not apply hydration from an obsolete session generation', async () => {
    const oldHydration = deferred<{ artifacts: AgentArtifactView[] }>();
    listArtifactsMock.mockImplementation((sessionId) =>
      sessionId === 'session-old'
        ? oldHydration.promise
        : Promise.resolve({
            artifacts: [
              artifact('new-draft', 'ise.event-plan-draft/v1', {
                eventUnits: [],
              }),
            ],
          }),
    );

    const { rerender } = renderHook(({ sessionId }) => useAgentSession(sessionId), {
      initialProps: { sessionId: 'session-old' },
    });
    rerender({ sessionId: 'session-new' });

    await waitFor(() =>
      expect(useAgentSessionStore.getState().artifacts).toHaveProperty('new-draft'),
    );
    oldHydration.resolve({
      artifacts: [artifact('old-draft', 'ise.event-plan-draft/v1', { eventUnits: [] })],
    });
    await act(async () => {
      await oldHydration.promise;
      await Promise.resolve();
    });

    expect(useAgentSessionStore.getState()).toMatchObject({
      sessionId: 'session-new',
    });
    expect(useAgentSessionStore.getState().artifacts).not.toHaveProperty('old-draft');
  });

  it('retries recoverable disconnects after 250, 500, 1000, and 2000 ms', async () => {
    vi.useFakeTimers();
    streamEventsMock.mockImplementation(() => failedStream(new TypeError('network disconnected')));

    renderHook(() => useAgentSession('session-1'));
    await act(async () => Promise.resolve());
    expect(streamEventsMock).toHaveBeenCalledTimes(1);

    for (const [delay, calls] of [
      [250, 2],
      [500, 3],
      [1000, 4],
      [2000, 5],
    ] as const) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
      expect(streamEventsMock).toHaveBeenCalledTimes(calls);
    }

    expect(useAgentSessionStore.getState()).toMatchObject({ status: 'failed' });
    expect(useAgentSessionStore.getState().diagnostics).toContainEqual(
      expect.objectContaining({ code: 'AGENT_STREAM_UNAVAILABLE' }),
    );
  });

  it.each([401, 403])('does not retry an HTTP %s stream response', async (status) => {
    streamEventsMock.mockImplementation(() =>
      failedStream(new AgentHttpError(status, 'ACCESS_DENIED', 'secret server message')),
    );

    renderHook(() => useAgentSession('session-1'));

    await waitFor(() =>
      expect(useAgentSessionStore.getState().diagnostics).toContainEqual(
        expect.objectContaining({ code: 'AGENT_STREAM_UNAUTHORIZED' }),
      ),
    );
    expect(streamEventsMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(useAgentSessionStore.getState().diagnostics)).not.toContain(
      'secret server message',
    );
  });

  it('turns protocol errors into a stable diagnostic without retrying', async () => {
    streamEventsMock.mockImplementation(() =>
      failedStream(new AgentProtocolError('INVALID_SSE_DATA', 'hidden protocol payload')),
    );

    renderHook(() => useAgentSession('session-1'));

    await waitFor(() =>
      expect(useAgentSessionStore.getState().diagnostics).toContainEqual(
        expect.objectContaining({ code: 'AGENT_STREAM_PROTOCOL_ERROR' }),
      ),
    );
    expect(streamEventsMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the old retry timer before opening a switched session', async () => {
    vi.useFakeTimers();
    streamEventsMock.mockImplementation((sessionId) =>
      sessionId === 'session-old'
        ? failedStream(new TypeError('offline'))
        : eventStream([{ id: '1', type: 'run.started', data: { runId: 'run-new' } }]),
    );

    const { rerender } = renderHook(({ sessionId }) => useAgentSession(sessionId), {
      initialProps: { sessionId: 'session-old' },
    });
    await act(async () => Promise.resolve());
    expect(vi.getTimerCount()).toBe(1);

    rerender({ sessionId: 'session-new' });
    await act(async () => Promise.resolve());

    expect(vi.getTimerCount()).toBe(0);
    expect(useAgentSessionStore.getState()).toMatchObject({
      sessionId: 'session-new',
      status: 'running',
      lastEventId: '1',
    });
    expect(streamEventsMock.mock.calls.filter(([id]) => id === 'session-old')).toHaveLength(1);
  });

  it('removes the retry abort listener after timer completion and unmount abort', async () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const removeListener = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
    streamEventsMock
      .mockImplementationOnce(() => failedStream(new TypeError('offline')))
      .mockImplementationOnce(() => emptyStream())
      .mockImplementationOnce(() => failedStream(new TypeError('offline')));

    const first = renderHook(() => useAgentSession('session-1'));
    await act(async () => Promise.resolve());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    first.unmount();

    const second = renderHook(() => useAgentSession('session-2'));
    await act(async () => Promise.resolve());
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(
      removeListener.mock.calls.filter(([type]) => type === 'abort').length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      addListener.mock.calls.filter(([type]) => type === 'abort').length,
    ).toBeGreaterThanOrEqual(2);
  });
});
