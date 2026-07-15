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

async function rejectsAsBridge(work: Promise<unknown>): Promise<void> {
  await assert.rejects(work, (error: unknown) =>
    error instanceof Error
    && error.message === 'Agent bridge error'
    && 'status' in error && error.status === 502
    && 'code' in error && error.code === 'NEST_BRIDGE_FAILED')
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
  await rejectsAsBridge(gateway.readOwnedFile('file-1', 'Bearer token'))
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
  await rejectsAsBridge(invalid.readOwnedFile('file-1', 'Bearer token'))
})

test('asset catalog returns only the nested Nest data payload', async () => {
  const assets = [{
    assetId: 'model:jf17', kind: 'model', displayName: 'JF-17', aliases: [],
    fingerprint: `sha256:${'1'.repeat(64)}`, size: 10, mediaType: 'model/gltf-binary',
    availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
    model: { scale: 1, rotationOffsetDeg: [0, 0, 0], altitudeOffsetM: 0, entityTypes: ['aircraft'] },
  }]
  const gateway = new FetchNestGateway({
    baseUrl: 'http://nest.test',
    fetch: sequenceFetch(jsonResponse({ code: 200, data: assets, msg: 'ok', timestamp: 1 })),
  })
  assert.deepEqual(await gateway.listAssetMetadata('Bearer token'), assets)
})

test('malformed auth JSON and failed catalog envelopes map to one bridge error', async () => {
  const gateway = new FetchNestGateway({
    baseUrl: 'http://nest.test',
    fetch: sequenceFetch(
      new Response('{not-json', { headers: { 'content-type': 'application/json' } }),
      jsonResponse({ code: 500, data: [], msg: 'provider body with token' }),
    ),
  })
  await rejectsAsBridge(gateway.verifyBearer('Bearer token'))
  await rejectsAsBridge(gateway.listAssetMetadata('Bearer token'))
})

test('malformed successful file responses map to the same bridge error', async () => {
  const bytes = Buffer.from('not-a-docx')
  const gateway = new FetchNestGateway({ baseUrl: 'http://nest.test', fetch: sequenceFetch(fileResponse(bytes)) })
  await rejectsAsBridge(gateway.readOwnedFile('file-1', 'Bearer token'))
})
