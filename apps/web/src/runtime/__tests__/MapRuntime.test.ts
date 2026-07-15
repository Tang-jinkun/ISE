import type { SceneTrack } from '@ise/runtime-contracts';
import { expect, it, vi } from 'vitest';
import type { LoadedAsset } from '../ResourceManager';
import { MapRuntime } from '../MapRuntime';
import { FakeMap } from './helpers/fakes';

type MarkerTrack = Extract<SceneTrack, { type: 'marker' }>;
type GeojsonTrack = Extract<SceneTrack, { type: 'geojson' }>;
type CameraTrack = Extract<SceneTrack, { type: 'camera' }>;
const evidenceRefs = ['fixture:evidence'];
const featureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [76, 30],
          [77, 31],
        ],
      },
    },
  ],
} as const;

function markerTrack(startMs: number, durationMs: number): MarkerTrack {
  return {
    trackId: 'markers',
    type: 'marker',
    label: 'Markers',
    visible: true,
    items: [
      {
        id: 'marker-item',
        eventUnitId: 'event-1',
        startMs,
        durationMs,
        evidenceRefs,
        params: { coordinates: [76, 30], label: 'Ambala', color: '#ff3344' },
      },
    ],
  };
}

function geojsonTrack(
  assetId: string,
  startMs: number,
  durationMs: number,
  keepAfterEnd: boolean,
): GeojsonTrack {
  return {
    trackId: 'geo',
    type: 'geojson',
    label: 'GeoJSON',
    visible: true,
    items: [
      {
        id: 'geo-item',
        eventUnitId: 'event-1',
        startMs,
        durationMs,
        assetId,
        evidenceRefs,
        params: {
          lineColor: '#22ccff',
          lineWidth: 2,
          fillColor: '#225577',
          fillOpacity: 0.25,
          circleColor: '#ffffff',
          circleRadius: 4,
          keepAfterEnd,
        },
      },
    ],
  };
}

function cameraTrack(
  startMs: number,
  durationMs: number,
  params: CameraTrack['items'][number]['params'],
): CameraTrack {
  return {
    trackId: 'camera',
    type: 'camera',
    label: 'Camera',
    visible: true,
    items: [
      {
        id: 'camera-item',
        eventUnitId: 'event-1',
        startMs,
        durationMs,
        evidenceRefs,
        params,
      },
    ],
  };
}

function fakeResources(jsonByAssetId: Record<string, unknown>) {
  return {
    acquire: vi.fn(async (assetId: string) => ({
      readJson: async () => jsonByAssetId[assetId],
    }) as LoadedAsset),
    release: vi.fn(),
  };
}

function markerDependencies(map: FakeMap) {
  return {
    createMarker: vi.fn(() => {
      let added = false;
      const marker = {
        setLngLat: vi.fn(() => marker),
        addTo: vi.fn(() => {
          if (!added) {
            map.markerCount += 1;
          }
          added = true;
          return marker;
        }),
        remove: vi.fn(() => {
          if (added) {
            map.markerCount -= 1;
          }
          added = false;
        }),
      };
      return marker;
    }),
  };
}

it('adds active marker and geometry layers with namespaced IDs and removes expired items', async () => {
  const map = new FakeMap();
  const resources = fakeResources({ 'geo:border': featureCollection });
  const runtime = new MapRuntime(map as never, resources as never, markerDependencies(map));
  await runtime.load([markerTrack(100, 200), geojsonTrack('geo:border', 100, 200, false)]);
  runtime.applyBase(150);
  expect(map.markerCount).toBe(1);
  expect(map.layerIds()).toContain('ise:geo:geo-item:line');
  runtime.applyBase(300);
  expect(map.markerCount).toBe(0);
  expect(map.layerIds()).not.toContain('ise:geo:geo-item:line');
});

it('persists keepAfterEnd geometry and updates a deterministic trail source', async () => {
  const map = new FakeMap();
  const runtime = new MapRuntime(
    map as never,
    fakeResources({ 'geo:border': featureCollection }) as never,
    markerDependencies(map),
  );
  await runtime.load([geojsonTrack('geo:border', 0, 100, true)]);
  runtime.applyBase(500);
  runtime.applyTrails([{ entityId: 'rafale-1', coordinates: [[76, 30], [77, 31]] }]);
  expect(map.layerIds()).toContain('ise:geo:geo-item:line');
  expect(map.sourceData('ise:trail:rafale-1')).toMatchObject({
    geometry: { coordinates: [[76, 30], [77, 31]] },
  });
});

it('uses jumpTo with the same interpolated camera state after seek and replay', async () => {
  const map = new FakeMap({ center: [70, 20], zoom: 3, pitch: 0, bearing: 0 });
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  await runtime.load([
    cameraTrack(1_000, 1_000, {
      center: [80, 30],
      zoom: 7,
      pitch: 40,
      bearing: 90,
      easing: 'linear',
    }),
  ]);
  runtime.applyBase(1_500);
  const first = map.lastJump;
  runtime.applyBase(0);
  runtime.applyBase(1_500);
  expect(map.lastJump).toEqual(first);
  expect(map.easeTo).not.toHaveBeenCalled();
});

it('rebuilds owned layers after style.load and unregisters listeners on dispose', async () => {
  const map = new FakeMap();
  const runtime = new MapRuntime(
    map as never,
    fakeResources({ 'geo:border': featureCollection }) as never,
    markerDependencies(map),
  );
  await runtime.load([geojsonTrack('geo:border', 0, 100, true)]);
  runtime.applyBase(50);
  map.clearStyleAndEmit('style.load');
  expect(map.layerIds()).toContain('ise:geo:geo-item:line');
  runtime.dispose();
  expect(map.listenerCount('style.load')).toBe(0);
  expect(map.layerIds()).toEqual([]);
});
