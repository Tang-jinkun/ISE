import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedAssetAccess } from '@ise/runtime-contracts';
import { ResourceManager } from '../ResourceManager';
import { assertGlbHeader } from '../glb';

type ModelAccess = Extract<ResolvedAssetAccess, { mediaType: 'model/gltf-binary' }>;

const modelAccess = (overrides: Partial<ModelAccess> = {}): ResolvedAssetAccess => ({
  assetId: 'model:rafale',
  url: 'https://signed/model',
  fingerprint: `sha256:${'a'.repeat(64)}`,
  mediaType: 'model/gltf-binary',
  size: 12,
  expiresAt: '2099-01-01T00:00:00.000Z',
  model: {
    scale: 1,
    rotationOffsetDeg: [0, 0, 90],
    altitudeOffsetM: 15,
    entityTypes: ['aircraft'],
  },
  ...overrides,
}) as ResolvedAssetAccess;

function glbBytes(length = 12) {
  const bytes = new Uint8Array(length);
  bytes.set([0x67, 0x6c, 0x54, 0x46]);
  new DataView(bytes.buffer).setUint32(4, 2, true);
  new DataView(bytes.buffer).setUint32(8, length, true);
  return bytes;
}

describe('ResourceManager', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(glbBytes())));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:model'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('resolves and fetches once, reference-counts, and revokes at zero', async () => {
    const resolveAsset = vi.fn(async () => modelAccess());
    const manager = new ResourceManager({ resolveAsset, now: () => 0 });
    const first = await manager.acquire('model:rafale', 'model');
    const second = await manager.acquire('model:rafale', 'model');
    expect(first).toBe(second);
    expect(resolveAsset).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    manager.release('model:rafale');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    manager.release('model:rafale');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:model');
  });

  it('refreshes access expiring within 30 seconds and retries one 403', async () => {
    const resolveAsset = vi
      .fn()
      .mockResolvedValueOnce(modelAccess({ expiresAt: '1970-01-01T00:00:20.000Z' }))
      .mockResolvedValue(modelAccess());
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(new Response(glbBytes()));
    const manager = new ResourceManager({ resolveAsset, now: () => 0 });
    await manager.acquire('model:rafale', 'model');
    expect(resolveAsset).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a model without calibration metadata', async () => {
    const manager = new ResourceManager({
      resolveAsset: async () => modelAccess({ model: undefined }),
      now: () => 0,
    });
    await expect(manager.acquire('model:rafale', 'model')).rejects.toMatchObject({
      code: 'ASSET_METADATA_INVALID',
    });
  });

  it('passes the caller abort signal to resolver and fetch', async () => {
    const resolveAsset = vi.fn(
      (_id: string, signal?: AbortSignal) =>
        new Promise<ResolvedAssetAccess>((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason)),
        ),
    );
    const manager = new ResourceManager({ resolveAsset, now: () => 0 });
    const controller = new AbortController();
    const pending = manager.acquire('model:rafale', 'model', controller.signal);
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

it('accepts only GLB v2 with an exact declared length', () => {
  expect(() => assertGlbHeader(glbBytes().buffer)).not.toThrow();
  const invalid = glbBytes();
  new DataView(invalid.buffer).setUint32(8, 99, true);
  expect(() => assertGlbHeader(invalid.buffer)).toThrowError(/declared length/i);
});
