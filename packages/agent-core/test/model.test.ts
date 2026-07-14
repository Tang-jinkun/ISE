import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenAICompatibleAdapter } from '../src/index.ts'

test('OpenAICompatibleAdapter forwards JSON schema response format', async () => {
  const originalFetch = globalThis.fetch
  let capturedBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'https://provider.example/v1',
    })
    await adapter.complete({
      messages: [{ role: 'user', content: 'return json' }],
      tools: [],
      responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          name: 'semantic_turn_v1',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
          strict: true,
        },
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(capturedBody?.response_format, {
    type: 'json_schema',
    json_schema: {
      name: 'semantic_turn_v1',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
      strict: true,
    },
  })
})

test('OpenAICompatibleAdapter falls back to json_object when json_schema is unavailable', async () => {
  const originalFetch = globalThis.fetch
  const capturedBodies: Record<string, unknown>[] = []
  const capturedHeaders: Headers[] = []
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    capturedBodies.push(body)
    capturedHeaders.push(new Headers(init?.headers))
    if (capturedBodies.length === 1) {
      return new Response(JSON.stringify({
        detail: 'Provider HTTP 400: {"error":{"message":"This response_format type is unavailable now"}}',
      }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'https://provider.example/v1',
      headers: { 'x-gsms-agent-session-id': 'session-fallback' },
    })
    const response = await adapter.complete({
      messages: [{ role: 'user', content: 'return json' }],
      tools: [],
      responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          name: 'semantic_turn_v1',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
          strict: true,
        },
      },
    })
    assert.equal(response.content, '{"ok":true}')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedBodies.length, 2)
  assert.equal((capturedBodies[0]?.response_format as { type?: string } | undefined)?.type, 'json_schema')
  assert.deepEqual(capturedBodies[1]?.response_format, { type: 'json_object' })
  assert.deepEqual(
    capturedHeaders.map(headers => headers.get('x-gsms-agent-session-id')),
    ['session-fallback', 'session-fallback'],
  )
})

test('OpenAICompatibleAdapter can prefer json_object without probing json_schema', async () => {
  const originalFetch = globalThis.fetch
  const capturedBodies: Record<string, unknown>[] = []
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'test-key',
      model: 'deepseek-v4-pro',
      baseUrl: 'https://provider.example/v1',
      responseFormat: 'json_object',
    })
    const response = await adapter.complete({
      messages: [{ role: 'user', content: 'return json' }],
      tools: [],
      responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          name: 'semantic_turn_v1',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
          strict: true,
        },
      },
    })
    assert.equal(response.content, '{"ok":true}')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedBodies.length, 1)
  assert.deepEqual(capturedBodies[0]?.response_format, { type: 'json_object' })
})

test('OpenAICompatibleAdapter forwards trusted caller headers to the model proxy', async () => {
  const originalFetch = globalThis.fetch
  let capturedHeaders: Headers | undefined
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers)
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'service-token',
      model: 'test-model',
      baseUrl: 'https://provider.example/v1',
      headers: { 'x-gsms-agent-session-id': 'session-1' },
    })
    await adapter.complete({ messages: [], tools: [] })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedHeaders?.get('authorization'), 'Bearer service-token')
  assert.equal(capturedHeaders?.get('x-gsms-agent-session-id'), 'session-1')
})

test('OpenAICompatibleAdapter forwards trusted caller headers while streaming', async () => {
  const originalFetch = globalThis.fetch
  let capturedHeaders: Headers | undefined
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers)
    return new Response('data: {"choices":[{"delta":{"content":"streamed"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }) as typeof fetch

  try {
    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'service-token',
      model: 'test-model',
      baseUrl: 'https://provider.example/v1',
      headers: { 'x-gsms-agent-session-id': 'session-stream' },
    })
    const chunks = []
    for await (const chunk of adapter.completeStreaming({ messages: [], tools: [] })) {
      chunks.push(chunk)
    }
    assert.deepEqual(chunks, [{ type: 'text', text: 'streamed' }, { type: 'done' }])
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedHeaders?.get('authorization'), 'Bearer service-token')
  assert.equal(capturedHeaders?.get('x-gsms-agent-session-id'), 'session-stream')
})
