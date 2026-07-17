import { expect, test, type Page, type Response } from '@playwright/test';
import { sceneProjectConfigSchema, type SceneProjectConfig } from '@ise/runtime-contracts';
import type mapboxgl from 'mapbox-gl';
import { writeFile } from 'node:fs/promises';
import { RUNTIME_MAIN_CONFIG } from '../src/runtime/testing/runtimeFixtures';

const accessToken = process.env.ISE_E2E_ACCESS_TOKEN;
const persistedSceneId = process.env.ISE_E2E_SCENE_ID;
const mapCanvasSelector = 'canvas.maplibregl-canvas, canvas.mapboxgl-canvas';
const stationaryTrajectoryAssetIds = new Set([
  'trajectory:india-awacs-1',
  'trajectory:pakistan-awacs-1',
]);

function mapCanvas(page: Page) {
  return page.locator(mapCanvasSelector);
}

async function authenticate(page: Page) {
  if (!accessToken) {
    throw new Error(
      'ISE_E2E_ACCESS_TOKEN is required for asset-catalog access to the real seeded assets.',
    );
  }
  await page.addInitScript((token) => {
    window.localStorage.setItem('access_token', token);
  }, accessToken);
}

async function seedAuthenticatedScene(page: Page, sceneId: string) {
  await authenticate(page);
  await page.route(`**/SceneBack/scene/${sceneId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: sceneId,
          title: 'Generated runtime replay',
          ownerType: 'PERSON',
          type: 'PRIVATE',
          config: RUNTIME_MAIN_CONFIG,
          userId: 'runtime-e2e',
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:00:00.000Z',
        },
      }),
    });
  });
}

async function expectNonBlankCanvas(page: Page) {
  const canvas = mapCanvas(page);
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () =>
      canvas.evaluate((source) => {
        const probe = document.createElement('canvas');
        probe.width = 64;
        probe.height = 64;
        const context = probe.getContext('2d');
        if (!context || source.width === 0 || source.height === 0) return 0;
        context.drawImage(source, 0, 0, probe.width, probe.height);
        const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
        let minimum = 255;
        let maximum = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          minimum = Math.min(minimum, pixels[index]!, pixels[index + 1]!, pixels[index + 2]!);
          maximum = Math.max(maximum, pixels[index]!, pixels[index + 1]!, pixels[index + 2]!);
        }
        return maximum - minimum;
      }),
    )
    .toBeGreaterThan(16);
}

async function openRuntimeHarness(page: Page, path: string) {
  await page.goto(path);
  const status = page.getByTestId('runtime-status');
  await expect(status).toHaveAttribute('data-status', /^(ready|error)$/);
  if ((await status.getAttribute('data-status')) === 'error') {
    throw new Error(
      `Runtime load failed: ${(await status.getAttribute('data-error-message')) || 'unknown error'}`,
    );
  }
  const viewport = page.viewportSize();
  if (viewport) {
    await expect
      .poll(() =>
        page
          .getByTestId('runtime-map')
          .evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBeGreaterThan(viewport.height * 0.9);
  }
  await expectNonBlankCanvas(page);
}

async function playRuntimeHarness(page: Page) {
  await page.getByTestId('runtime-play').click();
  await expect
    .poll(async () =>
      Number(await page.getByTestId('runtime-time').textContent()),
    )
    .toBeGreaterThan(500);
  await page.getByTestId('runtime-pause').click();
}

async function seekRuntimeHarness(page: Page, timeMs: number) {
  await page.getByTestId('runtime-seek').fill(String(timeMs));
  await expect(page.getByTestId('runtime-time')).toHaveText(String(timeMs));
}

interface RuntimeModelSnapshot {
  entityId: string;
  state: 'normal' | 'warning' | 'disabled' | 'destroyed' | 'hidden';
  modelAssetId?: string;
  trajectoryAssetId?: string;
  defaultTrajectoryAssetId?: string;
  visible: boolean;
  longitude?: number;
  latitude?: number;
  altitudeM?: number;
  headingDeg?: number;
  pitchDeg?: number;
  projectedSizePx?: number;
  appliedScale?: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

interface MapCameraSnapshot {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

interface ProjectedRuntimeModel {
  model: RuntimeModelSnapshot;
  point: { x: number; y: number };
  viewport: { width: number; height: number };
}

type SceneMapWindow = typeof window & { __ISE_SCENE_MAP__?: mapboxgl.Map };

async function runtimeModelSnapshots(page: Page) {
  return page.getByTestId('runtime-overlay').evaluate((overlay) => {
    const value = overlay.getAttribute('data-runtime-models');
    return value ? (JSON.parse(value) as RuntimeModelSnapshot[]) : [];
  });
}

type ModelTrack = Extract<SceneProjectConfig['tracks'][number], { type: 'model' }>;
type ModelTrackItem = ModelTrack['items'][number];
type CameraTrack = Extract<SceneProjectConfig['tracks'][number], { type: 'camera' }>;
type CameraTrackItem = CameraTrack['items'][number];
type SubtitleTrack = Extract<SceneProjectConfig['tracks'][number], { type: 'subtitle' }>;
type DynamicCameraParams = Extract<
  CameraTrackItem['params'],
  { action: 'camera.follow_actor' | 'camera.follow_group' }
>;
type DynamicCameraItem = CameraTrackItem & { params: DynamicCameraParams };
type DataLinkTrack = Extract<SceneProjectConfig['tracks'][number], { type: 'data_link' }>;
type FollowPathItem = ModelTrackItem & {
  params: Extract<ModelTrackItem['params'], { action: 'model.follow_path' }>;
};
type DestroyedStateItem = ModelTrackItem & {
  params: Extract<ModelTrackItem['params'], { action: 'model.set_state' }> & { state: 'destroyed' };
};

function isFollowPathItem(item: ModelTrackItem): item is FollowPathItem {
  return item.params.action === 'model.follow_path';
}

function isDestroyedStateItem(item: ModelTrackItem): item is DestroyedStateItem {
  return item.params.action === 'model.set_state' && item.params.state === 'destroyed';
}

function isDynamicCameraItem(item: CameraTrackItem): item is DynamicCameraItem {
  return 'action' in item.params && (
    item.params.action === 'camera.follow_actor'
    || item.params.action === 'camera.follow_group'
  );
}

function dynamicCameraSubjectIds(item: DynamicCameraItem) {
  return item.params.action === 'camera.follow_actor'
    ? [item.params.entityId]
    : item.params.entityIds;
}

function dynamicCameraItems(config: SceneProjectConfig) {
  return config.tracks
    .filter((track): track is CameraTrack => track.type === 'camera' && track.visible)
    .flatMap((track) => track.items)
    .filter(isDynamicCameraItem)
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
}

function selectedSubtitleTailSamples(config: SceneProjectConfig) {
  const subtitles = config.tracks
    .filter((track): track is SubtitleTrack => track.type === 'subtitle' && track.visible)
    .flatMap((track) => track.items)
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
  const cameras = dynamicCameraItems(config);
  return [2, 4, 6, 8]
    .filter((ordinal) => ordinal <= subtitles.length)
    .map((ordinal) => {
      const subtitle = subtitles[ordinal - 1]!;
      const timeMs = subtitle.startMs + Math.max(0, subtitle.durationMs - 10);
      const activeCameras = cameras.filter((item) => (
        item.startMs <= timeMs && timeMs < item.startMs + item.durationMs
      ));
      if (activeCameras.length !== 1) {
        throw new Error(
          `Subtitle ${ordinal} tail requires exactly one dynamic camera, found ${activeCameras.length}.`,
        );
      }
      return { ordinal, subtitle, timeMs, camera: activeCameras[0]! };
    });
}

function expectRegisteredRuntimeRoutes(
  models: RuntimeModelSnapshot[],
  registeredRoutes: ReadonlySet<string>,
) {
  expect(models.length).toBeGreaterThan(0);
  const routes = models.map((item) => item.trajectoryAssetId ?? item.defaultTrajectoryAssetId);
  expect(routes.every((route): route is string => route !== undefined)).toBe(true);
  const exposedRoutes = routes.filter((route): route is string => route !== undefined);
  expect(new Set(exposedRoutes).size).toBe(exposedRoutes.length);
  for (const route of exposedRoutes) expect(registeredRoutes.has(route)).toBe(true);
}

function followAcceptanceSamples(follows: FollowPathItem[]) {
  const eligible = follows
    .filter((item) => item.durationMs > 2)
    .sort((left, right) => {
      const leftSupportsPostCutoff = left.startMs + left.durationMs > 6_001 ? 1 : 0;
      const rightSupportsPostCutoff = right.startMs + right.durationMs > 6_001 ? 1 : 0;
      return rightSupportsPostCutoff - leftSupportsPostCutoff || right.durationMs - left.durationMs;
    })
    .slice(0, 3)
    .map((item) => {
      const endMs = item.startMs + item.durationMs;
      const cutoffSampleMs = endMs > 6_001 ? 6_001 : item.startMs + 2;
      const lateMs = Math.min(
        endMs - 1,
        Math.max(cutoffSampleMs, Math.floor(item.startMs + item.durationMs * 0.8)),
      );
      const earlyMs = Math.max(
        item.startMs + 1,
        Math.floor(item.startMs + (lateMs - item.startMs) * 0.25),
      );
      if (earlyMs >= lateMs) {
        throw new Error('Persisted follow window must contain distinct early and late samples.');
      }
      return { item, earlyMs, lateMs };
    });
  if (eligible.length < 3) {
    throw new Error('Persisted scene requires at least three independently sampled follow windows.');
  }
  return eligible;
}

function sampleInside(startMs: number, durationMs: number, preferredOffsetMs: number) {
  if (durationMs <= 1) throw new Error('Persisted media intervals must exceed 1ms.');
  const offsetMs = Math.min(preferredOffsetMs, durationMs - 1);
  return { timeMs: startMs + offsetMs, offsetMs };
}

function cameraAcceptanceTimes(config: SceneProjectConfig): [number, number] {
  const cameraItems = config.tracks
    .filter((track): track is CameraTrack => track.type === 'camera' && track.visible)
    .flatMap((track) => track.items);
  const engagementCameraItems = cameraItems.filter((item) => (
    /:(launch|midcourse|terminal|aftermath):camera$/.test(item.id)
  ));
  const acceptanceItems = engagementCameraItems.length >= 2
    ? engagementCameraItems
    : cameraItems;
  const upperBoundMs = Math.max(0, config.totalDurationMs - 1);
  const sampleTime = (item: CameraTrack['items'][number]) =>
    Math.min(
      upperBoundMs,
      Math.max(0, item.startMs + Math.max(1, item.durationMs - 10)),
    );
  let best: { times: [number, number]; separationMs: number } | undefined;
  for (let left = 0; left < acceptanceItems.length; left += 1) {
    for (let right = left + 1; right < acceptanceItems.length; right += 1) {
      const first = acceptanceItems[left]!;
      const second = acceptanceItems[right]!;
      if (JSON.stringify(first.params) === JSON.stringify(second.params)) continue;
      const firstTimeMs = sampleTime(first);
      const secondTimeMs = sampleTime(second);
      const separationMs = Math.abs(secondTimeMs - firstTimeMs);
      if (separationMs > 0 && (!best || separationMs > best.separationMs)) {
        best = { times: [firstTimeMs, secondTimeMs], separationMs };
      }
    }
  }
  if (!best) {
    throw new Error('Persisted scene requires two distinct visible camera transitions.');
  }
  return best.times;
}

function persistedAcceptanceSamples(config: SceneProjectConfig) {
  const imageItem = config.tracks.find((track) => track.type === 'image')?.items[0];
  const videoItems = config.tracks
    .filter((track) => track.type === 'video')
    .flatMap((track) => track.items);
  const videoItem = [...videoItems].sort((left, right) => right.durationMs - left.durationMs)[0];
  const subtitleItem = config.tracks.find((track) => track.type === 'subtitle')?.items[0];
  if (!imageItem || !videoItem || !subtitleItem) {
    throw new Error('Persisted scene requires active image, video, and subtitle intervals.');
  }
  const image = sampleInside(imageItem.startMs, imageItem.durationMs, 500);
  const videos = videoItems.map((item) => ({
    item,
    ...sampleInside(item.startMs, item.durationMs, Math.min(1_000, Math.floor(item.durationMs / 4))),
  }));
  const video = videos.find((sample) => sample.item.id === videoItem.id)!;
  const subtitle = sampleInside(subtitleItem.startMs, subtitleItem.durationMs, 500);

  const aircraftIds = new Set(
    config.entities.filter((entity) => entity.kind === 'aircraft').map((entity) => entity.entityId),
  );
  const follows = config.tracks
    .filter((track): track is ModelTrack => track.type === 'model')
    .flatMap((track) => track.items.filter(isFollowPathItem));
  const destroyedEntityIds = new Set(
    config.tracks
      .filter((track): track is ModelTrack => track.type === 'model')
      .flatMap((track) => track.items.filter(isDestroyedStateItem))
      .map((item) => item.params.entityId),
  );
  const aircraftFollows = follows.filter((item) => (
    aircraftIds.has(item.params.entityId)
    && !destroyedEntityIds.has(item.params.entityId)
    && !stationaryTrajectoryAssetIds.has(item.params.trajectoryAssetId)
  ));
  return {
    image,
    video,
    videos,
    subtitle,
    cameraTimes: cameraAcceptanceTimes(config),
    follows,
    followSamples: followAcceptanceSamples(aircraftFollows),
  };
}

async function assertPersistedSubtitleStyle(page: Page) {
  const overlay = page.getByTestId('runtime-overlay');
  const subtitle = overlay.locator('[data-runtime-kind="subtitle"]:visible').first();
  await expect(subtitle).toBeVisible();
  const style = await subtitle.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      backgroundColor: computed.backgroundColor,
      color: computed.color,
      backdropFilter: computed.backdropFilter || computed.webkitBackdropFilter,
      fontSize: computed.fontSize,
    };
  });
  const [subtitleBounds, overlayBounds] = await Promise.all([
    subtitle.boundingBox(),
    overlay.boundingBox(),
  ]);
  if (!subtitleBounds || !overlayBounds) {
    throw new Error('Persisted subtitle and desktop overlay must have measurable bounds.');
  }
  expect(style.backgroundColor).toBe('rgba(255, 255, 255, 0.84)');
  expect(style.color).toBe('rgb(17, 24, 39)');
  expect(style.backdropFilter).toContain('blur(12px)');
  expect(style.fontSize).toBe('16px');
  expect(subtitleBounds.x - overlayBounds.x).toBeGreaterThanOrEqual(16);
  expect(overlayBounds.x + overlayBounds.width - subtitleBounds.x - subtitleBounds.width)
    .toBeGreaterThanOrEqual(16);
}

async function persistedSceneConfig(response: Response) {
  const body = (await response.json()) as { data?: { config?: unknown } };
  return sceneProjectConfigSchema.parse(body.data?.config);
}

function expectFiniteModelSnapshot(snapshot: RuntimeModelSnapshot) {
  const values = [
    ...snapshot.position,
    ...snapshot.quaternion,
    snapshot.longitude,
    snapshot.latitude,
    snapshot.altitudeM,
    snapshot.headingDeg,
    snapshot.pitchDeg,
  ];
  expect(values.every((value) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
}

async function canvasPixels(page: Page) {
  return mapCanvas(page).evaluate((source) => {
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const context = probe.getContext('2d', { willReadFrequently: true });
    if (!context || source.width === 0 || source.height === 0) return [];
    context.drawImage(source, 0, 0, probe.width, probe.height);
    return Array.from(context.getImageData(0, 0, probe.width, probe.height).data);
  });
}

function changedPixelRatio(before: number[], after: number[]) {
  if (before.length === 0 || before.length !== after.length) return 0;
  let changed = 0;
  let pixels = 0;
  for (let index = 0; index < before.length; index += 4) {
    pixels += 1;
    if (
      Math.abs(before[index]! - after[index]!) > 8 ||
      Math.abs(before[index + 1]! - after[index + 1]!) > 8 ||
      Math.abs(before[index + 2]! - after[index + 2]!) > 8
    ) {
      changed += 1;
    }
  }
  return changed / pixels;
}

async function previewRuntimeTime(page: Page) {
  return Number(
    await page
      .getByTestId('scene-runtime-overlay')
      .getAttribute('data-runtime-time-ms'),
  );
}

async function seekPreviewRuntime(page: Page, timeMs: number) {
  const seek = page.getByTestId('scene-runtime-seek');
  await expect(seek).toBeVisible();
  await seek.fill(String(timeMs / 1_000));
  await expect
    .poll(async () => Math.abs((await previewRuntimeTime(page)) - timeMs))
    .toBeLessThanOrEqual(1);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function previewMapCamera(page: Page): Promise<MapCameraSnapshot> {
  return page.evaluate(() => {
    const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
    if (!map) throw new Error('The preview Mapbox map is not available.');
    const center = map.getCenter();
    return {
      center: [center.lng, center.lat] as [number, number],
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
  });
}

async function projectedPreviewModel(page: Page): Promise<ProjectedRuntimeModel | null> {
  return page.getByTestId('scene-runtime-overlay').evaluate((overlay) => {
    const value = overlay.getAttribute('data-runtime-models');
    const models = value ? (JSON.parse(value) as RuntimeModelSnapshot[]) : [];
    const candidates = models.filter(
      (candidate) =>
        candidate.visible &&
        candidate.modelAssetId &&
        Number.isFinite(candidate.longitude) &&
        Number.isFinite(candidate.latitude) &&
        Number.isFinite(candidate.projectedSizePx),
    );
    if (candidates.length === 0) return null;

    const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
    if (!map) throw new Error('The preview Mapbox map is not available.');
    const canvas = map.getCanvas();
    const projected = candidates.map((model) => {
      const point = map.project([model.longitude!, model.latitude!]);
      return {
        model,
        point: { x: point.x, y: point.y },
        viewport: { width: canvas.clientWidth, height: canvas.clientHeight },
      };
    });
    return projected.find(({ model, point, viewport }) => {
      const safeInsetPx = model.projectedSizePx! / 2 + 2;
      return (
        point.x >= safeInsetPx &&
        point.x <= viewport.width - safeInsetPx &&
        point.y >= safeInsetPx &&
        point.y <= viewport.height - safeInsetPx
      );
    }) ?? projected[0]!;
  });
}

async function projectedReferencedPreviewModels(page: Page, entityIds: readonly string[]) {
  return page.getByTestId('scene-runtime-overlay').evaluate((overlay, requestedEntityIds) => {
    const value = overlay.getAttribute('data-runtime-models');
    const models = value ? (JSON.parse(value) as RuntimeModelSnapshot[]) : [];
    const requested = new Set(requestedEntityIds);
    const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
    if (!map) throw new Error('The preview Mapbox map is not available.');
    const canvas = map.getCanvas();
    return models
      .filter((model) => (
        requested.has(model.entityId)
        && model.visible
        && model.modelAssetId?.startsWith('model:')
        && Number.isFinite(model.longitude)
        && Number.isFinite(model.latitude)
        && Number.isFinite(model.projectedSizePx)
      ))
      .map((model) => {
        const point = map.project([model.longitude!, model.latitude!]);
        const safeInsetPx = model.projectedSizePx! / 2 + 2;
        return {
          entityId: model.entityId,
          modelAssetId: model.modelAssetId!,
          projectedSizePx: model.projectedSizePx!,
          point: { x: point.x, y: point.y },
          viewport: { width: canvas.clientWidth, height: canvas.clientHeight },
          fullyInViewport: (
            point.x >= safeInsetPx
            && point.x <= canvas.clientWidth - safeInsetPx
            && point.y >= safeInsetPx
            && point.y <= canvas.clientHeight - safeInsetPx
          ),
        };
      });
  }, [...entityIds]);
}

function maximumCameraSpread(
  cameras: MapCameraSnapshot[],
  value: (camera: MapCameraSnapshot) => number,
) {
  const values = cameras.map(value);
  return Math.max(...values) - Math.min(...values);
}

function maximumCenterSpread(cameras: MapCameraSnapshot[]) {
  let maximum = 0;
  for (const left of cameras) {
    for (const right of cameras) {
      maximum = Math.max(
        maximum,
        Math.hypot(left.center[0] - right.center[0], left.center[1] - right.center[1]),
      );
    }
  }
  return maximum;
}

function maximumBearingSpread(cameras: MapCameraSnapshot[]) {
  let maximum = 0;
  for (const left of cameras) {
    for (const right of cameras) {
      const rawDelta = Math.abs(left.bearing - right.bearing) % 360;
      maximum = Math.max(maximum, Math.min(rawDelta, 360 - rawDelta));
    }
  }
  return maximum;
}

async function isolatePreviewModelPixels(page: Page, focusEntityId?: string) {
  return page.evaluate(async (requestedEntityId) => {
    const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
    if (!map) throw new Error('The preview Mapbox map is not available.');
    const layerId = 'ise-model-runtime';
    const layer = map.getLayer(layerId);
    if (!layer) throw new Error(`${layerId} is missing before visibility isolation.`);
    if (!map.loaded()) {
      await new Promise<void>((resolve) => map.once('idle', () => resolve()));
    }
    const canvas = map.getCanvas();

    const probeWidth = 256;
    const probeHeight = 144;
    const capture = () => {
      const probe = document.createElement('canvas');
      probe.width = probeWidth;
      probe.height = probeHeight;
      const context = probe.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Unable to create the model pixel probe.');
      context.drawImage(canvas, 0, 0, probe.width, probe.height);
      return Array.from(context.getImageData(0, 0, probe.width, probe.height).data);
    };
    const renderTwice = async () => {
      for (let index = 0; index < 2; index += 1) {
        await new Promise<void>((resolve) => {
          map.once('render', () => resolve());
          map.triggerRepaint();
        });
      }
    };

    let hidden: number[] = [];
    let shown: number[] = [];
    const originalVisibility = map.getLayoutProperty(layerId, 'visibility');
    map.setLayoutProperty(layerId, 'visibility', 'none');
    try {
      await renderTwice();
      hidden = capture();
      map.setLayoutProperty(layerId, 'visibility', 'visible');
      await renderTwice();
      if (!map.getLayer(layerId)) {
        throw new Error(`${layerId} is missing for the visible-frame capture.`);
      }
      shown = capture();
    } finally {
      map.setLayoutProperty(
        layerId,
        'visibility',
        originalVisibility ?? 'visible',
      );
      await renderTwice();
    }

    const overlay = document.querySelector('[data-testid="scene-runtime-overlay"]');
    const models = JSON.parse(overlay?.getAttribute('data-runtime-models') ?? '[]') as RuntimeModelSnapshot[];
    const focus = requestedEntityId
      ? models.find((model) => model.entityId === requestedEntityId && model.visible)
      : undefined;
    if (requestedEntityId && !focus) {
      throw new Error(`Visible focus model ${requestedEntityId} is unavailable for pixel isolation.`);
    }
    const focusPoint = focus?.longitude !== undefined && focus.latitude !== undefined
      ? map.project([focus.longitude, focus.latitude])
      : undefined;
    const scaleX = probeWidth / canvas.clientWidth;
    const scaleY = probeHeight / canvas.clientHeight;
    const radiusX = Math.max(3, ((focus?.projectedSizePx ?? 0) / 2 + 4) * scaleX);
    const radiusY = Math.max(3, ((focus?.projectedSizePx ?? 0) / 2 + 4) * scaleY);
    const minimumX = focusPoint ? Math.max(0, Math.floor(focusPoint.x * scaleX - radiusX)) : 0;
    const maximumX = focusPoint ? Math.min(probeWidth - 1, Math.ceil(focusPoint.x * scaleX + radiusX)) : probeWidth - 1;
    const minimumY = focusPoint ? Math.max(0, Math.floor(focusPoint.y * scaleY - radiusY)) : 0;
    const maximumY = focusPoint ? Math.min(probeHeight - 1, Math.ceil(focusPoint.y * scaleY + radiusY)) : probeHeight - 1;

    let changedPixels = 0;
    let maximumChannelDelta = 0;
    let pixelCount = 0;
    for (let index = 0; index < hidden.length; index += 4) {
      const pixelIndex = index / 4;
      const x = pixelIndex % probeWidth;
      const y = Math.floor(pixelIndex / probeWidth);
      if (x < minimumX || x > maximumX || y < minimumY || y > maximumY) continue;
      pixelCount += 1;
      const delta = Math.max(
        Math.abs(hidden[index]! - shown[index]!),
        Math.abs(hidden[index + 1]! - shown[index + 1]!),
        Math.abs(hidden[index + 2]! - shown[index + 2]!),
      );
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
      if (delta > 6) changedPixels += 1;
    }
    return {
      changedPixels,
      changedPixelRatio: pixelCount > 0 ? changedPixels / pixelCount : 0,
      maximumChannelDelta,
      pixelCount,
    };
  }, focusEntityId);
}

test('plays and seeks a generated replay', async ({ page }) => {
  await seedAuthenticatedScene(page, 'scene-e2e');
  await page.goto('/preview?projectId=scene-e2e');
  await expect(page.getByTestId('scene-runtime-ready')).toHaveAttribute(
    'data-status',
    'ready',
  );
  await expectNonBlankCanvas(page);

  await page.getByRole('button', { name: '播放' }).click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId('scene-runtime-overlay')
          .getAttribute('data-runtime-time-ms'),
      ),
    )
    .toBeGreaterThan(500);
  await expect(page.getByText('Runtime synchronized acceptance')).toBeVisible();

  await openRuntimeHarness(page, '/runtime-harness?fixture=runtime-main');
  await seekRuntimeHarness(page, 8000);
  await expect
    .poll(async () =>
      page
        .locator('video[data-runtime-kind="video"]')
        .evaluate((video) => Math.abs((video as HTMLVideoElement).currentTime - 1) < 0.15),
    )
    .toBe(true);
  await expect(page.getByText('Runtime synchronized acceptance')).toBeVisible();
  await expectNonBlankCanvas(page);
});

test('keeps the destroyed target visible in terminal and aftermath cameras', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'Destroyed-target visual acceptance is desktop-only.',
  );
  if (!persistedSceneId) {
    throw new Error('ISE_E2E_SCENE_ID is required for destroyed-target visual acceptance.');
  }

  await authenticate(page);
  const sceneConfigResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET'
    && response.url().includes(`/SceneBack/scene/${encodeURIComponent(persistedSceneId)}`),
  );
  await page.goto(`/preview?projectId=${encodeURIComponent(persistedSceneId)}`);
  await expect(page.getByTestId('scene-runtime-ready')).toHaveAttribute('data-status', 'ready');
  const sceneConfig = await persistedSceneConfig(await sceneConfigResponse);
  const destroyedState = sceneConfig.tracks
    .filter((track): track is ModelTrack => track.type === 'model' && track.visible)
    .flatMap((track) => track.items)
    .find(isDestroyedStateItem);
  expect(destroyedState).toBeDefined();
  const targetId = destroyedState!.params.entityId;
  const phaseCameras = sceneConfig.tracks
    .filter((track): track is CameraTrack => track.type === 'camera' && track.visible)
    .flatMap((track) => track.items)
    .filter((item) => (
      item.eventUnitId === destroyedState!.eventUnitId
      && /:(terminal|aftermath):camera$/.test(item.id)
    ))
    .sort((left, right) => left.startMs - right.startMs);
  expect(phaseCameras).toHaveLength(2);

  for (const cameraItem of phaseCameras) {
    const phase = cameraItem.id.match(/:(terminal|aftermath):camera$/)?.[1];
    await seekPreviewRuntime(page, cameraItem.startMs + cameraItem.durationMs - 10);
    expect(cameraItem.params.pitch).toBe(0);
    expect(cameraItem.params.zoom).toBeLessThanOrEqual(11.5);
    const camera = await previewMapCamera(page);
    expect(Math.abs(camera.pitch)).toBeLessThan(0.1);
    const focusPixels = await isolatePreviewModelPixels(page, targetId);
    expect(focusPixels.changedPixels).toBeGreaterThan(4);
    expect(focusPixels.changedPixelRatio).toBeGreaterThan(0.01);
    expect(focusPixels.maximumChannelDelta).toBeGreaterThan(8);
    if (phase === 'aftermath') {
      const screenshotPath = testInfo.outputPath('destroyed-target-aftermath.png');
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach('destroyed-target-aftermath', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    }
  }
});

test('keeps dynamic camera subjects visible at selected subtitle tails', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'Dynamic-camera visual acceptance is desktop-only.',
  );
  if (!persistedSceneId) {
    throw new Error('ISE_E2E_SCENE_ID is required for dynamic-camera visual acceptance.');
  }

  await authenticate(page);
  const sceneConfigResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response.url().includes(`/SceneBack/scene/${encodeURIComponent(persistedSceneId)}`)
  ));
  await page.goto(`/preview?projectId=${encodeURIComponent(persistedSceneId)}`);
  await expect(page.getByTestId('scene-runtime-ready')).toHaveAttribute('data-status', 'ready');
  await expectNonBlankCanvas(page);
  const sceneConfig = await persistedSceneConfig(await sceneConfigResponse);
  const cameras = dynamicCameraItems(sceneConfig);
  const followActors = cameras.filter(
    (item) => item.params.action === 'camera.follow_actor',
  );
  const followGroups = cameras.filter(
    (item) => item.params.action === 'camera.follow_group',
  );
  expect(followActors.length).toBeGreaterThan(0);
  expect(followGroups.length).toBeGreaterThan(0);

  const subtitleSamples = selectedSubtitleTailSamples(sceneConfig);
  const subtitleCount = sceneConfig.tracks
    .filter((track): track is SubtitleTrack => track.type === 'subtitle' && track.visible)
    .flatMap((track) => track.items).length;
  expect(subtitleSamples.map((sample) => sample.ordinal)).toEqual(
    [2, 4, 6, 8].filter((ordinal) => ordinal <= subtitleCount),
  );
  expect(subtitleSamples.length).toBeGreaterThan(0);

  const expectVisibleCameraSubject = async (camera: DynamicCameraItem, timeMs: number) => {
    await seekPreviewRuntime(page, timeMs);
    const subjectIds = dynamicCameraSubjectIds(camera);
    await expect.poll(async () => (
      await projectedReferencedPreviewModels(page, subjectIds)
    ).filter((model) => model.fullyInViewport).length).toBeGreaterThan(0);
    const projected = await projectedReferencedPreviewModels(page, subjectIds);
    const visibleModel = projected.find((model) => model.fullyInViewport);
    expect(visibleModel).toBeDefined();
    expect(visibleModel!.modelAssetId).toMatch(/^model:/);
    expect(visibleModel!.projectedSizePx).toBeGreaterThan(0);
    const isolatedPixels = await isolatePreviewModelPixels(page, visibleModel!.entityId);
    expect(isolatedPixels.changedPixels).toBeGreaterThan(0);
    expect(isolatedPixels.maximumChannelDelta).toBeGreaterThan(8);
  };

  for (const sample of subtitleSamples) {
    await expectVisibleCameraSubject(sample.camera, sample.timeMs);
  }

  const globalCamera = followGroups.find((item) => (
    item.params.action === 'camera.follow_group' && item.params.framing === 'global'
  ));
  const engagementCamera = [...followGroups].reverse().find((item) => (
    item.params.action === 'camera.follow_group' && item.params.framing === 'engagement'
  ));
  expect(globalCamera).toBeDefined();
  expect(engagementCamera).toBeDefined();

  for (const [label, camera] of [
    ['global-tail', globalCamera!],
    ['engagement-tail', engagementCamera!],
  ] as const) {
    const timeMs = Math.min(
      sceneConfig.totalDurationMs - 1,
      camera.startMs + camera.durationMs - 10,
    );
    await expectVisibleCameraSubject(camera, timeMs);
    const screenshotPath = testInfo.outputPath(`persisted-dynamic-camera-${label}.png`);
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach(`persisted-dynamic-camera-${label}`, {
      path: screenshotPath,
      contentType: 'image/png',
    });
  }
});

test('plays and seeks a persisted generated replay', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'Persisted preview visual acceptance is desktop-only.',
  );
  if (!persistedSceneId) {
    throw new Error(
      'ISE_E2E_SCENE_ID is required for the persisted runtime harness replay.',
    );
  }

  await authenticate(page);
  const sceneConfigResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().includes(`/SceneBack/scene/${encodeURIComponent(persistedSceneId)}`),
  );
  await openRuntimeHarness(
    page,
    `/runtime-harness?sceneId=${encodeURIComponent(persistedSceneId)}`,
  );
  const sceneConfig = await persistedSceneConfig(await sceneConfigResponse);
  const samples = persistedAcceptanceSamples(sceneConfig);
  const engagementCameraItems = sceneConfig.tracks
    .filter((track): track is CameraTrack => track.type === 'camera' && track.visible)
    .flatMap((track) => track.items)
    .filter((item) => /:(launch|midcourse|terminal|aftermath):camera$/.test(item.id));
  expect(engagementCameraItems).toHaveLength(12);
  for (const phase of ['launch', 'midcourse', 'terminal', 'aftermath']) {
    expect(engagementCameraItems.filter((item) => item.id.endsWith(`:${phase}:camera`)))
      .toHaveLength(3);
  }
  const engagementCameraGroups = new Map<string, typeof engagementCameraItems>();
  for (const item of engagementCameraItems) {
    const engagementKey = item.id.replace(/:(launch|midcourse|terminal|aftermath):camera$/, '');
    engagementCameraGroups.set(
      engagementKey,
      [...(engagementCameraGroups.get(engagementKey) ?? []), item],
    );
  }
  expect(engagementCameraGroups.size).toBe(3);
  for (const items of engagementCameraGroups.values()) {
    expect(items).toHaveLength(4);
    expect(new Set(items.map((item) => (
      item.id.match(/:(launch|midcourse|terminal|aftermath):camera$/)?.[1]
    )))).toEqual(new Set(['launch', 'midcourse', 'terminal', 'aftermath']));
    expect(new Set(items.map((item) => JSON.stringify(item.params.center))).size)
      .toBeGreaterThan(1);
  }
  const entityIds = sceneConfig.entities.map((entity) => entity.entityId);
  const defaultRoutes = sceneConfig.entities.map((entity) => entity.defaultTrajectoryAssetId);
  const registeredRoutes = new Set(
    defaultRoutes.filter((route): route is string => route !== undefined),
  );
  const aircraftEntities = sceneConfig.entities.filter((entity) => entity.kind === 'aircraft');
  const missileEntities = sceneConfig.entities.filter((entity) => entity.kind === 'missile');
  const modelTracks = sceneConfig.tracks.filter(
    (track): track is ModelTrack => track.type === 'model',
  );
  const modelTrackEntityIds = modelTracks.map((track) => {
    const ids = new Set(track.items.map((item) => item.params.entityId));
    expect(ids.size).toBe(1);
    return [...ids][0]!;
  });
  const followEntityIds = samples.follows.map((item) => item.params.entityId);
  const followRoutes = samples.follows.map((item) => item.params.trajectoryAssetId);
  const expectedMissileRoutes = new Set([
    'trajectory:india-missile-1',
    'trajectory:pakistan-missile-1',
    'trajectory:pakistan-strike-missile-2',
  ]);
  const expectedAwacsRoutes = new Set([
    'trajectory:india-awacs-1',
    'trajectory:pakistan-awacs-1',
  ]);
  expect(aircraftEntities).toHaveLength(12);
  expect(missileEntities).toHaveLength(3);
  expect(sceneConfig.entities).toHaveLength(15);
  expect(modelTracks).toHaveLength(sceneConfig.entities.length);
  expect(new Set(modelTrackEntityIds)).toEqual(new Set(entityIds));
  expect(new Set(entityIds).size).toBe(entityIds.length);
  expect(new Set(missileEntities.map((entity) => entity.defaultTrajectoryAssetId)))
    .toEqual(expectedMissileRoutes);
  expect(new Set(
    aircraftEntities
      .map((entity) => entity.defaultTrajectoryAssetId)
      .filter((route): route is string => route !== undefined && expectedAwacsRoutes.has(route)),
  )).toEqual(expectedAwacsRoutes);
  expect(new Set(
    aircraftEntities
      .filter((entity) => expectedAwacsRoutes.has(entity.defaultTrajectoryAssetId ?? ''))
      .map((entity) => entity.modelAssetId),
  )).toEqual(new Set(['model:netra-awacs', 'model:awacs-generic-e3a']));
  expect(defaultRoutes.every((route): route is string => route !== undefined)).toBe(true);
  expect(new Set(defaultRoutes).size).toBe(defaultRoutes.length);
  expect(followEntityIds).toHaveLength(entityIds.length);
  expect(new Set(followEntityIds).size).toBe(followEntityIds.length);
  expect(new Set(followRoutes).size).toBe(followRoutes.length);
  for (const item of samples.follows) {
    expect(
      sceneConfig.entities.find((entity) => entity.entityId === item.params.entityId)
        ?.defaultTrajectoryAssetId,
    ).toBe(item.params.trajectoryAssetId);
  }

  const dataLinkTracks = sceneConfig.tracks.filter(
    (track): track is DataLinkTrack => track.type === 'data_link',
  );
  const dataLinkItems = dataLinkTracks.flatMap((track) => track.items);
  expect(dataLinkTracks.length).toBeGreaterThan(0);
  expect(dataLinkItems.length).toBeGreaterThan(0);
  expect(new Set(dataLinkItems.map((item) => item.params.linkKind)))
    .toEqual(new Set(['awacs-fighter', 'fighter-missile']));
  for (const item of dataLinkItems) {
    expect(entityIds).toContain(item.params.sourceEntityId);
    expect(entityIds).toContain(item.params.targetEntityId);
  }

  const destroyedStates = modelTracks
    .flatMap((track) => track.items)
    .filter(isDestroyedStateItem);
  expect(destroyedStates).toHaveLength(1);
  const destroyedState = destroyedStates[0]!;
  const destroyedTargetId = destroyedState.params.entityId;
  expect(destroyedTargetId).toBe('actor:india-rafale-ambala:leader');
  expect(sceneConfig.entities.find((entity) => entity.entityId === destroyedTargetId)?.modelAssetId)
    .toBe('model:rafale');
  const destroyedHides = modelTracks
    .flatMap((track) => track.items)
    .filter((item) => (
      item.params.action === 'model.hide'
      && item.params.entityId === destroyedTargetId
      && item.startMs >= destroyedState.startMs + 1_000
    ));
  expect(destroyedHides).toHaveLength(1);
  const destroyedHide = destroyedHides[0]!;
  await playRuntimeHarness(page);

  const maximumTimeMs = Number(
    await page.getByTestId('runtime-seek').getAttribute('max'),
  );
  if (!Number.isFinite(maximumTimeMs) || maximumTimeMs <= 0) {
    throw new Error('The persisted scene must have a positive runtime duration.');
  }
  await seekRuntimeHarness(
    page,
    Math.min(8000, Math.max(1, Math.floor(maximumTimeMs / 2))),
  );

  await seekRuntimeHarness(page, samples.image.timeMs);
  const image = page.locator('img[data-runtime-kind="image"]');
  await expect(image).toBeVisible();
  await expect(page.locator('[data-runtime-kind="image-fallback"]')).toHaveCount(0);
  await expect
    .poll(() =>
      image.evaluate((element) => ({
        complete: element.complete,
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
      })),
    )
    .toMatchObject({ complete: true });
  expect(await image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
  expect(await image.evaluate((element) => element.naturalHeight)).toBeGreaterThan(0);

  expect(samples.videos).toHaveLength(3);
  for (const sample of samples.videos) {
    await seekRuntimeHarness(page, sample.timeMs);
    const visibleVideo = page.locator('video[data-runtime-kind="video"]:visible');
    await expect(visibleVideo).toHaveCount(1);
    await expect
      .poll(() => visibleVideo.evaluate((element) => (
        element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && element.videoWidth > 0
        && element.videoHeight > 0
      )))
      .toBe(true);
    expect(await visibleVideo.evaluate((element) => element.currentTime))
      .toBeCloseTo(sample.offsetMs / 1_000, 1);
  }
  await seekRuntimeHarness(page, samples.video.timeMs);
  const video = page.locator('video[data-runtime-kind="video"]:visible');
  await expect(video).toHaveCount(1);
  await video.evaluate((element) => {
    element.dataset.e2eAcceptanceVideo = 'true';
    element.dataset.e2ePlayEvents = '0';
    element.addEventListener('play', () => {
      element.dataset.e2ePlayEvents = '1';
    }, { once: true });
  });
  const activeVideo = page.locator('video[data-e2e-acceptance-video="true"]');
  const initialVideoTime = await activeVideo.evaluate((element) => element.currentTime);
  expect(initialVideoTime).toBeCloseTo(samples.video.offsetMs / 1_000, 1);
  await page.getByTestId('runtime-play').click();
  await expect.poll(() => activeVideo.getAttribute('data-e2e-play-events')).toBe('1');
  await expect
    .poll(() => activeVideo.evaluate((element) => element.currentTime))
    .toBeGreaterThan(initialVideoTime + 0.2);
  const decodedFrames = await activeVideo.evaluate((element) => {
    const quality = element.getVideoPlaybackQuality?.();
    return quality?.totalVideoFrames;
  });
  if (decodedFrames !== undefined) expect(decodedFrames).toBeGreaterThan(0);
  await page.getByTestId('runtime-pause').click();

  await seekRuntimeHarness(page, samples.subtitle.timeMs);
  await assertPersistedSubtitleStyle(page);

  await seekRuntimeHarness(page, Math.max(0, destroyedState.startMs - 1));
  const beforeDestroyed = (await runtimeModelSnapshots(page))
    .find((item) => item.entityId === destroyedTargetId);
  expect(beforeDestroyed).toBeDefined();
  expect(beforeDestroyed!.visible).toBe(true);
  expect(beforeDestroyed!.state).toBe('normal');
  await seekRuntimeHarness(page, destroyedState.startMs + 500);
  const duringDestroyed = (await runtimeModelSnapshots(page))
    .find((item) => item.entityId === destroyedTargetId);
  expect(duringDestroyed).toBeDefined();
  expect(duringDestroyed!.visible).toBe(true);
  expect(duringDestroyed!.state).toBe('destroyed');
  expect(duringDestroyed!.quaternion.some(
    (value, index) => value !== beforeDestroyed!.quaternion[index],
  )).toBe(true);
  await seekRuntimeHarness(page, destroyedHide.startMs);
  const afterDestroyedHide = (await runtimeModelSnapshots(page))
    .find((item) => item.entityId === destroyedTargetId);
  expect(afterDestroyedHide).toBeDefined();
  expect(afterDestroyedHide!.visible).toBe(false);
  expect(afterDestroyedHide!.state).toBe('destroyed');

  const missileFollows = samples.follows.filter((item) => (
    missileEntities.some((entity) => entity.entityId === item.params.entityId)
  ));
  expect(missileFollows).toHaveLength(3);
  for (const item of missileFollows) {
    const earlyMs = item.startMs + Math.max(1, Math.floor(item.durationMs * 0.1));
    const lateMs = item.startMs + Math.max(2, Math.floor(item.durationMs * 0.45));
    await seekRuntimeHarness(page, earlyMs);
    const early = (await runtimeModelSnapshots(page)).find(
      (snapshot) => snapshot.visible && snapshot.entityId === item.params.entityId,
    );
    expect(early).toBeDefined();
    expectFiniteModelSnapshot(early!);
    await seekRuntimeHarness(page, lateMs);
    const late = (await runtimeModelSnapshots(page)).find(
      (snapshot) => snapshot.visible && snapshot.entityId === item.params.entityId,
    );
    expect(late).toBeDefined();
    expectFiniteModelSnapshot(late!);
    expect(late!.position.some((value, index) => value !== early!.position[index])).toBe(true);
  }

  const awacsFollows = samples.follows.filter((item) => (
    stationaryTrajectoryAssetIds.has(item.params.trajectoryAssetId)
  ));
  expect(awacsFollows).toHaveLength(2);
  for (const item of awacsFollows) {
    const earlyMs = item.startMs + Math.max(1, Math.floor(item.durationMs * 0.2));
    const lateMs = item.startMs + Math.max(2, Math.floor(item.durationMs * 0.8));
    await seekRuntimeHarness(page, earlyMs);
    const early = (await runtimeModelSnapshots(page)).find(
      (snapshot) => snapshot.visible && snapshot.entityId === item.params.entityId,
    );
    expect(early).toBeDefined();
    expectFiniteModelSnapshot(early!);
    await seekRuntimeHarness(page, lateMs);
    const late = (await runtimeModelSnapshots(page)).find(
      (snapshot) => snapshot.visible && snapshot.entityId === item.params.entityId,
    );
    expect(late).toBeDefined();
    expectFiniteModelSnapshot(late!);
    expect(late!.position).toEqual(early!.position);
  }

  const modelPairs: Array<{ first: RuntimeModelSnapshot; second: RuntimeModelSnapshot }> = [];
  let firstCanvas: Uint8ClampedArray | undefined;
  for (const sample of samples.followSamples) {
    const entityId = sample.item.params.entityId;
    await seekRuntimeHarness(page, sample.earlyMs);
    await expect
      .poll(async () =>
        (await runtimeModelSnapshots(page)).find((item) => item.visible && item.entityId === entityId),
      )
      .not.toBeUndefined();
    const firstModels = (await runtimeModelSnapshots(page)).filter((item) => item.visible);
    expectRegisteredRuntimeRoutes(firstModels, registeredRoutes);
    const first = firstModels.find(
      (item) => item.visible && item.entityId === entityId,
    )!;
    expect(first.modelAssetId).toMatch(/^model:/);
    expectFiniteModelSnapshot(first);
    firstCanvas ??= await canvasPixels(page);

    await seekRuntimeHarness(page, sample.lateMs);
    const secondModels = (await runtimeModelSnapshots(page)).filter((item) => item.visible);
    expectRegisteredRuntimeRoutes(secondModels, registeredRoutes);
    const second = secondModels.find(
      (item) => item.visible && item.entityId === entityId,
    );
    expect(second).toBeDefined();
    expectFiniteModelSnapshot(second!);
    expect(second!.position.some((value, index) => value !== first.position[index])).toBe(true);
    expect(second!.quaternion.some((value, index) => value !== first.quaternion[index])).toBe(true);
    if (sample.item.startMs + sample.item.durationMs > 6_001) {
      expect(sample.lateMs).toBeGreaterThan(6_000);
    }
    modelPairs.push({ first, second: second! });
  }
  expect(modelPairs).toHaveLength(3);
  expect(
    modelPairs.some(({ first, second }) =>
      second.quaternion.some((value, index) => value !== first.quaternion[index]) &&
      (second.headingDeg !== first.headingDeg || second.pitchDeg !== first.pitchDeg),
    ),
  ).toBe(true);

  await expect
    .poll(async () => changedPixelRatio(firstCanvas!, await canvasPixels(page)))
    .toBeGreaterThan(0.001);

  const screenshotPath = testInfo.outputPath('persisted-runtime-dynamic-canvas.png');
  await page.screenshot({ path: screenshotPath });
  const canvasScreenshotPath = testInfo.outputPath('persisted-runtime-canvas.png');
  await mapCanvas(page).screenshot({ path: canvasScreenshotPath });
  const canvasBufferPath = testInfo.outputPath('persisted-runtime-canvas-buffer.png');
  const canvasDataUrl = await page
    .locator(mapCanvasSelector)
    .evaluate((canvas) => canvas.toDataURL('image/png'));
  await writeFile(canvasBufferPath, Buffer.from(canvasDataUrl.split(',')[1]!, 'base64'));
  await testInfo.attach('persisted-runtime-dynamic-canvas', {
    path: screenshotPath,
    contentType: 'image/png',
  });
  await testInfo.attach('persisted-runtime-canvas', {
    path: canvasScreenshotPath,
    contentType: 'image/png',
  });
  await testInfo.attach('persisted-runtime-canvas-buffer', {
    path: canvasBufferPath,
    contentType: 'image/png',
  });
  await expectNonBlankCanvas(page);

  expect(Math.max(...samples.followSamples.map((sample) => sample.lateMs))).toBeGreaterThan(500);
  let replayMinimumMs = Number.POSITIVE_INFINITY;
  await page.getByTestId('runtime-replay').click();
  await expect
    .poll(async () => {
      const timeMs = Number(await page.getByTestId('runtime-time').textContent());
      replayMinimumMs = Math.min(replayMinimumMs, timeMs);
      return replayMinimumMs;
    })
    .toBeLessThan(500);
  await expect
    .poll(async () => Number(await page.getByTestId('runtime-time').textContent()))
    .toBeGreaterThan(Math.max(500, replayMinimumMs + 300));
  await page.getByTestId('runtime-pause').click();

  await page.goto(`/preview?projectId=${encodeURIComponent(persistedSceneId)}`);
  await expect(page.getByTestId('scene-runtime-ready')).toHaveAttribute(
    'data-status',
    'ready',
  );
  const previewMap = page.getByTestId('scene-runtime-map');
  await expect
    .poll(() =>
      previewMap.evaluate((element) => {
        const parentHeight = element.parentElement?.getBoundingClientRect().height ?? 0;
        const mapHeight = element.getBoundingClientRect().height;
        return parentHeight > 0 ? mapHeight / parentHeight : 0;
      }),
    )
    .toBeGreaterThan(0.95);
  await expectNonBlankCanvas(page);
  const initialCamera = await previewMapCamera(page);
  for (const cameraItem of [...engagementCameraItems].sort((left, right) => left.startMs - right.startMs)) {
    await seekPreviewRuntime(page, cameraItem.startMs + cameraItem.durationMs);
    const applied = await previewMapCamera(page);
    expect(applied.center[0]).toBeCloseTo(cameraItem.params.center[0], 5);
    expect(applied.center[1]).toBeCloseTo(cameraItem.params.center[1], 5);
    expect(applied.zoom).toBeCloseTo(cameraItem.params.zoom, 5);
    expect(applied.pitch).toBeCloseTo(cameraItem.params.pitch, 5);
    const bearingDelta = Math.abs(applied.bearing - cameraItem.params.bearing) % 360;
    expect(Math.min(bearingDelta, 360 - bearingDelta)).toBeLessThan(0.00001);
  }
  for (const linkKind of ['awacs-fighter', 'fighter-missile'] as const) {
    const dataLinkItem = dataLinkItems.find((item) => item.params.linkKind === linkKind);
    expect(dataLinkItem).toBeDefined();
    expect(dataLinkItem!.durationMs).toBeGreaterThan(1);
    const dataLinkTimeMs = dataLinkItem!.startMs + Math.max(
      1,
      Math.min(dataLinkItem!.durationMs - 1, Math.floor(dataLinkItem!.durationMs / 2)),
    );
    await seekPreviewRuntime(page, dataLinkTimeMs);
    await page.evaluate(({ sourceEntityId, targetEntityId }) => {
      const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
      if (!map) throw new Error('The preview Mapbox map is not available.');
      const overlay = document.querySelector('[data-testid="scene-runtime-overlay"]');
      const models = JSON.parse(overlay?.getAttribute('data-runtime-models') ?? '[]') as RuntimeModelSnapshot[];
      const endpoints = [sourceEntityId, targetEntityId].map((entityId) => (
        models.find((model) => model.visible && model.entityId === entityId)
      ));
      if (endpoints.some((endpoint) => !endpoint)) {
        throw new Error('The data-link endpoints are not both visible.');
      }
      const coordinates = endpoints.map((endpoint) => [endpoint!.longitude!, endpoint!.latitude!] as [number, number]);
      map.fitBounds([
        [Math.min(...coordinates.map((point) => point[0])), Math.min(...coordinates.map((point) => point[1]))],
        [Math.max(...coordinates.map((point) => point[0])), Math.max(...coordinates.map((point) => point[1]))],
      ], { padding: 100, duration: 0 });
    }, {
      sourceEntityId: dataLinkItem!.params.sourceEntityId,
      targetEntityId: dataLinkItem!.params.targetEntityId,
    });
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const layerId = linkKind === 'awacs-fighter'
      ? 'ise:data-links:awacs-fighter'
      : 'ise:data-links:fighter-missile';
    await expect.poll(() => page.evaluate(({ expectedId, expectedLayerId }) => {
      const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
      if (!map?.getLayer(expectedLayerId)) return 0;
      return map.queryRenderedFeatures(undefined, { layers: [expectedLayerId] })
        .filter((feature) => feature.properties?.id === expectedId).length;
    }, { expectedId: dataLinkItem!.id, expectedLayerId: layerId })).toBeGreaterThan(0);
  }
  const dataLinkStyle = await page.evaluate(() => {
    const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
    if (!map) throw new Error('The preview Mapbox map is not available.');
    return {
      source: Boolean(map.getSource('ise:data-links')),
      awacsFighterLayer: map.getLayer('ise:data-links:awacs-fighter')?.type,
      fighterMissileLayer: map.getLayer('ise:data-links:fighter-missile')?.type,
    };
  });
  expect(dataLinkStyle).toEqual({
    source: true,
    awacsFighterLayer: 'line',
    fighterMissileLayer: 'line',
  });
  const destroyedWeaponLink = dataLinkItems.find((item) => (
    item.eventUnitId === destroyedState.eventUnitId
    && item.params.linkKind === 'fighter-missile'
  ));
  expect(destroyedWeaponLink).toBeDefined();
  const destroyedEngagementKey = [...engagementCameraGroups.keys()].find((key) => (
    key.includes(`:${destroyedWeaponLink!.params.targetEntityId}`)
  ));
  expect(destroyedEngagementKey).toBeDefined();
  const destroyedEngagementCameras = [...engagementCameraGroups.get(destroyedEngagementKey!)!]
    .sort((left, right) => left.startMs - right.startMs);
  expect(destroyedEngagementCameras).toHaveLength(4);
  const destroyedPhaseCameras: MapCameraSnapshot[] = [];
  const destroyedPhasePixels: number[][] = [];
  for (const cameraItem of destroyedEngagementCameras) {
    const phase = cameraItem.id.match(/:(launch|midcourse|terminal|aftermath):camera$/)?.[1];
    expect(phase).toBeDefined();
    const phaseTimeMs = Math.min(
      cameraItem.startMs + cameraItem.durationMs - 1,
      cameraItem.startMs + Math.max(1, cameraItem.durationMs - 10),
    );
    await seekPreviewRuntime(page, phaseTimeMs);
    const visibleModels = await page.getByTestId('scene-runtime-overlay').evaluate((overlay) => {
      const value = overlay.getAttribute('data-runtime-models');
      const models = value ? (JSON.parse(value) as RuntimeModelSnapshot[]) : [];
      return models.filter((model) => model.visible);
    });
    const visibleEntityIds = visibleModels.map((model) => model.entityId);
    expect(visibleEntityIds).toContain(destroyedTargetId);
    expect(visibleEntityIds).toContain(destroyedWeaponLink!.params.targetEntityId);
    expect(phaseTimeMs).toBeGreaterThanOrEqual(destroyedWeaponLink!.startMs);
    expect(phaseTimeMs).toBeLessThan(
      destroyedWeaponLink!.startMs + destroyedWeaponLink!.durationMs,
    );
    const focusEntityId = phase === 'launch' || phase === 'midcourse'
      ? destroyedWeaponLink!.params.targetEntityId
      : destroyedTargetId;
    const focus = visibleModels.find((model) => model.entityId === focusEntityId)!;
    expect(focus).toBeDefined();
    const projectedFocus = await page.evaluate(({ longitude, latitude }) => {
      const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
      if (!map) throw new Error('The preview Mapbox map is not available.');
      const point = map.project([longitude, latitude]);
      const canvas = map.getCanvas();
      return { x: point.x, y: point.y, width: canvas.clientWidth, height: canvas.clientHeight };
    }, { longitude: focus.longitude!, latitude: focus.latitude! });
    expect(projectedFocus.x).toBeGreaterThanOrEqual(0);
    expect(projectedFocus.x).toBeLessThanOrEqual(projectedFocus.width);
    expect(projectedFocus.y).toBeGreaterThanOrEqual(0);
    expect(projectedFocus.y).toBeLessThanOrEqual(projectedFocus.height);
    if (phase === 'launch' || phase === 'midcourse') {
      await expect.poll(() => page.evaluate((expectedId) => {
        const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
        if (!map?.getLayer('ise:data-links:fighter-missile')) return 0;
        return map.queryRenderedFeatures(undefined, { layers: ['ise:data-links:fighter-missile'] })
          .filter((feature) => feature.properties?.id === expectedId).length;
      }, destroyedWeaponLink!.id)).toBeGreaterThan(0);
    } else if (phase === 'terminal') {
      await expect(page.locator('video[data-runtime-kind="video"]:visible')).toHaveCount(1);
    } else {
      expect(focus.state).toBe('destroyed');
    }
    destroyedPhaseCameras.push(await previewMapCamera(page));
    destroyedPhasePixels.push(await canvasPixels(page));
    await expectNonBlankCanvas(page);
    const phaseScreenshotPath = testInfo.outputPath(`persisted-engagement-${phase}.png`);
    await page.screenshot({ path: phaseScreenshotPath });
    await testInfo.attach(`persisted-engagement-${phase}`, {
      path: phaseScreenshotPath,
      contentType: 'image/png',
    });
  }
  expect(maximumCenterSpread(destroyedPhaseCameras)).toBeGreaterThan(0.01);
  expect(maximumCameraSpread(destroyedPhaseCameras, (camera) => camera.zoom))
    .toBeGreaterThan(0.05);
  expect(Math.max(...destroyedPhasePixels.slice(1).map((pixels) => (
    changedPixelRatio(destroyedPhasePixels[0]!, pixels)
  )))).toBeGreaterThan(0.005);
  expect(samples.cameraTimes.every(
    (timeMs) => timeMs >= 0 && timeMs < sceneConfig.totalDurationMs,
  )).toBe(true);
  await seekPreviewRuntime(page, samples.cameraTimes[0]);
  const firstEventCamera = await previewMapCamera(page);

  await expect.poll(() => projectedPreviewModel(page)).not.toBeNull();
  const projectedModel = await projectedPreviewModel(page);
  if (!projectedModel) throw new Error('No projected GLB model is visible in Preview.');
  const projectedSizePx = projectedModel.model.projectedSizePx!;
  expect(projectedSizePx).toBeGreaterThanOrEqual(23.5);
  const safeInsetPx = projectedSizePx / 2 + 2;
  expect(projectedModel.point.x).toBeGreaterThanOrEqual(safeInsetPx);
  expect(projectedModel.point.x).toBeLessThanOrEqual(
    projectedModel.viewport.width - safeInsetPx,
  );
  expect(projectedModel.point.y).toBeGreaterThanOrEqual(safeInsetPx);
  expect(projectedModel.point.y).toBeLessThanOrEqual(
    projectedModel.viewport.height - safeInsetPx,
  );

  const modelPixelIsolation = await isolatePreviewModelPixels(page);
  expect(modelPixelIsolation.pixelCount).toBeGreaterThan(0);
  expect(modelPixelIsolation.changedPixels).toBeGreaterThan(8);
  expect(modelPixelIsolation.changedPixelRatio).toBeGreaterThan(0.0005);
  expect(modelPixelIsolation.maximumChannelDelta).toBeGreaterThan(8);

  await seekPreviewRuntime(page, samples.cameraTimes[1]);
  const secondEventCamera = await previewMapCamera(page);
  const cameraEvents = [initialCamera, firstEventCamera, secondEventCamera];
  expect(maximumCenterSpread(cameraEvents)).toBeGreaterThan(0.01);
  expect(maximumCameraSpread(cameraEvents, (camera) => camera.zoom)).toBeGreaterThan(0.05);
  expect(maximumCameraSpread(cameraEvents, (camera) => camera.pitch)).toBeGreaterThan(0.5);
  expect(maximumBearingSpread(cameraEvents)).toBeGreaterThan(0.5);
  expect(
    Math.hypot(
      firstEventCamera.center[0] - secondEventCamera.center[0],
      firstEventCamera.center[1] - secondEventCamera.center[1],
    ),
  ).toBeGreaterThan(0.5);
  expect(Math.abs(firstEventCamera.zoom - secondEventCamera.zoom)).toBeGreaterThan(0.05);

  const previewScreenshotPath = testInfo.outputPath('persisted-preview-desktop.png');
  await page.screenshot({ path: previewScreenshotPath });
  const previewCanvasPath = testInfo.outputPath('persisted-preview-canvas.png');
  const previewCanvasDataUrl = await page
    .locator(mapCanvasSelector)
    .evaluate((canvas) => canvas.toDataURL('image/png'));
  await writeFile(
    previewCanvasPath,
    Buffer.from(previewCanvasDataUrl.split(',')[1]!, 'base64'),
  );
  await testInfo.attach('persisted-preview-desktop', {
    path: previewScreenshotPath,
    contentType: 'image/png',
  });
  await testInfo.attach('persisted-preview-canvas', {
    path: previewCanvasPath,
    contentType: 'image/png',
  });
});
