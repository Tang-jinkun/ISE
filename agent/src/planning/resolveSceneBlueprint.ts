import {
  assetRegistrySnapshotSchema,
  type AssetRegistrySnapshot,
} from '../contracts/assetRegistry.ts'
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
import { formationBundleSchema, scenarioTrajectoryMappingSchema } from '../contracts/trajectoryCatalog.ts'
import { resolveActorAssets } from '../services/actorAssetResolver.ts'

export interface ResolveSceneBlueprintInput {
  blueprint: SceneBlueprint
  assetRegistry: AssetRegistrySnapshot
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
  const resolvedActors = expandActorGroups(blueprint.actorGroups)
  // Keep asset selection explicit and auditable before route assignment. The
  // catalog assignment remains the only source of movement paths.
  const assetResolutions = blueprint.actorGroups.map(group =>
    resolveActorAssets(group, scenarioPack, assetRegistry))
  const resolutionByGroup = new Map(assetResolutions.map(resolution => [resolution.actorGroupId, resolution]))
  const movingGroups = blueprint.actorGroups.filter(group =>
    (resolutionByGroup.get(group.groupId)?.trajectoryAssetIds.length ?? 0) > 0)
  const resolvedFormationBundles = scenarioPack.packId === 'generic/v1'
    ? movingGroups.map(group => {
      const resolution = resolutionByGroup.get(group.groupId)!
      return formationBundleSchema.parse({
        bundleId: `catalog:${group.groupId}`,
        actorGroupRef: group.groupId,
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
    : resolveFormationBundles(movingGroups, catalog, mapping)
  const movingActors = resolvedActors.filter(actor =>
    (resolutionByGroup.get(actor.actorGroupRef)?.trajectoryAssetIds.length ?? 0) > 0)
  const actorRouteAssignments = assignActorRoutes(movingActors, resolvedFormationBundles)
  const staticActorBindings = resolvedActors.flatMap(actor => {
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
  const scenarioBundles = new Map(mapping.bundles.map(bundle => [bundle.bundleId, bundle]))

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
    ...assetResolutions.flatMap(resolution => resolution.diagnostics),
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
