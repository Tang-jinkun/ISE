import { agentError } from '../api/errors.ts'
import { AGENT_SCHEMA_SQL } from './schema.ts'
import { SqlJsDatabaseAdapter, type SqliteDatabaseAdapter } from './sqlJsDatabase.ts'

export type AgentSqliteDriver = 'better-sqlite3' | 'sql.js'

export class AgentDatabase implements SqliteDatabaseAdapter {
  private constructor(private readonly adapter: SqliteDatabaseAdapter) {}

  static async open(path: string, driver: AgentSqliteDriver): Promise<AgentDatabase> {
    if (driver !== 'sql.js') {
      throw agentError(500, 'SQLITE_DRIVER_UNAVAILABLE', 'better-sqlite3 did not pass the runtime gate')
    }
    const adapter = await SqlJsDatabaseAdapter.open(path)
    const database = new AgentDatabase(adapter)
    database.transaction(() => {
      database.exec(AGENT_SCHEMA_SQL)
      database.ensureRunProvenanceColumns()
    })
    return database
  }

  exec(sql: string): void { this.adapter.exec(sql) }
  prepare(sql: string) { return this.adapter.prepare(sql) }
  transaction<T>(work: () => T): T { return this.adapter.transaction(work) }
  close(): void { this.adapter.close() }

  private ensureRunProvenanceColumns(): void {
    const columns = new Set(this.prepare('PRAGMA table_info(runs)').all().map(row => String(row.name)))
    for (const [name, type] of [
      ['expected_accepted_artifact_id', 'TEXT'],
      ['expected_accepted_version', 'INTEGER'],
      ['expected_accepted_fingerprint', 'TEXT'],
    ] as const) {
      if (!columns.has(name)) this.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`)
    }
  }
}
