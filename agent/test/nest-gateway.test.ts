import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DOCX_MIME,
  FetchNestGateway,
  MAX_DOCX_SIZE,
} from '../src/adapters/nestGateway.ts'
import { createHttpApp } from '../src/api/httpApp.ts'
import { AgentDatabase } from '../src/persistence/database.ts'
import { AgentRepositories } from '../src/persistence/repositories.ts'

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
  await assert.rejects(gateway.readOwnedFile('file-1', 'Bearer token'), /ATTACHMENT_FINGERPRINT_MISMATCH/)
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
  const gateway = new FetchNestGateway({
    baseUrl: 'http://nest.test',
    fetch: (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': DOCX_MIME,
        'content-length': '8',
        'content-disposition': 'attachment; filename="report.docx"',
        'x-content-sha256': `sha256:${'0'.repeat(64)}`,
      }),
      arrayBuffer: async () => { throw new Error('upstream body failed') },
    } as unknown as Response)) as typeof fetch,
  })
  await rejectsAsBridge(gateway.readOwnedFile('file-1', 'Bearer token'))
})

test('attachment route preserves precise local DOCX validation status and codes', async () => {
  const valid = Buffer.from('PK\u0003\u0004docx')
  const body = (bytes: Buffer) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const response = (bytes: Buffer, headers: Record<string, string>) => new Response(body(bytes), { headers })
  const baseHeaders = {
    'content-type': DOCX_MIME,
    'content-length': String(valid.length),
    'content-disposition': 'attachment; filename="report.docx"',
    'x-content-sha256': sha256(valid),
  }
  const cases = [
    {
      name: 'oversized', status: 413, code: 'ATTACHMENT_TOO_LARGE',
      file: response(valid, { ...baseHeaders, 'content-length': String(MAX_DOCX_SIZE + 1) }),
    },
    {
      name: 'extension', status: 415, code: 'ATTACHMENT_FILENAME_INVALID',
      file: response(valid, { ...baseHeaders, 'content-disposition': 'attachment; filename="report.txt"' }),
    },
    {
      name: 'mime', status: 415, code: 'ATTACHMENT_MIME_MISMATCH',
      file: response(valid, { ...baseHeaders, 'content-type': 'application/octet-stream' }),
    },
    {
      name: 'magic', status: 415, code: 'ATTACHMENT_MAGIC_MISMATCH',
      file: response(Buffer.from('not-docx'), {
        ...baseHeaders,
        'content-length': String(Buffer.byteLength('not-docx')),
        'x-content-sha256': sha256(Buffer.from('not-docx')),
      }),
    },
    {
      name: 'missing length', status: 415, code: 'ATTACHMENT_SIZE_INVALID',
      file: response(valid, Object.fromEntries(Object.entries(baseHeaders).filter(([key]) => key !== 'content-length'))),
    },
    {
      name: 'length mismatch', status: 415, code: 'ATTACHMENT_SIZE_MISMATCH',
      file: response(valid, { ...baseHeaders, 'content-length': String(valid.length + 1) }),
    },
    {
      name: 'fingerprint syntax', status: 415, code: 'ATTACHMENT_FINGERPRINT_INVALID',
      file: response(valid, { ...baseHeaders, 'x-content-sha256': 'invalid' }),
    },
    {
      name: 'fingerprint identity', status: 415, code: 'ATTACHMENT_FINGERPRINT_MISMATCH',
      file: response(valid, { ...baseHeaders, 'x-content-sha256': `sha256:${'0'.repeat(64)}` }),
    },
  ]
  const auth = () => jsonResponse({ code: 200, data: { id: 'user-1' }, msg: 'ok' })
  const gateway = new FetchNestGateway({
    baseUrl: 'http://nest.test',
    fetch: sequenceFetch(...cases.flatMap(item => [auth(), item.file])),
  })
  const database = await AgentDatabase.open(':memory:', 'sql.js')
  const repositories = new AgentRepositories(database)
  const session = repositories.sessions.create('user-1')
  const app = await createHttpApp({
    repositories,
    nest: gateway,
    modelFactory: () => ({ complete: async () => ({ content: 'unused' }) }),
  })
  for (const testCase of cases) {
    const result = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/attachments`,
      headers: { authorization: 'Bearer token' },
      payload: { fileId: `file-${testCase.name.replace(/\s+/g, '-')}` },
    })
    assert.equal(result.statusCode, testCase.status, testCase.name)
    assert.equal(result.json().error.code, testCase.code, testCase.name)
  }
  await app.close()
  database.close()
})
