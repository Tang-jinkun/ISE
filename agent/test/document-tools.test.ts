import assert from 'node:assert/strict'
import test from 'node:test'
import { AttachmentRegistry } from '../src/services/attachmentRegistry.ts'
import { EVIDENCE_IR_ARTIFACT } from '../src/contracts/artifactTypes.ts'
import { createDocumentTools } from '../src/tools/documentTools.ts'
import { testAgentContext } from './helpers.ts'

const fixturePath = new URL('./fixtures/印巴边境空中对抗行动战后复盘报告.docx', import.meta.url)

test('parse_battle_report stores DocumentIR and EvidenceIR artifacts', async () => {
  const attachments = new AttachmentRegistry()
  const attachment = await attachments.register(fixturePath)
  const tools = createDocumentTools(attachments)
  const parse = tools.find(tool => tool.name === 'parse_battle_report')!
  const context = testAgentContext()

  const result = await parse.execute({ fileId: attachment.fileId }, context)

  assert.equal(result.artifacts?.map(item => item.type).sort().join(','), 'ise.document-ir/v1,ise.evidence-ir/v1')
  assert.match(result.content, /documentId/)
  const documentId = (result.artifacts?.find(item => item.type === 'ise.document-ir/v1')?.data as { documentId: string }).documentId
  assert.deepEqual(
    result.artifacts?.map(item => ({ logicalKey: item.logicalKey, metadata: item.metadata })),
    [
      {
        logicalKey: `document:${documentId}`,
        metadata: { documentId, sourceHash: attachment.fingerprint },
      },
      {
        logicalKey: `evidence:${documentId}`,
        metadata: { documentId },
      },
    ],
  )
})

test('inspect_report_evidence returns bounded evidence selected by section text', async () => {
  const attachments = new AttachmentRegistry()
  const attachment = await attachments.register(fixturePath)
  const tools = createDocumentTools(attachments)
  const context = testAgentContext()
  const parsed = await tools[0]!.execute({ fileId: attachment.fileId }, context)
  context.artifacts.createMany(parsed.artifacts ?? [])

  const inspect = tools.find(tool => tool.name === 'inspect_report_evidence')!
  const result = await inspect.execute({ query: '电子对抗', limit: 5 }, context)

  const payload = JSON.parse(result.content) as { records: unknown[] }
  assert.ok(payload.records.length > 0)
  assert.ok(payload.records.length <= 5)
})

test('attachment registry creates stable records and returns defensive copies', async () => {
  const attachments = new AttachmentRegistry()
  const first = await attachments.register(fixturePath)
  const second = await attachments.register(fixturePath)

  assert.equal(first.fileId, 'file-943504a71482656a')
  assert.equal(first.fingerprint, 'sha256:943504a71482656aa99680ccbb7db4001b0aabc513b11948057ede020af96a93')
  assert.deepEqual(second, first)

  const copy = attachments.require(first.fileId)
  copy.name = 'changed.docx'
  assert.equal(attachments.require(first.fileId).name, '印巴边境空中对抗行动战后复盘报告.docx')
})

test('attachment registry rejects directories and unknown file IDs', async () => {
  const attachments = new AttachmentRegistry()

  await assert.rejects(attachments.register(new URL('./fixtures/', import.meta.url)), /Attachment is not a file/)
  assert.throws(() => attachments.require('file-unknown'), /Unknown attachment: file-unknown/)

  const parse = createDocumentTools(attachments).find(tool => tool.name === 'parse_battle_report')!
  await assert.rejects(parse.execute({ fileId: 'file-unknown' }, testAgentContext()), /Unknown attachment: file-unknown/)
})

test('document tools expose constrained risk and input contracts', () => {
  const tools = createDocumentTools(new AttachmentRegistry())
  const parse = tools.find(tool => tool.name === 'parse_battle_report')!
  const inspect = tools.find(tool => tool.name === 'inspect_report_evidence')!

  assert.equal(parse.risk, 'derive')
  assert.deepEqual(parse.inputSchema, {
    type: 'object',
    additionalProperties: false,
    required: ['fileId'],
    properties: { fileId: { type: 'string', minLength: 1 } },
  })
  assert.equal(inspect.risk, 'read')
  assert.equal(inspect.isConcurrencySafe, true)
})

test('inspect_report_evidence requires active evidence', async () => {
  const inspect = createDocumentTools(new AttachmentRegistry())
    .find(tool => tool.name === 'inspect_report_evidence')!

  await assert.rejects(inspect.execute({}, testAgentContext()), /No active EvidenceIR artifact/)
})

test('inspect_report_evidence filters case-insensitively and clamps limits', async () => {
  const context = testAgentContext()
  const records = Array.from({ length: 25 }, (_, index) => ({
    evidenceId: `ev-${index}`,
    sourceRef: index === 2 ? 'doc:doc-filter:CHARLIE:2' : `doc:doc-filter:paragraph:${index}`,
    claim: index === 0 ? 'ALPHA claim' : `Claim ${index}`,
    kind: 'explicit_fact' as const,
    entities: index === 1 ? ['Bravo Entity'] : [],
    confidence: 1,
    ambiguities: [],
  }))
  context.artifacts.create({
    type: EVIDENCE_IR_ARTIFACT,
    createdBy: 'tool',
    logicalKey: 'evidence:doc-filter',
    data: {
      schemaVersion: 'evidence-ir/v1',
      documentId: 'doc-filter',
      records,
    },
  })
  const inspect = createDocumentTools(new AttachmentRegistry())
    .find(tool => tool.name === 'inspect_report_evidence')!

  for (const [query, evidenceId] of [['alpha', 'ev-0'], ['bravo', 'ev-1'], ['charlie', 'ev-2']]) {
    const result = await inspect.execute({ query }, context)
    assert.deepEqual(JSON.parse(result.content).records.map((record: { evidenceId: string }) => record.evidenceId), [evidenceId])
  }

  const maximum = await inspect.execute({ limit: 99 }, context)
  assert.equal(JSON.parse(maximum.content).records.length, 20)
  const minimum = await inspect.execute({ limit: 0 }, context)
  assert.equal(JSON.parse(minimum.content).records.length, 1)
  const selected = await inspect.execute({ evidenceIds: ['ev-24'] }, context)
  assert.deepEqual(JSON.parse(selected.content).records.map((record: { evidenceId: string }) => record.evidenceId), ['ev-24'])
})
