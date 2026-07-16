import { expect, test, type Page, type Response } from '@playwright/test';
import { sceneProjectConfigSchema, type SceneProjectConfig } from '@ise/runtime-contracts';
import type mapboxgl from 'mapbox-gl';
import { writeFile } from 'node:fs/promises';
import { RUNTIME_MAIN_CONFIG } from '../src/runtime/testing/runtimeFixtures';

const accessToken = process.env.ISE_E2E_ACCESS_TOKEN;
const mapboxToken = process.env.PUBLIC_MAPBOX_TOKEN;
const persistedSceneId = process.env.ISE_E2E_SCENE_ID;

async function authenticate(page: Page) {
  if (!accessToken) {
    throw new Error(
      'ISE_E2E_ACCESS_TOKEN is required for asset-catalog access to the real seeded assets.',
    );
  }
  if (!mapboxToken) {
    throw new Error(
      'PUBLIC_MAPBOX_TOKEN is required for generated replay canvas assertions.',
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
  const canvas = page.locator('canvas.mapboxgl-canvas');
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
type FollowPathItem = ModelTrackItem & {
  params: Extract<ModelTrackItem['params'], { action: 'model.follow_path' }>;
};

function isFollowPathItem(item: ModelTrackItem): item is FollowPathItem {
  return item.params.action === 'model.follow_path';
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
  const upperBoundMs = Math.max(0, config.totalDurationMs - 1);
  const sampleTime = (item: CameraTrack['items'][number]) =>
    Math.min(
      upperBoundMs,
      Math.max(0, Math.round(item.startMs + item.durationMs * 0.8)),
    );
  let best: { times: [number, number]; separationMs: number } | undefined;
  for (let left = 0; left < cameraItems.length; left += 1) {
    for (let right = left + 1; right < cameraItems.length; right += 1) {
      const first = cameraItems[left]!;
      const second = cameraItems[right]!;
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
  const videoItem = config.tracks.find((track) => track.type === 'video')?.items[0];
  if (!imageItem || !videoItem) {
    throw new Error('Persisted scene requires active image and video intervals.');
  }
  const image = sampleInside(imageItem.startMs, imageItem.durationMs, 500);
  const video = sampleInside(videoItem.startMs, videoItem.durationMs, 1_000);

  const aircraftIds = new Set(
    config.entities.filter((entity) => entity.kind === 'aircraft').map((entity) => entity.entityId),
  );
  const follows = config.tracks
    .filter((track): track is ModelTrack => track.type === 'model')
    .flatMap((track) => track.items.filter(isFollowPathItem));
  const aircraftFollows = follows.filter((item) => aircraftIds.has(item.params.entityId));
  let overlap: { items: [FollowPathItem, FollowPathItem]; startMs: number; endMs: number } | undefined;
  for (let left = 0; left < aircraftFollows.length; left += 1) {
    for (let right = left + 1; right < aircraftFollows.length; right += 1) {
      const first = aircraftFollows[left]!;
      const second = aircraftFollows[right]!;
      const startMs = Math.max(first.startMs, second.startMs);
      const endMs = Math.min(
        first.startMs + first.durationMs,
        second.startMs + second.durationMs,
      );
      if (endMs - startMs > 2 && (!overlap || endMs - startMs > overlap.endMs - overlap.startMs)) {
        overlap = { items: [first, second], startMs, endMs };
      }
    }
  }
  if (!overlap) {
    throw new Error('Persisted scene requires two aircraft with overlapping follow_path intervals.');
  }
  const overlapDurationMs = overlap.endMs - overlap.startMs;
  return {
    image,
    video,
    cameraTimes: cameraAcceptanceTimes(config),
    follows,
    activeAircraftIds: overlap.items.map((item) => item.params.entityId),
    modelEarlyMs: Math.floor(overlap.startMs + overlapDurationMs * 0.2),
    modelLateMs: Math.floor(overlap.startMs + overlapDurationMs * 0.8),
  };
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
  return page.locator('canvas.mapboxgl-canvas').evaluate((source) => {
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
  const currentTimeMs = await previewRuntimeTime(page);
  const playhead = page.locator('div:has(> svg > path[d="M0 0H12V6L6 12L0 6V0Z"])');
  await expect(playhead).toBeVisible();
  const bounds = await playhead.boundingBox();
  if (!bounds) throw new Error('Preview timeline playhead is not measurable.');
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await playhead.dispatchEvent('mousedown', {
    button: 0,
    buttons: 1,
    clientX: startX,
    clientY: startY,
  });
  await page.evaluate(
    ({ clientX, clientY }) => {
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        buttons: 1,
        clientX,
        clientY,
      }));
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        button: 0,
        clientX,
        clientY,
      }));
    },
    {
      clientX: startX + ((timeMs - currentTimeMs) / 1_000) * 10,
      clientY: startY,
    },
  );
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

async function isolatePreviewModelPixels(
  page: Page,
  projected: ProjectedRuntimeModel,
) {
  return page.evaluate(async ({ point, projectedSizePx }) => {
    const map = (window as SceneMapWindow).__ISE_SCENE_MAP__;
    if (!map) throw new Error('The preview Mapbox map is not available.');
    const layerId = 'ise-model-runtime';
    const layer = map.getLayer(layerId);
    if (!layer) throw new Error(`${layerId} is missing before visibility isolation.`);
    if (!map.loaded()) {
      await new Promise<void>((resolve) => map.once('idle', () => resolve()));
    }
    const canvas = map.getCanvas();
    const scaleX = canvas.width / canvas.clientWidth;
    const scaleY = canvas.height / canvas.clientHeight;
    const radiusCssPx = Math.max(16, projectedSizePx / 2 + 4);
    const left = Math.max(0, Math.floor((point.x - radiusCssPx) * scaleX));
    const top = Math.max(0, Math.floor((point.y - radiusCssPx) * scaleY));
    const right = Math.min(canvas.width, Math.ceil((point.x + radiusCssPx) * scaleX));
    const bottom = Math.min(canvas.height, Math.ceil((point.y + radiusCssPx) * scaleY));

    const capture = () => {
      const probe = document.createElement('canvas');
      probe.width = Math.max(1, right - left);
      probe.height = Math.max(1, bottom - top);
      const context = probe.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Unable to create the model pixel probe.');
      context.drawImage(
        canvas,
        left,
        top,
        probe.width,
        probe.height,
        0,
        0,
        probe.width,
        probe.height,
      );
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
    map.removeLayer(layerId);
    try {
      await renderTwice();
      if (map.getLayer(layerId)) {
        throw new Error(`${layerId} was re-added before the hidden-frame capture.`);
      }
      hidden = capture();
      map.addLayer(layer);
      await renderTwice();
      if (!map.getLayer(layerId)) {
        throw new Error(`${layerId} was not restored for the visible-frame capture.`);
      }
      shown = capture();
    } finally {
      if (!map.getLayer(layerId)) {
        map.addLayer(layer);
        await renderTwice();
      }
    }

    let changedPixels = 0;
    let maximumChannelDelta = 0;
    for (let index = 0; index < hidden.length; index += 4) {
      const delta = Math.max(
        Math.abs(hidden[index]! - shown[index]!),
        Math.abs(hidden[index + 1]! - shown[index + 1]!),
        Math.abs(hidden[index + 2]! - shown[index + 2]!),
      );
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
      if (delta > 6) changedPixels += 1;
    }
    const pixelCount = hidden.length / 4;
    return {
      changedPixels,
      changedPixelRatio: pixelCount > 0 ? changedPixels / pixelCount : 0,
      maximumChannelDelta,
      pixelCount,
    };
  }, {
    point: projected.point,
    projectedSizePx: projected.model.projectedSizePx!,
  });
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

test('plays and seeks a persisted generated replay', async ({ page }, testInfo) => {
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
  const entityIds = sceneConfig.entities.map((entity) => entity.entityId);
  const defaultRoutes = sceneConfig.entities.map((entity) => entity.defaultTrajectoryAssetId);
  const followEntityIds = samples.follows.map((item) => item.params.entityId);
  const followRoutes = samples.follows.map((item) => item.params.trajectoryAssetId);
  expect(sceneConfig.entities.filter((entity) => entity.kind === 'aircraft').length).toBeGreaterThan(1);
  expect(new Set(entityIds).size).toBe(entityIds.length);
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

  await seekRuntimeHarness(page, samples.video.timeMs);
  const video = page.locator('video[data-runtime-kind="video"]');
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate(
        (element) =>
          element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          element.videoWidth > 0 &&
          element.videoHeight > 0,
      ),
    )
    .toBe(true);
  const initialVideoTime = await video.evaluate((element) => element.currentTime);
  expect(initialVideoTime).toBeCloseTo(samples.video.offsetMs / 1_000, 1);
  await page.getByTestId('runtime-play').click();
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);
  await expect
    .poll(() => video.evaluate((element) => element.currentTime))
    .toBeGreaterThan(initialVideoTime + 0.2);
  const decodedFrames = await video.evaluate((element) => {
    const quality = element.getVideoPlaybackQuality?.();
    return quality?.totalVideoFrames;
  });
  if (decodedFrames !== undefined) expect(decodedFrames).toBeGreaterThan(0);
  await page.getByTestId('runtime-pause').click();

  await seekRuntimeHarness(page, samples.modelEarlyMs);
  await expect
    .poll(async () => {
      const activeIds = new Set(samples.activeAircraftIds);
      return (await runtimeModelSnapshots(page)).filter(
        (item) => item.visible && activeIds.has(item.entityId),
      ).length;
    })
    .toBeGreaterThan(1);
  const firstModels = (await runtimeModelSnapshots(page)).filter((item) => item.visible);
  const visibleEntityIds = firstModels.map((item) => item.entityId);
  expect(new Set(visibleEntityIds).size).toBe(visibleEntityIds.length);
  expect(firstModels.filter((item) => samples.activeAircraftIds.includes(item.entityId)).length)
    .toBeGreaterThan(1);
  for (const model of firstModels) {
    expect(model.modelAssetId).toMatch(/^model:/);
    expectFiniteModelSnapshot(model);
  }
  const exposedRoutes = firstModels.flatMap((item) =>
    item.trajectoryAssetId ?? item.defaultTrajectoryAssetId
      ? [item.trajectoryAssetId ?? item.defaultTrajectoryAssetId!]
      : [],
  );
  if (exposedRoutes.length > 0) {
    expect(exposedRoutes).toHaveLength(firstModels.length);
    expect(new Set(exposedRoutes).size).toBe(exposedRoutes.length);
  }
  const firstCanvas = await canvasPixels(page);

  await seekRuntimeHarness(page, samples.modelLateMs);
  const secondModels = (await runtimeModelSnapshots(page)).filter((item) => item.visible);
  for (const model of secondModels) expectFiniteModelSnapshot(model);
  const modelPairs = samples.activeAircraftIds.flatMap((entityId) => {
    const first = firstModels.find((item) => item.entityId === entityId);
    const second = secondModels.find((item) => item.entityId === entityId);
    return first && second ? [{ first, second }] : [];
  });
  expect(modelPairs).toHaveLength(samples.activeAircraftIds.length);
  const movedModels = modelPairs.filter(({ first, second }) =>
    second.position.some((value, index) => value !== first.position[index]),
  );
  expect(movedModels.length).toBeGreaterThanOrEqual(2);
  expect(
    modelPairs.some(({ first, second }) =>
      second.quaternion.some((value, index) => value !== first.quaternion[index]) &&
      (second.headingDeg !== first.headingDeg || second.pitchDeg !== first.pitchDeg),
    ),
  ).toBe(true);

  await expect
    .poll(async () => changedPixelRatio(firstCanvas, await canvasPixels(page)))
    .toBeGreaterThan(0.001);

  const screenshotPath = testInfo.outputPath('persisted-runtime-dynamic-canvas.png');
  await page.screenshot({ path: screenshotPath });
  const canvasScreenshotPath = testInfo.outputPath('persisted-runtime-canvas.png');
  await page.locator('canvas.mapboxgl-canvas').screenshot({ path: canvasScreenshotPath });
  const canvasBufferPath = testInfo.outputPath('persisted-runtime-canvas-buffer.png');
  const canvasDataUrl = await page
    .locator('canvas.mapboxgl-canvas')
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

  expect(samples.modelLateMs).toBeGreaterThan(500);
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

  const modelPixelIsolation = await isolatePreviewModelPixels(page, projectedModel);
  expect(modelPixelIsolation.pixelCount).toBeGreaterThan(0);
  expect(modelPixelIsolation.changedPixels).toBeGreaterThan(8);
  expect(modelPixelIsolation.changedPixelRatio).toBeGreaterThan(0.002);
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
    .locator('canvas.mapboxgl-canvas')
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
