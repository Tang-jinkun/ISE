import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
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
  assert.equal(await readFile(file, 'utf8'), source);
});

test('exports validateAssetSeedFile from the Node-only package entrypoint', async () => {
  const contracts = await import('@ise/runtime-contracts/node');
  assert.equal(contracts.validateAssetSeedFile, validateAssetSeedFile);
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

test('CLI rejects a junction that escapes INIT_CWD', async () => {
  const invokingDirectory = await mkdtemp(path.join(tmpdir(), 'ise-cli-junction-root-'));
  const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'ise-cli-junction-outside-'));
  const outsideManifest = path.join(outsideDirectory, 'asset-seed.json');
  const fixture = new URL('./fixtures/asset-seed.valid.json', import.meta.url);
  await writeFile(outsideManifest, await readFile(fixture, 'utf8'));

  const junction = path.join(invokingDirectory, 'linked-assets');
  await symlink(outsideDirectory, junction, 'junction');

  const tsxCli = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
  const assetSeedCli = fileURLToPath(new URL('../src/validateAssetSeedCli.ts', import.meta.url));
  await assert.rejects(
    execFileAsync(process.execPath, [tsxCli, assetSeedCli, path.join(junction, 'asset-seed.json')], {
      env: { ...process.env, INIT_CWD: invokingDirectory }
    }),
    (error: unknown) => {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      assert.match(stderr, /below the invoking working directory/i);
      return true;
    }
  );
});
