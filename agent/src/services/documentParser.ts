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

const COORDINATE_EXPRESSION = /\bcoordinates?\s*:\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)/iu
const GENERIC_ENTITY_EXPRESSION = /\b[A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*)*/g
const GENERIC_ENTITY_STOPWORDS = new Set([
  'A', 'An', 'And', 'At', 'Blue', 'Coast', 'Civilian', 'East', 'Exercise', 'From', 'No',
  'North', 'Red', 'Rescue', 'Review', 'South', 'The', 'This', 'Toward', 'West',
])

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
  const coordinateMatch = COORDINATE_EXPRESSION.exec(text)
  const knownEntities = ENTITY_DICTIONARY.filter(entity => text.includes(entity))
  const genericEntities = extractGenericEntities(text).filter(entity =>
    !knownEntities.some(known => known.toLocaleLowerCase('en-US') === entity.toLocaleLowerCase('en-US')))

  return {
    evidenceId: `ev-${hashSuffix(sha256(`${sourceRef}\n${text}`))}`,
    sourceRef,
    claim: text,
    kind: 'explicit_fact',
    entities: [...new Set([...knownEntities, ...genericEntities])],
    ...(coordinateMatch === null ? {} : {
      locationExpression: `coordinates:${coordinateMatch[1]},${coordinateMatch[2]}`,
    }),
    ...(timeExpression === undefined ? {} : { timeExpression }),
    confidence: 1,
    ambiguities: [],
  }
}

function extractGenericEntities(value: string): string[] {
  return [...value.matchAll(GENERIC_ENTITY_EXPRESSION)]
    .map(match => match[0]?.trim())
    .filter((candidate): candidate is string => candidate !== undefined)
    .map(candidate => candidate.replace(/^(?:A|An|The|This)\s+/u, ''))
    .filter(candidate => {
      const words = candidate.split(/\s+/u)
      if (words.length > 1) return true
      if (candidate.length < 3 || GENERIC_ENTITY_STOPWORDS.has(candidate)) return false
      return !/^\d/.test(candidate)
    })
}

function hashSuffix(hash: string): string {
  return hash.slice(HASH_PREFIX_LENGTH, HASH_PREFIX_LENGTH + 16)
}
