import { z } from 'zod'
import type { AgentTool } from '@ise/agent-core'
import { ASSET_REGISTRY_ARTIFACT } from '../contracts/artifactTypes.ts'
import type { AssetRegistryEntry, AssetRegistrySnapshot } from '../contracts/assetRegistry.ts'
import { AssetRegistry } from '../services/assetRegistry.ts'
import { CompilationError } from '../services/runtimeDiagnostics.ts'

const inspectReplayAssetsInputSchema = z.strictObject({
  assetIds: z.array(z.string().min(1)).optional(),
  aliases: z.array(z.string().min(1)).optional(),
  entityTypes: z.array(z.enum(['aircraft', 'missile', 'other'])).optional(),
  limit: z.number().int().optional(),
})

const inspectReplayAssetsInputJsonSchema = z.toJSONSchema(inspectReplayAssetsInputSchema, { target: 'draft-2020-12' })

function recordInspectionDiagnostics(registry: AssetRegistry, error: CompilationError) {
  registry.diagnostics.push(...error.diagnostics.map(item => ({
    ...item,
    severity: 'warning' as const,
    recoverable: true,
  })))
}

function selectRegistryEntries(registry: AssetRegistry, query: z.infer<typeof inspectReplayAssetsInputSchema>): AssetRegistryEntry[] {
  const selected = new Map<string, AssetRegistryEntry>()
  for (const assetId of query.assetIds ?? []) {
    try {
      const entry = registry.resolve(assetId)
      if (entry) selected.set(entry.assetId, entry)
    } catch (error) {
      if (!(error instanceof CompilationError)) throw error
      recordInspectionDiagnostics(registry, error)
    }
  }
  for (const alias of query.aliases ?? []) {
    try {
      const entry = registry.resolveAlias(alias)
      if (entry) selected.set(entry.assetId, entry)
    } catch (error) {
      if (!(error instanceof CompilationError)) throw error
      recordInspectionDiagnostics(registry, error)
    }
  }
  for (const entityType of query.entityTypes ?? []) {
    try {
      const entry = registry.resolveEntityType(entityType)
      if (entry) selected.set(entry.assetId, entry)
    } catch (error) {
      if (!(error instanceof CompilationError)) throw error
      recordInspectionDiagnostics(registry, error)
    }
  }
  if (selected.size === 0 && !query.assetIds && !query.aliases && !query.entityTypes) {
    for (const entry of registry.entries.values()) selected.set(entry.assetId, entry)
  }
  return [...selected.values()].sort((left, right) => left.assetId.localeCompare(right.assetId))
}

export function createAssetTools(loadSnapshot: () => Promise<AssetRegistrySnapshot>): AgentTool[] {
  return [{
    name: 'inspect_replay_assets',
    description: 'Inspect registered replay asset metadata',
    risk: 'read',
    isConcurrencySafe: true,
    inputSchema: inspectReplayAssetsInputJsonSchema,
    async execute(input) {
      const query = inspectReplayAssetsInputSchema.parse(input)
      const snapshot = await loadSnapshot()
      const registry = new AssetRegistry(snapshot)
      const limit = Math.min(50, Math.max(1, query.limit ?? 20))
      const assets = selectRegistryEntries(registry, query).slice(0, limit)
      const content = { registryVersion: snapshot.registryVersion, assets, diagnostics: registry.diagnostics }
      return {
        content: JSON.stringify(content),
        artifacts: [{
          type: ASSET_REGISTRY_ARTIFACT,
          createdBy: 'tool',
          logicalKey: `asset-registry:${snapshot.registryVersion}`,
          data: { ...snapshot, diagnostics: registry.diagnostics },
        }],
      }
    },
  }]
}
