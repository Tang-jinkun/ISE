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
import { scenarioPackForLineage } from '../services/scenarioPackRegistry.ts'
import { indoPakScenarioPack } from '../config/indoPakScenarioPack.ts'
import { scenarioTrajectoryMappingSchema } from '../contracts/trajectoryCatalog.ts'

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
    ? indoPakScenarioPack
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
  const resolvedFormationBundles = resolveFormationBundles(
    blueprint.actorGroups,
    catalog,
    mapping,
  )
  const actorRouteAssignments = assignActorRoutes(resolvedActors, resolvedFormationBundles)
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
  ])
  const resolvedBehaviors = sortedUnique([
    ...blueprint.actorGroups.flatMap(group => [group.behaviorProfile, group.formationPattern]),
    ...resolvedFormationBundles.map(bundle => bundle.role),
    ...blueprint.sceneBeats.flatMap(beat => [...beat.behaviorIntents, ...beat.stateTransitions]),
  ])
  const resolvedMedia = sortedUnique(blueprint.sceneBeats.flatMap(beat => beat.mediaIntents))
  const diagnostics = mappingDiagnostics(
    blueprint.diagnostics,
    resolvedFormationBundles.flatMap(bundle => bundle.diagnostics),
  )
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
