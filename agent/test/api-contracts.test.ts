import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachFileSchema,
  createSessionResponseSchema,
  emptyObjectSchema,
  reviewDecisionSchema,
  sendMessageSchema,
} from '../src/api/contracts.ts'
import { loadConfig } from '../src/config.ts'

test('create session response is exact and rejects extra fields', () => {
  const input = {
    sessionId: '00000000-0000-4000-8000-000000000001',
    status: 'idle' as const,
  }
  assert.deepEqual(createSessionResponseSchema.parse(input), input)
  assert.equal(createSessionResponseSchema.safeParse({ ...input, subject: 'secret' }).success, false)
  assert.equal(emptyObjectSchema.safeParse({ objective: 'generate' }).success, false)
})

test('request DTOs are strict and bounded', () => {
  assert.deepEqual(sendMessageSchema.parse({ content: ' replay ' }), { content: 'replay' })
  assert.equal(sendMessageSchema.safeParse({ content: '' }).success, false)
  assert.equal(attachFileSchema.safeParse({ fileId: '../report.docx' }).success, false)
  assert.equal(reviewDecisionSchema.safeParse({
    artifactId: 'draft-1', version: 1, fingerprint: `sha256:${'0'.repeat(64)}`, subject: 'user-1',
  }).success, false)
})

test('service config applies defaults and rejects undeclared environment input', () => {
  const config = loadConfig({
    NEST_API_BASE_URL: 'http://127.0.0.1:3000',
    MODEL_BASE_URL: 'https://api.openai.com/v1',
    MODEL_NAME: 'gpt-5-mini',
    MODEL_API_KEY: 'test-key',
  })
  assert.equal(config.AGENT_PORT, 4310)
  assert.equal(config.AGENT_SQLITE_DRIVER, 'sql.js')
  assert.equal(config.AGENT_HOST, '127.0.0.1')
})
