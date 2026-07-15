import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateAssetSeedFile } from './validateAssetSeed.js';

function assertPathBelow(root: string, candidate: string) {
  const relativePath = path.relative(root, candidate);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Manifest path must be below the invoking working directory');
  }
}

const argument = process.argv[2];
if (!argument) {
  console.error('Usage: npm run assets:validate -- <manifest-path>');
  process.exitCode = 2;
} else {
  const invokingDirectory = path.resolve(process.env.INIT_CWD ?? process.cwd());
  const absolutePath = path.resolve(invokingDirectory, argument);
  try {
    assertPathBelow(invokingDirectory, absolutePath);
    const [realInvokingDirectory, realManifestPath] = await Promise.all([
      realpath(invokingDirectory),
      realpath(absolutePath)
    ]);
    assertPathBelow(realInvokingDirectory, realManifestPath);
    const manifest = await validateAssetSeedFile(realManifestPath);
    console.log(`Validated ${manifest.assets.length} assets from ${absolutePath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
