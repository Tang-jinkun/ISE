import type mapboxgl from 'mapbox-gl';
import {
  sceneProjectConfigSchema,
  type ResolvedAssetAccess,
  type SceneProjectConfig,
} from '@ise/runtime-contracts';
import { expect, expectTypeOf, it } from 'vitest';
import {
  createSceneRuntime,
  RUNTIME_CATALOG_ASSET_IDS,
  RUNTIME_CATALOG_CONFIG,
  RUNTIME_MAIN_CONFIG,
  type SceneRuntime,
} from '../index';

const allCatalogAssetIds = Object.values(RUNTIME_CATALOG_ASSET_IDS).flat();

function referencedAssetIds(config: SceneProjectConfig) {
  const assetIds = new Set<string>();
  for (const entity of config.entities) {
    if (entity.modelAssetId) assetIds.add(entity.modelAssetId);
    if (entity.defaultTrajectoryAssetId) assetIds.add(entity.defaultTrajectoryAssetId);
  }
  for (const track of config.tracks) {
    if (track.type === 'image' || track.type === 'video' || track.type === 'geojson') {
      for (const item of track.items) assetIds.add(item.assetId);
    } else if (track.type === 'model') {
      for (const item of track.items) {
        if (item.params.action === 'model.follow_path') {
          assetIds.add(item.params.trajectoryAssetId);
        }
      }
    }
  }
  return [...assetIds].sort();
}

it('publicly exports validated fixture and factory contracts', () => {
  expect(sceneProjectConfigSchema.parse(RUNTIME_MAIN_CONFIG)).toEqual(RUNTIME_MAIN_CONFIG);
  expect(sceneProjectConfigSchema.parse(RUNTIME_CATALOG_CONFIG)).toEqual(RUNTIME_CATALOG_CONFIG);
  expectTypeOf(RUNTIME_MAIN_CONFIG).toMatchTypeOf<SceneProjectConfig>();
  expectTypeOf(RUNTIME_CATALOG_CONFIG).toMatchTypeOf<SceneProjectConfig>();
  expectTypeOf(createSceneRuntime).toEqualTypeOf<
    (options: {
      map: mapboxgl.Map;
      overlayRoot: HTMLElement;
      resolveAsset(assetId: string, signal?: AbortSignal): Promise<ResolvedAssetAccess>;
    }) => SceneRuntime
  >();
  expect(RUNTIME_MAIN_CONFIG.diagnostics).toEqual([]);
  expect(RUNTIME_CATALOG_CONFIG.diagnostics).toEqual([]);
});

it('builds the exact synchronized main acceptance scene', () => {
  expect(RUNTIME_MAIN_CONFIG.totalDurationMs).toBe(12_000);
  expect(RUNTIME_MAIN_CONFIG.entities).toEqual([
    {
      entityId: 'rafale-main', displayName: 'Rafale', kind: 'aircraft',
      modelAssetId: 'model:rafale', defaultTrajectoryAssetId: 'trajectory:ambala-rafale-1',
      initialState: 'normal',
    },
    {
      entityId: 'j10-main', displayName: 'J-10', kind: 'aircraft',
      modelAssetId: 'model:j10', defaultTrajectoryAssetId: 'trajectory:minhas-j10ce-1',
      initialState: 'normal',
    },
    {
      entityId: 'pl15e-main', displayName: 'PL-15E', kind: 'missile',
      modelAssetId: 'model:pl15e', defaultTrajectoryAssetId: 'trajectory:pakistan-missile-1',
      initialState: 'normal',
    },
  ]);

  const camera = RUNTIME_MAIN_CONFIG.tracks.find((track) => track.type === 'camera')!;
  const staticCameraItems = camera.items.filter(
    (item): item is (typeof camera.items)[number] & {
      params: { center: [number, number]; zoom: number; pitch: number; bearing: number };
    } => !('action' in item.params),
  );
  expect(staticCameraItems.map((item) => ({
    id: item.id,
    startMs: item.startMs,
    endMs: item.startMs + item.durationMs,
    center: item.params.center,
    zoom: item.params.zoom,
    pitch: item.params.pitch,
    bearing: item.params.bearing,
  }))).toEqual([
    { id: 'camera-main-open', startMs: 0, endMs: 1_000, center: [76.8165, 30.412], zoom: 12, pitch: 55, bearing: 0 },
    { id: 'camera-main-j10', startMs: 4_000, endMs: 7_000, center: [76.8165, 30.412], zoom: 12, pitch: 55, bearing: 0 },
    { id: 'camera-main-pl15e', startMs: 7_000, endMs: 10_000, center: [76.8165, 30.412], zoom: 12, pitch: 55, bearing: 0 },
  ]);

  const model = RUNTIME_MAIN_CONFIG.tracks.find((track) => track.type === 'model')!;
  const followItems: Array<{
    entityId: string;
    trajectoryAssetId: string;
    startMs: number;
    endMs: number;
  }> = [];
  for (const item of model.items) {
    if (item.params.action === 'model.follow_path') {
      followItems.push({
        entityId: item.params.entityId,
        trajectoryAssetId: item.params.trajectoryAssetId,
        startMs: item.startMs,
        endMs: item.startMs + item.durationMs,
      });
    }
  }
  expect(followItems).toEqual([
    { entityId: 'rafale-main', trajectoryAssetId: 'trajectory:ambala-rafale-1', startMs: 1_000, endMs: 4_000 },
    { entityId: 'j10-main', trajectoryAssetId: 'trajectory:minhas-j10ce-1', startMs: 4_000, endMs: 7_000 },
    { entityId: 'pl15e-main', trajectoryAssetId: 'trajectory:pakistan-missile-1', startMs: 7_000, endMs: 10_000 },
  ]);

  const image = RUNTIME_MAIN_CONFIG.tracks.find((track) => track.type === 'image')!.items[0]!;
  expect(image).toMatchObject({
    id: 'image-main-cockpit-hud', startMs: 0, durationMs: 4_000,
    assetId: 'image:cockpit-hud',
    params: {
      layout: { xPct: 70, yPct: 5, widthPct: 25, heightPct: 30, zIndex: 20, opacity: 0.9, fit: 'contain' },
      enter: 'fade', exit: 'fade',
    },
  });
  const video = RUNTIME_MAIN_CONFIG.tracks.find((track) => track.type === 'video')!.items[0]!;
  expect(video).toMatchObject({
    id: 'video-main-missile-impact', startMs: 7_000, durationMs: 4_000,
    assetId: 'video:missile-impact',
    params: {
      layout: { xPct: 65, yPct: 5, widthPct: 30, heightPct: 32, zIndex: 30, opacity: 1, fit: 'cover' },
      volume: 0.3, playbackRate: 1, loop: false,
    },
  });
  const subtitle = RUNTIME_MAIN_CONFIG.tracks.find((track) => track.type === 'subtitle')!.items[0]!;
  expect(subtitle).toMatchObject({
    id: 'subtitle-main-acceptance', startMs: 500, durationMs: 11_000,
    params: { text: 'Runtime synchronized acceptance', position: 'bottom', maxWidthPct: 70 },
  });

  for (const track of RUNTIME_MAIN_CONFIG.tracks) {
    for (const item of track.items) {
      expect(item.eventUnitId).toBe('fixture-runtime');
      expect(item.evidenceRefs).toEqual(['fixture:e2e']);
    }
  }
});

it('references every required real catalog asset without access material', () => {
  expect(RUNTIME_CATALOG_ASSET_IDS).toEqual({
    models: ['model:j10', 'model:jf17', 'model:mig29', 'model:pl15e', 'model:rafale', 'model:su30mki'],
    videos: ['video:ooda-chain', 'video:runway-exit', 'video:missile-impact', 'video:cockpit-jamming',
      'video:damage-check', 'video:bomb-explosion', 'video:radar-offline', 'video:target-lock'],
    images: ['image:ground-radar', 'image:cockpit-hud', 'image:airport', 'image:aew-illustration'],
    trajectories: ['trajectory:ambala-rafale-1', 'trajectory:minhas-j10ce-1', 'trajectory:pakistan-missile-1'],
  });
  expect(new Set(allCatalogAssetIds).size).toBe(21);
  expect(referencedAssetIds(RUNTIME_CATALOG_CONFIG)).toEqual([...allCatalogAssetIds].sort());
  expect(RUNTIME_CATALOG_CONFIG.entities.find((entity) => entity.modelAssetId === 'model:pl15e')?.kind).toBe('missile');
  expect(RUNTIME_CATALOG_CONFIG.entities.filter((entity) => entity.modelAssetId !== 'model:pl15e')
    .every((entity) => entity.kind === 'aircraft')).toBe(true);

  const mediaItems: Array<{ startMs: number; durationMs: number }> = [];
  for (const track of RUNTIME_CATALOG_CONFIG.tracks) {
    if (track.type === 'image' || track.type === 'video') mediaItems.push(...track.items);
  }
  mediaItems.sort((left, right) => left.startMs - right.startMs);
  for (let index = 1; index < mediaItems.length; index += 1) {
    expect(mediaItems[index]!.startMs).toBeGreaterThanOrEqual(
      mediaItems[index - 1]!.startMs + mediaItems[index - 1]!.durationMs,
    );
  }
  for (const track of RUNTIME_CATALOG_CONFIG.tracks) {
    for (const item of track.items) {
      expect(item.eventUnitId).toBe('fixture-runtime');
      expect(item.evidenceRefs).toEqual(['fixture:e2e']);
    }
  }

  const serialized = JSON.stringify({
    RUNTIME_CATALOG_ASSET_IDS,
    RUNTIME_MAIN_CONFIG,
    RUNTIME_CATALOG_CONFIG,
  });
  expect(serialized).not.toMatch(/https?:|blob:|data:|[A-Z]:\\|sourceRelativePath|objectName|binary/i);
});
