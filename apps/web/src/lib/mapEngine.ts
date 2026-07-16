import { mapboxToken } from '@/config/public-env';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const tokenlessMapStyle: mapboxgl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: 'OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'tokenless-background',
      type: 'background',
      paint: { 'background-color': '#0b1724' },
    },
    {
      id: 'tokenless-osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-fade-duration': 0 },
    },
  ],
};

export const runtimeMapEngine = (
  mapboxToken ? mapboxgl : maplibregl
) as unknown as typeof mapboxgl;

export function createBaseMap(
  options: Omit<mapboxgl.MapboxOptions, 'style'>,
): mapboxgl.Map {
  if (mapboxToken) {
    mapboxgl.accessToken = mapboxToken;
    return new mapboxgl.Map({
      ...options,
      style: 'mapbox://styles/mapbox/satellite-v9',
    });
  }

  const {
    antialias = false,
    preserveDrawingBuffer = false,
    ...tokenlessOptions
  } = options;
  return new maplibregl.Map({
    ...tokenlessOptions,
    style: tokenlessMapStyle as maplibregl.StyleSpecification,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias, preserveDrawingBuffer },
  } as maplibregl.MapOptions) as unknown as mapboxgl.Map;
}
