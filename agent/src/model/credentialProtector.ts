import { spawnSync } from 'node:child_process';

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
