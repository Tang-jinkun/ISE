import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  auditTarget,
  copyFoundation,
  createChiBiCompatibilitySource,
  isDeniedRelativePath,
  normalizeApiPackage,
  normalizeWebPackage,
  resolveSourceRoots,
  webImportExcludedPrefixes
} from './import-foundation.mjs';

test('denies secrets, generated output, nested repositories, and nested locks', () => {
  for (const candidate of [
    '.git/config',
    '.env',
    '.env.production',
    'dist/index.js',
    'logs/api.log',
    'node_modules/pkg/index.js',
    'src/.cache/value',
    'pnpm-lock.yaml'
  ]) {
    assert.equal(isDeniedRelativePath(candidate), true, candidate);
  }
  assert.equal(isDeniedRelativePath('.env.example'), false);
  assert.equal(isDeniedRelativePath('src/index.ts'), false);
});

test('omits excluded legacy hooks while retaining neighboring source', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ise-hooks-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  await mkdir(path.join(source, 'src', 'hooks'), { recursive: true });
  await mkdir(path.join(source, 'src', 'pages'), { recursive: true });
  await writeFile(path.join(source, 'src', 'hooks', 'scene-player-hooks.ts'), 'legacy\n');
  await writeFile(path.join(source, 'src', 'pages', 'Scene.tsx'), 'export default null;\n');

  const receipt = await copyFoundation({
    sourceRoot: source,
    targetRoot: target,
    entries: ['src'],
    excludedPrefixes: ['src/hooks/scene-player-hooks.ts']
  });

  assert.deepEqual(receipt.map(item => item.target), ['src/pages/Scene.tsx']);
});

test('accepts external absolute source roots and rejects relative roots', () => {
  const web = path.resolve('external', 'web-source');
  const api = path.resolve('external', 'api-source');
  assert.deepEqual(resolveSourceRoots({
    ISE_WEB_SOURCE_ROOT: web,
    ISE_API_SOURCE_ROOT: api
  }), { web, api });
  assert.throws(() => resolveSourceRoots({
    ISE_WEB_SOURCE_ROOT: './relative-web',
    ISE_API_SOURCE_ROOT: api
  }), /ISE_WEB_SOURCE_ROOT must be an absolute path/);
});

test('normalizes API peer-sensitive versions from the source lock', () => {
  const pkg = {
    name: 'source-api',
    scripts: { prepare: 'husky' },
    dependencies: {
      '@nestjs-modules/mailer': '^2.0.2',
      '@nestjs/swagger': '^11.2.4',
      nodemailer: '^7.0.12'
    },
    devDependencies: {
      '@commitlint/cli': '^20.3.1',
      '@commitlint/config-conventional': '^20.3.1',
      husky: '^9.1.7'
    }
  };

  normalizeApiPackage(pkg);

  assert.equal(pkg.name, '@ise/api');
  assert.deepEqual(pkg.dependencies, {
    '@nestjs-modules/mailer': '2.0.2',
    '@nestjs/common': '10.4.22',
    '@nestjs/config': '4.0.2',
    '@nestjs/core': '10.4.22',
    '@nestjs/jwt': '11.0.2',
    '@nestjs/passport': '11.0.5',
    '@nestjs/platform-express': '10.4.22',
    '@nestjs/swagger': '8.1.1',
    '@prisma/adapter-pg': '7.2.0',
    '@prisma/client': '7.2.0',
    nodemailer: '7.0.12'
  });
  assert.equal(pkg.scripts.prepare, undefined);
  assert.deepEqual(pkg.devDependencies, {
    '@nestjs/cli': '10.4.9',
    '@nestjs/schematics': '10.2.3',
    '@nestjs/testing': '10.4.22',
    '@rspack/cli': '1.5.6',
    '@rspack/core': '1.5.6',
    '@types/pg': '^8.15.6',
    prisma: '7.2.0',
    typescript: '5.9.3'
  });
});

test('normalizes Web dependencies for React 19 and removes repository hooks', () => {
  const pkg = {
    name: 'source-web',
    scripts: { prepare: 'husky', commit: 'czg', 'commit:zh': 'czg', 'commit:en': 'czg' },
    config: { commitizen: { path: 'cz-git' } },
    dependencies: {
      axios: '^1.13.2',
      'react-helmet-async': '^2.0.5',
      three: '^0.100.0'
    },
    devDependencies: {
      '@commitlint/cli': '^20.2.0',
      '@commitlint/config-conventional': '^20.2.0',
      commitizen: '^4.3.1',
      'cz-git': '^1.12.0',
      czg: '^1.12.0',
      husky: '^9.1.7'
    }
  };

  normalizeWebPackage(pkg);

  assert.equal(pkg.name, '@ise/web');
  assert.equal(pkg.dependencies.axios, '1.13.2');
  assert.equal(pkg.dependencies['react-helmet-async'], undefined);
  assert.equal(pkg.dependencies.three, '0.185.1');
  assert.equal(pkg.scripts.prepare, undefined);
  assert.equal(pkg.scripts.commit, undefined);
  assert.equal(pkg.config, undefined);
  assert.deepEqual(pkg.devDependencies, {
    '@types/three': '0.185.1',
    '@playwright/test': '1.61.1'
  });
});

test('copies only explicit entries and refuses to overwrite a target', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ise-import-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  await mkdir(path.join(source, 'src'), { recursive: true });
  await mkdir(path.join(source, '.git'), { recursive: true });
  await writeFile(path.join(source, 'src', 'index.ts'), 'export const ok = true;\n');
  await writeFile(path.join(source, '.env'), 'SECRET=real\n');
  await writeFile(path.join(source, '.git', 'config'), 'nested git\n');
  await writeFile(path.join(source, 'package.json'), '{"name":"source"}\n');

  const receipt = await copyFoundation({
    sourceRoot: source,
    targetRoot: target,
    entries: ['src', 'package.json'],
    excludedPrefixes: []
  });
  assert.deepEqual(
    receipt.map(item => item.target),
    ['package.json', 'src/index.ts']
  );
  assert.equal(await readFile(path.join(target, 'src', 'index.ts'), 'utf8'), 'export const ok = true;\n');
  await assert.rejects(
    copyFoundation({ sourceRoot: source, targetRoot: target, entries: ['src'], excludedPrefixes: [] }),
    /already exists/
  );
});

test('audit rejects credential fallbacks and prohibited payloads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ise-audit-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'bad.ts'),
    "const secret = process.env.JWT_SECRET || 'embedded';\n"
  );
  await writeFile(path.join(root, 'demo.glb'), 'glTF');
  await writeFile(
    path.join(root, 'src', 'map.ts'),
    "const token = 'pk.eyJ1IjoiZXhhbXBsZSJ9.signature';\n"
  );
  await assert.rejects(auditTarget(root), /credential fallback.*Mapbox token.*raw payload: demo\.glb/s);
});

test('audit rejects large legacy mocks and references to excluded plot runtime', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ise-retained-source-'));
  await mkdir(path.join(root, 'src', 'mock', '313mock'), { recursive: true });
  await mkdir(path.join(root, 'src', 'router'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'mock', '313mock', 'chibi_battle.mock.ts'),
    `export const data = '${'x'.repeat(70 * 1024)}';\n`
  );
  await writeFile(
    path.join(root, 'src', 'router', 'index.tsx'),
    "const route = '/plot'; const asset = '/plot_utils/runtime.js';\n"
  );

  await assert.rejects(
    auditTarget(root),
    /large legacy mock: src\/mock\/313mock\/chibi_battle\.mock\.ts.*legacy plot reference: src\/router\/index\.tsx/s
  );
});

test('audit allows small typed compatibility modules in the legacy mock path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ise-compatible-mock-'));
  const directory = path.join(root, 'src', 'mock', '313mock');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'chibi_battle.mock.ts'),
    "export const CHIBI_BATTLE_DATA = { outline: [] };\n"
  );
  await auditTarget(root);
});

test('audit rejects retained Plot payloads and large legacy scene mocks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ise-excluded-web-payloads-'));
  await mkdir(path.join(root, 'public', 'symbols_icon'), { recursive: true });
  await mkdir(path.join(root, 'public', 'symbols_json'), { recursive: true });
  await mkdir(path.join(root, 'src', 'mock', 'new_model'), { recursive: true });
  await writeFile(path.join(root, 'public', 'GBK.data'), 'legacy plot data\n');
  await writeFile(path.join(root, 'public', 'jmp.data'), 'legacy plot data\n');
  await writeFile(path.join(root, 'public', 'symbols_icon', '1.png'), 'legacy symbol\n');
  await writeFile(path.join(root, 'public', 'symbols_json', '1.json'), '{}\n');
  await writeFile(path.join(root, 'src', 'mock', 'new_model', 'battle.ts'), 'export default {};\n');
  await writeFile(path.join(root, 'src', 'mock', 'Normand_war.ts'), 'export default {};\n');
  await writeFile(
    path.join(root, 'src', 'mock', 'ChiBi_War.ts'),
    `export default '${'x'.repeat(70 * 1024)}';\n`
  );

  await assert.rejects(auditTarget(root), error => {
    for (const expected of [
      'excluded legacy payload: public/GBK.data',
      'excluded legacy payload: public/jmp.data',
      'excluded legacy payload: public/symbols_icon/1.png',
      'excluded legacy payload: public/symbols_json/1.json',
      'large legacy mock: src/mock/ChiBi_War.ts',
      'excluded legacy payload: src/mock/Normand_war.ts',
      'excluded legacy payload: src/mock/new_model/battle.ts'
    ]) {
      assert.match(error.message, new RegExp(expected.replaceAll('.', '\\\.')));
    }
    return true;
  });
});

test('audit allows the small typed ChiBi compatibility module', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ise-chibi-compatibility-'));
  const directory = path.join(root, 'src', 'mock');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'ChiBi_War.ts'),
    "import type { WarData } from './types';\nconst value = {} as WarData;\nexport default value;\n"
  );
  await auditTarget(root);
});

test('Web import excludes unowned Plot assets and legacy scene mocks', () => {
  for (const expected of [
    'public/GBK.data',
    'public/jmp.data',
    'public/symbols_icon',
    'public/symbols_json',
    'src/mock/ChiBi_War.ts',
    'src/mock/Normand_war.ts',
    'src/mock/new_model'
  ]) {
    assert.equal(webImportExcludedPrefixes.includes(expected), true, expected);
  }
});

test('generates an inert typed ChiBi compatibility default export', () => {
  assert.equal(createChiBiCompatibilitySource(), [
    "import type { WarData } from './types';",
    '',
    'const chiBiWar: WarData = {',
    "  war_name: '',",
    "  intro: '',",
    '  spatio_temporal_context: {',
    "    location: '',",
    "    time: '',",
    '    timeline: [],',
    '    spatial_flow: []',
    '  },',
    "  relevance: '',",
    '  outline: []',
    '};',
    '',
    'export default chiBiWar;',
    ''
  ].join('\n'));
});
