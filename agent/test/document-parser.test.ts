import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import mammoth from 'mammoth'
import { documentIrSchema } from '../src/contracts/document.ts'
import { evidenceIrSchema } from '../src/contracts/evidence.ts'
import { parseBattleReport } from '../src/services/documentParser.ts'
import { canonicalJson, fingerprint, sha256 } from '../src/services/fingerprint.ts'

const fixture = new URL('./fixtures/印巴边境空中对抗行动战后复盘报告.docx', import.meta.url)

test('fingerprints are canonical and stable', () => {
  const left = { z: [3, { b: 2, a: 1 }], omitted: undefined, a: 'value' }
  const right = { a: 'value', z: [3, { a: 1, b: 2 }] }

  assert.equal(sha256('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(canonicalJson(left), '{"a":"value","z":[3,{"a":1,"b":2}]}')
  assert.equal(fingerprint(left), fingerprint(right))
})

test('parser preserves headings, tables, and stable source references', async () => {
  const buffer = await readFile(fixture)
  const first = await parseBattleReport(buffer)
  const second = await parseBattleReport(buffer)

  assert.equal(first.document.title, '印巴边境空中对抗行动')
  assert.equal(first.document.sourceHash, 'sha256:943504a71482656aa99680ccbb7db4001b0aabc513b11948057ede020af96a93')
  assert.equal(first.document.documentId, 'doc-943504a71482656a')
  assert.equal(first.document.paragraphs[0]?.sourceRef, 'doc:doc-943504a71482656a:paragraph:0')
  assert.equal(first.document.tables[0]?.sourceRef, 'doc:doc-943504a71482656a:table:0')
  assert.ok(first.document.sections.some(section => section.title.includes('行动经过')))
  assert.ok(first.document.tables.length >= 2)
  assert.ok(first.document.paragraphs.every(item => item.sourceRef.startsWith(`doc:${first.document.documentId}:paragraph:`)))
  assert.equal(first.document.documentId, second.document.documentId)
  assert.deepEqual(first, second)
  assert.deepEqual(documentIrSchema.parse(first.document), first.document)
  assert.deepEqual(evidenceIrSchema.parse(first.evidence), first.evidence)
})

test('parser preserves paragraph, list, and table structure in document order', async () => {
  const { document } = await parseBattleReport(await readFile(fixture))
  const title = document.paragraphs[0]
  const actionStart = document.paragraphs.find(item => item.text.startsWith('行动开始后'))
  const listItem = document.paragraphs.find(item => item.text.startsWith('双方均将预警平台'))

  assert.equal(title?.text, '印巴边境空中对抗行动')
  assert.deepEqual(title?.sectionPath, [])
  assert.deepEqual(actionStart?.sectionPath, ['四、行动经过', '（一）双方兵力展开'])
  assert.deepEqual(listItem?.sectionPath, ['三、战前态势与兵力部署', '（三）主要态势特点'])
  assert.deepEqual(document.tables[0]?.rows[0], ['行动名称', '印巴边境空中对抗行动', '行动时间', '2025年5月7日'])
  assert.deepEqual(document.tables.at(-1)?.sectionPath, ['附录：行动阶段摘要'])
  assert.deepEqual(document.warnings, [])
})

test('parser evidence quotes every paragraph without inventing claims', async () => {
  const parsed = await parseBattleReport(await readFile(fixture))
  const claim = parsed.evidence.records.find(record => record.claim.includes('实际出动架次'))

  assert.ok(claim)
  assert.equal(claim.kind, 'explicit_fact')
  assert.match(claim.sourceRef, /^doc:.+:paragraph:\d+$/)
  assert.equal(parsed.evidence.records.length, parsed.document.paragraphs.length)
  assert.deepEqual(
    parsed.evidence.records.map(record => [record.sourceRef, record.claim]),
    parsed.document.paragraphs.map(paragraph => [paragraph.sourceRef, paragraph.text]),
  )
  assert.ok(parsed.evidence.records.every(record => record.confidence === 1 && record.ambiguities.length === 0))
  assert.equal(parsed.evidence.records[0]?.evidenceId, 'ev-70ce5dbdb61831e3')
  for (const record of parsed.evidence.records) {
    const expectedId = `ev-${sha256(`${record.sourceRef}\n${record.claim}`).slice('sha256:'.length, 'sha256:'.length + 16)}`
    assert.equal(record.evidenceId, expectedId)
  }
})

test('parser preserves known-domain entities and the first matching time expression', async () => {
  const parsed = await parseBattleReport(await readFile(fixture))
  const dated = parsed.evidence.records.find(record => record.claim.startsWith('行动日期'))
  const overview = parsed.evidence.records.find(record => record.claim.startsWith('2025年5月7日，印巴边境地区'))

  assert.equal(dated?.timeExpression, '2025年5月7日')
  assert.deepEqual(overview?.entities, [
    '苏-30MKI',
    '阵风',
    'JF-17',
    '预警机',
    '地面雷达',
    '阿达姆普尔',
    '安巴拉',
    '米纳斯',
    '拉菲基',
    '巴方',
    '印方',
  ])
})

test('parser warns on missing headings without dropping paragraphs, lists, or empty table cells', async t => {
  t.mock.method(mammoth, 'convertToHtml', async () => ({
    value: '<p>Untitled report</p><p>Body</p><ol><li>First</li><li>Second</li></ol><table><tr><td> A </td><td></td><td> C </td></tr></table>',
    messages: [],
  }))

  const parsed = await parseBattleReport(Buffer.from('synthetic-without-headings'))

  assert.equal(parsed.document.title, 'Untitled report')
  assert.deepEqual(parsed.document.warnings, ['No headings found in document.'])
  assert.deepEqual(parsed.document.paragraphs.map(item => item.text), ['Untitled report', 'Body', 'First', 'Second'])
  assert.ok(parsed.document.paragraphs.every(item => item.sectionPath.length === 0))
  assert.deepEqual(parsed.document.tables[0]?.rows, [['A', '', 'C']])
  assert.equal(parsed.evidence.records.length, 4)
})

test('parser extracts unknown factual entities and explicit coordinate grounding', async t => {
  t.mock.method(mammoth, 'convertToHtml', async () => ({
    value: '<p>Coastal Air Rescue Exercise Review</p><h1>Overview</h1><p>08:10 - Blue Coast Guard dispatched a four-aircraft Falcon formation from North Bay at coordinates: 10.125, 20.250.</p>',
    messages: [],
  }))

  const parsed = await parseBattleReport(Buffer.from('synthetic-cross-document'))
  const record = parsed.evidence.records.find(item => item.claim.includes('Blue Coast Guard'))!

  assert.ok(record.entities.includes('Blue Coast Guard'))
  assert.ok(record.entities.includes('Falcon'))
  assert.equal(record.locationExpression, 'coordinates:10.125,20.250')
})

test('parser extracts a grounded start/end route expression from one factual paragraph', async t => {
  t.mock.method(mammoth, 'convertToHtml', async () => ({
    value: '<p>Start/end route report</p><h1>Movement</h1><p>Su-30MKI departs from coordinates:75.100,30.100 to coordinates:76.200,31.200.</p>',
    messages: [],
  }))

  const parsed = await parseBattleReport(Buffer.from('synthetic-start-end-route'))
  const record = parsed.evidence.records.find(item => item.claim.includes('Su-30MKI'))!

  assert.deepEqual(record.routeExpression, {
    start: [75.1, 30.1],
    end: [76.2, 31.2],
    pathStyle: 'great_circle',
  })
})
