import type mapboxgl from 'mapbox-gl';
import type {
  Diagnostic,
  ResolvedAssetAccess,
  SceneProjectConfig,
  SceneTrack,
} from '@ise/runtime-contracts';
import { expect, expectTypeOf, it, vi } from 'vitest';
import { MapRuntime } from '../MapRuntime';
import type { LoadedAsset } from '../ResourceManager';
import { SceneRuntimeImpl, type SceneRuntimeDependencies } from '../SceneRuntime';
import {
  createSceneRuntime,
  type SceneRuntime,
  type SceneRuntimeOptions,
} from '../index';
import type { RuntimeFrame } from '../types';
import { FakeMap } from './helpers/fakes';

const validConfig: SceneProjectConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'fixture-document',
  eventPlanArtifactId: 'fixture-events',
  runtimePlanArtifactId: 'fixture-runtime',
  totalDurationMs: 12_000,
  entities: [],
  tracks: [],
  diagnostics: [],
};

const routingTracks: SceneTrack[] = [
  { trackId: 'markers', type: 'marker', label: 'Markers', visible: true, items: [] },
  { trackId: 'hidden-map', type: 'camera', label: 'Hidden camera', visible: false, items: [] },
  { trackId: 'models', type: 'model', label: 'Models', visible: true, items: [] },
  { trackId: 'subtitles', type: 'subtitle', label: 'Subtitles', visible: true, items: [] },
  { trackId: 'hidden-video', type: 'video', label: 'Hidden video', visible: false, items: [] },
];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function sceneRuntimeHarness(
  options: {
    modelLoadError?: unknown;
    modelLoadRejects?: boolean;
    modelLoadGate?: Promise<void>;
    unlockError?: Error;
    unlockGates?: Promise<void>[];
    modelApplyErrorAtMs?: number;
    mapRuntime?: SceneRuntimeDependencies['mapRuntime'];
    resources?: SceneRuntimeDependencies['resources'];
  } = {},
) {
  const calls: string[] = [];
  const listeners = new Set<(frame: RuntimeFrame) => void>();
  let durationMs = 0;
  const clock = {
    currentTimeMs: 0,
    isPlaying: false,
    setDuration: vi.fn((value: number) => {
      durationMs = value;
      clock.currentTimeMs = Math.min(clock.currentTimeMs, durationMs);
      calls.push(`clock.duration:${value}`);
      listeners.forEach((listener) =>
        listener({
          timeMs: clock.currentTimeMs,
          playing: clock.isPlaying,
          forceMediaSeek: true,
        }),
      );
    }),
    subscribe: vi.fn((listener: (frame: RuntimeFrame) => void) => {
      listeners.add(listener);
      return vi.fn(() => listeners.delete(listener));
    }),
    play: vi.fn(() => {
      calls.push('clock.play');
      if (clock.currentTimeMs < durationMs) {
        clock.isPlaying = true;
      }
    }),
    pause: vi.fn(() => {
      calls.push('clock.pause');
      if (!clock.isPlaying) {
        return;
      }
      clock.isPlaying = false;
      listeners.forEach((listener) =>
        listener({
          timeMs: clock.currentTimeMs,
          playing: false,
          forceMediaSeek: false,
        }),
      );
    }),
    seek: vi.fn((value: number) => {
      clock.currentTimeMs = Math.min(durationMs, Math.max(0, value));
      calls.push(`clock.seek:${value}`);
      listeners.forEach((listener) =>
        listener({
          timeMs: clock.currentTimeMs,
          playing: clock.isPlaying,
          forceMediaSeek: true,
        }),
      );
    }),
    dispose: vi.fn(),
  };
  const emitClockFrame = (frame: RuntimeFrame) => {
    clock.currentTimeMs = frame.timeMs;
    clock.isPlaying = frame.playing;
    listeners.forEach((listener) => listener(frame));
  };
  const mapRuntime = {
    load: vi.fn(async (_tracks: SceneTrack[], _signal?: AbortSignal) => {
      calls.push('map.load');
    }),
    applyBase: vi.fn((timeMs: number) => calls.push(`map.apply:${timeMs}`)),
    applyTrails: vi.fn(() => calls.push(`map.trails:${clock.currentTimeMs}`)),
    dispose: vi.fn(),
  };
  const modelRuntime = {
    load: vi.fn(
      async (
        _entities: SceneProjectConfig['entities'],
        _tracks: SceneTrack[],
        _signal?: AbortSignal,
      ) => {
        calls.push('model.load');
        if (options.modelLoadGate) {
          await options.modelLoadGate;
        }
        if (options.modelLoadRejects || options.modelLoadError !== undefined) {
          return Promise.reject(options.modelLoadError);
        }
      },
    ),
    apply: vi.fn((timeMs: number) => {
      calls.push(`model.apply:${timeMs}`);
      if (timeMs === options.modelApplyErrorAtMs) {
        throw new Error(`model frame failed at ${timeMs}`);
      }
      return [{ entityId: 'aircraft-1', coordinates: [[76, 30] as const] }];
    }),
    getFrameSnapshot: vi.fn(() => [
      {
        entityId: 'aircraft-1',
        visible: true,
        longitude: 76.25,
        latitude: 30.5,
        altitudeM: 1_050,
        headingDeg: 92,
        pitchDeg: 4,
        position: [0.25, 0.5, 0.00105] as [number, number, number],
        quaternion: [0, 0, 0.7, 0.7] as [number, number, number, number],
      },
    ]),
    dispose: vi.fn(),
  };
  let unlockAttempt = 0;
  const overlayRuntime = {
    load: vi.fn(async (_tracks: SceneTrack[], _signal?: AbortSignal) => {
      calls.push('overlay.load');
    }),
    unlockMedia: vi.fn(async () => {
      calls.push('overlay.unlock');
      const gate = options.unlockGates?.[unlockAttempt++];
      if (gate) {
        await gate;
      }
      if (options.unlockError) {
        throw options.unlockError;
      }
    }),
    apply: vi.fn((frame: RuntimeFrame) =>
      calls.push(
        `overlay.apply:${frame.timeMs}:${frame.playing ? 'playing' : 'paused'}:${frame.forceMediaSeek ? 'seek' : 'tick'}`,
      ),
    ),
    dispose: vi.fn(),
  };
  const resources = { dispose: vi.fn() };
  const dependencies = {
    clock,
    mapRuntime: options.mapRuntime ?? mapRuntime,
    modelRuntime,
    overlayRuntime,
    resources: options.resources ?? resources,
  } as unknown as SceneRuntimeDependencies;
  const overlayRoot = document.createElement('div');
  const runtimeOptions: SceneRuntimeOptions = {
    map: {} as mapboxgl.Map,
    overlayRoot,
    resolveAsset: vi.fn(async () => {
      throw new Error('not used by component fakes');
    }),
  };
  const runtime = new SceneRuntimeImpl(runtimeOptions, dependencies);
  const disposals = () => ({
    clock: clock.dispose.mock.calls.length,
    map: mapRuntime.dispose.mock.calls.length,
    model: modelRuntime.dispose.mock.calls.length,
    overlay: overlayRuntime.dispose.mock.calls.length,
    resources: resources.dispose.mock.calls.length,
  });
  return {
    runtime,
    calls,
    clock,
    emitClockFrame,
    mapRuntime,
    modelRuntime,
    overlayRuntime,
    resources,
    overlayRoot,
    disposals,
    listenerCount: () => listeners.size,
  };
}

it('exports the exact integration factory', () => {
  expectTypeOf(createSceneRuntime).toEqualTypeOf<
    (options: {
      map: mapboxgl.Map;
      overlayRoot: HTMLElement;
      resolveAsset(
        assetId: string,
        signal?: AbortSignal,
      ): Promise<ResolvedAssetAccess>;
    }) => SceneRuntime
  >();
});

it('validates the scene schema before starting component loads', async () => {
  const harness = sceneRuntimeHarness();
  const invalid = { ...validConfig, totalDurationMs: -1 } as SceneProjectConfig;

  await expect(harness.runtime.load(invalid)).rejects.toThrow();
  expect(harness.calls).toEqual([]);

  await harness.runtime.load(validConfig);
  expect(harness.calls).toContain('map.load');
});

it('routes visible tracks and loads components before one paused zero frame', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load({ ...validConfig, tracks: routingTracks });

  expect(harness.calls).toEqual([
    'map.load',
    'model.load',
    'overlay.load',
    'clock.duration:12000',
    'map.apply:0',
    'model.apply:0',
    'map.trails:0',
    'overlay.apply:0:paused:seek',
  ]);
  expect((harness.mapRuntime.load.mock.calls[0]![0] as SceneTrack[]).map((track) => track.type)).toEqual([
    'marker',
  ]);
  expect((harness.modelRuntime.load.mock.calls[0]![1] as SceneTrack[]).map((track) => track.type)).toEqual([
    'model',
  ]);
  expect((harness.overlayRuntime.load.mock.calls[0]![0] as SceneTrack[]).map((track) => track.type)).toEqual([
    'subtitle',
  ]);
  expect(harness.overlayRoot.dataset.runtimeTimeMs).toBe('0');
});

it('applies clock frames in map, model, trail, overlay order', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  harness.emitClockFrame({ timeMs: 250, playing: true, forceMediaSeek: false });

  expect(harness.calls).toEqual([
    'map.apply:250',
    'model.apply:250',
    'map.trails:250',
    'overlay.apply:250:playing:tick',
  ]);
  expect(harness.overlayRoot.dataset.runtimeTimeMs).toBe('250');
  expect(JSON.parse(harness.overlayRoot.dataset.runtimeModels ?? '')).toEqual([
    expect.objectContaining({
      entityId: 'aircraft-1',
      visible: true,
      headingDeg: 92,
      pitchDeg: 4,
      position: [0.25, 0.5, 0.00105],
    }),
  ]);
});

it('unlocks media before starting the clock and applies a playing frame', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  await harness.runtime.play();

  expect(harness.calls).toEqual([
    'overlay.unlock',
    'clock.play',
    'map.apply:0',
    'model.apply:0',
    'map.trails:0',
    'overlay.apply:0:playing:tick',
  ]);
});

it('keeps the clock paused when media unlock rejects', async () => {
  const blocked = Object.assign(new Error('blocked'), { code: 'MEDIA_AUTOPLAY_BLOCKED' });
  const harness = sceneRuntimeHarness({ unlockError: blocked });
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  await expect(harness.runtime.play()).rejects.toBe(blocked);

  expect(harness.calls).toEqual(['overlay.unlock']);
  expect(harness.clock.isPlaying).toBe(false);
});

it('does not start a pending play after pause supersedes its media unlock', async () => {
  const gate = deferred<void>();
  const harness = sceneRuntimeHarness({ unlockGates: [gate.promise] });
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  const playing = harness.runtime.play();
  await Promise.resolve();
  harness.runtime.pause();
  gate.resolve();
  await playing;

  expect(harness.clock.play).not.toHaveBeenCalled();
  expect(harness.clock.isPlaying).toBe(false);
  expect(harness.calls.at(-1)).toBe('overlay.apply:0:paused:seek');
});

it('does not start a pending play after seek supersedes its media unlock', async () => {
  const gate = deferred<void>();
  const harness = sceneRuntimeHarness({ unlockGates: [gate.promise] });
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  const playing = harness.runtime.play();
  await Promise.resolve();
  await harness.runtime.seek(2_000);
  gate.resolve();
  await playing;

  expect(harness.clock.play).not.toHaveBeenCalled();
  expect(harness.clock.isPlaying).toBe(false);
  expect(harness.overlayRoot.dataset.runtimeTimeMs).toBe('2000');
});

it('rejects a pending play as disposed without starting its clock', async () => {
  const gate = deferred<void>();
  const harness = sceneRuntimeHarness({ unlockGates: [gate.promise] });
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  const playing = harness.runtime.play();
  await Promise.resolve();
  harness.runtime.dispose();
  gate.resolve();

  await expect(playing).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
  expect(harness.clock.play).not.toHaveBeenCalled();
});

it('lets only the newest pending play start the clock', async () => {
  const firstGate = deferred<void>();
  const secondGate = deferred<void>();
  const harness = sceneRuntimeHarness({
    unlockGates: [firstGate.promise, secondGate.promise],
  });
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  const firstPlay = harness.runtime.play();
  await Promise.resolve();
  const secondPlay = harness.runtime.play();
  await Promise.resolve();
  firstGate.resolve();
  await firstPlay;
  expect(harness.clock.play).not.toHaveBeenCalled();

  secondGate.resolve();
  await secondPlay;
  expect(harness.clock.play).toHaveBeenCalledTimes(1);
});

it('pauses, seeks exactly once, applies a paused frame, and resumes prior playback', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  await harness.runtime.play();
  harness.calls.length = 0;

  await harness.runtime.seek(6_000);

  expect(harness.calls).toEqual([
    'clock.pause',
    'clock.seek:6000',
    'map.apply:6000',
    'model.apply:6000',
    'map.trails:6000',
    'overlay.apply:6000:paused:seek',
    'clock.play',
  ]);
  expect(harness.clock.isPlaying).toBe(true);
});

it('seeks while paused without pausing or resuming the clock', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  await harness.runtime.seek(2_000);

  expect(harness.calls).toEqual([
    'clock.seek:2000',
    'map.apply:2000',
    'model.apply:2000',
    'map.trails:2000',
    'overlay.apply:2000:paused:seek',
  ]);
  expect(harness.clock.isPlaying).toBe(false);
});

it('replay performs a non-resuming seek to zero before normal play', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  await harness.runtime.seek(4_000);
  harness.calls.length = 0;

  await harness.runtime.replay();

  expect(harness.calls).toEqual([
    'clock.pause',
    'clock.seek:0',
    'map.apply:0',
    'model.apply:0',
    'map.trails:0',
    'overlay.apply:0:paused:seek',
    'overlay.unlock',
    'clock.play',
    'map.apply:0',
    'model.apply:0',
    'map.trails:0',
    'overlay.apply:0:playing:tick',
  ]);
});

it('applies a paused terminal frame and does not restart at the configured duration', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  harness.emitClockFrame({ timeMs: 12_000, playing: false, forceMediaSeek: false });

  expect(harness.calls).toEqual([
    'map.apply:12000',
    'model.apply:12000',
    'map.trails:12000',
    'overlay.apply:12000:paused:tick',
  ]);
  expect(harness.overlayRoot.dataset.runtimeTimeMs).toBe('12000');
  harness.calls.length = 0;

  await harness.runtime.play();

  expect(harness.calls).toEqual([]);
  expect(harness.clock.isPlaying).toBe(false);
});

it('rolls back every component when a critical load rejects', async () => {
  const harness = sceneRuntimeHarness({ modelLoadError: new Error('missing GLB') });

  await expect(harness.runtime.load(validConfig)).rejects.toThrow('missing GLB');

  expect(harness.disposals()).toEqual({ clock: 1, map: 1, model: 1, overlay: 1, resources: 1 });
  await expect(harness.runtime.play()).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
});

it('reports the component stage when a load rejects without a reason', async () => {
  const harness = sceneRuntimeHarness({ modelLoadRejects: true });
  let failure: unknown;

  try {
    await harness.runtime.load(validConfig);
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe('Scene runtime model stage failed without an error');
});

it('aborts and rolls back once when disposed during an in-flight load', async () => {
  const gate = deferred<void>();
  const harness = sceneRuntimeHarness({ modelLoadGate: gate.promise });
  const loading = harness.runtime.load(validConfig);
  await Promise.resolve();
  await Promise.resolve();
  const signal = harness.modelRuntime.load.mock.calls[0]![2] as AbortSignal;

  harness.runtime.dispose();
  expect(signal.aborted).toBe(true);
  gate.resolve();

  await expect(loading).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
  expect(harness.disposals()).toEqual({ clock: 1, map: 1, model: 1, overlay: 1, resources: 1 });
});

it('does not let a real MapRuntime register state after SceneRuntime disposal during readJson', async () => {
  const map = new FakeMap();
  const json = deferred<unknown>();
  const readJson = vi.fn(() => json.promise);
  const resources = {
    acquire: vi.fn(async () => ({ readJson }) as unknown as LoadedAsset),
    release: vi.fn(),
    dispose: vi.fn(),
  };
  const mapRuntime = new MapRuntime(map as never, resources as never, {
    createMarker: vi.fn(),
  });
  const harness = sceneRuntimeHarness({ mapRuntime, resources });
  const loading = harness.runtime.load({
    ...validConfig,
    tracks: [
      {
        trackId: 'geo',
        type: 'geojson',
        label: 'GeoJSON',
        visible: true,
        items: [
          {
            id: 'geo-item',
            eventUnitId: 'event-1',
            startMs: 0,
            durationMs: 1_000,
            assetId: 'geojson:border',
            evidenceRefs: ['fixture:evidence'],
            params: {
              lineColor: '#22ccff',
              lineWidth: 2,
              fillColor: '#225577',
              fillOpacity: 0.25,
              circleColor: '#ffffff',
              circleRadius: 4,
              keepAfterEnd: true,
            },
          },
        ],
      },
    ],
  });
  await vi.waitFor(() => expect(readJson).toHaveBeenCalledTimes(1));

  harness.runtime.dispose();
  json.resolve({ type: 'FeatureCollection', features: [] });

  await expect(loading).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
  expect(resources.release.mock.calls).toEqual([['geojson:border']]);
  expect(map.listenerCount('style.load')).toBe(0);
  expect(map.layerIds()).toEqual([]);
  expect(map.sourceData('ise:geo:geo:geo-item')).toBeUndefined();
});

it('diagnoses a clock-frame apply error and pauses without running later frame stages', async () => {
  const harness = sceneRuntimeHarness({ modelApplyErrorAtMs: 500 });
  const diagnostics: Diagnostic[] = [];
  harness.overlayRoot.addEventListener('ise-runtime-diagnostic', (event) => {
    diagnostics.push((event as CustomEvent<Diagnostic>).detail);
  });
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;

  harness.emitClockFrame({ timeMs: 500, playing: true, forceMediaSeek: false });

  expect(harness.calls).toEqual(['map.apply:500', 'model.apply:500', 'clock.pause']);
  expect(harness.clock.isPlaying).toBe(false);
  expect(harness.overlayRoot.dataset.runtimeTimeMs).toBe('0');
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'RUNTIME_FRAME_FAILED',
      severity: 'error',
      recoverable: false,
      message: 'model frame failed at 500',
    }),
  );
});

it('guards pre-load lifecycle calls and disposes every owner exactly once', async () => {
  const harness = sceneRuntimeHarness();

  await expect(harness.runtime.play()).rejects.toMatchObject({ code: 'RUNTIME_NOT_LOADED' });
  await expect(harness.runtime.seek(1)).rejects.toMatchObject({ code: 'RUNTIME_NOT_LOADED' });
  await expect(harness.runtime.replay()).rejects.toMatchObject({ code: 'RUNTIME_NOT_LOADED' });
  harness.runtime.pause();
  expect(harness.calls).toEqual([]);

  await harness.runtime.load(validConfig);
  expect(harness.listenerCount()).toBe(1);
  harness.runtime.dispose();
  harness.runtime.dispose();

  expect(harness.disposals()).toEqual({ clock: 1, map: 1, model: 1, overlay: 1, resources: 1 });
  expect(harness.listenerCount()).toBe(0);
  expect(harness.overlayRoot.dataset.runtimeTimeMs).toBeUndefined();
  await expect(harness.runtime.play()).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
});

it('attempts every owner disposal exactly once when multiple owners throw', async () => {
  const harness = sceneRuntimeHarness();
  const overlayError = new Error('overlay dispose failed');
  const mapError = new Error('map dispose failed');
  harness.overlayRuntime.dispose.mockImplementation(() => {
    throw overlayError;
  });
  harness.mapRuntime.dispose.mockImplementation(() => {
    throw mapError;
  });
  await harness.runtime.load(validConfig);

  let disposalError: unknown;
  try {
    harness.runtime.dispose();
  } catch (error) {
    disposalError = error;
  }

  expect(disposalError).toBeInstanceOf(AggregateError);
  expect((disposalError as AggregateError).errors).toEqual([overlayError, mapError]);
  expect(harness.disposals()).toEqual({ clock: 1, map: 1, model: 1, overlay: 1, resources: 1 });
  expect(harness.listenerCount()).toBe(0);
  expect(harness.overlayRoot.dataset.runtimeTimeMs).toBeUndefined();
  expect(() => harness.runtime.dispose()).not.toThrow();
  expect(harness.disposals()).toEqual({ clock: 1, map: 1, model: 1, overlay: 1, resources: 1 });
});
