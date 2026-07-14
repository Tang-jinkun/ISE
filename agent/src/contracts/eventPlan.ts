import { z } from 'zod'

export const eventUnitSchema = z.object({
  eventUnitId: z.string().min(1),
  title: z.string().min(1),
  worldStateChange: z.string().min(1),
  participants: z.array(z.string().min(1)),
  locationRefs: z.array(z.string().min(1)),
  realWorldTime: z.string().min(1).optional(),
  evidenceRefs: z.array(z.string().min(1)),
  inferenceRefs: z.array(z.string().min(1)),
  uncertainties: z.array(z.string()),
  narrativePurpose: z.string().min(1),
  importance: z.enum(['high', 'medium', 'low']),
}).strict().refine(
  unit => unit.evidenceRefs.length > 0 || unit.inferenceRefs.length > 0,
  { message: 'EventUnit requires evidenceRefs or inferenceRefs' },
)

export const eventPlanSchema = z.object({
  schemaVersion: z.literal('event-plan/v1'),
  planId: z.string().min(1),
  documentId: z.string().min(1),
  version: z.number().int().positive(),
  eventUnits: z.array(eventUnitSchema).min(1).max(10),
  omittedEvidence: z.array(z.string()),
  warnings: z.array(z.string()),
}).strict()

export type EventUnit = z.infer<typeof eventUnitSchema>
export type EventPlan = z.infer<typeof eventPlanSchema>
