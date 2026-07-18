import { z } from 'zod'

const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const trajectoryAssetRefSchema = z.custom<`trajectory:${string}`>(
  value => typeof value === 'string' && /^trajectory:[a-z0-9][a-z0-9._:-]*$/.test(value),
  { message: 'Invalid trajectory asset reference' },
)
const modelAssetRefSchema = z.string().regex(/^model:[a-z0-9][a-z0-9._:-]*$/)
const coordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
])

export const trajectoryRepairRecordSchema = z.strictObject({
  sourceFingerprint: fingerprintSchema,
  repairRuleVersion: z.string().min(1),
  affectedSampleRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  boundaryTimesBeforeMs: z.tuple([z.number().int(), z.number().int()]),
  boundaryTimesAfterMs: z.tuple([z.number().int(), z.number().int()]),
  offsetMs: z.number().int(),
})

export const trajectoryCatalogEntrySchema = z.strictObject({
  trajectoryAssetId: trajectoryAssetRefSchema,
  fingerprint: fingerprintSchema,
  routeLabel: z.string().min(1),
  side: z.string().min(1).optional(),
  semanticTags: z.array(z.string().min(1)),
  scenarioBindings: z.array(z.string().min(1)),
  startTimeMs: z.number().int().nonnegative(),
  endTimeMs: z.number().int().nonnegative(),
  bounds: z.tuple([coordinateSchema, coordinateSchema]).optional(),
  validationStatus: z.enum(['valid', 'curated_repair', 'invalid']),
  repairRecord: trajectoryRepairRecordSchema.optional(),
})

export const trajectoryCatalogSchema = z.strictObject({
  schemaVersion: z.literal('ise.trajectory-catalog/v1'),
  catalogId: z.string().min(1),
  fingerprint: fingerprintSchema,
  entries: z.array(trajectoryCatalogEntrySchema),
})

export const scenarioTrajectoryBundleSchema = z.strictObject({
  bundleId: z.string().min(1),
  modelAssetRef: modelAssetRefSchema,
  routeAssetRefs: z.array(trajectoryAssetRefSchema).min(1),
  semanticEntityAliases: z.array(z.string().min(1)).min(1),
  behaviorProfileRefs: z.array(z.string().min(1)).min(1),
  locationRefs: z.array(z.string().min(1)),
  diagnostics: z.array(z.string().min(1)),
})

export const scenarioTrajectoryMappingSchema = z.strictObject({
  schemaVersion: z.literal('ise.scenario-trajectory-mapping/v1'),
  scenarioId: z.string().min(1),
  bundles: z.array(scenarioTrajectoryBundleSchema),
})

export const formationBundleSchema = z.strictObject({
  bundleId: z.string().min(1),
  actorGroupRef: z.string().min(1),
  modelAssetRef: modelAssetRefSchema.optional(),
  routeAssetRefs: z.array(trajectoryAssetRefSchema).min(1),
  recommendedActorCount: z.number().int().positive(),
  role: z.string().min(1),
  side: z.string().min(1).optional(),
  semanticTags: z.array(z.string().min(1)),
  scenarioBindings: z.array(z.string().min(1)),
  mappingAuthority: z.enum(['evidence', 'scenario_config', 'user', 'catalog_hint']),
  diagnostics: z.array(z.string().min(1)),
})

export const routeSourceKindSchema = z.enum(['attachment', 'catalog', 'user', 'illustrative'])

export const actorRouteAssignmentSchema = z.strictObject({
  actorInstanceRef: z.string().min(1),
  formationBundleRef: z.string().min(1),
  trajectoryAssetRef: trajectoryAssetRefSchema,
  segmentId: z.string().min(1),
  resamplePolicy: z.literal('preserve-source-samples'),
  timeMapping: z.strictObject({
    mode: z.literal('fit-window'),
    startMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
  }),
  spatialPathMode: z.literal('preserve'),
  sourceKind: routeSourceKindSchema,
  matchReason: z.string().min(1),
  lineage: z.array(z.string().min(1)),
})

export type TrajectoryRepairRecord = z.infer<typeof trajectoryRepairRecordSchema>
export type TrajectoryCatalogEntry = z.infer<typeof trajectoryCatalogEntrySchema>
export type TrajectoryCatalog = z.infer<typeof trajectoryCatalogSchema>
export type ScenarioTrajectoryBundle = z.infer<typeof scenarioTrajectoryBundleSchema>
export type ScenarioTrajectoryMapping = z.infer<typeof scenarioTrajectoryMappingSchema>
export type FormationBundle = z.infer<typeof formationBundleSchema>
export type RouteSourceKind = z.infer<typeof routeSourceKindSchema>
export type ActorRouteAssignment = z.infer<typeof actorRouteAssignmentSchema>
