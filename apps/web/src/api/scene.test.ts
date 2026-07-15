import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { http } from './http';
import {
  buildSceneUpdate,
  createBlankScene,
  createScene,
  type SceneItem
} from './scene';

const config: SceneProjectConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'document-1',
  eventPlanArtifactId: 'event-plan-1',
  runtimePlanArtifactId: 'runtime-plan-1',
  totalDurationMs: 0,
  entities: [],
  tracks: [],
  diagnostics: []
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(http, 'post').mockResolvedValue({ data: { id: 'scene-1' } });
});

describe('buildSceneUpdate', () => {
  it('keeps only mutable Scene fields in the API payload', () => {
    const scene: SceneItem = {
      id: 'scene-1',
      title: 'Updated scene',
      ownerType: 'PERSON',
      type: 'PRIVATE',
      config: { stale: true },
      userId: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      name: 'Legacy name',
      coverUrl: 'https://example.com/cover.png',
      image: 'https://example.com/image.png'
    };

    const payload = buildSceneUpdate(scene, '[{"id":"track-1"}]');

    expect(payload).toStrictEqual({
      title: 'Updated scene',
      type: 'PRIVATE',
      config: '[{"id":"track-1"}]'
    });
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('ownerType');
    expect(payload).not.toHaveProperty('createdAt');
    expect(payload).not.toHaveProperty('updatedAt');
  });
});

describe('Scene creation APIs', () => {
  it('requires and forwards a compiled SceneProjectConfig', async () => {
    expectTypeOf(createScene).parameter(0).toEqualTypeOf<{
      title: string;
      config: SceneProjectConfig;
    }>();

    await createScene({ title: 'Compiled scene', config });

    expect(http.post).toHaveBeenCalledWith('scene', {
      title: 'Compiled scene',
      config
    });
  });

  it('keeps blank scene creation on an explicit title-only API', async () => {
    await createBlankScene({ title: 'Blank scene' });

    expect(http.post).toHaveBeenCalledWith('scene', { title: 'Blank scene' });
  });
});
