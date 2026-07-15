import assert from 'node:assert/strict'
import test from 'node:test'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import type { NarrativePlan, TemplateName } from '../src/contracts/narrativePlan.ts'
import {
  canonicalRuntimePlanSchema,
  runtimeCommandSchema,
} from '../src/contracts/runtimePlan.ts'
import type { AssetRegistryEntry, AssetRegistrySnapshot } from '../src/contracts/assetRegistry.ts'
import { compileScene, type CompilerInput } from '../src/compiler/sceneCompiler.ts'
import { subtitleDurationMs } from '../src/compiler/scheduler.ts'
import { canonicalJson } from '../src/services/fingerprint.ts'
import { CompilationError } from '../src/services/runtimeDiagnostics.ts'
import { templateNameSchema } from '../src/contracts/narrativePlan.ts'

const hash = `sha256:${'1'.repeat(64)}`

function assets(trajectoryAvailability: 'available' | 'missing' = 'available'): AssetRegistrySnapshot {
  const entries: AssetRegistryEntry[] = [
    {
      assetId: 'model:jf17', kind: 'model', displayName: 'JF-17', aliases: ['Thunder'], fingerprint: hash,
      size: 10, availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
      mediaType: 'model/gltf-binary', model: { scale: 1, rotationOffsetDeg: [0, 0, 0], altitudeOffsetM: 0, entityTypes: ['aircraft'] },
    },
    {
      assetId: 'trajectory:jf17-1', kind: 'trajectory', displayName: 'JF-17 route', aliases: [], fingerprint: hash,
      size: 10, availability: trajectoryAvailability, criticality: 'required', fallbackAssetIds: [], allowFallback: false,
      mediaType: 'application/vnd.ise.trajectory+json',
      trajectory: { format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt', startTimeMs: 1_700_000_000_000, endTimeMs: 1_700_000_060_000, monotonic: true },
    },
    {
      assetId: 'image:summary', kind: 'image', displayName: 'Summary', aliases: [], fingerprint: hash,
      size: 10, availability: 'available', criticality: 'optional', fallbackAssetIds: [], allowFallback: false,
      mediaType: 'image/png', image: { width: 100, height: 100, fit: 'contain' },
    },
    {
      assetId: 'video:engagement', kind: 'video', displayName: 'Engagement', aliases: [], fingerprint: hash,
      size: 10, availability: 'available', criticality: 'optional', fallbackAssetIds: [], allowFallback: false,
      mediaType: 'video/mp4', video: { durationMs: 8_000, codec: 'h264' },
    },
    {
      assetId: 'geojson:zone', kind: 'geojson', displayName: 'Zone', aliases: [], fingerprint: hash,
      size: 10, availability: 'available', criticality: 'optional', fallbackAssetIds: [], allowFallback: false,
      mediaType: 'application/geo+json',
    },
  ]
  return { schemaVersion: 'asset-registry/v1', registryVersion: hash, assets: entries, diagnostics: [] }
}

function input(template: TemplateName = 'deployment', trajectoryAvailability: 'available' | 'missing' = 'available'): CompilerInput {
  const eventPlan: EventPlan = {
    schemaVersion: 'event-plan/v1', planId: 'event-plan-1', documentId: 'document-1', version: 1,
    eventUnits: [{
      eventUnitId: 'unit-1', title: 'Event', worldStateChange: 'JF-17 state changed', participants: ['JF-17'],
      locationRefs: ['border'], realWorldTime: '2025-05-07T10:00:00+05:00', evidenceRefs: ['ev-1'], inferenceRefs: [],
      uncertainties: [], narrativePurpose: 'Explain event', importance: 'high',
    }], omittedEvidence: [], warnings: [],
  }
  const narrativePlan: NarrativePlan = {
    schemaVersion: 'narrative-plan/v1', narrativePlanId: 'narrative-1',
    sourceEventPlan: { artifactId: 'accepted-1', planId: eventPlan.planId, version: 1, fingerprint: hash },
    targetDurationMs: 180_000,
    subtitles: [{ subtitleId: 'subtitle-1', eventUnitId: 'unit-1', text: '战机进入任务空域', evidenceRefs: ['ev-1'], importance: 'high' }],
    sceneRequirements: [{
      requirementId: 'requirement-1', eventUnitId: 'unit-1', focusEntities: ['JF-17'],
      spatialRelations: ['near border'], stateChanges: [template], motionRequirements: ['follow registered route'],
      attentionRequirements: ['show event'], requiredFacts: ['JF-17 state changed'], forbiddenClaims: ['confirmed victory'],
      preferredTemplate: template,
    }],
  }
  return { eventPlanArtifactId: 'accepted-1', eventPlan, narrativePlan, assetRegistry: assets(trajectoryAvailability) }
}

function assertNoOverlap(items: { startMs: number; durationMs: number }[]) {
  const ordered = [...items].sort((left, right) => left.startMs - right.startMs)
  for (let index = 1; index < ordered.length; index++) {
    assert.ok(ordered[index]!.startMs >= ordered[index - 1]!.startMs + ordered[index - 1]!.durationMs)
  }
}

test('subtitle duration uses four Chinese characters per second and a four second floor', () => {
  assert.equal(subtitleDurationMs('短句', 'low'), 4_000)
  assert.equal(subtitleDurationMs('一二三四五六七八九十一二三四五六', 'high'), 6_000)
})

test('the same frozen inputs compile byte-identically', () => {
  assert.equal(canonicalJson(compileScene(input())), canonicalJson(compileScene(input())))
})

test('all nine registered templates compile through the strict command schema', () => {
  const templates: TemplateName[] = [
    'deployment', 'attack_chain', 'interception', 'electronic_warfare', 'counterattack',
    'withdrawal', 'return_and_summary', 'generic_movement', 'status_explanation',
  ]
  for (const template of templates) {
    assert.deepEqual(canonicalRuntimePlanSchema.parse(compileScene(input(template))).schemaVersion, 'canonical-runtime-plan/v1')
  }
})

test('unknown template names and command types are rejected', () => {
  assert.equal(templateNameSchema.safeParse('free_form_code').success, false)
  const valid = compileScene(input()).commands[0]!
  assert.equal(runtimeCommandSchema.safeParse({ ...valid, type: 'shell.execute' }).success, false)
})

test('required missing trajectory creates diagnostics and no plan', () => {
  assert.throws(() => compileScene(input('deployment', 'missing')), (error: unknown) =>
    error instanceof CompilationError && error.diagnostics.some(item => item.code === 'REQUIRED_ASSET_MISSING'))
})

test('camera and same-target state commands never overlap', () => {
  const compilerInput = input('counterattack')
  compilerInput.narrativePlan.sceneRequirements.push({
    ...compilerInput.narrativePlan.sceneRequirements[0]!, requirementId: 'requirement-2', preferredTemplate: 'counterattack',
  })
  const plan = compileScene(compilerInput)
  assertNoOverlap(plan.commands.filter(item => item.type === 'camera.transition'))
  for (const targetId of new Set(plan.commands.map(item => item.targetId))) {
    assertNoOverlap(plan.commands.filter(item => item.targetId === targetId && item.type === 'model.set_state'))
  }
})

test('trajectory reality time never becomes playback time', () => {
  const plan = compileScene(input())
  assert.ok(plan.commands.every(command => command.startMs < 180_000))
  assert.ok(plan.commands.every(command => command.startMs !== 1_700_000_000_000))
})

test('a target duration below subtitle floors fails without dropping events', () => {
  const compilerInput = input()
  compilerInput.narrativePlan.targetDurationMs = 30_000
  compilerInput.narrativePlan.subtitles = Array.from({ length: 8 }, (_, index) => ({
    ...compilerInput.narrativePlan.subtitles[0]!, subtitleId: `subtitle-${index}`,
  }))
  assert.throws(() => compileScene(compilerInput), (error: unknown) =>
    error instanceof CompilationError && error.diagnostics.some(item => item.code === 'RUNTIME_DURATION_EXCEEDED'))
})

test('duplicate subtitle output IDs are rejected before a plan is returned', () => {
  const compilerInput = input()
  compilerInput.narrativePlan.subtitles.push({ ...compilerInput.narrativePlan.subtitles[0]! })
  assert.throws(() => compileScene(compilerInput), (error: unknown) =>
    error instanceof CompilationError && error.diagnostics.some(item => item.code === 'DUPLICATE_OUTPUT_ID'))
})

test('fixed state-change inference supplies movement assets when preferredTemplate is omitted', () => {
  const compilerInput = input('deployment')
  delete compilerInput.narrativePlan.sceneRequirements[0]!.preferredTemplate
  compilerInput.narrativePlan.sceneRequirements[0]!.stateChanges = ['deployment begins']
  assert.ok(compileScene(compilerInput).commands.some(command => command.type === 'model.follow_path'))
})
