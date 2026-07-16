import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const AES_GCM_CIPHERTEXT_PREFIX = 'aesgcm:v1:';
const AES_GCM_ASSOCIATED_DATA = Buffer.from('ise:model-credential:aesgcm:v1', 'utf8');

const PROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  "$plaintext = [Environment]::GetEnvironmentVariable('ISE_MODEL_SECRET', 'Process')",
  '$bytes = [Text.Encoding]::UTF8.GetBytes($plaintext)',
  '$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($protected))',
].join('; ');

const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  "$ciphertext = [Environment]::GetEnvironmentVariable('ISE_MODEL_CIPHERTEXT', 'Process')",
  '$protected = [Convert]::FromBase64String($ciphertext)',
  '$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))',
].join('; ');

type CredentialErrorCode =
  | 'MODEL_CREDENTIAL_STORAGE_UNAVAILABLE'
  | 'MODEL_CREDENTIAL_UNAVAILABLE';

class CredentialProtectorError extends Error {
  readonly code: CredentialErrorCode;

  constructor(code: CredentialErrorCode) {
    super(code);
    this.name = 'CredentialProtectorError';
    this.code = code;
  }
}

function runPowerShell(
  script: string,
  childEnvironment: Record<string, string>,
  errorCode: CredentialErrorCode,
): string {
  const result = (() => {
    try {
      return spawnSync(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        {
          env: { ...process.env, ...childEnvironment },
          encoding: 'utf8',
          windowsHide: true,
        },
      );
    } catch {
      throw new CredentialProtectorError(errorCode);
    }
  })();
  if (result.error !== undefined || result.status !== 0) {
    throw new CredentialProtectorError(errorCode);
  }
  return result.stdout;
}

export interface CredentialProtector {
  protect(plaintext: string): string;
  unprotect(ciphertext: string): string;
}

function decodeCanonicalBase64(value: string): Buffer {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('INVALID_BASE64');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error('INVALID_BASE64');
  return decoded;
}

function readAesKey(path: string): Buffer {
  try {
    const encoded = readFileSync(path, 'utf8').trim();
    const key = decodeCanonicalBase64(encoded);
    if (key.byteLength !== 32) throw new Error('INVALID_KEY_LENGTH');
    return key;
  } catch {
    throw new CredentialProtectorError('MODEL_CREDENTIAL_STORAGE_UNAVAILABLE');
  }
}

export class AesGcmCredentialProtector implements CredentialProtector {
  readonly #key: Buffer;

  constructor(keyFilePath: string) {
    this.#key = readAesKey(keyFilePath);
  }

  protect(plaintext: string): string {
    try {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
      cipher.setAAD(AES_GCM_ASSOCIATED_DATA);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${AES_GCM_CIPHERTEXT_PREFIX}${nonce.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
    } catch {
      throw new CredentialProtectorError('MODEL_CREDENTIAL_STORAGE_UNAVAILABLE');
    }
  }

  unprotect(envelope: string): string {
    try {
      const parts = envelope.split(':');
      if (parts.length !== 5 || `${parts[0]}:${parts[1]}:` !== AES_GCM_CIPHERTEXT_PREFIX) {
        throw new Error('INVALID_ENVELOPE');
      }
      const nonce = decodeCanonicalBase64(parts[2]!);
      const tag = decodeCanonicalBase64(parts[3]!);
      const ciphertext = decodeCanonicalBase64(parts[4]!);
      if (nonce.byteLength !== 12 || tag.byteLength !== 16) throw new Error('INVALID_ENVELOPE');

      const decipher = createDecipheriv('aes-256-gcm', this.#key, nonce);
      decipher.setAAD(AES_GCM_ASSOCIATED_DATA);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new CredentialProtectorError('MODEL_CREDENTIAL_UNAVAILABLE');
    }
  }
}

export class WindowsDpapiCredentialProtector implements CredentialProtector {
  protect(plaintext: string): string {
    return runPowerShell(
      PROTECT_SCRIPT,
      { ISE_MODEL_SECRET: plaintext },
      'MODEL_CREDENTIAL_STORAGE_UNAVAILABLE',
    );
  }

  unprotect(ciphertext: string): string {
    return runPowerShell(
      UNPROTECT_SCRIPT,
      { ISE_MODEL_CIPHERTEXT: ciphertext },
      'MODEL_CREDENTIAL_UNAVAILABLE',
    );
  }
}

export function createCredentialProtector(env: NodeJS.ProcessEnv): CredentialProtector {
  const keyFilePath = env.AGENT_CREDENTIAL_KEY_FILE?.trim();
  return keyFilePath
    ? new AesGcmCredentialProtector(keyFilePath)
    : new WindowsDpapiCredentialProtector();
}
