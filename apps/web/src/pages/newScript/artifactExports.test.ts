import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentArtifactView } from '@/api/agent';
import type { AgentSessionState } from '@/stores/agentSessionStore';
import {
  downloadJson,
  selectArtifactExports,
  serializeJson
} from './artifactExports';

const acceptedData = {
  schemaVersion: 'event-plan/v1',
  planId: 'plan-1'
};

const runtimePlan = {
  schemaVersion: 'canonical-runtime-plan/v1',
  planId: 'runtime-plan-1',
  eventPlanArtifactId: 'accepted-1'
};

const sceneProject: SceneProjectConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'document-1',
  eventPlanArtifactId: 'accepted-1',
  runtimePlanArtifactId: 'compiled-1',
  totalDurationMs: 10_000,
  entities: [],
  tracks: [],
  diagnostics: []
};

function artifact(
  artifactId: string,
  type: string,
  data: unknown
): AgentArtifactView {
  return {
    artifactId,
    type,
    version: 1,
    createdAt: '2026-07-15T00:00:00.000Z',
    createdBy: 'agent',
    superseded: false,
    data
  };
}

const accepted = artifact(
  'accepted-1',
  'ise.event-plan-accepted/v1',
  acceptedData
);

const compiled = artifact(
  'compiled-1',
  'ise.canonical-runtime-plan/v1',
  { runtimePlan, sceneProjectConfig: sceneProject }
);

function completedState(
  overrides: Partial<AgentSessionState> = {}
): AgentSessionState {
  return {
    sessionId: 'session-1',
    status: 'completed',
    activities: [],
    artifacts: {
      [accepted.artifactId]: accepted,
      [compiled.artifactId]: compiled
    },
    activeReview: null,
    diagnostics: [],
    compiledConfig: sceneProject,
    latestCompletedRuntimeArtifactId: compiled.artifactId,
    open: () => undefined,
    applyEvent: () => undefined,
    replaceArtifacts: () => undefined,
    ingestArtifacts: () => undefined,
    setActiveReview: () => undefined,
    recordDiagnostic: () => undefined,
    ...overrides
  };
}

describe('selectArtifactExports', () => {
  it('returns the accepted EventPlan and exact completed runtime payloads', () => {
    expect(selectArtifactExports(completedState())).toEqual({
      eventPlan: accepted.data,
      runtimePlan,
      sceneProject
    });
  });

  it.each(['running', 'failed'] as const)(
    'keeps exports unavailable while the session is %s',
    (status) => {
      expect(selectArtifactExports(completedState({ status }))).toEqual({});
    }
  );

  it.each([
    ['no completed artifact id', null],
    ['an unknown completed artifact id', 'compiled-missing']
  ])('requires %s', (_label, latestCompletedRuntimeArtifactId) => {
    expect(
      selectArtifactExports(
        completedState({ latestCompletedRuntimeArtifactId })
      )
    ).toEqual({});
  });

  it.each([
    [
      'wrong completed artifact type',
      { ...compiled, type: 'ise.runtime-plan-draft/v1' }
    ],
    ['superseded completed artifact', { ...compiled, superseded: true }],
    ['non-record compiled data', { ...compiled, data: null }]
  ])('rejects a %s', (_label, nextCompiled) => {
    expect(
      selectArtifactExports(
        completedState({
          artifacts: {
            [accepted.artifactId]: accepted,
            [compiled.artifactId]: nextCompiled
          }
        })
      )
    ).toEqual({});
  });

  it.each([
    [
      'wrong accepted artifact type',
      { ...accepted, type: 'ise.event-plan-draft/v1' },
      runtimePlan
    ],
    [
      'missing accepted artifact',
      undefined,
      { ...runtimePlan, eventPlanArtifactId: 'accepted-missing' }
    ],
    [
      'non-string accepted artifact lineage',
      accepted,
      { ...runtimePlan, eventPlanArtifactId: 1 }
    ]
  ])('rejects a %s', (_label, nextAccepted, nextRuntimePlan) => {
    const nextArtifacts: Record<string, AgentArtifactView> = {
      [compiled.artifactId]: {
        ...compiled,
        data: {
          runtimePlan: nextRuntimePlan,
          sceneProjectConfig: sceneProject
        }
      }
    };
    if (nextAccepted) nextArtifacts[nextAccepted.artifactId] = nextAccepted;

    expect(
      selectArtifactExports(completedState({ artifacts: nextArtifacts }))
    ).toEqual({});
  });

  it.each([
    [
      'malformed SceneProjectConfig',
      { ...sceneProject, schemaVersion: 'scene/v0' }
    ],
    [
      'mismatched EventPlan lineage',
      { ...sceneProject, eventPlanArtifactId: 'accepted-other' }
    ],
    [
      'mismatched runtime artifact lineage',
      { ...sceneProject, runtimePlanArtifactId: 'compiled-other' }
    ]
  ])('rejects a %s', (_label, nextSceneProject) => {
    expect(
      selectArtifactExports(
        completedState({
          artifacts: {
            [accepted.artifactId]: accepted,
            [compiled.artifactId]: {
              ...compiled,
              data: {
                runtimePlan,
                sceneProjectConfig: nextSceneProject
              }
            }
          }
        })
      )
    ).toEqual({});
  });
});

describe('serializeJson', () => {
  it('uses two-space JSON with a trailing newline', () => {
    expect(serializeJson({ ok: true })).toBe('{\n  "ok": true\n}\n');
  });
});

describe('downloadJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downloads serialized JSON through a temporary anchor', () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:artifact-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    let clickedAnchor: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        clickedAnchor = this;
        expect(document.body).toContainElement(this);
        expect(this.download).toBe('event-plan.json');
        expect(this.href).toBe('blob:artifact-export');
      }
    );

    downloadJson('event-plan.json', { ok: true });

    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('application/json;charset=utf-8');
    expect(blob?.size).toBe(new Blob([serializeJson({ ok: true })]).size);
    expect(clickedAnchor).not.toBeUndefined();
    expect(document.body).not.toContainElement(clickedAnchor ?? null);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:artifact-export');
  });

  it('removes the anchor and revokes the URL when clicking fails', () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:artifact-export'),
      revokeObjectURL
    });

    let clickedAnchor: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        clickedAnchor = this;
        throw new Error('click failed');
      }
    );

    expect(() => downloadJson('event-plan.json', { ok: true })).toThrow(
      'click failed'
    );
    expect(document.body).not.toContainElement(clickedAnchor ?? null);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:artifact-export');
  });
});
