import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateAssetSeedFile } from '../src/validateAssetSeed.js';

const execFileAsync = promisify(execFile);

test('reads and validates the checked-in contract fixture', async () => {
  const manifest = await validateAssetSeedFile(
    new URL('./fixtures/asset-seed.valid.json', import.meta.url)
  );
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0]?.assetId, 'geojson:contract-fixture');
});

test('reports a schema error without uploading or rewriting the file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ise-manifest-'));
  const file = path.join(root, 'invalid.json');
  const source = '{"schemaVersion":"ise-assets/v2","assets":[],"nameMappings":[]}\n';
  await writeFile(file, source);
  await assert.rejects(validateAssetSeedFile(file), /ise-assets\/v1|Too small/);
});

test('CLI rejects manifest paths outside INIT_CWD', async () => {
  const invokingDirectory = await mkdtemp(path.join(tmpdir(), 'ise-cli-root-'));
  const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'ise-cli-outside-'));
  const outsideManifest = path.join(outsideDirectory, 'asset-seed.json');
  const fixture = new URL('./fixtures/asset-seed.valid.json', import.meta.url);
  await writeFile(outsideManifest, await readFile(fixture, 'utf8'));

  const tsxCli = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
  const assetSeedCli = fileURLToPath(new URL('../src/validateAssetSeedCli.ts', import.meta.url));
  await assert.rejects(
    execFileAsync(process.execPath, [tsxCli, assetSeedCli, outsideManifest], {
      env: { ...process.env, INIT_CWD: invokingDirectory }
    }),
    (error: unknown) => {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      assert.match(stderr, /below the invoking working directory/i);
      return true;
    }
  );
});
