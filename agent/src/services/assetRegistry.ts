import { publicAssetCatalogEntrySchema } from '@ise/runtime-contracts'
import {
  assetRegistrySnapshotSchema,
  type AssetRegistryEntry,
  type AssetRegistrySnapshot,
} from '../contracts/assetRegistry.ts'
import { fingerprint } from './fingerprint.ts'
import { CompilationError, diagnostic, type CompilationDiagnostic } from './runtimeDiagnostics.ts'

export function normalizeAssetName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function parsePublicEntry(value: unknown): AssetRegistryEntry {
  let publicValue = value
  if (typeof value === 'object' && value !== null) {
    const { sourceRelativePath: _sourceRelativePath, objectName: _objectName, ...metadata } = value as Record<string, unknown>
    publicValue = metadata
  }
  return assetRegistryEntrySchemaParse(publicAssetCatalogEntrySchema.parse(publicValue))
}

function assetRegistryEntrySchemaParse(value: unknown): AssetRegistryEntry {
  const result = assetRegistrySnapshotSchema.shape.assets.element.safeParse(value)
  if (!result.success) throw result.error
  return result.data
}

function aliasDiagnostics(assets: readonly AssetRegistryEntry[]): CompilationDiagnostic[] {
  const aliases = new Map<string, Set<string>>()
  for (const entry of assets) {
    for (const value of [entry.displayName, ...entry.aliases]) {
      const key = normalizeAssetName(value)
      const ids = aliases.get(key) ?? new Set<string>()
      ids.add(entry.assetId)
      aliases.set(key, ids)
    }
  }
  return [...aliases.entries()]
    .filter(([, ids]) => ids.size > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([alias, ids]) => diagnostic('ASSET_ALIAS_CONFLICT', `Alias ${alias} maps to ${[...ids].sort().join(', ')}`))
}

export function createAssetRegistrySnapshot(input: unknown): AssetRegistrySnapshot {
  if (!Array.isArray(input)) throw new CompilationError([diagnostic('ASSET_CATALOG_INVALID', 'Asset catalog must be an array')])
  let assets: AssetRegistryEntry[]
  try {
    assets = input.map(value => parsePublicEntry(value))
      .sort((left, right) => left.assetId.localeCompare(right.assetId))
  } catch (error) {
    throw new CompilationError([diagnostic('ASSET_CATALOG_INVALID', error instanceof Error ? error.message : String(error))])
  }
  return assetRegistrySnapshotSchema.parse({
    schemaVersion: 'asset-registry/v1',
    registryVersion: fingerprint(assets),
    assets,
    diagnostics: aliasDiagnostics(assets),
  })
}

export class AssetRegistry {
  readonly entries: Map<string, AssetRegistryEntry>
  readonly aliases = new Map<string, string[]>()
  readonly diagnostics: CompilationDiagnostic[]

  constructor(snapshot: AssetRegistrySnapshot) {
    const parsed = assetRegistrySnapshotSchema.parse(snapshot)
    this.entries = new Map(parsed.assets.map(entry => [entry.assetId, entry]))
    this.diagnostics = [...parsed.diagnostics]
    const aliasSets = new Map<string, Set<string>>()
    for (const entry of parsed.assets) {
      for (const value of [entry.displayName, ...entry.aliases]) {
        const key = normalizeAssetName(value)
        const ids = aliasSets.get(key) ?? new Set<string>()
        ids.add(entry.assetId)
        aliasSets.set(key, ids)
      }
    }
    for (const [alias, ids] of aliasSets) this.aliases.set(alias, [...ids].sort())
    for (const [alias, assetIds] of this.aliases) {
      if (assetIds.length > 1 && !this.diagnostics.some(item => item.code === 'ASSET_ALIAS_CONFLICT' && item.message.includes(alias))) {
        this.diagnostics.push(diagnostic('ASSET_ALIAS_CONFLICT', `Alias ${alias} maps to ${assetIds.join(', ')}`))
      }
    }
    this.diagnostics.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`))
  }

  resolveAlias(value: string): AssetRegistryEntry | undefined {
    const ids = this.aliases.get(normalizeAssetName(value)) ?? []
    if (ids.length !== 1) {
      throw new CompilationError([diagnostic(
        ids.length === 0 ? 'ASSET_NOT_FOUND' : 'ASSET_ALIAS_CONFLICT',
        `Cannot resolve ${value}`,
      )])
    }
    return this.resolveFallback(ids[0]!)
  }

  resolve(assetId: string): AssetRegistryEntry | undefined {
    return this.resolveFallback(assetId)
  }

  resolveFallback(assetId: string, visited = new Set<string>()): AssetRegistryEntry | undefined {
    if (visited.has(assetId)) throw new CompilationError([diagnostic('ASSET_FALLBACK_CYCLE', assetId)])
    visited.add(assetId)
    const entry = this.entries.get(assetId)
    if (!entry) throw new CompilationError([diagnostic('ASSET_NOT_FOUND', assetId)])
    if (entry.availability === 'available') return entry
    if (entry.allowFallback) {
      for (const fallbackId of entry.fallbackAssetIds) {
        try {
          const fallback = this.resolveFallback(fallbackId, new Set(visited))
          if (fallback?.kind === entry.kind) return fallback
        } catch (error) {
          if (!(error instanceof CompilationError)) throw error
        }
      }
    }
    if (entry.criticality === 'optional') {
      if (!this.diagnostics.some(item => item.code === 'OPTIONAL_ASSET_UNAVAILABLE' && item.assetId === assetId)) {
        this.diagnostics.push(diagnostic('OPTIONAL_ASSET_UNAVAILABLE', assetId, 'warning', { assetId }))
      }
      return undefined
    }
    throw new CompilationError([diagnostic(
      entry.availability === 'invalid' ? 'REQUIRED_ASSET_INVALID' : 'REQUIRED_ASSET_MISSING',
      assetId,
      'error',
      { assetId },
    )])
  }

  resolveEntityType(entityType: 'aircraft' | 'missile' | 'other'): AssetRegistryEntry | undefined {
    const candidates = [...this.entries.values()]
      .filter((entry): entry is Extract<AssetRegistryEntry, { kind: 'model' }> =>
        entry.kind === 'model' && entry.availability === 'available' && entry.model.entityTypes.includes(entityType))
      .sort((left, right) => left.assetId.localeCompare(right.assetId))
    if (candidates.length === 0) return undefined
    if (candidates.length > 1) throw new CompilationError([diagnostic(
      'ASSET_SELECTION_AMBIGUOUS',
      `${entityType} maps to ${candidates.map(item => item.assetId).join(', ')}`,
    )])
    return candidates[0]
  }
}
