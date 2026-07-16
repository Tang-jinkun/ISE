import { z } from 'zod'
import { compilationDiagnosticSchema } from '../services/runtimeDiagnostics.ts'

const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)

export const narrationBeatSchema = z.strictObject({
  subtitleId: z.string().min(1),
  eventUnitId: z.string().min(1),
  text: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  beatRole: z.enum(['setup', 'action', 'transition', 'turning_point', 'result', 'summary']),
  attentionTarget: z.string().min(1),
  importance: z.enum(['high', 'medium', 'low']),
  estimatedDurationMs: z.number().int().positive(),
})

export const narrationPlanSchema = z.strictObject({
  schemaVersion: z.literal('ise.narration-plan/v1'),
  narrationPlanId: z.string().min(1),
  sourceEventPlanId: z.string().min(1),
  sourceEventPlanFingerprint: fingerprintSchema,
  sourceNarrativePlanId: z.string().min(1),
  beats: z.array(narrationBeatSchema).min(1),
  diagnostics: z.array(compilationDiagnosticSchema),
})

export type NarrationBeat = z.infer<typeof narrationBeatSchema>
export type NarrationPlan = z.infer<typeof narrationPlanSchema>
