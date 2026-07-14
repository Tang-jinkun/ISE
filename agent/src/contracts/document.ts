import { z } from 'zod'

export const documentParagraphSchema = z.object({
  paragraphId: z.string().min(1),
  sourceRef: z.string().min(1),
  sectionPath: z.array(z.string().min(1)),
  text: z.string().min(1),
}).strict()

export const documentTableSchema = z.object({
  tableId: z.string().min(1),
  sourceRef: z.string().min(1),
  sectionPath: z.array(z.string().min(1)),
  rows: z.array(z.array(z.string())),
}).strict()

export const documentSectionSchema = z.object({
  sectionId: z.string().min(1),
  level: z.number().int().min(1).max(6),
  title: z.string().min(1),
  sourceRef: z.string().min(1),
}).strict()

export const documentIrSchema = z.object({
  schemaVersion: z.literal('document-ir/v1'),
  documentId: z.string().min(1),
  title: z.string().min(1),
  sourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  sections: z.array(documentSectionSchema),
  paragraphs: z.array(documentParagraphSchema),
  tables: z.array(documentTableSchema),
  warnings: z.array(z.string()),
}).strict()

export type DocumentIR = z.infer<typeof documentIrSchema>
