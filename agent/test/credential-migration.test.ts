import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { migrateCredentialStore } from '../src/cli/migrateCredentialStore.ts';
import {
  AesGcmCredentialProtector,
  type CredentialProtector,
} from '../src/model/credentialProtector.ts';
import { AgentDatabase } from '../src/persistence/database.ts';
import { AgentRepositories } from '../src/persistence/repositories.ts';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'ise-credential-migration-'));
  const databasePath = join(directory, 'agent.sqlite');
  const keyPath = join(directory, 'agent-model-key');
  await writeFile(keyPath, `${randomBytes(32).toString('base64')}\n`, 'utf8');
  const database = await AgentDatabase.open(databasePath, 'sql.js');
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    database,
    repository: new AgentRepositories(database).modelConfigs,
    target: new AesGcmCredentialProtector(keyPath),
  };
}

function sourceProtector(entries: Record<string, string>): CredentialProtector {
  return {
    protect: () => { throw new Error('SOURCE_PROTECT_NOT_ALLOWED'); },
    unprotect: (ciphertext) => {
      const plaintext = entries[ciphertext];
      if (plaintext === undefined) throw new Error('MODEL_CREDENTIAL_UNAVAILABLE');
      return plaintext;
    },
  };
}

function saveConfig(
  repository: AgentRepositories['modelConfigs'],
  subject: string,
  encryptedApiKey: string,
): void {
  repository.save({
    subject,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    encryptedApiKey,
    cleared: false,
  });
}

test('credential migration converts legacy ciphertext to AES-GCM once and is idempotent', async (t) => {
  const { database, repository, target } = await fixture(t);
  const legacyCiphertext = 'legacy-dpapi-ciphertext';
  const plaintext = 'migration-test-plaintext';
  const existingAes = target.protect('already-portable');
  saveConfig(repository, 'legacy-user', legacyCiphertext);
  saveConfig(repository, 'portable-user', existingAes);

  const first = migrateCredentialStore(database, {
    sourceProtector: sourceProtector({ [legacyCiphertext]: plaintext }),
    targetProtector: target,
    platform: 'win32',
  });
  assert.equal(first, 1);
  const migrated = repository.get('legacy-user')!.encryptedApiKey!;
  assert.match(migrated, /^aesgcm:v1:/);
  assert.equal(migrated.includes(plaintext), false);
  assert.equal(target.unprotect(migrated), plaintext);
  assert.equal(repository.get('portable-user')!.encryptedApiKey, existingAes);

  const second = migrateCredentialStore(database, {
    sourceProtector: sourceProtector({}),
    targetProtector: target,
    platform: 'win32',
  });
  assert.equal(second, 0);
  assert.equal(repository.get('legacy-user')!.encryptedApiKey, migrated);
});

test('credential migration rejects legacy ciphertext off Windows without reading it', async (t) => {
  const { database, repository, target } = await fixture(t);
  const legacyCiphertext = 'foreign-legacy-ciphertext';
  saveConfig(repository, 'legacy-user', legacyCiphertext);
  let decryptions = 0;

  assert.throws(
    () => migrateCredentialStore(database, {
      sourceProtector: {
        protect: () => { throw new Error('SOURCE_PROTECT_NOT_ALLOWED'); },
        unprotect: () => {
          decryptions += 1;
          throw new Error('PLAINTEXT_MUST_NOT_BE_READ');
        },
      },
      targetProtector: target,
      platform: 'linux',
    }),
    (error: unknown) => error instanceof Error
      && error.message === 'MODEL_CREDENTIAL_MIGRATION_REQUIRES_WINDOWS',
  );
  assert.equal(decryptions, 0);
  assert.equal(repository.get('legacy-user')!.encryptedApiKey, legacyCiphertext);
});

test('credential migration rolls back every row when one conversion fails', async (t) => {
  const { database, repository } = await fixture(t);
  const firstLegacy = 'legacy-ciphertext-1';
  const secondLegacy = 'legacy-ciphertext-2';
  saveConfig(repository, 'user-1', firstLegacy);
  saveConfig(repository, 'user-2', secondLegacy);
  let protections = 0;

  assert.throws(() => migrateCredentialStore(database, {
    sourceProtector: sourceProtector({
      [firstLegacy]: 'plaintext-1',
      [secondLegacy]: 'plaintext-2',
    }),
    targetProtector: {
      protect: () => {
        protections += 1;
        if (protections === 2) throw new Error('MODEL_CREDENTIAL_STORAGE_UNAVAILABLE');
        return 'aesgcm:v1:converted';
      },
      unprotect: () => { throw new Error('TARGET_UNPROTECT_NOT_ALLOWED'); },
    },
    platform: 'win32',
  }), /MODEL_CREDENTIAL_STORAGE_UNAVAILABLE/);

  assert.equal(repository.get('user-1')!.encryptedApiKey, firstLegacy);
  assert.equal(repository.get('user-2')!.encryptedApiKey, secondLegacy);
});
