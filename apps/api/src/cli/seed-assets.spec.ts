import { createHash } from 'crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  normalizeTrajectorySamples,
  prepareTrajectorySource,
  type AssetSeedManifest,
  type RawTrajectorySample,
} from '@ise/runtime-contracts';
import { main, seedAssets } from './seed-assets';

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
jest.mock(
  '../../../../packages/runtime-contracts/src/trajectoryCuration.js',
  () => jest.requireActual('../../../../packages/runtime-contracts/src/trajectoryCuration.ts'),
  { virtual: true },
);
jest.mock('@ise/runtime-contracts', () => ({
  ...jest.requireActual('../../../../packages/runtime-contracts/src/assets.ts'),
  ...jest.requireActual('../../../../packages/runtime-contracts/src/trajectory.ts'),
  ...jest.requireActual('../../../../packages/runtime-contracts/src/prepareAssetForUpload.ts'),
  ...jest.requireActual('../../../../packages/runtime-contracts/src/trajectoryCuration.ts'),
}));
jest.mock('@/minio/minio.service', () => ({ MinioService: class MinioService {} }), {
  virtual: true,
});
jest.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: jest.fn() },
}));
jest.mock('../app.module', () => ({ AppModule: class AppModule {} }), { virtual: true });

const { NestFactory } = jest.requireMock('@nestjs/core') as {
  NestFactory: { createApplicationContext: jest.Mock };
};

const temporaryDirectories: string[] = [];

const sha256 = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function fixture(manifestOverride: Partial<AssetSeedManifest> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ise-seed-assets-'));
  temporaryDirectories.push(directory);
  const sourceDir = join(directory, 'source');
  const manifestPath = join(directory, 'assets.seed.json');
  const sourcePath = join(sourceDir, 'trajectories', 'route.json');
  const raw: RawTrajectorySample[] = [
    {
      timestamp: '2025-05-07 00:00:08',
      latitude: 30.4,
      longitude: 76.8,
      altitude: 1000,
    },
    {
      timestamp: '2025-05-07 00:00:09',
      latitude: 30.4,
      longitude: 76.82,
      altitude: 1200,
    },
  ];
  const source = Buffer.from(JSON.stringify(raw, null, 2));
  const prepared = Buffer.from(JSON.stringify(normalizeTrajectorySamples(raw)));
  const manifest: AssetSeedManifest = {
    schemaVersion: 'ise-assets/v1',
    assets: [
      {
        assetId: 'trajectory:route',
        kind: 'trajectory',
        displayName: 'Route',
        aliases: [],
        fingerprint: sha256(prepared),
        sourceRelativePath: 'trajectories/route.json',
        objectName: 'demo/trajectories/route.json',
        mediaType: 'application/vnd.ise.trajectory+json',
        size: prepared.length,
        availability: 'available',
        criticality: 'required',
        fallbackAssetIds: [],
        allowFallback: false,
        trajectory: {
          format: 'ise-trajectory/v1',
          timeUnit: 'ms',
          coordinateOrder: 'lng-lat-alt',
          startTimeMs: 0,
          endTimeMs: 1000,
          monotonic: true,
        },
      },
    ],
    nameMappings: [],
    ...manifestOverride,
  };
  await writeFile(sourcePath, source, { encoding: 'utf8', flag: 'wx' }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(join(sourceDir, 'trajectories'), { recursive: true });
    await writeFile(sourcePath, source);
  });
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { manifest, manifestPath, prepared, source, sourceDir };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('seedAssets', () => {
  it('uploads the same curated bytes produced by trajectory preparation', async () => {
    const base = await fixture();
    const raw: RawTrajectorySample[] = [
      { timestamp: '2025-05-07 00:00:09', latitude: 30.4, longitude: 76.8, altitude: 1000 },
      { timestamp: '2025-05-07 00:00:08', latitude: 30.41, longitude: 76.82, altitude: 1200 },
    ];
    const source = Buffer.from(JSON.stringify(raw));
    await writeFile(join(base.sourceDir, 'trajectories', 'route.json'), source);
    const curation = {
      policyId: 'trajectory.shift-suffix/v1' as const,
      expectedSourceFingerprint: sha256(source),
      startIndex: 1,
      deltaMs: 2000,
    };
    const prepared = await prepareTrajectorySource('trajectory:ambala-su30mki-1', source, curation);
    const baseEntry = base.manifest.assets[0];
    if (baseEntry.kind !== 'trajectory') throw new Error('fixture must contain a trajectory');
    const entry = {
      ...baseEntry,
      assetId: 'trajectory:ambala-su30mki-1' as const,
      fingerprint: sha256(Buffer.from(prepared.bytes)),
      size: prepared.bytes.byteLength,
      trajectory: {
        ...baseEntry.trajectory,
        startTimeMs: prepared.normalized.points[0]!.timeMs,
        endTimeMs: prepared.normalized.points.at(-1)!.timeMs,
        curation,
      },
    };
    await writeFile(base.manifestPath, JSON.stringify({ ...base.manifest, assets: [entry] }));
    const upload = jest.fn().mockResolvedValue(undefined);

    await seedAssets({ manifestPath: base.manifestPath, sourceDir: base.sourceDir, upload });

    expect(upload).toHaveBeenCalledWith(
      'demo/trajectories/route.json',
      Buffer.from(prepared.bytes),
      'application/vnd.ise.trajectory+json',
    );
  });

  it('uploads normalized prepared bytes to the exact manifest object key', async () => {
    const { manifestPath, prepared, sourceDir } = await fixture();
    const upload = jest.fn().mockResolvedValue(undefined);

    await seedAssets({ manifestPath, sourceDir, upload });

    expect(upload).toHaveBeenCalledWith(
      'demo/trajectories/route.json',
      prepared,
      'application/vnd.ise.trajectory+json',
    );
  });

  it('rejects a fingerprint mismatch before uploading', async () => {
    const base = await fixture();
    const invalid = {
      ...base.manifest,
      assets: [{ ...base.manifest.assets[0], fingerprint: `sha256:${'0'.repeat(64)}` }],
    } as AssetSeedManifest;
    await writeFile(base.manifestPath, JSON.stringify(invalid));
    const upload = jest.fn();

    await expect(
      seedAssets({ manifestPath: base.manifestPath, sourceDir: base.sourceDir, upload }),
    ).rejects.toThrow(/fingerprint/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects unavailable required assets without reading or uploading them', async () => {
    const base = await fixture();
    const unavailable = {
      ...base.manifest,
      assets: [
        {
          ...base.manifest.assets[0],
          availability: 'missing',
          sourceRelativePath: 'trajectories/not-present.json',
        },
      ],
    } as AssetSeedManifest;
    await writeFile(base.manifestPath, JSON.stringify(unavailable));
    const upload = jest.fn();

    await expect(
      seedAssets({ manifestPath: base.manifestPath, sourceDir: base.sourceDir, upload }),
    ).rejects.toThrow('Required asset is missing: trajectory:route');
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects source paths containing a symlink or Windows junction', async () => {
    const base = await fixture();
    const externalDirectory = await mkdtemp(join(tmpdir(), 'ise-seed-assets-external-'));
    temporaryDirectories.push(externalDirectory);
    await writeFile(join(externalDirectory, 'route.json'), base.source);
    const linkedDirectory = join(base.sourceDir, 'linked');
    try {
      await symlink(
        externalDirectory,
        linkedDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
        expect(process.platform).toBe('win32');
        return;
      }
      throw error;
    }

    const linkedManifest = {
      ...base.manifest,
      assets: [{ ...base.manifest.assets[0], sourceRelativePath: 'linked/route.json' }],
    } as AssetSeedManifest;
    await writeFile(base.manifestPath, JSON.stringify(linkedManifest));
    const upload = jest.fn();

    await expect(
      seedAssets({ manifestPath: base.manifestPath, sourceDir: base.sourceDir, upload }),
    ).rejects.toThrow(/symbolic link|junction|reparse/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('closes the Nest context when executable seeding fails', async () => {
    const { manifestPath, sourceDir } = await fixture();
    const app = {
      get: jest
        .fn()
        .mockReturnValue({ putObject: jest.fn().mockRejectedValue(new Error('offline')) }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    NestFactory.createApplicationContext.mockResolvedValue(app);
    const previousManifestPath = process.env.ASSET_MANIFEST_PATH;
    const previousSourceDir = process.env.ASSET_SOURCE_DIR;
    process.env.ASSET_MANIFEST_PATH = manifestPath;
    process.env.ASSET_SOURCE_DIR = sourceDir;

    try {
      await expect(main()).rejects.toThrow('offline');
      expect(app.close).toHaveBeenCalledTimes(1);
    } finally {
      if (previousManifestPath === undefined) delete process.env.ASSET_MANIFEST_PATH;
      else process.env.ASSET_MANIFEST_PATH = previousManifestPath;
      if (previousSourceDir === undefined) delete process.env.ASSET_SOURCE_DIR;
      else process.env.ASSET_SOURCE_DIR = previousSourceDir;
    }
  });
});
