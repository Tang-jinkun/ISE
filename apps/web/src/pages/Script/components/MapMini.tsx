import { useTheme } from '@/components/theme/ThemeProvider';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { mapboxToken } from '@/config/public-env';

export type MapMarker = {
  name: string;
  lat?: number;
  lng?: number;
  level?: number;
};

export function MapMini({ markers }: { markers: MapMarker[] }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const hasGeo = markers.some(
      (m) => typeof m.lat === 'number' && typeof m.lng === 'number'
    );
    const center = hasGeo
      ? (() => {
          const pts = markers.filter(
            (m) => typeof m.lat === 'number' && typeof m.lng === 'number'
          );
          const lat =
            pts.reduce((s, p) => s + (p.lat as number), 0) / pts.length || 0;
          const lng =
            pts.reduce((s, p) => s + (p.lng as number), 0) / pts.length || 0;
          return { lat, lng };
        })()
      : { lat: 30, lng: 110 };

    if (!mapboxToken || !mapRef.current) return;

    const token = mapboxToken;

    if (!token) {
      mapRef.current.innerHTML =
        '<div style="color:#9ca3af;font-size:11px;padding:8px">未配置 MAPBOX_TOKEN，无法加载地图</div>';
      return;
    }

    mapboxgl.accessToken = token;
    const mapStyle =
      theme === 'dark'
        ? 'mapbox://styles/mapbox/dark-v11'
        : 'mapbox://styles/mapbox/light-v11';

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: mapStyle,
      center: [center.lng, center.lat],
      zoom: 4,
      attributionControl: false
    });
    map.on('load', () => {
      if (hasGeo) {
        const pts = markers.filter(
          (m) => typeof m.lat === 'number' && typeof m.lng === 'number'
        );
        pts.forEach((m, idx) => {
          new mapboxgl.Marker({
            color: m.level === 2 ? '#a855f7' : '#22d3ee'
          })
            .setLngLat([m.lng as number, m.lat as number])
            .setPopup(new mapboxgl.Popup().setText(`${idx + 1}. ${m.name}`))
            .addTo(map);
        });
        if (pts.length > 1) {
          const lineCoords = pts.map((m) => [m.lng as number, m.lat as number]);
          const bounds = lineCoords.reduce(
            (b, c) => b.extend(c as [number, number]),
            new mapboxgl.LngLatBounds(
              lineCoords[0] as [number, number],
              lineCoords[0] as [number, number]
            )
          );
          map.fitBounds(bounds, { padding: 40, duration: 800 });
        }
      }
    });
    return () => {
      map.remove();
    };
  }, [markers]);

  if (!mapboxToken) {
    return <div role="alert">PUBLIC_MAPBOX_TOKEN is not configured.</div>;
  }

  return (
    <div className="rounded-xl border border-border bg-card/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-muted-foreground">地理空间</div>
      </div>
      <div className="flex flex-col gap-3">
        <div
          ref={mapRef}
          className="h-64 w-full rounded-lg border border-border bg-muted/40"
        />
      </div>
    </div>
  );
}
