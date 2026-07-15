import path from 'node:path';
import { validateAssetSeedFile } from './validateAssetSeed.js';

const argument = process.argv[2];
if (!argument) {
  console.error('Usage: npm run assets:validate -- <manifest-path>');
  process.exitCode = 2;
} else {
  const invokingDirectory = path.resolve(process.env.INIT_CWD ?? process.cwd());
  const absolutePath = path.resolve(invokingDirectory, argument);
  const relativePath = path.relative(invokingDirectory, absolutePath);
  try {
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error('Manifest path must be below the invoking working directory');
    }
    const manifest = await validateAssetSeedFile(absolutePath);
    console.log(`Validated ${manifest.assets.length} assets from ${absolutePath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
