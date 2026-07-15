import { createHash } from 'node:crypto'
import { z } from 'zod'
import { agentError } from '../api/errors.ts'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const MAX_DOCX_SIZE = 26_214_400

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const fingerprintPattern = /^sha256:[0-9a-f]{64}$/
const nestUserResponseSchema = z.object({
  code: z.number(),
  data: z.object({ id: z.string().min(1) }).passthrough(),
  msg: z.string().optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),
}).passthrough()
const nestUnknownResponseSchema = z.object({ data: z.unknown() }).passthrough()

export interface AuthorizedFile {
  fileId: string
  name: string
  mimeType: string
  size: number
  fingerprint: `sha256:${string}`
  bytes: Buffer
}

export interface NestGateway {
  verifyBearer(authorization: string): Promise<{ subject: string }>
  readOwnedFile(fileId: string, authorization: string): Promise<AuthorizedFile>
  listAssetMetadata(authorization: string): Promise<unknown>
}

function ensureAuthorization(value: string): void {
  if (!/^Bearer\s+\S+$/.test(value)) throw agentError(401, 'INVALID_BEARER')
}

function ensureHttpOrigin(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw agentError(500, 'INVALID_NEST_ORIGIN')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw agentError(500, 'INVALID_NEST_ORIGIN')
  }
  url.pathname = url.pathname.replace(/\/$/, '') || '/'
  return url
}

function assertOpaqueId(fileId: string): void {
  if (!opaqueIdPattern.test(fileId)) throw agentError(400, 'INVALID_FILE_ID')
}

function parseBoundedContentLength(value: string | null): number {
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) throw agentError(415, 'ATTACHMENT_SIZE_INVALID')
  const size = Number(value)
  if (size > MAX_DOCX_SIZE) throw agentError(413, 'ATTACHMENT_TOO_LARGE')
  return size
}

function decodeFilename(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw agentError(415, 'ATTACHMENT_FILENAME_INVALID')
  }
}

function parseAttachmentFilename(value: string | null): string {
  if (!value) throw agentError(415, 'ATTACHMENT_FILENAME_MISSING')
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1]
  const quoted = /filename="([^"]+)"/i.exec(value)?.[1]
  const plain = /filename=([^;]+)/i.exec(value)?.[1]?.trim()
  const name = encoded ? decodeFilename(encoded.trim()) : quoted ?? plain
  if (!name || name.includes('/') || name.includes('\\') || !name.toLowerCase().endsWith('.docx')) {
    throw agentError(415, 'ATTACHMENT_FILENAME_INVALID')
  }
  return name
}

function computedFingerprint(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function validateDocxIdentity(input: {
  fileId: string
  name: string
  mimeType: string
  headerFingerprint: string
  bytes: Buffer
}): AuthorizedFile {
  if (input.mimeType !== DOCX_MIME) throw agentError(415, 'ATTACHMENT_MIME_MISMATCH')
  if (input.bytes.length < 4 || !input.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw agentError(415, 'ATTACHMENT_MAGIC_MISMATCH')
  }
  if (!fingerprintPattern.test(input.headerFingerprint)) {
    throw agentError(415, 'ATTACHMENT_FINGERPRINT_INVALID')
  }
  const fingerprint = computedFingerprint(input.bytes)
  if (input.headerFingerprint !== fingerprint) throw agentError(415, 'ATTACHMENT_FINGERPRINT_MISMATCH')
  return {
    fileId: input.fileId,
    name: input.name,
    mimeType: input.mimeType,
    size: input.bytes.length,
    fingerprint,
    bytes: Buffer.from(input.bytes),
  }
}

export class FetchNestGateway implements NestGateway {
  readonly #origin: URL

  constructor(readonly options: { baseUrl: string; fetch?: typeof fetch }) {
    this.#origin = ensureHttpOrigin(options.baseUrl)
  }

  async verifyBearer(authorization: string): Promise<{ subject: string }> {
    const response = await this.request('/auth/getUserInfo', authorization)
    const body = nestUserResponseSchema.parse(await response.json())
    return { subject: body.data.id }
  }

  async readOwnedFile(fileId: string, authorization: string): Promise<AuthorizedFile> {
    assertOpaqueId(fileId)
    const response = await this.request(`/file/${encodeURIComponent(fileId)}/content`, authorization)
    const declaredSize = parseBoundedContentLength(response.headers.get('content-length'))
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length !== declaredSize) throw agentError(415, 'ATTACHMENT_SIZE_MISMATCH')
    return validateDocxIdentity({
      fileId,
      name: parseAttachmentFilename(response.headers.get('content-disposition')),
      mimeType: response.headers.get('content-type') ?? '',
      headerFingerprint: response.headers.get('x-content-sha256') ?? '',
      bytes,
    })
  }

  async listAssetMetadata(authorization: string): Promise<unknown> {
    const response = await this.request('/asset-catalog', authorization)
    return nestUnknownResponseSchema.parse(await response.json()).data
  }

  private async request(path: string, authorization: string): Promise<Response> {
    ensureAuthorization(authorization)
    const url = new URL(path, this.#origin)
    if (url.origin !== this.#origin.origin) throw agentError(502, 'NEST_ORIGIN_MISMATCH')
    let response: Response
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        headers: { authorization },
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw agentError(502, 'NEST_BRIDGE_FAILED', 'Nest bridge request failed', error)
    }
    if (response.status >= 300 && response.status < 400) throw agentError(502, 'NEST_REDIRECT_REJECTED')
    if (response.status === 401 || response.status === 403) throw agentError(401, 'INVALID_BEARER')
    if (!response.ok) throw agentError(502, 'NEST_BRIDGE_FAILED')
    return response
  }
}
