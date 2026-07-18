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

const awacsRoutes = [
  'trajectory:india-awacs-1',
  'trajectory:pakistan-awacs-1',
] as const

const allRoutes = [...aircraftRoutes, ...missileRoutes, ...awacsRoutes]

function trajectoryEntry(assetId: string): AssetRegistryEntry {
  const suffix = Number(assetId.match(/-(\d+)$/)?.[1] ?? 1)
  const repaired = assetId === 'trajectory:ambala-su30mki-1'
  const indiaAwacs = assetId === 'trajectory:india-awacs-1'
  const pakistanAwacs = assetId === 'trajectory:pakistan-awacs-1'
  const stationaryBounds: [[number, number], [number, number]] | undefined = indiaAwacs
    ? [[75.171707, 30.81646], [75.171707, 30.81646]]
    : pakistanAwacs
      ? [[73.0845, 31.4504], [73.0845, 31.4504]]
      : undefined
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
      endTimeMs: indiaAwacs || pakistanAwacs ? 99_000 : repaired ? 181_000 : 160_000 + suffix * 1_000,
      monotonic: true,
      bounds: stationaryBounds ?? [[70, 20], [80, 35]],
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

function awacsGroup(
  groupId: string,
  semanticEntityRef: string,
  side: string,
  behaviorProfile: string,
  locationRef: string,
): ActorGroup {
  return {
    ...group(groupId, semanticEntityRef, locationRef, side, 'early-warning-support'),
    platformType: 'awacs',
    quantityDecision: {
      value: 1,
      constraint: 'unknown',
      source: 'default',
      evidenceRefs: [],
      defaultPolicyId: 'single-node/v1',
      reason: 'Test fixture',
    },
    formationPattern: 'single',
    leaderPolicy: 'single-member',
    behaviorProfile,
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

function weaponGroup(
  groupId: string,
  side: string,
  behaviorProfile: string,
  locationRef = '边境附近空域',
): ActorGroup {
  return {
    ...group(groupId, 'missile', locationRef, side, 'weapon-launch'),
    platformType: 'missile',
    quantityDecision: {
      value: 1,
      constraint: 'unknown',
      source: 'default',
      evidenceRefs: [],
      defaultPolicyId: 'single-launch/v1',
      reason: 'Test fixture',
    },
    formationPattern: 'single',
    leaderPolicy: 'single-member',
    behaviorProfile,
    lifecycle: 'event-scoped:event:weapon-test',
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

test('builds a deterministic catalog for all aircraft, missile, and stationary AWACS trajectories', () => {
  const first = buildTrajectoryCatalog(snapshot([...allRoutes].reverse()))
  const second = buildTrajectoryCatalog(snapshot(allRoutes))

  assert.equal(first.entries.length, 23)
  assert.deepEqual(first, second)
  assert.deepEqual(first.entries.map(entry => entry.trajectoryAssetId), [...allRoutes].sort())
  assert.equal(first.entries.every(entry => entry.scenarioBindings.includes('indo-pak/v1')), true)
  assert.equal(first.entries.every(entry => entry.validationStatus !== 'invalid'), true)
})

test('does not infer trajectory faction metadata from a filename prefix', () => {
  const catalog = buildTrajectoryCatalog(snapshot(['trajectory:india-awacs-1']))

  assert.equal(catalog.entries[0]?.side, undefined)
})

test('catalogs both AWACS routes as exact stationary 99000ms paths', () => {
  const catalog = buildTrajectoryCatalog(snapshot())

  assert.deepEqual(
    catalog.entries
      .filter(entry => awacsRoutes.includes(entry.trajectoryAssetId as typeof awacsRoutes[number]))
      .map(entry => [entry.trajectoryAssetId, entry.startTimeMs, entry.endTimeMs, entry.bounds]),
    [
      ['trajectory:india-awacs-1', 0, 99_000, [[75.171707, 30.81646], [75.171707, 30.81646]]],
      ['trajectory:pakistan-awacs-1', 0, 99_000, [[73.0845, 31.4504], [73.0845, 31.4504]]],
    ],
  )
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
      ['support:india-netra-awacs', 1],
      ['support:pakistan-awacs-proxy', 1],
      ['weapon:india-first-strike', 3],
      ['weapon:pakistan-intercept', 3],
      ['weapon:pakistan-counterattack', 3],
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

test('binds exact AWACS aliases and behavior profiles to their models and stationary routes', () => {
  const india = indoPakTrajectoryScenario.bundles.find(bundle => bundle.bundleId === 'support:india-netra-awacs')
  const pakistan = indoPakTrajectoryScenario.bundles.find(bundle => bundle.bundleId === 'support:pakistan-awacs-proxy')
  assert.deepEqual(
    [india, pakistan].map(bundle => ({
      model: bundle?.modelAssetRef,
      routes: bundle?.routeAssetRefs,
      profiles: bundle?.behaviorProfileRefs,
    })),
    [
      {
        model: 'model:netra-awacs',
        routes: ['trajectory:india-awacs-1'],
        profiles: ['awacs-support/india/v1'],
      },
      {
        model: 'model:awacs-generic-e3a',
        routes: ['trajectory:pakistan-awacs-1'],
        profiles: ['awacs-support/pakistan/v1'],
      },
    ],
  )

  const resolved = resolveFormationBundles([
    awacsGroup('group:india-awacs', 'Netra AEW&CS', 'india', 'awacs-support/india/v1', 'unrelated location wording'),
    awacsGroup('group:pakistan-awacs', '巴方预警机（通用示意模型）', 'pakistan', 'awacs-support/pakistan/v1', 'other location wording'),
  ], buildTrajectoryCatalog(snapshot()), indoPakTrajectoryScenario)
  assert.deepEqual(resolved.map(bundle => [bundle.actorGroupRef, bundle.routeAssetRefs]), [
    ['group:india-awacs', ['trajectory:india-awacs-1']],
    ['group:pakistan-awacs', ['trajectory:pakistan-awacs-1']],
  ])
})

test('binds weapon behavior profiles to preferred and compatible real catalog routes', () => {
  const catalog = buildTrajectoryCatalog(snapshot())
  const groups = [
    weaponGroup('group:weapon-first-strike', 'india', 'weapon-launch/india-first-strike/v1', '边境附近空域'),
    weaponGroup('group:weapon-intercept', 'pakistan', 'weapon-launch/pakistan-intercept/v1', '交战空域'),
    weaponGroup('group:weapon-counterattack', 'pakistan', 'weapon-launch/pakistan-counterattack/v1', '交战空域'),
  ]

  const bundles = resolveFormationBundles(groups, catalog, indoPakTrajectoryScenario)

  assert.deepEqual(bundles.map(bundle => [bundle.actorGroupRef, bundle.routeAssetRefs]), [
    ['group:weapon-counterattack', [
      'trajectory:pakistan-strike-missile-2',
      'trajectory:pakistan-missile-1',
      'trajectory:india-missile-1',
    ]],
    ['group:weapon-first-strike', [
      'trajectory:india-missile-1',
      'trajectory:pakistan-missile-1',
      'trajectory:pakistan-strike-missile-2',
    ]],
    ['group:weapon-intercept', [
      'trajectory:pakistan-missile-1',
      'trajectory:pakistan-strike-missile-2',
      'trajectory:india-missile-1',
    ]],
  ])
  assert.equal(bundles.every(bundle => bundle.recommendedActorCount === 3), true)
})

test('rejects ambiguous weapon behavior profiles instead of selecting a route by bundle order', () => {
  const catalog = buildTrajectoryCatalog(snapshot())

  assert.throws(
    () => resolveFormationBundles([
      weaponGroup('group:weapon-ambiguous', 'pakistan', 'weapon-launch/v1', '交战空域'),
    ], catalog, indoPakTrajectoryScenario),
    expectCompilationCode('TRAJECTORY_SEMANTIC_MAPPING_UNRESOLVED'),
  )
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

test('uses compatible real missile routes when evidence specifies repeated launches', () => {
  const catalog = buildTrajectoryCatalog(snapshot())
  const counterattack = {
    ...weaponGroup(
      'group:weapon-counterattack',
      'pakistan',
      'weapon-launch/pakistan-counterattack/v1',
    ),
    quantityDecision: {
      value: 2,
      constraint: 'exact' as const,
      source: 'evidence' as const,
      evidenceRefs: ['evidence:explicit-two-missiles'],
      reason: 'The report explicitly launches two missiles',
    },
  }
  const firstStrike = weaponGroup(
    'group:weapon-first-strike',
    'india',
    'weapon-launch/india-first-strike/v1',
  )
  const bundles = resolveFormationBundles(
    [counterattack, firstStrike],
    catalog,
    indoPakTrajectoryScenario,
  )

  const assignments = assignActorRoutes([
    ...instances(counterattack.groupId, counterattack.quantityDecision.value),
    ...instances(firstStrike.groupId, firstStrike.quantityDecision.value),
  ], bundles)
  const byActor = new Map(assignments.map(assignment => [assignment.actorInstanceRef, assignment]))

  assert.equal(assignments.length, 3)
  assert.equal(new Set(assignments.map(item => item.trajectoryAssetRef)).size, 3)
  assert.equal(
    byActor.get('actor:weapon-counterattack:1')?.trajectoryAssetRef,
    'trajectory:pakistan-strike-missile-2',
  )
  assert.equal(
    byActor.get('actor:weapon-first-strike:1')?.trajectoryAssetRef,
    'trajectory:india-missile-1',
  )
  assert.deepEqual(
    new Set(assignments.map(item => item.trajectoryAssetRef)),
    new Set(missileRoutes),
  )
})

test('keeps repeated Pakistan interception missiles on Pakistan routes before cross-side fallback', () => {
  const actorGroup = weaponGroup(
    'group:weapon-intercept',
    'pakistan',
    'weapon-launch/pakistan-intercept/v1',
  )
  const bundles = resolveFormationBundles(
    [actorGroup],
    buildTrajectoryCatalog(snapshot()),
    indoPakTrajectoryScenario,
  )

  const assignments = assignActorRoutes(instances(actorGroup.groupId, 2), bundles)

  assert.deepEqual(assignments.map(item => item.trajectoryAssetRef), [
    'trajectory:pakistan-missile-1',
    'trajectory:pakistan-strike-missile-2',
  ])
})

test('keeps repeated Pakistan counterattack missiles on Pakistan routes before cross-side fallback', () => {
  const actorGroup = weaponGroup(
    'group:weapon-counterattack',
    'pakistan',
    'weapon-launch/pakistan-counterattack/v1',
  )
  const bundles = resolveFormationBundles(
    [actorGroup],
    buildTrajectoryCatalog(snapshot()),
    indoPakTrajectoryScenario,
  )

  const assignments = assignActorRoutes(instances(actorGroup.groupId, 2), bundles)

  assert.deepEqual(assignments.map(item => item.trajectoryAssetRef), [
    'trajectory:pakistan-strike-missile-2',
    'trajectory:pakistan-missile-1',
  ])
})

test('reports missile quantity beyond the real trajectory inventory as capacity exhaustion', () => {
  const actorGroup = weaponGroup(
    'group:weapon-counterattack',
    'pakistan',
    'weapon-launch/pakistan-counterattack/v1',
  )
  const bundles = resolveFormationBundles(
    [actorGroup],
    buildTrajectoryCatalog(snapshot()),
    indoPakTrajectoryScenario,
  )

  assert.throws(
    () => assignActorRoutes(instances(actorGroup.groupId, missileRoutes.length + 1), bundles),
    expectCompilationCode('TRAJECTORY_BUNDLE_CAPACITY_EXCEEDED'),
  )
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
