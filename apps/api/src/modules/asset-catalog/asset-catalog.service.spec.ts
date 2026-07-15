import { NotFoundException } from '@nestjs/common';
import type { AssetManifestEntry } from '@ise/runtime-contracts';
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
