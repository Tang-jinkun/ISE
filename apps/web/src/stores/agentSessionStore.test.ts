import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentArtifactView, AgentEvent } from '@/api/agent';
import { selectArtifactExports } from '@/pages/newScript/artifactExports';
import { useAgentSessionStore } from './agentSessionStore';

const fingerprint = `sha256:${'a'.repeat(64)}`;

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

const newerCompiledConfig: SceneProjectConfig = {
  ...compiledConfig,
  eventPlanArtifactId: 'event-plan-2',
  runtimePlanArtifactId: 'runtime-plan-2',
};

function event(id: string, type: AgentEvent['type'], data: Record<string, unknown>): AgentEvent {
  return { id, type, data };
}

function artifact(
  artifactId: string,
  type: string,
  data: unknown,
  version = 1,
  createdAt = '2026-07-15T00:00:00.000Z',
): AgentArtifactView {
  return {
    artifactId,
    type,
    version,
    createdAt,
    createdBy: 'agent',
    superseded: false,
    data,
  };
}

describe('useAgentSessionStore', () => {
  beforeEach(() => {
    useAgentSessionStore.setState(useAgentSessionStore.getInitialState(), true);
  });

  it('tracks the exact active review tuple for the active session', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.applyEvent(
      'session-1',
      event('4', 'review.requested', {
        reviewId: 'review-1',
        artifactId: 'draft-1',
        version: 1,
        fingerprint,
      }),
    );

    expect(useAgentSessionStore.getState()).toMatchObject({
      status: 'awaiting_review',
      lastEventId: '4',
      activeReview: {
        reviewId: 'review-1',
        artifactId: 'draft-1',
        version: 1,
        fingerprint,
      },
    });
  });

  it('hydrates durable turns and folds live events into the matching run', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.replaceTurns('session-1', [{
      id: 'run-1',
      status: 'running',
      kind: 'generate',
      userMessage: {
        id: 'user-1', role: 'user', content: '生成场景', createdAt: '2026-07-16T00:00:00.000Z'
      },
      activities: [],
      createdAt: '2026-07-16T00:00:00.000Z'
    }]);

    store.applyEvent('session-1', event('1', 'model.streaming', {
      runId: 'run-1', text: '我先检查报告。', hiddenReasoning: 'secret'
    }));
    store.applyEvent('session-1', event('2', 'tool.started', {
      runId: 'run-1', toolCallId: 'tool-1', toolName: 'inspect_report_evidence',
      summary: '检查报告证据'
    }));
    store.applyEvent('session-1', event('3', 'tool.progress', {
      runId: 'run-1', toolCallId: 'tool-1', toolName: 'inspect_report_evidence',
      message: '正在检查', percentage: 40
    }));
    store.applyEvent('session-1', event('4', 'tool.completed', {
      runId: 'run-1', toolCallId: 'tool-1', toolName: 'inspect_report_evidence',
      summary: '检查完成'
    }));
    store.applyEvent('session-1', event('5', 'run.completed', {
      runId: 'run-1', status: 'completed', finalAnswer: '事件计划已生成。'
    }));

    expect(useAgentSessionStore.getState().turns).toEqual([expect.objectContaining({
      id: 'run-1',
      status: 'completed',
      assistantMessage: expect.objectContaining({ content: '事件计划已生成。' }),
      outcome: expect.objectContaining({ finalAnswer: '事件计划已生成。' }),
      activities: [
        { id: 'thinking-1', type: 'thinking', status: 'completed', text: '我先检查报告。' },
        {
          id: 'tool-1', type: 'tool', status: 'completed', name: 'inspect_report_evidence',
          summary: '检查完成', percentage: 40
        }
      ]
    })]);
    expect(JSON.stringify(useAgentSessionStore.getState().turns)).not.toContain('secret');
  });

  it('adds public run failure diagnostics to the failed turn', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');

    store.applyEvent('session-1', event('1', 'run.failed', {
      runId: 'run-1',
      status: 'failed',
      diagnostics: [{
        code: 'MODEL_NOT_CONFIGURED',
        message: 'Model is not configured',
        severity: 'error',
      }],
    }));

    expect(useAgentSessionStore.getState().turns).toEqual([
      expect.objectContaining({
        id: 'run-1',
        status: 'failed',
        activities: [{
          id: 'diagnostic-1-1',
          type: 'diagnostic',
          status: 'failed',
          code: 'MODEL_NOT_CONFIGURED',
          summary: 'Model is not configured',
        }],
      }),
    ]);
  });

  it('ignores duplicate, older, and non-canonical numeric event IDs', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.applyEvent('session-1', event('4', 'run.started', { runId: 'run-1' }));

    for (const id of ['4', '3', '4.5', '5e0', ' 5', '05', '-1']) {
      useAgentSessionStore
        .getState()
        .applyEvent('session-1', event(id, 'run.failed', { status: 'failed' }));
    }

    expect(useAgentSessionStore.getState()).toMatchObject({
      status: 'running',
      lastEventId: '4',
    });
    expect(useAgentSessionStore.getState().activities).toHaveLength(1);
  });

  it('does not let events from an old session mutate the new session', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.applyEvent('session-1', event('8', 'run.started', { runId: 'run-1' }));
    useAgentSessionStore.getState().open('session-2');

    useAgentSessionStore.getState().applyEvent(
      'session-1',
      event('9', 'review.requested', {
        reviewId: 'review-old',
        artifactId: 'draft-old',
        version: 1,
        fingerprint,
        hiddenReasoning: 'must not cross sessions',
      }),
    );

    expect(useAgentSessionStore.getState()).toMatchObject({
      sessionId: 'session-2',
      status: 'idle',
      activeReview: null,
      activities: [],
    });
    expect(useAgentSessionStore.getState().lastEventId).toBeUndefined();
  });

  it('stores only allowlisted public activity fields', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.applyEvent(
      'session-1',
      event('1', 'tool.started', {
        runId: 'run-1',
        toolCallId: 'tool-call-1',
        toolName: 'extract_evidence',
        summary: '正在提取证据',
        prompt: 'secret prompt',
        input: { source: 'hidden tool input' },
        model: 'hidden-model',
        hiddenReasoning: 'hidden chain of thought',
      }),
    );
    store.applyEvent(
      'session-1',
      event('2', 'artifact.created', {
        runId: 'run-1',
        artifactId: 'draft-1',
        artifactType: 'ise.event-plan-draft/v1',
        version: 1,
        metadata: { fingerprint, prompt: 'hidden' },
        data: { hidden: true },
      }),
    );

    expect(useAgentSessionStore.getState().activities).toEqual([
      {
        id: '1',
        type: 'tool.started',
        data: {
          runId: 'run-1',
          toolCallId: 'tool-call-1',
          toolName: 'extract_evidence',
          summary: '正在提取证据',
        },
      },
      {
        id: '2',
        type: 'artifact.created',
        data: {
          runId: 'run-1',
          artifactId: 'draft-1',
          artifactType: 'ise.event-plan-draft/v1',
          version: 1,
        },
      },
    ]);
  });

  it('hydrates compiled config only from the compiled artifact ledger', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.applyEvent(
      'session-1',
      event('10', 'run.completed', {
        runId: 'run-1',
        status: 'completed',
        runtimeArtifactId: 'compiled-1',
        sceneProjectConfig: { forged: true },
      }),
    );

    expect(useAgentSessionStore.getState()).toMatchObject({
      status: 'completed',
      compiledConfig: null,
    });

    store.replaceArtifacts('session-1', [
      artifact('draft-1', 'ise.event-plan-draft/v1', { eventUnits: [] }),
      artifact('compiled-1', 'ise.canonical-runtime-plan/v1', {
        sceneProjectConfig: compiledConfig,
      }),
    ]);

    expect(useAgentSessionStore.getState().artifacts).toHaveProperty('draft-1');
    expect(useAgentSessionStore.getState().compiledConfig).toEqual(compiledConfig);
  });

  it('adopts an exact review tuple returned by a revision request', () => {
    const store = useAgentSessionStore.getState();
    const nextReview = {
      reviewId: 'review-2',
      artifactId: 'draft-2',
      version: 2,
      fingerprint
    };
    store.open('session-1');

    useAgentSessionStore.getState().setActiveReview('session-1', nextReview);

    expect(useAgentSessionStore.getState()).toMatchObject({
      status: 'awaiting_review',
      activeReview: nextReview
    });
  });

  it('uses createdAt and artifact ID for the deterministic resume fallback', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.replaceArtifacts('session-1', [
      artifact(
        'compiled-z',
        'ise.canonical-runtime-plan/v1',
        { sceneProjectConfig: newerCompiledConfig },
        1,
        '2026-07-15T01:00:00.000Z',
      ),
      artifact(
        'compiled-old',
        'ise.canonical-runtime-plan/v1',
        { sceneProjectConfig: compiledConfig },
        1,
        '2026-07-15T00:00:00.000Z',
      ),
      artifact(
        'compiled-a',
        'ise.canonical-runtime-plan/v1',
        { sceneProjectConfig: compiledConfig },
        1,
        '2026-07-15T01:00:00.000Z',
      ),
    ]);

    expect(useAgentSessionStore.getState()).toMatchObject({
      latestCompletedRuntimeArtifactId: null,
      compiledConfig: newerCompiledConfig,
    });
  });

  it('waits for the exact completed runtime artifact when the event arrives first', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.applyEvent(
      'session-1',
      event('10', 'run.completed', {
        runId: 'run-1',
        status: 'completed',
        runtimeArtifactId: 'compiled-target',
      }),
    );
    store.replaceArtifacts('session-1', [
      artifact(
        'compiled-other',
        'ise.canonical-runtime-plan/v1',
        { sceneProjectConfig: newerCompiledConfig },
        1,
        '2026-07-15T02:00:00.000Z',
      ),
    ]);

    expect(useAgentSessionStore.getState()).toMatchObject({
      latestCompletedRuntimeArtifactId: 'compiled-target',
      compiledConfig: null,
    });

    store.replaceArtifacts('session-1', [
      artifact(
        'compiled-other',
        'ise.canonical-runtime-plan/v1',
        { sceneProjectConfig: newerCompiledConfig },
        1,
        '2026-07-15T02:00:00.000Z',
      ),
      artifact(
        'compiled-target',
        'ise.canonical-runtime-plan/v1',
        { sceneProjectConfig: compiledConfig },
        1,
        '2026-07-15T01:00:00.000Z',
      ),
    ]);

    expect(useAgentSessionStore.getState().compiledConfig).toEqual(compiledConfig);
  });

  it('switches a hydrated fallback to the exact artifact when completion arrives later', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.replaceArtifacts('session-1', [
      artifact(
        'compiled-target',
        'ise.canonical-runtime-plan/v1',
        { sceneProjectConfig: compiledConfig },
        1,
        '2026-07-15T01:00:00.000Z',
      ),
      artifact(
        'compiled-newer',
        'ise.canonical-runtime-plan/v1',
        { sceneProjectConfig: newerCompiledConfig },
        1,
        '2026-07-15T02:00:00.000Z',
      ),
    ]);
    expect(useAgentSessionStore.getState().compiledConfig).toEqual(newerCompiledConfig);

    store.applyEvent(
      'session-1',
      event('11', 'run.completed', {
        runId: 'run-1',
        status: 'completed',
        runtimeArtifactId: 'compiled-target',
      }),
    );

    expect(useAgentSessionStore.getState()).toMatchObject({
      latestCompletedRuntimeArtifactId: 'compiled-target',
      compiledConfig,
    });
  });

  it('clears completed artifact exports when a later completion omits its artifact ID', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.replaceArtifacts('session-1', [
      artifact('event-plan-1', 'ise.event-plan-accepted/v1', {
        schemaVersion: 'event-plan/v1',
      }),
      artifact('runtime-plan-1', 'ise.canonical-runtime-plan/v1', {
        runtimePlan: {
          schemaVersion: 'canonical-runtime-plan/v1',
          eventPlanArtifactId: 'event-plan-1',
        },
        sceneProjectConfig: compiledConfig,
      }),
    ]);
    store.applyEvent(
      'session-1',
      event('1', 'run.completed', {
        runtimeArtifactId: 'runtime-plan-1',
      }),
    );
    const completedExports = selectArtifactExports(useAgentSessionStore.getState());
    expect(completedExports.eventPlan).toBeDefined();
    expect(completedExports.runtimePlan).toBeDefined();
    expect(completedExports.sceneProject).toBeDefined();

    store.applyEvent('session-1', event('2', 'run.started', {}));
    store.applyEvent('session-1', event('3', 'run.completed', {}));

    const state = useAgentSessionStore.getState();
    expect(state).toMatchObject({
      status: 'completed',
      latestCompletedRuntimeArtifactId: null,
      compiledConfig: null,
    });
    const exports = selectArtifactExports(state);
    expect(exports.eventPlan).toBeUndefined();
    expect(exports.runtimePlan).toBeUndefined();
    expect(exports.sceneProject).toBeUndefined();
  });

  it('supports scoped artifact ingestion without replacing the ledger', () => {
    const store = useAgentSessionStore.getState();
    store.open('session-1');
    store.replaceArtifacts('session-1', [
      artifact('draft-1', 'ise.event-plan-draft/v1', { eventUnits: [] }),
    ]);
    store.ingestArtifacts('session-1', [
      artifact('compiled-1', 'ise.canonical-runtime-plan/v1', {
        sceneProjectConfig: compiledConfig,
      }),
    ]);
    store.ingestArtifacts('session-old', [artifact('old-1', 'ise.event-plan-draft/v1', {})]);

    expect(Object.keys(useAgentSessionStore.getState().artifacts)).toEqual([
      'draft-1',
      'compiled-1',
    ]);
    expect(useAgentSessionStore.getState().compiledConfig).toEqual(compiledConfig);
  });
});
