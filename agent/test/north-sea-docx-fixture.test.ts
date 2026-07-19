import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseBattleReport } from '../src/services/documentParser.ts'

const fixture = new URL('./fixtures/north-sea-evacuation-interception.docx', import.meta.url)

test('the North Sea fixture contains only grounded start/end movement evidence', async () => {
  const parsed = await parseBattleReport(await readFile(fixture))
  const routeRecords = parsed.evidence.records.filter(record => record.routeExpression !== undefined)
  const source = parsed.document.paragraphs.map(paragraph => paragraph.text).join('\n')

  assert.ok(routeRecords.length >= 5)
  assert.ok(routeRecords.every(record => record.routeExpression?.start.length === 2))
  assert.ok(routeRecords.every(record => record.routeExpression?.end.length === 2))
  assert.match(source, /one Boeing E-3A Sentry AWACS/iu)
  assert.match(source, /formation of four Rafale/iu)
  assert.match(source, /formation of four J-10/iu)
  assert.match(source, /confirmed destroyed/iu)
  assert.match(source, /outcome remains unconfirmed/iu)
  assert.doesNotMatch(source, /India|Pakistan|Adampur|Ambala|Minhas|Rafiki/iu)
  assert.doesNotMatch(source, /trajectory JSON|route file/iu)
})
