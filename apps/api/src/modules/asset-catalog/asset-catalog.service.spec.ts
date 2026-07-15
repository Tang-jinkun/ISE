import { NotFoundException } from '@nestjs/common';
import { publicAssetCatalogEntrySchema, type AssetManifestEntry } from '@ise/runtime-contracts';
import { AssetCatalogService } from './asset-catalog.service';

jest.mock('@ise/runtime-contracts', () => {
  return jest.requireActual('../../../../../packages/runtime-contracts/src/assets.ts');
});
jest.mock('@/config/required-env', () => ({ requiredEnv: jest.fn() }), { virtual: true });
jest.mock('@/minio/minio.service', () => ({ MinioService: class MinioService {} }), {
  virtual: true,
});

const fingerprint = `sha256:${'a'.repeat(64)}`;

function modelEntry(overrides: Partial<AssetManifestEntry> = {}): AssetManifestEntry {
  return {
    assetId: 'model:jf17',
    kind: 'model',
    displayName: 'JF-17',
    aliases: ['JF17'],
    fingerprint,
    sourceRelativePath: 'models/JF-17.glb',
    objectName: 'demo/models/JF-17.glb',
    mediaType: 'model/gltf-binary',
    size: 1_466_636,
    availability: 'available',
    criticality: 'required',
    fallbackAssetIds: [],
    allowFallback: false,
    model: {
      scale: 1,
      rotationOffsetDeg: [0, 0, 90],
      altitudeOffsetM: 0,
      entityTypes: ['aircraft'],
    },
    ...overrides,
  } as AssetManifestEntry;
}

function entriesForEveryKind(): AssetManifestEntry[] {
  return [
    modelEntry(),
    {
      assetId: 'trajectory:route',
      kind: 'trajectory',
      displayName: 'Route',
      aliases: [],
      fingerprint,
      sourceRelativePath: 'trajectories/route.json',
      objectName: 'demo/trajectories/route.json',
      mediaType: 'application/vnd.ise.trajectory+json',
      size: 128,
      availability: 'available',
      criticality: 'required',
      fallbackAssetIds: [],
      allowFallback: false,
      trajectory: {
        format: 'ise-trajectory/v1',
        timeUnit: 'ms',
        coordinateOrder: 'lng-lat-alt',
        startTimeMs: 0,
        endTimeMs: 1_000,
        monotonic: true,
      },
    },
    {
      assetId: 'video:replay',
      kind: 'video',
      displayName: 'Replay',
      aliases: [],
      fingerprint,
      sourceRelativePath: 'videos/replay.mp4',
      objectName: 'demo/videos/replay.mp4',
      mediaType: 'video/mp4',
      size: 256,
      availability: 'available',
      criticality: 'optional',
      fallbackAssetIds: [],
      allowFallback: false,
      video: { durationMs: 10_000, codec: 'h264' },
    },
    {
      assetId: 'image:poster',
      kind: 'image',
      displayName: 'Poster',
      aliases: [],
      fingerprint,
      sourceRelativePath: 'images/poster.png',
      objectName: 'demo/images/poster.png',
      mediaType: 'image/png',
      size: 64,
      availability: 'available',
      criticality: 'optional',
      fallbackAssetIds: [],
      allowFallback: false,
      image: { width: 1920, height: 1080, fit: 'contain' },
    },
    {
      assetId: 'geojson:airspace',
      kind: 'geojson',
      displayName: 'Airspace',
      aliases: [],
      fingerprint,
      sourceRelativePath: 'geojson/airspace.json',
      objectName: 'demo/geojson/airspace.json',
      mediaType: 'application/geo+json',
      size: 32,
      availability: 'available',
      criticality: 'optional',
      fallbackAssetIds: [],
      allowFallback: false,
    },
  ];
}

function createService(entries: AssetManifestEntry[] = [modelEntry()]) {
  const minio = {
    presignRead: jest.fn().mockResolvedValue('https://minio.test/signed'),
  };
  return { service: new AssetCatalogService(minio as any, entries), minio };
}

describe('AssetCatalogService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns public metadata without exposing storage or local source paths', () => {
    const { service } = createService();

    expect(service.listPublic()).toEqual([
      expect.objectContaining({ assetId: 'model:jf17', kind: 'model' }),
    ]);
    expect(service.listPublic()[0]).not.toHaveProperty('objectName');
    expect(service.listPublic()[0]).not.toHaveProperty('sourceRelativePath');
  });

  it('returns shared-schema public entries for every asset kind without storage fields', () => {
    const { service } = createService(entriesForEveryKind());

    const entries = service.listPublic();
    expect(entries.map((entry) => entry.kind)).toEqual([
      'model',
      'trajectory',
      'video',
      'image',
      'geojson',
    ]);
    for (const entry of entries) {
      expect(publicAssetCatalogEntrySchema.parse(entry)).toEqual(entry);
      expect(entry).not.toHaveProperty('objectName');
      expect(entry).not.toHaveProperty('sourceRelativePath');
    }
  });

  it('validates injected manifest entries before exposing them', () => {
    expect(() =>
      createService([
        modelEntry({ fingerprint: 'sha256:not-a-fingerprint' as `sha256:${string}` }),
      ]),
    ).toThrow();
  });

  it('creates a schema-valid five minute signed access result', async () => {
    const { service, minio } = createService();

    await expect(service.createAccess('model:jf17')).resolves.toEqual({
      assetId: 'model:jf17',
      url: 'https://minio.test/signed',
      fingerprint,
      mediaType: 'model/gltf-binary',
      size: 1_466_636,
      model: {
        scale: 1,
        rotationOffsetDeg: [0, 0, 90],
        altitudeOffsetM: 0,
        entityTypes: ['aircraft'],
      },
      expiresAt: '2026-07-15T00:05:00.000Z',
    });
    expect(minio.presignRead).toHaveBeenCalledWith('demo/models/JF-17.glb', 300);
  });

  it.each([
    ['unknown', 'model:missing', [modelEntry()]],
    ['unavailable', 'model:jf17', [modelEntry({ availability: 'missing' })]],
  ])('rejects %s assets before signing', async (_case, assetId, entries) => {
    const { service, minio } = createService(entries as AssetManifestEntry[]);

    await expect(service.createAccess(assetId)).rejects.toBeInstanceOf(NotFoundException);
    expect(minio.presignRead).not.toHaveBeenCalled();
  });
});
