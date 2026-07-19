import { z } from 'zod'
import { compilationDiagnosticSchema } from '../services/runtimeDiagnostics.ts'
import type { CompilationDiagnostic } from '../services/runtimeDiagnostics.ts'

const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)

export const quantitySourceSchema = z.enum(['evidence', 'user', 'default'])
export const quantityConstraintSchema = z.enum(['exact', 'at_least', 'plural', 'unknown'])

export const quantityDecisionSchema = z.strictObject({
  value: z.number().int().positive(),
  constraint: quantityConstraintSchema,
  source: quantitySourceSchema,
  evidenceRefs: z.array(z.string().min(1)),
  defaultPolicyId: z.string().min(1).optional(),
  reason: z.string().min(1),
})

export const actorGroupSchema = z.strictObject({
  groupId: z.string().min(1),
  semanticEntityRef: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)),
  side: z.string().min(1),
  locationRef: z.string().min(1),
  platformType: z.string().min(1),
  role: z.string().min(1),
  quantityDecision: quantityDecisionSchema,
  formationPattern: z.string().min(1),
  leaderPolicy: z.string().min(1),
  behaviorProfile: z.string().min(1),
  lifecycle: z.string().min(1),
})

export const actorInstanceSchema = z.strictObject({
  actorInstanceId: z.string().regex(/^actor:.+/),
  actorGroupRef: z.string().min(1),
  role: z.enum(['leader', 'wingman', 'member']),
  ordinal: z.number().int().nonnegative(),
})

export const engagementIntentSchema = z.strictObject({
  engagementIntentId: z.string().min(1),
  eventUnitId: z.string().min(1),
  outcomeEventUnitId: z.string().min(1).optional(),
  launcherGroupRef: z.string().min(1),
  weaponGroupRef: z.string().min(1),
  targetGroupRef: z.string().min(1),
  assertedOutcome: z.enum(['intercepted', 'interception', 'destroyed', 'unconfirmed']),
  evidenceRefs: z.array(z.string().min(1)).min(1),
})

export const sceneBeatSchema = z.strictObject({
  sceneBeatId: z.string().min(1),
  subtitleId: z.string().min(1).optional(),
  eventUnitId: z.string().min(1),
  purpose: z.string().min(1),
  actorRefs: z.array(z.string().min(1)),
  behaviorIntents: z.array(z.string().min(1)),
  spatialConstraints: z.array(z.string().min(1)),
  stateTransitions: z.array(z.string().min(1)),
  cameraIntent: z.string().min(1),
  mediaIntents: z.array(z.string().min(1)),
  requiredFacts: z.array(z.string().min(1)),
  forbiddenClaims: z.array(z.string().min(1)),
  fidelity: z.enum(['evidence', 'deterministic', 'default', 'user', 'illustrative']),
  priority: z.enum(['high', 'medium', 'low']),
})

export const sceneBlueprintSchema = z.strictObject({
  schemaVersion: z.literal('ise.scene-blueprint/v1'),
  blueprintId: z.string().min(1),
  sourceNarrationPlanId: z.string().min(1),
  sourceNarrationFingerprint: fingerprintSchema,
  scenarioPack: z.strictObject({
    packId: z.string().min(1),
    version: z.string().min(1),
  }).optional(),
  actorGroups: z.array(actorGroupSchema),
  engagementIntents: z.array(engagementIntentSchema).default([]),
  sceneBeats: z.array(sceneBeatSchema),
  diagnostics: z.array(compilationDiagnosticSchema),
})

export type QuantitySource = z.infer<typeof quantitySourceSchema>
export type QuantityConstraint = z.infer<typeof quantityConstraintSchema>
export type QuantityDecision = z.infer<typeof quantityDecisionSchema>
export type ActorGroup = z.infer<typeof actorGroupSchema>

/** Semantic planning metadata is deliberately omitted from the runtime blueprint. */
export interface ActorGroupIntent extends ActorGroup {
  aliases: readonly string[]
  participantAliases: readonly string[]
  platformKind: 'aircraft' | 'weapon' | 'sensor' | 'vehicle' | 'unknown'
  diagnostics: readonly CompilationDiagnostic[]
}
export type ActorInstance = z.infer<typeof actorInstanceSchema>
export type EngagementIntent = z.infer<typeof engagementIntentSchema>
export type SceneBeat = z.infer<typeof sceneBeatSchema>
export type SceneBlueprint = z.infer<typeof sceneBlueprintSchema>
