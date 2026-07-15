import { z } from 'zod'

export const templateNameSchema = z.enum([
  'deployment',
  'attack_chain',
  'interception',
  'electronic_warfare',
  'counterattack',
  'withdrawal',
  'return_and_summary',
  'generic_movement',
  'status_explanation',
])
export type TemplateName = z.infer<typeof templateNameSchema>

export const narrativePlanSchema = z.strictObject({
  schemaVersion: z.literal('narrative-plan/v1'),
  narrativePlanId: z.string().min(1),
  sourceEventPlan: z.strictObject({
    artifactId: z.string().min(1),
    planId: z.string().min(1),
    version: z.number().int().positive(),
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  }),
  targetDurationMs: z.number().int().min(30_000).max(600_000).default(180_000),
  subtitles: z.array(z.strictObject({
    subtitleId: z.string().min(1),
    eventUnitId: z.string().min(1),
    text: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    importance: z.enum(['high', 'medium', 'low']),
  })).min(1),
  sceneRequirements: z.array(z.strictObject({
    requirementId: z.string().min(1),
    eventUnitId: z.string().min(1),
    focusEntities: z.array(z.string().min(1)),
    spatialRelations: z.array(z.string().min(1)),
    stateChanges: z.array(z.string().min(1)),
    motionRequirements: z.array(z.string().min(1)),
    attentionRequirements: z.array(z.string().min(1)),
    requiredFacts: z.array(z.string().min(1)),
    forbiddenClaims: z.array(z.string().min(1)),
    preferredTemplate: templateNameSchema.optional(),
  })).min(1),
})

export type NarrativePlan = z.infer<typeof narrativePlanSchema>
export type SceneRequirement = NarrativePlan['sceneRequirements'][number]
const generatedNarrativePlanInputJsonSchema = z.toJSONSchema(narrativePlanSchema, { target: 'draft-2020-12' })
export const narrativePlanInputJsonSchema = {
  ...generatedNarrativePlanInputJsonSchema,
  required: Array.isArray(generatedNarrativePlanInputJsonSchema.required)
    ? generatedNarrativePlanInputJsonSchema.required.filter(key => key !== 'targetDurationMs')
    : generatedNarrativePlanInputJsonSchema.required,
}
