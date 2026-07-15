import {
  resolvedAssetAccessSchema,
  type ResolvedAssetAccess,
} from '@ise/runtime-contracts';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SceneRuntimeError } from './errors';
import { assertGlbHeader, disposeObject3D } from './glb';
import type { SceneRuntimeOptions } from './types';

export type AssetRole = 'model' | 'trajectory' | 'video' | 'image' | 'geojson';

export interface LoadedAsset {
  access: ResolvedAssetAccess;
  objectUrl: string;
  blob: Blob;
  readJson(): Promise<unknown>;
  readGltf(): Promise<GLTF>;
}

interface ResourceManagerOptions {
  resolveAsset: SceneRuntimeOptions['resolveAsset'];
  now?: () => number;
  gltfLoader?: Pick<GLTFLoader, 'loadAsync'>;
}

interface CacheEntry {
  key: string;
  assetId: string;
  role: AssetRole;
  refCount: number;
  loaded: LoadedAsset;
  released: boolean;
}

interface PendingEntry {
  key: string;
  assetId: string;
  role: AssetRole;
  reservationCount: number;
  controller: AbortController;
  waiters: Set<PendingWaiter>;
  cancelled: boolean;
  settled: boolean;
  entry?: CacheEntry;
  promise: Promise<LoadedAsset>;
}

interface PendingWaiter {
  cancel(reason: unknown): void;
}

interface GltfTemplateEntry {
  refCount: number;
  promise?: Promise<GLTF>;
}

const EXPIRY_WINDOW_MS = 30_000;

export class ResourceManager {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, PendingEntry>();
  private readonly gltfTemplates = new Map<string, GltfTemplateEntry>();
  private readonly resolveAsset: SceneRuntimeOptions['resolveAsset'];
  private readonly now: () => number;
  private readonly gltfLoader: Pick<GLTFLoader, 'loadAsync'>;
  private disposed = false;

  constructor(options: ResourceManagerOptions) {
    this.resolveAsset = options.resolveAsset;
    this.now = options.now ?? Date.now;
    this.gltfLoader = options.gltfLoader ?? new GLTFLoader();
  }

  async acquire(assetId: string, role: AssetRole, signal?: AbortSignal): Promise<LoadedAsset> {
    this.assertUsable();
    if (signal?.aborted) {
      throw signalAbortReason(signal);
    }
    const key = cacheKey(assetId, role);
    const cached = this.entries.get(key);
    if (cached) {
      cached.refCount += 1;
      return cached.loaded;
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      return this.joinPending(inFlight, signal);
    }

    const controller = new AbortController();
    const pending: PendingEntry = {
      key,
      assetId,
      role,
      reservationCount: 0,
      controller,
      waiters: new Set(),
      cancelled: false,
      settled: false,
      promise: Promise.resolve(undefined as unknown as LoadedAsset),
    };
    this.pending.set(key, pending);

    pending.promise = this.loadAsset(assetId, role, controller.signal)
      .then((entry) => {
        if (this.disposed) {
          this.disposeEntry(entry);
          throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Resource manager is disposed');
        }
        if (pending.cancelled || this.pending.get(key) !== pending) {
          this.disposeEntry(entry);
          throw abortError(`Asset acquisition released: ${assetId}`);
        }
        pending.settled = true;
        entry.refCount = pending.reservationCount;
        pending.entry = entry;
        this.entries.set(key, entry);
        return entry.loaded;
      })
      .catch((error) => {
        pending.settled = true;
        if (this.disposed) {
          if (error instanceof SceneRuntimeError && error.code === 'RUNTIME_DISPOSED') {
            throw error;
          }
          throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Resource manager is disposed', undefined, {
            cause: error,
          });
        }
        throw error;
      })
      .finally(() => {
        if (this.pending.get(key) === pending) {
          this.pending.delete(key);
        }
      });
    void pending.promise.catch(() => undefined);

    return this.joinPending(pending, signal);
  }

  release(assetId: string) {
    for (const pending of this.pending.values()) {
      if (pending.assetId !== assetId) {
        continue;
      }
      pending.waiters.values().next().value?.cancel(
        abortError(`Asset acquisition released: ${assetId}`),
      );
      return;
    }

    for (const entry of this.entries.values()) {
      if (entry.assetId !== assetId) {
        continue;
      }
      entry.refCount -= 1;
      if (entry.refCount <= 0) {
        this.entries.delete(entry.key);
        this.disposeEntry(entry);
      }
      return;
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const pending of [...this.pending.values()]) {
      pending.cancelled = true;
      this.pending.delete(pending.key);
      const disposedError = new SceneRuntimeError('RUNTIME_DISPOSED', 'Resource manager is disposed');
      for (const waiter of [...pending.waiters]) {
        waiter.cancel(disposedError);
      }
      pending.controller.abort(abortError('Resource manager disposed'));
    }
    for (const entry of [...this.entries.values()]) {
      this.entries.delete(entry.key);
      this.disposeEntry(entry);
    }
  }

  private joinPending(pending: PendingEntry, signal?: AbortSignal) {
    pending.reservationCount += 1;
    return new Promise<LoadedAsset>((resolve, reject) => {
      let waiting = true;
      let waiter: PendingWaiter;
      const abort = () => waiter.cancel(signal ? signalAbortReason(signal) : abortError('Cancelled'));
      const detach = () => signal?.removeEventListener('abort', abort);
      const finish = (transferReservation: boolean) => {
        if (!waiting) {
          return false;
        }
        waiting = false;
        detach();
        pending.waiters.delete(waiter);
        if (!transferReservation) {
          this.cancelReservation(pending);
        }
        return true;
      };
      waiter = {
        cancel: (reason) => {
          if (finish(false)) {
            reject(reason);
          }
        },
      };
      pending.waiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        waiter.cancel(signalAbortReason(signal));
        return;
      }
      pending.promise.then(
        (loaded) => {
          if (finish(true)) {
            resolve(loaded);
          }
        },
        (error) => {
          if (finish(false)) {
            reject(error);
          }
        },
      );
    });
  }

  private cancelReservation(pending: PendingEntry) {
    pending.reservationCount = Math.max(0, pending.reservationCount - 1);
    if (pending.entry) {
      pending.entry.refCount -= 1;
      if (pending.entry.refCount <= 0) {
        this.entries.delete(pending.entry.key);
        this.disposeEntry(pending.entry);
      }
      return;
    }
    if (pending.reservationCount === 0 && !pending.settled && !pending.cancelled) {
      pending.cancelled = true;
      if (this.pending.get(pending.key) === pending) {
        this.pending.delete(pending.key);
      }
      pending.controller.abort(abortError(`All asset waiters cancelled: ${pending.assetId}`));
    }
  }

  private async loadAsset(assetId: string, role: AssetRole, signal: AbortSignal) {
    const initialAccess = await this.resolveFresh(assetId, role, signal);
    const { access, blob } = await this.fetchBlobWithOneRefresh(
      initialAccess,
      assetId,
      role,
      signal,
    );
    this.assertUsable();

    const objectUrl = URL.createObjectURL(blob);
    let jsonPromise: Promise<unknown> | undefined;
    const loaded: LoadedAsset = {
      access,
      objectUrl,
      blob,
      readJson: () => (jsonPromise ??= blob.text().then((text) => JSON.parse(text))),
      readGltf: () => {
        if (access.mediaType !== 'model/gltf-binary') {
          return Promise.reject(
            new SceneRuntimeError(
              'ASSET_METADATA_INVALID',
              `Asset is not a GLB model: ${access.assetId}`,
              access.assetId,
            ),
          );
        }
        return this.readGltfTemplate(access.fingerprint, blob, objectUrl);
      },
    };
    const entry: CacheEntry = {
      key: cacheKey(assetId, role),
      assetId,
      role,
      refCount: 0,
      loaded,
      released: false,
    };
    if (role === 'model') {
      this.retainGltfFingerprint(access.fingerprint);
    }
    return entry;
  }

  private async resolveFresh(assetId: string, role: AssetRole, signal: AbortSignal) {
    let access = this.parseAccess(await this.resolveAsset(assetId, signal), assetId, role);
    if (Date.parse(access.expiresAt) <= this.now() + EXPIRY_WINDOW_MS) {
      access = this.parseAccess(await this.resolveAsset(assetId, signal), assetId, role);
    }
    if (Date.parse(access.expiresAt) <= this.now()) {
      throw new SceneRuntimeError(
        'ASSET_ACCESS_EXPIRED',
        `Asset access is expired: ${assetId}`,
        assetId,
      );
    }
    return access;
  }

  private parseAccess(value: unknown, assetId: string, role: AssetRole) {
    let access: ResolvedAssetAccess;
    try {
      access = resolvedAssetAccessSchema.parse(value);
    } catch (error) {
      throw new SceneRuntimeError(
        'ASSET_METADATA_INVALID',
        `Resolved asset access is invalid: ${assetId}`,
        assetId,
        { cause: error },
      );
    }
    if (access.assetId !== assetId || !matchesRole(access, role)) {
      throw new SceneRuntimeError(
        'ASSET_METADATA_INVALID',
        `Asset metadata is invalid for ${role}: ${assetId}`,
        assetId,
      );
    }
    return access;
  }

  private async fetchBlobWithOneRefresh(
    initialAccess: ResolvedAssetAccess,
    assetId: string,
    role: AssetRole,
    signal: AbortSignal,
  ) {
    let access = initialAccess;
    let response = await this.fetchAccess(access, signal);
    if (response.status === 401 || response.status === 403) {
      const refreshed = await this.resolveFresh(assetId, role, signal);
      this.assertSameContent(initialAccess, refreshed);
      access = refreshed;
      response = await this.fetchAccess(access, signal);
    }
    if (!response.ok) {
      throw new SceneRuntimeError(
        'ASSET_FETCH_FAILED',
        `Asset fetch failed with HTTP ${response.status}: ${assetId}`,
        assetId,
      );
    }
    return { access, blob: await response.blob() };
  }

  private async fetchAccess(access: ResolvedAssetAccess, signal: AbortSignal) {
    try {
      return await fetch(access.url, { signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new SceneRuntimeError(
        'ASSET_FETCH_FAILED',
        `Asset fetch failed: ${access.assetId}`,
        access.assetId,
        { cause: error },
      );
    }
  }

  private assertSameContent(initial: ResolvedAssetAccess, refreshed: ResolvedAssetAccess) {
    if (
      refreshed.assetId !== initial.assetId ||
      refreshed.fingerprint !== initial.fingerprint ||
      refreshed.size !== initial.size ||
      contentSignature(refreshed) !== contentSignature(initial)
    ) {
      throw new SceneRuntimeError(
        'ASSET_METADATA_INVALID',
        `Refreshed access changed asset content: ${initial.assetId}`,
        initial.assetId,
      );
    }
  }

  private retainGltfFingerprint(fingerprint: string) {
    const entry = this.gltfTemplates.get(fingerprint) ?? { refCount: 0 };
    entry.refCount += 1;
    this.gltfTemplates.set(fingerprint, entry);
  }

  private readGltfTemplate(fingerprint: string, blob: Blob, objectUrl: string) {
    const entry = this.gltfTemplates.get(fingerprint);
    if (!entry) {
      return Promise.reject(
        new SceneRuntimeError('RUNTIME_NOT_LOADED', `Model asset has been released: ${fingerprint}`),
      );
    }
    if (!entry.promise) {
      const load = blob.arrayBuffer().then((buffer) => {
        assertGlbHeader(buffer);
        return this.gltfLoader.loadAsync(objectUrl);
      });
      let tracked: Promise<GLTF>;
      tracked = load.catch((error) => {
        if (entry.promise === tracked) {
          entry.promise = undefined;
        }
        throw error;
      });
      entry.promise = tracked;
    }
    return entry.promise;
  }

  private releaseGltfFingerprint(fingerprint: string) {
    const entry = this.gltfTemplates.get(fingerprint);
    if (!entry) {
      return;
    }
    entry.refCount -= 1;
    if (entry.refCount > 0) {
      return;
    }
    this.gltfTemplates.delete(fingerprint);
    entry.promise?.then((gltf) => disposeObject3D(gltf.scene)).catch(() => undefined);
  }

  private disposeEntry(entry: CacheEntry) {
    if (entry.released) {
      return;
    }
    entry.released = true;
    if (entry.role === 'model') {
      this.releaseGltfFingerprint(entry.loaded.access.fingerprint);
    }
    URL.revokeObjectURL(entry.loaded.objectUrl);
  }

  private assertUsable() {
    if (this.disposed) {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Resource manager is disposed');
    }
  }
}

function cacheKey(assetId: string, role: AssetRole) {
  return `${role}\u0000${assetId}`;
}

function matchesRole(access: ResolvedAssetAccess, role: AssetRole) {
  switch (role) {
    case 'model':
      return access.mediaType === 'model/gltf-binary';
    case 'trajectory':
      return access.mediaType === 'application/vnd.ise.trajectory+json';
    case 'video':
      return access.mediaType === 'video/mp4';
    case 'image':
      return access.mediaType === 'image/png' || access.mediaType === 'image/jpeg';
    case 'geojson':
      return access.mediaType === 'application/geo+json';
  }
}

function contentSignature(access: ResolvedAssetAccess) {
  switch (access.mediaType) {
    case 'model/gltf-binary':
      return JSON.stringify({ mediaType: access.mediaType, metadata: access.model });
    case 'application/vnd.ise.trajectory+json':
      return JSON.stringify({ mediaType: access.mediaType, metadata: access.trajectory });
    case 'video/mp4':
      return JSON.stringify({ mediaType: access.mediaType, metadata: access.video });
    case 'image/png':
    case 'image/jpeg':
      return JSON.stringify({ mediaType: access.mediaType, metadata: access.image });
    case 'application/geo+json':
      return access.mediaType;
  }
}

function abortError(message: string) {
  return new DOMException(message, 'AbortError');
}

function signalAbortReason(signal: AbortSignal) {
  return signal.reason ?? abortError('Asset acquisition aborted');
}
