import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import initSqlJs, { type BindParams, type Database as SqlJsDatabase } from 'sql.js'

export type SqliteParams = BindParams

export interface SqliteStatement {
  run(params?: SqliteParams): { changes: number }
  get(params?: SqliteParams): Record<string, unknown> | undefined
  all(params?: SqliteParams): Record<string, unknown>[]
}

export interface SqliteDatabaseAdapter {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  transaction<T>(work: () => T): T
  close(): void
}

export interface SqlJsPersistenceOptions {
  beforeRename?: () => void
}

export class SqlJsPersistenceError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'SQLJS_PERSISTENCE_FAILED', { cause })
    this.name = 'SqlJsPersistenceError'
  }
}

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>
const REQUIRED_CONNECTION_PRAGMAS = 'PRAGMA foreign_keys = ON;'

export class SqlJsDatabaseAdapter implements SqliteDatabaseAdapter {
  #inTransaction = false
  #closed = false

  private constructor(
    private database: SqlJsDatabase,
    private readonly path: string,
    private readonly SQL: SqlJsStatic,
    private readonly persistenceOptions: SqlJsPersistenceOptions,
  ) {}

  static async open(path: string, persistenceOptions: SqlJsPersistenceOptions = {}): Promise<SqlJsDatabaseAdapter> {
    const require = createRequire(import.meta.url)
    const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) })
    const bytes = path !== ':memory:' && existsSync(path) ? readFileSync(path) : undefined
    const adapter = new SqlJsDatabaseAdapter(new SQL.Database(bytes), path, SQL, persistenceOptions)
    adapter.applyConnectionPragmas()
    return adapter
  }

  exec(sql: string): void {
    this.assertOpen()
    this.database.run(sql)
  }

  prepare(sql: string): SqliteStatement {
    this.assertOpen()
    const query = (params: SqliteParams | undefined, firstOnly: boolean) => {
      const statement = this.database.prepare(sql)
      try {
        if (params !== undefined) statement.bind(params)
        const rows: Record<string, unknown>[] = []
        while (statement.step()) {
          rows.push(statement.getAsObject() as Record<string, unknown>)
          if (firstOnly) break
        }
        return rows
      } finally {
        statement.free()
      }
    }
    return {
      run: params => {
        this.database.run(sql, params)
        return { changes: this.database.getRowsModified() }
      },
      get: params => query(params, true)[0],
      all: params => query(params, false),
    }
  }

  transaction<T>(work: () => T): T {
    this.assertOpen()
    if (this.#inTransaction) return work()
    const snapshot = this.database.export()
    this.applyConnectionPragmas()
    this.#inTransaction = true
    this.database.run('BEGIN IMMEDIATE')
    let committed = false
    try {
      const result = work()
      this.database.run('COMMIT')
      committed = true
      try {
        this.persist()
      } catch (error) {
        try {
          this.restore(snapshot)
        } catch (restoreError) {
          throw new SqlJsPersistenceError(restoreError)
        }
        throw new SqlJsPersistenceError(error)
      }
      return result
    } catch (error) {
      if (!committed) this.database.run('ROLLBACK')
      throw error
    } finally {
      this.#inTransaction = false
    }
  }

  private restore(snapshot: Uint8Array): void {
    const replacement = new this.SQL.Database(snapshot)
    try {
      replacement.run(REQUIRED_CONNECTION_PRAGMAS)
    } catch (error) {
      replacement.close()
      throw error
    }
    const previous = this.database
    this.database = replacement
    previous.close()
  }

  private applyConnectionPragmas(): void {
    this.database.run(REQUIRED_CONNECTION_PRAGMAS)
  }

  close(): void {
    if (this.#closed) return
    this.persist()
    this.database.close()
    this.#closed = true
  }

  private persist(): void {
    if (this.path === ':memory:') return
    const bytes = Buffer.from(this.database.export())
    this.applyConnectionPragmas()
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    const handle = openSync(temporary, 'w')
    try {
      writeFileSync(handle, bytes)
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    this.persistenceOptions.beforeRename?.()
    renameSync(temporary, this.path)
  }

  private assertOpen(): void {
    if (this.#closed) throw new Error('DATABASE_CLOSED')
  }
}
