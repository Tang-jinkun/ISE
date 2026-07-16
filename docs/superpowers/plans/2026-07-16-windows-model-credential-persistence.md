# Windows Model Credential Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save each authenticated user's model configuration once, protect its API key with Windows DPAPI in the Agent SQLite database, and restore it after Agent restarts without a key prompt.

**Architecture:** A focused Windows credential protector owns DPAPI calls, a repository owns ciphertext persistence, and `ModelConfigStore` remains the validation and tenant-policy boundary. The existing frontend API stays redacted; only the DeepSeek preset changes, and a tracked no-prompt launcher starts the Agent against the persistent database.

**Tech Stack:** TypeScript 5.9, Node.js >=20.19.0, Windows PowerShell DPAPI, sql.js SQLite, Fastify, React 19, Vitest, Node test runner.

## Global Constraints

- Persist credentials only on the current Windows development machine and bind decryption to the current Windows user.
- Never place a plaintext API key in source, browser storage, `.env`, SQLite, logs, command arguments, errors, test snapshots, or commits.
- Keep the existing `PublicModelConfig` response shape; the frontend may receive only `hasApiKey`, never the key or authorization header.
- Use exact model ID `deepseek-v4-pro`; never silently substitute another model.
- Preserve per-subject isolation and the existing environment-default/tombstone semantics.
- Fail closed when DPAPI is unavailable or ciphertext cannot be decrypted.
- Preserve the current frontend layout and styling; do not redesign the model dialog.
- Use Node 24.14 for final verification and run only desktop Chromium for the later DOCX playback acceptance.
- Do not touch or commit `apps/web/test-results/`.

---

## File Map

- Create `agent/src/model/credentialProtector.ts`: DPAPI abstraction and Windows implementation only.
- Create `agent/src/persistence/modelConfigRepository.ts`: typed ciphertext row mapping and transactional persistence only.
- Modify `agent/src/persistence/schema.ts`: add the `model_configs` table.
- Modify `agent/src/persistence/repositories.ts`: expose the model-config repository with the existing repository aggregate.
- Modify `agent/src/model/modelConfig.ts`: keep validation, default fallback, cache, and per-subject policy; delegate secrets to protector/repository.
- Modify `agent/src/server.ts`: wire production persistence and DPAPI into the store.
- Create `agent/test/credential-protector.test.ts`: real Windows DPAPI round-trip and stable failure tests.
- Create `agent/test/model-config-persistence.test.ts`: restart, isolation, redaction, tombstone, and failure-atomicity tests.
- Modify `agent/test/model-config.test.ts` and `agent/test/model-config-api.test.ts`: regression coverage for persistent store behavior at existing boundaries.
- Modify `agent/package.json`: include new Agent test files in the explicit test list.
- Modify `apps/web/src/pages/newScript/modelProviders.ts`: DeepSeek default model only.
- Modify `apps/web/src/pages/newScript/components/ModelConfigDialog.test.tsx`: default/redaction regression coverage.
- Create `scripts/start-agent.ps1`: tracked no-prompt persistent Agent launcher.
- Create `scripts/test-start-agent.ps1`: source-level and dry-run assertions that the default launcher never requests a key.

---

### Task 1: Windows DPAPI Credential Protector

**Files:**
- Create: `agent/src/model/credentialProtector.ts`
- Create: `agent/test/credential-protector.test.ts`
- Modify: `agent/package.json`

**Interfaces:**
- Produces: `CredentialProtector` with `protect(plaintext: string): string` and `unprotect(ciphertext: string): string`.
- Produces: `WindowsDpapiCredentialProtector` with the same synchronous methods.
- Errors: stable `MODEL_CREDENTIAL_STORAGE_UNAVAILABLE` for protection failures and `MODEL_CREDENTIAL_UNAVAILABLE` for decryption failures.

- [ ] **Step 1: Write failing protector tests**

Add tests that exercise the real implementation without a production credential:

```ts
test('Windows DPAPI round-trips without exposing plaintext in ciphertext', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows DPAPI is unavailable')
  const protector = new WindowsDpapiCredentialProtector()
  const plaintext = `unit-test-credential-${randomUUID()}`
  const ciphertext = protector.protect(plaintext)
  assert.notEqual(ciphertext, plaintext)
  assert.equal(ciphertext.includes(plaintext), false)
  assert.equal(protector.unprotect(ciphertext), plaintext)
})

test('invalid DPAPI ciphertext maps to a stable public error', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows DPAPI is unavailable')
  assert.throws(
    () => new WindowsDpapiCredentialProtector().unprotect('invalid-ciphertext'),
    (error: unknown) => error instanceof Error
      && 'code' in error
      && error.code === 'MODEL_CREDENTIAL_UNAVAILABLE',
  )
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
$env:Path = 'C:\Users\t\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
node node_modules\tsx\dist\cli.mjs --test agent\test\credential-protector.test.ts
```

Expected: FAIL because `credentialProtector.ts` or its exports do not exist.

- [ ] **Step 3: Implement the minimal protector**

Implement a constant PowerShell command and inject plaintext only into the child environment:

```ts
export interface CredentialProtector {
  protect(plaintext: string): string
  unprotect(ciphertext: string): string
}

export class WindowsDpapiCredentialProtector implements CredentialProtector {
  protect(plaintext: string): string {
    return runPowerShell(PROTECT_SCRIPT, { ISE_MODEL_SECRET: plaintext }, 'MODEL_CREDENTIAL_STORAGE_UNAVAILABLE')
  }

  unprotect(ciphertext: string): string {
    return runPowerShell(UNPROTECT_SCRIPT, { ISE_MODEL_CIPHERTEXT: ciphertext }, 'MODEL_CREDENTIAL_UNAVAILABLE')
  }
}
```

`runPowerShell` must use `spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { env, encoding: 'utf8', windowsHide: true })`. The command text must be constant, stderr must not be surfaced, and error messages must contain only the stable public code.

- [ ] **Step 4: Run focused tests and typecheck**

Run the Step 2 command, then:

```powershell
npm run typecheck -w @ise/agent
```

Expected: DPAPI tests pass on Windows; Agent typecheck exits 0.

- [ ] **Step 5: Commit Task 1**

```powershell
git add agent/src/model/credentialProtector.ts agent/test/credential-protector.test.ts agent/package.json
git commit -m "feat: protect model credentials with Windows DPAPI"
```

---

### Task 2: Persistent Model Configuration Repository

**Files:**
- Create: `agent/src/persistence/modelConfigRepository.ts`
- Create: `agent/test/model-config-persistence.test.ts`
- Modify: `agent/src/persistence/schema.ts`
- Modify: `agent/src/persistence/repositories.ts`
- Modify: `agent/package.json`

**Interfaces:**
- Produces: `PersistedModelConfigRecord` with `subject`, nullable metadata/ciphertext, `cleared`, `createdAt`, and `updatedAt`.
- Produces: `ModelConfigRepository.get(subject)`, `.save(record)`, and `.clear(subject)`.
- Consumes: the existing `AgentDatabase` synchronous transaction/prepare API.

- [ ] **Step 1: Write failing restart and ciphertext tests**

Use a temporary file database and assert exact row behavior:

```ts
test('model config ciphertext and tombstones survive database reopen', async (t) => {
  const path = await databasePath(t)
  const first = await AgentDatabase.open(path, 'sql.js')
  const firstRepo = new AgentRepositories(first).modelConfigs
  firstRepo.save({
    subject: 'user-1', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro', encryptedApiKey: 'ciphertext-only', cleared: false,
  })
  first.close()

  const reopened = await AgentDatabase.open(path, 'sql.js')
  assert.equal(new AgentRepositories(reopened).modelConfigs.get('user-1')?.encryptedApiKey, 'ciphertext-only')
  new AgentRepositories(reopened).modelConfigs.clear('user-1')
  assert.equal(new AgentRepositories(reopened).modelConfigs.get('user-1')?.cleared, true)
  reopened.close()
})
```

Add a database scan assertion proving the test plaintext is absent from the exported SQLite bytes.

- [ ] **Step 2: Run repository test and verify RED**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs --test agent\test\model-config-persistence.test.ts
```

Expected: FAIL because the table/repository does not exist.

- [ ] **Step 3: Add schema and repository**

Add the strict table:

```sql
CREATE TABLE IF NOT EXISTS model_configs (
  subject TEXT PRIMARY KEY,
  provider TEXT,
  base_url TEXT,
  model TEXT,
  encrypted_api_key TEXT,
  cleared INTEGER NOT NULL CHECK(cleared IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (cleared = 1 AND provider IS NULL AND base_url IS NULL AND model IS NULL AND encrypted_api_key IS NULL)
    OR
    (cleared = 0 AND provider IS NOT NULL AND base_url IS NOT NULL AND model IS NOT NULL)
  )
);
```

Repository writes must be one `database.transaction` with `INSERT ... ON CONFLICT(subject) DO UPDATE`. `clear` must write a tombstone without first reading or decrypting the existing row.

- [ ] **Step 4: Run repository, persistence, and typecheck verification**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs --test agent\test\model-config-persistence.test.ts agent\test\persistence.test.ts
npm run typecheck -w @ise/agent
```

Expected: all focused tests pass and typecheck exits 0.

- [ ] **Step 5: Commit Task 2**

```powershell
git add agent/src/persistence/modelConfigRepository.ts agent/src/persistence/schema.ts agent/src/persistence/repositories.ts agent/test/model-config-persistence.test.ts agent/package.json
git commit -m "feat: persist encrypted model configuration"
```

---

### Task 3: Persistent ModelConfigStore and Service Wiring

**Files:**
- Modify: `agent/src/model/modelConfig.ts`
- Modify: `agent/src/server.ts`
- Modify: `agent/test/model-config.test.ts`
- Modify: `agent/test/model-config-api.test.ts`
- Modify: `agent/test/model-config-persistence.test.ts`

**Interfaces:**
- Consumes: `CredentialProtector` and `ModelConfigRepository` from Tasks 1-2.
- Preserves: `new ModelConfigStore(defaultConfig?)` for in-memory tests.
- Adds: second constructor argument `{ repository: ModelConfigRepository; protector: CredentialProtector }` for production persistence.
- Preserves: current public route response and `set/get/require/resolve/clear` method names.

- [ ] **Step 1: Write failing store restart, isolation, and failure tests**

Use a deterministic fake protector:

```ts
const protector: CredentialProtector = {
  protect: (value) => `protected:${Buffer.from(value).toString('base64')}`,
  unprotect: (value) => Buffer.from(value.slice('protected:'.length), 'base64').toString(),
}
```

Tests must prove:

```ts
const firstStore = new ModelConfigStore(undefined, { repository, protector })
firstStore.set('user-1', remoteConfig)
const reopenedStore = new ModelConfigStore(undefined, { repository: reopenedRepository, protector })
assert.equal(reopenedStore.require('user-1').apiKey, 'unit-test-credential')
assert.equal(reopenedStore.get('user-2').configured, false)
assert.equal(JSON.stringify(reopenedStore.get('user-1')).includes('unit-test-credential'), false)
```

Add cases for key-preserving model-only update, provider/base URL requiring a new key, a decrypt failure mapping to `MODEL_CREDENTIAL_UNAVAILABLE`, a protection/flush failure preserving the previous configuration, and a persisted tombstone suppressing an environment default after reopen.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs --test agent\test\model-config.test.ts agent\test\model-config-persistence.test.ts agent\test\model-config-api.test.ts
```

Expected: restart/configuration tests fail because `ModelConfigStore` does not consume persistence.

- [ ] **Step 3: Integrate persistence into ModelConfigStore**

Add optional production dependencies without changing the public view:

```ts
export type ModelConfigPersistenceOptions = {
  repository: ModelConfigRepository
  protector: CredentialProtector
}

export class ModelConfigStore {
  constructor(
    defaultConfig?: ModelConfigInput,
    persistence?: ModelConfigPersistenceOptions,
  ) {}
}
```

Load each subject at most once per process, decrypt only inside `#stored`, persist ciphertext before updating the in-memory cache, and remove cached plaintext after `clear`. Do not include raw child-process or database error text in mapped Agent errors.

- [ ] **Step 4: Wire production server dependencies**

Construct production storage from existing objects:

```ts
const modelConfigs = new ModelConfigStore(defaultModel, {
  repository: repositories.modelConfigs,
  protector: new WindowsDpapiCredentialProtector(),
})
```

No route shape changes are allowed.

- [ ] **Step 5: Run focused, service, full Agent, and typecheck tests**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs --test agent\test\credential-protector.test.ts agent\test\model-config.test.ts agent\test\model-config-persistence.test.ts agent\test\model-config-api.test.ts agent\test\session-api.test.ts
npm run test -w @ise/agent
npm run typecheck -w @ise/agent
```

Expected: focused and full suites pass with only the existing Windows symlink-permission skip; typecheck exits 0.

- [ ] **Step 6: Commit Task 3**

```powershell
git add agent/src/model/modelConfig.ts agent/src/server.ts agent/test/model-config.test.ts agent/test/model-config-api.test.ts agent/test/model-config-persistence.test.ts
git commit -m "feat: restore model config across agent restarts"
```

---

### Task 4: DeepSeek V4 Pro Preset and No-Prompt Launcher

**Files:**
- Modify: `apps/web/src/pages/newScript/modelProviders.ts`
- Modify: `apps/web/src/pages/newScript/components/ModelConfigDialog.test.tsx`
- Create: `scripts/start-agent.ps1`
- Create: `scripts/test-start-agent.ps1`

**Interfaces:**
- Produces: DeepSeek preset default model `deepseek-v4-pro`.
- Produces: `scripts/start-agent.ps1 -WorkingRoot <path> -DatabasePath <path> -Port <number> [-DryRun]`.
- Launcher default: no model credential prompt and no `MODEL_*` environment inheritance.

- [ ] **Step 1: Write failing frontend default test**

Add an unconfigured-dialog assertion:

```ts
it('defaults an unconfigured DeepSeek user to deepseek-v4-pro', () => {
  renderDialog(empty)
  expect(screen.getByLabelText('提供商')).toHaveValue('deepseek')
  expect(screen.getByLabelText('模型')).toHaveValue('deepseek-v4-pro')
  expect(screen.getByLabelText('API Key')).toHaveValue('')
})
```

- [ ] **Step 2: Write failing launcher test**

`scripts/test-start-agent.ps1` must parse and dry-run the launcher, asserting these markers:

```powershell
$output = & $launcher -WorkingRoot $root -DatabasePath $database -Port 4544 -DryRun
if ($output -notcontains 'MODEL_CONFIG_SOURCE=persisted') { throw 'Missing persisted source marker' }
if ($output -notcontains 'MODEL_API_KEY=unset') { throw 'Model key must be unset' }
if ((Get-Content -Raw $launcher) -match 'Read-Host') { throw 'Default launcher must not prompt' }
```

- [ ] **Step 3: Run both tests and verify RED**

Run:

```powershell
npm run test -w @ise/web -- src/pages/newScript/components/ModelConfigDialog.test.tsx
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-start-agent.ps1
```

Expected: frontend test sees `deepseek-chat`; launcher test fails because the script does not exist.

- [ ] **Step 4: Implement preset and launcher**

Change only the DeepSeek preset field:

```ts
defaultModel: 'deepseek-v4-pro'
```

The launcher must set Agent host/port/database/Nest URL, explicitly remove `MODEL_BASE_URL`, `MODEL_NAME`, and `MODEL_API_KEY` from the child environment, use the repository's Node 24 runtime when present, and print only non-secret readiness markers. `-DryRun` must not start or stop processes.

- [ ] **Step 5: Run frontend, launcher, and typechecks**

Run:

```powershell
npm run test -w @ise/web -- src/pages/newScript/components/ModelConfigDialog.test.tsx
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-start-agent.ps1
npm run typecheck -w @ise/web
npm run typecheck -w @ise/agent
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 4**

```powershell
git add apps/web/src/pages/newScript/modelProviders.ts apps/web/src/pages/newScript/components/ModelConfigDialog.test.tsx scripts/start-agent.ps1 scripts/test-start-agent.ps1
git commit -m "feat: default to persistent DeepSeek V4 Pro"
```

---

### Task 5: Restart and Vertical Acceptance

**Files:**
- Runtime output only: `.ise/agent.sqlite`, `.superpowers/sdd/real-demo/*`, `apps/web/test-results/*`
- No committed source changes expected.

**Interfaces:**
- Consumes: tracked no-prompt launcher, authenticated model config API, real DOCX script, persisted generated Scene, desktop Chromium acceptance.
- Produces: seven generated JSON artifacts and desktop visual evidence.

- [ ] **Step 1: Run final static verification and independent review**

Run Node 24 full Agent/Web focused suites, both typechecks, secret scan, and `git diff --check`. Dispatch a read-only reviewer over the implementation range and resolve all Critical/Important findings before runtime acceptance.

- [ ] **Step 2: Start the new Agent without a credential prompt**

Stop only the verified ISE Agent process on 4444, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-agent.ps1 -DatabasePath .\.ise\agent.sqlite
```

Expected markers: `MODEL_CONFIG_SOURCE=persisted` and `AGENT_4444_LISTENING=ok`; no key prompt.

- [ ] **Step 3: Save and validate the configuration once**

Use the existing frontend dialog with provider DeepSeek, base URL `https://api.deepseek.com/v1`, and exact model `deepseek-v4-pro`. Enter the credential once, discover/test the model, then save. Confirm `GET /model-config` returns `configured: true`, model `deepseek-v4-pro`, and `hasApiKey: true` without a key field.

- [ ] **Step 4: Prove restart recovery**

Restart again with `scripts/start-agent.ps1` and no model environment variables. Confirm the same redacted model config and run one authenticated model connection test without re-entering the key.

- [ ] **Step 5: Run real DOCX vertical flow**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.superpowers\sdd\run-real-docx-flow.ps1
```

Verify these files are freshly generated and schema-valid:

```text
event-plan.json
narration-plan.json
scene-blueprint.json
resolved-scene-plan.json
choreography-plan.json
canonical-runtime-plan.json
scene-project.json
```

- [ ] **Step 6: Run desktop Chromium playback acceptance**

Run only:

```powershell
npm run test:e2e -w @ise/web -- e2e/generated-replay.spec.ts --project=desktop-chromium
```

Confirm subtitles lead visuals by at least 800 ms, image/video tracks decode, multiple aircraft are visible on unique catalog routes, GLB actors move with heading/pitch, and camera samples change over time.

- [ ] **Step 7: Secret and repository verification**

Scan tracked files, Git diff, logs, generated JSON, test output, and the SQLite byte stream for the known credential prefix/pattern without printing matches. The result must be zero. Leave `apps/web/test-results/` untracked.

- [ ] **Step 8: Push through the configured proxy**

```powershell
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
```

Expected: `main -> main` succeeds.
