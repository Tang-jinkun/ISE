import assert from 'node:assert/strict'
import test from 'node:test'
import { ArtifactStore, DomainStateStore, type AgentContext } from '@ise/agent-core'
import { sceneProjectConfigSchema } from '@ise/runtime-contracts'
import { BaseRuntimeAdapter } from '../src/adapters/baseRuntimeAdapter.ts'
import {
  ASSET_REGISTRY_ARTIFACT,
  COMPILED_RUNTIME_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  NARRATIVE_PLAN_ARTIFACT,
  type CompiledRuntimeArtifactData,
} from '../src/contracts/artifactTypes.ts'
import { canonicalRuntimePlanSchema, type CanonicalRuntimePlan } from '../src/contracts/runtimePlan.ts'
import { capabilityManifest } from '../src/compiler/capabilityManifest.ts'
import { createCompilerTools } from '../src/tools/compilerTools.ts'
import { fingerprint } from '../src/services/fingerprint.ts'

const hash = `sha256:${'1'.repeat(64)}`

function runtimePlanWithEveryTrack(): CanonicalRuntimePlan {
  const common = (commandId: string, targetId: string) => ({
    commandId, eventUnitId: 'unit-1', targetId, startMs: 0, durationMs: 1_000,
    dependsOn: [], onFailure: 'abort' as const, evidenceRefs: ['ev-1'],
  })
  return canonicalRuntimePlanSchema.parse({
    schemaVersion: 'canonical-runtime-plan/v1', planId: 'runtime-1', sourceDocumentId: 'doc-1',
    eventPlanArtifactId: 'accepted-1', eventPlanId: 'plan-1', narrativePlanId: 'narrative-1',
    capabilityManifestVersion: 'ise-capabilities/v1', assetRegistryVersion: hash, totalDurationMs: 10_000,
    entities: [{
      entityId: 'entity:jf17-1', displayName: 'JF-17 1', kind: 'aircraft',
      modelAssetId: 'model:jf17', defaultTrajectoryAssetId: 'trajectory:jf17-1', initialState: 'normal',
    }],
    subtitles: [{
      subtitleId: 'subtitle-1', eventUnitId: 'unit-1', text: 'Deployment', evidenceRefs: ['ev-1'],
      importance: 'high', startMs: 0, durationMs: 4_000, position: 'bottom', maxWidthPct: 80,
    }],
    commands: [
      { ...common('image-1', 'overlay:image'), type: 'image.show', durationMs: 4_000, params: {
        assetId: 'image:summary', layout: { xPct: 0, yPct: 0, widthPct: 20, heightPct: 20, zIndex: 1, opacity: 1, fit: 'contain' }, enter: 'fade', exit: 'fade',
      } },
      { ...common('video-1', 'overlay:video'), type: 'video.play', params: {
        assetId: 'video:engagement', layout: { xPct: 20, yPct: 0, widthPct: 20, heightPct: 20, zIndex: 2, opacity: 1, fit: 'cover' }, volume: 0, playbackRate: 1, loop: false,
      } },
      { ...common('marker-1', 'marker:main'), type: 'marker.show', durationMs: 4_000, params: { coordinates: [74.5, 32.5], label: 'Border', color: '#ffcc00' } },
      { ...common('geojson-1', 'map:zone'), type: 'geojson.show', durationMs: 4_000, params: {
        assetId: 'geojson:zone', lineColor: '#fff', lineWidth: 1, fillColor: '#fff', fillOpacity: 0.1,
        circleColor: '#fff', circleRadius: 2, keepAfterEnd: false,
      } },
      { ...common('camera-1', 'camera:main'), type: 'camera.transition', params: { center: [74.5, 32.5], zoom: 7, pitch: 45, bearing: 0, easing: 'easeInOut' } },
      { ...common('spawn-1', 'entity:jf17-1'), type: 'model.spawn', params: { action: 'model.spawn', entityId: 'entity:jf17-1', modelAssetId: 'model:jf17' } },
      { ...common('follow-1', 'entity:jf17-1'), type: 'model.follow_path', durationMs: 4_000, params: { action: 'model.follow_path', entityId: 'entity:jf17-1', trajectoryAssetId: 'trajectory:jf17-1' } },
      { ...common('state-1', 'entity:jf17-1'), type: 'model.set_state', params: { action: 'model.set_state', entityId: 'entity:jf17-1', state: 'warning' } },
      { ...common('hide-1', 'entity:jf17-1'), type: 'model.hide', params: { action: 'model.hide', entityId: 'entity:jf17-1' } },
    ],
    informationCards: [{ cardId: 'card-1', eventUnitId: 'unit-1', text: 'Evidence', startMs: 4_000, durationMs: 4_000, evidenceRefs: ['ev-1'] }],
    lineage: [], diagnostics: [],
  })
}

function compilerContext(options: { movement?: boolean; missingTrajectory?: boolean; lastValid?: boolean } = {}): AgentContext {
  const artifacts = new ArtifactStore()
  const eventPlan = {
    schemaVersion: 'event-plan/v1' as const, planId: 'plan-1', documentId: 'doc-1', version: 1,
    eventUnits: [{
      eventUnitId: 'unit-1', title: 'Status', worldStateChange: 'JF-17 status', participants: ['JF-17'],
      locationRefs: ['border'], evidenceRefs: ['ev-1'], inferenceRefs: [], uncertainties: [],
      narrativePurpose: 'Explain', importance: 'high' as const,
    }], omittedEvidence: [], warnings: [],
  }
  const eventFingerprint = fingerprint(eventPlan)
  artifacts.create({
    id: 'accepted-1', type: EVENT_PLAN_ACCEPTED_ARTIFACT, version: 1, createdBy: 'user', data: eventPlan,
    metadata: { planId: 'plan-1', documentId: 'doc-1', version: 1, fingerprint: eventFingerprint, confirmationId: 'review:r:user', acceptedDraftArtifactId: 'draft-1' },
  })
  const preferredTemplate = options.movement ? 'deployment' as const : 'status_explanation' as const
  artifacts.create({
    id: 'narrative-artifact-1', type: NARRATIVE_PLAN_ARTIFACT, createdBy: 'agent', data: {
      schemaVersion: 'narrative-plan/v1', narrativePlanId: 'narrative-1',
      sourceEventPlan: { artifactId: 'accepted-1', planId: 'plan-1', version: 1, fingerprint: eventFingerprint },
      targetDurationMs: 180_000,
      subtitles: [{ subtitleId: 'subtitle-1', eventUnitId: 'unit-1', text: '状态说明', evidenceRefs: ['ev-1'], importance: 'high' }],
      sceneRequirements: [{
        requirementId: 'requirement-1', eventUnitId: 'unit-1', focusEntities: ['JF-17'], spatialRelations: [],
        stateChanges: [preferredTemplate], motionRequirements: options.movement ? ['route'] : [], attentionRequirements: [],
        requiredFacts: ['JF-17 status'], forbiddenClaims: [], preferredTemplate,
      }],
    },
  })
  const registryAssets: unknown[] = [{
    assetId: 'model:jf17', kind: 'model', displayName: 'JF-17', aliases: [], fingerprint: hash, size: 10,
    availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
    mediaType: 'model/gltf-binary', model: { scale: 1, rotationOffsetDeg: [0, 0, 0], altitudeOffsetM: 0, entityTypes: ['aircraft'] },
  }]
  if (options.movement) registryAssets.push({
    assetId: 'trajectory:jf17-1', kind: 'trajectory', displayName: 'JF-17 route', aliases: [], fingerprint: hash, size: 10,
    availability: options.missingTrajectory ? 'missing' : 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
    mediaType: 'application/vnd.ise.trajectory+json',
    trajectory: { format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt', startTimeMs: 0, endTimeMs: 1_000, monotonic: true },
  })
  artifacts.create({
    id: 'registry-artifact-1', type: ASSET_REGISTRY_ARTIFACT, createdBy: 'tool', data: {
      schemaVersion: 'asset-registry/v1', registryVersion: hash, assets: registryAssets, diagnostics: [],
    },
  })
  if (options.lastValid) artifacts.create({
    id: 'last-valid', type: COMPILED_RUNTIME_ARTIFACT, createdBy: 'tool', data: { runtimePlan: runtimePlanWithEveryTrack(), sceneProjectConfig: new BaseRuntimeAdapter().adapt(runtimePlanWithEveryTrack(), 'last-valid') },
  })
  return {
    workspace: process.cwd(),
    goal: { objective: 'test', status: 'active', turnCount: 0, maxTurns: 1, evidence: [], remainingIssues: [], startedAt: new Date(0).toISOString() },
    artifacts, domainState: new DomainStateStore(),
  }
}

const compileInput = {
  eventPlanArtifactId: 'accepted-1', narrativePlanArtifactId: 'narrative-artifact-1',
  assetRegistryArtifactId: 'registry-artifact-1', capabilityManifestVersion: capabilityManifest.version,
  assetRegistryVersion: hash,
}

test('adapter produces the exact shared entity shape', () => {
  const config = new BaseRuntimeAdapter().adapt(runtimePlanWithEveryTrack(), 'runtime-artifact-1')
  assert.deepEqual(config.entities[0], {
    entityId: 'entity:jf17-1', displayName: 'JF-17 1', kind: 'aircraft',
    modelAssetId: 'model:jf17', defaultTrajectoryAssetId: 'trajectory:jf17-1', initialState: 'normal',
  })
})

test('adapter groups all seven discriminated tracks and passes shared schema', () => {
  const config = new BaseRuntimeAdapter().adapt(runtimePlanWithEveryTrack(), 'runtime-artifact-1')
  assert.deepEqual(config.tracks.map(track => track.type).sort(), ['camera', 'geojson', 'image', 'marker', 'model', 'subtitle', 'video'])
  assert.deepEqual(sceneProjectConfigSchema.parse(config), config)
})

test('compiled artifact contains its self-referencing validated config and exact progress', async () => {
  const progress: string[] = []
  const tool = createCompilerTools({ onCompileProgress: payload => { progress.push(`${payload.stage}:${payload.percentage}`) } })[0]!
  const result = await tool.execute(compileInput, compilerContext())
  const artifact = result.artifacts?.find(item => item.type === COMPILED_RUNTIME_ARTIFACT)
  assert.ok(artifact?.id)
  const data = artifact.data as CompiledRuntimeArtifactData
  assert.equal(data.sceneProjectConfig.runtimePlanArtifactId, artifact.id)
  assert.deepEqual(sceneProjectConfigSchema.parse(data.sceneProjectConfig), data.sceneProjectConfig)
  assert.deepEqual(progress, ['narrative:10', 'assets:30', 'schedule:60', 'validate:85', 'adapt:100'])
})

test('compile_replay_runtime validates the complete artifact before returning it', async () => {
  for (const variant of ['schema', 'self-reference'] as const) {
    const context = compilerContext({ lastValid: true })
    const tool = createCompilerTools({
      adaptRuntimePlan(runtimePlan, artifactId) {
        const config = new BaseRuntimeAdapter().adapt(runtimePlan, artifactId)
        return variant === 'schema'
          ? { ...config, tracks: 'malformed-scene-tracks' }
          : { ...config, runtimePlanArtifactId: 'malformed-runtime-artifact' }
      },
    })[0]!

    await assert.rejects(
      tool.execute(compileInput, context),
      (error: unknown) => error instanceof Error && error.message === 'COMPILED_ARTIFACT_INVALID',
      variant,
    )
    assert.deepEqual(
      context.artifacts.list(COMPILED_RUNTIME_ARTIFACT).map(item => item.id),
      ['last-valid'],
      variant,
    )
  }
})

test('validate_replay_runtime reparses both stored values without repairing', async () => {
  const context = compilerContext()
  const compiled = await createCompilerTools()[0]!.execute(compileInput, context)
  context.artifacts.create(compiled.artifacts![0]!)
  const result = await createCompilerTools()[1]!.execute({ artifactId: compiled.artifacts![0]!.id }, context)
  assert.equal(JSON.parse(result.content).valid, true)
  assert.equal(result.artifacts, undefined)
})

test('validate_replay_runtime rejects malformed and inconsistent compiled artifacts with a stable error', async () => {
  for (const variant of [
    'runtime-schema',
    'scene-schema',
    'self-reference',
    'runtime-lineage',
    'scene-lineage',
    'metadata-lineage',
  ] as const) {
    const context = compilerContext()
    const compiled = await createCompilerTools()[0]!.execute(compileInput, context)
    const artifact = structuredClone(compiled.artifacts![0]!)
    const data = artifact.data as CompiledRuntimeArtifactData
    if (variant === 'runtime-schema') artifact.data = { ...data, runtimePlan: {} }
    else if (variant === 'scene-schema') artifact.data = { ...data, sceneProjectConfig: {} }
    else if (variant === 'self-reference') data.sceneProjectConfig.runtimePlanArtifactId = 'other-runtime-artifact'
    else if (variant === 'runtime-lineage') data.runtimePlan.eventPlanArtifactId = 'other-accepted-artifact'
    else if (variant === 'scene-lineage') data.sceneProjectConfig.eventPlanArtifactId = 'other-accepted-artifact'
    else artifact.metadata = { ...artifact.metadata, eventPlanArtifactId: 'other-accepted-artifact' }
    context.artifacts.create(artifact)
    await assert.rejects(
      createCompilerTools()[1]!.execute({ artifactId: artifact.id }, context),
      (error: unknown) => error instanceof Error && error.message === 'COMPILED_ARTIFACT_INVALID',
      variant,
    )
  }
})

test('failed recompile creates no artifact and preserves the last valid one', async () => {
  const context = compilerContext({ movement: true, missingTrajectory: true, lastValid: true })
  await assert.rejects(createCompilerTools()[0]!.execute(compileInput, context), /REQUIRED_ASSET_MISSING/)
  assert.deepEqual(context.artifacts.list(COMPILED_RUNTIME_ARTIFACT).map(item => item.id), ['last-valid'])
})
