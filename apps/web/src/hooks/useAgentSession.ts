import type { Diagnostic } from '@ise/runtime-contracts';
import { useEffect } from 'react';
import {
  AgentHttpError,
  AgentProtocolError,
  listAgentArtifacts,
  listAgentTurns,
  streamAgentEvents,
} from '@/api/agent';
import { useAgentSessionStore } from '@/stores/agentSessionStore';

const RETRY_DELAYS_MS = [250, 500, 1000, 2000] as const;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<void>((resolve, reject) => {
    let timer: number | undefined;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      cleanup();
      reject(abortReason(signal));
    };

    timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    signal.addEventListener('abort', onAbort, { once: true });

    if (signal.aborted) onAbort();
  });
}

async function consumeWithRetry(
  consume: () => Promise<void>,
  signal: AbortSignal,
): Promise<unknown | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await consume();
      return undefined;
    } catch (error) {
      if (signal.aborted) return undefined;
      if (
        error instanceof AgentProtocolError ||
        (error instanceof AgentHttpError && [401, 403].includes(error.status)) ||
        attempt >= RETRY_DELAYS_MS.length
      ) {
        return error;
      }

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) return error;
      try {
        await waitForRetry(delay, signal);
      } catch {
        return undefined;
      }
    }
  }
}

function streamDiagnostic(error: unknown): Diagnostic {
  if (error instanceof AgentHttpError && (error.status === 401 || error.status === 403)) {
    return {
      code: 'AGENT_STREAM_UNAUTHORIZED',
      severity: 'error',
      recoverable: false,
      message: '会话认证已失效，请重新登录后再试',
    };
  }
  if (error instanceof AgentProtocolError) {
    return {
      code: 'AGENT_STREAM_PROTOCOL_ERROR',
      severity: 'error',
      recoverable: false,
      message: '会话事件格式无效，已停止同步',
    };
  }
  return {
    code: 'AGENT_STREAM_UNAVAILABLE',
    severity: 'error',
    recoverable: true,
    message: '会话连接暂时不可用，请稍后重试',
  };
}

const hydrationDiagnostic: Diagnostic = {
  code: 'AGENT_ARTIFACTS_UNAVAILABLE',
  severity: 'warning',
  recoverable: true,
  message: '暂时无法同步会话产物，请稍后重试',
};

export function useAgentSession(sessionId: string) {
  const state = useAgentSessionStore();

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    if (useAgentSessionStore.getState().sessionId !== sessionId) {
      useAgentSessionStore.getState().open(sessionId);
    }

    const isCurrent = () =>
      mounted &&
      !controller.signal.aborted &&
      useAgentSessionStore.getState().sessionId === sessionId;

    const hydrate = async () => {
      try {
        const response = await listAgentArtifacts(sessionId);
        if (!isCurrent()) return;
        useAgentSessionStore.getState().replaceArtifacts(sessionId, response.artifacts);
      } catch {
        if (!isCurrent()) return;
        useAgentSessionStore.getState().recordDiagnostic(sessionId, hydrationDiagnostic);
      }
    };

    const hydrateTurns = async () => {
      try {
        const response = await listAgentTurns(sessionId);
        if (!isCurrent()) return;
        useAgentSessionStore.getState().replaceTurns(sessionId, response.turns);
      } catch {
        if (!isCurrent()) return;
        useAgentSessionStore.getState().recordDiagnostic(sessionId, hydrationDiagnostic);
      }
    };

    const consume = async () => {
      const current = useAgentSessionStore.getState();
      const lastEventId = current.sessionId === sessionId ? current.lastEventId : undefined;
      for await (const event of streamAgentEvents(sessionId, {
        lastEventId,
        signal: controller.signal,
      })) {
        if (!isCurrent()) return;
        useAgentSessionStore.getState().applyEvent(sessionId, event);
        if (event.type === 'run.started' || event.type === 'run.completed' || event.type === 'run.failed') {
          await hydrateTurns();
          if (!isCurrent()) return;
        }
        if (event.type === 'artifact.created' || event.type === 'review.requested') {
          await hydrate();
          if (!isCurrent()) return;
        }
      }
      if (!isCurrent()) return;
      if (TERMINAL_STATUSES.has(useAgentSessionStore.getState().status)) return;
      throw new TypeError('Agent event stream ended before the session reached a terminal state');
    };

    const run = async () => {
      await Promise.all([hydrate(), hydrateTurns()]);
      if (!isCurrent()) return;
      const error = await consumeWithRetry(consume, controller.signal);
      if (!error || !isCurrent()) return;
      useAgentSessionStore
        .getState()
        .recordDiagnostic(sessionId, streamDiagnostic(error), 'failed');
    };

    void run();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [sessionId]);

  return state;
}
