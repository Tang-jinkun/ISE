import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DOCX_MIME,
  FetchNestGateway,
} from '../src/adapters/nestGateway.ts'

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
}

function fileResponse(bytes: Buffer, fingerprint = sha256(bytes)): Response {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Response(body, { headers: {
    'content-type': DOCX_MIME,
    'content-length': String(bytes.length),
    'content-disposition': "attachment; filename*=UTF-8''report.docx",
    'x-content-sha256': fingerprint,
  } })
}

function sequenceFetch(...responses: Response[]): typeof fetch {
  const queue = [...responses]
  return (async () => {
    const response = queue.shift()
    if (!response) throw new Error('Unexpected fetch')
    return response
  }) as typeof fetch
}

test('file bridge checks header and byte fingerprints', async () => {
  const bytes = Buffer.from('PK\u0003\u0004docx')
  const gateway = new FetchNestGateway({
    baseUrl: 'http://nest.test',
    fetch: sequenceFetch(
      jsonResponse({ code: 200, data: { id: 'user-1' }, msg: 'ok', timestamp: 1 }),
      fileResponse(bytes),
    ),
  })
  assert.deepEqual(await gateway.verifyBearer('Bearer token'), { subject: 'user-1' })
  assert.equal((await gateway.readOwnedFile('file-1', 'Bearer token')).fingerprint, sha256(bytes))
})

test('file bridge rejects a fingerprint header that differs from bytes', async () => {
  const bytes = Buffer.from('PK\u0003\u0004docx')
  const gateway = new FetchNestGateway({
    baseUrl: 'http://nest.test',
    fetch: sequenceFetch(fileResponse(bytes, `sha256:${'0'.repeat(64)}`)),
  })
  await assert.rejects(gateway.readOwnedFile('file-1', 'Bearer token'), (error: unknown) =>
    error instanceof Error && error.message.includes('ATTACHMENT_FINGERPRINT_MISMATCH'))
})

test('gateway rejects non-opaque ids, redirects, and invalid DOCX identity', async () => {
  const gateway = new FetchNestGateway({
    baseUrl: 'http://nest.test',
    fetch: sequenceFetch(new Response(null, { status: 302, headers: { location: 'http://evil.test' } })),
  })
  await assert.rejects(gateway.readOwnedFile('../secret', 'Bearer token'), /INVALID_FILE_ID/)
  await assert.rejects(gateway.verifyBearer('Bearer token'), /NEST_REDIRECT_REJECTED/)

  const bytes = Buffer.from('not-a-zip')
  const invalid = new FetchNestGateway({ baseUrl: 'http://nest.test', fetch: sequenceFetch(fileResponse(bytes)) })
  await assert.rejects(invalid.readOwnedFile('file-1', 'Bearer token'), /ATTACHMENT_MAGIC_MISMATCH/)
})

test('asset catalog returns only the nested Nest data payload', async () => {
  const assets = [{ assetId: 'model:jf17' }]
  const gateway = new FetchNestGateway({
    baseUrl: 'http://nest.test',
    fetch: sequenceFetch(jsonResponse({ code: 200, data: assets, msg: 'ok', timestamp: 1 })),
  })
  assert.deepEqual(await gateway.listAssetMetadata('Bearer token'), assets)
})
