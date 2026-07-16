import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assetRegistrySnapshotSchema,
  type AssetRegistryEntry,
  type AssetRegistrySnapshot,
} from '../src/contracts/assetRegistry.ts'
import type { ActorGroup, ActorInstance } from '../src/contracts/sceneBlueprint.ts'
import type { FormationBundle } from '../src/contracts/trajectoryCatalog.ts'
import { indoPakTrajectoryScenario } from '../src/config/indoPakTrajectoryScenario.ts'
import { assignActorRoutes } from '../src/services/actorRouteAssigner.ts'
import { resolveFormationBundles } from '../src/services/formationBundleResolver.ts'
import { buildTrajectoryCatalog } from '../src/services/trajectoryCatalog.ts'
import { CompilationError } from '../src/services/runtimeDiagnostics.ts'

const hash = `sha256:${'1'.repeat(64)}`
const rawSu30Fingerprint = 'sha256:ba6e0167c0d31e1141a6890bf033e1e671f1f364e7109471f28c7ab000a95995'

const aircraftRoutes = [
  ...Array.from({ length: 4 }, (_, index) => `trajectory:adampur-vampire-${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `trajectory:ambala-rafale-${index + 1}`),
  ...Array.from({ length: 2 }, (_, index) => `trajectory:ambala-su30mki-${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `trajectory:minhas-j10ce-${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `trajectory:rafiki-j10ce-${index + 1}`),
] as const

const missileRoutes = [
  'trajectory:india-missile-1',
  'trajectory:pakistan-missile-1',
  'trajectory:pakistan-strike-missile-2',
] as const

const allRoutes = [...aircraftRoutes, ...missileRoutes]

function trajectoryEntry(assetId: string): AssetRegistryEntry {
  const suffix = Number(assetId.match(/-(\d+)$/)?.[1] ?? 1)
  const repaired = assetId === 'trajectory:ambala-su30mki-1'
  return {
    assetId: assetId as `trajectory:${string}`,
    kind: 'trajectory',
    displayName: assetId.replace('trajectory:', '').toUpperCase(),
    aliases: [],
    fingerprint: repaired
      ? `sha256:${'2'.repeat(64)}`
      : hash,
    size: 10,
    mediaType: 'application/vnd.ise.trajectory+json',
    availability: 'available',
    criticality: 'required',
    fallbackAssetIds: [],
    allowFallback: false,
    trajectory: {
      format: 'ise-trajectory/v1',
      timeUnit: 'ms',
      coordinateOrder: 'lng-lat-alt',
      startTimeMs: 0,
      endTimeMs: repaired ? 181_000 : 160_000 + suffix * 1_000,
      monotonic: true,
      bounds: [[70, 20], [80, 35]],
      ...(repaired ? {
        curation: {
          policyId: 'trajectory.shift-suffix/v1' as const,
          expectedSourceFingerprint: rawSu30Fingerprint,
          startIndex: 91,
          deltaMs: 2_000,
        },
        repair: {
          sourceFingerprint: rawSu30Fingerprint,
          repairRuleVersion: 'trajectory.shift-suffix/v1',
          affectedSampleRange: [91, 181] as [number, number],
          boundaryTimesBeforeMs: [90_000, 89_000] as [number, number],
          boundaryTimesAfterMs: [90_000, 91_000] as [number, number],
          offsetMs: 2_000,
        },
      } : {}),
    },
  }
}

function snapshot(routeIds: readonly string[] = allRoutes): AssetRegistrySnapshot {
  return assetRegistrySnapshotSchema.parse({
    schemaVersion: 'asset-registry/v1',
    registryVersion: hash,
    assets: [
      {
        assetId: 'model:jf17',
        kind: 'model',
        displayName: 'JF-17',
        aliases: [],
        fingerprint: hash,
        size: 10,
        mediaType: 'model/gltf-binary',
        availability: 'available',
        criticality: 'required',
        fallbackAssetIds: [],
        allowFallback: false,
        model: {
          scale: 1,
          rotationOffsetDeg: [0, 0, 0],
          altitudeOffsetM: 0,
          entityTypes: ['aircraft'],
        },
      },
      ...routeIds.map(trajectoryEntry),
    ],
    diagnostics: [],
  })
}

function group(
  groupId: string,
  semanticEntityRef: string,
  locationRef: string,
  side: string,
  role = 'fighter-formation',
): ActorGroup {
  return {
    groupId,
    semanticEntityRef,
    side,
    locationRef,
    platformType: role === 'missile' ? 'missile' : 'fighter',
    role,
    quantityDecision: {
      value: 4,
      constraint: 'exact',
      source: 'evidence',
      evidenceRefs: ['evidence:1'],
      reason: 'Test fixture',
    },
    formationPattern: role === 'missile' ? 'single' : 'finger-four',
    leaderPolicy: 'stable-first-member',
    behaviorProfile: `${role}/v1`,
    lifecycle: 'scene-persistent',
  }
}

function instances(groupRef: string, count: number): ActorInstance[] {
  return Array.from({ length: count }, (_, ordinal) => ({
    actorInstanceId: `actor:${groupRef.replace(/^group:/, '')}:${ordinal + 1}`,
    actorGroupRef: groupRef,
    role: ordinal === 0 ? 'leader' : 'wingman',
    ordinal,
  }))
}

function expectCompilationCode(code: string) {
  return (error: unknown) => error instanceof CompilationError
    && error.diagnostics.some(item => item.code === code)
}

test('builds a deterministic catalog for all 18 aircraft and 3 missile trajectories', () => {
  const first = buildTrajectoryCatalog(snapshot([...allRoutes].reverse()))
  const second = buildTrajectoryCatalog(snapshot(allRoutes))

  assert.equal(first.entries.length, 21)
  assert.deepEqual(first, second)
  assert.deepEqual(first.entries.map(entry => entry.trajectoryAssetId), [...allRoutes].sort())
  assert.equal(first.entries.every(entry => entry.scenarioBindings.includes('indo-pak/v1')), true)
  assert.equal(first.entries.every(entry => entry.validationStatus !== 'invalid'), true)
})

test('records the approved Su-30 suffix repair without changing catalog geometry', () => {
  const catalog = buildTrajectoryCatalog(snapshot())
  const repaired = catalog.entries.find(entry => entry.trajectoryAssetId === 'trajectory:ambala-su30mki-1')

  assert.equal(repaired?.validationStatus, 'curated_repair')
  assert.deepEqual(repaired?.repairRecord, {
    sourceFingerprint: rawSu30Fingerprint,
    repairRuleVersion: 'trajectory.shift-suffix/v1',
    affectedSampleRange: [91, 181],
    boundaryTimesBeforeMs: [90_000, 89_000],
    boundaryTimesAfterMs: [90_000, 91_000],
    offsetMs: 2_000,
  })
  assert.deepEqual(repaired?.bounds, [[70, 20], [80, 35]])
})

test('rejects incomplete curation and repair provenance in either direction', () => {
  const complete = snapshot()
  const repaired = complete.assets.find(entry => entry.assetId === 'trajectory:ambala-su30mki-1')
  assert.equal(repaired?.kind, 'trajectory')
  if (repaired?.kind !== 'trajectory') assert.fail('Expected repaired trajectory fixture')

  const { repair: _repair, ...withoutRepair } = repaired.trajectory
  const { curation: _curation, ...withoutCuration } = repaired.trajectory
  const malformedSnapshot = (trajectory: typeof repaired.trajectory) => assetRegistrySnapshotSchema.parse({
    ...complete,
    assets: complete.assets.map(entry => entry.assetId === repaired.assetId
      ? { ...repaired, trajectory }
      : entry),
  })

  assert.throws(
    () => buildTrajectoryCatalog(malformedSnapshot(withoutRepair)),
    expectCompilationCode('TRAJECTORY_CATALOG_ENTRY_INVALID'),
  )
  assert.throws(
    () => buildTrajectoryCatalog(malformedSnapshot(withoutCuration)),
    expectCompilationCode('TRAJECTORY_CATALOG_ENTRY_INVALID'),
  )
})

test('defines scenario-local route semantics and keeps AMBALA Su-30 routes as reserve capacity', () => {
  assert.deepEqual(
    indoPakTrajectoryScenario.bundles.map(bundle => [bundle.bundleId, bundle.routeAssetRefs.length]),
    [
      ['formation:india-su30-adampur', 4],
      ['formation:india-rafale-ambala', 4],
      ['formation:pakistan-jf17-minhas', 4],
      ['formation:pakistan-jf17-rafiki', 4],
      ['reserve:india-su30-ambala', 2],
      ['weapon:indo-pak-missiles', 3],
    ],
  )
  const minhas = indoPakTrajectoryScenario.bundles.find(bundle => bundle.bundleId.endsWith('jf17-minhas'))
  const rafiki = indoPakTrajectoryScenario.bundles.find(bundle => bundle.bundleId.endsWith('jf17-rafiki'))
  const vampire = indoPakTrajectoryScenario.bundles.find(bundle => bundle.bundleId.endsWith('su30-adampur'))
  assert.ok(minhas?.diagnostics.some(item => item.includes('J-10CE')))
  assert.ok(minhas?.diagnostics.includes('OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY'))
  assert.ok(rafiki?.diagnostics.includes('OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY'))
  assert.ok(vampire?.diagnostics.some(item => item.includes('scenario-local callsign')))
})

test('resolves exact normalized aliases plus location and carries mapping diagnostics', () => {
  const catalog = buildTrajectoryCatalog(snapshot())
  const groups = [
    group('group:india-su30', '  ＳＵ－３０ＭＫＩ编队 ', ' LOCATION:ADAMPUR ', 'india'),
    group('group:india-rafale', '阵风战斗机', 'location:ambala', 'india'),
    group('group:pakistan-jf17-minhas', 'jf-17', 'location:minhas', 'pakistan'),
    group('group:pakistan-jf17-rafiki', 'JF-17编队', 'location:rafiki', 'pakistan'),
  ]

  const resolved = resolveFormationBundles(groups, catalog, indoPakTrajectoryScenario)

  assert.deepEqual(resolved.map(bundle => bundle.actorGroupRef), groups.map(item => item.groupId).sort())
  assert.equal(resolved.some(bundle => bundle.bundleId.startsWith('reserve:')), false)
  assert.equal(resolved.find(bundle => bundle.actorGroupRef.endsWith('minhas'))?.diagnostics
    .includes('OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY'), true)
  assert.equal(resolved.every(bundle => bundle.mappingAuthority === 'scenario_config'), true)
})

test('does not use fuzzy substring or location-free matching', () => {
  const catalog = buildTrajectoryCatalog(snapshot())

  assert.throws(
    () => resolveFormationBundles([
      group('group:fuzzy', 'forward JF-17 formation', 'location:minhas', 'pakistan'),
    ], catalog, indoPakTrajectoryScenario),
    expectCompilationCode('TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED'),
  )
  assert.throws(
    () => resolveFormationBundles([
      group('group:wrong-location', 'JF-17', 'location:ambala', 'pakistan'),
    ], catalog, indoPakTrajectoryScenario),
    expectCompilationCode('TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED'),
  )
  assert.throws(
    () => resolveFormationBundles([
      group('group:location-free-missile', 'PL-15E导弹', 'location:unrelated', 'pakistan', 'missile'),
    ], catalog, indoPakTrajectoryScenario),
    expectCompilationCode('TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED'),
  )
})

test('fails resolution when a configured route is unavailable from the catalog', () => {
  const catalog = buildTrajectoryCatalog(snapshot(
    allRoutes.filter(routeId => routeId !== 'trajectory:minhas-j10ce-4'),
  ))

  assert.throws(
    () => resolveFormationBundles([
      group('group:pakistan-jf17-minhas', 'JF-17', 'location:minhas', 'pakistan'),
    ], catalog, indoPakTrajectoryScenario),
    expectCompilationCode('TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED'),
  )
})

test('assigns stable unique catalog routes and never creates illustrative fallbacks', () => {
  const catalog = buildTrajectoryCatalog(snapshot())
  const actorGroups = [
    group('group:india-rafale', '阵风', 'location:ambala', 'india'),
    group('group:pakistan-jf17-minhas', 'JF-17', 'location:minhas', 'pakistan'),
  ]
  const bundles = resolveFormationBundles(actorGroups, catalog, indoPakTrajectoryScenario)
  const actorInstances = [
    ...instances(actorGroups[0]!.groupId, 4),
    ...instances(actorGroups[1]!.groupId, 4),
  ]

  const first = assignActorRoutes([...actorInstances].reverse(), bundles)
  const second = assignActorRoutes(actorInstances, [...bundles].reverse())

  assert.deepEqual(first, second)
  assert.equal(first.length, actorInstances.length)
  assert.equal(new Set(first.map(item => item.trajectoryAssetRef)).size, first.length)
  assert.equal(first.some(item => item.sourceKind === 'illustrative'), false)
  assert.equal(first.every(item => item.spatialPathMode === 'preserve'), true)
  assert.equal(first.every(item => item.resamplePolicy === 'preserve-source-samples'), true)
})

test('reports unresolved actor groups and route capacity exhaustion explicitly', () => {
  const catalog = buildTrajectoryCatalog(snapshot())
  const actorGroup = group('group:india-rafale', '阵风', 'location:ambala', 'india')
  const bundles = resolveFormationBundles([actorGroup], catalog, indoPakTrajectoryScenario)

  assert.throws(
    () => assignActorRoutes(instances('group:unresolved', 1), bundles),
    expectCompilationCode('TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED'),
  )
  assert.throws(
    () => assignActorRoutes(instances(actorGroup.groupId, 5), bundles),
    expectCompilationCode('TRAJECTORY_BUNDLE_CAPACITY_EXCEEDED'),
  )
})

test('never reuses a route shared accidentally by two simultaneous bundles', () => {
  const bundles: FormationBundle[] = [
    {
      bundleId: 'formation:first',
      actorGroupRef: 'group:first',
      routeAssetRefs: ['trajectory:shared'],
      recommendedActorCount: 1,
      role: 'fighter',
      side: 'india',
      semanticTags: ['fighter'],
      scenarioBindings: ['indo-pak/v1'],
      mappingAuthority: 'scenario_config',
      diagnostics: [],
    },
    {
      bundleId: 'formation:second',
      actorGroupRef: 'group:second',
      routeAssetRefs: ['trajectory:shared'],
      recommendedActorCount: 1,
      role: 'fighter',
      side: 'pakistan',
      semanticTags: ['fighter'],
      scenarioBindings: ['indo-pak/v1'],
      mappingAuthority: 'scenario_config',
      diagnostics: [],
    },
  ]

  assert.throws(
    () => assignActorRoutes([
      ...instances('group:first', 1),
      ...instances('group:second', 1),
    ], bundles),
    expectCompilationCode('TRAJECTORY_BUNDLE_CAPACITY_EXCEEDED'),
  )
})
