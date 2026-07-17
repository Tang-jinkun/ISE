import { z } from 'zod'
import { actorInstanceSchema } from './sceneBlueprint.ts'

const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)

export const actorLifecycleSchema = z.strictObject({
  actorInstanceRef: z.string().min(1),
  firstSceneBeatRef: z.string().min(1),
  lastSceneBeatRef: z.string().min(1),
})

export const motionSegmentSchema = z.strictObject({
  segmentId: z.string().min(1),
  actorInstanceRef: z.string().min(1),
  sceneBeatRef: z.string().min(1),
  behavior: z.string().min(1),
  routeAssignmentRef: z.string().min(1),
  coverage: z.literal('actor-lifecycle'),
})

export const formationSegmentSchema = z.strictObject({
  segmentId: z.string().min(1),
  sceneBeatRef: z.string().min(1),
  actorInstanceRefs: z.array(z.string().min(1)).min(1),
  formationPattern: z.string().min(1),
})

export const weaponEngagementSchema = z.strictObject({
  engagementId: z.string().min(1),
  sceneBeatRef: z.string().min(1),
  launcherRef: z.string().min(1),
  weaponRef: z.string().min(1),
  targetRef: z.string().min(1),
  outcome: z.enum(['intercepted', 'interception', 'destroyed', 'unconfirmed']),
  evidenceRefs: z.array(z.string().min(1)),
})

export const relationSegmentSchema = z.strictObject({
  segmentId: z.string().min(1),
  sceneBeatRef: z.string().min(1),
  sourceRef: z.string().min(1),
  targetRef: z.string().min(1),
  linkKind: z.enum(['awacs-fighter', 'fighter-missile']),
  evidenceRefs: z.array(z.string().min(1)).min(1),
})

export const effectSegmentSchema = z.strictObject({
  segmentId: z.string().min(1),
  sceneBeatRef: z.string().min(1),
  effect: z.string().min(1),
  subjectRefs: z.array(z.string().min(1)),
})

export const shotPlanEntrySchema = z.strictObject({
  shotId: z.string().min(1),
  subtitleId: z.string().min(1),
  sceneBeatRefs: z.array(z.string().min(1)).min(1),
  intent: z.string().min(1),
  subjectRefs: z.array(z.string().min(1)).min(1),
  framing: z.string().min(1),
  movement: z.string().min(1),
  startConstraint: z.string().min(1),
  durationRange: z.strictObject({
    minMs: z.number().int().positive(),
    maxMs: z.number().int().positive(),
  }),
  transition: z.string().min(1),
  visibilityRequirements: z.array(z.string().min(1)),
  phase: z.enum(['launch', 'midcourse', 'terminal', 'aftermath']).optional(),
})

export const overlayPlanEntrySchema = z.strictObject({
  overlayId: z.string().min(1),
  sceneBeatRef: z.string().min(1),
  mediaRef: z.string().min(1),
  purpose: z.string().min(1),
})

export const timeConstraintSchema = z.strictObject({
  constraintId: z.string().min(1),
  subjectRef: z.string().min(1),
  kind: z.string().min(1),
  valueMs: z.number().int().nonnegative(),
})

export const choreographyLineageSchema = z.strictObject({
  outputRef: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)).min(1),
})

export const choreographyPlanSchema = z.strictObject({
  schemaVersion: z.literal('ise.choreography-plan/v1'),
  choreographyPlanId: z.string().min(1),
  sourceResolvedScenePlanId: z.string().min(1),
  sourceResolvedScenePlanFingerprint: fingerprintSchema,
  actorInstances: z.array(actorInstanceSchema),
  actorLifecycles: z.array(actorLifecycleSchema),
  motionSegments: z.array(motionSegmentSchema),
  formationSegments: z.array(formationSegmentSchema),
  weaponEngagements: z.array(weaponEngagementSchema),
  relationSegments: z.array(relationSegmentSchema),
  effectSegments: z.array(effectSegmentSchema),
  shotPlan: z.array(shotPlanEntrySchema),
  overlayPlan: z.array(overlayPlanEntrySchema),
  timeConstraints: z.array(timeConstraintSchema),
  lineage: z.array(choreographyLineageSchema),
})

export type ActorLifecycle = z.infer<typeof actorLifecycleSchema>
export type MotionSegment = z.infer<typeof motionSegmentSchema>
export type FormationSegment = z.infer<typeof formationSegmentSchema>
export type WeaponEngagement = z.infer<typeof weaponEngagementSchema>
export type RelationSegment = z.infer<typeof relationSegmentSchema>
export type EffectSegment = z.infer<typeof effectSegmentSchema>
export type ShotPlanEntry = z.infer<typeof shotPlanEntrySchema>
export type OverlayPlanEntry = z.infer<typeof overlayPlanEntrySchema>
export type TimeConstraint = z.infer<typeof timeConstraintSchema>
export type ChoreographyLineage = z.infer<typeof choreographyLineageSchema>
export type ChoreographyPlan = z.infer<typeof choreographyPlanSchema>
