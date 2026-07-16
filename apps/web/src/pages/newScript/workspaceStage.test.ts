import { describe, expect, it } from 'vitest';
import type { AgentArtifactView } from '@/api/agent';
import { selectWorkspaceState } from './workspaceStage';

function artifact(
  artifactId: string,
  type: string,
  options: Partial<AgentArtifactView> = {}
): AgentArtifactView {
  return {
    artifactId,
    type,
    version: 1,
    createdAt: '2026-07-16T00:00:00.000Z',
    createdBy: 'agent',
    superseded: false,
    data: {},
    ...options
  };
}

describe('selectWorkspaceState', () => {
  it('keeps the workspace absent before an inspectable artifact exists', () => {
    expect(
      selectWorkspaceState({
        artifacts: [],
        activeReview: null,
        latestTurnStatus: undefined,
        completedRuntimeArtifactId: null
      })
    ).toEqual({
      visible: false,
      defaultTab: null,
      availableTabs: [],
      failed: false
    });
  });

  it('opens EventPlan review as the first inspectable stage', () => {
    const eventPlan = artifact('event-1', 'ise.event-plan-draft/v1');

    const state = selectWorkspaceState({
      artifacts: [eventPlan],
      activeReview: {
        reviewId: 'review-1',
        artifactId: eventPlan.artifactId,
        version: 1,
        fingerprint: `sha256:${'a'.repeat(64)}`
      },
      latestTurnStatus: 'completed',
      completedRuntimeArtifactId: null
    });

    expect(state.visible).toBe(true);
    expect(state.defaultTab).toBe('event-plan');
    expect(state.availableTabs).toEqual(['event-plan']);
    expect(state.eventPlan).toBe(eventPlan);
  });

  it('maps current v1 narration and runtime artifacts to later tabs', () => {
    const eventPlan = artifact('event-1', 'ise.event-plan-accepted/v1');
    const narration = artifact('narrative-1', 'ise.narrative-plan/v1');
    const runtime = artifact('runtime-1', 'ise.canonical-runtime-plan/v1');

    const state = selectWorkspaceState({
      artifacts: [eventPlan, narration, runtime],
      activeReview: null,
      latestTurnStatus: 'completed',
      completedRuntimeArtifactId: runtime.artifactId
    });

    expect(state.defaultTab).toBe('preview');
    expect(state.availableTabs).toEqual([
      'event-plan',
      'narration',
      'assets',
      'params',
      'preview'
    ]);
    expect(state.narration).toBe(narration);
    expect(state.runtime).toBe(runtime);
  });

  it('recognizes future narration, blueprint, and scene project artifacts centrally', () => {
    const narration = artifact('narration-2', 'ise.narration-plan/v1');
    const blueprint = artifact('blueprint-1', 'ise.scene-blueprint/v1');
    const runtime = artifact('scene-2', 'ise.scene-project-config/v2');

    const state = selectWorkspaceState({
      artifacts: [narration, blueprint, runtime],
      activeReview: null,
      latestTurnStatus: 'completed',
      completedRuntimeArtifactId: runtime.artifactId
    });

    expect(state.availableTabs).toEqual([
      'narration',
      'blueprint',
      'assets',
      'params',
      'preview'
    ]);
    expect(state.blueprint).toBe(blueprint);
    expect(state.defaultTab).toBe('preview');
  });

  it('exposes usable blueprint, resource, and parameter tabs before runtime exists', () => {
    const blueprint = artifact('blueprint-1', 'ise.scene-blueprint/v1');

    const state = selectWorkspaceState({
      artifacts: [blueprint],
      activeReview: null,
      latestTurnStatus: 'completed',
      completedRuntimeArtifactId: null
    });

    expect(state.visible).toBe(true);
    expect(state.defaultTab).toBe('blueprint');
    expect(state.availableTabs).toEqual(['blueprint', 'assets', 'params']);
    expect(state.blueprint).toBe(blueprint);
  });

  it('ignores superseded artifacts and chooses the newest active version', () => {
    const oldPlan = artifact('event-old', 'ise.event-plan-draft/v1', {
      superseded: true,
      version: 1,
      createdAt: '2026-07-16T00:00:00.000Z'
    });
    const versionTwo = artifact('event-v2', 'ise.event-plan-draft/v1', {
      version: 2,
      createdAt: '2026-07-16T00:00:02.000Z'
    });
    const versionThree = artifact('event-v3', 'ise.event-plan-draft/v1', {
      version: 3,
      createdAt: '2026-07-16T00:00:03.000Z'
    });

    const state = selectWorkspaceState({
      artifacts: [versionTwo, oldPlan, versionThree],
      activeReview: null,
      latestTurnStatus: 'completed',
      completedRuntimeArtifactId: null
    });

    expect(state.eventPlan?.artifactId).toBe('event-v3');
  });

  it('prefers a resolved scene plan over a newer unresolved blueprint', () => {
    const resolved = artifact('resolved-1', 'ise.resolved-scene-plan/v1', {
      createdAt: '2026-07-16T00:00:01.000Z'
    });
    const newerBlueprint = artifact('blueprint-2', 'ise.scene-blueprint/v1', {
      createdAt: '2026-07-16T00:00:02.000Z'
    });

    const state = selectWorkspaceState({
      artifacts: [newerBlueprint, resolved],
      activeReview: null,
      latestTurnStatus: 'completed',
      completedRuntimeArtifactId: null
    });

    expect(state.blueprint).toBe(resolved);
  });

  it('retains the furthest successful artifact when the latest turn fails', () => {
    const narration = artifact('narration-1', 'ise.narrative-plan/v1');

    const state = selectWorkspaceState({
      artifacts: [narration],
      activeReview: null,
      latestTurnStatus: 'failed',
      completedRuntimeArtifactId: null
    });

    expect(state.failed).toBe(true);
    expect(state.visible).toBe(true);
    expect(state.defaultTab).toBe('narration');
    expect(state.narration).toBe(narration);
  });
});
