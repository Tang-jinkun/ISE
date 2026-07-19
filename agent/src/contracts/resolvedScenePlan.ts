import { z } from 'zod'
import { compilationDiagnosticSchema } from '../services/runtimeDiagnostics.ts'
import { actorInstanceSchema } from './sceneBlueprint.ts'
import { actorRouteAssignmentSchema, formationBundleSchema } from './trajectoryCatalog.ts'

const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const generatedTrajectoryAssetSchema = z.strictObject({
  assetId: z.string().regex(/^trajectory:[a-z0-9][a-z0-9._-]*$/),
  sourceKind: z.literal('generated'),
  generationMethod: z.literal('document-endpoints-v1'),
  sourceRefs: z.array(z.string().min(1)).min(1),
  pathStyle: z.enum(['great_circle', 'intercept']),
  targetActorId: z.string().min(1).optional(),
  trajectory: z.strictObject({
    format: z.literal('ise-trajectory/v1'),
    timeUnit: z.literal('ms'),
    coordinateOrder: z.literal('lng-lat-alt'),
    startTimeMs: z.number().int().nonnegative(),
    endTimeMs: z.number().int().nonnegative(),
    monotonic: z.literal(true),
    bounds: z.tuple([
      z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
      z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
    ]),
    points: z.array(z.strictObject({
      timeMs: z.number().int().nonnegative(),
      longitude: z.number().finite().min(-180).max(180),
      latitude: z.number().finite().min(-90).max(90),
      altitudeM: z.number().finite(),
    })).min(2),
  }),
})

export const fallbackTrajectoryRecipeSchema = z.strictObject({
  recipeId: z.string().min(1),
  actorGroupRef: z.string().min(1),
  reason: z.string().min(1),
  sourceKind: z.literal('illustrative'),
  approvedByUser: z.boolean(),
  generatorVersion: z.string().min(1),
  lineage: z.array(z.string().min(1)),
})

export const staticActorBindingSchema = z.strictObject({
  actorInstanceRef: z.string().min(1),
  actorGroupRef: z.string().min(1),
  modelAssetRef: z.string().regex(/^model:[a-z0-9][a-z0-9._-]*$/).optional(),
  coordinates: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
  locationRef: z.string().min(1),
  lineage: z.array(z.string().min(1)).min(1),
})

export const resolvedScenePlanSchema = z.strictObject({
  schemaVersion: z.literal('ise.resolved-scene-plan/v1'),
  resolvedScenePlanId: z.string().min(1),
  sourceBlueprintId: z.string().min(1),
  sourceBlueprintFingerprint: fingerprintSchema,
  scenarioPack: z.strictObject({
    packId: z.string().min(1),
    version: z.string().min(1),
  }).optional(),
  trajectoryCatalogFingerprint: fingerprintSchema,
  scenarioMappingFingerprint: fingerprintSchema,
  resolvedActors: z.array(actorInstanceSchema),
  resolvedLocations: z.array(z.string().min(1)),
  resolvedAssets: z.array(z.string().min(1)),
  resolvedFormationBundles: z.array(formationBundleSchema),
  actorRouteAssignments: z.array(actorRouteAssignmentSchema),
  staticActorBindings: z.array(staticActorBindingSchema).default([]),
  generatedTrajectoryAssets: z.array(generatedTrajectoryAssetSchema).default([]),
  fallbackTrajectoryRecipes: z.array(fallbackTrajectoryRecipeSchema),
  resolvedBehaviors: z.array(z.string().min(1)),
  resolvedMedia: z.array(z.string().min(1)),
  fallbackDecisions: z.array(z.string().min(1)),
  diagnostics: z.array(compilationDiagnosticSchema),
})

export type FallbackTrajectoryRecipe = z.infer<typeof fallbackTrajectoryRecipeSchema>
export type StaticActorBinding = z.infer<typeof staticActorBindingSchema>
export type GeneratedTrajectoryAsset = z.infer<typeof generatedTrajectoryAssetSchema>
export type ResolvedScenePlan = z.infer<typeof resolvedScenePlanSchema>
