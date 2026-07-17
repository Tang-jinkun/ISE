import type { ActorInstance } from '../contracts/sceneBlueprint.ts'
import {
  actorRouteAssignmentSchema,
  type ActorRouteAssignment,
  type FormationBundle,
} from '../contracts/trajectoryCatalog.ts'
import { CompilationError, diagnostic } from './runtimeDiagnostics.ts'

const currentScenarioDurationMs = 180_000

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function fail(code: string, message: string): never {
  throw new CompilationError([diagnostic(code, message)])
}

export function assignActorRoutes(
  instances: readonly ActorInstance[],
  bundles: readonly FormationBundle[],
): ActorRouteAssignment[] {
  const bundleByGroup = new Map<string, FormationBundle>()
  for (const bundle of [...bundles].sort((left, right) => compareText(left.bundleId, right.bundleId))) {
    if (bundleByGroup.has(bundle.actorGroupRef)) {
      fail(
        'TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED',
        `Multiple formation bundles resolve ${bundle.actorGroupRef}`,
      )
    }
    bundleByGroup.set(bundle.actorGroupRef, bundle)
  }

  const sortedInstances = [...instances]
    .sort((left, right) => left.ordinal - right.ordinal
      || compareText(left.actorInstanceId, right.actorInstanceId))
  const actorIds = new Set<string>()
  const usedRoutes = new Set<`trajectory:${string}`>()

  return sortedInstances.map(instance => {
    if (actorIds.has(instance.actorInstanceId)) {
      fail('TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED', `Duplicate actor instance ${instance.actorInstanceId}`)
    }
    actorIds.add(instance.actorInstanceId)

    const bundle = bundleByGroup.get(instance.actorGroupRef)
    if (!bundle) {
      fail(
        'TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED',
        `No formation bundle resolves ${instance.actorGroupRef}`,
      )
    }
    const routeAssetRef = bundle.routeAssetRefs.find(routeId => !usedRoutes.has(routeId))
    if (!routeAssetRef) {
      fail(
        'TRAJECTORY_BUNDLE_CAPACITY_EXCEEDED',
        `${bundle.bundleId} has no unique route available for ${instance.actorInstanceId}`,
      )
    }
    usedRoutes.add(routeAssetRef)

    return actorRouteAssignmentSchema.parse({
      actorInstanceRef: instance.actorInstanceId,
      formationBundleRef: bundle.bundleId,
      trajectoryAssetRef: routeAssetRef,
      segmentId: `segment:${instance.actorInstanceId}:continuous-1`,
      resamplePolicy: 'preserve-source-samples',
      timeMapping: {
        mode: 'fit-window',
        startMs: 0,
        durationMs: currentScenarioDurationMs,
      },
      spatialPathMode: 'preserve',
      sourceKind: 'catalog',
      matchReason: routeAssetRef === bundle.routeAssetRefs[0]
        ? 'Exact normalized scenario alias and location match'
        : 'Compatible real scenario route used for additional actor capacity',
      lineage: [`catalog:${bundle.scenarioBindings[0] ?? 'unbound'}`, bundle.bundleId],
    })
  })
}
