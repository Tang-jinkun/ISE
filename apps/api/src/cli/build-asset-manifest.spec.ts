import { createHash } from 'crypto';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import {
  assetSeedManifestSchema,
  normalizeTrajectorySamples,
  type RawTrajectorySample,
} from '@ise/runtime-contracts';
import { buildAssetManifest } from './build-asset-manifest';

jest.mock(
  '../../../../packages/runtime-contracts/src/assets.js',
  () => jest.requireActual('../../../../packages/runtime-contracts/src/assets.ts'),
  { virtual: true },
);
jest.mock(
  '../../../../packages/runtime-contracts/src/trajectory.js',
  () => jest.requireActual('../../../../packages/runtime-contracts/src/trajectory.ts'),
  { virtual: true },
);
jest.mock('@ise/runtime-contracts', () => ({
  ...jest.requireActual('../../../../packages/runtime-contracts/src/assets.ts'),
  ...jest.requireActual('../../../../packages/runtime-contracts/src/trajectory.ts'),
  ...jest.requireActual('../../../../packages/runtime-contracts/src/prepareAssetForUpload.ts'),
}));

const temporaryDirectories: string[] = [];
const modelIds = [
  'model:j10',
  'model:jf17',
  'model:mig29',
  'model:pl15e',
  'model:rafale',
  'model:su30mki',
] as const;

const sha256 = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function minimalGlb() {
  const bytes = Buffer.alloc(12);
  bytes.write('glTF', 0, 'ascii');
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  return bytes;
}

function oneByOnePng() {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function minimalMp4() {
  const bytes = Buffer.alloc(12);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write('isom', 8, 'ascii');
  return bytes;
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ise-build-asset-manifest-'));
  temporaryDirectories.push(directory);
  const sourceRoot = join(directory, 'operator-source');
  const sourceMapPath = join(directory, 'asset-source-map.json');
  const browserMetadataPath = join(directory, 'asset-browser-metadata.json');
  const calibrationPath = join(directory, 'asset-model-calibration.json');
  const outputPath = join(directory, 'assets.seed.json');
  const ffprobePath = join(directory, 'ffprobe-is-intentionally-unavailable');

  const monotonic: RawTrajectorySample[] = [
    {
      timestamp: '2025-05-07 00:00:08',
      latitude: 30.4,
      longitude: 76.8,
      altitude: 1000,
    },
    {
      timestamp: '2025-05-07 00:00:09',
      latitude: 30.41,
      longitude: 76.82,
      altitude: 1200,
    },
  ];
  const reversed: RawTrajectorySample[] = [
    {
      timestamp: '2025-05-07 00:00:09',
      latitude: 30.4,
      longitude: 76.8,
      altitude: 1000,
    },
    {
      timestamp: '2025-05-07 00:00:08',
      latitude: 30.41,
      longitude: 76.82,
      altitude: 1200,
    },
  ];
  const canonicalTrajectoryBytes = Buffer.from(
    JSON.stringify(normalizeTrajectorySamples(monotonic)),
  );
  const reversedTrajectoryBytes = Buffer.from(JSON.stringify(reversed, null, 2));

  const assets = [
    ...modelIds.map((assetId) => ({
      assetId,
      sourceRelativePath: `models/${assetId.slice('model:'.length)}.glb`,
      displayName: assetId,
      aliases: [],
      criticality: 'required',
    })),
    {
      assetId: 'image:ground-radar',
      sourceRelativePath: 'images/ground-radar.png',
      displayName: 'Ground radar',
      aliases: ['地面雷达'],
      criticality: 'required',
    },
    {
      assetId: 'video:missile-impact',
      sourceRelativePath: 'videos/missile-impact.mp4',
      displayName: 'Missile impact',
      aliases: [],
      criticality: 'required',
    },
    {
      assetId: 'trajectory:ambala-rafale-1',
      sourceRelativePath: 'json/AMBALA Rafale-1.json',
      displayName: 'AMBALA Rafale-1',
      aliases: ['Rafale-1'],
      criticality: 'required',
    },
    {
      assetId: 'trajectory:ambala-su30mki-1',
      sourceRelativePath: 'json/AMBALA Su-30MKI-1.json',
      displayName: 'AMBALA Su-30MKI-1',
      aliases: ['Su-30MKI-1'],
      criticality: 'optional',
    },
  ];
  await writeJson(sourceMapPath, {
    schemaVersion: 'ise-asset-source-map/v1',
    assets,
    nameMappings: [
      {
        sourceName: '阵风战斗机编队',
        sourceKind: 'report',
        assetId: 'model:rafale',
        note: 'Stable report name',
      },
    ],
  });

  for (const assetId of modelIds) {
    const path = join(sourceRoot, 'models', `${assetId.slice('model:'.length)}.glb`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, minimalGlb());
  }
  const imagePath = join(sourceRoot, 'images', 'ground-radar.png');
  const videoPath = join(sourceRoot, 'videos', 'missile-impact.mp4');
  const monotonicPath = join(sourceRoot, 'json', 'AMBALA Rafale-1.json');
  const reversedPath = join(sourceRoot, 'json', 'AMBALA Su-30MKI-1.json');
  await mkdir(dirname(imagePath), { recursive: true });
  await mkdir(dirname(videoPath), { recursive: true });
  await mkdir(dirname(monotonicPath), { recursive: true });
  await writeFile(imagePath, oneByOnePng());
  await writeFile(videoPath, minimalMp4());
  await writeJson(monotonicPath, monotonic);
  await writeFile(reversedPath, reversedTrajectoryBytes);

  await writeJson(browserMetadataPath, [
    {
      assetId: 'video:missile-impact',
      status: 'loadedmetadata',
      durationMs: 2400,
      codec: 'avc1.640028',
    },
  ]);
  await writeJson(
    calibrationPath,
    Object.fromEntries(
      modelIds.map((assetId, index) => [
        assetId,
        {
          scale: index + 1,
          rotationOffsetDeg: [index, index + 1, index + 2],
          altitudeOffsetM: index * 10,
          entityTypes: [assetId === 'model:pl15e' ? 'missile' : 'aircraft'],
        },
      ]),
    ),
  );

  return {
    options: {
      sourceRoot,
      sourceMapPath,
      browserMetadataPath,
      calibrationPath,
      outputPath,
      ffprobePath,
    },
    paths: { imagePath, videoPath },
    sourceMapPath,
    browserMetadataPath,
    calibrationPath,
    outputPath,
    sourceRoot,
    canonicalTrajectoryBytes,
    reversedTrajectoryBytes,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('buildAssetManifest', () => {
  it('hashes prepared bytes and marks reversed optional trajectories invalid', async () => {
    const base = await fixture();

    const manifest = await buildAssetManifest(base.options);

    const valid = manifest.assets.find((asset) => asset.assetId === 'trajectory:ambala-rafale-1');
    const reversed = manifest.assets.find(
      (asset) => asset.assetId === 'trajectory:ambala-su30mki-1',
    );
    expect(valid).toMatchObject({
      availability: 'available',
      fingerprint: sha256(base.canonicalTrajectoryBytes),
      size: base.canonicalTrajectoryBytes.byteLength,
      trajectory: {
        monotonic: true,
        bounds: [[76.8, 30.4], [76.82, 30.41]],
      },
    });
    expect(reversed).toMatchObject({
      availability: 'invalid',
      criticality: 'optional',
      fingerprint: sha256(base.reversedTrajectoryBytes),
      size: base.reversedTrajectoryBytes.byteLength,
      trajectory: {
        bounds: [[76.8, 30.4], [76.82, 30.41]],
      },
    });
    expect(assetSeedManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('uses measured PNG dimensions, fallback video metadata, and all six calibrations', async () => {
    const base = await fixture();

    const manifest = await buildAssetManifest(base.options);

    expect(manifest.assets.find((asset) => asset.assetId === 'image:ground-radar')).toMatchObject({
      image: { width: 1, height: 1, fit: 'contain' },
    });
    expect(manifest.assets.find((asset) => asset.assetId === 'video:missile-impact')).toMatchObject(
      { video: { durationMs: 2400, codec: 'avc1.640028' } },
    );
    const models = manifest.assets.filter((asset) => asset.kind === 'model');
    expect(models).toHaveLength(6);
    expect(
      models.every(
        (asset) =>
          asset.kind === 'model' &&
          asset.model.scale > 0 &&
          asset.model.rotationOffsetDeg.length === 3,
      ),
    ).toBe(true);
  });

  it('requires browser metadata after probing fails and requires every model calibration', async () => {
    const missingMetadata = await fixture();
    await unlink(missingMetadata.browserMetadataPath);
    await expect(buildAssetManifest(missingMetadata.options)).rejects.toThrow(
      /browser metadata.*video:missile-impact/i,
    );

    const missingCalibration = await fixture();
    const calibration = JSON.parse(
      await readFile(missingCalibration.calibrationPath, 'utf8'),
    ) as Record<string, unknown>;
    delete calibration['model:su30mki'];
    await writeJson(missingCalibration.calibrationPath, calibration);
    await expect(buildAssetManifest(missingCalibration.options)).rejects.toThrow(
      /calibration.*model:su30mki/i,
    );
  });

  it.each([
    ['GLB', 'models/j10.glb', Buffer.from('not-a-glb')],
    ['PNG', 'images/ground-radar.png', Buffer.from('not-a-png')],
    ['MP4', 'videos/missile-impact.mp4', Buffer.from('not-an-mp4')],
  ])('rejects an invalid %s header', async (_kind, relativePath, invalidBytes) => {
    const base = await fixture();
    await writeFile(join(base.sourceRoot, relativePath), invalidBytes);

    await expect(buildAssetManifest(base.options)).rejects.toThrow(/invalid (GLB|PNG|MP4)/i);
  });

  it('writes sorted strict output without disclosing the source root or transport secrets', async () => {
    const base = await fixture();

    const manifest = await buildAssetManifest(base.options);
    const output = await readFile(base.outputPath, 'utf8');

    expect(manifest.assets.map((asset) => asset.assetId)).toEqual(
      [...manifest.assets.map((asset) => asset.assetId)].sort(),
    );
    expect(manifest.nameMappings).toEqual(
      [...manifest.nameMappings].sort((left, right) =>
        `${left.sourceName}\0${left.sourceKind}\0${left.assetId}`.localeCompare(
          `${right.sourceName}\0${right.sourceKind}\0${right.assetId}`,
        ),
      ),
    );
    expect(output).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(output).not.toContain(base.sourceRoot);
    expect(output).not.toMatch(/https?:|Bearer\s|token|secret/i);
    expect(assetSeedManifestSchema.parse(JSON.parse(output))).toEqual(manifest);
  });

  it('rejects relative source roots, unsafe source paths, and unknown secret fields', async () => {
    const relativeRoot = await fixture();
    await expect(
      buildAssetManifest({ ...relativeRoot.options, sourceRoot: 'relative/source' }),
    ).rejects.toThrow(/sourceRoot.*absolute/i);

    const unsafePath = await fixture();
    const sourceMap = JSON.parse(await readFile(unsafePath.sourceMapPath, 'utf8')) as {
      assets: Array<Record<string, unknown>>;
    };
    sourceMap.assets[0]!.sourceRelativePath = '../outside.glb';
    await writeJson(unsafePath.sourceMapPath, sourceMap);
    await expect(buildAssetManifest(unsafePath.options)).rejects.toThrow(
      /sourceRelativePath|relative path/i,
    );

    const secretField = await fixture();
    const sourceMapWithSecret = JSON.parse(
      await readFile(secretField.sourceMapPath, 'utf8'),
    ) as Record<string, unknown>;
    sourceMapWithSecret.signedUrl = 'https://example.invalid/asset?token=secret';
    await writeJson(secretField.sourceMapPath, sourceMapWithSecret);
    await expect(buildAssetManifest(secretField.options)).rejects.toThrow(/unrecognized|unknown/i);
  });

  it('redacts an absolute rejected source path from the propagated CLI error', async () => {
    const base = await fixture();
    const sourceMap = JSON.parse(await readFile(base.sourceMapPath, 'utf8')) as {
      assets: Array<Record<string, unknown>>;
    };
    const rejectedPath = join(base.sourceRoot, 'models', 'j10.glb');
    sourceMap.assets[0]!.sourceRelativePath = rejectedPath;
    await writeJson(base.sourceMapPath, sourceMap);

    let rejection: unknown;
    try {
      await buildAssetManifest(base.options);
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe('Invalid sourceRelativePath');
    expect((rejection as Error).message).not.toContain(base.sourceRoot);
    expect((rejection as Error).message).not.toContain(rejectedPath);
  });
});

describe('asset-source-map.json', () => {
  it('contains exactly the 22 frozen IDs and Unicode source-relative paths', async () => {
    const sourceMap = JSON.parse(
      await readFile(resolve(__dirname, '../../../../provenance/asset-source-map.json'), 'utf8'),
    ) as { assets: Array<{ assetId: string; sourceRelativePath: string }> };
    const actual = Object.fromEntries(
      sourceMap.assets.map(({ assetId, sourceRelativePath }) => [assetId, sourceRelativePath]),
    );

    expect(actual).toEqual({
      'model:j10': '印巴glb（修改6.0）/J-10.glb',
      'model:jf17': '印巴glb（修改6.0）/JF-17.glb',
      'model:mig29': '印巴glb（修改6.0）/MiG-29.glb',
      'model:pl15e': '印巴glb（修改6.0）/pl-15e.glb',
      'model:rafale': '印巴glb（修改6.0）/Refale.glb',
      'model:su30mki': '印巴glb（修改6.0）/SU-30MKI.glb',
      'video:ooda-chain': '素材/ooda作战链示例视频.mp4',
      'video:runway-exit': '素材/冲出跑道.mp4',
      'video:missile-impact': '素材/导弹击中飞机.mp4',
      'video:cockpit-jamming': '素材/座舱被全频段干扰.mp4',
      'video:damage-check': '素材/检查基本完好无损.mp4',
      'video:bomb-explosion': '素材/炸弹爆炸的视频.mp4',
      'video:radar-offline': '素材/红灯闪烁，offline.mp4',
      'video:target-lock': '素材/锁定目标.mp4',
      'image:ground-radar': '素材/地面雷达.png',
      'image:cockpit-hud': '素材/座舱HUD.png',
      'image:airport': '素材/机场.png',
      'image:aew-illustration': '素材/预警机插图.png',
      'trajectory:ambala-rafale-1': 'json/AMBALA Rafale-1.json',
      'trajectory:minhas-j10ce-1': 'json/MINAS J-10CE-1.json',
      'trajectory:pakistan-missile-1': 'json/巴方导弹1.json',
      'trajectory:ambala-su30mki-1': 'json/AMBALA Su-30MKI-1.json',
    });
    expect(sourceMap.assets).toHaveLength(22);
  });
});
