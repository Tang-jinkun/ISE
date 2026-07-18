import type { AssetRegistryEntry, AssetRegistrySnapshot } from '../contracts/assetRegistry.ts'
import {
  trajectoryCatalogSchema,
  type TrajectoryCatalog,
  type TrajectoryCatalogEntry,
} from '../contracts/trajectoryCatalog.ts'
import { fingerprint } from './fingerprint.ts'
import { normalizeAssetName } from './assetRegistry.ts'
import { CompilationError, diagnostic } from './runtimeDiagnostics.ts'

type TrajectoryEntry = Extract<AssetRegistryEntry, { kind: 'trajectory' }>
type CatalogTrajectoryEntry = TrajectoryEntry & { assetId: `trajectory:${string}` }

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function catalogEntry(entry: CatalogTrajectoryEntry): TrajectoryCatalogEntry {
  const trajectory = entry.trajectory
  const hasCuration = trajectory.curation !== undefined
  const hasRepair = trajectory.repair !== undefined
  if (hasCuration !== hasRepair) {
    throw new CompilationError([diagnostic(
      'TRAJECTORY_CATALOG_ENTRY_INVALID',
      `${entry.assetId} curation and repair provenance must be present together`,
      'error',
      { assetId: entry.assetId },
    )])
  }

  return {
    trajectoryAssetId: entry.assetId,
    fingerprint: entry.fingerprint,
    routeLabel: entry.displayName,
    semanticTags: [...new Set(
      [entry.displayName, ...entry.aliases].map(normalizeAssetName),
    )],
    scenarioBindings: ['indo-pak/v1'],
    startTimeMs: entry.trajectory.startTimeMs,
    endTimeMs: entry.trajectory.endTimeMs,
    bounds: entry.trajectory.bounds,
    validationStatus: entry.availability !== 'available'
      ? 'invalid'
      : trajectory.repair === undefined ? 'valid' : 'curated_repair',
    repairRecord: trajectory.repair,
  }
}

export function buildTrajectoryCatalog(snapshot: AssetRegistrySnapshot): TrajectoryCatalog {
  const entries = snapshot.assets
    .filter((entry): entry is CatalogTrajectoryEntry => entry.kind === 'trajectory')
    .sort((left, right) => compareText(left.assetId, right.assetId))
    .map(catalogEntry)

  return trajectoryCatalogSchema.parse({
    schemaVersion: 'ise.trajectory-catalog/v1',
    catalogId: 'trajectory-catalog:indo-pak',
    fingerprint: fingerprint({ registryVersion: snapshot.registryVersion, entries }),
    entries,
  })
}
