import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedAssetAccess } from '@ise/runtime-contracts';
import * as THREE from 'three';
import { ResourceManager } from '../ResourceManager';
import { assertGlbHeader } from '../glb';

type ModelAccess = Extract<ResolvedAssetAccess, { mediaType: 'model/gltf-binary' }>;

const NativeURL = globalThis.URL;

const modelAccess = (overrides: Record<string, unknown> = {}): ResolvedAssetAccess => ({
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortError(message: string) {
  return new DOMException(message, 'AbortError');
}

describe('ResourceManager', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(glbBytes())));
    class RuntimeURL extends NativeURL {}
    Object.defineProperties(RuntimeURL, {
      createObjectURL: { value: vi.fn(() => 'blob:model') },
      revokeObjectURL: { value: vi.fn() },
    });
    vi.stubGlobal('URL', RuntimeURL);
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

  it('coalesces concurrent acquisition and reserves one reference per caller', async () => {
    const accessGate = deferred<ResolvedAssetAccess>();
    const resolveAsset = vi.fn(() => accessGate.promise);
    const manager = new ResourceManager({ resolveAsset, now: () => 0 });

    const firstPending = manager.acquire('model:rafale', 'model');
    const secondPending = manager.acquire('model:rafale', 'model');
    accessGate.resolve(modelAccess());
    const [first, second] = await Promise.all([firstPending, secondPending]);

    expect(first).toBe(second);
    expect(resolveAsset).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    manager.release('model:rafale');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    manager.release('model:rafale');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('lets a joiner survive when the first in-flight caller aborts', async () => {
    const responseGate = deferred<Response>();
    vi.mocked(fetch).mockImplementation(() => responseGate.promise);
    const manager = new ResourceManager({
      resolveAsset: async () => modelAccess(),
      now: () => 0,
    });
    const firstController = new AbortController();
    const joinerController = new AbortController();
    const firstRemove = vi.spyOn(firstController.signal, 'removeEventListener');
    const joinerRemove = vi.spyOn(joinerController.signal, 'removeEventListener');
    const first = manager.acquire('model:rafale', 'model', firstController.signal);
    const joiner = manager.acquire('model:rafale', 'model', joinerController.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const internalSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;

    firstController.abort(abortError('first cancelled'));
    responseGate.resolve(new Response(glbBytes()));
    const [firstResult, joinerResult] = await Promise.allSettled([first, joiner]);

    expect(firstResult).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } });
    expect(joinerResult.status).toBe('fulfilled');
    expect(internalSignal?.aborted).toBe(false);
    expect(firstRemove).toHaveBeenCalled();
    expect(joinerRemove).toHaveBeenCalled();
    manager.release('model:rafale');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('lets the first caller survive when an in-flight joiner aborts', async () => {
    const responseGate = deferred<Response>();
    vi.mocked(fetch).mockImplementation(() => responseGate.promise);
    const manager = new ResourceManager({
      resolveAsset: async () => modelAccess(),
      now: () => 0,
    });
    const firstController = new AbortController();
    const joinerController = new AbortController();
    const firstRemove = vi.spyOn(firstController.signal, 'removeEventListener');
    const joinerRemove = vi.spyOn(joinerController.signal, 'removeEventListener');
    const first = manager.acquire('model:rafale', 'model', firstController.signal);
    const joiner = manager.acquire('model:rafale', 'model', joinerController.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const internalSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;

    joinerController.abort(abortError('joiner cancelled'));
    responseGate.resolve(new Response(glbBytes()));
    const [firstResult, joinerResult] = await Promise.allSettled([first, joiner]);

    expect(firstResult.status).toBe('fulfilled');
    expect(joinerResult).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } });
    expect(internalSignal?.aborted).toBe(false);
    expect(firstRemove).toHaveBeenCalled();
    expect(joinerRemove).toHaveBeenCalled();
    manager.release('model:rafale');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('aborts shared work only after every in-flight waiter cancels', async () => {
    const responseGate = deferred<Response>();
    vi.mocked(fetch).mockImplementation(() => responseGate.promise);
    const manager = new ResourceManager({
      resolveAsset: async () => modelAccess(),
      now: () => 0,
    });
    const firstController = new AbortController();
    const joinerController = new AbortController();
    const first = manager.acquire('model:rafale', 'model', firstController.signal);
    const joiner = manager.acquire('model:rafale', 'model', joinerController.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const internalSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;

    firstController.abort(abortError('first cancelled'));
    const abortedAfterFirst = internalSignal?.aborted;
    joinerController.abort(abortError('joiner cancelled'));
    const abortedAfterJoiner = internalSignal?.aborted;
    responseGate.resolve(new Response(glbBytes()));
    const results = await Promise.allSettled([first, joiner]);

    expect(abortedAfterFirst).toBe(false);
    expect(abortedAfterJoiner).toBe(true);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    await vi.waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(
        vi.mocked(URL.createObjectURL).mock.calls.length,
      ),
    );
  });

  it('memoizes one GLTF template promise for aliases with the same fingerprint', async () => {
    const gltf = { scene: new THREE.Group() };
    const loadAsync = vi.fn(async () => gltf as never);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => ({
        arrayBuffer: async () => glbBytes().buffer,
        text: async () => '',
      }) as Blob,
    } as Response);
    const resolveAsset = vi.fn(async (assetId: string) =>
      modelAccess({ assetId, url: `https://signed/${assetId}` }),
    );
    const manager = new ResourceManager({
      resolveAsset,
      now: () => 0,
      gltfLoader: { loadAsync },
    });
    const first = await manager.acquire('model:rafale', 'model');
    const alias = await manager.acquire('model:rafale-alias', 'model');

    const [firstTemplate, aliasTemplate] = await Promise.all([
      first.readGltf(),
      alias.readGltf(),
    ]);

    expect(firstTemplate).toBe(aliasTemplate);
    expect(loadAsync).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('clears a failed in-flight acquisition so a later retry owns one URL', async () => {
    const resolveAsset = vi.fn(async () => modelAccess());
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 500 }));
    const manager = new ResourceManager({ resolveAsset, now: () => 0 });

    const failures = await Promise.allSettled([
      manager.acquire('model:rafale', 'model'),
      manager.acquire('model:rafale', 'model'),
    ]);
    expect(failures.every((result) => result.status === 'rejected')).toBe(true);
    expect(resolveAsset).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.mocked(fetch).mockResolvedValue(new Response(glbBytes()));
    await manager.acquire('model:rafale', 'model');
    expect(resolveAsset).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    manager.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('cancels a released in-flight acquisition without leaking an owned URL', async () => {
    const responseGate = deferred<Response>();
    vi.mocked(fetch).mockImplementation(() => responseGate.promise);
    const manager = new ResourceManager({
      resolveAsset: async () => modelAccess(),
      now: () => 0,
    });
    const pending = manager.acquire('model:rafale', 'model');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    manager.release('model:rafale');
    responseGate.resolve(new Response(glbBytes()));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(
      vi.mocked(URL.createObjectURL).mock.calls.length,
    );
  });

  it('aborts pending work and revokes completed URLs exactly once on dispose', async () => {
    const responseGate = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => responseGate.promise);
    const manager = new ResourceManager({
      resolveAsset: async () => modelAccess(),
      now: () => 0,
    });
    const firstController = new AbortController();
    const joinerController = new AbortController();
    const firstRemove = vi.spyOn(firstController.signal, 'removeEventListener');
    const joinerRemove = vi.spyOn(joinerController.signal, 'removeEventListener');
    const pending = manager.acquire('model:rafale', 'model', firstController.signal);
    const joiner = manager.acquire('model:rafale', 'model', joinerController.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const fetchSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;

    manager.dispose();
    expect(fetchSignal?.aborted).toBe(true);
    responseGate.resolve(new Response(glbBytes()));
    await expect(pending).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
    await expect(joiner).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
    expect(firstRemove).toHaveBeenCalled();
    expect(joinerRemove).toHaveBeenCalled();

    vi.mocked(fetch).mockResolvedValue(new Response(glbBytes()));
    const secondManager = new ResourceManager({
      resolveAsset: async () => modelAccess(),
      now: () => 0,
    });
    await secondManager.acquire('model:rafale', 'model');
    secondManager.dispose();
    secondManager.dispose();
    secondManager.release('model:rafale');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('rejects when dispose releases a fulfilled entry before waiter delivery', async () => {
    const manager = new ResourceManager({
      resolveAsset: async () => modelAccess(),
      now: () => 0,
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pendingEntries = (manager as unknown as {
      pending: Map<string, unknown>;
    }).pending;
    const deletePending = pendingEntries.delete.bind(pendingEntries);
    vi.spyOn(pendingEntries, 'delete').mockImplementation((key) => {
      const deleted = deletePending(key);
      manager.dispose();
      return deleted;
    });

    const acquisition = manager.acquire('model:rafale', 'model', controller.signal);

    await expect(acquisition).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
    expect(removeListener).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['fingerprint', { fingerprint: 'sha256:not-valid' }],
    ['fractional size', { size: 1.5 }],
    ['expiresAt', { expiresAt: 'tomorrow' }],
    [
      'entityTypes',
      {
        model: {
          scale: 1,
          rotationOffsetDeg: [0, 0, 90],
          altitudeOffsetM: 15,
          entityTypes: ['location'],
        },
      },
    ],
  ])('wraps invalid shared %s schema data as metadata errors', async (_label, overrides) => {
    const manager = new ResourceManager({
      resolveAsset: async () => modelAccess(overrides),
      now: () => 0,
    });
    await expect(manager.acquire('model:rafale', 'model')).rejects.toMatchObject({
      code: 'ASSET_METADATA_INVALID',
    });
  });
});

it('accepts only GLB v2 with an exact declared length', () => {
  expect(() => assertGlbHeader(glbBytes().buffer)).not.toThrow();
  const invalid = glbBytes();
  new DataView(invalid.buffer).setUint32(8, 99, true);
  expect(() => assertGlbHeader(invalid.buffer)).toThrowError(/declared length/i);
});
