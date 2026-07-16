import { getScene } from '@/api/scene';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSceneRuntime } from '@/hooks/useSceneRuntime';
import { createBaseMap } from '@/lib/mapEngine';
import { RUNTIME_CATALOG_CONFIG, RUNTIME_MAIN_CONFIG } from '@/runtime';
import {
  sceneProjectConfigSchema,
  type SceneProjectConfig,
} from '@ise/runtime-contracts';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type mapboxgl from 'mapbox-gl';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  RUNTIME_CATALOG_MODELS,
  RuntimeCatalogCalibration,
  type RuntimeCatalogModelId,
  type RuntimeModelCalibration,
} from './RuntimeCatalogCalibration';
import { RuntimeCatalogCalibrationViewport } from './RuntimeCatalogCalibrationViewport';

const fixtures = {
  'runtime-main': RUNTIME_MAIN_CONFIG,
  'runtime-catalog': RUNTIME_CATALOG_CONFIG,
} as const;

export function RuntimeHarness() {
  const { search } = useLocation();
  const searchParams = new URLSearchParams(search);
  const sceneId = searchParams.get('sceneId');
  if (searchParams.has('sceneId')) {
    if (!sceneId) {
      return <div role="alert">Invalid persisted scene ID.</div>;
    }
    return <PersistedSceneRuntimeHarness key={sceneId} sceneId={sceneId} />;
  }

  const fixture = searchParams.get('fixture') ?? 'runtime-main';
  if (fixture !== 'runtime-main' && fixture !== 'runtime-catalog') {
    return <div role="alert">Unknown runtime fixture.</div>;
  }
  if (fixture === 'runtime-catalog' && searchParams.get('calibration') === '1') {
    return <RuntimeCatalogCalibrationSession />;
  }
  return <RuntimeHarnessController config={fixtures[fixture]} />;
}

function RuntimeCatalogCalibrationSession() {
  const [records, setRecords] = useState<
    Partial<Record<RuntimeCatalogModelId, RuntimeModelCalibration>>
  >({});
  const orderedRecords = Object.fromEntries(
    RUNTIME_CATALOG_MODELS.flatMap(({ assetId }) => {
      const calibration = records[assetId];
      return calibration ? [[assetId, calibration]] : [];
    }),
  );

  return (
    <>
      <RuntimeCatalogCalibration
        Viewport={RuntimeCatalogCalibrationViewport}
        onRecord={(assetId, calibration) => {
          setRecords((current) => ({ ...current, [assetId]: calibration }));
        }}
      />
      <section className="absolute bottom-3 right-3 z-50 w-[min(22rem,calc(100vw-1.5rem))] border border-border bg-card/95 p-3 shadow-xl">
        <div className="flex items-center justify-between gap-3 text-xs text-foreground">
          <span>Session records</span>
          <output data-testid="calibration-progress">
            {Object.keys(records).length} / {RUNTIME_CATALOG_MODELS.length}
          </output>
        </div>
        <pre
          data-testid="calibration-records"
          aria-label="Current calibration JSON"
          className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-border pt-2 text-[11px] text-muted-foreground"
        >
          {JSON.stringify(orderedRecords, null, 2)}
        </pre>
      </section>
    </>
  );
}

function PersistedSceneRuntimeHarness({ sceneId }: { sceneId: string }) {
  const [config, setConfig] = useState<SceneProjectConfig | null>(null);
  const [blockingError, setBlockingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getScene(sceneId)
      .then((response) => {
        if (!active) return;
        const parsed = sceneProjectConfigSchema.safeParse(response.data.config);
        if (!parsed.success) {
          setBlockingError(
            parsed.error.issues.map((issue) => issue.message).join('; '),
          );
          return;
        }
        setConfig(parsed.data);
      })
      .catch(() => {
        if (active) setBlockingError('Unable to load persisted scene.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sceneId]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading persisted scene...
      </div>
    );
  }

  if (blockingError || !config) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-6 text-foreground">
        <div
          role="alert"
          className="max-w-xl border-l-2 border-red-500 px-4 py-3 text-sm text-red-400"
        >
          {blockingError || 'Persisted scene configuration is invalid.'}
        </div>
      </div>
    );
  }

  return <RuntimeHarnessController config={config} />;
}

function RuntimeHarnessController({ config }: { config: SceneProjectConfig }) {
  const mapRootRef = useRef<HTMLDivElement | null>(null);
  const overlayRootRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [timeMs, setTimeMs] = useState(0);

  useEffect(() => {
    if (!mapRootRef.current) return;
    const nextMap = createBaseMap({
      container: mapRootRef.current,
      center: [76.8165, 30.412],
      zoom: 9,
      attributionControl: false,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    const handleLoad = () => {
      nextMap.resize();
      setMap(nextMap);
    };
    nextMap.on('load', handleLoad);
    const resizeObserver = new ResizeObserver(() => nextMap.resize());
    resizeObserver.observe(mapRootRef.current);

    return () => {
      resizeObserver.disconnect();
      nextMap.off('load', handleLoad);
      nextMap.remove();
    };
  }, []);

  const runtime = useSceneRuntime({
    map,
    overlayRoot: overlayRootRef.current,
    config,
    timeMs,
  });
  const status = runtime.status;
  const runtimeErrorMessage = runtime.error
    ? runtime.error instanceof Error
      ? runtime.error.message
      : String(runtime.error)
    : undefined;

  return (
    <div className="fixed inset-0 bg-background">
      <div
        ref={mapRootRef}
        data-testid="runtime-map"
        className="absolute inset-0"
        style={{ position: 'absolute', inset: 0 }}
      />
      <div
        ref={overlayRootRef}
        data-testid="runtime-overlay"
        className="pointer-events-none absolute inset-0"
      />
      <div className="absolute right-4 top-4 z-50 flex items-center gap-1 border border-border bg-card/95 p-2 shadow-lg">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="播放"
          data-testid="runtime-play"
          disabled={status !== 'ready'}
          onClick={() => void runtime.play().catch(() => undefined)}
        >
          <Play className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="暂停"
          data-testid="runtime-pause"
          disabled={status !== 'ready'}
          onClick={runtime.pause}
        >
          <Pause className="h-4 w-4" />
        </Button>
        <Input
          type="number"
          min={0}
          max={config.totalDurationMs}
          step={100}
          value={timeMs}
          aria-label="毫秒时间"
          data-testid="runtime-seek"
          className="h-8 w-28"
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              setTimeMs(
                Math.min(config.totalDurationMs, Math.max(0, next)),
              );
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="重播"
          data-testid="runtime-replay"
          disabled={status !== 'ready'}
          onClick={() => void runtime.replay().catch(() => undefined)}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <output
          data-testid="runtime-time"
          className="w-16 text-right text-xs tabular-nums text-muted-foreground"
        >
          {Math.round(runtime.currentTimeMs)}
        </output>
        <span
          data-testid="runtime-status"
          data-status={status}
          data-error-message={runtimeErrorMessage}
          className="w-12 text-xs text-muted-foreground"
        >
          {status}
        </span>
      </div>
    </div>
  );
}

export default RuntimeHarness;
