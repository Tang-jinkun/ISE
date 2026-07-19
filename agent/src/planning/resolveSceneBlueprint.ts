import {
  assetRegistrySnapshotSchema,
  type AssetRegistrySnapshot,
} from '../contracts/assetRegistry.ts'
import type { EvidenceIR } from '../contracts/evidence.ts'
import {
  resolvedScenePlanSchema,
  type ResolvedScenePlan,
} from '../contracts/resolvedScenePlan.ts'
import {
  sceneBlueprintSchema,
  type SceneBlueprint,
} from '../contracts/sceneBlueprint.ts'
import { expandActorGroups } from '../compiler/actorExpansion.ts'
import { assignActorRoutes } from '../services/actorRouteAssigner.ts'
import { fingerprint } from '../services/fingerprint.ts'
import { resolveFormationBundles } from '../services/formationBundleResolver.ts'
import { CompilationError, diagnostic, type CompilationDiagnostic } from '../services/runtimeDiagnostics.ts'
import { buildTrajectoryCatalog } from '../services/trajectoryCatalog.ts'
import { legacyCompatibilityPackForBlueprint, scenarioPackForLineage } from '../services/scenarioPackRegistry.ts'
import { actorRouteAssignmentSchema, formationBundleSchema, scenarioTrajectoryMappingSchema } from '../contracts/trajectoryCatalog.ts'
import { resolveActorAssets } from '../services/actorAssetResolver.ts'
import { generatedTrajectoryBounds, synthesizeStartEndTrajectory, type GeneratedTrajectory } from '../services/startEndTrajectorySynthesizer.ts'

export interface ResolveSceneBlueprintInput {
  blueprint: SceneBlueprint
  assetRegistry: AssetRegistrySnapshot
  evidence?: EvidenceIR
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText)
}

function mappingDiagnostics(
  blueprintDiagnostics: readonly CompilationDiagnostic[],
  messages: readonly string[],
): CompilationDiagnostic[] {
  const resolved = [
    ...blueprintDiagnostics,
    ...messages.map(message => diagnostic(
      message === 'OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY'
        ? message
        : 'SCENARIO_TRAJECTORY_MAPPING_DIAGNOSTIC',
      message,
      'warning',
    )),
  ]
  const seen = new Set<string>()
  return resolved.filter(item => {
    const key = `${item.code}\u0000${item.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const GENERATED_ROUTE_DURATION_MS = 120_000
const ROUTE_ENDPOINT_TOLERANCE_DEG = 0.05

function routeExpressionForGroup(
  group: SceneBlueprint['actorGroups'][number],
  evidence: EvidenceIR | undefined,
) {
  if (!evidence || group.evidenceRefs.length === 0) return undefined
  return evidence.records.find(record =>
    group.evidenceRefs.includes(record.evidenceId) && record.routeExpression !== undefined,
  )?.routeExpression
}

function routeMatchesExpression(
  resolution: ReturnType<typeof resolveActorAssets> | undefined,
  expression: NonNullable<ReturnType<typeof routeExpressionForGroup>>,
  registry: AssetRegistrySnapshot,
): boolean {
  if (!resolution || resolution.trajectoryAssetIds.length === 0) return false
  return resolution.trajectoryAssetIds.every(routeId => {
    const asset = registry.assets.find(candidate => candidate.assetId === routeId)
    if (!asset || asset.kind !== 'trajectory' || !asset.trajectory.points || asset.trajectory.points.length < 2) return false
    const first = asset.trajectory.points[0]!
    const last = asset.trajectory.points.at(-1)!
    return Math.abs(first.longitude - expression.start[0]) <= ROUTE_ENDPOINT_TOLERANCE_DEG
      && Math.abs(first.latitude - expression.start[1]) <= ROUTE_ENDPOINT_TOLERANCE_DEG
      && Math.abs(last.longitude - expression.end[0]) <= ROUTE_ENDPOINT_TOLERANCE_DEG
      && Math.abs(last.latitude - expression.end[1]) <= ROUTE_ENDPOINT_TOLERANCE_DEG
  })
}

function generatedAsset(trajectory: GeneratedTrajectory) {
  const bounds = generatedTrajectoryBounds(trajectory)
  return {
    assetId: trajectory.assetId,
    sourceKind: trajectory.sourceKind,
    generationMethod: trajectory.generationMethod,
    sourceRefs: trajectory.sourceRefs,
    pathStyle: trajectory.pathStyle,
    ...(trajectory.targetActorId ? { targetActorId: trajectory.targetActorId } : {}),
    trajectory: {
      format: 'ise-trajectory/v1' as const,
      timeUnit: 'ms' as const,
      coordinateOrder: 'lng-lat-alt' as const,
      startTimeMs: trajectory.points[0]!.timeMs,
      endTimeMs: trajectory.points.at(-1)!.timeMs,
      monotonic: true as const,
      bounds,
      points: trajectory.points,
    },
  }
}

export function resolveSceneBlueprint(input: ResolveSceneBlueprintInput): ResolvedScenePlan {
  const blueprint = sceneBlueprintSchema.parse(input.blueprint)
  const assetRegistry = assetRegistrySnapshotSchema.parse(input.assetRegistry)
  const catalog = buildTrajectoryCatalog(assetRegistry)
  const scenarioPack = blueprint.scenarioPack === undefined
    ? legacyCompatibilityPackForBlueprint(undefined)
    : scenarioPackForLineage(blueprint.scenarioPack)
  if (scenarioPack === undefined) throw new CompilationError([diagnostic(
    'SCENARIO_PACK_UNAVAILABLE',
    `Scenario pack ${blueprint.scenarioPack!.packId}@${blueprint.scenarioPack!.version} is unavailable.`,
    'error',
  )])
  const mapping = scenarioTrajectoryMappingSchema.parse({
    schemaVersion: 'ise.scenario-trajectory-mapping/v1',
    scenarioId: scenarioPack.packId,
    bundles: scenarioPack.routeBundles,
  })
  const activeGroupIds = new Set(blueprint.sceneBeats.flatMap(beat => beat.actorRefs))
  const activeGroups = blueprint.actorGroups.filter(group => activeGroupIds.has(group.groupId))
  const expandedActors = expandActorGroups(activeGroups)
  // Keep asset selection explicit and auditable before route assignment. The
  // catalog assignment remains the only source of movement paths.
  const allAssetResolutions = blueprint.actorGroups.map(group =>
    resolveActorAssets(group, scenarioPack, assetRegistry))
  const assetResolutions = allAssetResolutions.filter(resolution => activeGroupIds.has(resolution.actorGroupId))
  const baseResolutionByGroup = new Map(assetResolutions.map(resolution => [resolution.actorGroupId, resolution]))
  const generatedTrajectoryAssets = [] as ReturnType<typeof generatedAsset>[]
  const generatedRoutesByGroup = new Map<string, Array<`trajectory:${string}`>>()
  const generatedGroupIds = new Set<string>()
  for (const group of activeGroups) {
    const resolution = baseResolutionByGroup.get(group.groupId)
    const expression = routeExpressionForGroup(group, input.evidence)
    if (!resolution?.modelAssetId || !expression || routeMatchesExpression(resolution, expression, assetRegistry)) continue
    const actors = expandedActors.filter(actor => actor.actorGroupRef === group.groupId)
    const routes = actors.map(actor => {
      const trajectory = synthesizeStartEndTrajectory({
        actorId: actor.actorInstanceId,
        start: { coordinates: expression.start },
        end: { coordinates: expression.end },
        source: 'document',
        sourceRefs: group.evidenceRefs,
        pathStyle: expression.pathStyle,
        startMs: 0,
        endMs: GENERATED_ROUTE_DURATION_MS,
      })
      generatedTrajectoryAssets.push(generatedAsset(trajectory))
      return trajectory.assetId
    })
    if (routes.length > 0) {
      generatedGroupIds.add(group.groupId)
      generatedRoutesByGroup.set(group.groupId, routes)
    }
  }
  const effectiveResolutions = assetResolutions.map(resolution => {
    const generatedRoutes = generatedRoutesByGroup.get(resolution.actorGroupId)
    return generatedRoutes === undefined
      ? resolution
      : { ...resolution, trajectoryAssetIds: generatedRoutes, status: 'compatible' as const }
  })
  const resolutionByGroup = new Map(effectiveResolutions.map(resolution => [resolution.actorGroupId, resolution]))
  const scenarioBundles = new Map(mapping.bundles.map(bundle => [bundle.bundleId, bundle]))
  const movingGroups = activeGroups.filter(group =>
    (resolutionByGroup.get(group.groupId)?.trajectoryAssetIds.length ?? 0) > 0)
  const catalogMovingGroups = movingGroups.filter(group => !generatedGroupIds.has(group.groupId))
  const generatedFormationBundles = movingGroups.filter(group => generatedGroupIds.has(group.groupId)).map(group => {
    const resolution = resolutionByGroup.get(group.groupId)!
    return formationBundleSchema.parse({
      bundleId: `generated:${group.groupId}`,
      actorGroupRef: group.groupId,
      ...(resolution.modelAssetId ? { modelAssetRef: resolution.modelAssetId } : {}),
      routeAssetRefs: resolution.trajectoryAssetIds,
      recommendedActorCount: resolution.trajectoryAssetIds.length,
      role: group.role,
      side: group.side,
      semanticTags: [group.semanticEntityRef],
      scenarioBindings: [scenarioPack.packId],
      mappingAuthority: 'evidence',
      diagnostics: [],
    })
  })
  const catalogFormationBundles = (scenarioPack.packId === 'generic/v1'
    ? catalogMovingGroups.map(group => {
      const resolution = resolutionByGroup.get(group.groupId)!
      return formationBundleSchema.parse({
        bundleId: `catalog:${group.groupId}`,
        actorGroupRef: group.groupId,
        ...(resolution.modelAssetId ? { modelAssetRef: resolution.modelAssetId } : {}),
        routeAssetRefs: resolution.trajectoryAssetIds,
        recommendedActorCount: resolution.trajectoryAssetIds.length,
        role: group.role,
        side: group.side,
        semanticTags: [group.semanticEntityRef],
        scenarioBindings: ['generic/v1'],
        mappingAuthority: 'catalog_hint',
        diagnostics: [],
      })
    })
    : resolveFormationBundles(catalogMovingGroups, catalog, mapping))
    .map(bundle => ({
      ...bundle,
      ...(bundle.modelAssetRef ? {} : {
        modelAssetRef: scenarioBundles.get(bundle.bundleId)?.modelAssetRef,
      }),
    }))
  const resolvedFormationBundles = [...catalogFormationBundles, ...generatedFormationBundles]
  const movingActors = expandedActors.filter(actor =>
    (resolutionByGroup.get(actor.actorGroupRef)?.trajectoryAssetIds.length ?? 0) > 0)
  const catalogActors = movingActors.filter(actor => !generatedGroupIds.has(actor.actorGroupRef))
  const generatedActors = movingActors.filter(actor => generatedGroupIds.has(actor.actorGroupRef))
  const generatedBundleByGroup = new Map(generatedFormationBundles.map(bundle => [bundle.actorGroupRef, bundle]))
  const generatedAssignment = generatedActors.map(actor => {
    const bundle = generatedBundleByGroup.get(actor.actorGroupRef)
    const routeAssetRef = bundle?.routeAssetRefs[actor.ordinal]
    if (!bundle || !routeAssetRef) throw new CompilationError([diagnostic('TRAJECTORY_BUNDLE_CAPACITY_EXCEEDED', `${actor.actorGroupRef} has no generated route for ${actor.actorInstanceId}`)])
    return actorRouteAssignmentSchema.parse({
      actorInstanceRef: actor.actorInstanceId,
      formationBundleRef: bundle.bundleId,
      trajectoryAssetRef: routeAssetRef,
      segmentId: `segment:${actor.actorInstanceId}:continuous-1`,
      resamplePolicy: 'preserve-source-samples',
      timeMapping: { mode: 'fit-window', startMs: 0, durationMs: GENERATED_ROUTE_DURATION_MS },
      spatialPathMode: 'preserve',
      sourceKind: 'generated',
      matchReason: 'Grounded document start/end route synthesized deterministically',
      lineage: [`generated:${bundle.scenarioBindings[0]}`, ...bundle.diagnostics],
    })
  })
  const actorRouteAssignments = [...assignActorRoutes(catalogActors, catalogFormationBundles), ...generatedAssignment]
  const staticActorBindings = expandedActors.flatMap(actor => {
    const resolution = resolutionByGroup.get(actor.actorGroupRef)
    if (resolution?.status !== 'static-fallback' || !resolution.staticPosition) return []
    return [{
      actorInstanceRef: actor.actorInstanceId,
      actorGroupRef: actor.actorGroupRef,
      ...(resolution.modelAssetId ? { modelAssetRef: resolution.modelAssetId } : {}),
      coordinates: resolution.staticPosition.coordinates,
      locationRef: resolution.staticPosition.locationRef,
      lineage: [resolution.staticPosition.lineage, `actor-resolution:${resolution.status}`],
    }]
  })
  const resolvedActors = expandedActors.filter(actor => {
    const resolution = resolutionByGroup.get(actor.actorGroupRef)
    return resolution?.status === 'exact' || resolution?.status === 'compatible' || resolution?.status === 'static-fallback'
  })

  const sourceBlueprintFingerprint = fingerprint(blueprint)
  const scenarioMappingFingerprint = fingerprint(mapping)
  const resolvedLocations = sortedUnique([
    ...blueprint.actorGroups.map(group => group.locationRef),
    ...blueprint.sceneBeats.flatMap(beat => beat.spatialConstraints),
  ])
  const resolvedAssets = sortedUnique([
    ...resolvedFormationBundles.flatMap(bundle => bundle.routeAssetRefs),
    ...resolvedFormationBundles.flatMap(bundle => scenarioBundles.get(bundle.bundleId)?.modelAssetRef ?? []),
    ...actorRouteAssignments.map(assignment => assignment.trajectoryAssetRef),
    ...generatedTrajectoryAssets.map(asset => asset.assetId),
    ...staticActorBindings.flatMap(binding => binding.modelAssetRef ? [binding.modelAssetRef] : []),
  ])
  const resolvedBehaviors = sortedUnique([
    ...blueprint.actorGroups.flatMap(group => [group.behaviorProfile, group.formationPattern]),
    ...resolvedFormationBundles.map(bundle => bundle.role),
    ...blueprint.sceneBeats.flatMap(beat => [...beat.behaviorIntents, ...beat.stateTransitions]),
  ])
  const resolvedMedia = sortedUnique(blueprint.sceneBeats.flatMap(beat => beat.mediaIntents))
  const diagnostics = [
    ...mappingDiagnostics(
    blueprint.diagnostics,
    resolvedFormationBundles.flatMap(bundle => bundle.diagnostics),
    ),
    ...allAssetResolutions.flatMap(resolution => resolution.diagnostics),
  ].filter((item, index, values) => values.findIndex(candidate =>
    candidate.code === item.code && candidate.message === item.message) === index)
  const content = {
    sourceBlueprintId: blueprint.blueprintId,
    sourceBlueprintFingerprint,
    scenarioPack: blueprint.scenarioPack,
    trajectoryCatalogFingerprint: catalog.fingerprint,
    scenarioMappingFingerprint,
    resolvedActors,
    resolvedLocations,
    resolvedAssets,
    resolvedFormationBundles,
    actorRouteAssignments,
    staticActorBindings,
    generatedTrajectoryAssets,
    fallbackTrajectoryRecipes: [],
    resolvedBehaviors,
    resolvedMedia,
    fallbackDecisions: [],
    diagnostics,
  }
  const identity = fingerprint(content)

  return resolvedScenePlanSchema.parse({
    schemaVersion: 'ise.resolved-scene-plan/v1',
    resolvedScenePlanId: `resolved-scene:${identity.slice('sha256:'.length, 'sha256:'.length + 16)}`,
    ...content,
  })
}
