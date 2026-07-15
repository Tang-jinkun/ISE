import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './sceneStore';

function canonicalConfig(): SceneProjectConfig {
  return {
    schemaVersion: 'ise-scene/v1',
    sourceDocumentId: 'document-1',
    eventPlanArtifactId: 'event-plan-1',
    runtimePlanArtifactId: 'runtime-plan-1',
    totalDurationMs: 1_000,
    entities: [],
    tracks: [
      {
        trackId: 'subtitle-track',
        label: 'Subtitles',
        type: 'subtitle',
        visible: true,
        items: [
          {
            id: 'subtitle-1',
            eventUnitId: 'event-1',
            startMs: 0,
            durationMs: 500,
            evidenceRefs: ['evidence-1'],
            params: { text: 'Original caption', position: 'bottom', maxWidthPct: 80 },
          },
        ],
      },
      {
        trackId: 'image-track',
        label: 'Images',
        type: 'image',
        visible: true,
        items: [
          {
            id: 'image-1',
            eventUnitId: 'event-1',
            startMs: 0,
            durationMs: 1_000,
            evidenceRefs: ['evidence-1'],
            assetId: 'image:briefing',
            params: {
              layout: {
                xPct: 0,
                yPct: 0,
                widthPct: 100,
                heightPct: 100,
                zIndex: 1,
                opacity: 1,
                fit: 'contain',
              },
              enter: 'fade',
              exit: 'fade',
            },
          },
        ],
      },
    ],
    diagnostics: [],
  };
}

describe('useSceneStore config actions', () => {
  beforeEach(() => {
    useSceneStore.setState(useSceneStore.getInitialState(), true);
  });

  it('setConfig stores the schema-parsed config and rejects invalid input', () => {
    const input = canonicalConfig();

    useSceneStore.getState().setConfig(input);

    const parsed = useSceneStore.getState().config;
    expect(parsed).toStrictEqual(input);
    expect(parsed).not.toBe(input);

    const invalid = { ...input, extra: true } as unknown as SceneProjectConfig;
    expect(() => useSceneStore.getState().setConfig(invalid)).toThrow();
    expect(useSceneStore.getState().config).toBe(parsed);
  });

  it('updateTrackItem immutably updates an item and rejects an invalid result', () => {
    useSceneStore.getState().setConfig(canonicalConfig());
    const before = useSceneStore.getState().config!;
    const beforeItem = before.tracks[0]!.items[0]!;

    useSceneStore.getState().updateTrackItem('subtitle-track', 'subtitle-1', {
      durationMs: 750,
    });

    const updated = useSceneStore.getState().config!;
    expect(updated).not.toBe(before);
    expect(updated.tracks[0]!.items[0]!.durationMs).toBe(750);
    expect(before.tracks[0]!.items[0]).toBe(beforeItem);
    expect(beforeItem.durationMs).toBe(500);

    expect(() =>
      useSceneStore.getState().updateTrackItem('subtitle-track', 'subtitle-1', {
        durationMs: 1_001,
      }),
    ).toThrow();
    expect(useSceneStore.getState().config).toBe(updated);
  });

  it('removeTrackItem immutably removes only the requested item', () => {
    useSceneStore.getState().setConfig(canonicalConfig());
    const before = useSceneStore.getState().config!;
    const retainedImage = before.tracks[1]!.items[0]!;

    useSceneStore.getState().removeTrackItem('subtitle-track', 'subtitle-1');

    const updated = useSceneStore.getState().config!;
    expect(updated).not.toBe(before);
    expect(updated.tracks[0]!.items).toEqual([]);
    expect(updated.tracks[1]!.items).toStrictEqual([retainedImage]);
    expect(before.tracks[0]!.items).toHaveLength(1);
  });
});
