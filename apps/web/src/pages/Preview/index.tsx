import { Button } from '@/components/ui/button';
import { useSceneStore } from '@/stores/sceneStore';
import { Pause, Play } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SceneHeader } from '../Scene/components/SceneHeader';
import { mapboxToken } from '@/config/public-env';

export default function Preview() {
  const navigate = useNavigate();
  const [isPlaying, setIsPlaying] = useState(false);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const { currentScene } = useSceneStore();

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
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [110, 30],
      zoom: 3.5,
      attributionControl: false
    });

    return () => {
      map.remove();
    };
  }, []);

  if (!mapboxToken) {
    return <div role="alert">PUBLIC_MAPBOX_TOKEN is not configured.</div>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SceneHeader
        projectTitle={currentScene?.title || '未命名场景'}
        mode="preview"
      />
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="relative h-[75vh] aspect-[16/9] max-w-[95vw] bg-muted rounded-xl overflow-hidden border border-border shadow-2xl">
          <div ref={mapRef} className="absolute inset-0" />

          {/* Overlay controls or info if needed */}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/20 to-transparent h-24" />
        </div>

        <div className="mt-8 flex items-center gap-6">
          <Button
            size="lg"
            className="rounded-full w-16 h-16 p-0 bg-cyan-500 hover:bg-cyan-400 text-primary-foreground shadow-[0_0_20px_rgba(6,182,212,0.5)] transition-all hover:scale-105"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? (
              <Pause className="w-8 h-8 fill-current" />
            ) : (
              <Play className="w-8 h-8 fill-current ml-1" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
