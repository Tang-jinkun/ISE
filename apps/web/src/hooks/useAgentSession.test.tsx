import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentArtifactView,
  type AgentEvent,
  AgentHttpError,
  AgentProtocolError,
  listAgentArtifacts,
  listAgentTurns,
  streamAgentEvents,
} from '@/api/agent';
import { useAgentSessionStore } from '@/stores/agentSessionStore';
import { useAgentSession } from './useAgentSession';

vi.mock('@/api/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/agent')>();
  return {
    ...actual,
    listAgentArtifacts: vi.fn(),
    listAgentTurns: vi.fn(),
    streamAgentEvents: vi.fn(),
  };
});

const listArtifactsMock = vi.mocked(listAgentArtifacts);
const listTurnsMock = vi.mocked(listAgentTurns);
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

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (!signal || signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function* pendingStream(signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  for (const event of [] as AgentEvent[]) yield event;
  await waitForAbort(signal);
}

async function* eventStream(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) yield event;
}

async function* eventStreamUntilAbort(
  events: AgentEvent[],
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  yield* eventStream(events);
  await waitForAbort(signal);
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
    listTurnsMock.mockReset();
    streamEventsMock.mockReset();
    listArtifactsMock.mockResolvedValue({ artifacts: [] });
    listTurnsMock.mockResolvedValue({ turns: [] });
    streamEventsMock.mockImplementation((_sessionId, options) => pendingStream(options?.signal));
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

  it('hydrates durable turns and refreshes them at run boundaries', async () => {
    const runningTurn = {
      id: 'run-1', status: 'running' as const, kind: 'generate' as const,
      userMessage: {
        id: 'user-1', role: 'user' as const, content: '生成场景',
        createdAt: '2026-07-16T00:00:00.000Z'
      },
      activities: [],
      createdAt: '2026-07-16T00:00:00.000Z'
    };
    const completedTurn = {
      ...runningTurn,
      status: 'completed' as const,
      assistantMessage: {
        id: 'assistant-1', role: 'assistant' as const, content: '事件计划已生成。',
        createdAt: '2026-07-16T00:00:01.000Z'
      },
      outcome: { status: 'completed' as const, finalAnswer: '事件计划已生成。' }
    };
    listTurnsMock
      .mockResolvedValueOnce({ turns: [] })
      .mockResolvedValueOnce({ turns: [runningTurn] })
      .mockResolvedValueOnce({ turns: [completedTurn] });
    streamEventsMock.mockImplementation(() => eventStream([
      { id: '1', type: 'run.started', data: { runId: 'run-1', status: 'running' } },
      {
        id: '2', type: 'run.completed',
        data: { runId: 'run-1', status: 'completed', finalAnswer: '事件计划已生成。' }
      }
    ]));

    renderHook(() => useAgentSession('session-1'));

    await waitFor(() => expect(listTurnsMock).toHaveBeenCalledTimes(3));
    expect(useAgentSessionStore.getState().turns).toEqual([completedTurn]);
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

  it('keeps an earlier same-session hook active after a later hook unmounts', async () => {
    const firstHydration = deferred<{ artifacts: AgentArtifactView[] }>();
    listArtifactsMock
      .mockImplementationOnce(() => firstHydration.promise)
      .mockResolvedValue({ artifacts: [] });

    const first = renderHook(() => useAgentSession('session-1'));
    const second = renderHook(() => useAgentSession('session-1'));
    await waitFor(() => expect(listArtifactsMock).toHaveBeenCalledTimes(2));

    second.unmount();
    firstHydration.resolve({
      artifacts: [artifact('first-draft', 'ise.event-plan-draft/v1', { eventUnits: [] })],
    });
    await act(async () => {
      await firstHydration.promise;
      await Promise.resolve();
    });

    expect(useAgentSessionStore.getState().artifacts).toHaveProperty('first-draft');
    first.unmount();
  });

  it('does not let an old-session cleanup invalidate a newer session hook', async () => {
    const oldHydration = deferred<{ artifacts: AgentArtifactView[] }>();
    const newHydration = deferred<{ artifacts: AgentArtifactView[] }>();
    listArtifactsMock.mockImplementation((sessionId) =>
      sessionId === 'session-old' ? oldHydration.promise : newHydration.promise,
    );

    const oldHook = renderHook(() => useAgentSession('session-old'));
    const newHook = renderHook(() => useAgentSession('session-new'));
    await waitFor(() => expect(listArtifactsMock).toHaveBeenCalledTimes(2));

    oldHook.unmount();
    newHydration.resolve({
      artifacts: [artifact('new-draft', 'ise.event-plan-draft/v1', { eventUnits: [] })],
    });
    await act(async () => {
      await newHydration.promise;
      await Promise.resolve();
    });

    expect(useAgentSessionStore.getState()).toMatchObject({ sessionId: 'session-new' });
    expect(useAgentSessionStore.getState().artifacts).toHaveProperty('new-draft');
    newHook.unmount();
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

  it('retries clean EOF with the latest event ID and reports bounded exhaustion', async () => {
    vi.useFakeTimers();
    streamEventsMock
      .mockImplementationOnce(() =>
        eventStream([{ id: '8', type: 'run.started', data: { runId: 'run-1' } }]),
      )
      .mockImplementation(() => emptyStream());

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

    expect(streamEventsMock).toHaveBeenNthCalledWith(
      2,
      'session-1',
      expect.objectContaining({ lastEventId: '8' }),
    );
    expect(useAgentSessionStore.getState().diagnostics).toContainEqual(
      expect.objectContaining({ code: 'AGENT_STREAM_UNAVAILABLE' }),
    );
  });

  it.each([
    {
      type: 'run.completed' as const,
      data: { runId: 'run-1', status: 'completed', runtimeArtifactId: 'compiled-1' },
    },
    {
      type: 'run.failed' as const,
      data: { runId: 'run-1', status: 'failed', diagnostics: [] },
    },
  ])('does not reconnect after terminal $type EOF', async ({ type, data }) => {
    vi.useFakeTimers();
    streamEventsMock.mockImplementation(() => eventStream([{ id: '1', type, data }]));

    renderHook(() => useAgentSession('session-1'));
    await act(async () => Promise.resolve());
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(streamEventsMock).toHaveBeenCalledTimes(1);
    expect(useAgentSessionStore.getState().diagnostics).toEqual([]);
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
    streamEventsMock.mockImplementation((sessionId, options) =>
      sessionId === 'session-old'
        ? failedStream(new TypeError('offline'))
        : eventStreamUntilAbort(
            [{ id: '1', type: 'run.started', data: { runId: 'run-new' } }],
            options?.signal,
          ),
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
      .mockImplementationOnce((_sessionId, options) => pendingStream(options?.signal))
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
