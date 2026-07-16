import { expect, test, type Page } from '@playwright/test';
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
  visible: boolean;
  longitude?: number;
  latitude?: number;
  headingDeg?: number;
  pitchDeg?: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

async function runtimeModelSnapshots(page: Page) {
  return page.getByTestId('runtime-overlay').evaluate((overlay) => {
    const value = overlay.getAttribute('data-runtime-models');
    return value ? (JSON.parse(value) as RuntimeModelSnapshot[]) : [];
  });
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
  if (!persistedSceneId) {
    throw new Error(
      'ISE_E2E_SCENE_ID is required for the persisted runtime harness replay.',
    );
  }

  await authenticate(page);
  await openRuntimeHarness(
    page,
    `/runtime-harness?sceneId=${encodeURIComponent(persistedSceneId)}`,
  );
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

  await seekRuntimeHarness(page, 82_500);
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

  await seekRuntimeHarness(page, 33_000);
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
  expect(initialVideoTime).toBeCloseTo(1, 1);
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

  await seekRuntimeHarness(page, 1_000);
  await expect.poll(async () => (await runtimeModelSnapshots(page)).some((item) => item.visible)).toBe(true);
  const firstModels = await runtimeModelSnapshots(page);
  const firstModel = firstModels.find((item) => item.visible);
  if (!firstModel) throw new Error('No visible GLB follow_path entity at 1000ms.');
  expect(firstModel.modelAssetId).toMatch(/^model:/);
  const firstCanvas = await canvasPixels(page);

  await seekRuntimeHarness(page, 5_500);
  const secondModel = (await runtimeModelSnapshots(page)).find(
    (item) => item.entityId === firstModel.entityId && item.visible,
  );
  if (!secondModel) {
    throw new Error(`GLB entity ${firstModel.entityId} is not visible at 5500ms.`);
  }
  expect(secondModel.position).not.toEqual(firstModel.position);
  expect(secondModel.quaternion).not.toEqual(firstModel.quaternion);
  expect([secondModel.headingDeg, secondModel.pitchDeg]).not.toEqual([
    firstModel.headingDeg,
    firstModel.pitchDeg,
  ]);

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
});
