import { constants, type Stats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
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
    const { content } = await readStableOrdinaryFile(path)
    const fingerprint = sha256(content)
    const hashStart = 'sha256:'.length
    const fileId = `file-${fingerprint.slice(hashStart, hashStart + 16)}`
    const record = {
      fileId,
      path,
      name: basename(path),
      size: content.byteLength,
      fingerprint,
    }
    this.#items.set(fileId, record)
    return { ...record }
  }

  async readVerified(fileId: string): Promise<Buffer> {
    const record = this.require(fileId)
    let content: Buffer
    try {
      content = (await readStableOrdinaryFile(record.path)).content
    } catch (error) {
      throw new Error(`Attachment changed: ${fileId}`, { cause: error })
    }

    const fingerprint = sha256(content)
    if (content.byteLength !== record.size || fingerprint !== record.fingerprint) {
      throw new Error(`Attachment changed or fingerprint mismatch: ${fileId}`)
    }
    return content
  }

  require(fileId: string): AttachmentRecord {
    const record = this.#items.get(fileId)
    if (!record) throw new Error(`Unknown attachment: ${fileId}`)
    return { ...record }
  }
}

async function readStableOrdinaryFile(path: string): Promise<{ content: Buffer }> {
  const pathBefore = await lstat(path)
  assertOrdinaryFile(pathBefore, path)
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  let handle
  try {
    handle = await open(path, flags)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error(`Attachment is a symbolic link: ${path}`)
    }
    throw error
  }

  try {
    const handleBefore = await handle.stat()
    if (!handleBefore.isFile()) throw new Error(`Attachment is not a file: ${path}`)
    if (!sameFileIdentity(pathBefore, handleBefore)) {
      throw new Error(`Attachment changed while opening: ${path}`)
    }

    const content = await handle.readFile()
    const handleAfter = await handle.stat()
    const pathAfter = await lstat(path)
    assertOrdinaryFile(pathAfter, path)
    if (
      !sameFileSnapshot(handleBefore, handleAfter)
      || !sameFileIdentity(handleAfter, pathAfter)
      || content.byteLength !== handleAfter.size
    ) {
      throw new Error(`Attachment changed while reading: ${path}`)
    }
    return { content }
  } finally {
    await handle.close()
  }
}

function assertOrdinaryFile(info: Stats, path: string): void {
  if (info.isSymbolicLink()) throw new Error(`Attachment is a symbolic link: ${path}`)
  if (!info.isFile()) throw new Error(`Attachment is not a file: ${path}`)
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
    return left.dev === right.dev && left.ino === right.ino
  }
  return left.birthtimeMs === right.birthtimeMs && left.ctimeMs === right.ctimeMs
}

function sameFileSnapshot(left: Stats, right: Stats): boolean {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}
