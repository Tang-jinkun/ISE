import { tokenStorage } from '@/api/http';
import {
  createSceneRuntime,
  type SceneRuntime,
  type SceneRuntimeOptions,
} from '@/runtime';
import {
  resolvedAssetAccessSchema,
  sceneProjectConfigSchema,
  type SceneProjectConfig,
} from '@ise/runtime-contracts';
import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState } from 'react';

type RuntimeFactory = (options: SceneRuntimeOptions) => SceneRuntime;
type RuntimeStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UseSceneRuntimeOptions {
  map: mapboxgl.Map | null;
  overlayRoot: HTMLElement | null;
  config: SceneProjectConfig | null;
  timeMs?: number;
  runtimeFactory?: RuntimeFactory;
}

interface RuntimeLifecycle {
  runtime: SceneRuntime;
  ready: boolean;
  disposed: boolean;
  seekGeneration: number;
  seekQueue: Promise<void>;
}

export interface UseSceneRuntimeResult {
  runtime: SceneRuntime | null;
  status: RuntimeStatus;
  error: unknown;
  currentTimeMs: number;
  play(): Promise<void>;
  pause(): void;
  replay(): Promise<void>;
  seek(timeMs: number): Promise<void>;
}

const defaultRuntimeFactory: RuntimeFactory = (options) => createSceneRuntime(options);

async function resolveCatalogAsset(assetId: string, signal?: AbortSignal) {
  const token = tokenStorage.getToken(tokenStorage.keys.access);
  const response = await fetch(
    `/SceneBack/asset-catalog/${encodeURIComponent(assetId)}/access`,
    {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(`Asset access request failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as { data?: unknown };
  return resolvedAssetAccessSchema.parse(body.data);
}

export function createSceneAssetResolver(config: SceneProjectConfig) {
  const generated = new Map(config.generatedTrajectories.map(item => [item.assetId, item]));
  const urls = new Set<string>();
  return {
    async resolve(assetId: string, signal?: AbortSignal) {
      const embedded = generated.get(assetId);
      if (!embedded) return resolveCatalogAsset(assetId, signal);
      const url = URL.createObjectURL(new Blob([
        JSON.stringify({ schemaVersion: 'ise-trajectory/v1', points: embedded.trajectory.points }),
      ], { type: 'application/vnd.ise.trajectory+json' }));
      urls.add(url);
      return resolvedAssetAccessSchema.parse({
        assetId: embedded.assetId, url, fingerprint: `sha256:${'0'.repeat(64)}`, size: 0,
        expiresAt: '2099-01-01T00:00:00.000Z', mediaType: 'application/vnd.ise.trajectory+json',
        trajectory: (({ points: _points, ...metadata }) => metadata)(embedded.trajectory),
      });
    },
    revoke() { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); },
  };
}

function queueLatestSeek(lifecycle: RuntimeLifecycle, timeMs: number) {
  const generation = ++lifecycle.seekGeneration;
  lifecycle.seekQueue = lifecycle.seekQueue
    .catch(() => undefined)
    .then(async () => {
      if (
        lifecycle.disposed ||
        !lifecycle.ready ||
        generation !== lifecycle.seekGeneration
      ) {
        return;
      }
      await lifecycle.runtime.seek(timeMs);
    });
  return lifecycle.seekQueue;
}

export function useSceneRuntime({
  map,
  overlayRoot,
  config,
  timeMs = 0,
  runtimeFactory = defaultRuntimeFactory,
}: UseSceneRuntimeOptions): UseSceneRuntimeResult {
  const lifecycleRef = useRef<RuntimeLifecycle | null>(null);
  const requestedTimeRef = useRef(timeMs);
  const [runtime, setRuntime] = useState<SceneRuntime | null>(null);
  const [status, setStatus] = useState<RuntimeStatus>('idle');
  const [error, setError] = useState<unknown>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(timeMs);

  useEffect(() => {
    requestedTimeRef.current = timeMs;
    const lifecycle = lifecycleRef.current;
    if (!lifecycle?.ready || lifecycle.disposed) return;
    void queueLatestSeek(lifecycle, timeMs).catch((seekError) => {
      if (!lifecycle.disposed) {
        setError(seekError);
        setStatus('error');
      }
    });
  }, [timeMs]);

  useEffect(() => {
    if (!map || !overlayRoot || !config) {
      setRuntime(null);
      setStatus('idle');
      setError(null);
      return;
    }

    const parsedConfig = sceneProjectConfigSchema.parse(config);
    const assetResolver = createSceneAssetResolver(parsedConfig);
    const nextRuntime = runtimeFactory({
      map,
      overlayRoot,
      resolveAsset: assetResolver.resolve,
    });
    const lifecycle: RuntimeLifecycle = {
      runtime: nextRuntime,
      ready: false,
      disposed: false,
      seekGeneration: 0,
      seekQueue: Promise.resolve(),
    };
    lifecycleRef.current = lifecycle;
    setRuntime(nextRuntime);
    setStatus('loading');
    setError(null);

    const syncRuntimeTime = () => {
      const value = Number(overlayRoot.dataset.runtimeTimeMs);
      if (!Number.isFinite(value)) return;
      setCurrentTimeMs(value);
    };
    const observer = new MutationObserver(syncRuntimeTime);
    observer.observe(overlayRoot, {
      attributes: true,
      attributeFilter: ['data-runtime-time-ms'],
    });

    void nextRuntime
      .load(parsedConfig)
      .then(async () => {
        if (lifecycle.disposed) return;
        lifecycle.ready = true;
        setStatus('ready');
        await queueLatestSeek(lifecycle, requestedTimeRef.current);
      })
      .catch((loadError) => {
        if (lifecycle.disposed) return;
        setError(loadError);
        setStatus('error');
      });

    return () => {
      observer.disconnect();
      lifecycle.disposed = true;
      lifecycle.seekGeneration += 1;
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      nextRuntime.dispose();
      assetResolver.revoke();
    };
  }, [config, map, overlayRoot, runtimeFactory]);

  const play = useCallback(async () => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle?.ready || lifecycle.disposed) return;
    await lifecycle.runtime.play();
  }, []);

  const pause = useCallback(() => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle?.ready || lifecycle.disposed) return;
    lifecycle.runtime.pause();
  }, []);

  const replay = useCallback(async () => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle?.ready || lifecycle.disposed) return;
    await lifecycle.runtime.replay();
  }, []);

  const seek = useCallback(async (nextTimeMs: number) => {
    requestedTimeRef.current = nextTimeMs;
    const lifecycle = lifecycleRef.current;
    if (!lifecycle?.ready || lifecycle.disposed) return;
    await queueLatestSeek(lifecycle, nextTimeMs);
  }, []);

  return {
    runtime,
    status,
    error,
    currentTimeMs,
    play,
    pause,
    replay,
    seek,
  };
}
