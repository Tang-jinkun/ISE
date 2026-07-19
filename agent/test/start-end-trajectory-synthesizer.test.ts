import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssetRegistrySnapshot } from '../src/contracts/assetRegistry.ts'
import type { EvidenceIR } from '../src/contracts/evidence.ts'
import { sceneBlueprintSchema } from '../src/contracts/sceneBlueprint.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { resolveSceneBlueprint } from '../src/planning/resolveSceneBlueprint.ts'
import { synthesizeStartEndTrajectory } from '../src/services/startEndTrajectorySynthesizer.ts'

const request = {
  actorId: 'actor:su30:leader',
  start: { coordinates: [75.1, 30.1] as [number, number], altitudeM: 9_000 },
  end: { coordinates: [76.2, 31.2] as [number, number], altitudeM: 10_000 },
  source: 'document' as const,
  sourceRefs: ['ev-route-1'],
  pathStyle: 'great_circle' as const,
  startMs: 10_000,
  endMs: 30_000,
}

test('synthesizes a deterministic route with exact endpoints and monotonic samples', () => {
  const first = synthesizeStartEndTrajectory(request)
  const second = synthesizeStartEndTrajectory(request)

  assert.deepEqual(first, second)
  assert.equal(first.sourceKind, 'generated')
  assert.equal(first.generationMethod, 'document-endpoints-v1')
  assert.equal(first.points.length >= 16 && first.points.length <= 32, true)
  assert.deepEqual(first.points[0], { timeMs: 10_000, longitude: 75.1, latitude: 30.1, altitudeM: 9_000 })
  assert.deepEqual(first.points.at(-1), { timeMs: 30_000, longitude: 76.2, latitude: 31.2, altitudeM: 10_000 })
  assert.ok(first.points.every((point, index, points) => index === 0 || point.timeMs > points[index - 1]!.timeMs))
})

test('intercept synthesis ends at the target anchor', () => {
  const result = synthesizeStartEndTrajectory({
    ...request,
    actorId: 'actor:missile:1',
    pathStyle: 'intercept',
    targetActorId: 'actor:jf17:leader',
  })

  assert.equal(result.pathStyle, 'intercept')
  assert.equal(result.targetActorId, 'actor:jf17:leader')
  assert.deepEqual(result.points.at(-1), { timeMs: 30_000, longitude: 76.2, latitude: 31.2, altitudeM: 10_000 })
})

test('rejects incomplete or non-positive route windows', () => {
  assert.throws(() => synthesizeStartEndTrajectory({ ...request, endMs: request.startMs }))
  assert.throws(() => synthesizeStartEndTrajectory({ ...request, end: undefined as never }))
})

test('scene resolution creates generated assignments when an exact model has no catalog route', () => {
  const hash = `sha256:${'b'.repeat(64)}`
  const evidence: EvidenceIR = {
    schemaVersion: 'evidence-ir/v1',
    documentId: 'doc-generated-route',
    records: [{
      evidenceId: 'ev-route',
      sourceRef: 'doc:p1',
      claim: 'Rafale departs from coordinates:75.1,30.1 to coordinates:76.2,31.2.',
      kind: 'explicit_fact',
      entities: ['Rafale'],
      routeExpression: { start: [75.1, 30.1], end: [76.2, 31.2], pathStyle: 'great_circle' },
      confidence: 1,
      ambiguities: [],
    }],
  }
  const group = {
    groupId: 'group:rafale', semanticEntityRef: 'Rafale', evidenceRefs: ['ev-route'], side: 'india',
    locationRef: 'coordinates:75.1,30.1', platformType: 'rafale', role: 'fighter-formation',
    quantityDecision: { value: 1, constraint: 'exact' as const, source: 'evidence' as const, evidenceRefs: ['ev-route'], reason: 'fixture' },
    formationPattern: 'single', leaderPolicy: 'single-member', behaviorProfile: 'fighter-formation/v1', lifecycle: 'scene-persistent',
  }
  const blueprint = sceneBlueprintSchema.parse({
    schemaVersion: 'ise.scene-blueprint/v1', blueprintId: 'blueprint:generated-route',
    sourceNarrationPlanId: 'narration:generated-route', sourceNarrationFingerprint: hash,
    scenarioPack: { packId: 'generic/v1', version: '1' }, actorGroups: [group],
    sceneBeats: [{
      sceneBeatId: 'scene-beat:generated-route', eventUnitId: 'event:generated-route', purpose: 'movement',
      actorRefs: ['group:rafale'], behaviorIntents: ['formation departure'], spatialConstraints: [],
      stateTransitions: [], cameraIntent: 'follow', mediaIntents: [], requiredFacts: [], forbiddenClaims: [],
      fidelity: 'evidence', priority: 'high',
    }], diagnostics: [],
  })
  const registry: AssetRegistrySnapshot = {
    schemaVersion: 'asset-registry/v1', registryVersion: hash, diagnostics: [], assets: [{
      assetId: 'model:rafale', kind: 'model', displayName: 'Rafale', aliases: ['Rafale'], fingerprint: hash,
      size: 1, mediaType: 'model/gltf-binary', availability: 'available', criticality: 'required',
      fallbackAssetIds: [], allowFallback: false,
      model: { scale: 1, rotationOffsetDeg: [0, 0, 0], altitudeOffsetM: 0, entityTypes: ['aircraft'] },
    }],
  }

  const resolved = resolveSceneBlueprint({ blueprint, assetRegistry: registry, evidence })

  assert.equal(resolved.actorRouteAssignments[0]?.sourceKind, 'generated')
  assert.equal(resolved.generatedTrajectoryAssets.length, 1)
  assert.equal(resolved.generatedTrajectoryAssets[0]?.trajectory.points.length >= 16, true)
  assert.equal(resolved.resolvedAssets.some(asset => asset.startsWith('trajectory:generated-')), true)
})
