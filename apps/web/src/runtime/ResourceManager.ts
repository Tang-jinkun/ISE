import type { ResolvedAssetAccess } from '@ise/runtime-contracts';
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
  role: AssetRole;
  refCount: number;
  loaded: LoadedAsset;
  getGltf(): Promise<GLTF> | undefined;
}

const EXPIRY_WINDOW_MS = 30_000;

export class ResourceManager {
  private readonly entries = new Map<string, CacheEntry>();
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
    const cached = this.entries.get(assetId);
    if (cached) {
      if (cached.role !== role) {
        throw new SceneRuntimeError(
          'ASSET_METADATA_INVALID',
          `Asset ${assetId} is already loaded as ${cached.role}, not ${role}`,
          assetId,
        );
      }
      cached.refCount += 1;
      return cached.loaded;
    }

    const initialAccess = await this.resolveFresh(assetId, signal);
    this.assertMetadata(initialAccess, role, assetId);
    const { access, blob } = await this.fetchBlobWithOneRefresh(
      initialAccess,
      assetId,
      role,
      signal,
    );
    this.assertUsable();

    const objectUrl = URL.createObjectURL(blob);
    let jsonPromise: Promise<unknown> | undefined;
    let gltfPromise: Promise<GLTF> | undefined;
    const loaded: LoadedAsset = {
      access,
      objectUrl,
      blob,
      readJson: () => (jsonPromise ??= blob.text().then((text) => JSON.parse(text))),
      readGltf: () =>
        (gltfPromise ??= blob.arrayBuffer().then((buffer) => {
          assertGlbHeader(buffer);
          return this.gltfLoader.loadAsync(objectUrl);
        })),
    };
    this.entries.set(assetId, {
      role,
      refCount: 1,
      loaded,
      getGltf: () => gltfPromise,
    });
    return loaded;
  }

  release(assetId: string) {
    const entry = this.entries.get(assetId);
    if (!entry || --entry.refCount > 0) {
      return;
    }
    entry
      .getGltf()
      ?.then((gltf) => disposeObject3D(gltf.scene))
      .catch(() => undefined);
    URL.revokeObjectURL(entry.loaded.objectUrl);
    this.entries.delete(assetId);
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const [assetId, entry] of this.entries) {
      entry
        .getGltf()
        ?.then((gltf) => disposeObject3D(gltf.scene))
        .catch(() => undefined);
      URL.revokeObjectURL(entry.loaded.objectUrl);
      this.entries.delete(assetId);
    }
  }

  private async resolveFresh(assetId: string, signal?: AbortSignal) {
    let access = await this.resolveAsset(assetId, signal);
    if (Date.parse(access.expiresAt) <= this.now() + EXPIRY_WINDOW_MS) {
      access = await this.resolveAsset(assetId, signal);
    }
    const expiresAtMs = Date.parse(access.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= this.now()) {
      throw new SceneRuntimeError(
        'ASSET_ACCESS_EXPIRED',
        `Asset access is expired: ${assetId}`,
        assetId,
      );
    }
    return access;
  }

  private async fetchBlobWithOneRefresh(
    initialAccess: ResolvedAssetAccess,
    assetId: string,
    role: AssetRole,
    signal?: AbortSignal,
  ) {
    let access = initialAccess;
    let response = await this.fetchAccess(access, signal);
    if (response.status === 401 || response.status === 403) {
      const refreshed = await this.resolveFresh(assetId, signal);
      this.assertMetadata(refreshed, role, assetId);
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

  private async fetchAccess(access: ResolvedAssetAccess, signal?: AbortSignal) {
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

  private assertMetadata(
    access: ResolvedAssetAccess,
    role: AssetRole,
    requestedAssetId: string,
  ) {
    if (
      access.assetId !== requestedAssetId ||
      !access.fingerprint ||
      !Number.isFinite(access.size) ||
      access.size < 0
    ) {
      this.invalidMetadata(requestedAssetId, role);
    }

    switch (role) {
      case 'model': {
        if (access.mediaType !== 'model/gltf-binary') {
          this.invalidMetadata(requestedAssetId, role);
        }
        const metadata = access.model;
        if (
          !metadata ||
          !Number.isFinite(metadata.scale) ||
          metadata.scale <= 0 ||
          !Number.isFinite(metadata.altitudeOffsetM) ||
          metadata.rotationOffsetDeg.length !== 3 ||
          !metadata.rotationOffsetDeg.every(Number.isFinite) ||
          metadata.entityTypes.length === 0
        ) {
          this.invalidMetadata(requestedAssetId, role);
        }
        break;
      }
      case 'trajectory': {
        if (access.mediaType !== 'application/vnd.ise.trajectory+json') {
          this.invalidMetadata(requestedAssetId, role);
        }
        const metadata = access.trajectory;
        if (
          !metadata ||
          metadata.format !== 'ise-trajectory/v1' ||
          metadata.timeUnit !== 'ms' ||
          metadata.coordinateOrder !== 'lng-lat-alt' ||
          metadata.monotonic !== true ||
          !Number.isFinite(metadata.startTimeMs) ||
          !Number.isFinite(metadata.endTimeMs) ||
          metadata.endTimeMs < metadata.startTimeMs
        ) {
          this.invalidMetadata(requestedAssetId, role);
        }
        break;
      }
      case 'video': {
        if (access.mediaType !== 'video/mp4') {
          this.invalidMetadata(requestedAssetId, role);
        }
        if (
          !Number.isFinite(access.video.durationMs) ||
          access.video.durationMs <= 0 ||
          !access.video.codec
        ) {
          this.invalidMetadata(requestedAssetId, role);
        }
        break;
      }
      case 'image': {
        if (access.mediaType !== 'image/png' && access.mediaType !== 'image/jpeg') {
          this.invalidMetadata(requestedAssetId, role);
        }
        if (
          !Number.isFinite(access.image.width) ||
          access.image.width <= 0 ||
          !Number.isFinite(access.image.height) ||
          access.image.height <= 0
        ) {
          this.invalidMetadata(requestedAssetId, role);
        }
        break;
      }
      case 'geojson':
        if (access.mediaType !== 'application/geo+json') {
          this.invalidMetadata(requestedAssetId, role);
        }
        break;
    }
  }

  private assertSameContent(
    initial: ResolvedAssetAccess,
    refreshed: ResolvedAssetAccess,
  ) {
    if (
      refreshed.assetId !== initial.assetId ||
      refreshed.fingerprint !== initial.fingerprint ||
      refreshed.size !== initial.size ||
      this.contentSignature(refreshed) !== this.contentSignature(initial)
    ) {
      throw new SceneRuntimeError(
        'ASSET_METADATA_INVALID',
        `Refreshed access changed asset content: ${initial.assetId}`,
        initial.assetId,
      );
    }
  }

  private contentSignature(access: ResolvedAssetAccess) {
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

  private invalidMetadata(assetId: string, role: AssetRole): never {
    throw new SceneRuntimeError(
      'ASSET_METADATA_INVALID',
      `Asset metadata is invalid for ${role}: ${assetId}`,
      assetId,
    );
  }

  private assertUsable() {
    if (this.disposed) {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Resource manager is disposed');
    }
  }
}
