import { RUNTIME_MAIN_CONFIG, type SceneRuntime } from '@/runtime';
import { renderHook, waitFor } from '@testing-library/react';
import type mapboxgl from 'mapbox-gl';
import { describe, expect, it, vi } from 'vitest';
import { useSceneRuntime } from './useSceneRuntime';

function mockRuntime(): SceneRuntime {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    seek: vi.fn().mockResolvedValue(undefined),
    replay: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

describe('useSceneRuntime', () => {
  it('loads once, seeks with the editor playhead, and disposes on unmount', async () => {
    const runtime = mockRuntime();
    const map = {} as mapboxgl.Map;
    const overlayRoot = document.createElement('div');
    const config = RUNTIME_MAIN_CONFIG;
    const runtimeFactory = vi.fn(() => runtime);

    const { rerender, unmount } = renderHook(
      ({ timeMs }) =>
        useSceneRuntime({
          map,
          overlayRoot,
          config,
          timeMs,
          runtimeFactory,
        }),
      { initialProps: { timeMs: 0 } },
    );

    await waitFor(() => expect(runtime.load).toHaveBeenCalledWith(config));
    expect(runtimeFactory).toHaveBeenCalledTimes(1);

    rerender({ timeMs: 4_200 });
    await waitFor(() => expect(runtime.seek).toHaveBeenCalledWith(4_200));

    unmount();
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });
});
