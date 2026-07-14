# ISE Foundation Import and Runtime Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a safe, tracked Web/API foundation and freeze the strict runtime and asset contracts that every later ISE worktree consumes.

**Architecture:** Selectively copy the current React and NestJS applications into npm workspaces through an audited allowlist, remove secrets and prohibited payloads before staging, and record file-level lineage. Put all cross-service scene, asset, resolved-access, and normalized-trajectory schemas in `@ise/runtime-contracts`; Web, API, and Agent consume that package instead of defining local protocol variants.

**Tech Stack:** Node.js `>=20.19.0`, npm workspaces, TypeScript 5.9, Zod 4, Node test runner through `tsx`, React 19/Rsbuild/Vitest, NestJS 10/Prisma 7/Jest, Three.js `0.185.1`, Playwright `1.61.1`.

## Global Constraints

- The repository runtime is Node.js `>=20.19.0`; do not add a second package manager or a nested lockfile.
- The workspace package names are exactly `@ise/web`, `@ise/api`, `@ise/agent`, `@ise/agent-core`, `@ise/skills-core`, and `@ise/runtime-contracts`.
- Import the current frontend into `apps/web` and the current NestJS source plus Prisma into `apps/api` through an explicit allowlist.
- `.env`, `dist`, logs, caches, `node_modules`, nested `.git`, nested package-manager locks, editor state, and repository hook configuration must not be imported.
- The old Python Agent and `intelligents_sceneditor_front_OLD` remain reference-only and are not members of the root workspace.
- Large MP4, GLB, and geographic payloads must not enter Git or Git LFS; only manifests, fingerprints, required metadata, import utilities, and small test fixtures are tracked.
- Every service provides `.env.example`; database passwords, Mapbox tokens, MinIO credentials, mail credentials, model keys, and all real secrets must not enter Git.
- `SceneProjectConfig` is versioned as exactly `ise-scene/v1`; the supported track types are exactly `subtitle`, `image`, `video`, `marker`, `geojson`, `camera`, and `model`.
- Model actions are exactly `model.spawn`, `model.follow_path`, `model.set_state`, and `model.hide`; unknown track or action values are rejected.
- Runtime and asset schemas are strict Zod schemas: unknown properties, incompatible schema versions, unsafe asset IDs, invalid millisecond values, invalid coordinates, and inconsistent metadata are rejected.
- Runtime plans contain stable `assetId` values, never local paths, MinIO object names, or arbitrary external URLs.
- Asset fingerprints use exactly `sha256:` followed by 64 lowercase hexadecimal characters.
- Trajectories uploaded by later tooling use exactly `{ schemaVersion: 'ise-trajectory/v1', points: [{ timeMs, longitude, latitude, altitudeM }] }` with strictly increasing relative millisecond time.
- The foundation plan does not upload to MinIO. It exports `prepareAssetForUpload(entry, sourceBytes)` so the later API seed CLI can validate and prepare bytes before upload.
- Use TDD for every behavior: observe the named failure, add the minimum implementation, rerun the focused test, then run the package-level gate.
- Do not create feature worktrees until the safe import baseline and the frozen `@ise/runtime-contracts` commit both exist.

---

## File Map

- `scripts/import-foundation.mjs`: one-shot allowlisted copy, path/content audit, package normalization, and source-file receipt generation.
- `scripts/import-foundation.test.mjs`: isolated fixture tests for the copy denylist, overwrite protection, and secret/large-payload audit.
- `apps/web`: imported React/Rsbuild app named `@ise/web`; repository-local hooks, nested locks, old Threebox payloads, and large legacy scene JSON are absent.
- `apps/api`: imported NestJS/Prisma app named `@ise/api`; hardcoded credential fallbacks are removed before the first baseline commit.
- `apps/api/src/config/required-env.ts`: fail-fast lookup for security-sensitive API environment values.
- `provenance/FOUNDATION-IMPORT.md`: human-readable origin, selection rationale, exclusions, and intentional transformations.
- `provenance/foundation-import.files.json`: sorted source path, target path, byte count, and SHA-256 lineage receipt emitted by the import script.
- `packages/runtime-contracts/src/scene.ts`: strict SceneProjectConfig, entity, diagnostic, item, track, and track-parameter schemas/types.
- `packages/runtime-contracts/src/assets.ts`: seed manifest, asset metadata, resolved asset access, and cross-entry invariants.
- `packages/runtime-contracts/src/trajectory.ts`: raw trajectory parsing and deterministic normalization to `ise-trajectory/v1`.
- `packages/runtime-contracts/src/prepareAssetForUpload.ts`: trajectory canonicalization plus fingerprint, size, and magic-byte validation.
- `packages/runtime-contracts/src/index.ts`: the only public export surface consumed by Web, API, Agent, and SceneRuntime.
- `packages/runtime-contracts/src/validateAssetSeedCli.ts`: non-uploading seed-manifest validation command.
- `packages/runtime-contracts/test`: focused scene, asset, trajectory, and upload-preparation contract tests.
- `provenance/ASSET-SEED.md`: frozen asset IDs, source naming policy, units, and later API seed-CLI handoff.

### Task 1: Secure Selective Import and Worktree Baseline

**Files:**
- Create: `scripts/import-foundation.test.mjs`
- Create: `scripts/import-foundation.mjs`
- Create: `apps/web/**` from the allowlisted source paths in this task
- Create: `apps/web/.env.example`
- Create: `apps/web/src/config/public-env.ts`
- Modify: `apps/web/src/env.d.ts`
- Create: `apps/api/**` from the allowlisted source paths in this task
- Create: `apps/api/.env.example`
- Create: `apps/api/src/config/required-env.ts`
- Create: `apps/api/src/config/required-env.spec.ts`
- Create: `provenance/FOUNDATION-IMPORT.md`
- Create: `provenance/foundation-import.files.json` through the import script
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json` through `npm install`

**Interfaces:**
- Consumes: operator-provided absolute source roots `ISE_WEB_SOURCE_ROOT` and `ISE_API_SOURCE_ROOT`; neither nested `.git` has a usable committed baseline, and neither source drop is copied wholesale into the worktree.
- Produces: tracked workspace packages `@ise/web` and `@ise/api`, a single root `package-lock.json`, and root commands `dev:web`, `dev:api`, `build`, `test`, `typecheck`, and `check`.
- Produces: `requiredEnv(name: string): string`, which throws `Missing required environment variable: <name>` for absent or blank values.
- Produces: a deterministic import receipt containing `{ source, target, bytes, sha256 }[]`, sorted by target path.

- [ ] **Step 1: Write the failing import-policy tests**

Create `scripts/import-foundation.test.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  auditTarget,
  copyFoundation,
  isDeniedRelativePath,
  resolveSourceRoots
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
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `node --test scripts/import-foundation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/import-foundation.mjs`.

- [ ] **Step 3: Implement the allowlisted copier and auditor**

Create `scripts/import-foundation.mjs`:

```js
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
    }
  }
  if (violations.length) throw new Error(violations.sort().join('\n'));
}

async function updateJson(file, update) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  update(value);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function runImport(repositoryRoot, sourceRoots) {
  const plans = [
    {
      sourceRoot: sourceRoots.web,
      sourceLabel: 'intelligents_sceneditor_front',
      targetRoot: path.join(repositoryRoot, 'apps', 'web'),
      entries: [
        'biome.json', 'package.json', 'postcss.config.js', 'public',
        'rsbuild.config.ts', 'src', 'tsconfig.json', 'vitest.config.ts'
      ],
      excludedPrefixes: [
        'public/fonts_threejs',
        'public/plot_utils',
        'public/jmp.data',
        'src/mock/OLD',
        'src/mock/scene',
        'src/hooks/scene-instance-player-hooks.ts',
        'src/hooks/scene-instance-run-hooks.ts',
        'src/hooks/scene-player-hooks.ts'
      ]
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
    '偷袭珍珠港.json',
    '海南岛战例-完成版更正错误版.json',
    '火烧赤壁.json',
    '诺曼底登陆-完成版.json'
  ]) {
    await writeFile(path.join(mockRoot, name), '{"paths":[]}\n');
  }

  await updateJson(path.join(webRoot, 'package.json'), pkg => {
    pkg.name = '@ise/web';
    pkg.engines = { node: '>=20.19.0' };
    delete pkg.scripts.prepare;
    pkg.scripts.test = 'vitest run';
    pkg.scripts['test:e2e'] = 'playwright test';
    pkg.dependencies.three = '0.185.1';
    pkg.devDependencies['@types/three'] = '0.185.1';
    pkg.devDependencies['@playwright/test'] = '1.61.1';
  });
  await updateJson(path.join(apiRoot, 'package.json'), pkg => {
    pkg.name = '@ise/api';
    pkg.engines = { node: '>=20.19.0' };
    delete pkg.scripts.prepare;
    pkg.scripts.typecheck = 'tsc --noEmit';
  });

  await writeFile(path.join(webRoot, '.env.example'), [
    'VITE_WEB_URL=http://localhost:9999',
    'VITE_MINIO_ADDRESS=http://localhost:9000',
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
```

- [ ] **Step 4: Run the import-policy tests and verify they pass**

Run: `node --test scripts/import-foundation.test.mjs`

Expected: PASS, 5 tests, 0 failures.

- [ ] **Step 5: Execute the selective import and observe the security audit fail before staging**

Run from `.worktrees/ise-foundation-import-contracts`:

```powershell
$env:ISE_WEB_SOURCE_ROOT='E:\Github\ISE\intelligents_sceneditor_front'
$env:ISE_API_SOURCE_ROOT='E:\Github\ISE\intelligents_sceneditor_back'
node scripts/import-foundation.mjs
```

Expected: creates `apps/web`, `apps/api`, and `provenance/foundation-import.files.json`; no nested `.git`, `.env`, `dist`, `logs`, `node_modules`, nested lockfile, GLB, or MP4 appears below `apps`. The receipt contains only fixed labels such as `intelligents_sceneditor_front/src/index.ts`, never `E:\Github\ISE` or another absolute path.

Run: `node -e "import('./scripts/import-foundation.mjs').then(async m => { await m.auditTarget('apps/web'); await m.auditTarget('apps/api'); })"`

Expected: FAIL and list the imported API files that still contain a `JWT_SECRET` or `MAIL_PASS` hardcoded fallback plus the five Web files containing hardcoded Mapbox tokens. Do not run `git add` while this command fails.

- [ ] **Step 6: Write the failing required-environment test**

Create `apps/api/src/config/required-env.spec.ts`:

```ts
import { requiredEnv } from './required-env';

describe('requiredEnv', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('returns a trimmed configured value', () => {
    process.env.JWT_SECRET = '  configured-secret  ';
    expect(requiredEnv('JWT_SECRET')).toBe('configured-secret');
  });

  it.each([undefined, '', '   '])('rejects an absent or blank value', value => {
    if (value === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = value;
    expect(() => requiredEnv('JWT_SECRET')).toThrow(
      'Missing required environment variable: JWT_SECRET'
    );
  });
});
```

- [ ] **Step 7: Run the focused API test and verify the missing-module failure**

Run: `npm exec --yes --package jest@29.5.0 --package ts-jest@29.1.0 --package typescript@5.9.3 -- jest --config apps/api/package.json --runInBand config/required-env.spec.ts`

Expected: FAIL because `apps/api/src/config/required-env.ts` does not exist. This pre-install red command is only for the first baseline; subsequent runs use the workspace command below.

- [ ] **Step 8: Implement required secret lookup and remove all hardcoded tokens**

Create `apps/api/src/config/required-env.ts`:

```ts
export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
```

In `apps/api/src/modules/auth/auth.module.ts`, import `requiredEnv` and use:

```ts
JwtModule.register({
  secret: requiredEnv('JWT_SECRET'),
  signOptions: { expiresIn: '3d' }
})
```

In `apps/api/src/modules/auth/auth.service.ts` and `apps/api/src/modules/auth/jwt.strategy.ts`, replace the fallback expressions with `requiredEnv('JWT_SECRET')`. In `apps/api/src/modules/email/email.module.ts`, replace the three credential/default expressions with:

```ts
auth: {
  user: requiredEnv('MAIL_USER'),
  pass: requiredEnv('MAIL_PASS')
},
defaults: {
  from: requiredEnv('MAIL_FROM')
}
```

Create `apps/web/src/config/public-env.ts`:

```ts
export const mapboxToken = String(import.meta.env.PUBLIC_MAPBOX_TOKEN ?? '').trim();
```

Append the explicit public variable to `apps/web/src/env.d.ts` so TypeScript and Rsbuild use the same name:

```ts
interface ImportMetaEnv {
  readonly PUBLIC_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

Replace the five hardcoded `pk.*` literals in `components/common/preview/PreMap.tsx`, `pages/Plot/components/Map.tsx`, `pages/Preview/index.tsx`, `pages/Scene/components/SceneCanvas.tsx`, and `pages/Script/components/MapMini.tsx` with the imported `mapboxToken`. Each component must branch before constructing Mapbox:

```tsx
if (!mapboxToken) {
  return <div role="alert">PUBLIC_MAPBOX_TOKEN is not configured.</div>;
}
```

Run: `node -e "import('./scripts/import-foundation.mjs').then(async m => { await m.auditTarget('apps/web'); await m.auditTarget('apps/api'); })"`

Expected: PASS with no output.

- [ ] **Step 9: Establish the root npm workspace and unified commands**

Replace `package.json` with:

```json
{
  "name": "ise-monorepo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*",
    "agent"
  ],
  "engines": {
    "node": ">=20.19.0"
  },
  "scripts": {
    "dev:web": "npm run dev -w @ise/web",
    "dev:api": "npm run start:dev -w @ise/api",
    "prisma:generate": "npm run prisma:generate -w @ise/api",
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "check": "npm run prisma:generate && npm run typecheck && npm run test && npm run build"
  }
}
```

Append these exact entries to `.gitignore`:

```gitignore

# Untracked source drops retained outside the workspace
/intelligents_sceneditor_agent/
/intelligents_sceneditor_back/
/intelligents_sceneditor_front/
/intelligents_sceneditor_front_OLD/
/json/
/素材/
/印巴glb（修改6.0）/

# Raw demo media remains outside Git; small fixtures require explicit force-add review
/**/*.glb
/**/*.mp4
```

Do not ignore `apps`, `provenance`, JSON contract fixtures, or the already tracked DOCX parser fixture.

- [ ] **Step 10: Record provenance before the first baseline commit**

Create `provenance/FOUNDATION-IMPORT.md` with this complete selection record:

```markdown
# Foundation import provenance

Date: 2026-07-15

## Sources

| Target | Source | Nested Git state | Source package name |
| --- | --- | --- | --- |
| `apps/web` | `intelligents_sceneditor_front` | `master` is unborn; all source files were untracked | `intelligents_sceneditor_front` |
| `apps/api` | `intelligents_sceneditor_back` | `master` is unborn; all source files were untracked | `intelligents_sceneditor_back` |

The original source drops remain local and ignored. They are not workspace members and are not authoritative after this import.

## Included

- Web: `src`, non-legacy `public` assets, Rsbuild, TypeScript, Vitest, PostCSS, and Biome configuration.
- API: `src`, `test`, Prisma schema and migrations, Nest/Rspack/TypeScript/ESLint/Prettier configuration.
- Package manifests were renamed to `@ise/web` and `@ise/api`; repository-local Husky prepare scripts and nested locks were removed in favor of the root npm workspace.

## Excluded

- All `.env`, `.git`, `.husky`, `.vscode`, `node_modules`, `dist`, logs, caches, coverage, nested locks, old project directories, and repository-management files.
- `public/plot_utils`, `public/fonts_threejs`, and `public/jmp.data` because they are the legacy Threebox/plot payload and are not part of the new Mapbox Custom Layer runtime.
- `src/hooks/scene-instance-player-hooks.ts`, `src/hooks/scene-instance-run-hooks.ts`, and `src/hooks/scene-player-hooks.ts` because they import missing legacy stores/managers and are not called by the current Scene page; the new SceneRuntime replaces them.
- `src/mock/scene` and the large files from `src/mock/OLD`. Four `{ "paths": [] }` compatibility modules keep the mechanical import buildable without committing geographic payloads; Web integration removes those imports rather than treating the empty modules as runtime data.
- `intelligents_sceneditor_agent` and `intelligents_sceneditor_front_OLD`; both are reference-only.
- Root demo MP4, GLB, trajectory JSON, images, DOCX, and SRT. Later asset seeding reads operator-provided local bytes through a validated manifest.

## Security transformations

- Removed hardcoded JWT and mail credential fallbacks before staging.
- Added `.env.example` files containing variable names and inert local example values only.
- Added `three@0.185.1`, `@types/three@0.185.1`, and `@playwright/test@1.61.1` to the Web baseline so runtime worktrees do not contend on manifests or the root lockfile.

## File receipt

`provenance/foundation-import.files.json` records a fixed source label plus source-relative path, target-relative path, byte count, and SHA-256 source hash. It never records `ISE_WEB_SOURCE_ROOT`, `ISE_API_SOURCE_ROOT`, drive letters, or absolute paths. Generated environment examples, empty compatibility modules, normalized package manifests, and secret-removal edits are documented above rather than represented as byte-identical copies.
```

- [ ] **Step 11: Install once at the root and verify the baseline**

Run: `npm install`

Expected: PASS and update only the root `package-lock.json`; no nested lockfile is created.

Run: `npm run prisma:generate`

Expected: PASS and generate the Prisma client from `apps/api/prisma/schema.prisma` without connecting to PostgreSQL.

Run: `npm run test -w @ise/api -- --runInBand src/config/required-env.spec.ts`

Expected: PASS, 4 cases, 0 failures.

Run: `npm run typecheck -w @ise/web`

Expected: PASS. Missing imports from excluded legacy payloads indicate that an import was not replaced by one of the four small compatibility modules; do not copy the large source payload to solve that failure.

Run:

```powershell
$legacyImports = Get-ChildItem apps/web/src -Recurse -File -Include *.ts,*.tsx | Select-String -Pattern @('scene-instance-player-hooks','scene-instance-run-hooks','scene-player-hooks')
if ($legacyImports) { $legacyImports | ForEach-Object { Write-Error "$($_.Path):$($_.LineNumber):$($_.Line)" }; exit 1 }
```

Expected: PASS with no output, proving that retained Web source does not import any excluded legacy hook.

Run: `npm run build -w @ise/web`

Expected: PASS and create ignored `apps/web/dist` only.

Run: `npm run build -w @ise/api`

Expected: PASS and create ignored `apps/api/dist` only.

Run: `git status --short --ignored`

Expected: `apps/web`, `apps/api`, the scripts, provenance, root manifests, and this plan are visible as intended changes; source drops, raw assets, nested repositories, `.env`, `dist`, logs, caches, and `node_modules` are ignored or absent from the import.

- [ ] **Step 12: Stage an explicit allowlist, inspect it, and create the safe baseline commit**

```powershell
git add .gitignore package.json package-lock.json scripts/import-foundation.mjs scripts/import-foundation.test.mjs apps/web apps/api provenance/FOUNDATION-IMPORT.md provenance/foundation-import.files.json docs/superpowers/plans/2026-07-15-ise-foundation-import-contracts.md
git diff --cached --name-only
git diff --cached --check
git grep --cached -n -E "(JWT_SECRET|MAIL_PASS)[[:space:]]*\\|\\|[[:space:]]*['\"][^'\"]+|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY"
git commit -m "chore: import web and api foundation safely"
```

Expected: the staged-name review contains no original source-drop path, `.env`, nested lock, `.git`, `dist`, cache, raw GLB/MP4, or large geographic JSON. `git diff --cached --check` passes, the secret grep has no matches, and the commit succeeds. Record this commit hash as the first safe worktree-capable baseline, but do not branch implementation worktrees until Task 4 also commits the frozen contracts.

### Task 2: Strict SceneProjectConfig Contract

**Files:**
- Create: `packages/runtime-contracts/package.json`
- Create: `packages/runtime-contracts/tsconfig.json`
- Create: `packages/runtime-contracts/src/scene.ts`
- Create: `packages/runtime-contracts/src/index.ts`
- Create: `packages/runtime-contracts/test/scene.test.ts`
- Modify: `package-lock.json` through `npm install`

**Interfaces:**
- Consumes: Zod 4 and the exact track/entity fields frozen in this plan.
- Produces: `sceneProjectConfigSchema`, `sceneProjectConfigJsonSchema`, `SceneProjectConfig`, `sceneTrackSchema`, `SceneTrack`, `sceneTrackItemSchema`, `SceneTrackItem`, `diagnosticSchema`, `Diagnostic`, `sceneEntitySchema`, `SceneEntity`, `overlayLayoutSchema`, and `OverlayLayout` from `@ise/runtime-contracts`.
- Produces: `SceneTrack` as a `type`-discriminated union with common `{ trackId, type, label, visible, items }`.

- [ ] **Step 1: Scaffold only the package test runner and write the failing scene tests**

Create `packages/runtime-contracts/package.json`:

```json
{
  "name": "@ise/runtime-contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "engines": {
    "node": ">=20.19.0"
  },
  "scripts": {
    "test": "tsx --test test/scene.test.ts",
    "typecheck": "tsc --noEmit",
    "validate:assets": "tsx src/validateAssetSeedCli.ts"
  },
  "dependencies": {
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^24.10.0",
    "tsx": "^4.20.6",
    "typescript": "^5.9.3"
  }
}
```

Create `packages/runtime-contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `packages/runtime-contracts/test/scene.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sceneProjectConfigJsonSchema,
  sceneProjectConfigSchema,
  type SceneProjectConfig
} from '../src/index.js';

const item = {
  id: 'item-1',
  eventUnitId: 'event-1',
  startMs: 0,
  durationMs: 1000,
  evidenceRefs: ['evidence-1']
};

function validConfig(): SceneProjectConfig {
  return {
    schemaVersion: 'ise-scene/v1',
    sourceDocumentId: 'document-1',
    eventPlanArtifactId: 'artifact-event-1',
    runtimePlanArtifactId: 'artifact-runtime-1',
    totalDurationMs: 5000,
    entities: [{
      entityId: 'entity-jf17',
      displayName: 'JF-17',
      kind: 'aircraft',
      modelAssetId: 'model:jf17',
      defaultTrajectoryAssetId: 'trajectory:ambala-rafale-1',
      initialState: 'normal'
    }],
    tracks: [
      { trackId: 'subtitle-1', type: 'subtitle', label: 'Subtitles', visible: true, items: [{ ...item, params: { text: 'Contact', position: 'bottom', maxWidthPct: 80 } }] },
      { trackId: 'image-1', type: 'image', label: 'Image', visible: true, items: [{ ...item, assetId: 'image:ground-radar', params: { layout: { xPct: 5, yPct: 5, widthPct: 30, heightPct: 30, zIndex: 10, opacity: 1, fit: 'contain' }, enter: 'fade', exit: 'fade' } }] },
      { trackId: 'video-1', type: 'video', label: 'Video', visible: true, items: [{ ...item, assetId: 'video:missile-impact', params: { layout: { xPct: 60, yPct: 5, widthPct: 35, heightPct: 30, zIndex: 20, opacity: 1, fit: 'cover' }, volume: 0.8, playbackRate: 1, loop: false } }] },
      { trackId: 'marker-1', type: 'marker', label: 'Marker', visible: true, items: [{ ...item, params: { coordinates: [76.8, 30.4], label: 'Ambala', color: '#ff0000' } }] },
      { trackId: 'geojson-1', type: 'geojson', label: 'GeoJSON', visible: true, items: [{ ...item, assetId: 'geojson:airspace', params: { lineColor: '#00ffff', lineWidth: 2, fillColor: '#004455', fillOpacity: 0.2, circleColor: '#ffffff', circleRadius: 4, keepAfterEnd: false } }] },
      { trackId: 'camera-1', type: 'camera', label: 'Camera', visible: true, items: [{ ...item, params: { center: [76.8, 30.4], zoom: 8, pitch: 45, bearing: 90, easing: 'easeInOut' } }] },
      { trackId: 'model-1', type: 'model', label: 'Models', visible: true, items: [{ ...item, params: { action: 'model.follow_path', entityId: 'entity-jf17', trajectoryAssetId: 'trajectory:ambala-rafale-1' } }] }
    ],
    diagnostics: []
  };
}

test('accepts all seven frozen track variants', () => {
  const parsed = sceneProjectConfigSchema.parse(validConfig());
  assert.deepEqual(parsed.tracks.map(track => track.type), [
    'subtitle', 'image', 'video', 'marker', 'geojson', 'camera', 'model'
  ]);
});

test('rejects unknown properties at the root and nested item levels', () => {
  assert.equal(sceneProjectConfigSchema.safeParse({ ...validConfig(), extra: true }).success, false);
  const nested = validConfig() as SceneProjectConfig & { tracks: any[] };
  nested.tracks[0].items[0].params.extra = true;
  assert.equal(sceneProjectConfigSchema.safeParse(nested).success, false);
});

test('rejects incompatible versions, unsafe asset ids, bad time, and missing evidence', () => {
  const version = { ...validConfig(), schemaVersion: 'ise-scene/v2' };
  assert.equal(sceneProjectConfigSchema.safeParse(version).success, false);

  const unsafe = validConfig() as SceneProjectConfig & { tracks: any[] };
  unsafe.tracks[1].items[0].assetId = 'C:\\assets\\radar.png';
  assert.equal(sceneProjectConfigSchema.safeParse(unsafe).success, false);

  const badTime = validConfig() as SceneProjectConfig & { tracks: any[] };
  badTime.tracks[0].items[0].startMs = -1;
  assert.equal(sceneProjectConfigSchema.safeParse(badTime).success, false);

  const noEvidence = validConfig() as SceneProjectConfig & { tracks: any[] };
  noEvidence.tracks[0].items[0].evidenceRefs = [];
  assert.equal(sceneProjectConfigSchema.safeParse(noEvidence).success, false);
});

test('rejects duplicate ids, items beyond duration, and unknown model entities', () => {
  const duplicate = validConfig();
  duplicate.tracks.push(duplicate.tracks[0]!);
  assert.equal(sceneProjectConfigSchema.safeParse(duplicate).success, false);

  const overrun = validConfig() as SceneProjectConfig & { tracks: any[] };
  overrun.tracks[0].items[0].startMs = 4900;
  overrun.tracks[0].items[0].durationMs = 200;
  assert.equal(sceneProjectConfigSchema.safeParse(overrun).success, false);

  const unknownEntity = validConfig() as SceneProjectConfig & { tracks: any[] };
  unknownEntity.tracks[6].items[0].params.entityId = 'missing';
  assert.equal(sceneProjectConfigSchema.safeParse(unknownEntity).success, false);
});

test('exports a strict JSON Schema', () => {
  assert.equal(sceneProjectConfigJsonSchema.additionalProperties, false);
  assert.deepEqual(sceneProjectConfigJsonSchema.properties?.schemaVersion, {
    type: 'string',
    const: 'ise-scene/v1'
  });
});
```

- [ ] **Step 2: Install the package scaffold and verify the missing-export failure**

Run: `npm install`

Expected: PASS and register `@ise/runtime-contracts` in the root lockfile.

Run: `npm run test -w @ise/runtime-contracts`

Expected: FAIL because `src/index.ts` and the scene exports do not exist.

- [ ] **Step 3: Implement the complete strict scene schema**

Create `packages/runtime-contracts/src/scene.ts`:

```ts
import { z } from 'zod';

const nonEmptyId = z.string().trim().min(1);
const milliseconds = z.number().int().nonnegative();
const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
const coordinates = z.tuple([longitude, latitude]);
const assetId = z.string().regex(
  /^(model|trajectory|video|image|geojson):[a-z0-9][a-z0-9._-]*$/
);
const state = z.enum(['normal', 'warning', 'disabled', 'hidden']);

export const diagnosticSchema = z.strictObject({
  code: nonEmptyId,
  severity: z.enum(['warning', 'error']),
  recoverable: z.boolean(),
  eventUnitId: nonEmptyId.optional(),
  commandId: nonEmptyId.optional(),
  assetId: assetId.optional(),
  message: z.string().trim().min(1)
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

export const sceneEntitySchema = z.strictObject({
  entityId: nonEmptyId,
  displayName: z.string().trim().min(1),
  kind: z.enum(['aircraft', 'missile', 'location', 'other']),
  modelAssetId: assetId.regex(/^model:/).optional(),
  defaultTrajectoryAssetId: assetId.regex(/^trajectory:/).optional(),
  initialState: state
});
export type SceneEntity = z.infer<typeof sceneEntitySchema>;

export const overlayLayoutSchema = z.strictObject({
  xPct: z.number().finite().min(0).max(100),
  yPct: z.number().finite().min(0).max(100),
  widthPct: z.number().finite().positive().max(100),
  heightPct: z.number().finite().positive().max(100),
  zIndex: z.number().int(),
  opacity: z.number().finite().min(0).max(1),
  fit: z.enum(['contain', 'cover'])
});
export type OverlayLayout = z.infer<typeof overlayLayoutSchema>;

const baseItemShape = {
  id: nonEmptyId,
  eventUnitId: nonEmptyId,
  startMs: milliseconds,
  durationMs: milliseconds,
  assetId: assetId.optional(),
  evidenceRefs: z.array(nonEmptyId).min(1)
};

const subtitleParamsSchema = z.strictObject({
  text: z.string().trim().min(1),
  position: z.enum(['top', 'bottom']),
  maxWidthPct: z.number().finite().positive().max(100)
});
const imageParamsSchema = z.strictObject({
  layout: overlayLayoutSchema,
  enter: z.enum(['none', 'fade']),
  exit: z.enum(['none', 'fade'])
});
const videoParamsSchema = z.strictObject({
  layout: overlayLayoutSchema,
  volume: z.number().finite().min(0).max(1),
  playbackRate: z.number().finite().positive(),
  loop: z.boolean()
});
const markerParamsSchema = z.strictObject({
  coordinates,
  label: z.string().trim().min(1),
  color: z.string().trim().min(1)
});
const geojsonParamsSchema = z.strictObject({
  lineColor: z.string().trim().min(1),
  lineWidth: z.number().finite().nonnegative(),
  fillColor: z.string().trim().min(1),
  fillOpacity: z.number().finite().min(0).max(1),
  circleColor: z.string().trim().min(1),
  circleRadius: z.number().finite().nonnegative(),
  keepAfterEnd: z.boolean()
});
const cameraParamsSchema = z.strictObject({
  center: coordinates,
  zoom: z.number().finite().min(0).max(24),
  pitch: z.number().finite().min(0).max(85),
  bearing: z.number().finite().min(-360).max(360),
  easing: z.enum(['linear', 'easeInOut'])
});

export const modelActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('model.spawn'), entityId: nonEmptyId }),
  z.strictObject({
    action: z.literal('model.follow_path'),
    entityId: nonEmptyId,
    trajectoryAssetId: assetId.regex(/^trajectory:/)
  }),
  z.strictObject({
    action: z.literal('model.set_state'),
    entityId: nonEmptyId,
    state
  }),
  z.strictObject({ action: z.literal('model.hide'), entityId: nonEmptyId })
]);

const subtitleItemSchema = z.strictObject({ ...baseItemShape, params: subtitleParamsSchema });
const imageItemSchema = z.strictObject({ ...baseItemShape, params: imageParamsSchema });
const videoItemSchema = z.strictObject({ ...baseItemShape, params: videoParamsSchema });
const markerItemSchema = z.strictObject({ ...baseItemShape, params: markerParamsSchema });
const geojsonItemSchema = z.strictObject({ ...baseItemShape, params: geojsonParamsSchema });
const cameraItemSchema = z.strictObject({ ...baseItemShape, params: cameraParamsSchema });
const modelItemSchema = z.strictObject({ ...baseItemShape, params: modelActionSchema });

export const sceneTrackItemSchema = z.union([
  subtitleItemSchema,
  imageItemSchema,
  videoItemSchema,
  markerItemSchema,
  geojsonItemSchema,
  cameraItemSchema,
  modelItemSchema
]);
export type SceneTrackItem = z.infer<typeof sceneTrackItemSchema>;

const trackBase = {
  trackId: nonEmptyId,
  label: z.string().trim().min(1),
  visible: z.boolean()
};
export const sceneTrackSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...trackBase, type: z.literal('subtitle'), items: z.array(subtitleItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('image'), items: z.array(imageItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('video'), items: z.array(videoItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('marker'), items: z.array(markerItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('geojson'), items: z.array(geojsonItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('camera'), items: z.array(cameraItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('model'), items: z.array(modelItemSchema) })
]);
export type SceneTrack = z.infer<typeof sceneTrackSchema>;

const baseSceneProjectConfigSchema = z.strictObject({
  schemaVersion: z.literal('ise-scene/v1'),
  sourceDocumentId: nonEmptyId,
  eventPlanArtifactId: nonEmptyId,
  runtimePlanArtifactId: nonEmptyId,
  totalDurationMs: milliseconds,
  entities: z.array(sceneEntitySchema),
  tracks: z.array(sceneTrackSchema),
  diagnostics: z.array(diagnosticSchema)
});

export const sceneProjectConfigSchema = baseSceneProjectConfigSchema.superRefine((config, context) => {
  const entityIds = new Set<string>();
  for (const [index, entity] of config.entities.entries()) {
    if (entityIds.has(entity.entityId)) {
      context.addIssue({ code: 'custom', path: ['entities', index, 'entityId'], message: 'Duplicate entityId' });
    }
    entityIds.add(entity.entityId);
  }

  const trackIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const [trackIndex, track] of config.tracks.entries()) {
    if (trackIds.has(track.trackId)) {
      context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'trackId'], message: 'Duplicate trackId' });
    }
    trackIds.add(track.trackId);
    for (const [itemIndex, trackItem] of track.items.entries()) {
      if (itemIds.has(trackItem.id)) {
        context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'id'], message: 'Duplicate item id' });
      }
      itemIds.add(trackItem.id);
      if (trackItem.startMs + trackItem.durationMs > config.totalDurationMs) {
        context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex], message: 'Track item exceeds totalDurationMs' });
      }
      if (track.type === 'model' && !entityIds.has(trackItem.params.entityId)) {
        context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'params', 'entityId'], message: 'Unknown model entityId' });
      }
    }
  }
});
export type SceneProjectConfig = z.infer<typeof sceneProjectConfigSchema>;

export const sceneProjectConfigJsonSchema = z.toJSONSchema(baseSceneProjectConfigSchema, {
  target: 'draft-2020-12'
});
```

Create `packages/runtime-contracts/src/index.ts`:

```ts
export * from './scene.js';
```

- [ ] **Step 4: Run the scene contract red/green gate**

Run: `npm run test -w @ise/runtime-contracts`

Expected: PASS, 5 tests, 0 failures.

Run: `npm run typecheck -w @ise/runtime-contracts`

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 5: Commit the independently reviewable scene contract**

```powershell
git add packages/runtime-contracts/package.json packages/runtime-contracts/tsconfig.json packages/runtime-contracts/src/scene.ts packages/runtime-contracts/src/index.ts packages/runtime-contracts/test/scene.test.ts package-lock.json
git diff --cached --check
git commit -m "feat: define strict scene runtime contracts"
```

Expected: commit succeeds and contains no Web, API, or Agent behavior changes.

### Task 3: Asset Seed, Resolved Access, and Canonical Trajectory Contracts

**Files:**
- Modify: `packages/runtime-contracts/package.json`
- Create: `packages/runtime-contracts/src/assets.ts`
- Create: `packages/runtime-contracts/src/trajectory.ts`
- Create: `packages/runtime-contracts/src/prepareAssetForUpload.ts`
- Create: `packages/runtime-contracts/test/assets.test.ts`
- Create: `packages/runtime-contracts/test/trajectory.test.ts`
- Create: `packages/runtime-contracts/test/prepare-asset.test.ts`
- Modify: `packages/runtime-contracts/src/index.ts`

**Interfaces:**
- Produces: `assetSeedManifestSchema`, `assetSeedManifestJsonSchema`, `AssetSeedManifest`, `assetManifestEntrySchema`, `AssetManifestEntry`, `resolvedAssetAccessSchema`, `resolvedAssetAccessJsonSchema`, and `ResolvedAssetAccess`.
- Produces: `ResolvedAssetAccess` as strict `{ assetId, url, fingerprint, mediaType, size, expiresAt, model?, trajectory?, video?, image? }`; it never exposes `sourceRelativePath`, `objectName`, `availability`, `criticality`, `fallbackAssetIds`, or `allowFallback`.
- Produces: model metadata `{ scale, rotationOffsetDeg: [x, y, z], altitudeOffsetM, entityTypes }`, trajectory metadata `{ format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt', startTimeMs, endTimeMs, monotonic: true }`, video metadata `{ durationMs, codec }`, and image metadata `{ width, height, fit }` with identical field names in manifest entries and resolved access.
- Produces: `normalizeTrajectorySamples(samples: RawTrajectorySample[]): NormalizedTrajectory` and `prepareAssetForUpload(entry: AssetManifestEntry, sourceBytes: Uint8Array): Promise<Uint8Array>`.
- Duplicate timestamp policy: preserve source order and group equal parsed timestamps. For group size `k > 1`, assign point `i` to `baseMs + floor(i * gap / k)`; use the next distinct timestamp gap, or for the final group the preceding positive gap, or `1000ms` if no distinct gap exists. Reject source-order reversals and any result that is not strictly increasing.

- [ ] **Step 1: Write the failing asset schema tests**

Create `packages/runtime-contracts/test/assets.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetSeedManifestJsonSchema,
  assetSeedManifestSchema,
  resolvedAssetAccessJsonSchema,
  resolvedAssetAccessSchema,
  type AssetSeedManifest
} from '../src/index.js';

const fingerprint = `sha256:${'a'.repeat(64)}`;

function validManifest(): AssetSeedManifest {
  return {
    schemaVersion: 'ise-assets/v1',
    assets: [{
      assetId: 'model:jf17',
      kind: 'model',
      displayName: 'JF-17',
      aliases: ['JF-17 Thunder'],
      fingerprint,
      sourceRelativePath: 'models/JF-17.glb',
      objectName: 'demo/models/JF-17.glb',
      mediaType: 'model/gltf-binary',
      size: 1466636,
      availability: 'available',
      criticality: 'required',
      fallbackAssetIds: [],
      allowFallback: false,
      model: {
        scale: 1,
        rotationOffsetDeg: [0, 0, 90],
        altitudeOffsetM: 0,
        entityTypes: ['aircraft']
      }
    }],
    nameMappings: [{
      sourceName: 'JF-17',
      sourceKind: 'model',
      assetId: 'model:jf17',
      note: 'The GLB source is authoritative for this mapping.'
    }]
  };
}

test('accepts a strict model seed entry with separate availability and criticality', () => {
  const parsed = assetSeedManifestSchema.parse(validManifest());
  const entry = parsed.assets[0];
  assert.equal(entry?.availability, 'available');
  assert.equal(entry?.criticality, 'required');
  assert.equal(entry?.kind, 'model');
  if (entry?.kind !== 'model') assert.fail('Expected model entry');
  assert.deepEqual(entry.model.rotationOffsetDeg, [0, 0, 90]);
});

test('rejects uppercase fingerprints, absolute paths, traversal, and unknown fields', () => {
  const uppercase = validManifest() as AssetSeedManifest & { assets: any[] };
  uppercase.assets[0].fingerprint = `sha256:${'A'.repeat(64)}`;
  assert.equal(assetSeedManifestSchema.safeParse(uppercase).success, false);

  const absolute = validManifest() as AssetSeedManifest & { assets: any[] };
  absolute.assets[0].sourceRelativePath = 'C:\\assets\\JF-17.glb';
  assert.equal(assetSeedManifestSchema.safeParse(absolute).success, false);

  const traversal = validManifest() as AssetSeedManifest & { assets: any[] };
  traversal.assets[0].objectName = '../outside/JF-17.glb';
  assert.equal(assetSeedManifestSchema.safeParse(traversal).success, false);

  const unknown = validManifest() as AssetSeedManifest & { assets: any[] };
  unknown.assets[0].localPath = '/tmp/JF-17.glb';
  assert.equal(assetSeedManifestSchema.safeParse(unknown).success, false);
});

test('rejects duplicate assets and unresolved fallbacks or name mappings', () => {
  const duplicate = validManifest();
  duplicate.assets.push(duplicate.assets[0]!);
  assert.equal(assetSeedManifestSchema.safeParse(duplicate).success, false);

  const fallback = validManifest() as AssetSeedManifest & { assets: any[] };
  fallback.assets[0].fallbackAssetIds = ['model:missing'];
  assert.equal(assetSeedManifestSchema.safeParse(fallback).success, false);

  const mapping = validManifest();
  mapping.nameMappings[0]!.assetId = 'model:missing';
  assert.equal(assetSeedManifestSchema.safeParse(mapping).success, false);
});

test('accepts resolved access but rejects storage and seed-only fields', () => {
  const access = {
    assetId: 'model:jf17',
    url: 'https://minio.example.test/signed-object',
    fingerprint,
    mediaType: 'model/gltf-binary',
    size: 1466636,
    expiresAt: '2026-07-15T12:05:00.000Z',
    model: {
      scale: 1,
      rotationOffsetDeg: [0, 0, 90],
      altitudeOffsetM: 0,
      entityTypes: ['aircraft']
    }
  };
  assert.equal(resolvedAssetAccessSchema.safeParse(access).success, true);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, objectName: 'secret/key' }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, availability: 'available' }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, criticality: 'required' }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, fallbackAssetIds: [] }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, allowFallback: false }).success, false);
});

test('exports strict seed and resolved-access JSON Schemas', () => {
  assert.equal(assetSeedManifestJsonSchema.additionalProperties, false);
  assert.equal(assetSeedManifestJsonSchema.properties?.schemaVersion?.const, 'ise-assets/v1');
  assert.equal(resolvedAssetAccessJsonSchema.additionalProperties, false);
});
```

- [ ] **Step 2: Run the asset tests and verify the missing-export failure**

Run: `npm exec -w @ise/runtime-contracts -- tsx --test test/assets.test.ts`

Expected: FAIL because the asset manifest and resolved-access exports do not exist.

- [ ] **Step 3: Implement strict manifest and resolved-access schemas**

Create `packages/runtime-contracts/src/assets.ts`:

```ts
import { z } from 'zod';

export const assetIdSchema = z.string().regex(
  /^(model|trajectory|video|image|geojson):[a-z0-9][a-z0-9._-]*$/
);
export const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const safeRelativePath = z.string().trim().min(1).superRefine((value, context) => {
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    context.addIssue({ code: 'custom', message: 'Path must be relative and use forward slashes' });
  }
  if (value.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    context.addIssue({ code: 'custom', message: 'Path contains an unsafe segment' });
  }
});

export const modelAssetMetadataSchema = z.strictObject({
  scale: z.number().finite().positive(),
  rotationOffsetDeg: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite()
  ]),
  altitudeOffsetM: z.number().finite(),
  entityTypes: z.array(z.enum(['aircraft', 'missile', 'other'])).min(1)
});

export const trajectoryAssetMetadataSchema = z.strictObject({
  format: z.literal('ise-trajectory/v1'),
  timeUnit: z.literal('ms'),
  coordinateOrder: z.literal('lng-lat-alt'),
  startTimeMs: z.number().int().nonnegative(),
  endTimeMs: z.number().int().nonnegative(),
  monotonic: z.literal(true)
}).refine(value => value.endTimeMs >= value.startTimeMs, {
  message: 'endTimeMs must be greater than or equal to startTimeMs',
  path: ['endTimeMs']
});

export const videoAssetMetadataSchema = z.strictObject({
  durationMs: z.number().int().positive(),
  codec: z.string().trim().min(1)
});

export const imageAssetMetadataSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fit: z.enum(['contain', 'cover'])
});

const commonEntryShape = {
  displayName: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)),
  fingerprint: fingerprintSchema,
  sourceRelativePath: safeRelativePath,
  objectName: safeRelativePath,
  size: z.number().int().nonnegative(),
  availability: z.enum(['available', 'missing', 'invalid']),
  criticality: z.enum(['required', 'optional']),
  fallbackAssetIds: z.array(assetIdSchema),
  allowFallback: z.boolean()
};

const modelEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^model:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('model'),
  mediaType: z.literal('model/gltf-binary'),
  model: modelAssetMetadataSchema
});
const trajectoryEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^trajectory:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('trajectory'),
  mediaType: z.literal('application/vnd.ise.trajectory+json'),
  trajectory: trajectoryAssetMetadataSchema
});
const videoEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^video:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('video'),
  mediaType: z.literal('video/mp4'),
  video: videoAssetMetadataSchema
});
const imageEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^image:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('image'),
  mediaType: z.enum(['image/png', 'image/jpeg']),
  image: imageAssetMetadataSchema
});
const geojsonEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^geojson:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('geojson'),
  mediaType: z.literal('application/geo+json')
});

export const assetManifestEntrySchema = z.discriminatedUnion('kind', [
  modelEntrySchema,
  trajectoryEntrySchema,
  videoEntrySchema,
  imageEntrySchema,
  geojsonEntrySchema
]);
export type AssetManifestEntry = z.infer<typeof assetManifestEntrySchema>;

export const assetNameMappingSchema = z.strictObject({
  sourceName: z.string().trim().min(1),
  sourceKind: z.enum(['report', 'trajectory', 'model', 'operator']),
  assetId: assetIdSchema,
  note: z.string().trim().min(1)
});

const assetSeedManifestBaseSchema = z.strictObject({
  schemaVersion: z.literal('ise-assets/v1'),
  assets: z.array(assetManifestEntrySchema).min(1),
  nameMappings: z.array(assetNameMappingSchema)
});

export const assetSeedManifestSchema = assetSeedManifestBaseSchema.superRefine((manifest, context) => {
  const assetIds = new Set<string>();
  const objectNames = new Set<string>();
  const sourcePaths = new Set<string>();
  for (const [index, entry] of manifest.assets.entries()) {
    for (const [value, seen, field] of [
      [entry.assetId, assetIds, 'assetId'],
      [entry.objectName, objectNames, 'objectName'],
      [entry.sourceRelativePath, sourcePaths, 'sourceRelativePath']
    ] as const) {
      if (seen.has(value)) {
        context.addIssue({ code: 'custom', path: ['assets', index, field], message: `Duplicate ${field}` });
      }
      seen.add(value);
    }
  }
  for (const [index, entry] of manifest.assets.entries()) {
    if (!entry.allowFallback && entry.fallbackAssetIds.length > 0) {
      context.addIssue({ code: 'custom', path: ['assets', index, 'allowFallback'], message: 'Fallback IDs require allowFallback' });
    }
    for (const fallback of entry.fallbackAssetIds) {
      if (!assetIds.has(fallback) || fallback === entry.assetId) {
        context.addIssue({ code: 'custom', path: ['assets', index, 'fallbackAssetIds'], message: 'Fallback must reference another manifest asset' });
      }
    }
  }
  for (const [index, mapping] of manifest.nameMappings.entries()) {
    if (!assetIds.has(mapping.assetId)) {
      context.addIssue({ code: 'custom', path: ['nameMappings', index, 'assetId'], message: 'Mapping references an unknown assetId' });
    }
  }
});
export type AssetSeedManifest = z.infer<typeof assetSeedManifestSchema>;

const resolvedAssetAccessBaseSchema = z.strictObject({
  assetId: assetIdSchema,
  url: z.url(),
  fingerprint: fingerprintSchema,
  mediaType: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/),
  size: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime({ offset: true }),
  model: modelAssetMetadataSchema.optional(),
  trajectory: trajectoryAssetMetadataSchema.optional(),
  video: videoAssetMetadataSchema.optional(),
  image: imageAssetMetadataSchema.optional()
});

export const resolvedAssetAccessSchema = resolvedAssetAccessBaseSchema.superRefine((value, context) => {
  const metadataKeys = ['model', 'trajectory', 'video', 'image'] as const;
  const present = metadataKeys.filter(key => value[key] !== undefined);
  const expected = value.assetId.split(':', 1)[0];
  if (expected === 'geojson' && present.length !== 0) {
    context.addIssue({ code: 'custom', message: 'GeoJSON access must not include typed media metadata' });
  } else if (expected !== 'geojson' && (present.length !== 1 || present[0] !== expected)) {
    context.addIssue({ code: 'custom', message: `Resolved metadata must match ${expected}` });
  }
});
export type ResolvedAssetAccess = z.infer<typeof resolvedAssetAccessSchema>;

export const assetSeedManifestJsonSchema = z.toJSONSchema(assetSeedManifestBaseSchema, {
  target: 'draft-2020-12'
});
export const resolvedAssetAccessJsonSchema = z.toJSONSchema(resolvedAssetAccessBaseSchema, {
  target: 'draft-2020-12'
});
```

- [ ] **Step 4: Export assets and run the focused green test**

Append to `packages/runtime-contracts/src/index.ts`:

```ts
export * from './assets.js';
```

Run: `npm exec -w @ise/runtime-contracts -- tsx --test test/assets.test.ts`

Expected: PASS, 5 tests, 0 failures.

- [ ] **Step 5: Write the failing deterministic trajectory tests**

Create `packages/runtime-contracts/test/trajectory.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTrajectorySamples, trajectorySchema } from '../src/index.js';

const point = (timestamp: string, longitude: number) => ({
  timestamp,
  latitude: 30.4,
  longitude,
  altitude: 1000
});

test('normalizes source fields to relative milliseconds and canonical names', () => {
  const output = normalizeTrajectorySamples([
    point('2025-05-07 00:00:08', 76.8),
    point('2025-05-07 00:00:09', 76.9)
  ]);
  assert.deepEqual(output, {
    schemaVersion: 'ise-trajectory/v1',
    points: [
      { timeMs: 0, longitude: 76.8, latitude: 30.4, altitudeM: 1000 },
      { timeMs: 1000, longitude: 76.9, latitude: 30.4, altitudeM: 1000 }
    ]
  });
  assert.equal(trajectorySchema.safeParse(output).success, true);
});

test('spreads duplicate timestamps across the next positive gap in source order', () => {
  const output = normalizeTrajectorySamples([
    point('2025-05-07 00:00:08', 76.80),
    point('2025-05-07 00:00:08', 76.81),
    point('2025-05-07 00:00:09', 76.82)
  ]);
  assert.deepEqual(output.points.map(value => value.timeMs), [0, 500, 1000]);
  assert.deepEqual(output.points.map(value => value.longitude), [76.80, 76.81, 76.82]);
});

test('uses the previous gap for a duplicate terminal group', () => {
  const output = normalizeTrajectorySamples([
    point('2025-05-07 00:00:08', 76.80),
    point('2025-05-07 00:00:09', 76.81),
    point('2025-05-07 00:00:09', 76.82),
    point('2025-05-07 00:00:09', 76.83)
  ]);
  assert.deepEqual(output.points.map(value => value.timeMs), [0, 1000, 1333, 1666]);
});

test('uses a 1000ms gap when every timestamp is identical', () => {
  const output = normalizeTrajectorySamples([
    point('2025-05-07 00:00:08', 76.80),
    point('2025-05-07 00:00:08', 76.81),
    point('2025-05-07 00:00:08', 76.82)
  ]);
  assert.deepEqual(output.points.map(value => value.timeMs), [0, 333, 666]);
});

test('rejects source-order reversal, invalid coordinates, and an unspreadable group', () => {
  assert.throws(() => normalizeTrajectorySamples([
    point('2025-05-07 00:00:09', 76.8),
    point('2025-05-07 00:00:08', 76.9)
  ]), /source order/);
  assert.throws(() => normalizeTrajectorySamples([
    { ...point('2025-05-07 00:00:08', 76.8), latitude: 91 },
    point('2025-05-07 00:00:09', 76.9)
  ]));
  assert.throws(() => normalizeTrajectorySamples([
    point('2025-05-07 00:00:08.000', 76.80),
    point('2025-05-07 00:00:08.000', 76.81),
    point('2025-05-07 00:00:08.001', 76.82)
  ]), /strictly increasing/);
});
```

- [ ] **Step 6: Run the trajectory tests and verify the missing-export failure**

Run: `npm exec -w @ise/runtime-contracts -- tsx --test test/trajectory.test.ts`

Expected: FAIL because `normalizeTrajectorySamples` and `trajectorySchema` do not exist.

- [ ] **Step 7: Implement deterministic normalization without sorting**

Create `packages/runtime-contracts/src/trajectory.ts`:

```ts
import { z } from 'zod';

export const rawTrajectorySampleSchema = z.strictObject({
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  altitude: z.number().finite()
});
export type RawTrajectorySample = z.infer<typeof rawTrajectorySampleSchema>;

export const trajectoryPointSchema = z.strictObject({
  timeMs: z.number().int().nonnegative(),
  longitude: z.number().finite().min(-180).max(180),
  latitude: z.number().finite().min(-90).max(90),
  altitudeM: z.number().finite()
});

export const trajectorySchema = z.strictObject({
  schemaVersion: z.literal('ise-trajectory/v1'),
  points: z.array(trajectoryPointSchema).min(2)
}).superRefine((trajectory, context) => {
  for (let index = 1; index < trajectory.points.length; index += 1) {
    if (trajectory.points[index]!.timeMs <= trajectory.points[index - 1]!.timeMs) {
      context.addIssue({ code: 'custom', path: ['points', index, 'timeMs'], message: 'Trajectory time must be strictly increasing' });
    }
  }
});
export type NormalizedTrajectory = z.infer<typeof trajectorySchema>;

function parseTimestampUtc(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) throw new Error(`Invalid trajectory timestamp: ${value}`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, '0'));
  const parsed = Date.UTC(year, month, day, hour, minute, second, millisecond);
  const check = new Date(parsed);
  if (
    check.getUTCFullYear() !== year || check.getUTCMonth() !== month ||
    check.getUTCDate() !== day || check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second ||
    check.getUTCMilliseconds() !== millisecond
  ) {
    throw new Error(`Invalid trajectory timestamp: ${value}`);
  }
  return parsed;
}

export function normalizeTrajectorySamples(input: RawTrajectorySample[]): NormalizedTrajectory {
  const samples = z.array(rawTrajectorySampleSchema).min(2).parse(input);
  const groups: Array<{ parsedMs: number; samples: RawTrajectorySample[] }> = [];
  for (const sample of samples) {
    const parsedMs = parseTimestampUtc(sample.timestamp);
    const previous = groups.at(-1);
    if (previous && parsedMs < previous.parsedMs) {
      throw new Error('Trajectory timestamps reverse source order');
    }
    if (previous?.parsedMs === parsedMs) previous.samples.push(sample);
    else groups.push({ parsedMs, samples: [sample] });
  }

  const originMs = groups[0]!.parsedMs;
  const points = groups.flatMap((group, groupIndex) => {
    const next = groups[groupIndex + 1];
    const previous = groups[groupIndex - 1];
    const gap = next
      ? next.parsedMs - group.parsedMs
      : previous
        ? group.parsedMs - previous.parsedMs
        : 1000;
    const baseMs = group.parsedMs - originMs;
    return group.samples.map((sample, index) => ({
      timeMs: baseMs + Math.floor(index * gap / group.samples.length),
      longitude: sample.longitude,
      latitude: sample.latitude,
      altitudeM: sample.altitude
    }));
  });

  return trajectorySchema.parse({ schemaVersion: 'ise-trajectory/v1', points });
}
```

Append to `packages/runtime-contracts/src/index.ts`:

```ts
export * from './trajectory.js';
```

Run: `npm exec -w @ise/runtime-contracts -- tsx --test test/trajectory.test.ts`

Expected: PASS, 5 tests, 0 failures.

- [ ] **Step 8: Write the failing byte-preparation tests**

Create `packages/runtime-contracts/test/prepare-asset.test.ts`:

```ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  normalizeTrajectorySamples,
  prepareAssetForUpload,
  type AssetManifestEntry,
  type RawTrajectorySample
} from '../src/index.js';

const fingerprint = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function glbBytes(): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set(new TextEncoder().encode('glTF'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  return bytes;
}

function modelEntry(bytes: Uint8Array): AssetManifestEntry {
  return {
    assetId: 'model:jf17',
    kind: 'model',
    displayName: 'JF-17',
    aliases: [],
    fingerprint: fingerprint(bytes),
    sourceRelativePath: 'models/JF-17.glb',
    objectName: 'demo/models/JF-17.glb',
    mediaType: 'model/gltf-binary',
    size: bytes.byteLength,
    availability: 'available',
    criticality: 'required',
    fallbackAssetIds: [],
    allowFallback: false,
    model: { scale: 1, rotationOffsetDeg: [0, 0, 90], altitudeOffsetM: 0, entityTypes: ['aircraft'] }
  };
}

test('returns valid non-trajectory bytes unchanged', async () => {
  const bytes = glbBytes();
  const prepared = await prepareAssetForUpload(modelEntry(bytes), bytes);
  assert.equal(prepared, bytes);
});

test('rejects fingerprint, declared size, and GLB magic mismatches', async () => {
  const bytes = glbBytes();
  await assert.rejects(
    prepareAssetForUpload({ ...modelEntry(bytes), fingerprint: `sha256:${'0'.repeat(64)}` }, bytes),
    /fingerprint/
  );
  await assert.rejects(
    prepareAssetForUpload({ ...modelEntry(bytes), size: 13 }, bytes),
    /size/
  );
  const badMagic = bytes.slice();
  badMagic[0] = 0;
  await assert.rejects(prepareAssetForUpload(modelEntry(badMagic), badMagic), /GLB/);
});

test('normalizes trajectory JSON before size and fingerprint validation', async () => {
  const raw: RawTrajectorySample[] = [
    { timestamp: '2025-05-07 00:00:08', latitude: 30.4, longitude: 76.80, altitude: 1000 },
    { timestamp: '2025-05-07 00:00:08', latitude: 30.4, longitude: 76.81, altitude: 1100 },
    { timestamp: '2025-05-07 00:00:09', latitude: 30.4, longitude: 76.82, altitude: 1200 }
  ];
  const expected = new TextEncoder().encode(JSON.stringify(normalizeTrajectorySamples(raw)));
  const source = new TextEncoder().encode(JSON.stringify(raw, null, 2));
  const entry: AssetManifestEntry = {
    assetId: 'trajectory:ambala-rafale-1',
    kind: 'trajectory',
    displayName: 'Ambala Rafale 1',
    aliases: [],
    fingerprint: fingerprint(expected),
    sourceRelativePath: 'trajectories/AMBALA Rafale-1.json',
    objectName: 'demo/trajectories/ambala-rafale-1.json',
    mediaType: 'application/vnd.ise.trajectory+json',
    size: expected.byteLength,
    availability: 'available',
    criticality: 'required',
    fallbackAssetIds: [],
    allowFallback: false,
    trajectory: {
      format: 'ise-trajectory/v1',
      timeUnit: 'ms',
      coordinateOrder: 'lng-lat-alt',
      startTimeMs: 0,
      endTimeMs: 1000,
      monotonic: true
    }
  };
  assert.deepEqual(await prepareAssetForUpload(entry, source), expected);
});

test('validates MP4, PNG/JPEG, and GeoJSON magic before returning bytes', async () => {
  const mp4 = new Uint8Array(12);
  mp4.set(new TextEncoder().encode('ftyp'), 4);
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const geojson = new TextEncoder().encode('{"type":"FeatureCollection","features":[]}');
  const common = {
    displayName: 'fixture', aliases: [], availability: 'available' as const,
    criticality: 'optional' as const, fallbackAssetIds: [], allowFallback: false
  };
  const entries: Array<[AssetManifestEntry, Uint8Array]> = [
    [{ ...common, assetId: 'video:missile-impact', kind: 'video', fingerprint: fingerprint(mp4), sourceRelativePath: 'video/impact.mp4', objectName: 'demo/video/impact.mp4', mediaType: 'video/mp4', size: mp4.byteLength, video: { durationMs: 1000, codec: 'h264' } }, mp4],
    [{ ...common, assetId: 'image:ground-radar', kind: 'image', fingerprint: fingerprint(png), sourceRelativePath: 'image/radar.png', objectName: 'demo/image/radar.png', mediaType: 'image/png', size: png.byteLength, image: { width: 1, height: 1, fit: 'contain' } }, png],
    [{ ...common, assetId: 'image:aew-illustration', kind: 'image', fingerprint: fingerprint(jpeg), sourceRelativePath: 'image/aew.jpg', objectName: 'demo/image/aew.jpg', mediaType: 'image/jpeg', size: jpeg.byteLength, image: { width: 1, height: 1, fit: 'contain' } }, jpeg],
    [{ ...common, assetId: 'geojson:airspace', kind: 'geojson', fingerprint: fingerprint(geojson), sourceRelativePath: 'geo/airspace.geojson', objectName: 'demo/geo/airspace.geojson', mediaType: 'application/geo+json', size: geojson.byteLength }, geojson]
  ];
  for (const [entry, bytes] of entries) {
    assert.equal(await prepareAssetForUpload(entry, bytes), bytes);
  }
});
```

- [ ] **Step 9: Run the preparation tests and verify the missing-function failure**

Run: `npm exec -w @ise/runtime-contracts -- tsx --test test/prepare-asset.test.ts`

Expected: FAIL because `prepareAssetForUpload` does not exist.

- [ ] **Step 10: Implement canonical upload preparation and magic validation**

Create `packages/runtime-contracts/src/prepareAssetForUpload.ts`:

```ts
import { assetManifestEntrySchema, type AssetManifestEntry } from './assets.js';
import { normalizeTrajectorySamples, rawTrajectorySampleSchema } from './trajectory.js';
import { z } from 'zod';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${[...digest].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function validateGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 12 || decoder.decode(bytes.subarray(0, 4)) !== 'glTF') {
    throw new Error('Invalid GLB magic');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 2) throw new Error('Invalid GLB version');
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('Invalid GLB declared length');
}

function validateMp4(bytes: Uint8Array) {
  if (bytes.byteLength < 12 || decoder.decode(bytes.subarray(4, 8)) !== 'ftyp') {
    throw new Error('Invalid MP4 magic');
  }
}

function validateImage(entry: Extract<AssetManifestEntry, { kind: 'image' }>, bytes: Uint8Array) {
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (entry.mediaType === 'image/png' && !png) throw new Error('Invalid PNG magic');
  if (entry.mediaType === 'image/jpeg' && !jpeg) throw new Error('Invalid JPEG magic');
}

function validateGeoJson(bytes: Uint8Array) {
  const value = JSON.parse(decoder.decode(bytes)) as { type?: unknown };
  const allowed = new Set([
    'Feature', 'FeatureCollection', 'Point', 'MultiPoint', 'LineString',
    'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'
  ]);
  if (typeof value !== 'object' || value === null || !allowed.has(String(value.type))) {
    throw new Error('Invalid GeoJSON root type');
  }
}

function prepareTrajectory(entry: Extract<AssetManifestEntry, { kind: 'trajectory' }>, bytes: Uint8Array) {
  const raw = z.array(rawTrajectorySampleSchema).min(2).parse(JSON.parse(decoder.decode(bytes)));
  const normalized = normalizeTrajectorySamples(raw);
  const first = normalized.points[0]!;
  const last = normalized.points.at(-1)!;
  if (entry.trajectory.startTimeMs !== first.timeMs || entry.trajectory.endTimeMs !== last.timeMs) {
    throw new Error('Trajectory metadata time range does not match normalized bytes');
  }
  return encoder.encode(JSON.stringify(normalized));
}

export async function prepareAssetForUpload(
  inputEntry: AssetManifestEntry,
  sourceBytes: Uint8Array
): Promise<Uint8Array> {
  const entry = assetManifestEntrySchema.parse(inputEntry);
  let prepared = sourceBytes;
  if (entry.kind === 'trajectory') prepared = prepareTrajectory(entry, sourceBytes);
  else if (entry.kind === 'model') validateGlb(sourceBytes);
  else if (entry.kind === 'video') validateMp4(sourceBytes);
  else if (entry.kind === 'image') validateImage(entry, sourceBytes);
  else validateGeoJson(sourceBytes);

  if (prepared.byteLength !== entry.size) {
    throw new Error(`Asset size mismatch for ${entry.assetId}`);
  }
  if (await sha256(prepared) !== entry.fingerprint) {
    throw new Error(`Asset fingerprint mismatch for ${entry.assetId}`);
  }
  return prepared;
}
```

Append to `packages/runtime-contracts/src/index.ts`:

```ts
export * from './prepareAssetForUpload.js';
```

- [ ] **Step 11: Add all current contract tests to the package gate and run it**

Set `packages/runtime-contracts/package.json` test script to:

```json
{
  "test": "tsx --test test/scene.test.ts test/assets.test.ts test/trajectory.test.ts test/prepare-asset.test.ts"
}
```

Run: `npm run test -w @ise/runtime-contracts`

Expected: PASS, 19 tests, 0 failures.

Run: `npm run typecheck -w @ise/runtime-contracts`

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 12: Commit the asset, access, and canonical-byte contract**

```powershell
git add packages/runtime-contracts/package.json packages/runtime-contracts/src/assets.ts packages/runtime-contracts/src/trajectory.ts packages/runtime-contracts/src/prepareAssetForUpload.ts packages/runtime-contracts/src/index.ts packages/runtime-contracts/test/assets.test.ts packages/runtime-contracts/test/trajectory.test.ts packages/runtime-contracts/test/prepare-asset.test.ts
git diff --cached --check
git commit -m "feat: freeze asset and trajectory contracts"
```

Expected: commit succeeds; it contains no MinIO calls and no raw demo asset.

### Task 4: Seed Manifest Validator, Frozen IDs, and Consumer Baseline

**Files:**
- Create: `packages/runtime-contracts/src/validateAssetSeed.ts`
- Create: `packages/runtime-contracts/src/validateAssetSeedCli.ts`
- Create: `packages/runtime-contracts/test/validate-asset-seed.test.ts`
- Create: `packages/runtime-contracts/test/public-types.ts`
- Create: `packages/runtime-contracts/test/fixtures/asset-seed.valid.json`
- Create: `provenance/ASSET-SEED.md`
- Modify: `packages/runtime-contracts/package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/api/package.json`
- Modify: `agent/package.json`
- Modify: `package.json`
- Modify: `package-lock.json` through `npm install`

**Interfaces:**
- Consumes: `assetSeedManifestSchema` and UTF-8 JSON from an operator-selected path below the invoking working directory.
- Produces: `validateAssetSeedFile(filePath: string | URL): Promise<AssetSeedManifest>` and CLI output `Validated <count> assets from <absolute-path>`; validation performs no network call and no upload.
- Produces: root command `npm run assets:validate -- <manifest-path>`.
- Produces: local workspace dependencies on `@ise/runtime-contracts` for `@ise/web`, `@ise/api`, and `@ise/agent` without any competing lockfile edit in later worktrees.
- Freezes the six model IDs, eight video IDs, four image IDs, three initial trajectory IDs, and the general trajectory naming rule listed in `provenance/ASSET-SEED.md` below.

- [ ] **Step 1: Write the failing file-validator tests and valid fixture**

Create `packages/runtime-contracts/test/fixtures/asset-seed.valid.json`:

```json
{
  "schemaVersion": "ise-assets/v1",
  "assets": [
    {
      "assetId": "geojson:contract-fixture",
      "kind": "geojson",
      "displayName": "Contract fixture",
      "aliases": [],
      "fingerprint": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "sourceRelativePath": "fixtures/contract.geojson",
      "objectName": "test/fixtures/contract.geojson",
      "mediaType": "application/geo+json",
      "size": 0,
      "availability": "missing",
      "criticality": "optional",
      "fallbackAssetIds": [],
      "allowFallback": false
    }
  ],
  "nameMappings": []
}
```

Create `packages/runtime-contracts/test/validate-asset-seed.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateAssetSeedFile } from '../src/validateAssetSeed.js';

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
```

- [ ] **Step 2: Run the validator tests and verify the missing-module failure**

Run: `npm exec -w @ise/runtime-contracts -- tsx --test test/validate-asset-seed.test.ts`

Expected: FAIL because `src/validateAssetSeed.ts` does not exist.

- [ ] **Step 3: Implement the non-uploading validator and CLI**

Create `packages/runtime-contracts/src/validateAssetSeed.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { assetSeedManifestSchema, type AssetSeedManifest } from './assets.js';

export async function validateAssetSeedFile(filePath: string | URL): Promise<AssetSeedManifest> {
  const source = await readFile(filePath, 'utf8');
  return assetSeedManifestSchema.parse(JSON.parse(source));
}
```

Create `packages/runtime-contracts/src/validateAssetSeedCli.ts`:

```ts
import path from 'node:path';
import { validateAssetSeedFile } from './validateAssetSeed.js';

const argument = process.argv[2];
if (!argument) {
  console.error('Usage: npm run assets:validate -- <manifest-path>');
  process.exitCode = 2;
} else {
  const invokingDirectory = process.env.INIT_CWD ?? process.cwd();
  const absolutePath = path.resolve(invokingDirectory, argument);
  try {
    const manifest = await validateAssetSeedFile(absolutePath);
    console.log(`Validated ${manifest.assets.length} assets from ${absolutePath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
```

Run: `npm exec -w @ise/runtime-contracts -- tsx --test test/validate-asset-seed.test.ts`

Expected: PASS, 2 tests, 0 failures.

- [ ] **Step 4: Freeze the seed IDs, source aliases, units, and API handoff**

Create `provenance/ASSET-SEED.md`:

```markdown
# Asset seed contract and provenance

Date: 2026-07-15

## Stable IDs

| Kind | Stable asset ID | Current operator source name |
| --- | --- | --- |
| model | `model:j10` | `J-10.glb` |
| model | `model:jf17` | `JF-17.glb` |
| model | `model:mig29` | `MiG-29.glb` |
| model | `model:pl15e` | `pl-15e.glb` |
| model | `model:rafale` | `Refale.glb`; the source spelling is retained only as an alias |
| model | `model:su30mki` | `SU-30MKI.glb` |
| video | `video:ooda-chain` | `ooda作战链示例视频.mp4` |
| video | `video:runway-exit` | `冲出跑道.mp4` |
| video | `video:missile-impact` | `导弹击中飞机.mp4` |
| video | `video:cockpit-jamming` | `座舱被全频段干扰.mp4` |
| video | `video:damage-check` | `检查基本完好无损.mp4` |
| video | `video:bomb-explosion` | `炸弹爆炸的视频.mp4` |
| video | `video:radar-offline` | `红灯闪烁，offline.mp4` |
| video | `video:target-lock` | `锁定目标.mp4` |
| image | `image:ground-radar` | `地面雷达.png` |
| image | `image:cockpit-hud` | `座舱HUD.png` |
| image | `image:airport` | `机场.png` |
| image | `image:aew-illustration` | `预警机插图.png` |
| trajectory | `trajectory:ambala-rafale-1` | `AMBALA Rafale-1.json` |
| trajectory | `trajectory:minhas-j10ce-1` | `MINAS J-10CE-1.json`; the source spelling conflict is explicit |
| trajectory | `trajectory:pakistan-missile-1` | `巴方导弹1.json` |

Every additional trajectory ID is `trajectory:<origin-or-side>-<platform>-<ordinal>` in lowercase kebab case. Source spelling never silently changes the stable ID; `nameMappings` records report, trajectory, model, and operator contexts explicitly, including the J-10/J-10CE and JF-17 naming cases.

## Manifest fields

- `sourceRelativePath` is a forward-slash path below the operator-provided asset root. It is seed input only and never appears in RuntimePlan or ResolvedAssetAccess.
- `objectName` is the MinIO object name selected by the API seed CLI. It is never returned to Web or Agent.
- `availability` is exactly `available`, `missing`, or `invalid`; `criticality` is independently exactly `required` or `optional`.
- `allowFallback` must be true before `fallbackAssetIds` may contain another registered asset; both fields remain seed policy and are absent from ResolvedAssetAccess.
- `fingerprint` and `size` describe the prepared bytes that are uploaded. For trajectories they describe canonical `ise-trajectory/v1` bytes, not the original timestamp/latitude/longitude/altitude JSON.
- Model `scale` is unitless, `rotationOffsetDeg` is `[x, y, z]` in degrees, and `altitudeOffsetM` is meters.
- Trajectory metadata is exactly `{ format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt', startTimeMs, endTimeMs, monotonic: true }`.
- Video `durationMs` is milliseconds and `codec` is the probed codec name. Image `width` and `height` are pixels.

## Canonical trajectory bytes

Raw source arrays are parsed in source order. Timestamps are interpreted deterministically as UTC, distinct timestamp reversal is invalid, and equal timestamp groups use the frozen gap-allocation algorithm tested in `packages/runtime-contracts/test/trajectory.test.ts`. Canonical upload bytes are UTF-8 `JSON.stringify` output of `{ "schemaVersion": "ise-trajectory/v1", "points": [...] }` with no trailing newline.

## Upload handoff

Foundation validation is local and non-networking. The API seed CLI receives a validated `AssetManifestEntry`, reads `sourceRelativePath` below an operator-selected root, calls `prepareAssetForUpload(entry, sourceBytes)`, uploads the returned bytes to `objectName`, and only then records `availability: 'available'`. Required entries that are missing, invalid, or fingerprint-mismatched block publication.
```

- [ ] **Step 5: Add the validator command and all contract tests to the package gate**

Set `packages/runtime-contracts/package.json` scripts to:

```json
{
  "test": "tsx --test test/scene.test.ts test/assets.test.ts test/trajectory.test.ts test/prepare-asset.test.ts test/validate-asset-seed.test.ts",
  "typecheck": "tsc --noEmit",
  "validate:assets": "tsx src/validateAssetSeedCli.ts"
}
```

Keep the other package fields and dependencies from Task 2 unchanged.

Add to the root `package.json` scripts:

```json
{
  "assets:validate": "npm run validate:assets -w @ise/runtime-contracts --"
}
```

Run: `npm run assets:validate -- packages/runtime-contracts/test/fixtures/asset-seed.valid.json`

Expected: PASS and print `Validated 1 assets from` followed by the absolute fixture path.

- [ ] **Step 6: Add the frozen local contract dependency to all three consumers**

Add this dependency to both `apps/web/package.json` and `apps/api/package.json`:

```json
{
  "@ise/runtime-contracts": "file:../../packages/runtime-contracts"
}
```

Add this dependency to `agent/package.json`:

```json
{
  "@ise/runtime-contracts": "file:../packages/runtime-contracts"
}
```

Place each entry inside the existing `dependencies` object, keep the exact package names `@ise/web`, `@ise/api`, and `@ise/agent`, and do not add imports to application source in this foundation task.

Run: `npm install`

Expected: PASS, update only the root `package-lock.json`, and link all three consumers to the same local `@ise/runtime-contracts` workspace.

- [ ] **Step 7: Verify the exact public export surface**

Create `packages/runtime-contracts/test/public-types.ts`:

```ts
import type {
  AssetManifestEntry,
  AssetSeedManifest,
  Diagnostic,
  ResolvedAssetAccess,
  SceneProjectConfig,
  SceneTrack,
  SceneTrackItem
} from '../src/index.js';

export type PublicContractTypeSurface = {
  assetManifestEntry: AssetManifestEntry;
  assetSeedManifest: AssetSeedManifest;
  diagnostic: Diagnostic;
  resolvedAssetAccess: ResolvedAssetAccess;
  sceneProjectConfig: SceneProjectConfig;
  sceneTrack: SceneTrack;
  sceneTrackItem: SceneTrackItem;
};
```

Run:

```powershell
npm exec -w @ise/runtime-contracts -- tsx -e "import * as c from './src/index.ts'; const names=['sceneProjectConfigSchema','assetSeedManifestSchema','assetManifestEntrySchema','resolvedAssetAccessSchema','prepareAssetForUpload']; if (names.some(name => !(name in c))) process.exit(1); console.log(names.join('\n'))"
```

Expected: print all five runtime exports once. `test/public-types.ts` imports every frozen type name, so the following TypeScript gate proves the type-only exports without manufacturing runtime values for TypeScript-only names.

Run: `npm run test -w @ise/runtime-contracts`

Expected: PASS, 21 tests, 0 failures.

Run: `npm run typecheck -w @ise/runtime-contracts`

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 8: Run the full foundation gate with non-secret test environment values**

```powershell
$env:JWT_SECRET='foundation-test-secret-at-least-32-characters'
$env:MAIL_USER='operator@example.test'
$env:MAIL_PASS='foundation-test-mail-password'
$env:MAIL_FROM='no-reply@example.test'
$env:DATABASE_URL='postgresql://ise:ise@127.0.0.1:5432/ise_test'
$env:MINIO_ACCESS_KEY='foundation-test-access'
$env:MINIO_SECRET_KEY='foundation-test-secret'
npm run check
```

Expected: PASS for workspace typechecks, unit tests, and builds. This gate does not start PostgreSQL, Redis, MinIO, Mapbox, or a browser and must not require a real credential.

Run: `npm exec -w @ise/web -- playwright --version`

Expected: PASS and print `Version 1.61.1` without downloading browsers or starting a server. Runtime and Web integration plans own actual Playwright configuration/tests and must not edit package manifests or the root lockfile.

Run: `git status --short`

Expected: only Task 4 contract/fixture/provenance/manifests/lockfile changes remain; no `dist`, `.env`, raw asset, source drop, or nested lock is visible.

- [ ] **Step 9: Commit the frozen foundation consumed by all worktrees**

```powershell
git add packages/runtime-contracts/src/validateAssetSeed.ts packages/runtime-contracts/src/validateAssetSeedCli.ts packages/runtime-contracts/test/validate-asset-seed.test.ts packages/runtime-contracts/test/public-types.ts packages/runtime-contracts/test/fixtures/asset-seed.valid.json packages/runtime-contracts/package.json provenance/ASSET-SEED.md apps/web/package.json apps/api/package.json agent/package.json package.json package-lock.json
git diff --cached --check
git commit -m "feat: freeze runtime contract foundation"
git rev-parse HEAD
```

Expected: commit succeeds and `git rev-parse HEAD` prints the single commit hash from which the Agent, SceneRuntime, and Web/API worktrees are created. Later worktrees may consume these interfaces but must not change app manifests, `packages/runtime-contracts`, provenance contracts, or `package-lock.json` concurrently.

## Execution Boundary

After Task 4, the safe import and frozen-contract commits are prerequisites, not optional setup. Create all parallel implementation worktrees from the Task 4 hash, preserve the ownership boundaries in the design specification, and route every shared-contract change back through the integration owner before rebasing the three workstreams.
