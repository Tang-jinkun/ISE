import { readFile } from 'node:fs/promises';
import { assetSeedManifestSchema, type AssetSeedManifest } from './assets.js';

export async function validateAssetSeedFile(filePath: string | URL): Promise<AssetSeedManifest> {
  const source = await readFile(filePath, 'utf8');
  return assetSeedManifestSchema.parse(JSON.parse(source));
}
