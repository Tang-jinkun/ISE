import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { readFileSync } from 'fs';
import {
  assetSeedManifestSchema,
  resolvedAssetAccessSchema,
  type AssetManifestEntry,
} from '@ise/runtime-contracts';
import { requiredEnv } from '@/config/required-env';
import { MinioService } from '@/minio/minio.service';

export const ASSET_CATALOG_ENTRIES = Symbol('ASSET_CATALOG_ENTRIES');

@Injectable()
export class AssetCatalogService {
  readonly #entries: Map<string, AssetManifestEntry>;

  constructor(
    private readonly minio: MinioService,
    @Optional() @Inject(ASSET_CATALOG_ENTRIES) entries?: AssetManifestEntry[],
  ) {
    const manifest = entries
      ? {
          schemaVersion: 'ise-assets/v1' as const,
          assets: entries,
          nameMappings: [],
        }
      : JSON.parse(readFileSync(requiredEnv('ASSET_MANIFEST_PATH'), 'utf8'));
    const parsed = assetSeedManifestSchema.parse(manifest);
    this.#entries = new Map(parsed.assets.map((entry) => [entry.assetId, entry]));
  }

  listPublic() {
    return [...this.#entries.values()].map(
      ({ objectName: _objectName, sourceRelativePath: _sourceRelativePath, ...entry }) => entry,
    );
  }

  async createAccess(assetId: string) {
    const entry = this.#entries.get(assetId);
    if (!entry || entry.availability !== 'available') {
      throw new NotFoundException('Asset does not exist or is unavailable');
    }

    const expiresSeconds = 300;
    const metadata =
      entry.kind === 'model'
        ? { model: entry.model }
        : entry.kind === 'trajectory'
          ? { trajectory: entry.trajectory }
          : entry.kind === 'video'
            ? { video: entry.video }
            : entry.kind === 'image'
              ? { image: entry.image }
              : {};

    return resolvedAssetAccessSchema.parse({
      assetId,
      url: await this.minio.presignRead(entry.objectName, expiresSeconds),
      fingerprint: entry.fingerprint,
      mediaType: entry.mediaType,
      size: entry.size,
      ...metadata,
      expiresAt: new Date(Date.now() + expiresSeconds * 1000).toISOString(),
    });
  }
}
