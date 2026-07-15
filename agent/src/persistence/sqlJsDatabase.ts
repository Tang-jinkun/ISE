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

export class SqlJsDatabaseAdapter implements SqliteDatabaseAdapter {
  #inTransaction = false
  #closed = false

  private constructor(
    private readonly database: SqlJsDatabase,
    private readonly path: string,
  ) {}

  static async open(path: string): Promise<SqlJsDatabaseAdapter> {
    const require = createRequire(import.meta.url)
    const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) })
    const bytes = path !== ':memory:' && existsSync(path) ? readFileSync(path) : undefined
    return new SqlJsDatabaseAdapter(new SQL.Database(bytes), path)
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
    this.#inTransaction = true
    this.database.run('BEGIN IMMEDIATE')
    let committed = false
    try {
      const result = work()
      this.database.run('COMMIT')
      committed = true
      this.persist()
      return result
    } catch (error) {
      if (!committed) this.database.run('ROLLBACK')
      throw error
    } finally {
      this.#inTransaction = false
    }
  }

  close(): void {
    if (this.#closed) return
    this.persist()
    this.database.close()
    this.#closed = true
  }

  private persist(): void {
    if (this.path === ':memory:') return
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    const handle = openSync(temporary, 'w')
    try {
      writeFileSync(handle, Buffer.from(this.database.export()))
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    renameSync(temporary, this.path)
  }

  private assertOpen(): void {
    if (this.#closed) throw new Error('DATABASE_CLOSED')
  }
}
