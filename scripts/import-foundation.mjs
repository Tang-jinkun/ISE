import { createHash } from 'node:crypto';
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deniedNames = new Set([
  '.git', '.husky', '.idea', '.vscode', '.cache',
  'node_modules', 'dist', 'build', 'coverage', 'logs', 'cache'
]);
const deniedFiles = new Set(['pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json']);
const rawPayloadExtensions = new Set(['.glb', '.mp4']);
export const webLegacyPayloadPrefixes = [
  'public/GBK.data',
  'public/jmp.data',
  'public/symbols_icon',
  'public/symbols_json',
  'src/mock/Normand_war.ts',
  'src/mock/new_model'
];
export const webImportExcludedPrefixes = [
  'public/fonts_threejs',
  'public/plot_utils',
  ...webLegacyPayloadPrefixes,
  'src/mock/OLD',
  'src/mock/313mock',
  'src/mock/scene',
  'src/mock/ChiBi_War.ts',
  'src/pages/Plot',
  'src/hooks/scene-instance-player-hooks.ts',
  'src/hooks/scene-instance-run-hooks.ts',
  'src/hooks/scene-player-hooks.ts'
];

const toPosix = value => value.split(path.sep).join('/');

export function isDeniedRelativePath(relativePath) {
  const normalized = toPosix(relativePath);
  const parts = normalized.split('/');
  const name = parts.at(-1);
  if (name === '.env.example') return false;
  if (parts.some(part => deniedNames.has(part))) return true;
  if (name === '.env' || name?.startsWith('.env.')) return true;
  return deniedFiles.has(name);
}

export function resolveSourceRoots(environment) {
  const values = {
    web: environment.ISE_WEB_SOURCE_ROOT,
    api: environment.ISE_API_SOURCE_ROOT
  };
  for (const [label, value] of Object.entries(values)) {
    const variable = label === 'web' ? 'ISE_WEB_SOURCE_ROOT' : 'ISE_API_SOURCE_ROOT';
    if (!value || !path.isAbsolute(value)) {
      throw new Error(`${variable} must be an absolute path`);
    }
  }
  return values;
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root, current = root) {
  const output = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(root, absolute));
    if (entry.isFile()) output.push(absolute);
  }
  return output;
}

function isExcluded(relativePath, excludedPrefixes) {
  const normalized = toPosix(relativePath);
  return excludedPrefixes.some(prefix =>
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

export async function copyFoundation({ sourceRoot, targetRoot, entries, excludedPrefixes }) {
  if (await exists(targetRoot)) throw new Error(`Target already exists: ${targetRoot}`);
  await mkdir(targetRoot, { recursive: true });
  const receipt = [];
  for (const entry of entries) {
    const sourceEntry = path.join(sourceRoot, entry);
    if (!await exists(sourceEntry)) throw new Error(`Missing allowlisted source: ${sourceEntry}`);
    const sourceStat = await stat(sourceEntry);
    const files = sourceStat.isDirectory() ? await listFiles(sourceRoot, sourceEntry) : [sourceEntry];
    for (const sourceFile of files) {
      const relative = toPosix(path.relative(sourceRoot, sourceFile));
      if (isDeniedRelativePath(relative) || isExcluded(relative, excludedPrefixes)) continue;
      const targetFile = path.join(targetRoot, relative);
      await mkdir(path.dirname(targetFile), { recursive: true });
      await cp(sourceFile, targetFile, { force: false, errorOnExist: true });
      const bytes = await readFile(sourceFile);
      receipt.push({
        source: relative,
        target: relative,
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex')
      });
    }
  }
  return receipt.sort((left, right) => left.target.localeCompare(right.target));
}

export async function auditTarget(root) {
  const violations = [];
  for (const file of await listFiles(root)) {
    const relative = toPosix(path.relative(root, file));
    if (isDeniedRelativePath(relative)) violations.push(`denied path: ${relative}`);
    const extension = path.extname(relative).toLowerCase();
    if (isExcluded(relative, webLegacyPayloadPrefixes)) {
      violations.push(`excluded legacy payload: ${relative}`);
    }
    if (
      (relative.startsWith('src/mock/313mock/') || relative === 'src/mock/ChiBi_War.ts') &&
      (await stat(file)).size > 64 * 1024
    ) {
      violations.push(`large legacy mock: ${relative}`);
    }
    if (rawPayloadExtensions.has(extension)) violations.push(`raw payload: ${relative}`);
    if (extension === '.geojson' && (await stat(file)).size > 64 * 1024) {
      violations.push(`large geographic payload: ${relative}`);
    }
    if (['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extension)) {
      const text = await readFile(file, 'utf8');
      if (/(JWT_SECRET|MAIL_PASS)\s*\|\|\s*['"][^'"]+['"]/.test(text)) {
        violations.push(`credential fallback: ${relative}`);
      }
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
        violations.push(`private key: ${relative}`);
      }
      if (/['"]pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+['"]/.test(text)) {
        violations.push(`hardcoded Mapbox token: ${relative}`);
      }
      if (/['"]\/plot['"]|\/plot_utils\//.test(text)) {
        violations.push(`legacy plot reference: ${relative}`);
      }
    }
  }
  if (violations.length) throw new Error(violations.sort().join('\n'));
}

async function updateJson(file, update) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  update(value);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function normalizeWebPackage(pkg) {
  pkg.name = '@ise/web';
  pkg.engines = { node: '>=20.19.0' };
  delete pkg.scripts.prepare;
  delete pkg.scripts.commit;
  delete pkg.scripts['commit:zh'];
  delete pkg.scripts['commit:en'];
  delete pkg.config;
  delete pkg.dependencies['react-helmet-async'];
  pkg.dependencies.axios = '1.13.2';
  for (const dependency of [
    '@commitlint/cli', '@commitlint/config-conventional',
    'commitizen', 'cz-git', 'czg', 'husky'
  ]) {
    delete pkg.devDependencies[dependency];
  }
  pkg.scripts.test = 'vitest run';
  pkg.scripts['test:e2e'] = 'playwright test';
  pkg.dependencies.three = '0.185.1';
  pkg.devDependencies['@types/three'] = '0.185.1';
  pkg.devDependencies['@playwright/test'] = '1.61.1';
}

export function normalizeApiPackage(pkg) {
  pkg.name = '@ise/api';
  pkg.engines = { node: '>=20.19.0' };
  delete pkg.scripts.prepare;
  for (const dependency of [
    '@commitlint/cli', '@commitlint/config-conventional', 'husky'
  ]) {
    delete pkg.devDependencies[dependency];
  }
  pkg.scripts.typecheck = 'tsc --noEmit';
  Object.assign(pkg.dependencies, {
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
  Object.assign(pkg.devDependencies, {
    '@nestjs/cli': '10.4.9',
    '@nestjs/schematics': '10.2.3',
    '@nestjs/testing': '10.4.22',
    '@rspack/cli': '1.5.6',
    '@rspack/core': '1.5.6',
    prisma: '7.2.0',
    typescript: '5.9.3'
  });
  pkg.devDependencies['@types/pg'] = '^8.15.6';
}

export function createChiBiCompatibilitySource() {
  return [
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
  ].join('\n');
}

export async function runImport(repositoryRoot, sourceRoots) {
  const plans = [
    {
      sourceRoot: sourceRoots.web,
      sourceLabel: 'intelligents_sceneditor_front',
      targetRoot: path.join(repositoryRoot, 'apps', 'web'),
      entries: [
        'biome.json', 'package.json', 'postcss.config.js', 'public',
        'rsbuild.config.ts', 'src', 'tsconfig.json', 'vitest.config.ts'
      ],
      excludedPrefixes: webImportExcludedPrefixes
    },
    {
      sourceRoot: sourceRoots.api,
      sourceLabel: 'intelligents_sceneditor_back',
      targetRoot: path.join(repositoryRoot, 'apps', 'api'),
      entries: [
        '.editorconfig', '.prettierignore', '.prettierrc', 'eslint.config.cjs',
        'nest-cli.json', 'package.json', 'prisma', 'prisma.config.ts',
        'rspack.config.ts', 'src', 'test', 'tsconfig.build.json', 'tsconfig.json'
      ],
      excludedPrefixes: []
    }
  ];

  const receipt = [];
  for (const plan of plans) {
    const copied = await copyFoundation(plan);
    const packageName = plan.targetRoot.endsWith(`${path.sep}web`) ? '@ise/web' : '@ise/api';
    receipt.push(...copied.map(item => ({
      ...item,
      source: `${plan.sourceLabel}/${item.source}`,
      target: `${packageName === '@ise/web' ? 'apps/web' : 'apps/api'}/${item.target}`
    })));
  }

  const webRoot = path.join(repositoryRoot, 'apps', 'web');
  const apiRoot = path.join(repositoryRoot, 'apps', 'api');
  const mockRoot = path.join(webRoot, 'src', 'mock', 'OLD');
  await mkdir(mockRoot, { recursive: true });
  for (const name of [
    '\u5077\u88ad\u73cd\u73e0\u6e2f.json',
    '\u6d77\u5357\u5c9b\u6218\u4f8b-\u5b8c\u6210\u7248\u66f4\u6b63\u9519\u8bef\u7248.json',
    '\u706b\u70e7\u8d64\u58c1.json',
    '\u8bfa\u66fc\u5e95\u767b\u9646-\u5b8c\u6210\u7248.json'
  ]) {
    await writeFile(path.join(mockRoot, name), '{"paths":[]}\n');
  }

  const compatibilityRoot = path.join(webRoot, 'src', 'mock', '313mock');
  await mkdir(compatibilityRoot, { recursive: true });
  const minimalBattle = (exportName, warName) => [
    "import { type BattlExampleScene_DataStructureModel } from '../core.type';",
    '',
    `export const ${exportName}: BattlExampleScene_DataStructureModel = {`,
    `  war_name: '${warName}',`,
    "  intro: { content: '', source_cite: [] },",
    "  OOB: { blue_force: { name: '' }, red_force: { name: '' } },",
    '  entity_registry: { persons: [], spaces: [] },',
    '  outline: [],',
    "  war_meta: { time_range: '', main_region: '', type: '\u53e4\u4ee3\u7ecf\u5178\u6218\u5f79' },",
    "  tags: { battle_style: '', strategic_significance: '' },",
    '  target_duration: 0',
    '};',
    ''
  ].join('\n');
  for (const [fileName, exportName, warName] of [
    ['chibi_battle.mock.ts', 'CHIBI_BATTLE_DATA', '\u8d64\u58c1\u4e4b\u6218'],
    ['hainan_battle.mock.ts', 'HAINAN_BATTLE_DATA', '\u6d77\u5357\u5c9b\u6218\u5f79'],
    ['nuoman_battle.mock.ts', 'NUOMAN_BATTLE_DATA', '\u8bfa\u66fc\u5e95\u767b\u9646']
  ]) {
    await writeFile(
      path.join(compatibilityRoot, fileName),
      minimalBattle(exportName, warName)
    );
  }
  await writeFile(
    path.join(webRoot, 'src', 'mock', 'ChiBi_War.ts'),
    createChiBiCompatibilitySource()
  );

  await updateJson(path.join(webRoot, 'package.json'), normalizeWebPackage);
  await updateJson(path.join(apiRoot, 'package.json'), normalizeApiPackage);

  await writeFile(path.join(webRoot, '.env.example'), [
    'PUBLIC_WEB_URL=http://localhost:9999',
    'PUBLIC_MAPBOX_TOKEN=replace-with-public-mapbox-token',
    ''
  ].join('\n'));
  await writeFile(path.join(apiRoot, '.env.example'), [
    'PORT=3333',
    'DATABASE_URL=postgresql://ise:replace-me@localhost:5432/ise',
    'JWT_SECRET=replace-with-at-least-32-random-characters',
    'MINIO_ENDPOINT=127.0.0.1',
    'MINIO_PORT=9000',
    'MINIO_ACCESS_KEY=replace-me',
    'MINIO_SECRET_KEY=replace-me',
    'MINIO_BUCKET=ise',
    'MAIL_USER=operator@example.test',
    'MAIL_PASS=replace-me',
    'MAIL_FROM=no-reply@example.test',
    'VITE_WEB_URL=http://localhost:9999',
    ''
  ].join('\n'));

  await mkdir(path.join(repositoryRoot, 'provenance'), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, 'provenance', 'foundation-import.files.json'),
    `${JSON.stringify(receipt.sort((a, b) => a.target.localeCompare(b.target)), null, 2)}\n`
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await runImport(repositoryRoot, resolveSourceRoots(process.env));
}
