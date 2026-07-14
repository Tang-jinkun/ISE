import { z } from 'zod'

export const evidenceKindSchema = z.enum([
  'explicit_fact',
  'deterministic_derivation',
  'model_inference',
  'illustrative',
])

export const evidenceRecordSchema = z.object({
  evidenceId: z.string().min(1),
  sourceRef: z.string().min(1),
  claim: z.string().min(1),
  kind: evidenceKindSchema,
  entities: z.array(z.string().min(1)),
  timeExpression: z.string().min(1).optional(),
  locationExpression: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string()),
}).strict()

export const evidenceIrSchema = z.object({
  schemaVersion: z.literal('evidence-ir/v1'),
  documentId: z.string().min(1),
  records: z.array(evidenceRecordSchema),
}).strict()

export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>
export type EvidenceIR = z.infer<typeof evidenceIrSchema>
