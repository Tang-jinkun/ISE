import * as turf from '@turf/turf';
import mapboxgl, { AnyLayer } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { mapboxToken } from '@/config/public-env';

interface PreMapProps {
  rasterUrl?: string;
  symbolUrl?: string;
  geojsonUrl?: string;
  geojsonData?: any;
  coordinates?: [number, number];
  bbox?: [number, number, number, number];
}

const getGeometryFillType = (geojsonData: any): string => {
  let geometryType = '';

  if (
    geojsonData.type === 'GeometryCollection' &&
    Array.isArray(geojsonData.geometries)
  ) {
    for (const geometry of geojsonData.geometries) {
      if (
        geometry &&
        typeof geometry === 'object' &&
        'type' in geometry &&
        typeof geometry.type === 'string'
      ) {
        geometryType = geometry.type;
        break; // Use the type of the first valid geometry
      }
    }
  } else if (
    geojsonData.type === 'FeatureCollection' &&
    Array.isArray(geojsonData.features)
  ) {
    for (const feature of geojsonData.features) {
      if (feature?.geometry?.type) {
        geometryType = feature.geometry.type;
        break;
      }
    }
  } else if (geojsonData.type === 'Feature' && geojsonData.geometry?.type) {
    geometryType = geojsonData.geometry.type;
  }

  switch (geometryType) {
    case 'Point':
    case 'MultiPoint':
      return 'circle';
    case 'LineString':
    case 'MultiLineString':
      return 'line';
    case 'Polygon':
    case 'MultiPolygon':
      return 'fill';
    default:
      return 'unknown';
  }
};

export const PreMap = ({
  rasterUrl,
  symbolUrl,
  geojsonUrl,
  geojsonData,
  coordinates,
  bbox
}: PreMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapboxToken || map.current || !mapContainer.current) return;

    mapboxgl.accessToken = mapboxToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      center: coordinates || [-74.5, 40],
      zoom: 9
    });

    const currentMap = map.current;

    currentMap.on('load', async () => {
      // Handle GeoJSON
      if (geojsonUrl || geojsonData) {
        try {
          let data = geojsonData;
          if (!data && geojsonUrl) {
            const response = await fetch(geojsonUrl);
            data = await response.json();
          }

          if (!data) return;

          const fillType = getGeometryFillType(data);

          currentMap.addSource('geojson-source', {
            type: 'geojson',
            data: data
          });

          let layerConfig: AnyLayer = {
            id: 'geojson-layer',
            type: fillType as any,
            source: 'geojson-source'
          };

          switch (fillType) {
            case 'fill':
              layerConfig.paint = {
                'fill-color': '#00C1CD',
                'fill-opacity': 0.8
              };
              break;
            case 'line':
              layerConfig.paint = {
                'line-color': '#00C1CD',
                'line-width': 2,
                'line-opacity': 0.8
              };
              break;
            case 'circle':
              layerConfig.paint = {
                'circle-color': '#00C1CD',
                'circle-radius': 6,
                'circle-opacity': 0.8
              };
              break;
          }

          if (fillType !== 'unknown') {
            currentMap.addLayer(layerConfig);
          }

          const bbox = turf.bbox(data);
          currentMap.fitBounds(bbox as [number, number, number, number], {
            padding: 40,
            maxZoom: 15
          });
        } catch (error) {
          console.error('Error loading or processing GeoJSON:', error);
        }
      }

      // Handle Raster
      if (rasterUrl) {
        const rasterCoords = bbox
          ? [
              [bbox[0], bbox[3]], // Top Left
              [bbox[2], bbox[3]], // Top Right
              [bbox[2], bbox[1]], // Bottom Right
              [bbox[0], bbox[1]] // Bottom Left
            ]
          : coordinates
            ? [
                [coordinates[0] - 0.5, coordinates[1] + 0.5],
                [coordinates[0] + 0.5, coordinates[1] + 0.5],
                [coordinates[0] + 0.5, coordinates[1] - 0.5],
                [coordinates[0] - 0.5, coordinates[1] - 0.5]
              ]
            : null;

        if (rasterCoords) {
          currentMap.addSource('raster-source', {
            type: 'image',
            url: rasterUrl,
            coordinates: rasterCoords as any
          });
          currentMap.addLayer({
            id: 'raster-layer',
            type: 'raster',
            source: 'raster-source',
            paint: { 'raster-fade-duration': 0 }
          });

          if (bbox) {
            currentMap.fitBounds(bbox as [number, number, number, number], {
              padding: 20,
              maxZoom: 15
            });
          }
        }
      }

      // Handle Symbol
      if (symbolUrl && coordinates) {
        const el = document.createElement('div');
        el.className = 'marker';
        el.style.backgroundImage = `url(${symbolUrl})`;
        el.style.width = `50px`;
        el.style.height = `50px`;
        el.style.backgroundSize = '100%';
        new mapboxgl.Marker(el).setLngLat(coordinates).addTo(currentMap);
      }
    });

    return () => {
      currentMap?.remove();
      map.current = null;
    };
  }, [geojsonUrl, geojsonData, rasterUrl, symbolUrl, coordinates]);

  if (!mapboxToken) {
    return <div role="alert">PUBLIC_MAPBOX_TOKEN is not configured.</div>;
  }

  return <div ref={mapContainer} className="w-full h-full" />;
};
