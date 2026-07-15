import { RUNTIME_MAIN_CONFIG, type SceneRuntime } from '@/runtime';
import { renderHook, waitFor } from '@testing-library/react';
import type mapboxgl from 'mapbox-gl';
import { describe, expect, it, vi } from 'vitest';
import { useSceneRuntime } from './useSceneRuntime';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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

  it('disposes when the map target is removed', async () => {
    const runtime = mockRuntime();
    const runtimeFactory = () => runtime;
    const map = {} as mapboxgl.Map;
    const overlayRoot = document.createElement('div');
    const { rerender, result } = renderHook(
      ({ target }: { target: boolean }) =>
        useSceneRuntime({
          map: target ? map : null,
          overlayRoot: target ? overlayRoot : null,
          config: RUNTIME_MAIN_CONFIG,
          runtimeFactory,
        }),
      { initialProps: { target: true } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ target: false });

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it('skips superseded queued seeks while an earlier seek is in flight', async () => {
    const runtime = mockRuntime();
    const runtimeFactory = () => runtime;
    const firstSeek = deferred();
    vi.mocked(runtime.seek).mockImplementation((timeMs) =>
      timeMs === 1_000 ? firstSeek.promise : Promise.resolve(),
    );
    const map = {} as mapboxgl.Map;
    const overlayRoot = document.createElement('div');
    const { rerender } = renderHook(
      ({ timeMs }) =>
        useSceneRuntime({
          map,
          overlayRoot,
          config: RUNTIME_MAIN_CONFIG,
          timeMs,
          runtimeFactory,
        }),
      { initialProps: { timeMs: 0 } },
    );

    await waitFor(() => expect(runtime.load).toHaveBeenCalledTimes(1));
    rerender({ timeMs: 1_000 });
    await waitFor(() => expect(runtime.seek).toHaveBeenCalledWith(1_000));
    rerender({ timeMs: 2_000 });
    rerender({ timeMs: 3_000 });
    firstSeek.resolve();

    await waitFor(() => expect(runtime.seek).toHaveBeenCalledWith(3_000));
    expect(runtime.seek).not.toHaveBeenCalledWith(2_000);
  });
});
