import type { AgentArtifactView } from '@/api/agent';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SceneBlueprintSummary } from './SceneBlueprintSummary';

const blueprint: AgentArtifactView = {
  artifactId: 'blueprint-1',
  type: 'ise.scene-blueprint/v1',
  version: 1,
  createdAt: '2026-07-16T00:00:00.000Z',
  createdBy: 'agent',
  superseded: false,
  data: {
    blueprintId: 'blueprint-1',
    generationProfile: 'grounded-replay',
    actorGroups: [
      {
        actorGroupId: 'group-1',
        label: '苏-30MKI编队',
        quantity: 4,
        quantitySource: 'default',
        resourceType: 'model'
      }
    ],
    sceneBeats: [
      {
        sceneBeatId: 'beat-1',
        purpose: '建立双方初始态势',
        actorRefs: ['group-1'],
        behaviorIntents: ['编队起飞并进入巡逻空域'],
        cameraIntent: { attentionTarget: '苏-30MKI编队' },
        mediaIntents: []
      }
    ],
    diagnostics: [
      { code: 'RESOURCE_FALLBACK', severity: 'warning', message: '使用默认机型资源' }
    ]
  }
};

describe('SceneBlueprintSummary', () => {
  it('shows compact blueprint, resource, and parameter content before runtime', () => {
    const { rerender } = render(
      <SceneBlueprintSummary artifact={blueprint} view="blueprint" />
    );

    expect(screen.getByText('苏-30MKI编队')).toBeInTheDocument();
    expect(screen.getByText('建立双方初始态势')).toBeInTheDocument();
    expect(screen.getByText('使用默认机型资源')).toBeInTheDocument();

    rerender(<SceneBlueprintSummary artifact={blueprint} view="resources" />);
    expect(screen.getByText('model')).toBeInTheDocument();

    rerender(<SceneBlueprintSummary artifact={blueprint} view="params" />);
    expect(screen.getByText('4 架 · 默认策略')).toBeInTheDocument();
    expect(screen.getByText('grounded-replay')).toBeInTheDocument();
  });
});
