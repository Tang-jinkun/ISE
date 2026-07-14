import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from './fingerprint.ts'

export interface AttachmentRecord {
  fileId: string
  path: string
  name: string
  size: number
  fingerprint: string
}

export class AttachmentRegistry {
  readonly #items = new Map<string, AttachmentRecord>()

  async register(input: string | URL): Promise<AttachmentRecord> {
    const path = resolve(input instanceof URL ? fileURLToPath(input) : input)
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`Attachment is not a file: ${path}`)
    const content = await readFile(path)
    const fingerprint = sha256(content)
    const hashStart = 'sha256:'.length
    const fileId = `file-${fingerprint.slice(hashStart, hashStart + 16)}`
    const record = {
      fileId,
      path,
      name: basename(path),
      size: info.size,
      fingerprint,
    }
    this.#items.set(fileId, record)
    return { ...record }
  }

  require(fileId: string): AttachmentRecord {
    const record = this.#items.get(fileId)
    if (!record) throw new Error(`Unknown attachment: ${fileId}`)
    return { ...record }
  }
}
