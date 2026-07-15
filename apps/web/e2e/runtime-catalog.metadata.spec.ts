import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { parseMp4Metadata } from '../src/runtime/testing/runtimeCatalogMetadata';

type SourceAsset = {
  assetId: string;
  sourceRelativePath: string;
};

type SourceMap = {
  assets: SourceAsset[];
};

type BrowserMetadata = {
  assetId: string;
  status: 'loadedmetadata';
  durationMs: number;
  codec: string;
};

const provenanceRoot = fileURLToPath(
  new URL('../../../provenance/', import.meta.url),
);
const sourceMapPath = resolve(provenanceRoot, 'asset-source-map.json');
const browserMetadataPath = resolve(
  provenanceRoot,
  'asset-browser-metadata.json',
);
const measuredModelScales: Record<string, number> = {
  'model:j10': 19.260474,
  'model:jf17': 15.287153,
  'model:mig29': 21.146357,
  'model:pl15e': 5.743099,
  'model:rafale': 21.179728,
  'model:su30mki': 25.489869,
};
const measuredModelLengthsM: Record<string, number> = {
  'model:j10': 16.9,
  'model:jf17': 14.93,
  'model:mig29': 17.32,
  'model:pl15e': 4,
  'model:rafale': 15.3,
  'model:su30mki': 21.935,
};

function requireSourceRoot() {
  const sourceRoot = process.env.ISE_ASSET_SOURCE_ROOT;
  if (!sourceRoot || !isAbsolute(sourceRoot)) {
    throw new Error('ISE_ASSET_SOURCE_ROOT must be an absolute source directory.');
  }
  return resolve(sourceRoot);
}

async function readSourceMap() {
  return JSON.parse(await readFile(sourceMapPath, 'utf8')) as SourceMap;
}

function resolveSourceAsset(sourceRoot: string, sourceRelativePath: string) {
  if (
    isAbsolute(sourceRelativePath) ||
    /^[A-Za-z]:/.test(sourceRelativePath) ||
    sourceRelativePath.includes('\\') ||
    sourceRelativePath.split('/').some((segment) => segment === '..')
  ) {
    throw new Error('Source map contains an unsafe sourceRelativePath.');
  }
  const sourcePath = resolve(sourceRoot, ...sourceRelativePath.split('/'));
  const fromRoot = relative(sourceRoot, sourcePath);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Source asset escapes ISE_ASSET_SOURCE_ROOT.');
  }
  return sourcePath;
}

async function writeJsonAtomic(outputPath: string, value: unknown) {
  await mkdir(resolve(outputPath, '..'), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readBrowserVideoMetadata(page: Page, sourcePath: string, codec: string) {
  await page.setContent(`
    <input id="video-file" type="file" accept="video/mp4">
    <video id="metadata-video" preload="metadata"></video>
  `);
  await page.locator('#video-file').setInputFiles(sourcePath);
  return page.evaluate(async (parsedCodec) => {
    const input = document.querySelector<HTMLInputElement>('#video-file');
    const video = document.querySelector<HTMLVideoElement>('#metadata-video');
    const file = input?.files?.[0];
    if (!file || !video) throw new Error('Video metadata probe elements are missing.');
    const blob = new Blob([await file.arrayBuffer()], { type: 'video/mp4' });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const status = await new Promise<'loadedmetadata' | 'error'>((resolveStatus) => {
        const timeout = window.setTimeout(() => resolveStatus('error'), 30_000);
        video.addEventListener(
          'loadedmetadata',
          () => {
            window.clearTimeout(timeout);
            resolveStatus('loadedmetadata');
          },
          { once: true },
        );
        video.addEventListener(
          'error',
          () => {
            window.clearTimeout(timeout);
            resolveStatus('error');
          },
          { once: true },
        );
        video.src = objectUrl;
        video.load();
      });
      return {
        status,
        durationMs: Math.round(video.duration * 1_000),
        canPlay: video.canPlayType(`video/mp4; codecs="${parsedCodec}"`),
      };
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }, codec);
}

async function canvasContrast(page: Page) {
  const renderContrast = Number(
    await page.getByTestId('calibration-map').getAttribute('data-canvas-contrast'),
  );
  if (Number.isFinite(renderContrast) && renderContrast > 0) return renderContrast;
  return page.locator('canvas.mapboxgl-canvas').evaluate((canvas) => {
    const probe = document.createElement('canvas');
    probe.width = 96;
    probe.height = 96;
    const context = probe.getContext('2d');
    if (!context || canvas.width === 0 || canvas.height === 0) return 0;
    context.drawImage(canvas, 0, 0, probe.width, probe.height);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let minimum = 255;
    let maximum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      minimum = Math.min(
        minimum,
        pixels[index]!,
        pixels[index + 1]!,
        pixels[index + 2]!,
      );
      maximum = Math.max(
        maximum,
        pixels[index]!,
        pixels[index + 1]!,
        pixels[index + 2]!,
      );
    }
    return maximum - minimum;
  });
}

async function pngContrast(page: Page, png: Buffer) {
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const probe = document.createElement('canvas');
    probe.width = 96;
    probe.height = 96;
    const context = probe.getContext('2d');
    if (!context) return 0;
    context.drawImage(bitmap, 0, 0, probe.width, probe.height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let minimum = 255;
    let maximum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      minimum = Math.min(
        minimum,
        pixels[index]!,
        pixels[index + 1]!,
        pixels[index + 2]!,
      );
      maximum = Math.max(
        maximum,
        pixels[index]!,
        pixels[index + 1]!,
        pixels[index + 2]!,
      );
    }
    return maximum - minimum;
  }, png.toString('base64'));
}

async function brightNeutralPixels(page: Page, png: Buffer) {
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const probe = document.createElement('canvas');
    probe.width = bitmap.width;
    probe.height = bitmap.height;
    const context = probe.getContext('2d');
    if (!context) return 0;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let brightNeutralPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index]!;
      const green = pixels[index + 1]!;
      const blue = pixels[index + 2]!;
      if (
        Math.min(red, green, blue) >= 180 &&
        Math.max(red, green, blue) - Math.min(red, green, blue) <= 32
      ) {
        brightNeutralPixels += 1;
      }
    }
    return brightNeutralPixels;
  }, png.toString('base64'));
}

test('measures all runtime-catalog MP4 metadata from real browser Blob URLs', async ({
  page,
}) => {
  const sourceRoot = requireSourceRoot();
  const sourceMap = await readSourceMap();
  const videos = sourceMap.assets.filter((asset) => asset.assetId.startsWith('video:'));
  expect(videos).toHaveLength(8);
  const records: BrowserMetadata[] = [];

  for (const asset of videos) {
    const sourcePath = resolveSourceAsset(sourceRoot, asset.sourceRelativePath);
    const parsed = parseMp4Metadata(await readFile(sourcePath));
    const browser = await readBrowserVideoMetadata(page, sourcePath, parsed.codec);
    expect(browser.status, asset.assetId).toBe('loadedmetadata');
    expect(browser.canPlay, `${asset.assetId} ${parsed.codec}`).not.toBe('');
    expect(Math.abs(browser.durationMs - parsed.durationMs), asset.assetId).toBeLessThanOrEqual(50);
    records.push({
      assetId: asset.assetId,
      status: 'loadedmetadata',
      durationMs: parsed.durationMs,
      codec: parsed.codec,
    });
  }

  await writeJsonAtomic(browserMetadataPath, records);
});

test('loads every real catalog GLB into the calibration viewport', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  const sourceRoot = requireSourceRoot();
  const sourceMap = await readSourceMap();
  const models = sourceMap.assets.filter((asset) => asset.assetId.startsWith('model:'));
  expect(models).toHaveLength(6);

  await page.goto('/runtime-harness?fixture=runtime-catalog&calibration=1');
  await expect(page.getByTestId('runtime-catalog-calibration')).toBeVisible();

  const layout = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="calibration-map"]');
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.mapboxgl-canvas');
    const geometry = document.querySelector<HTMLElement>('[data-testid="calibration-geometry"]');
    const measure = (element: HTMLElement | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        position: style.position,
        zIndex: style.zIndex,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      root: measure(root),
      canvas: measure(canvas),
      geometry: measure(geometry),
    };
  });
  console.log(`calibration-layout=${JSON.stringify(layout)}`);
  expect(layout.root).toMatchObject({
    x: 0,
    y: 0,
    width: layout.viewport.width,
    height: layout.viewport.height,
    position: 'absolute',
  });
  expect(layout.canvas).toMatchObject({
    width: layout.viewport.width,
    height: layout.viewport.height,
  });
  await page.locator('canvas.mapboxgl-canvas').hover({
    position: { x: layout.viewport.width / 2, y: layout.viewport.height / 2 },
  });
  await page.mouse.wheel(0, -300);

  for (const asset of models) {
    await page.getByLabel('Model', { exact: true }).selectOption(asset.assetId);
    await page
      .getByLabel('Model GLB', { exact: true })
      .setInputFiles(resolveSourceAsset(sourceRoot, asset.sourceRelativePath));
    await expect(page.getByTestId('calibration-load-status')).toHaveText('loaded', {
      timeout: 5_000,
    });
    await page.getByLabel('Scale').fill(String(measuredModelScales[asset.assetId]));
    await page.getByLabel('Rotation X').fill('90');
    await expect
      .poll(async () => {
        const evidence = JSON.parse(
          (await page.getByTestId('calibration-geometry').textContent()) ?? '{}',
        ) as { physicalSize?: number[] };
        return Math.max(...(evidence.physicalSize ?? [0]));
      })
      .toBeCloseTo(measuredModelLengthsM[asset.assetId]!, 3);
    const geometry = JSON.parse(
      (await page.getByTestId('calibration-geometry').textContent()) ?? '{}',
    ) as { physicalSize?: number[]; groundAltitudeSuggestionM?: number };
    console.log(`calibration-geometry:${asset.assetId}=${JSON.stringify(geometry)}`);
    expect(Number.isFinite(geometry.groundAltitudeSuggestionM)).toBe(true);
    await page
      .getByLabel('Altitude', { exact: true })
      .fill(String(geometry.groundAltitudeSuggestionM));
    await expect(page.getByTestId('calibration-map')).toHaveAttribute(
      'data-axes-ready',
      'true',
    );
    await expect(page.locator('canvas.mapboxgl-canvas')).toBeVisible();
    const canvasPng = await page.locator('canvas.mapboxgl-canvas').screenshot({
      path: testInfo.outputPath(`calibration-${asset.assetId.slice('model:'.length)}.png`),
    });
    expect(browserErrors, asset.assetId).toEqual([]);
    await expect.poll(() => canvasContrast(page), asset.assetId).toBeGreaterThan(24);
    expect(await pngContrast(page, canvasPng), `${asset.assetId} screenshot`).toBeGreaterThan(24);
    if (asset.assetId === 'model:pl15e') {
      const detail = page.getByTestId('calibration-detail-canvas');
      await expect(detail).toBeVisible();
      const detailPng = await detail.screenshot();
      expect(
        await brightNeutralPixels(page, detailPng),
        'model:pl15e high-contrast silhouette pixels',
      ).toBeGreaterThan(20);
    } else {
      await expect(page.getByTestId('calibration-detail-canvas')).toHaveCount(0);
    }
  }
});
