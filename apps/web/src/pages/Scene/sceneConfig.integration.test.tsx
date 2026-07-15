import type { SceneItem } from '@/api/scene';
import { getScene, updateScene } from '@/api/scene';
import { useSceneStore } from '@/stores/sceneStore';
import type { SceneProjectConfig, SceneTrack } from '@ise/runtime-contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Scene from './index';

vi.mock('@/api/scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/scene')>();
  return {
    ...actual,
    getScene: vi.fn(),
    updateScene: vi.fn(),
  };
});

vi.mock('./components/AssetLibrary', () => ({
  AssetLibrary: () => <div data-testid="asset-library" />,
}));

vi.mock('./components/PropertyPanel', () => ({
  PropertyPanel: () => <div data-testid="property-panel" />,
}));

vi.mock('./components/SceneCanvas', () => ({
  SceneCanvas: () => <div data-testid="scene-canvas" />,
}));

vi.mock('./components/SceneHeader', () => ({
  SceneHeader: ({ onSave }: { onSave?: () => Promise<void> }) => (
    <button type="button" onClick={() => void onSave?.()}>
      Save scene
    </button>
  ),
}));

vi.mock('./components/Timeline', () => ({
  Timeline: ({
    tracks,
    onClipChange,
  }: {
    tracks: SceneTrack[];
    onClipChange?: (
      trackId: string,
      itemId: string,
      startMs: number,
      durationMs: number,
    ) => void;
  }) => (
    <div data-testid="timeline">
      {tracks.map((track) => (
        <div key={track.trackId}>{track.label}</div>
      ))}
      <button
        type="button"
        onClick={() => onClipChange?.('track-model', 'model-jf17-flight', 12_000, 8_000)}
      >
        Move canonical clip
      </button>
    </div>
  ),
}));

const config: SceneProjectConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'document-1',
  eventPlanArtifactId: 'event-plan-1',
  runtimePlanArtifactId: 'runtime-plan-1',
  totalDurationMs: 30_000,
  entities: [
    {
      entityId: 'jf17',
      displayName: 'JF-17 formation',
      kind: 'aircraft',
      modelAssetId: 'model:jf17',
      initialState: 'normal',
    },
  ],
  tracks: [
    {
      trackId: 'track-model',
      type: 'model',
      label: 'Canonical model track',
      visible: true,
      items: [
        {
          id: 'model-jf17-flight',
          eventUnitId: 'event-1',
          startMs: 1_000,
          durationMs: 8_000,
          evidenceRefs: ['evidence:1'],
          params: { action: 'model.spawn', entityId: 'jf17' },
        },
      ],
    },
  ],
  diagnostics: [],
};

function scene(configValue: unknown): SceneItem {
  return {
    id: 'scene-1',
    title: 'Replay',
    ownerType: 'PERSON',
    type: 'PRIVATE',
    config: configValue,
    userId: 'user-1',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function renderScene() {
  return render(
    <MemoryRouter initialEntries={['/scene?projectId=scene-1']}>
      <Scene />
    </MemoryRouter>,
  );
}

describe('SceneProjectConfig editor integration', () => {
  beforeEach(() => {
    vi.mocked(getScene).mockReset();
    vi.mocked(updateScene).mockReset();
    vi.mocked(updateScene).mockResolvedValue({ data: scene(config) } as never);
    useSceneStore.setState({ currentScene: null, selectedClip: null });
  });

  it('loads API tracks and saves canonical millisecond edits as an object', async () => {
    vi.mocked(getScene).mockResolvedValue({ data: scene(config) } as never);

    renderScene();

    expect(await screen.findByText('Canonical model track')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Move canonical clip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save scene' }));

    await waitFor(() =>
      expect(updateScene).toHaveBeenCalledWith(
        'scene-1',
        expect.objectContaining({
          config: expect.objectContaining({
            schemaVersion: 'ise-scene/v1',
            tracks: expect.arrayContaining([
              expect.objectContaining({
                trackId: 'track-model',
                items: expect.arrayContaining([
                  expect.objectContaining({
                    id: 'model-jf17-flight',
                    startMs: 12_000,
                    durationMs: 8_000,
                  }),
                ]),
              }),
            ]),
          }),
        }),
      ),
    );
  });

  it('blocks the editor when the API config is invalid', async () => {
    vi.mocked(getScene).mockResolvedValue({ data: scene({ broken: true }) } as never);

    renderScene();

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByTestId('timeline')).not.toBeInTheDocument();
  });
});
