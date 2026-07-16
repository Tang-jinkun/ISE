import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { AgentDatabase } from '../src/persistence/database.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'

async function databasePath(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ise-model-config-db-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return join(directory, 'agent.sqlite')
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
