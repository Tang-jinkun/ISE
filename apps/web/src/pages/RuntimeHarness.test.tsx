import { getScene, type SceneItem } from '@/api/scene';
import { useSceneRuntime } from '@/hooks/useSceneRuntime';
import { RUNTIME_MAIN_CONFIG } from '@/runtime';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeHarness } from './RuntimeHarness';

vi.mock('@/api/scene', () => ({
  getScene: vi.fn(),
}));

vi.mock('@/config/public-env', () => ({
  mapboxToken: '',
}));

vi.mock('@/hooks/useSceneRuntime', () => ({
  useSceneRuntime: vi.fn(() => ({
    status: 'ready',
    currentTimeMs: 0,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    replay: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('mapbox-gl', () => ({
  default: {
    accessToken: '',
    Map: vi.fn(),
  },
}));

function scene(config: unknown): SceneItem {
  return {
    id: 'persisted-scene',
    title: 'Persisted replay',
    ownerType: 'PERSON',
    type: 'PRIVATE',
    config,
    userId: 'user-1',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function renderHarness(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/runtime-harness${search}`]}>
      <RuntimeHarness />
    </MemoryRouter>,
  );
}

function expectRuntimeConfig(config: unknown) {
  expect(vi.mocked(useSceneRuntime)).toHaveBeenCalledWith(
    expect.objectContaining({ config }),
  );
}

describe('RuntimeHarness source selection', () => {
  beforeEach(() => {
    vi.mocked(getScene).mockReset();
    vi.mocked(useSceneRuntime).mockClear();
  });

  it('loads sceneId before a fixture and passes its valid config to the runtime', async () => {
    vi.mocked(getScene).mockResolvedValue({
      data: scene(RUNTIME_MAIN_CONFIG),
    } as never);

    renderHarness('?fixture=runtime-catalog&sceneId=scene%2Falpha');

    await waitFor(() => expect(getScene).toHaveBeenCalledWith('scene/alpha'));
    await waitFor(() => expectRuntimeConfig(RUNTIME_MAIN_CONFIG));
  });

  it('renders an alert for an invalid persisted scene config', async () => {
    vi.mocked(getScene).mockResolvedValue({
      data: scene({ broken: true }),
    } as never);

    renderHarness('?sceneId=invalid-scene');

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(getScene).toHaveBeenCalledWith('invalid-scene');
  });

  it('uses runtime-main without calling the scene API', () => {
    renderHarness('?fixture=runtime-main');

    expect(getScene).not.toHaveBeenCalled();
    expectRuntimeConfig(RUNTIME_MAIN_CONFIG);
  });
});
