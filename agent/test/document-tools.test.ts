import assert from 'node:assert/strict'
import { copyFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('inspect_report_evidence returns a complete 44-record document by default', async () => {
  const context = testAgentContext()
  const records = Array.from({ length: 44 }, (_, index) =>
    evidenceRecord(`ev-${index}`, `Claim ${index}`),
  )
  context.artifacts.create({
    type: EVIDENCE_IR_ARTIFACT,
    createdBy: 'tool',
    logicalKey: 'evidence:doc-complete',
    data: {
      schemaVersion: 'evidence-ir/v1',
      documentId: 'doc-complete',
      records,
    },
  })
  const inspect = createDocumentTools(new AttachmentRegistry())
    .find(tool => tool.name === 'inspect_report_evidence')!

  const result = await inspect.execute({}, context)
  const payload = JSON.parse(result.content) as {
    totalRecords: number
    matchingRecords: number
    returnedRecords: number
    inspectionComplete: boolean
    records: unknown[]
  }

  assert.deepEqual(payload, {
    totalRecords: 44,
    matchingRecords: 44,
    returnedRecords: 44,
    inspectionComplete: true,
    records,
  })
})

test('inspect_report_evidence distinguishes total, matching, and returned records', async () => {
  const context = testAgentContext()
  const records = [
    evidenceRecord('ev-match-1', 'Matched claim one'),
    evidenceRecord('ev-match-2', 'Matched claim two'),
    evidenceRecord('ev-other-1', 'Other claim one'),
    evidenceRecord('ev-other-2', 'Other claim two'),
  ]
  context.artifacts.create({
    type: EVIDENCE_IR_ARTIFACT,
    createdBy: 'tool',
    logicalKey: 'evidence:doc-metadata',
    data: {
      schemaVersion: 'evidence-ir/v1',
      documentId: 'doc-metadata',
      records,
    },
  })
  const inspect = createDocumentTools(new AttachmentRegistry())
    .find(tool => tool.name === 'inspect_report_evidence')!

  const result = await inspect.execute({ query: 'matched', limit: 1 }, context)
  const payload = JSON.parse(result.content) as {
    totalRecords: number
    matchingRecords: number
    returnedRecords: number
    inspectionComplete: boolean
    records: Array<{ evidenceId: string }>
  }

  assert.deepEqual(payload, {
    totalRecords: 4,
    matchingRecords: 2,
    returnedRecords: 1,
    inspectionComplete: false,
    records: [records[0]],
  })
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

test('parse rejects an attachment whose bytes change after registration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ise-attachment-change-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'report.docx')
  await copyFile(fixturePath, path)
  const attachments = new AttachmentRegistry()
  const attachment = await attachments.register(path)
  await writeFile(path, 'replacement bytes')
  const parse = createDocumentTools(attachments).find(tool => tool.name === 'parse_battle_report')!

  await assert.rejects(
    parse.execute({ fileId: attachment.fileId }, testAgentContext()),
    /Attachment changed|fingerprint mismatch/i,
  )
})

test('verified attachment reads reject bytes changed after registration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ise-attachment-read-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'report.docx')
  await copyFile(fixturePath, path)
  const attachments = new AttachmentRegistry()
  const attachment = await attachments.register(path)
  await writeFile(path, 'replacement bytes')

  await assert.rejects(
    attachments.readVerified(attachment.fileId),
    /Attachment changed|fingerprint mismatch/i,
  )
})

test('attachment registry rejects symbolic links', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ise-attachment-link-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const target = join(directory, 'target.docx')
  const link = join(directory, 'link.docx')
  await copyFile(fixturePath, target)
  try {
    await symlink(target, link, 'file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('Windows did not grant symbolic-link creation permission')
      return
    }
    throw error
  }

  await assert.rejects(new AttachmentRegistry().register(link), /symbolic link/i)
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
  assert.deepEqual(inspect.inputSchema, {
    type: 'object',
    additionalProperties: false,
    properties: {
      documentId: { type: 'string', minLength: 1 },
      query: { type: 'string' },
      evidenceIds: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
  })
})

test('inspect_report_evidence requires active evidence', async () => {
  const inspect = createDocumentTools(new AttachmentRegistry())
    .find(tool => tool.name === 'inspect_report_evidence')!

  await assert.rejects(inspect.execute({}, testAgentContext()), /No active EvidenceIR artifact/)
})

test('inspect_report_evidence excludes superseded evidence records', async () => {
  const context = testAgentContext()
  context.artifacts.create({
    type: EVIDENCE_IR_ARTIFACT,
    createdBy: 'tool',
    logicalKey: 'evidence:doc-active',
    data: evidenceData('doc-active', 'ev-old', 'Old superseded claim'),
  })
  context.artifacts.create({
    type: EVIDENCE_IR_ARTIFACT,
    createdBy: 'tool',
    logicalKey: 'evidence:doc-active',
    data: evidenceData('doc-active', 'ev-new', 'New active claim'),
  })
  const inspect = createDocumentTools(new AttachmentRegistry())
    .find(tool => tool.name === 'inspect_report_evidence')!

  const result = await inspect.execute({}, context)

  assert.deepEqual(
    JSON.parse(result.content).records.map((record: { evidenceId: string }) => record.evidenceId),
    ['ev-new'],
  )
})

test('inspect_report_evidence combines document, query, and evidence ID filters', async () => {
  const context = testAgentContext()
  context.artifacts.create({
    type: EVIDENCE_IR_ARTIFACT,
    createdBy: 'tool',
    logicalKey: 'evidence:doc-selected',
    data: {
      schemaVersion: 'evidence-ir/v1',
      documentId: 'doc-selected',
      records: [
        evidenceRecord('ev-selected', 'Alpha selected claim'),
        evidenceRecord('ev-wrong-id', 'Alpha wrong ID claim'),
      ],
    },
  })
  context.artifacts.create({
    type: EVIDENCE_IR_ARTIFACT,
    createdBy: 'tool',
    logicalKey: 'evidence:doc-other',
    data: evidenceData('doc-other', 'ev-selected', 'Alpha wrong document claim'),
  })
  const inspect = createDocumentTools(new AttachmentRegistry())
    .find(tool => tool.name === 'inspect_report_evidence')!

  const result = await inspect.execute({
    documentId: 'doc-selected',
    query: 'alpha selected',
    evidenceIds: ['ev-selected'],
  }, context)

  assert.deepEqual(
    JSON.parse(result.content).records.map((record: { evidenceId: string }) => record.evidenceId),
    ['ev-selected'],
  )
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
  assert.equal(JSON.parse(maximum.content).records.length, 25)
  const minimum = await inspect.execute({ limit: -99 }, context)
  assert.equal(JSON.parse(minimum.content).records.length, 1)
  await assert.rejects(inspect.execute({ limit: 1.5 }, context), /expected int/i)
  const selected = await inspect.execute({ evidenceIds: ['ev-24'] }, context)
  assert.deepEqual(JSON.parse(selected.content).records.map((record: { evidenceId: string }) => record.evidenceId), ['ev-24'])
})

function evidenceData(documentId: string, evidenceId: string, claim: string) {
  return {
    schemaVersion: 'evidence-ir/v1' as const,
    documentId,
    records: [evidenceRecord(evidenceId, claim)],
  }
}

function evidenceRecord(evidenceId: string, claim: string) {
  return {
    evidenceId,
    sourceRef: `doc:test:paragraph:${evidenceId}`,
    claim,
    kind: 'explicit_fact' as const,
    entities: [],
    confidence: 1,
    ambiguities: [],
  }
}
