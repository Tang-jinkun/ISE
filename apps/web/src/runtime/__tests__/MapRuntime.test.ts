import type { SceneTrack } from '@ise/runtime-contracts';
import { expect, it, vi } from 'vitest';
import type { LoadedAsset } from '../ResourceManager';
import { MapRuntime } from '../MapRuntime';
import type { ModelEntityFrameSnapshot } from '../ModelRuntime';
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
const malformedGeojsonCases: Array<[string, unknown]> = [
  [
    'Feature properties',
    { type: 'Feature', geometry: { type: 'Point', coordinates: [76, 30] } },
  ],
  ['Feature geometry', { type: 'Feature', properties: {} }],
  ['FeatureCollection features', { type: 'FeatureCollection' }],
  ['GeometryCollection geometries', { type: 'GeometryCollection' }],
  [
    'geometry type',
    { type: 'Feature', properties: {}, geometry: { type: 'Unknown', coordinates: [76, 30] } },
  ],
  [
    'LineString coordinates',
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[76, 30]] } },
  ],
  [
    'coordinate range',
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [181, 30] } },
  ],
];

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
  trackId = 'geo',
  itemId = 'geo-item',
): GeojsonTrack {
  return {
    trackId,
    type: 'geojson',
    label: 'GeoJSON',
    visible: true,
    items: [
      {
        id: itemId,
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

function snapshot(
  entityId: string,
  longitude: number,
  latitude: number,
  options: Partial<ModelEntityFrameSnapshot> = {},
): ModelEntityFrameSnapshot {
  return {
    entityId,
    state: 'normal',
    visible: true,
    longitude,
    latitude,
    altitudeM: 1_000,
    headingDeg: 90,
    pitchDeg: 0,
    position: [longitude, latitude, 0],
    quaternion: [0, 0, 0, 1],
    ...options,
  };
}

it('adds active marker and geometry layers with namespaced IDs and removes expired items', async () => {
  const map = new FakeMap();
  const resources = fakeResources({ 'geo:border': featureCollection });
  const runtime = new MapRuntime(map as never, resources as never, markerDependencies(map));
  await runtime.load([markerTrack(100, 200), geojsonTrack('geo:border', 100, 200, false)]);
  runtime.applyBase(150);
  expect(map.markerCount).toBe(1);
  expect(map.layerIds()).toContain('ise:geo:geo:geo-item:line');
  runtime.applyBase(300);
  expect(map.markerCount).toBe(0);
  expect(map.layerIds()).not.toContain('ise:geo:geo:geo-item:line');
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
  expect(map.layerIds()).toContain('ise:geo:geo:geo-item:line');
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

it('follows the current visible actor snapshot with a deterministic heading look-ahead', async () => {
  const map = new FakeMap();
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  await runtime.load([
    cameraTrack(1_000, 2_000, {
      action: 'camera.follow_actor',
      entityId: 'fighter-1',
      framing: 'tracking',
      zoom: 11,
      pitch: 35,
      bearing: 20,
      lookAheadMs: 1_000,
      transitionMs: 0,
    }),
  ]);

  runtime.applyBase(1_500, [snapshot('fighter-1', 76, 30)]);
  expect(map.lastJump).toMatchObject({ zoom: 11, pitch: 35, bearing: 20 });
  expect((map.lastJump?.center as [number, number])[0]).toBeCloseTo(76.01);
  expect((map.lastJump?.center as [number, number])[1]).toBe(30);

  runtime.applyBase(1_600, [snapshot('fighter-1', 77, 31, { headingDeg: 0 })]);
  expect(map.lastJump).toMatchObject({ zoom: 11, pitch: 35, bearing: 20 });
  expect((map.lastJump?.center as [number, number])[0]).toBe(77);
  expect((map.lastJump?.center as [number, number])[1]).toBeCloseTo(31.01);
});

it('fits visible follow-group members with bounds padding and clamps zoom', async () => {
  const map = new FakeMap();
  map.cameraForBounds.mockReturnValue({ center: [80, 30], zoom: 18 });
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  await runtime.load([
    cameraTrack(0, 2_000, {
      action: 'camera.follow_group',
      entityIds: ['fighter-1', 'fighter-2'],
      framing: 'formation',
      paddingPx: 40,
      minZoom: 5,
      maxZoom: 12,
      pitch: 30,
      bearing: -10,
      transitionMs: 0,
    }),
  ]);

  runtime.applyBase(500, [snapshot('fighter-1', 76, 30), snapshot('fighter-2', 84, 31)]);
  expect(map.cameraForBounds).toHaveBeenCalledWith([[76, 30], [84, 31]], { padding: 40 });
  expect(map.lastJump).toEqual({ center: [80, 30], zoom: 12, pitch: 30, bearing: -10 });

  runtime.applyBase(600, [snapshot('fighter-1', 76, 30)]);
  expect(map.lastJump).toEqual({ center: [76, 30], zoom: 12, pitch: 30, bearing: -10 });
});

it('uses the deterministic static fallback when an active follow subject is hidden', async () => {
  const map = new FakeMap({ center: [70, 20], zoom: 3, pitch: 0, bearing: 0 });
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  await runtime.load([
    cameraTrack(0, 1_000, {
      action: 'camera.follow_actor',
      entityId: 'fighter-1',
      framing: 'close',
      zoom: 12,
      pitch: 45,
      bearing: 10,
      lookAheadMs: 500,
      transitionMs: 0,
    }),
  ]);

  runtime.applyBase(500, [snapshot('fighter-1', 76, 30, { visible: false })]);
  expect(map.lastJump).toEqual({ center: [70, 20], zoom: 3, pitch: 0, bearing: 0 });
});

it('recreates an actor-follow camera state after seek and replay without map history', async () => {
  const map = new FakeMap();
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  await runtime.load([
    cameraTrack(1_000, 2_000, {
      action: 'camera.follow_actor',
      entityId: 'fighter-1',
      framing: 'tracking',
      zoom: 10,
      pitch: 25,
      bearing: 5,
      lookAheadMs: 500,
      transitionMs: 400,
    }),
  ]);
  const frames = [snapshot('fighter-1', 76, 30)];

  runtime.applyBase(1_200, frames);
  const first = map.lastJump;
  runtime.applyBase(0, []);
  runtime.applyBase(1_200, frames);
  expect(map.lastJump).toEqual(first);
  expect(map.easeTo).not.toHaveBeenCalled();
});

it('blends from the preceding dynamic policy using the current snapshots', async () => {
  const map = new FakeMap();
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  const track: CameraTrack = {
    trackId: 'camera',
    type: 'camera',
    label: 'Camera',
    visible: true,
    items: [
      {
        id: 'follow-first',
        eventUnitId: 'event-1',
        startMs: 0,
        durationMs: 1_000,
        evidenceRefs,
        params: {
          action: 'camera.follow_actor',
          entityId: 'fighter-1',
          framing: 'tracking',
          zoom: 8,
          pitch: 10,
          bearing: 20,
          lookAheadMs: 0,
          transitionMs: 0,
        },
      },
      {
        id: 'follow-second',
        eventUnitId: 'event-2',
        startMs: 1_000,
        durationMs: 1_000,
        evidenceRefs,
        params: {
          action: 'camera.follow_actor',
          entityId: 'fighter-2',
          framing: 'close',
          zoom: 12,
          pitch: 30,
          bearing: 60,
          lookAheadMs: 0,
          transitionMs: 500,
        },
      },
    ],
  };
  await runtime.load([track]);

  runtime.applyBase(1_250, [snapshot('fighter-1', 74, 25), snapshot('fighter-2', 84, 35)]);
  expect(map.lastJump).toEqual({ center: [79, 30], zoom: 10, pitch: 20, bearing: 40 });
});

it('blends a static camera from the preceding dynamic policy without a boundary cut', async () => {
  const map = new FakeMap({ center: [70, 20], zoom: 3, pitch: 0, bearing: 0 });
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  const track: CameraTrack = {
    trackId: 'camera',
    type: 'camera',
    label: 'Camera',
    visible: true,
    items: [
      {
        id: 'follow-first',
        eventUnitId: 'event-1',
        startMs: 0,
        durationMs: 1_000,
        evidenceRefs,
        params: {
          action: 'camera.follow_actor',
          entityId: 'fighter-1',
          framing: 'tracking',
          zoom: 8,
          pitch: 10,
          bearing: 20,
          lookAheadMs: 0,
          transitionMs: 0,
        },
      },
      {
        id: 'static-second',
        eventUnitId: 'event-2',
        startMs: 1_000,
        durationMs: 1_000,
        evidenceRefs,
        params: {
          center: [100, 50],
          zoom: 12,
          pitch: 30,
          bearing: 60,
          easing: 'linear',
        },
      },
    ],
  };
  await runtime.load([track]);
  const frames = [snapshot('fighter-1', 80, 30)];

  runtime.applyBase(1_000, frames);
  expect(map.lastJump).toEqual({ center: [80, 30], zoom: 8, pitch: 10, bearing: 20 });
  runtime.applyBase(1_500, frames);
  expect(map.lastJump).toEqual({ center: [90, 40], zoom: 10, pitch: 20, bearing: 40 });
});

it('persists the latest dynamic policy through a camera timeline gap', async () => {
  const map = new FakeMap({ center: [70, 20], zoom: 3, pitch: 0, bearing: 0 });
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  const track: CameraTrack = {
    trackId: 'camera',
    type: 'camera',
    label: 'Camera',
    visible: true,
    items: [
      {
        id: 'follow-before-gap',
        eventUnitId: 'event-1',
        startMs: 0,
        durationMs: 1_000,
        evidenceRefs,
        params: {
          action: 'camera.follow_actor',
          entityId: 'fighter-1',
          framing: 'tracking',
          zoom: 8,
          pitch: 10,
          bearing: 20,
          lookAheadMs: 0,
          transitionMs: 0,
        },
      },
      {
        id: 'static-after-gap',
        eventUnitId: 'event-2',
        startMs: 2_000,
        durationMs: 1_000,
        evidenceRefs,
        params: {
          center: [100, 50],
          zoom: 12,
          pitch: 30,
          bearing: 60,
          easing: 'linear',
        },
      },
    ],
  };
  await runtime.load([track]);

  runtime.applyBase(1_500, [snapshot('fighter-1', 82, 32)]);
  expect(map.lastJump).toEqual({ center: [82, 32], zoom: 8, pitch: 10, bearing: 20 });
});

it('recreates a dynamic-to-static blend after seek without camera history', async () => {
  const map = new FakeMap({ center: [70, 20], zoom: 3, pitch: 0, bearing: 0 });
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  const track: CameraTrack = {
    trackId: 'camera',
    type: 'camera',
    label: 'Camera',
    visible: true,
    items: [
      {
        id: 'follow-first',
        eventUnitId: 'event-1',
        startMs: 0,
        durationMs: 1_000,
        evidenceRefs,
        params: {
          action: 'camera.follow_actor',
          entityId: 'fighter-1',
          framing: 'tracking',
          zoom: 8,
          pitch: 10,
          bearing: 20,
          lookAheadMs: 0,
          transitionMs: 0,
        },
      },
      {
        id: 'static-second',
        eventUnitId: 'event-2',
        startMs: 1_000,
        durationMs: 1_000,
        evidenceRefs,
        params: {
          center: [100, 50],
          zoom: 12,
          pitch: 30,
          bearing: 60,
          easing: 'easeInOut',
        },
      },
    ],
  };
  await runtime.load([track]);
  const frames = [snapshot('fighter-1', 80, 30)];

  runtime.applyBase(1_250, frames);
  const first = map.lastJump;
  expect(first).toEqual({
    center: [83.125, 33.125],
    zoom: 8.625,
    pitch: 13.125,
    bearing: 26.25,
  });
  runtime.applyBase(0, frames);
  runtime.applyBase(1_250, frames);
  expect(map.lastJump).toEqual(first);
  expect(map.easeTo).not.toHaveBeenCalled();
});

it('preserves the legacy static camera reducer byte-for-byte', async () => {
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

  runtime.applyBase(1_500, []);
  expect(map.lastJump).toEqual({ center: [75, 25], zoom: 5, pitch: 20, bearing: 45 });
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
  expect(map.layerIds()).toContain('ise:geo:geo:geo-item:line');
  runtime.dispose();
  expect(map.listenerCount('style.load')).toBe(0);
  expect(map.layerIds()).toEqual([]);
});

it('keeps a geojson track named trail separate from trajectory trail sources', async () => {
  const map = new FakeMap();
  const runtime = new MapRuntime(
    map as never,
    fakeResources({ 'geo:border': featureCollection }) as never,
    markerDependencies(map),
  );
  await runtime.load([
    geojsonTrack('geo:border', 0, 100, true, 'trail', 'rafale-1'),
  ]);

  runtime.applyBase(50);
  runtime.applyTrails([{ entityId: 'rafale-1', coordinates: [[76, 30], [77, 31]] }]);

  expect(map.sourceData('ise:geo:trail:rafale-1')).toMatchObject({
    type: 'FeatureCollection',
  });
  expect(map.sourceData('ise:trail:rafale-1')).toMatchObject({
    geometry: { type: 'LineString' },
  });
});

it.each(malformedGeojsonCases)('rejects malformed GeoJSON missing or invalid %s', async (_label, value) => {
  const map = new FakeMap();
  const runtime = new MapRuntime(
    map as never,
    fakeResources({ 'geo:border': value }) as never,
    markerDependencies(map),
  );

  await expect(runtime.load([geojsonTrack('geo:border', 0, 100, true)])).rejects.toMatchObject({
    code: 'GEOJSON_INVALID',
  });
});

it('wraps GeoJSON JSON parse failures at load time', async () => {
  const map = new FakeMap();
  const resources = {
    acquire: vi.fn(async () => ({
      readJson: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }) as unknown as LoadedAsset),
    release: vi.fn(),
  };
  const runtime = new MapRuntime(map as never, resources as never, markerDependencies(map));

  await expect(runtime.load([geojsonTrack('geo:border', 0, 100, true)])).rejects.toMatchObject({
    code: 'GEOJSON_INVALID',
  });
});

it('accepts an RFC 7946 Feature with explicit null geometry', async () => {
  const map = new FakeMap();
  const nullGeometryFeature = {
    type: 'Feature',
    properties: null,
    geometry: null,
  };
  const runtime = new MapRuntime(
    map as never,
    fakeResources({ 'geo:border': nullGeometryFeature }) as never,
    markerDependencies(map),
  );

  await runtime.load([geojsonTrack('geo:border', 0, 100, true)]);
  runtime.applyBase(50);

  expect(map.sourceData('ise:geo:geo:geo-item')).toMatchObject({
    type: 'Feature',
    properties: null,
    geometry: null,
  });
});
