import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { assetSeedManifestSchema, prepareAssetForUpload } from '@ise/runtime-contracts';
import { MinioService } from '@/minio/minio.service';

export async function seedAssets(options: {
  manifestPath: string;
  sourceDir: string;
  upload(objectName: string, bytes: Buffer, mediaType: string): Promise<void>;
}) {
  const manifest = assetSeedManifestSchema.parse(
    JSON.parse(await readFile(options.manifestPath, 'utf8')),
  );

  for (const entry of manifest.assets) {
    if (entry.availability !== 'available') {
      if (entry.criticality === 'required') {
        throw new Error(`Required asset is ${entry.availability}: ${entry.assetId}`);
      }
      continue;
    }

    const source = await readFile(resolve(options.sourceDir, entry.sourceRelativePath));
    const prepared = await prepareAssetForUpload(entry, source);
    await options.upload(entry.objectName, Buffer.from(prepared), entry.mediaType);
  }
}

export async function main() {
  const manifestPath = process.env.ASSET_MANIFEST_PATH;
  const sourceDir = process.env.ASSET_SOURCE_DIR;
  if (!manifestPath || !sourceDir) {
    throw new Error('ASSET_MANIFEST_PATH and ASSET_SOURCE_DIR are required');
  }

  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const minio = app.get(MinioService);
    await seedAssets({
      manifestPath,
      sourceDir,
      upload: (objectName, bytes, mediaType) => minio.putObject(objectName, bytes, mediaType),
    });
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
