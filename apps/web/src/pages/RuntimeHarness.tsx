import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { mapboxToken } from '@/config/public-env';
import { useSceneRuntime } from '@/hooks/useSceneRuntime';
import { RUNTIME_CATALOG_CONFIG, RUNTIME_MAIN_CONFIG } from '@/runtime';
import { Pause, Play, RotateCcw } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

const fixtures = {
  'runtime-main': RUNTIME_MAIN_CONFIG,
  'runtime-catalog': RUNTIME_CATALOG_CONFIG,
} as const;

type FixtureName = keyof typeof fixtures;

export function RuntimeHarness() {
  const { search } = useLocation();
  const fixture = new URLSearchParams(search).get('fixture') ?? 'runtime-main';
  if (fixture !== 'runtime-main' && fixture !== 'runtime-catalog') {
    return <div role="alert">Unknown runtime fixture.</div>;
  }
  return <RuntimeHarnessController fixture={fixture} />;
}

function RuntimeHarnessController({ fixture }: { fixture: FixtureName }) {
  const mapRootRef = useRef<HTMLDivElement | null>(null);
  const overlayRootRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [timeMs, setTimeMs] = useState(0);

  useEffect(() => {
    if (!mapboxToken || !mapRootRef.current) return;
    mapboxgl.accessToken = mapboxToken;
    const nextMap = new mapboxgl.Map({
      container: mapRootRef.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      center: [76.8165, 30.412],
      zoom: 9,
      attributionControl: false,
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
    config: fixtures[fixture],
    timeMs,
  });
  const status = mapboxToken ? runtime.status : 'error';

  return (
    <div className="fixed inset-0 bg-background">
      <div
        ref={mapRootRef}
        data-testid="runtime-map"
        className="absolute inset-0"
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
          max={fixtures[fixture].totalDurationMs}
          step={100}
          value={timeMs}
          aria-label="毫秒时间"
          data-testid="runtime-seek"
          className="h-8 w-28"
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              setTimeMs(
                Math.min(fixtures[fixture].totalDurationMs, Math.max(0, next)),
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
          className="w-12 text-xs text-muted-foreground"
        >
          {status}
        </span>
      </div>
    </div>
  );
}

export default RuntimeHarness;
