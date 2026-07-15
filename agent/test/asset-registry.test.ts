import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ArtifactStore, DomainStateStore, type AgentContext } from '@ise/agent-core'
import {
  assetRegistryEntrySchema,
  assetRegistrySnapshotSchema,
  type AssetRegistryEntry,
} from '../src/contracts/assetRegistry.ts'
import {
  AssetRegistry,
  createAssetRegistrySnapshot,
} from '../src/services/assetRegistry.ts'
import { CompilationError } from '../src/services/runtimeDiagnostics.ts'
import { createAssetTools } from '../src/tools/assetTools.ts'

const hash = `sha256:${'1'.repeat(64)}`

function modelEntry(assetId = 'model:jf17', aliases = ['JF-17']): AssetRegistryEntry {
  return {
    assetId, kind: 'model', displayName: assetId, aliases, fingerprint: hash, size: 10,
    mediaType: 'model/gltf-binary', availability: 'available', criticality: 'required',
    fallbackAssetIds: [], allowFallback: false,
    model: { scale: 1, rotationOffsetDeg: [0, 0, 0], altitudeOffsetM: 0, entityTypes: ['aircraft'] },
  }
}

function trajectoryEntry(options: Partial<AssetRegistryEntry> = {}): AssetRegistryEntry {
  return {
    assetId: 'trajectory:ambala-1', kind: 'trajectory', displayName: 'Ambala route', aliases: [],
    fingerprint: hash, size: 10, mediaType: 'application/vnd.ise.trajectory+json',
    availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
    trajectory: { format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt', startTimeMs: 0, endTimeMs: 1_000, monotonic: true },
    ...options,
  } as AssetRegistryEntry
}

function imageEntry(assetId: string, options: Partial<AssetRegistryEntry> = {}): AssetRegistryEntry {
  return {
    assetId, kind: 'image', displayName: assetId, aliases: [], fingerprint: hash, size: 10,
    mediaType: 'image/png', availability: 'available', criticality: 'optional', fallbackAssetIds: [], allowFallback: false,
    image: { width: 100, height: 100, fit: 'contain' }, ...options,
  } as AssetRegistryEntry
}

function snapshot(assets: AssetRegistryEntry[]) {
  return assetRegistrySnapshotSchema.parse({ schemaVersion: 'asset-registry/v1', registryVersion: hash, assets, diagnostics: [] })
}

test('registry rejects access URLs and object names from artifact data', () => {
  assert.equal(assetRegistryEntrySchema.safeParse({ ...modelEntry(), url: 'https://signed' }).success, false)
  assert.equal(assetRegistryEntrySchema.safeParse({ ...modelEntry(), objectName: 'private/model.glb' }).success, false)
  assert.equal(assetRegistryEntrySchema.safeParse({ ...modelEntry(), sourceRelativePath: 'assets/model.glb' }).success, false)
})

test('alias collisions are explicit errors rather than guessed mappings', () => {
  const registry = new AssetRegistry(snapshot([
    modelEntry('model:jf17', ['JF-17']), modelEntry('model:j10ce', ['ＪＦ－１７']),
  ]))
  assert.deepEqual(registry.diagnostics.map(item => item.code), ['ASSET_ALIAS_CONFLICT'])
  assert.throws(() => registry.resolveAlias('jf-17'), (error: unknown) =>
    error instanceof CompilationError && error.diagnostics[0]?.code === 'ASSET_ALIAS_CONFLICT')
})

test('an invalid required trajectory blocks resolution', () => {
  const registry = new AssetRegistry(snapshot([trajectoryEntry({ availability: 'invalid' })]))
  assert.throws(() => registry.resolve('trajectory:ambala-1'), (error: unknown) =>
    error instanceof CompilationError && error.diagnostics[0]?.code === 'REQUIRED_ASSET_INVALID')
})

test('optional image follows only declared fallback ids', () => {
  const registry = new AssetRegistry(snapshot([
    imageEntry('image:primary', { availability: 'missing', fallbackAssetIds: ['image:fallback'], allowFallback: true }),
    imageEntry('image:fallback'), imageEntry('image:unrelated'),
  ]))
  assert.equal(registry.resolveFallback('image:primary')?.assetId, 'image:fallback')
})

test('shared manifest projection strips paths and computes a stable version', () => {
  const source = {
    ...modelEntry(),
    sourceRelativePath: 'assets/jf17.glb', objectName: 'models/jf17.glb',
  }
  const first = createAssetRegistrySnapshot([source])
  const second = createAssetRegistrySnapshot([source])
  assert.equal(first.registryVersion, second.registryVersion)
  assert.equal(JSON.stringify(first).includes('sourceRelativePath'), false)
  assert.equal(JSON.stringify(first).includes('objectName'), false)
})

test('storage-less public catalog entries cross the Nest boundary without leaking access fields', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/public-asset-catalog.json', import.meta.url), 'utf8'))
  const registry = createAssetRegistrySnapshot(fixture)
  assert.deepEqual(registry.assets.map(asset => asset.assetId), ['model:jf17'])
  assert.equal(/sourceRelativePath|objectName|url|token/i.test(JSON.stringify(registry)), false)
})

test('fallback resolution exhausts declared branches and reports failure from the root asset', () => {
  const registry = new AssetRegistry(snapshot([
    imageEntry('image:root', {
      availability: 'missing', criticality: 'required', allowFallback: true,
      fallbackAssetIds: ['image:missing', 'image:available'],
    }),
    imageEntry('image:missing', { availability: 'missing', criticality: 'required' }),
    imageEntry('image:available'),
  ]))
  assert.equal(registry.resolve('image:root')?.assetId, 'image:available')

  const unavailable = new AssetRegistry(snapshot([
    imageEntry('image:optional-root', {
      availability: 'missing', criticality: 'optional', allowFallback: true,
      fallbackAssetIds: ['image:required-missing'],
    }),
    imageEntry('image:required-missing', { availability: 'missing', criticality: 'required' }),
  ]))
  assert.equal(unavailable.resolve('image:optional-root'), undefined)
  assert.ok(unavailable.diagnostics.some(item => item.code === 'OPTIONAL_ASSET_UNAVAILABLE' && item.assetId === 'image:optional-root'))
})

test('fallback cycles and kind mismatches are rejected by the snapshot schema', () => {
  assert.equal(assetRegistrySnapshotSchema.safeParse({
    schemaVersion: 'asset-registry/v1', registryVersion: hash, diagnostics: [],
    assets: [
      imageEntry('image:a', { fallbackAssetIds: ['image:b'], allowFallback: true }),
      imageEntry('image:b', { fallbackAssetIds: ['image:a'], allowFallback: true }),
    ],
  }).success, false)
})

test('inspect tool persists metadata only and never emits access secrets', async () => {
  const registrySnapshot = snapshot([modelEntry()])
  const tool = createAssetTools(async () => registrySnapshot)[0]!
  const context: AgentContext = {
    workspace: process.cwd(),
    goal: { objective: 'test', status: 'active', turnCount: 0, maxTurns: 1, evidence: [], remainingIssues: [], startedAt: new Date(0).toISOString() },
    artifacts: new ArtifactStore(), domainState: new DomainStateStore(),
  }
  const result = await tool.execute({ aliases: ['JF-17'], limit: 10 }, context)
  assert.equal(result.artifacts?.[0]?.type, 'ise.asset-registry/v1')
  assert.equal(/https?:|objectName|sourceRelativePath|authorization|Bearer/i.test(JSON.stringify(result)), false)
})
