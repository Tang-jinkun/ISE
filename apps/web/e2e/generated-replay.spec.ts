import { expect, test, type Page } from '@playwright/test';
import { RUNTIME_MAIN_CONFIG } from '../src/runtime/testing/runtimeFixtures';

const accessToken = process.env.ISE_E2E_ACCESS_TOKEN;
const mapboxToken = process.env.PUBLIC_MAPBOX_TOKEN;

async function seedAuthenticatedScene(page: Page, sceneId: string) {
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

  await page.goto('/runtime-harness?fixture=runtime-main');
  await expect(page.getByTestId('runtime-status')).toHaveAttribute(
    'data-status',
    'ready',
  );
  await page.getByTestId('runtime-seek').fill('8000');
  await expect(page.getByTestId('runtime-time')).toHaveText('8000');
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
