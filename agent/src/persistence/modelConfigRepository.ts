import type { AgentDatabase } from './database.ts'

export interface PersistedModelConfigRecord {
  subject: string
  provider: string | null
  baseUrl: string | null
  model: string | null
  encryptedApiKey: string | null
  cleared: boolean
  createdAt: string
  updatedAt: string
}

type ModelConfigRecordInput = {
  subject: string
  provider: string
  baseUrl: string
  model: string
  encryptedApiKey: string | null
  cleared: false
}

function now(): string { return new Date().toISOString() }
function requiredString(value: unknown): string { return String(value) }
function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

export class ModelConfigRepository {
  constructor(private readonly database: AgentDatabase) {}

  get(subject: string): PersistedModelConfigRecord | undefined {
    const row = this.database.prepare('SELECT * FROM model_configs WHERE subject = ?').get([subject])
    return row ? this.toRecord(row) : undefined
  }

  save(record: ModelConfigRecordInput): void {
    const timestamp = now()
    this.database.transaction(() => this.database.prepare(`
      INSERT INTO model_configs(
        subject,provider,base_url,model,encrypted_api_key,cleared,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(subject) DO UPDATE SET
        provider = excluded.provider,
        base_url = excluded.base_url,
        model = excluded.model,
        encrypted_api_key = excluded.encrypted_api_key,
        cleared = excluded.cleared,
        updated_at = excluded.updated_at
    `).run([
      record.subject,
      record.provider,
      record.baseUrl,
      record.model,
      record.encryptedApiKey,
      record.cleared ? 1 : 0,
      timestamp,
      timestamp,
    ]))
  }

  clear(subject: string): void {
    const timestamp = now()
    this.database.transaction(() => this.database.prepare(`
      INSERT INTO model_configs(
        subject,provider,base_url,model,encrypted_api_key,cleared,created_at,updated_at
      ) VALUES(?,NULL,NULL,NULL,NULL,1,?,?)
      ON CONFLICT(subject) DO UPDATE SET
        provider = NULL,
        base_url = NULL,
        model = NULL,
        encrypted_api_key = NULL,
        cleared = 1,
        updated_at = excluded.updated_at
    `).run([subject, timestamp, timestamp]))
  }

  private toRecord(row: Record<string, unknown>): PersistedModelConfigRecord {
    return {
      subject: requiredString(row.subject),
      provider: nullableString(row.provider),
      baseUrl: nullableString(row.base_url),
      model: nullableString(row.model),
      encryptedApiKey: nullableString(row.encrypted_api_key),
      cleared: Number(row.cleared) === 1,
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at),
    }
  }
}
