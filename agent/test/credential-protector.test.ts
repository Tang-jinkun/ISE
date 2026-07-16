import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { loadConfig } from '../src/config.ts';
import {
  AesGcmCredentialProtector,
  createCredentialProtector,
  WindowsDpapiCredentialProtector,
} from '../src/model/credentialProtector.ts';

function assertStableCredentialError(
  operation: () => unknown,
  code: string,
  ...forbiddenMarkers: string[]
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    for (const marker of forbiddenMarkers) {
      assert.equal(error.message.includes(marker), false);
      assert.equal(JSON.stringify(error).includes(marker), false);
    }
    assert.equal(error.message, code);
    assert.equal('code' in error ? error.code : undefined, code);
    assert.equal('cause' in error, false);
    assert.equal('stderr' in error, false);
    assert.equal('stdout' in error, false);
    return true;
  });
}

async function createKeyFile(
  t: TestContext,
  contents = `${randomBytes(32).toString('base64')}\n`,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ise-credential-key-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'agent-model-key');
  await writeFile(path, contents, 'utf8');
  return path;
}

test('AES-GCM round-trips with a versioned envelope and random nonce', async (t) => {
  const keyPath = await createKeyFile(t);
  const protector = new AesGcmCredentialProtector(keyPath);
  const plaintext = `portable-unit-credential-${randomUUID()}`;
  const first = protector.protect(plaintext);
  const second = protector.protect(plaintext);

  assert.match(first, /^aesgcm:v1:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(plaintext), false);
  assert.equal(second.includes(plaintext), false);
  assert.equal(protector.unprotect(first), plaintext);
  assert.equal(protector.unprotect(second), plaintext);
});

test('AES-GCM rejects tampering with a stable redacted error', async (t) => {
  const keyPath = await createKeyFile(t);
  const protector = new AesGcmCredentialProtector(keyPath);
  const plaintext = `tamper-marker-${randomUUID()}`;
  const ciphertext = protector.protect(plaintext);
  const parts = ciphertext.split(':');
  const tag = Buffer.from(parts[3]!, 'base64');
  tag[0] = tag[0]! ^ 0x01;
  parts[3] = tag.toString('base64');
  const tampered = parts.join(':');

  assertStableCredentialError(
    () => protector.unprotect(tampered),
    'MODEL_CREDENTIAL_UNAVAILABLE',
    plaintext,
    tampered,
  );
});

test('AES-GCM requires a canonical base64 file containing exactly 32 key bytes', async (t) => {
  const invalidBase64Path = await createKeyFile(t, 'not-base64\n');
  const shortKeyPath = await createKeyFile(t, `${randomBytes(31).toString('base64')}\n`);

  for (const path of [invalidBase64Path, shortKeyPath]) {
    assertStableCredentialError(
      () => new AesGcmCredentialProtector(path),
      'MODEL_CREDENTIAL_STORAGE_UNAVAILABLE',
      path,
    );
  }
});

test('credential factory prefers a configured AES-GCM key file and otherwise retains DPAPI', async (t) => {
  const keyPath = await createKeyFile(t);
  assert.ok(createCredentialProtector({ AGENT_CREDENTIAL_KEY_FILE: keyPath }) instanceof AesGcmCredentialProtector);
  assert.ok(createCredentialProtector({}) instanceof WindowsDpapiCredentialProtector);

  const config = loadConfig({
    NEST_API_BASE_URL: 'http://127.0.0.1:3000',
    AGENT_CREDENTIAL_KEY_FILE: keyPath,
  });
  assert.equal(config.AGENT_CREDENTIAL_KEY_FILE, keyPath);
});

test('Windows DPAPI round-trips without exposing plaintext in ciphertext', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows DPAPI is unavailable');
  const protector = new WindowsDpapiCredentialProtector();
  const plaintext = `unit-test-credential-${randomUUID()}`;
  const ciphertext = protector.protect(plaintext);
  assert.notEqual(ciphertext, plaintext);
  assert.equal(ciphertext.includes(plaintext), false);
  assert.equal(protector.unprotect(ciphertext), plaintext);
});

test('invalid DPAPI ciphertext maps to a stable public error', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows DPAPI is unavailable');
  assert.throws(
    () => new WindowsDpapiCredentialProtector().unprotect('invalid-ciphertext'),
    (error: unknown) => error instanceof Error
      && 'code' in error
      && error.code === 'MODEL_CREDENTIAL_UNAVAILABLE',
  );
});

test('protection maps synchronous spawn failures to a stable redacted error', () => {
  const marker = 'synthetic-protection-diagnostic';
  assertStableCredentialError(
    () => new WindowsDpapiCredentialProtector().protect(`${marker}\0input`),
    'MODEL_CREDENTIAL_STORAGE_UNAVAILABLE',
    marker,
  );
});

test('decryption maps synchronous spawn failures to a stable redacted error', () => {
  const marker = 'synthetic-decryption-diagnostic';
  assertStableCredentialError(
    () => new WindowsDpapiCredentialProtector().unprotect(`${marker}\0input`),
    'MODEL_CREDENTIAL_UNAVAILABLE',
    marker,
  );
});
