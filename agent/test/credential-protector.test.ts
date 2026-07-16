import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { WindowsDpapiCredentialProtector } from '../src/model/credentialProtector.ts';

function assertStableCredentialError(
  operation: () => unknown,
  code: string,
  forbiddenMarker: string,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(forbiddenMarker), false);
    assert.equal(error.message, code);
    assert.equal('code' in error ? error.code : undefined, code);
    assert.equal('cause' in error, false);
    assert.equal('stderr' in error, false);
    assert.equal('stdout' in error, false);
    return true;
  });
}

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
