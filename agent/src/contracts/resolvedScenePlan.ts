import { z } from 'zod'
import { compilationDiagnosticSchema } from '../services/runtimeDiagnostics.ts'
import { actorInstanceSchema } from './sceneBlueprint.ts'
import { actorRouteAssignmentSchema, formationBundleSchema } from './trajectoryCatalog.ts'

const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)

export const fallbackTrajectoryRecipeSchema = z.strictObject({
  recipeId: z.string().min(1),
  actorGroupRef: z.string().min(1),
  reason: z.string().min(1),
  sourceKind: z.literal('illustrative'),
  approvedByUser: z.boolean(),
  generatorVersion: z.string().min(1),
  lineage: z.array(z.string().min(1)),
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
  fallbackTrajectoryRecipes: z.array(fallbackTrajectoryRecipeSchema),
  resolvedBehaviors: z.array(z.string().min(1)),
  resolvedMedia: z.array(z.string().min(1)),
  fallbackDecisions: z.array(z.string().min(1)),
  diagnostics: z.array(compilationDiagnosticSchema),
})

export type FallbackTrajectoryRecipe = z.infer<typeof fallbackTrajectoryRecipeSchema>
export type ResolvedScenePlan = z.infer<typeof resolvedScenePlanSchema>
