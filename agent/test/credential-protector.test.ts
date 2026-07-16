import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { WindowsDpapiCredentialProtector } from '../src/model/credentialProtector.ts';

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
