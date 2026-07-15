import {
  sceneProjectConfigSchema,
  type OverlayLayout,
  type SceneProjectConfig,
} from '@ise/runtime-contracts';

export const RUNTIME_CATALOG_ASSET_IDS = {
  models: ['model:j10', 'model:jf17', 'model:mig29', 'model:pl15e', 'model:rafale', 'model:su30mki'],
  videos: [
    'video:ooda-chain',
    'video:runway-exit',
    'video:missile-impact',
    'video:cockpit-jamming',
    'video:damage-check',
    'video:bomb-explosion',
    'video:radar-offline',
    'video:target-lock',
  ],
  images: ['image:ground-radar', 'image:cockpit-hud', 'image:airport', 'image:aew-illustration'],
  trajectories: [
    'trajectory:ambala-rafale-1',
    'trajectory:minhas-j10ce-1',
    'trajectory:pakistan-missile-1',
  ],
} as const;

const EVENT_UNIT_ID = 'fixture-runtime';
const EVIDENCE_REFS = ['fixture:e2e'] as const;
const ACCEPTANCE_CENTER = [76.8165, 30.412] as const;
const IMAGE_LAYOUT: OverlayLayout = {
  xPct: 70,
  yPct: 5,
  widthPct: 25,
  heightPct: 30,
  zIndex: 20,
  opacity: 0.9,
  fit: 'contain',
};
const VIDEO_LAYOUT: OverlayLayout = {
  xPct: 65,
  yPct: 5,
  widthPct: 30,
  heightPct: 32,
  zIndex: 30,
  opacity: 1,
  fit: 'cover',
};

function commonItem(id: string, startMs: number, durationMs: number) {
  return { id, eventUnitId: EVENT_UNIT_ID, startMs, durationMs, evidenceRefs: EVIDENCE_REFS };
}

function spawnItem(id: string, entityId: string, startMs: number) {
  return {
    ...commonItem(id, startMs, 1),
    params: { action: 'model.spawn' as const, entityId },
  };
}

function followItem(
  id: string,
  entityId: string,
  trajectoryAssetId: string,
  startMs: number,
  durationMs: number,
) {
  return {
    ...commonItem(id, startMs, durationMs),
    params: { action: 'model.follow_path' as const, entityId, trajectoryAssetId },
  };
}

function cameraItem(id: string, startMs: number, durationMs: number) {
  return {
    ...commonItem(id, startMs, durationMs),
    params: {
      center: ACCEPTANCE_CENTER,
      zoom: 12,
      pitch: 55,
      bearing: 0,
      easing: 'easeInOut' as const,
    },
  };
}

function imageItem(id: string, assetId: string, startMs: number, durationMs: number) {
  return {
    ...commonItem(id, startMs, durationMs),
    assetId,
    params: { layout: IMAGE_LAYOUT, enter: 'fade' as const, exit: 'fade' as const },
  };
}

function videoItem(id: string, assetId: string, startMs: number, durationMs: number) {
  return {
    ...commonItem(id, startMs, durationMs),
    assetId,
    params: {
      layout: VIDEO_LAYOUT,
      volume: 0.3,
      playbackRate: 1,
      loop: false,
    },
  };
}

export const RUNTIME_MAIN_CONFIG: SceneProjectConfig = sceneProjectConfigSchema.parse({
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'fixture-runtime-main-document',
  eventPlanArtifactId: 'fixture-runtime-main-events',
  runtimePlanArtifactId: 'fixture-runtime-main-plan',
  totalDurationMs: 12_000,
  entities: [
    {
      entityId: 'rafale-main',
      displayName: 'Rafale',
      kind: 'aircraft',
      modelAssetId: 'model:rafale',
      defaultTrajectoryAssetId: 'trajectory:ambala-rafale-1',
      initialState: 'normal',
    },
    {
      entityId: 'j10-main',
      displayName: 'J-10',
      kind: 'aircraft',
      modelAssetId: 'model:j10',
      defaultTrajectoryAssetId: 'trajectory:minhas-j10ce-1',
      initialState: 'normal',
    },
    {
      entityId: 'pl15e-main',
      displayName: 'PL-15E',
      kind: 'missile',
      modelAssetId: 'model:pl15e',
      defaultTrajectoryAssetId: 'trajectory:pakistan-missile-1',
      initialState: 'normal',
    },
  ],
  tracks: [
    {
      trackId: 'camera-main',
      type: 'camera',
      label: 'Acceptance camera',
      visible: true,
      items: [
        cameraItem('camera-main-open', 0, 1_000),
        cameraItem('camera-main-j10', 4_000, 3_000),
        cameraItem('camera-main-pl15e', 7_000, 3_000),
      ],
    },
    {
      trackId: 'model-main',
      type: 'model',
      label: 'Acceptance models',
      visible: true,
      items: [
        spawnItem('model-main-rafale-spawn', 'rafale-main', 1_000),
        followItem('model-main-rafale-follow', 'rafale-main', 'trajectory:ambala-rafale-1', 1_000, 3_000),
        spawnItem('model-main-j10-spawn', 'j10-main', 4_000),
        followItem('model-main-j10-follow', 'j10-main', 'trajectory:minhas-j10ce-1', 4_000, 3_000),
        spawnItem('model-main-pl15e-spawn', 'pl15e-main', 7_000),
        followItem('model-main-pl15e-follow', 'pl15e-main', 'trajectory:pakistan-missile-1', 7_000, 3_000),
      ],
    },
    {
      trackId: 'image-main',
      type: 'image',
      label: 'Acceptance image',
      visible: true,
      items: [imageItem('image-main-cockpit-hud', 'image:cockpit-hud', 0, 4_000)],
    },
    {
      trackId: 'video-main',
      type: 'video',
      label: 'Acceptance video',
      visible: true,
      items: [videoItem('video-main-missile-impact', 'video:missile-impact', 7_000, 4_000)],
    },
    {
      trackId: 'subtitle-main',
      type: 'subtitle',
      label: 'Acceptance subtitle',
      visible: true,
      items: [{
        ...commonItem('subtitle-main-acceptance', 500, 11_000),
        params: {
          text: 'Runtime synchronized acceptance',
          position: 'bottom',
          maxWidthPct: 70,
        },
      }],
    },
  ],
  diagnostics: [],
});

const catalogEntities = [
  { key: 'j10', name: 'J-10', kind: 'aircraft', trajectory: 'trajectory:minhas-j10ce-1' },
  { key: 'jf17', name: 'JF-17', kind: 'aircraft' },
  { key: 'mig29', name: 'MiG-29', kind: 'aircraft' },
  { key: 'pl15e', name: 'PL-15E', kind: 'missile', trajectory: 'trajectory:pakistan-missile-1' },
  { key: 'rafale', name: 'Rafale', kind: 'aircraft', trajectory: 'trajectory:ambala-rafale-1' },
  { key: 'su30mki', name: 'Su-30MKI', kind: 'aircraft' },
] as const;

const catalogModelItems = catalogEntities.flatMap((entity) => {
  const entityId = `catalog-${entity.key}`;
  const items: Array<ReturnType<typeof spawnItem> | ReturnType<typeof followItem>> = [
    spawnItem(`model-catalog-${entity.key}-spawn`, entityId, 0),
  ];
  if ('trajectory' in entity) {
    items.push(followItem(
      `model-catalog-${entity.key}-follow`,
      entityId,
      entity.trajectory,
      0,
      12_000,
    ));
  }
  return items;
});

export const RUNTIME_CATALOG_CONFIG: SceneProjectConfig = sceneProjectConfigSchema.parse({
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'fixture-runtime-catalog-document',
  eventPlanArtifactId: 'fixture-runtime-catalog-events',
  runtimePlanArtifactId: 'fixture-runtime-catalog-plan',
  totalDurationMs: 48_000,
  entities: catalogEntities.map((entity) => ({
    entityId: `catalog-${entity.key}`,
    displayName: entity.name,
    kind: entity.kind,
    modelAssetId: `model:${entity.key}`,
    ...('trajectory' in entity ? { defaultTrajectoryAssetId: entity.trajectory } : {}),
    initialState: 'normal',
  })),
  tracks: [
    {
      trackId: 'model-catalog',
      type: 'model',
      label: 'Catalog models',
      visible: true,
      items: catalogModelItems,
    },
    {
      trackId: 'video-catalog',
      type: 'video',
      label: 'Catalog videos',
      visible: true,
      items: RUNTIME_CATALOG_ASSET_IDS.videos.map((assetId, index) => videoItem(
        `video-catalog-${assetId.slice('video:'.length)}`,
        assetId,
        index * 4_000,
        4_000,
      )),
    },
    {
      trackId: 'image-catalog',
      type: 'image',
      label: 'Catalog images',
      visible: true,
      items: RUNTIME_CATALOG_ASSET_IDS.images.map((assetId, index) => imageItem(
        `image-catalog-${assetId.slice('image:'.length)}`,
        assetId,
        32_000 + index * 4_000,
        4_000,
      )),
    },
  ],
  diagnostics: [],
});
