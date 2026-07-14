import { z } from 'zod'
import type { AgentTool, ArtifactInput } from '@ise/agent-core'
import {
  DOCUMENT_IR_ARTIFACT,
  EVIDENCE_IR_ARTIFACT,
} from '../contracts/artifactTypes.ts'
import type { DocumentIR } from '../contracts/document.ts'
import { evidenceIrSchema, type EvidenceIR } from '../contracts/evidence.ts'
import type { AttachmentRegistry } from '../services/attachmentRegistry.ts'
import { parseBattleReport } from '../services/documentParser.ts'

const parseInputSchema = z.object({
  fileId: z.string().min(1),
}).strict()

const inspectInputSchema = z.object({
  documentId: z.string().min(1).optional(),
  query: z.string().optional(),
  evidenceIds: z.array(z.string().min(1)).optional(),
  limit: z.number().int().optional(),
}).strict()

const parseBattleReportInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fileId'],
  properties: { fileId: { type: 'string', minLength: 1 } },
} as const

const inspectReportEvidenceInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentId: { type: 'string', minLength: 1 },
    query: { type: 'string' },
    evidenceIds: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    limit: { type: 'integer' },
  },
} as const

export function createDocumentTools(registry: AttachmentRegistry): AgentTool[] {
  const parseTool: AgentTool = {
    name: 'parse_battle_report',
    description: 'Parse a registered battle report into document and evidence artifacts',
    inputSchema: parseBattleReportInputSchema,
    risk: 'derive',
    async execute(input) {
      const { fileId } = parseInputSchema.parse(input)
      const { document, evidence } = await parseBattleReport(await registry.readVerified(fileId))
      const artifacts: [ArtifactInput<DocumentIR>, ArtifactInput<EvidenceIR>] = [
        {
          type: DOCUMENT_IR_ARTIFACT,
          createdBy: 'tool',
          logicalKey: `document:${document.documentId}`,
          data: document,
          metadata: {
            documentId: document.documentId,
            sourceHash: document.sourceHash,
          },
        },
        {
          type: EVIDENCE_IR_ARTIFACT,
          createdBy: 'tool',
          logicalKey: `evidence:${document.documentId}`,
          data: evidence,
          metadata: { documentId: document.documentId },
        },
      ]

      return {
        content: JSON.stringify({
          documentId: document.documentId,
          evidenceCount: evidence.records.length,
        }),
        artifacts,
      }
    },
  }

  const inspectTool: AgentTool = {
    name: 'inspect_report_evidence',
    description: 'Inspect matching records from active report evidence artifacts',
    inputSchema: inspectReportEvidenceInputSchema,
    risk: 'read',
    isConcurrencySafe: true,
    async execute(input, context) {
      const { documentId, query, evidenceIds, limit: requestedLimit } = inspectInputSchema.parse(input)
      const activeEvidence = context.artifacts
        .list(EVIDENCE_IR_ARTIFACT)
        .map(artifact => evidenceIrSchema.parse(artifact.data))
        .filter(evidence => documentId === undefined || evidence.documentId === documentId)

      if (activeEvidence.length === 0) {
        throw new Error('No active EvidenceIR artifact found')
      }

      const normalizedQuery = query?.toLowerCase()
      const selectedIds = evidenceIds === undefined ? undefined : new Set(evidenceIds)
      const limit = Math.min(20, Math.max(1, requestedLimit ?? 10))
      const records = activeEvidence
        .flatMap(evidence => evidence.records)
        .filter(record => selectedIds === undefined || selectedIds.has(record.evidenceId))
        .filter(record => normalizedQuery === undefined || [
          record.claim,
          ...record.entities,
          record.sourceRef,
        ].some(value => value.toLowerCase().includes(normalizedQuery)))
        .slice(0, limit)

      return { content: JSON.stringify({ records }) }
    },
  }

  return [parseTool, inspectTool]
}
