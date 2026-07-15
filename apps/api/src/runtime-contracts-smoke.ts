import { assetSeedManifestSchema } from '@ise/runtime-contracts';
import { validateAssetSeedFile } from '@ise/runtime-contracts/node';

if (
  typeof assetSeedManifestSchema.safeParse !== 'function' ||
  typeof validateAssetSeedFile !== 'function'
) {
  throw new Error('Runtime contracts did not load from the production bundle');
}

process.stdout.write('runtime-contracts:ok\n');
