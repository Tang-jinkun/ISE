import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  AES_GCM_CIPHERTEXT_PREFIX,
  createCredentialProtector,
  type CredentialProtector,
  WindowsDpapiCredentialProtector,
} from '../model/credentialProtector.ts';
import {
  SqlJsDatabaseAdapter,
  type SqliteDatabaseAdapter,
} from '../persistence/sqlJsDatabase.ts';

export interface CredentialMigrationOptions {
  sourceProtector: CredentialProtector;
  targetProtector: CredentialProtector;
  platform?: NodeJS.Platform;
}

type LegacyCredentialRow = {
  subject: string;
  ciphertext: string;
};

export function migrateCredentialStore(
  database: SqliteDatabaseAdapter,
  options: CredentialMigrationOptions,
): number {
  const rows = database.prepare(`
    SELECT subject, encrypted_api_key
    FROM model_configs
    WHERE encrypted_api_key IS NOT NULL
    ORDER BY subject
  `).all();
  const legacyRows: LegacyCredentialRow[] = rows.flatMap((row) => {
    const ciphertext = String(row.encrypted_api_key);
    return ciphertext.startsWith(AES_GCM_CIPHERTEXT_PREFIX)
      ? []
      : [{ subject: String(row.subject), ciphertext }];
  });

  if (legacyRows.length === 0) return 0;
  if ((options.platform ?? process.platform) !== 'win32') {
    throw new Error('MODEL_CREDENTIAL_MIGRATION_REQUIRES_WINDOWS');
  }

  return database.transaction(() => {
    for (const row of legacyRows) {
      const plaintext = options.sourceProtector.unprotect(row.ciphertext);
      const portableCiphertext = options.targetProtector.protect(plaintext);
      const result = database.prepare(`
        UPDATE model_configs
        SET encrypted_api_key = ?
        WHERE subject = ? AND encrypted_api_key = ?
      `).run([portableCiphertext, row.subject, row.ciphertext]);
      if (result.changes !== 1) throw new Error('MODEL_CREDENTIAL_MIGRATION_CONFLICT');
    }
    return legacyRows.length;
  });
}

export async function runCredentialMigration(
  env: NodeJS.ProcessEnv = process.env,
  writeOutput: (value: string) => void = value => process.stdout.write(value),
): Promise<number> {
  const keyFilePath = env.AGENT_CREDENTIAL_KEY_FILE?.trim();
  if (!keyFilePath) throw new Error('AGENT_CREDENTIAL_KEY_FILE_REQUIRED');
  const databasePath = env.AGENT_DB_PATH?.trim() || './var/ise-agent.sqlite';
  const database = await SqlJsDatabaseAdapter.open(databasePath);
  try {
    const count = migrateCredentialStore(database, {
      sourceProtector: new WindowsDpapiCredentialProtector(),
      targetProtector: createCredentialProtector({ AGENT_CREDENTIAL_KEY_FILE: keyFilePath }),
    });
    writeOutput(`MIGRATED_MODEL_CREDENTIALS=${count}\n`);
    return count;
  } finally {
    database.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  void runCredentialMigration().catch(() => {
    process.stderr.write('MODEL_CREDENTIAL_MIGRATION_FAILED\n');
    process.exitCode = 1;
  });
}
