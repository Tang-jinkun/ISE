import type { ActorGroup } from '../contracts/sceneBlueprint.ts'
import {
  formationBundleSchema,
  type FormationBundle,
  type ScenarioTrajectoryBundle,
  type ScenarioTrajectoryMapping,
  type TrajectoryCatalog,
} from '../contracts/trajectoryCatalog.ts'
import { normalizeAssetName } from './assetRegistry.ts'
import { CompilationError, diagnostic } from './runtimeDiagnostics.ts'

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function matchesGroup(group: ActorGroup, bundle: ScenarioTrajectoryBundle): boolean {
  const entity = normalizeAssetName(group.semanticEntityRef)
  const aliases = new Set(bundle.semanticEntityAliases.map(normalizeAssetName))
  if (!aliases.has(entity)) return false

  if (group.role === 'weapon-launch' || group.role === 'early-warning-support') {
    const behaviorProfiles = new Set(bundle.behaviorProfileRefs.map(normalizeAssetName))
    return behaviorProfiles.has(normalizeAssetName(group.behaviorProfile))
  }

  const location = normalizeAssetName(group.locationRef)
  return bundle.locationRefs.some(candidate => normalizeAssetName(candidate) === location)
}

function unresolved(group: ActorGroup, reason: string): never {
  throw new CompilationError([diagnostic(
    'TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED',
    `${group.groupId}: ${reason}`,
  )])
}

export function resolveFormationBundles(
  groups: readonly ActorGroup[],
  catalog: TrajectoryCatalog,
  mapping: ScenarioTrajectoryMapping,
): FormationBundle[] {
  const catalogEntries = new Map(catalog.entries.map(entry => [entry.trajectoryAssetId, entry]))

  return [...groups]
    .sort((left, right) => compareText(left.groupId, right.groupId))
    .map(group => {
      const candidates = mapping.bundles.filter(bundle => matchesGroup(group, bundle))
      if (candidates.length !== 1) {
        unresolved(group, candidates.length === 0
          ? `no exact alias and location match in ${mapping.scenarioId}`
          : `multiple exact alias and location matches in ${mapping.scenarioId}`)
      }
      const mapped = candidates[0]!
      const mappedRouteIds = new Set(mapped.routeAssetRefs)
      const routeAssetRefs = catalog.entries
        .filter(entry => mappedRouteIds.has(entry.trajectoryAssetId) && entry.validationStatus !== 'invalid')
        .map(entry => entry.trajectoryAssetId)
      const unavailable = mapped.routeAssetRefs.filter(routeId => {
        const entry = catalogEntries.get(routeId)
        return entry === undefined || entry.validationStatus === 'invalid'
      })
      if (unavailable.length > 0 || routeAssetRefs.length !== mapped.routeAssetRefs.length) {
        unresolved(group, `configured routes unavailable: ${unavailable.join(', ')}`)
      }

      return formationBundleSchema.parse({
        bundleId: mapped.bundleId,
        actorGroupRef: group.groupId,
        routeAssetRefs,
        recommendedActorCount: routeAssetRefs.length,
        role: group.role,
        side: group.side,
        semanticTags: [...new Set(mapped.semanticEntityAliases.map(normalizeAssetName))],
        scenarioBindings: [mapping.scenarioId],
        mappingAuthority: 'scenario_config',
        diagnostics: mapped.diagnostics,
      })
    })
}
