import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { CredentialProtector } from '../src/model/credentialProtector.ts'
import { ModelConfigStore } from '../src/model/modelConfig.ts'
import { AgentDatabase } from '../src/persistence/database.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'

async function databasePath(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ise-model-config-db-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return join(directory, 'agent.sqlite')
}

const remoteConfig = {
  provider: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-pro',
  apiKey: 'unit-test-plaintext-model-credential',
}

function deterministicProtector(): CredentialProtector {
  return {
    protect: value => `protected:${Buffer.from(value).toString('base64')}`,
    unprotect: value => Buffer.from(value.slice('protected:'.length), 'base64').toString(),
  }
}

function assertStableError(
  action: () => unknown,
  code: string,
  forbiddenDiagnostic: string,
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal('code' in error ? error.code : undefined, code)
    assert.equal(error.message.includes(forbiddenDiagnostic), false)
    assert.equal(JSON.stringify(error).includes(forbiddenDiagnostic), false)
    return true
  })
}

test('model config ciphertext and tombstones survive database reopen', async (t) => {
  const path = await databasePath(t)
  const plaintext = 'unit-test-plaintext-model-credential'
  const ciphertext = 'ciphertext-only'
  const first = await AgentDatabase.open(path, 'sql.js')
  const firstRepo = new AgentRepositories(first).modelConfigs

  firstRepo.save({
    subject: 'user-1',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    encryptedApiKey: ciphertext,
    cleared: false,
  })
  const created = firstRepo.get('user-1')
  assert.ok(created)
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(created.updatedAt, created.createdAt)
  first.close()

  const bytes = await readFile(path)
  assert.equal(bytes.includes(Buffer.from(plaintext)), false)
  assert.equal(bytes.includes(Buffer.from(ciphertext)), true)

  const reopened = await AgentDatabase.open(path, 'sql.js')
  const reopenedRepo = new AgentRepositories(reopened).modelConfigs
  assert.deepEqual(reopenedRepo.get('user-1'), created)

  reopenedRepo.save({
    subject: 'user-1',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    encryptedApiKey: 'rotated-ciphertext',
    cleared: false,
  })
  const updated = reopenedRepo.get('user-1')
  assert.ok(updated)
  assert.equal(updated.createdAt, created.createdAt)
  assert.equal(updated.encryptedApiKey, 'rotated-ciphertext')

  reopenedRepo.clear('user-1')
  const cleared = reopenedRepo.get('user-1')
  assert.ok(cleared)
  assert.deepEqual({
    subject: cleared.subject,
    provider: cleared.provider,
    baseUrl: cleared.baseUrl,
    model: cleared.model,
    encryptedApiKey: cleared.encryptedApiKey,
    cleared: cleared.cleared,
    createdAt: cleared.createdAt,
  }, {
    subject: 'user-1',
    provider: null,
    baseUrl: null,
    model: null,
    encryptedApiKey: null,
    cleared: true,
    createdAt: created.createdAt,
  })
  reopened.close()

  const tombstoneDatabase = await AgentDatabase.open(path, 'sql.js')
  assert.deepEqual(new AgentRepositories(tombstoneDatabase).modelConfigs.get('user-1'), cleared)
  tombstoneDatabase.close()
})

test('store restores protected credentials after restart and isolates subjects', async (t) => {
  const path = await databasePath(t)
  const protector = deterministicProtector()
  const ciphertext = protector.protect(remoteConfig.apiKey)
  const first = await AgentDatabase.open(path, 'sql.js')
  const firstStore = new ModelConfigStore(undefined, {
    repository: new AgentRepositories(first).modelConfigs,
    protector,
  })

  const view = firstStore.set('user-1', remoteConfig)
  assert.equal(JSON.stringify(view).includes(remoteConfig.apiKey), false)
  first.close()

  const bytes = await readFile(path)
  assert.equal(bytes.includes(Buffer.from(remoteConfig.apiKey)), false)
  assert.equal(bytes.includes(Buffer.from(ciphertext)), true)

  const reopened = await AgentDatabase.open(path, 'sql.js')
  const reopenedStore = new ModelConfigStore(undefined, {
    repository: new AgentRepositories(reopened).modelConfigs,
    protector,
  })
  assert.equal(reopenedStore.require('user-1').apiKey, remoteConfig.apiKey)
  assert.equal(reopenedStore.get('user-2').configured, false)
  assert.equal(JSON.stringify(reopenedStore.get('user-1')).includes(remoteConfig.apiKey), false)
  reopened.close()
})

test('model-only updates preserve the existing protected key', async (t) => {
  const path = await databasePath(t)
  let protections = 0
  const baseProtector = deterministicProtector()
  const protector: CredentialProtector = {
    protect: value => {
      protections += 1
      return baseProtector.protect(value)
    },
    unprotect: value => baseProtector.unprotect(value),
  }
  const database = await AgentDatabase.open(path, 'sql.js')
  const repositories = new AgentRepositories(database)
  const store = new ModelConfigStore(undefined, {
    repository: repositories.modelConfigs,
    protector,
  })
  store.set('user-1', remoteConfig)
  const originalCiphertext = repositories.modelConfigs.get('user-1')?.encryptedApiKey

  store.set('user-1', {
    provider: remoteConfig.provider,
    baseUrl: remoteConfig.baseUrl,
    model: 'deepseek-reasoner',
  })

  assert.equal(store.require('user-1').apiKey, remoteConfig.apiKey)
  assert.equal(repositories.modelConfigs.get('user-1')?.encryptedApiKey, originalCiphertext)
  assert.equal(protections, 1)
  database.close()
})

test('provider or base URL changes require a new key without replacing persisted config', async () => {
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  const repositories = new AgentRepositories(database)
  const store = new ModelConfigStore(undefined, {
    repository: repositories.modelConfigs,
    protector: deterministicProtector(),
  })
  store.set('user-1', remoteConfig)
  const previous = repositories.modelConfigs.get('user-1')

  for (const update of [
    {
      provider: 'openai' as const,
      baseUrl: remoteConfig.baseUrl,
      model: 'gpt-5',
    },
    {
      provider: remoteConfig.provider,
      baseUrl: 'https://alternate.deepseek.com/v1',
      model: remoteConfig.model,
    },
  ]) {
    assertStableError(() => store.set('user-1', update), 'MODEL_API_KEY_REQUIRED', remoteConfig.apiKey)
  }
  assert.deepEqual(repositories.modelConfigs.get('user-1'), previous)
  assert.equal(store.require('user-1').apiKey, remoteConfig.apiKey)
  database.close()
})

test('decrypt failures are stable, redacted, and fail closed', async () => {
  const diagnostic = 'sensitive-decrypt-diagnostic'
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  const repository = new AgentRepositories(database).modelConfigs
  repository.save({
    subject: 'user-1',
    provider: remoteConfig.provider,
    baseUrl: remoteConfig.baseUrl,
    model: remoteConfig.model,
    encryptedApiKey: 'opaque-ciphertext',
    cleared: false,
  })
  let decryptions = 0
  const store = new ModelConfigStore(undefined, {
    repository,
    protector: {
      protect: value => value,
      unprotect: () => {
        decryptions += 1
        throw new Error(diagnostic)
      },
    },
  })

  assertStableError(() => store.get('user-1'), 'MODEL_CREDENTIAL_UNAVAILABLE', diagnostic)
  assertStableError(() => store.require('user-1'), 'MODEL_CREDENTIAL_UNAVAILABLE', diagnostic)
  assert.equal(decryptions, 1)
  database.close()
})

test('protection failures retain the prior config and expose only a stable error', async () => {
  const diagnostic = 'sensitive-protection-diagnostic'
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  const repositories = new AgentRepositories(database)
  const workingProtector = deterministicProtector()
  const store = new ModelConfigStore(undefined, {
    repository: repositories.modelConfigs,
    protector: {
      protect: value => {
        if (value === 'replacement-key') throw new Error(diagnostic)
        return workingProtector.protect(value)
      },
      unprotect: value => workingProtector.unprotect(value),
    },
  })
  store.set('user-1', remoteConfig)
  const previous = repositories.modelConfigs.get('user-1')

  assertStableError(() => store.set('user-1', {
    ...remoteConfig,
    apiKey: 'replacement-key',
  }), 'MODEL_CREDENTIAL_STORAGE_UNAVAILABLE', diagnostic)
  assert.deepEqual(repositories.modelConfigs.get('user-1'), previous)
  assert.equal(store.require('user-1').apiKey, remoteConfig.apiKey)
  database.close()
})

test('flush failures retain prior config and expose only a stable error', async (t) => {
  const path = await databasePath(t)
  const diagnostic = 'sensitive-flush-diagnostic'
  let failNextFlush = false
  const database = await AgentDatabase.open(path, 'sql.js', {
    beforeRename: () => {
      if (!failNextFlush) return
      failNextFlush = false
      throw new Error(diagnostic)
    },
  })
  const repositories = new AgentRepositories(database)
  const store = new ModelConfigStore(undefined, {
    repository: repositories.modelConfigs,
    protector: deterministicProtector(),
  })
  store.set('user-1', remoteConfig)
  const previous = repositories.modelConfigs.get('user-1')
  failNextFlush = true

  assertStableError(() => store.set('user-1', {
    ...remoteConfig,
    model: 'deepseek-reasoner',
  }), 'MODEL_CREDENTIAL_STORAGE_UNAVAILABLE', diagnostic)
  assert.deepEqual(repositories.modelConfigs.get('user-1'), previous)
  assert.equal(store.require('user-1').model, remoteConfig.model)
  database.close()
})

test('persisted tombstones suppress an environment default after reopen', async (t) => {
  const path = await databasePath(t)
  const protector = deterministicProtector()
  const first = await AgentDatabase.open(path, 'sql.js')
  const firstStore = new ModelConfigStore(remoteConfig, {
    repository: new AgentRepositories(first).modelConfigs,
    protector,
  })
  assert.equal(firstStore.get('user-1').configured, true)
  firstStore.clear('user-1')
  first.close()

  const reopened = await AgentDatabase.open(path, 'sql.js')
  const reopenedStore = new ModelConfigStore(remoteConfig, {
    repository: new AgentRepositories(reopened).modelConfigs,
    protector,
  })
  assert.equal(reopenedStore.get('user-1').configured, false)
  assert.equal(reopenedStore.get('user-2').configured, true)
  reopened.close()
})
