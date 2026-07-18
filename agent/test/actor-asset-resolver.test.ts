import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssetRegistrySnapshot } from '../src/contracts/assetRegistry.ts'
import type { ActorGroup } from '../src/contracts/sceneBlueprint.ts'
import type { ScenarioPack } from '../src/contracts/scenarioPack.ts'
import { resolveActorAssets } from '../src/services/actorAssetResolver.ts'

const hash = `sha256:${'a'.repeat(64)}`

function actor(overrides: Partial<ActorGroup> = {}): ActorGroup {
  return {
    groupId: 'group:blue-fighters', semanticEntityRef: 'Blue Falcon', side: 'blue',
    locationRef: 'location:north-base', platformType: 'fighter', role: 'fighter-formation',
    quantityDecision: { value: 1, constraint: 'unknown', source: 'default', evidenceRefs: [], defaultPolicyId: 'single/v1', reason: 'fixture' },
    formationPattern: 'single', leaderPolicy: 'single-member', behaviorProfile: 'fighter-formation/v1', lifecycle: 'scene-persistent',
    ...overrides,
  }
}

function registry(assets: AssetRegistrySnapshot['assets']): AssetRegistrySnapshot {
  return { schemaVersion: 'asset-registry/v1', registryVersion: hash, assets, diagnostics: [] }
}

function model(assetId: `model:${string}`, displayName: string, entityTypes: Array<'aircraft' | 'missile' | 'other'> = ['aircraft']) {
  return { assetId, kind: 'model' as const, displayName, aliases: [], fingerprint: hash, size: 1,
    mediaType: 'model/gltf-binary' as const, availability: 'available' as const, criticality: 'required' as const,
    fallbackAssetIds: [], allowFallback: false, model: { scale: 1, rotationOffsetDeg: [0, 0, 0] as [number, number, number], altitudeOffsetM: 0, entityTypes } }
}

function route(assetId: `trajectory:${string}`, displayName: string, aliases: string[] = []) {
  return { assetId, kind: 'trajectory' as const, displayName, aliases, fingerprint: hash, size: 1,
    mediaType: 'application/vnd.ise.trajectory+json' as const, availability: 'available' as const, criticality: 'required' as const,
    fallbackAssetIds: [], allowFallback: false, trajectory: { format: 'ise-trajectory/v1' as const, timeUnit: 'ms' as const, coordinateOrder: 'lng-lat-alt' as const, startTimeMs: 0, endTimeMs: 1, monotonic: true as const, bounds: [[10, 10], [11, 11]] as [[number, number], [number, number]] } }
}

const genericPack: ScenarioPack = { schemaVersion: 'ise-scenario-pack/v1', packId: 'generic/v1', version: '1', displayName: 'Generic', matchRules: [], factions: [], entityProfiles: [], locationProfiles: [], routeBundles: [], mediaProfiles: [], actorProfiles: [], weaponBehaviorProfiles: [] }

test('resolves an exact scenario-pack model and route bundle', () => {
  const pack: ScenarioPack = { ...genericPack, routeBundles: [{ bundleId: 'blue-falcon-north', modelAssetRef: 'model:blue-falcon', routeAssetRefs: ['trajectory:blue-falcon-north'], semanticEntityAliases: ['Blue Falcon'], behaviorProfileRefs: ['fighter-formation/v1'], locationRefs: ['location:north-base'], diagnostics: [] }] }
  const result = resolveActorAssets(actor(), pack, registry([model('model:blue-falcon', 'Blue Falcon'), route('trajectory:blue-falcon-north', 'Blue Falcon North')]))

  assert.equal(result.status, 'exact')
  assert.equal(result.modelAssetId, 'model:blue-falcon')
  assert.deepEqual(result.trajectoryAssetIds, ['trajectory:blue-falcon-north'])
  assert.deepEqual(result.diagnostics, [])
})

test('resolves one compatible model and route from explicit asset metadata', () => {
  const result = resolveActorAssets(actor(), genericPack, registry([
    model('model:generic-fighter', 'Generic Fighter', ['aircraft']),
    route('trajectory:generic-fighter', 'Generic Fighter'),
  ]))

  assert.equal(result.status, 'compatible')
  assert.equal(result.modelAssetId, 'model:generic-fighter')
  assert.deepEqual(result.trajectoryAssetIds, ['trajectory:generic-fighter'])
})

test('does not treat the registry only route as compatible when its semantic metadata is unrelated', () => {
  const result = resolveActorAssets(actor(), {
    ...genericPack,
    locationProfiles: [{ locationId: 'location:north-base', aliases: [], coordinates: [70, 30] }],
  }, registry([
    model('model:generic-fighter', 'Generic Fighter', ['aircraft']),
    route('trajectory:red-convoy', 'Red Convoy Route', ['ground convoy']),
  ]))

  assert.equal(result.status, 'static-fallback')
  assert.deepEqual(result.trajectoryAssetIds, [])
})

test('reports ambiguity rather than guessing between compatible assets', () => {
  const result = resolveActorAssets(actor(), genericPack, registry([
    model('model:generic-fighter-a', 'Generic Fighter A'),
    model('model:generic-fighter-b', 'Generic Fighter B'),
    route('trajectory:generic-fighter', 'Generic Fighter'),
  ]))

  assert.equal(result.status, 'unresolved')
  assert.equal(result.diagnostics[0]?.code, 'ACTOR_MODEL_AMBIGUOUS')
})

test('falls back to a static grounded marker when no trajectory is reliable', () => {
  const result = resolveActorAssets(actor(), {
    ...genericPack,
    locationProfiles: [{ locationId: 'location:north-base', aliases: [], coordinates: [70, 30] }],
  }, registry([model('model:generic-fighter', 'Generic Fighter')]))

  assert.equal(result.status, 'static-fallback')
  assert.equal(result.modelAssetId, 'model:generic-fighter')
  assert.deepEqual(result.trajectoryAssetIds, [])
  assert.deepEqual(result.staticPosition?.coordinates, [70, 30])
  assert.equal(result.diagnostics[0]?.code, 'ACTOR_TRAJECTORY_STATIC_FALLBACK')
})

test('leaves an actor unresolved without a model or grounded location', () => {
  const result = resolveActorAssets(actor({ locationRef: 'location:unknown' }), genericPack, registry([]))

  assert.equal(result.status, 'unresolved')
  assert.equal(result.diagnostics[0]?.code, 'ACTOR_MODEL_UNRESOLVED')
})
