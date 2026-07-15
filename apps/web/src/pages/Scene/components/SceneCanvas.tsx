import { useTheme } from '@/components/theme/ThemeProvider';
import taskSceneManager from '@/stores/sceneManager';
import { ChevronRight } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { mapboxToken } from '@/config/public-env';

interface SceneCanvasProps {
  mode?: 'edit' | 'preview';
  onMapReady?: (map: mapboxgl.Map, overlayRoot: HTMLElement) => void;
  onMapDispose?: (map: mapboxgl.Map) => void;
}

export function SceneCanvas({
  mode = 'edit',
  onMapReady,
  onMapDispose,
}: SceneCanvasProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const onMapReadyRef = useRef(onMapReady);
  const onMapDisposeRef = useRef(onMapDispose);
  const { theme } = useTheme();

  useEffect(() => {
    onMapReadyRef.current = onMapReady;
    onMapDisposeRef.current = onMapDispose;
  }, [onMapDispose, onMapReady]);

  useEffect(() => {
    if (!mapboxToken || !mapRef.current) return;

    const token = mapboxToken;

    if (!token) {
      mapRef.current.innerHTML =
        '<div style="color:#9ca3af;font-size:11px;padding:8px">未配置 MAPBOX_TOKEN，无法加载地图</div>';
      return;
    }

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      center: [110, 30],
      zoom: 3.5,
      attributionControl: false
    });

    mapInstance.current = map;
    taskSceneManager.mapManager.setMap(map);

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(mapRef.current);

    map.on('load', () => {
      map.resize();
      if (overlayRef.current) {
        onMapReadyRef.current?.(map, overlayRef.current);
      }
    });

    return () => {
      resizeObserver.disconnect();
      onMapDisposeRef.current?.(map);
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  // useEffect(() => {
  //   if (mapInstance.current) {
  //     mapInstance.current.setStyle(
  //       theme === 'dark'
  //         ? 'mapbox://styles/mapbox/dark-v11'
  //         : 'mapbox://styles/mapbox/light-v11'
  //     );
  //   }
  // }, [theme]);

  if (!mapboxToken) {
    return <div role="alert">PUBLIC_MAPBOX_TOKEN is not configured.</div>;
  }

  if (mode === 'preview') {
    return (
      <section className="flex flex-1 items-center justify-center p-8">
        <div className="relative h-[75vh] aspect-[16/9] max-w-[95vw] overflow-hidden rounded-xl border border-border bg-muted shadow-2xl">
          <div
            ref={mapRef}
            data-testid="scene-runtime-map"
            className="absolute inset-0"
          />
          <div
            ref={overlayRef}
            data-testid="scene-runtime-overlay"
            className="pointer-events-none absolute inset-0"
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/20 to-transparent" />
        </div>
      </section>
    );
  }

  return (
    <section className="flex-1 flex items-center justify-center bg-background/50">
      <div className="w-full max-w-5xl px-6">
        <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>场景</span>
            <ChevronRight className="w-3 h-3" />
            <span>16:9</span>
          </div>
        </div>
        <div className="relative w-full border border-border rounded-2xl overflow-hidden shadow-2xl bg-card">
          <div className="relative w-full aspect-video">
            <div
              ref={mapRef}
              data-testid="scene-runtime-map"
              className="absolute top-0 left-0 w-full h-full"
              style={{ boxSizing: 'border-box' }}
            />
            <div
              ref={overlayRef}
              data-testid="scene-runtime-overlay"
              className="pointer-events-none absolute inset-0"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
