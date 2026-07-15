import { describe, expect, it } from 'vitest';
import { buildSceneUpdate, type SceneItem } from './scene';

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
