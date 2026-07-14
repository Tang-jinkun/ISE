import { load } from 'cheerio'
import mammoth from 'mammoth'
import { documentIrSchema, type DocumentIR } from '../contracts/document.ts'
import { evidenceIrSchema, type EvidenceIR, type EvidenceRecord } from '../contracts/evidence.ts'
import { sha256 } from './fingerprint.ts'

const HASH_PREFIX_LENGTH = 'sha256:'.length
const ENTITY_DICTIONARY = [
  '苏-30MKI',
  '阵风',
  'JF-17',
  'J-10CE',
  '预警机',
  '地面雷达',
  '阿达姆普尔',
  '安巴拉',
  '米纳斯',
  '拉菲基',
  '印度',
  '巴方',
  '印方',
] as const
const TIME_EXPRESSION = /\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}/

export interface ParsedBattleReport {
  document: DocumentIR
  evidence: EvidenceIR
}

export async function parseBattleReport(buffer: Buffer): Promise<ParsedBattleReport> {
  const sourceHash = sha256(buffer)
  const documentId = `doc-${hashSuffix(sourceHash)}`
  const converted = await mammoth.convertToHtml({ buffer })
  const $ = load(converted.value)
  const sections: DocumentIR['sections'] = []
  const paragraphs: DocumentIR['paragraphs'] = []
  const tables: DocumentIR['tables'] = []
  const warnings: string[] = []
  const sectionTitles = new Map<number, string>()
  let title: string | undefined
  let hasHeading = false

  const currentSectionPath = (): string[] => [...sectionTitles.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, sectionTitle]) => sectionTitle)

  const addParagraph = (text: string): void => {
    if (!text) return
    if (!hasHeading && title === undefined) title = text
    const paragraphIndex = paragraphs.length
    const sourceRef = `doc:${documentId}:paragraph:${paragraphIndex}`
    paragraphs.push({
      paragraphId: sourceRef,
      sourceRef,
      sectionPath: currentSectionPath(),
      text,
    })
  }

  $('body').children().each((_index, node) => {
    const tagName = node.tagName.toLowerCase()
    const heading = /^h([1-6])$/.exec(tagName)

    if (heading) {
      const headingTitle = $(node).text().trim()
      if (!headingTitle) return
      const level = Number(heading[1])
      hasHeading = true
      for (const existingLevel of sectionTitles.keys()) {
        if (existingLevel >= level) sectionTitles.delete(existingLevel)
      }
      sectionTitles.set(level, headingTitle)
      const sectionIndex = sections.length
      const sourceRef = `doc:${documentId}:section:${sectionIndex}`
      sections.push({
        sectionId: sourceRef,
        level,
        title: headingTitle,
        sourceRef,
      })
      return
    }

    if (tagName === 'p') {
      addParagraph($(node).text().trim())
      return
    }

    if (tagName === 'ul' || tagName === 'ol') {
      $(node).children('li').each((_listIndex, listItem) => {
        addParagraph($(listItem).text().trim())
      })
      return
    }

    if (tagName === 'table') {
      const tableIndex = tables.length
      const sourceRef = `doc:${documentId}:table:${tableIndex}`
      const rows = $(node).find('tr').toArray().map(row => (
        $(row).children('th, td').toArray().map(cell => $(cell).text().trim())
      ))
      tables.push({
        tableId: sourceRef,
        sourceRef,
        sectionPath: currentSectionPath(),
        rows,
      })
    }
  })

  if (!hasHeading) warnings.push('No headings found in document.')

  const document = documentIrSchema.parse({
    schemaVersion: 'document-ir/v1',
    documentId,
    title,
    sourceHash,
    sections,
    paragraphs,
    tables,
    warnings,
  })
  const evidence = evidenceIrSchema.parse({
    schemaVersion: 'evidence-ir/v1',
    documentId,
    records: paragraphs.map(createEvidenceRecord),
  })

  return { document, evidence }
}

function createEvidenceRecord(paragraph: DocumentIR['paragraphs'][number]): EvidenceRecord {
  const { sourceRef, text } = paragraph
  const timeExpression = text.match(TIME_EXPRESSION)?.[0]

  return {
    evidenceId: `ev-${hashSuffix(sha256(`${sourceRef}\n${text}`))}`,
    sourceRef,
    claim: text,
    kind: 'explicit_fact',
    entities: ENTITY_DICTIONARY.filter(entity => text.includes(entity)),
    ...(timeExpression === undefined ? {} : { timeExpression }),
    confidence: 1,
    ambiguities: [],
  }
}

function hashSuffix(hash: string): string {
  return hash.slice(HASH_PREFIX_LENGTH, HASH_PREFIX_LENGTH + 16)
}
