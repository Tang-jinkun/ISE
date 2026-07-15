import { useSceneStore } from '@/stores/sceneStore';
import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PropertyPanel } from './PropertyPanel';

const config: SceneProjectConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'document-1',
  eventPlanArtifactId: 'event-plan-1',
  runtimePlanArtifactId: 'runtime-plan-1',
  totalDurationMs: 10_000,
  entities: [],
  tracks: [
    {
      trackId: 'track-subtitle',
      type: 'subtitle',
      label: 'Subtitle',
      visible: true,
      items: [
        {
          id: 'subtitle-1',
          eventUnitId: 'event-1',
          startMs: 500,
          durationMs: 5_000,
          evidenceRefs: ['evidence:1'],
          params: { text: 'Original text', position: 'bottom', maxWidthPct: 70 },
        },
      ],
    },
  ],
  diagnostics: [],
};

describe('PropertyPanel', () => {
  beforeEach(() => {
    useSceneStore.setState(useSceneStore.getInitialState(), true);
    useSceneStore.getState().setConfig(config);
    const item = config.tracks[0].items[0];
    useSceneStore.getState().setSelectedClip({
      ...item,
      id: item.id,
      label: item.id,
      trackId: 'track-subtitle',
      trackType: 'subtitle',
      start: item.startMs,
      width: item.durationMs,
      startMs: item.startMs,
      durationMs: item.durationMs,
    });
  });

  it('edits canonical type-specific params without a mock fallback', () => {
    render(<PropertyPanel />);

    const input = screen.getByLabelText('字幕文本');
    fireEvent.change(input, { target: { value: 'Updated canonical text' } });
    fireEvent.blur(input);

    const item = useSceneStore.getState().config?.tracks[0].items[0];
    expect(item?.params).toMatchObject({ text: 'Updated canonical text' });
    expect(screen.queryByText(/Mock/i)).not.toBeInTheDocument();
  });
});
