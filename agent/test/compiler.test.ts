import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ArtifactStore, DomainStateStore, type AgentContext } from '@ise/agent-core'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import type { NarrativePlan, TemplateName } from '../src/contracts/narrativePlan.ts'
import {
  canonicalRuntimePlanSchema,
  runtimeCommandSchema,
} from '../src/contracts/runtimePlan.ts'
import type { AssetRegistryEntry, AssetRegistrySnapshot } from '../src/contracts/assetRegistry.ts'
import {
  compileLegacyScene as compileScene,
  compileScene as compileFinalScene,
  type LegacyCompilerInput as CompilerInput,
} from '../src/compiler/sceneCompiler.ts'
import {
  SUBTITLE_VISUAL_LEAD_MS,
  scheduleNarrative,
  subtitleDurationMs,
} from '../src/compiler/scheduler.ts'
import { canonicalJson, fingerprint } from '../src/services/fingerprint.ts'
import { CompilationError } from '../src/services/runtimeDiagnostics.ts'
import { templateNameSchema } from '../src/contracts/narrativePlan.ts'
import { createCompilerTools } from '../src/tools/compilerTools.ts'
import {
  ASSET_REGISTRY_ARTIFACT,
  CHOREOGRAPHY_PLAN_ARTIFACT,
  COMPILED_RUNTIME_ARTIFACT,
  EVIDENCE_IR_ARTIFACT,
  EVENT_PLAN_ACCEPTED_ARTIFACT,
  NARRATION_PLAN_ARTIFACT,
  NARRATIVE_PLAN_ARTIFACT,
  RESOLVED_SCENE_PLAN_ARTIFACT,
  SCENE_BLUEPRINT_ARTIFACT,
} from '../src/contracts/artifactTypes.ts'
import type { NarrationPlan } from '../src/contracts/narrationPlan.ts'
import type { SceneBlueprint } from '../src/contracts/sceneBlueprint.ts'
import { resolveSceneBlueprint } from '../src/planning/resolveSceneBlueprint.ts'
import { compileChoreography } from '../src/compiler/choreographyCompiler.ts'
import { indoPakTrajectoryScenario } from '../src/config/indoPakTrajectoryScenario.ts'
import { capabilityManifest } from '../src/compiler/capabilityManifest.ts'
import { buildNarrationPlan } from '../src/planning/narrationPlanner.ts'

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
      trajectory: {
        format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt',
        startTimeMs: 1_700_000_000_000, endTimeMs: 1_700_000_060_000, monotonic: true,
        bounds: [[74.5859956466703, 30.0801879134059], [76.834468270714, 31.0374131710755]],
      },
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

function cloneAsset<T extends AssetRegistryEntry>(entry: T, overrides: Partial<T>): T {
  return { ...entry, ...overrides }
}

test('subtitle duration uses four Chinese characters per second and a four second floor', () => {
  assert.equal(subtitleDurationMs('短句', 'low'), 4_000)
  assert.equal(subtitleDurationMs('一二三四五六七八九十一二三四五六', 'high'), 6_000)
})

test('the same frozen inputs compile byte-identically', () => {
  assert.equal(canonicalJson(compileScene(input())), canonicalJson(compileScene(input())))
})

test('final narration scheduling starts visual commands after the exact exported subtitle lead', () => {
  const source = input('status_explanation')
  const narrationPlan: NarrationPlan = {
    schemaVersion: 'ise.narration-plan/v1', narrationPlanId: 'narration-scheduler',
    sourceEventPlanId: source.eventPlan.planId, sourceEventPlanFingerprint: fingerprint(source.eventPlan),
    sourceNarrativePlanId: source.narrativePlan.narrativePlanId,
    beats: [{
      ...source.narrativePlan.subtitles[0]!, beatRole: 'setup', attentionTarget: 'JF-17',
      estimatedDurationMs: 6_000,
    }],
    diagnostics: [],
  }
  const scheduled = scheduleNarrative({
    eventPlan: source.eventPlan,
    narrativePlan: source.narrativePlan,
    narrationPlan,
    commandDrafts: [{
      commandId: 'cmd:lead', eventUnitId: 'unit-1', targetId: 'marker:lead', type: 'marker.show',
      params: { coordinates: [74, 31], label: 'Lead', color: '#ffffff' },
      dependsOn: [], onFailure: 'abort', evidenceRefs: ['ev-1'], desiredDurationMs: 4_000,
    }],
    informationCardDrafts: [],
    capabilities: capabilityManifest,
  })

  assert.equal(SUBTITLE_VISUAL_LEAD_MS, 800)
  assert.equal(scheduled.commands[0]!.startMs, scheduled.subtitles[0]!.startMs + SUBTITLE_VISUAL_LEAD_MS)
  assert.equal(scheduled.subtitles[0]!.text, narrationPlan.beats[0]!.text)
})

test('final narration scheduling reports the stable conflict when lead and command minimums cannot fit', () => {
  const source = input('status_explanation')
  source.narrativePlan.targetDurationMs = 30_000
  const narrationPlan: NarrationPlan = {
    schemaVersion: 'ise.narration-plan/v1', narrationPlanId: 'narration-conflict',
    sourceEventPlanId: source.eventPlan.planId, sourceEventPlanFingerprint: fingerprint(source.eventPlan),
    sourceNarrativePlanId: source.narrativePlan.narrativePlanId,
    beats: [{
      ...source.narrativePlan.subtitles[0]!, beatRole: 'setup', attentionTarget: 'JF-17',
      estimatedDurationMs: 4_000,
    }],
    diagnostics: [],
  }

  assert.throws(() => scheduleNarrative({
    eventPlan: source.eventPlan,
    narrativePlan: source.narrativePlan,
    narrationPlan,
    commandDrafts: [{
      commandId: 'cmd:conflict', eventUnitId: 'unit-1', targetId: 'marker:conflict', type: 'marker.show',
      params: { coordinates: [74, 31], label: 'Conflict', color: '#ffffff' },
      dependsOn: [], onFailure: 'abort', evidenceRefs: ['ev-1'], desiredDurationMs: 30_000,
    }],
    informationCardDrafts: [],
    capabilities: capabilityManifest,
  }), (error: unknown) => error instanceof CompilationError
    && error.diagnostics.some(item => item.code === 'NARRATION_VISUAL_DURATION_CONFLICT'))
})

test('final narration scheduling never shortens a medium subtitle to fit the target', () => {
  const source = input('status_explanation')
  source.narrativePlan.targetDurationMs = 30_000
  const narrationPlan: NarrationPlan = {
    schemaVersion: 'ise.narration-plan/v1', narrationPlanId: 'narration-no-shortening',
    sourceEventPlanId: source.eventPlan.planId, sourceEventPlanFingerprint: fingerprint(source.eventPlan),
    sourceNarrativePlanId: source.narrativePlan.narrativePlanId,
    beats: [{
      ...source.narrativePlan.subtitles[0]!, importance: 'medium', beatRole: 'setup', attentionTarget: 'JF-17',
      estimatedDurationMs: 30_500,
    }],
    diagnostics: [],
  }

  assert.throws(() => scheduleNarrative({
    eventPlan: source.eventPlan,
    narrativePlan: source.narrativePlan,
    narrationPlan,
    commandDrafts: [],
    informationCardDrafts: [],
    capabilities: capabilityManifest,
  }), (error: unknown) => error instanceof CompilationError
    && error.diagnostics.some(item => item.code === 'NARRATION_VISUAL_DURATION_CONFLICT'))
})

function multiActorCompilerFixture() {
  const eventPlan: EventPlan = {
    schemaVersion: 'event-plan/v1',
    planId: 'event-plan-indo-pak',
    documentId: 'document-indo-pak',
    version: 1,
    eventUnits: [
      {
        eventUnitId: 'unit-deployment', title: 'Fighter deployment',
        worldStateChange: 'Four fighter formations deployed from their registered bases',
        participants: ['Su-30MKI', 'Rafale', 'JF-17'],
        locationRefs: ['Adampur', 'Ambala', 'Minhas', 'Rafiki'],
        evidenceRefs: ['ev-deployment'], inferenceRefs: [], uncertainties: [],
        narrativePurpose: 'Establish the formations', importance: 'high',
      },
      {
        eventUnitId: 'unit-launch', title: 'Pakistan missile launch',
        worldStateChange: 'A PL-15E missile launched', participants: ['PL-15E missile'],
        locationRefs: ['Minhas'], evidenceRefs: ['ev-launch'], inferenceRefs: [], uncertainties: [],
        narrativePurpose: 'Show the launch', importance: 'high',
      },
      {
        eventUnitId: 'unit-summary', title: 'Formation summary',
        worldStateChange: 'The fighter formations returned to a summary view',
        participants: ['Su-30MKI', 'Rafale', 'JF-17'],
        locationRefs: ['Adampur', 'Ambala', 'Minhas', 'Rafiki'],
        evidenceRefs: ['ev-summary'], inferenceRefs: [], uncertainties: [],
        narrativePurpose: 'Summarize the formation state', importance: 'medium',
      },
    ],
    omittedEvidence: [], warnings: [],
  }
  const narrativePlan: NarrativePlan = {
    schemaVersion: 'narrative-plan/v1', narrativePlanId: 'narrative-indo-pak',
    sourceEventPlan: {
      artifactId: 'accepted-indo-pak', planId: eventPlan.planId, version: 1,
      fingerprint: fingerprint(eventPlan),
    },
    targetDurationMs: 180_000,
    subtitles: [
      { subtitleId: 'subtitle-deployment', eventUnitId: 'unit-deployment', text: 'Four formations deploy.', evidenceRefs: ['ev-deployment'], importance: 'high' },
      { subtitleId: 'subtitle-launch', eventUnitId: 'unit-launch', text: 'A registered missile route is shown.', evidenceRefs: ['ev-launch'], importance: 'high' },
      { subtitleId: 'subtitle-summary', eventUnitId: 'unit-summary', text: 'The replay returns to the summary.', evidenceRefs: ['ev-summary'], importance: 'medium' },
    ],
    sceneRequirements: [
      {
        requirementId: 'requirement-deployment', eventUnitId: 'unit-deployment',
        focusEntities: ['Su-30MKI'], spatialRelations: ['registered bases'], stateChanges: ['deployment'],
        motionRequirements: ['trajectory:adampur-vampire-1'], attentionRequirements: ['show all formations'],
        requiredFacts: ['Four formations deployed'], forbiddenClaims: [], preferredTemplate: 'deployment',
      },
      {
        requirementId: 'requirement-launch', eventUnitId: 'unit-launch',
        focusEntities: ['PL-15E missile'], spatialRelations: ['Minhas'], stateChanges: ['attack'],
        motionRequirements: [], attentionRequirements: ['show launch'], requiredFacts: ['missile launch'],
        forbiddenClaims: ['confirmed target', 'confirmed outcome'], preferredTemplate: 'attack_chain',
      },
      {
        requirementId: 'requirement-summary', eventUnitId: 'unit-summary',
        focusEntities: ['Rafale'], spatialRelations: [], stateChanges: ['summary'], motionRequirements: [],
        attentionRequirements: ['show summary'], requiredFacts: ['formation summary'], forbiddenClaims: [],
        preferredTemplate: 'return_and_summary',
      },
    ],
  }
  const narrationPlan: NarrationPlan = {
    schemaVersion: 'ise.narration-plan/v1', narrationPlanId: 'narration-indo-pak',
    sourceEventPlanId: eventPlan.planId, sourceEventPlanFingerprint: fingerprint(eventPlan),
    sourceNarrativePlanId: narrativePlan.narrativePlanId,
    beats: narrativePlan.subtitles.map((subtitle, index) => ({
      ...subtitle,
      beatRole: index === 0 ? 'setup' as const : index === 1 ? 'action' as const : 'summary' as const,
      attentionTarget: narrativePlan.sceneRequirements[index]!.attentionRequirements[0]!,
      estimatedDurationMs: subtitleDurationMs(subtitle.text, subtitle.importance),
    })),
    diagnostics: [],
  }
  const actorGroups: SceneBlueprint['actorGroups'] = [
    ['group:india-su30-adampur', 'Su-30MKI', 'india', 'Adampur', 2, 'fighter-formation', 'finger-four'],
    ['group:india-rafale-ambala', 'Rafale', 'india', 'Ambala', 4, 'fighter-formation', 'finger-four'],
    ['group:pakistan-jf17-minhas', 'JF-17', 'pakistan', 'Minhas', 4, 'fighter-formation', 'finger-four'],
    ['group:pakistan-jf17-rafiki', 'JF-17', 'pakistan', 'Rafiki', 4, 'fighter-formation', 'finger-four'],
    ['group:weapon-unit-launch', 'PL-15E', 'pakistan', 'Minhas', 1, 'weapon-launch', 'single'],
  ].map(([groupId, semanticEntityRef, side, locationRef, quantity, role, formationPattern]) => ({
    groupId: groupId as string,
    semanticEntityRef: semanticEntityRef as string,
    evidenceRefs: [role === 'weapon-launch' ? 'ev-launch' : 'ev-deployment'],
    side: side as string,
    locationRef: locationRef as string,
    platformType: semanticEntityRef as string,
    role: role as string,
    quantityDecision: {
      value: quantity as number, constraint: 'exact', source: 'evidence',
      evidenceRefs: [role === 'weapon-launch' ? 'ev-launch' : 'ev-deployment'],
      reason: 'Exact fixture quantity',
    },
    formationPattern: formationPattern as string,
    leaderPolicy: role === 'weapon-launch' ? 'single-member' : 'stable-first-member',
    behaviorProfile: role === 'weapon-launch' ? 'weapon-launch/pakistan-intercept/v1' : 'fighter-formation/v1',
    lifecycle: role === 'weapon-launch' ? 'event-scoped:unit-launch' : 'scene-persistent',
  }))
  const fighterGroupRefs = actorGroups.filter(group => group.role === 'fighter-formation').map(group => group.groupId)
  const sceneBlueprint: SceneBlueprint = {
    schemaVersion: 'ise.scene-blueprint/v1', blueprintId: 'blueprint-indo-pak',
    sourceNarrationPlanId: narrationPlan.narrationPlanId,
    sourceNarrationFingerprint: fingerprint(narrationPlan),
    actorGroups,
    sceneBeats: [
      {
        sceneBeatId: 'scene-beat-deployment', subtitleId: 'subtitle-deployment', eventUnitId: 'unit-deployment',
        purpose: 'Establish formations', actorRefs: fighterGroupRefs, behaviorIntents: ['deployment'],
        spatialConstraints: ['registered bases'], stateTransitions: ['deployed'], cameraIntent: 'show all formations',
        mediaIntents: [], requiredFacts: ['Four formations deployed'], forbiddenClaims: [], fidelity: 'evidence', priority: 'high',
      },
      {
        sceneBeatId: 'scene-beat-launch', subtitleId: 'subtitle-launch', eventUnitId: 'unit-launch',
        purpose: 'Show launch', actorRefs: ['group:weapon-unit-launch'], behaviorIntents: ['launch'],
        spatialConstraints: ['Minhas'], stateTransitions: ['launched'], cameraIntent: 'show launch',
        mediaIntents: ['video'], requiredFacts: ['missile launch'], forbiddenClaims: ['confirmed target', 'confirmed outcome'],
        fidelity: 'evidence', priority: 'high',
      },
      {
        sceneBeatId: 'scene-beat-summary', subtitleId: 'subtitle-summary', eventUnitId: 'unit-summary',
        purpose: 'Summarize formations', actorRefs: fighterGroupRefs, behaviorIntents: ['return'],
        spatialConstraints: [], stateTransitions: ['summary'], cameraIntent: 'show summary', mediaIntents: ['image'],
        requiredFacts: ['formation summary'], forbiddenClaims: [], fidelity: 'evidence', priority: 'medium',
      },
    ],
    diagnostics: [],
  }
  const routeIds = [...new Set(indoPakTrajectoryScenario.bundles.flatMap(bundle => bundle.routeAssetRefs))]
  const routeEntries: AssetRegistryEntry[] = routeIds.map((assetId, index) => {
    const bounds: [[number, number], [number, number]] = [
      [70 + index * 0.1, 28 + index * 0.05],
      [70.5 + index * 0.1, 28.4 + index * 0.05],
    ]
    const points = assetId === 'trajectory:india-missile-1'
      ? [
          { timeMs: 0, longitude: 75.90581401335153, latitude: 29.482080957203344, altitudeM: 8_300.150568202918 },
          { timeMs: 90_000, longitude: 75.49608000877947, latitude: 29.923278174202373, altitudeM: 8_449.990285766895 },
          { timeMs: 180_000, longitude: 74.54003399811131, latitude: 30.952738347200103, altitudeM: 8_799.616293416171 },
        ]
      : [
          { timeMs: 0, longitude: bounds[0][0], latitude: bounds[0][1], altitudeM: 8_000 },
          { timeMs: 180_000, longitude: bounds[1][0], latitude: bounds[1][1], altitudeM: 8_000 },
        ]
    return {
      assetId, kind: 'trajectory', displayName: assetId, aliases: [],
      fingerprint: `sha256:${(index + 1).toString(16).padStart(64, '0')}`, size: 10,
      availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
      mediaType: 'application/vnd.ise.trajectory+json',
      trajectory: {
        format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt',
        startTimeMs: 0, endTimeMs: 180_000, monotonic: true, bounds, points,
      },
    }
  })
  const modelEntries: AssetRegistryEntry[] = [
    ['model:su30mki', 'Su-30MKI'], ['model:rafale', 'Rafale'], ['model:jf17', 'JF-17'], ['model:pl15e', 'PL-15E missile'],
  ].map(([assetId, displayName]) => ({
    assetId: assetId as `model:${string}`, kind: 'model', displayName: displayName!, aliases: [], fingerprint: hash,
    size: 10, availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
    mediaType: 'model/gltf-binary',
    model: { scale: 1, rotationOffsetDeg: [0, 0, 0], altitudeOffsetM: 0, entityTypes: [assetId === 'model:pl15e' ? 'missile' : 'aircraft'] },
  }))
  const assetRegistry: AssetRegistrySnapshot = {
    schemaVersion: 'asset-registry/v1', registryVersion: `sha256:${'8'.repeat(64)}`,
    assets: [
      ...routeEntries,
      ...modelEntries,
      {
        assetId: 'image:summary', kind: 'image', displayName: 'Formation summary', aliases: ['summary'], fingerprint: hash,
        size: 10, availability: 'available', criticality: 'optional', fallbackAssetIds: [], allowFallback: false,
        mediaType: 'image/png', image: { width: 100, height: 100, fit: 'contain' },
      },
      {
        assetId: 'video:engagement', kind: 'video', displayName: 'Missile launch', aliases: ['attack'], fingerprint: hash,
        size: 10, availability: 'available', criticality: 'optional', fallbackAssetIds: [], allowFallback: false,
        mediaType: 'video/mp4', video: { durationMs: 8_000, codec: 'h264' },
      },
    ],
    diagnostics: [],
  }
  const resolvedScenePlan = resolveSceneBlueprint({ blueprint: sceneBlueprint, assetRegistry })
  const choreographyPlan = compileChoreography({ narrationPlan, sceneBlueprint, resolvedScenePlan, assetRegistry })
  return {
    eventPlan, narrativePlan, narrationPlan, sceneBlueprint, resolvedScenePlan, choreographyPlan, assetRegistry,
    input: {
      eventPlanArtifactId: 'accepted-indo-pak', narrativePlanArtifactId: 'narrative-artifact-indo-pak',
      narrationPlanArtifactId: 'narration-artifact-indo-pak', sceneBlueprintArtifactId: 'blueprint-artifact-indo-pak',
      resolvedScenePlanArtifactId: 'resolved-artifact-indo-pak', choreographyPlanArtifactId: 'choreography-artifact-indo-pak',
      assetRegistryArtifactId: 'registry-artifact-indo-pak', eventPlan, narrativePlan, narrationPlan,
      sceneBlueprint, resolvedScenePlan, choreographyPlan, assetRegistry,
    },
  }
}

function multiEngagementChoreographyFixture() {
  const fixture = multiActorCompilerFixture()
  const originalWeapon = fixture.sceneBlueprint.actorGroups.find(group => group.role === 'weapon-launch')!
  const fighters = fixture.sceneBlueprint.actorGroups.filter(group => group.role === 'fighter-formation')
  const weapons: SceneBlueprint['actorGroups'] = [
    {
      ...originalWeapon,
      groupId: 'group:weapon-first-strike',
      semanticEntityRef: 'missile',
      side: 'india',
      locationRef: '边境附近空域',
      behaviorProfile: 'weapon-launch/india-first-strike/v1',
      lifecycle: 'event-scoped:unit-first-strike',
      quantityDecision: { ...originalWeapon.quantityDecision, evidenceRefs: ['ev-first-strike'] },
    },
    {
      ...originalWeapon,
      groupId: 'group:weapon-intercept',
      semanticEntityRef: 'missile',
      side: 'pakistan',
      locationRef: '交战空域',
      behaviorProfile: 'weapon-launch/pakistan-intercept/v1',
      lifecycle: 'event-scoped:unit-intercept',
      quantityDecision: { ...originalWeapon.quantityDecision, evidenceRefs: ['ev-intercept'] },
    },
    {
      ...originalWeapon,
      groupId: 'group:weapon-counterattack',
      semanticEntityRef: 'missile',
      side: 'pakistan',
      locationRef: '交战空域',
      behaviorProfile: 'weapon-launch/pakistan-counterattack/v1',
      lifecycle: 'event-scoped:unit-counterattack',
      quantityDecision: { ...originalWeapon.quantityDecision, evidenceRefs: ['ev-counterattack'] },
    },
  ]
  const sourceLaunchBeat = fixture.narrationPlan.beats.find(beat => beat.subtitleId === 'subtitle-launch')!
  const launchNarrationBeat = (subtitleId: string, eventUnitId: string, evidenceRef: string) => ({
    ...sourceLaunchBeat,
    subtitleId,
    eventUnitId,
    evidenceRefs: [evidenceRef],
    estimatedDurationMs: 12_000,
  })
  const deploymentNarration = fixture.narrationPlan.beats.find(beat => beat.subtitleId === 'subtitle-deployment')!
  const summaryNarration = fixture.narrationPlan.beats.find(beat => beat.subtitleId === 'subtitle-summary')!
  fixture.narrationPlan = {
    ...fixture.narrationPlan,
    beats: [
      deploymentNarration,
      launchNarrationBeat('subtitle-first-strike', 'unit-first-strike', 'ev-first-strike'),
      launchNarrationBeat('subtitle-intercept', 'unit-intercept', 'ev-intercept'),
      launchNarrationBeat('subtitle-counterattack', 'unit-counterattack', 'ev-counterattack'),
      summaryNarration,
    ],
  }
  const sourceSceneBeat = fixture.sceneBlueprint.sceneBeats.find(beat => beat.sceneBeatId === 'scene-beat-launch')!
  const engagementSceneBeat = (
    sceneBeatId: string,
    subtitleId: string,
    eventUnitId: string,
    actorRefs: string[],
    requiredFact: string,
    forbiddenClaims = sourceSceneBeat.forbiddenClaims,
  ) => ({
    ...sourceSceneBeat,
    sceneBeatId,
    subtitleId,
    eventUnitId,
    actorRefs,
    requiredFacts: [requiredFact],
    forbiddenClaims,
  })
  fixture.sceneBlueprint = {
    ...fixture.sceneBlueprint,
    sourceNarrationFingerprint: fingerprint(fixture.narrationPlan),
    actorGroups: [...fighters, ...weapons],
    engagementIntents: [
      {
        engagementIntentId: 'intent:first-strike', eventUnitId: 'unit-first-strike',
        launcherGroupRef: 'group:india-su30-adampur', weaponGroupRef: 'group:weapon-first-strike',
        targetGroupRef: 'group:pakistan-jf17-minhas', assertedOutcome: 'intercepted', evidenceRefs: ['ev-first-strike'],
      },
      {
        engagementIntentId: 'intent:intercept', eventUnitId: 'unit-intercept',
        launcherGroupRef: 'group:pakistan-jf17-minhas', weaponGroupRef: 'group:weapon-intercept',
        targetGroupRef: 'group:weapon-first-strike', assertedOutcome: 'interception', evidenceRefs: ['ev-intercept'],
      },
      {
        engagementIntentId: 'intent:counterattack', eventUnitId: 'unit-counterattack',
        launcherGroupRef: 'group:pakistan-jf17-minhas', weaponGroupRef: 'group:weapon-counterattack',
        targetGroupRef: 'group:india-rafale-ambala', assertedOutcome: 'destroyed', evidenceRefs: ['ev-counterattack'],
      },
    ],
    sceneBeats: [
      fixture.sceneBlueprint.sceneBeats.find(beat => beat.sceneBeatId === 'scene-beat-deployment')!,
      engagementSceneBeat(
        'scene-beat-first-strike',
        'subtitle-first-strike',
        'unit-first-strike',
        ['group:weapon-first-strike', 'group:india-su30-adampur', 'group:pakistan-jf17-minhas'],
        'Su-30MKI launches the first strike at a Pakistani fighter.',
      ),
      engagementSceneBeat(
        'scene-beat-intercept',
        'subtitle-intercept',
        'unit-intercept',
        ['group:weapon-intercept', 'group:pakistan-jf17-minhas', 'group:weapon-first-strike'],
        'JF-17 intercepts the incoming Indian missile.',
      ),
      engagementSceneBeat(
        'scene-beat-counterattack',
        'subtitle-counterattack',
        'unit-counterattack',
        ['group:weapon-counterattack', 'group:pakistan-jf17-minhas', 'group:india-rafale-ambala'],
        'JF-17 counterattacks one Rafale and destroys it.',
        [],
      ),
      fixture.sceneBlueprint.sceneBeats.find(beat => beat.sceneBeatId === 'scene-beat-summary')!,
    ],
  }
  const resolvedScenePlan = resolveSceneBlueprint({
    blueprint: fixture.sceneBlueprint,
    assetRegistry: fixture.assetRegistry,
  })
  const choreographyPlan = compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  })
  return { ...fixture, resolvedScenePlan, choreographyPlan }
}

function genericEngagementIntentFixture() {
  const fixture = multiEngagementChoreographyFixture()
  const groupIds = new Map([
    ['group:india-rafale-ambala', 'blue-rafale'],
    ['group:pakistan-jf17-minhas', 'red-j10'],
    ['group:weapon-first-strike', 'missile-1'],
    ['group:weapon-counterattack', 'missile-2'],
  ])
  const actorIds = new Map<string, string>()
  for (const actor of fixture.resolvedScenePlan.resolvedActors) {
    const groupId = groupIds.get(actor.actorGroupRef)
    if (groupId) actorIds.set(actor.actorInstanceId, `actor:${groupId}:${actor.ordinal}`)
  }
  const remapGroup = (groupRef: string) => groupIds.get(groupRef) ?? groupRef
  const remapActor = (actorRef: string) => actorIds.get(actorRef) ?? actorRef
  const actorIdentity = new Map([
    ['blue-rafale', { semanticEntityRef: 'Blue formation', side: 'blue', platformType: 'blue-fighter' }],
    ['red-j10', { semanticEntityRef: 'Red formation', side: 'red', platformType: 'red-fighter' }],
    ['missile-1', { semanticEntityRef: 'Blue weapon', side: 'blue', platformType: 'blue-weapon' }],
    ['missile-2', { semanticEntityRef: 'Red weapon', side: 'red', platformType: 'red-weapon' }],
  ])
  fixture.sceneBlueprint = {
    ...fixture.sceneBlueprint,
    blueprintId: 'blueprint-generic-engagements',
    scenarioPack: { packId: 'generic/v1', version: '1' },
    actorGroups: fixture.sceneBlueprint.actorGroups.map(group => {
      const groupId = remapGroup(group.groupId)
      const identity = actorIdentity.get(groupId)
      return identity ? { ...group, groupId, ...identity, behaviorProfile: `${group.role}/generic/v1` } : group
    }),
    engagementIntents: [
      {
        engagementIntentId: 'intent:blue-launch',
        eventUnitId: 'unit-first-strike',
        launcherGroupRef: 'blue-rafale',
        weaponGroupRef: 'missile-1',
        targetGroupRef: 'red-j10',
        assertedOutcome: 'destroyed',
        evidenceRefs: ['ev-first-strike'],
      },
      {
        engagementIntentId: 'intent:red-launch',
        eventUnitId: 'unit-counterattack',
        launcherGroupRef: 'red-j10',
        weaponGroupRef: 'missile-2',
        targetGroupRef: 'blue-rafale',
        assertedOutcome: 'unconfirmed',
        evidenceRefs: ['ev-counterattack'],
      },
    ],
    sceneBeats: fixture.sceneBlueprint.sceneBeats.map(beat => ({
      ...beat,
      actorRefs: beat.actorRefs.map(remapGroup),
    })),
  }
  fixture.resolvedScenePlan = {
    ...fixture.resolvedScenePlan,
    sourceBlueprintId: fixture.sceneBlueprint.blueprintId,
    sourceBlueprintFingerprint: fingerprint(fixture.sceneBlueprint),
    resolvedActors: fixture.resolvedScenePlan.resolvedActors.map(actor => ({
      ...actor,
      actorInstanceId: remapActor(actor.actorInstanceId),
      actorGroupRef: remapGroup(actor.actorGroupRef),
    })),
    resolvedFormationBundles: fixture.resolvedScenePlan.resolvedFormationBundles.map(bundle => ({
      ...bundle,
      actorGroupRef: remapGroup(bundle.actorGroupRef),
    })),
    actorRouteAssignments: fixture.resolvedScenePlan.actorRouteAssignments.map(assignment => ({
      ...assignment,
      actorInstanceRef: remapActor(assignment.actorInstanceRef),
      segmentId: assignment.segmentId.replace(assignment.actorInstanceRef, remapActor(assignment.actorInstanceRef)),
    })),
    staticActorBindings: fixture.resolvedScenePlan.staticActorBindings.map(binding => ({
      ...binding,
      actorInstanceRef: remapActor(binding.actorInstanceRef),
      actorGroupRef: remapGroup(binding.actorGroupRef),
    })),
  }
  return fixture
}

test('generic engagement intents compile without scenario-specific target selection', () => {
  const fixture = genericEngagementIntentFixture()
  const choreography = compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan: fixture.resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  })

  assert.deepEqual(choreography.weaponEngagements.map(item => ({
    launcherRef: item.launcherRef,
    weaponRef: item.weaponRef,
    targetRef: item.targetRef,
    outcome: item.outcome,
  })), [
    { launcherRef: 'actor:blue-rafale:0', weaponRef: 'actor:missile-1:0', targetRef: 'actor:red-j10:0', outcome: 'destroyed' },
    { launcherRef: 'actor:red-j10:0', weaponRef: 'actor:missile-2:0', targetRef: 'actor:blue-rafale:0', outcome: 'unconfirmed' },
  ])
  assert.equal(choreography.relationSegments.filter(item => item.linkKind === 'fighter-missile').length, 2)
  for (const engagement of choreography.weaponEngagements) {
    assert.deepEqual(
      choreography.shotPlan
        .filter(shot => shot.sceneBeatRefs.includes(engagement.sceneBeatRef) && shot.phase)
        .map(shot => shot.phase),
      ['launch', 'midcourse', 'terminal', 'aftermath'],
    )
  }
  const source = readFileSync(new URL('../src/compiler/choreographyCompiler.ts', import.meta.url), 'utf8')
  for (const forbidden of ['india-first-strike', 'pakistan-intercept', 'pakistan-counterattack', "fighter('india'", "fighter('pakistan'"]) {
    assert.equal(source.includes(forbidden), false, forbidden)
  }
})

function finalInputForEngagementFixture() {
  const fixture = multiEngagementChoreographyFixture()
  const launchUnit = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'unit-launch')!
  const deploymentUnit = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'unit-deployment')!
  const summaryUnit = fixture.eventPlan.eventUnits.find(unit => unit.eventUnitId === 'unit-summary')!
  fixture.eventPlan = {
    ...fixture.eventPlan,
    eventUnits: [
      deploymentUnit,
      { ...launchUnit, eventUnitId: 'unit-first-strike', evidenceRefs: ['ev-first-strike'] },
      { ...launchUnit, eventUnitId: 'unit-intercept', evidenceRefs: ['ev-intercept'] },
      { ...launchUnit, eventUnitId: 'unit-counterattack', evidenceRefs: ['ev-counterattack'] },
      summaryUnit,
    ],
  }
  const launchRequirement = fixture.narrativePlan.sceneRequirements.find(item => item.eventUnitId === 'unit-launch')!
  fixture.narrativePlan = {
    ...fixture.narrativePlan,
    sourceEventPlan: { ...fixture.narrativePlan.sourceEventPlan, fingerprint: fingerprint(fixture.eventPlan) },
    subtitles: fixture.narrationPlan.beats.map(beat => ({
      subtitleId: beat.subtitleId,
      eventUnitId: beat.eventUnitId,
      text: beat.text,
      evidenceRefs: beat.evidenceRefs,
      importance: beat.importance,
    })),
    sceneRequirements: [
      fixture.narrativePlan.sceneRequirements.find(item => item.eventUnitId === 'unit-deployment')!,
      { ...launchRequirement, requirementId: 'requirement-first-strike', eventUnitId: 'unit-first-strike', attentionRequirements: ['video:engagement'] },
      { ...launchRequirement, requirementId: 'requirement-intercept', eventUnitId: 'unit-intercept', attentionRequirements: ['video:engagement'] },
      { ...launchRequirement, requirementId: 'requirement-counterattack', eventUnitId: 'unit-counterattack', attentionRequirements: ['video:engagement'] },
      fixture.narrativePlan.sceneRequirements.find(item => item.eventUnitId === 'unit-summary')!,
    ],
  }
  fixture.narrationPlan = {
    ...fixture.narrationPlan,
    sourceEventPlanFingerprint: fingerprint(fixture.eventPlan),
    sourceNarrativePlanId: fixture.narrativePlan.narrativePlanId,
  }
  fixture.sceneBlueprint = {
    ...fixture.sceneBlueprint,
    sourceNarrationFingerprint: fingerprint(fixture.narrationPlan),
  }
  const assetRegistry = {
    ...fixture.assetRegistry,
    assets: [
      ...fixture.assetRegistry.assets,
      {
        assetId: 'video:missile-impact' as const,
        kind: 'video' as const,
        displayName: 'Missile impact',
        aliases: [],
        fingerprint: `sha256:${'9'.repeat(64)}`,
        size: 10,
        availability: 'available' as const,
        criticality: 'required' as const,
        fallbackAssetIds: [],
        allowFallback: false,
        mediaType: 'video/mp4' as const,
        video: { durationMs: 2_000, codec: 'h264' },
      },
    ],
  }
  const resolvedScenePlan = resolveSceneBlueprint({ blueprint: fixture.sceneBlueprint, assetRegistry })
  const choreographyPlan = compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan,
    assetRegistry,
  })
  return {
    fixture,
    input: {
      ...fixture.input,
      eventPlan: fixture.eventPlan,
      narrativePlan: fixture.narrativePlan,
      narrationPlan: fixture.narrationPlan,
      sceneBlueprint: fixture.sceneBlueprint,
      resolvedScenePlan,
      choreographyPlan,
      assetRegistry,
    },
    resolvedScenePlan,
    choreographyPlan,
  }
}

function refreshFinalChoreographyFixture(fixture: ReturnType<typeof multiActorCompilerFixture>) {
  const resolvedScenePlan = resolveSceneBlueprint({
    blueprint: fixture.sceneBlueprint,
    assetRegistry: fixture.assetRegistry,
  })
  const choreographyPlan = compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  })
  return {
    ...fixture.input,
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan,
    choreographyPlan,
    assetRegistry: fixture.assetRegistry,
  }
}

test('dynamic camera choreography retains establishing shots before supported engagement phases', () => {
  const fixture = multiEngagementChoreographyFixture()
  const firstStrike = fixture.choreographyPlan.weaponEngagements.find(item =>
    item.sceneBeatRef === 'scene-beat-first-strike')!
  const interception = fixture.choreographyPlan.weaponEngagements.find(item =>
    item.sceneBeatRef === 'scene-beat-intercept')!

  assert.deepEqual(
    fixture.choreographyPlan.shotPlan
      .filter(shot => shot.subtitleId === 'subtitle-first-strike')
      .map(shot => shot.phase),
    [undefined, 'launch', 'midcourse'],
  )
  assert.deepEqual(
    fixture.choreographyPlan.shotPlan
      .filter(shot => shot.subtitleId === 'subtitle-intercept')
      .map(shot => shot.phase),
    [undefined, 'launch', 'midcourse', 'terminal', 'aftermath'],
  )
  assert.deepEqual(
    fixture.choreographyPlan.shotPlan.find(shot => shot.shotId === `shot:scene-beat-first-strike:establishing`)?.subjectRefs,
    fixture.resolvedScenePlan.resolvedActors
      .filter(actor => fixture.sceneBlueprint.sceneBeats.find(beat => beat.sceneBeatId === firstStrike.sceneBeatRef)!
        .actorRefs.includes(actor.actorGroupRef))
      .map(actor => actor.actorInstanceId),
  )
  assert.equal(firstStrike.weaponRef, interception.targetRef)
})

test('dynamic camera ordinary fifteen-second subtitle transitions then follows through the tail', () => {
  const fixture = multiActorCompilerFixture()
  fixture.narrationPlan = {
    ...fixture.narrationPlan,
    beats: fixture.narrationPlan.beats.map(beat => beat.subtitleId === 'subtitle-deployment'
      ? { ...beat, estimatedDurationMs: 15_000 }
      : beat),
  }
  fixture.sceneBlueprint = {
    ...fixture.sceneBlueprint,
    sourceNarrationFingerprint: fingerprint(fixture.narrationPlan),
  }
  const plan = compileFinalScene(refreshFinalChoreographyFixture(fixture))
  const subtitle = plan.subtitles.find(item => item.subtitleId === 'subtitle-deployment')!
  const cameras = plan.commands.filter(command => command.commandId.includes('shot:scene-beat-deployment'))
    .sort((left, right) => left.startMs - right.startMs)

  assert.deepEqual(cameras.map(command => command.type), ['camera.transition', 'camera.follow_group'])
  assert.equal(cameras[0]!.startMs, subtitle.startMs + SUBTITLE_VISUAL_LEAD_MS)
  assert.equal(cameras[0]!.startMs + cameras[0]!.durationMs, cameras[1]!.startMs)
  assert.equal(cameras[1]!.startMs + cameras[1]!.durationMs, subtitle.startMs + subtitle.durationMs)
  assert.ok(cameras[1]!.commandId.endsWith(':follow-group'))
})

test('dynamic camera global ordinary groups include every actor active in the subtitle', () => {
  const fixture = multiActorCompilerFixture()
  const plan = compileFinalScene(refreshFinalChoreographyFixture(fixture))
  const subtitle = plan.subtitles.find(item => item.subtitleId === 'subtitle-summary')!
  const follow = plan.commands.find((command): command is Extract<(typeof plan.commands)[number], { type: 'camera.follow_group' }> =>
    command.type === 'camera.follow_group' && command.commandId.includes('shot:scene-beat-summary'))!
  const expected = fixture.resolvedScenePlan.resolvedActors
    .filter(actor => {
      const lifecycle = fixture.choreographyPlan.actorLifecycles.find(item => item.actorInstanceRef === actor.actorInstanceId)!
      const first = plan.subtitles.find(item => item.subtitleId === fixture.sceneBlueprint.sceneBeats
        .find(beat => beat.sceneBeatId === lifecycle.firstSceneBeatRef)!.subtitleId)!
      const last = plan.subtitles.find(item => item.subtitleId === fixture.sceneBlueprint.sceneBeats
        .find(beat => beat.sceneBeatId === lifecycle.lastSceneBeatRef)!.subtitleId)!
      return first.startMs + SUBTITLE_VISUAL_LEAD_MS + capabilityManifest.minimumDurations['model.spawn']
        < subtitle.startMs + subtitle.durationMs
        && last.startMs + last.durationMs > subtitle.startMs
    })
    .map(actor => actor.actorInstanceId)

  assert.equal(follow.params.framing, 'global')
  assert.deepEqual(follow.params.entityIds, expected)
  assert.equal(follow.params.paddingPx, 120)
  assert.deepEqual([follow.params.minZoom, follow.params.maxZoom, follow.params.pitch], [4, 7, 35])
})

test('dynamic camera engagement intervals cover the complete visual window without overlap', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const subtitle = plan.subtitles.find(item => item.subtitleId === 'subtitle-intercept')!
  const cameras = plan.commands.filter(command => command.eventUnitId === subtitle.eventUnitId && command.targetId === 'camera:main')
    .sort((left, right) => left.startMs - right.startMs)

  assert.equal(cameras[0]!.startMs, subtitle.startMs + SUBTITLE_VISUAL_LEAD_MS)
  assert.equal(cameras.at(-1)!.startMs + cameras.at(-1)!.durationMs, subtitle.startMs + subtitle.durationMs)
  assert.equal(cameras[0]!.durationMs + cameras[1]!.durationMs, 2_000)
  assert.ok(cameras.filter(command => command.type === 'camera.follow_actor' || command.type === 'camera.follow_group')
    .every(command => command.durationMs >= capabilityManifest.minimumDurations[command.type]))
  for (let index = 1; index < cameras.length; index++) {
    assert.equal(cameras[index - 1]!.startMs + cameras[index - 1]!.durationMs, cameras[index]!.startMs)
  }
  assert.ok(cameras.every(command => command.commandId.endsWith(':camera') || command.commandId.endsWith(':follow-group') || command.commandId.endsWith(':follow-actor')))
})

test('dynamic camera interception terminal and aftermath retain surviving engagement actors', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const engagement = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'interception')!
  const terminal = plan.commands.find(command =>
    command.commandId.includes(`:${engagement.weaponRef}:terminal:follow`))
  const aftermath = plan.commands.find((command): command is Extract<(typeof plan.commands)[number], { type: 'camera.follow_group' }> =>
    command.type === 'camera.follow_group' && command.commandId.includes(`:${engagement.weaponRef}:aftermath:follow-group`))!
  const targetHide = plan.commands.find(command => command.type === 'model.hide' && command.targetId === engagement.targetRef)!

  assert.equal(terminal?.type, 'camera.follow_group')
  if (terminal?.type !== 'camera.follow_group') assert.fail('Expected interception terminal group follow')
  assert.deepEqual(terminal.params.entityIds, [engagement.weaponRef, engagement.targetRef])
  assert.ok(terminal.params.paddingPx >= 160)
  assert.ok(terminal.params.maxZoom <= 8)
  assert.deepEqual(aftermath.params.entityIds, [engagement.launcherRef, engagement.weaponRef])
  assert.ok(targetHide.startMs < aftermath.startMs)
})

test('missile launch follows the launcher source-clock position instead of its subtitle boundary', () => {
  const fixture = finalInputForEngagementFixture()
  const engagement = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'interception')!
  const launcher = fixture.resolvedScenePlan.resolvedActors.find(item => item.actorInstanceId === engagement.launcherRef)!
  const weapon = fixture.resolvedScenePlan.resolvedActors.find(item => item.actorInstanceId === engagement.weaponRef)!
  const launcherAssignment = fixture.resolvedScenePlan.actorRouteAssignments.find(item => item.actorInstanceRef === launcher.actorInstanceId)!
  const weaponAssignment = fixture.resolvedScenePlan.actorRouteAssignments.find(item => item.actorInstanceRef === weapon.actorInstanceId)!
  let launcherSourceDurationMs = 0
  fixture.input.assetRegistry = {
    ...fixture.input.assetRegistry,
    assets: fixture.input.assetRegistry.assets.map(asset => {
      if (asset.kind !== 'trajectory') return asset
      if (asset.assetId === launcherAssignment.trajectoryAssetRef) {
        const points = asset.trajectory.points!
        const first = points[0]!
        const last = points.at(-1)!
        launcherSourceDurationMs = last.timeMs - first.timeMs
        const ratio = 80_000 / launcherSourceDurationMs
        const anchor = {
          timeMs: 80_000,
          longitude: first.longitude + (last.longitude - first.longitude) * ratio,
          latitude: first.latitude + (last.latitude - first.latitude) * ratio,
          altitudeM: first.altitudeM + (last.altitudeM - first.altitudeM) * ratio,
        }
        return { ...asset, trajectory: { ...asset.trajectory, points: [first, anchor, last] } }
      }
      if (asset.assetId === weaponAssignment.trajectoryAssetRef) {
        const launcherAsset = fixture.input.assetRegistry.assets.find(candidate =>
          candidate.kind === 'trajectory' && candidate.assetId === launcherAssignment.trajectoryAssetRef)!
        if (launcherAsset.kind !== 'trajectory') return asset
        const first = launcherAsset.trajectory.points![0]!
        const last = launcherAsset.trajectory.points!.at(-1)!
        const ratio = 80_000 / (last.timeMs - first.timeMs)
        const weaponStart = asset.trajectory.points![0]!
        return { ...asset, trajectory: { ...asset.trajectory, points: [{
          ...weaponStart,
          longitude: first.longitude + (last.longitude - first.longitude) * ratio,
          latitude: first.latitude + (last.latitude - first.latitude) * ratio,
          altitudeM: first.altitudeM + (last.altitudeM - first.altitudeM) * ratio,
        }, ...asset.trajectory.points!.slice(1)] } }
      }
      return asset
    }),
  }

  const plan = compileFinalScene(fixture.input)
  const launcherFollow = plan.commands.find((command): command is Extract<(typeof plan.commands)[number], { type: 'model.follow_path' }> =>
    command.type === 'model.follow_path' && command.targetId === engagement.launcherRef)!
  const weaponFollow = plan.commands.find((command): command is Extract<(typeof plan.commands)[number], { type: 'model.follow_path' }> =>
    command.type === 'model.follow_path' && command.targetId === engagement.weaponRef)!
  const launcherDuration = launcherFollow.durationMs
  const expectedLaunchMs = launcherFollow.startMs + launcherDuration * 80_000 / launcherSourceDurationMs

  assert.ok(Math.abs(weaponFollow.startMs - expectedLaunchMs) < 2,
    `weapon=${weaponFollow.startMs} launcher=${launcherFollow.startMs} expected=${expectedLaunchMs}`)
})

test('dynamic camera destroyed target hide starts when the aftermath interval ends', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const engagement = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'destroyed')!
  const aftermath = plan.commands.find(command => command.commandId.includes(`:${engagement.weaponRef}:aftermath:follow`))!
  const hide = plan.commands.find(command => command.type === 'model.hide' && command.targetId === engagement.targetRef)!

  assert.equal(hide.startMs, aftermath.startMs + aftermath.durationMs)
})

test('dynamic camera destroyed terminal follows the missile and target together', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const engagement = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'destroyed')!
  const terminal = plan.commands.find(command =>
    command.commandId.includes(`:${engagement.weaponRef}:terminal:follow`))

  assert.equal(terminal?.type, 'camera.follow_group')
  if (terminal?.type !== 'camera.follow_group') assert.fail('Expected destroyed terminal group follow')
  assert.deepEqual(terminal.params.entityIds, [engagement.weaponRef, engagement.targetRef])
})

test('destroyed engagement ends the missile path when the target enters destroyed state', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const engagement = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'destroyed')!
  const missileFollow = plan.commands.find(command =>
    command.type === 'model.follow_path' && command.targetId === engagement.weaponRef)!
  const missileHide = plan.commands.find(command =>
    command.type === 'model.hide' && command.targetId === engagement.weaponRef)!
  const destroyed = plan.commands.find(command =>
    command.type === 'model.set_state'
    && command.targetId === engagement.targetRef
    && command.params.state === 'destroyed')!

  assert.equal(missileFollow.startMs + missileFollow.durationMs, destroyed.startMs)
  assert.equal(missileHide.startMs, destroyed.startMs)
})

test('chained interception propagates the downstream interaction point to the upstream missile', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const interception = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'interception')!
  const upstream = fixture.choreographyPlan.weaponEngagements.find(item => item.weaponRef === interception.targetRef)!
  const interceptionFollow = plan.commands.find((command): command is Extract<(typeof plan.commands)[number], { type: 'model.follow_path' }> =>
    command.type === 'model.follow_path' && command.targetId === interception.weaponRef)!
  const upstreamFollow = plan.commands.find((command): command is Extract<(typeof plan.commands)[number], { type: 'model.follow_path' }> =>
    command.type === 'model.follow_path' && command.targetId === upstream.weaponRef)!

  const interceptionBinding = interceptionFollow.params.timing?.spatialBinding
  const upstreamBinding = upstreamFollow.params.timing?.spatialBinding
  assert.ok(interceptionBinding, 'interceptor should have a spatial binding')
  assert.ok(upstreamBinding, 'upstream missile should have a spatial binding')
  assert.ok(Math.abs(interceptionBinding!.terminalLongitudeDeg - upstreamBinding!.terminalLongitudeDeg) < 1e-6)
  assert.ok(Math.abs(interceptionBinding!.terminalLatitudeDeg - upstreamBinding!.terminalLatitudeDeg) < 1e-6)
  assert.ok(Math.abs(interceptionBinding!.terminalAltitudeM - upstreamBinding!.terminalAltitudeM) < 1e-3)
})

test('destroyed engagement impact video covers the stable terminal follow', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const engagement = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'destroyed')!
  const terminalFollow = plan.commands.find(command =>
    command.commandId.includes(`:${engagement.weaponRef}:terminal:follow`))!
  const impactVideo = plan.commands.find(command =>
    command.type === 'video.play'
    && command.commandId.includes(`:${engagement.weaponRef}:terminal:impact-video`))!

  assert.equal(impactVideo.startMs, terminalFollow.startMs)
  assert.equal(impactVideo.durationMs, terminalFollow.durationMs)
  assert.ok(impactVideo.durationMs > capabilityManifest.minimumDurations['video.play'])
})

function realCrossBeatEngagementFixture() {
  const fixture = finalInputForEngagementFixture()
  const indiaAwacsGroup: SceneBlueprint['actorGroups'][number] = {
    groupId: 'group:india-netra-awacs', semanticEntityRef: 'Netra AEW&CS', side: 'india', locationRef: 'Adampur',
    platformType: 'Netra AEW&CS', role: 'early-warning-support',
    quantityDecision: { value: 1, constraint: 'exact', source: 'evidence', evidenceRefs: ['ev-first-strike'], reason: 'Fixture AWACS' },
    formationPattern: 'single', leaderPolicy: 'single-member', behaviorProfile: 'awacs-support/india/v1', lifecycle: 'scene-persistent',
  }
  const pakistanAwacsGroup: SceneBlueprint['actorGroups'][number] = {
    groupId: 'group:pakistan-awacs-proxy', semanticEntityRef: '\u5df4\u65b9\u9884\u8b66\u673a\uff08\u901a\u7528\u793a\u610f\u6a21\u578b\uff09',
    side: 'pakistan', locationRef: 'location:pakistan-awacs', platformType: 'Saab 2000 Erieye', role: 'early-warning-support',
    quantityDecision: { value: 1, constraint: 'exact', source: 'evidence', evidenceRefs: ['ev-intercept'], reason: 'Fixture AWACS' },
    formationPattern: 'single', leaderPolicy: 'single-member', behaviorProfile: 'awacs-support/pakistan/v1', lifecycle: 'scene-persistent',
  }
  fixture.input.assetRegistry = {
    ...fixture.input.assetRegistry,
    assets: [
      ...fixture.input.assetRegistry.assets,
      ...([
        ['model:netra-awacs', 'Netra AWACS'],
        ['model:awacs-generic-e3a', 'Pakistani AWACS proxy'],
      ] as const).map(([assetId, displayName]) => ({
        assetId, kind: 'model' as const, displayName, aliases: [], fingerprint: hash,
        size: 10, availability: 'available' as const, criticality: 'required' as const, fallbackAssetIds: [], allowFallback: false,
        mediaType: 'model/gltf-binary' as const,
        model: { scale: 1, rotationOffsetDeg: [0, 0, 0] as [number, number, number], altitudeOffsetM: 0, entityTypes: ['aircraft' as const] },
      })),
    ],
  }
  const fighterGroups = fixture.input.sceneBlueprint.actorGroups
    .filter(group => group.role === 'fighter-formation')
    .map(group => group.groupId === 'group:india-su30-adampur' || group.groupId === 'group:india-rafale-ambala'
      ? {
          ...group,
          semanticEntityRef: group.groupId === 'group:india-rafale-ambala' ? '\u9635\u98ce' : group.semanticEntityRef,
          quantityDecision: { ...group.quantityDecision, value: 1 },
        }
      : group)
  const weaponGroups = fixture.input.sceneBlueprint.actorGroups.filter(group => group.role === 'weapon-launch')
  fixture.input.sceneBlueprint = {
    ...fixture.input.sceneBlueprint,
    actorGroups: [...fighterGroups, indiaAwacsGroup, pakistanAwacsGroup, ...weaponGroups],
    sceneBeats: fixture.input.sceneBlueprint.sceneBeats.map(beat => {
      if (beat.sceneBeatId === 'scene-beat-first-strike') {
        return {
          ...beat,
          actorRefs: ['group:weapon-first-strike', 'group:india-su30-adampur', indiaAwacsGroup.groupId],
          requiredFacts: ['\u5370\u5ea6\u9884\u8b66\u673a\u8ddf\u8e2a\u5df4\u65b9\u6218\u673a\u76ee\u6807\u3002'],
        }
      }
      if (beat.sceneBeatId === 'scene-beat-intercept') {
        return {
          ...beat,
          actorRefs: ['group:weapon-intercept', 'group:pakistan-jf17-minhas', pakistanAwacsGroup.groupId],
          requiredFacts: ['\u5df4\u65b9 JF-17 \u62e6\u622a\u5370\u65b9\u6765\u88ad\u5bfc\u5f39\u3002'],
        }
      }
      return beat
    }),
  }
  fixture.input.resolvedScenePlan = resolveSceneBlueprint({
    blueprint: fixture.input.sceneBlueprint,
    assetRegistry: fixture.input.assetRegistry,
  })
  fixture.input.choreographyPlan = compileChoreography({
    narrationPlan: fixture.input.narrationPlan,
    sceneBlueprint: fixture.input.sceneBlueprint,
    resolvedScenePlan: fixture.input.resolvedScenePlan,
    assetRegistry: fixture.input.assetRegistry,
  })
  return fixture
}

test('final compiler emits automatic missile lifecycle, phased cameras, impact, and confirmed destruction commands', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const missiles = plan.entities.filter(entity => entity.kind === 'missile')
  assert.equal(missiles.length, 3)
  assert.deepEqual(new Set(missiles.map(entity => entity.modelAssetId)), new Set(['model:pl15e']))
  assert.deepEqual(new Set(missiles.map(entity => entity.defaultTrajectoryAssetId)), new Set([
    'trajectory:india-missile-1',
    'trajectory:pakistan-missile-1',
    'trajectory:pakistan-strike-missile-2',
  ]))
  for (const missile of missiles) {
    assert.equal(plan.commands.filter(command => command.targetId === missile.entityId && command.type === 'model.spawn').length, 1)
    assert.equal(plan.commands.filter(command => command.targetId === missile.entityId && command.type === 'model.follow_path').length, 1)
    assert.equal(plan.commands.filter(command => command.targetId === missile.entityId && command.type === 'model.hide').length, 1)
  }
  for (const subtitleId of ['subtitle-first-strike', 'subtitle-intercept', 'subtitle-counterattack']) {
    const subtitle = plan.subtitles.find(item => item.subtitleId === subtitleId)!
    const cameras = plan.commands.filter((command): command is Extract<(typeof plan.commands)[number], { type: 'camera.transition' }> =>
      command.type === 'camera.transition'
      && command.commandId.includes(`scene-beat-${subtitleId.replace('subtitle-', '')}`))
      .sort((left, right) => left.startMs - right.startMs)
    const shots = fixture.choreographyPlan.shotPlan.filter(shot => shot.subtitleId === subtitleId)
    const follows = plan.commands.filter(command => command.commandId.includes(`scene-beat-${subtitleId.replace('subtitle-', '')}`)
      && (command.type === 'camera.follow_actor' || command.type === 'camera.follow_group'))
    assert.equal(cameras.length, shots.length)
    assert.equal(follows.length, shots.length)
    assert.equal(cameras[0]?.startMs, subtitle.startMs + 800)
    assert.ok(cameras.every(command => command.startMs + command.durationMs <= subtitle.startMs + subtitle.durationMs))
    assert.ok(follows.every(command => command.commandId.endsWith(':follow-actor') || command.commandId.endsWith(':follow-group')))
  }
  const destroyed = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'destroyed')!
  const destroyedState = plan.commands.find(command => command.type === 'model.set_state'
    && command.targetId === destroyed.targetRef && command.params.state === 'destroyed')
  const destroyedHide = plan.commands.find(command => command.type === 'model.hide' && command.targetId === destroyed.targetRef)
  assert.ok(destroyedState)
  assert.ok(destroyedHide)
  assert.ok(destroyedHide.startMs >= destroyedState.startMs + 1_000)
  assert.deepEqual(destroyedState.evidenceRefs, ['ev-counterattack'])
  assert.deepEqual(destroyedHide.evidenceRefs, ['ev-counterattack'])
  const impactVideos = plan.commands.filter(command => command.type === 'video.play' && command.params.assetId === 'video:missile-impact')
  assert.equal(impactVideos.length, 2)
  assert.ok(impactVideos.some(command => command.evidenceRefs.includes('ev-intercept')))
  assert.ok(impactVideos.some(command => command.evidenceRefs.includes('ev-counterattack')))
})

test('successful interception terminates the intercepted target at terminal impact', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const engagement = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'interception')!
  const terminalCamera = plan.commands.find(command =>
    command.type === 'camera.transition'
    && command.commandId.includes(`:${engagement.weaponRef}:terminal:`))!
  const targetFollow = plan.commands.find(command =>
    command.type === 'model.follow_path'
    && command.targetId === engagement.targetRef)!
  const targetHide = plan.commands.find(command =>
    command.type === 'model.hide'
    && command.targetId === engagement.targetRef)!

  assert.equal(targetHide.startMs, terminalCamera.startMs)
  assert.ok(targetFollow.startMs < targetHide.startMs)
  assert.equal(plan.commands.some(command =>
    command.type === 'model.spawn'
    && command.targetId === engagement.targetRef
    && command.startMs > targetHide.startMs), false)
  assert.deepEqual(targetHide.evidenceRefs, engagement.evidenceRefs)
})

test('engagement phase cameras follow local actor positions as the phase time advances', () => {
  const fixture = finalInputForEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const engagement = fixture.choreographyPlan.weaponEngagements.find(item => item.outcome === 'destroyed')!
  const phaseCameras = plan.commands.filter((command): command is Extract<(typeof plan.commands)[number], { type: 'camera.transition' }> =>
    command.type === 'camera.transition'
    && command.commandId.includes(`:${engagement.weaponRef}:`))
    .sort((left, right) => left.startMs - right.startMs)

  assert.equal(phaseCameras.length, 4)
  assert.notDeepEqual(phaseCameras[1]!.params.center, phaseCameras[2]!.params.center)
})

test('interception phase cameras follow the real westbound Indian missile geometry', () => {
  const fixture = finalInputForEngagementFixture()
  fixture.input.assetRegistry = {
    ...fixture.input.assetRegistry,
    assets: fixture.input.assetRegistry.assets.map(asset => asset.kind === 'trajectory'
      ? {
          ...asset,
          trajectory: {
            ...asset.trajectory,
            bounds: asset.assetId === 'trajectory:india-missile-1'
              ? [[74.54003399811131, 29.482080957203344], [75.90581401335153, 30.952738347200103]]
              : [[73, 31], [73, 31]],
            points: asset.assetId === 'trajectory:india-missile-1'
              ? [
                  { timeMs: 0, longitude: 75.90581401335153, latitude: 29.482080957203344, altitudeM: 8_300.150568202918 },
                  { timeMs: 90_000, longitude: 75.49608000877947, latitude: 29.923278174202373, altitudeM: 8_449.990285766895 },
                  { timeMs: 180_000, longitude: 74.54003399811131, latitude: 30.952738347200103, altitudeM: 8_799.616293416171 },
                ]
              : [
                  { timeMs: 0, longitude: 73, latitude: 31, altitudeM: 8_000 },
                  { timeMs: 180_000, longitude: 73, latitude: 31, altitudeM: 8_000 },
                ],
          },
        }
      : asset),
  }
  const plan = compileFinalScene(fixture.input)
  const engagement = fixture.input.choreographyPlan.weaponEngagements.find(item => item.outcome === 'interception')!
  const cameras = plan.commands.filter((command): command is Extract<(typeof plan.commands)[number], { type: 'camera.transition' }> =>
    command.type === 'camera.transition'
    && command.commandId.includes(`:${engagement.weaponRef}:`))
    .sort((left, right) => left.startMs - right.startMs)
  const terminal = cameras.find(command => command.commandId.includes(':terminal:'))!
  const targetFollow = plan.commands.find(command => (
    command.type === 'model.follow_path' && command.targetId === engagement.targetRef
  ))!
  const progress = (
    terminal.startMs + terminal.durationMs - targetFollow.startMs
  ) / targetFollow.durationMs
  const trajectoryTimeMs = Math.max(0, Math.min(180_000, progress * 180_000))
  const start = trajectoryTimeMs <= 90_000
    ? { timeMs: 0, longitude: 75.90581401335153, latitude: 29.482080957203344 }
    : { timeMs: 90_000, longitude: 75.49608000877947, latitude: 29.923278174202373 }
  const end = trajectoryTimeMs <= 90_000
    ? { timeMs: 90_000, longitude: 75.49608000877947, latitude: 29.923278174202373 }
    : { timeMs: 180_000, longitude: 74.54003399811131, latitude: 30.952738347200103 }
  const ratio = (trajectoryTimeMs - start.timeMs) / (end.timeMs - start.timeMs)
  const expected = [
    start.longitude + (end.longitude - start.longitude) * ratio,
    start.latitude + (end.latitude - start.latitude) * ratio,
  ]

  assert.ok(Math.abs(terminal.params.center[0] - expected[0]!) < 1e-9)
  assert.ok(Math.abs(terminal.params.center[1] - expected[1]!) < 1e-9)
})

test('multiple successful interceptions retain the earliest terminal hide for their shared target', () => {
  const fixture = finalInputForEngagementFixture()
  const original = fixture.input.choreographyPlan.weaponEngagements.find(item => item.outcome === 'interception')!
  const later = fixture.input.choreographyPlan.weaponEngagements.find(item => item.outcome === 'destroyed')!
  fixture.input.choreographyPlan = {
    ...fixture.input.choreographyPlan,
    weaponEngagements: fixture.input.choreographyPlan.weaponEngagements.map(item => item.engagementId === later.engagementId
      ? { ...item, targetRef: original.targetRef, outcome: 'interception' as const }
      : item),
  }
  const plan = compileFinalScene(fixture.input)
  const successful = fixture.input.choreographyPlan.weaponEngagements.filter(item =>
    item.outcome === 'interception' && item.targetRef === original.targetRef)
  const terminalTimes = successful.map(engagement => plan.commands.find(command =>
    command.type === 'camera.transition'
    && command.commandId.includes(`:${engagement.weaponRef}:terminal:`))!.startMs)
  const hide = plan.commands.find(command => command.type === 'model.hide' && command.targetId === original.targetRef)!

  assert.equal(hide.startMs, Math.min(...terminalTimes))
  assert.deepEqual(hide.evidenceRefs, original.evidenceRefs)
})

test('choreography grounds every missile data link and only same-side supported AWACS data links', () => {
  const fixture = finalInputForEngagementFixture()
  const awacsGroup: SceneBlueprint['actorGroups'][number] = {
    groupId: 'group:india-netra-awacs', semanticEntityRef: 'Netra AEW&CS', side: 'india', locationRef: 'Adampur',
    platformType: 'Netra AEW&CS', role: 'early-warning-support',
    quantityDecision: { value: 1, constraint: 'exact', source: 'evidence', evidenceRefs: ['ev-first-strike'], reason: 'Fixture AWACS' },
    formationPattern: 'single', leaderPolicy: 'single-member', behaviorProfile: 'awacs-support/india/v1', lifecycle: 'scene-persistent',
  }
  fixture.input.assetRegistry = {
    ...fixture.input.assetRegistry,
    assets: [...fixture.input.assetRegistry.assets, {
      assetId: 'model:netra-awacs', kind: 'model', displayName: 'Netra AWACS', aliases: [], fingerprint: hash,
      size: 10, availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
      mediaType: 'model/gltf-binary', model: { scale: 1, rotationOffsetDeg: [0, 0, 0], altitudeOffsetM: 0, entityTypes: ['aircraft'] },
    }],
  }
  fixture.input.sceneBlueprint = {
    ...fixture.input.sceneBlueprint,
    actorGroups: [
      ...fixture.input.sceneBlueprint.actorGroups.map(group => (
        group.groupId === 'group:india-su30-adampur' || group.groupId === 'group:india-rafale-ambala'
          ? {
            ...group,
            quantityDecision: {
              value: 4,
              constraint: 'unknown' as const,
              source: 'default' as const,
              evidenceRefs: [],
              defaultPolicyId: 'fighter-formation/v1',
              reason: 'Fixture formation default',
            },
          }
          : group
      )),
      awacsGroup,
    ],
    sceneBeats: fixture.input.sceneBlueprint.sceneBeats.map(beat => {
      if (beat.sceneBeatId === 'scene-beat-first-strike') {
        return {
          ...beat,
          actorRefs: [...beat.actorRefs, 'group:india-rafale-ambala', awacsGroup.groupId],
          purpose: 'Netra distributes target information by data link to the Indian strike fighters.',
          requiredFacts: [...beat.requiredFacts, 'AWACS distributes target information through a data link.'],
        }
      }
      if (beat.sceneBeatId === 'scene-beat-intercept') {
        return {
          ...beat,
          actorRefs: [...beat.actorRefs, awacsGroup.groupId, 'group:india-su30-adampur'],
          purpose: 'Netra continues data-link guidance for the same Indian strike fighters.',
          requiredFacts: [...beat.requiredFacts, 'AWACS continues target information distribution by data link.'],
        }
      }
      return beat
    }),
  }
  fixture.input.resolvedScenePlan = resolveSceneBlueprint({
    blueprint: fixture.input.sceneBlueprint,
    assetRegistry: fixture.input.assetRegistry,
  })
  fixture.input.choreographyPlan = compileChoreography({
    narrationPlan: fixture.input.narrationPlan,
    sceneBlueprint: fixture.input.sceneBlueprint,
    resolvedScenePlan: fixture.input.resolvedScenePlan,
    assetRegistry: fixture.input.assetRegistry,
  })
  const actorRef = (groupRef: string) => fixture.input.resolvedScenePlan.resolvedActors
    .find(actor => actor.actorGroupRef === groupRef)!.actorInstanceId
  const awacs = actorRef(awacsGroup.groupId)
  const su30 = actorRef('group:india-su30-adampur')
  const indianFighters = fixture.input.resolvedScenePlan.resolvedActors.filter(actor =>
    actor.actorGroupRef === 'group:india-su30-adampur'
    || actor.actorGroupRef === 'group:india-rafale-ambala')
  const relations = fixture.input.choreographyPlan.relationSegments
  const fighterMissile = relations.filter(relation => relation.linkKind === 'fighter-missile')
  const awacsFighter = relations.filter(relation => relation.linkKind === 'awacs-fighter')
  const su30Relations = awacsFighter.filter(relation => relation.sourceRef === awacs && relation.targetRef === su30)

  assert.deepEqual(fighterMissile.map(relation => [relation.sourceRef, relation.targetRef]).sort(), fixture.input.choreographyPlan.weaponEngagements
    .map(engagement => [engagement.launcherRef, engagement.weaponRef]).sort())
  assert.deepEqual(su30Relations.map(relation => relation.sceneBeatRef), [
    'scene-beat-first-strike',
    'scene-beat-intercept',
  ])
  assert.deepEqual(su30Relations.map(relation => relation.evidenceRefs), [
    ['ev-first-strike'],
    ['ev-intercept'],
  ])
  assert.deepEqual(
    awacsFighter
      .filter(relation => relation.sourceRef === awacs && relation.sceneBeatRef === 'scene-beat-first-strike')
      .map(relation => relation.targetRef)
      .sort(),
    indianFighters.map(actor => actor.actorInstanceId).sort(),
  )

  const plan = compileFinalScene(fixture.input)
  const dataLinks = plan.commands.filter(command => command.type === 'data_link.show')
  assert.equal(dataLinks.length, relations.length)
  assert.equal(new Set(dataLinks.map(command => command.commandId)).size, dataLinks.length)
  for (const command of dataLinks) {
    const subtitle = plan.subtitles.find(item => item.eventUnitId === command.eventUnitId)!
    assert.equal(command.startMs, subtitle.startMs + SUBTITLE_VISUAL_LEAD_MS)
    const targetHide = command.params.linkKind === 'fighter-missile'
      ? plan.commands.find(item => item.type === 'model.hide' && item.targetId === command.params.targetEntityId)
      : undefined
    assert.equal(
      command.startMs + command.durationMs,
      targetHide?.startMs ?? subtitle.startMs + subtitle.durationMs,
    )
  }
})

test('actor lifecycle extends through later cross-beat weapon engagement uses', () => {
  const fixture = realCrossBeatEngagementFixture()
  const firstStrikeWeapon = fixture.input.resolvedScenePlan.resolvedActors.find(actor =>
    actor.actorGroupRef === 'group:weapon-first-strike')!
  const interception = fixture.input.choreographyPlan.weaponEngagements.find(engagement =>
    engagement.sceneBeatRef === 'scene-beat-intercept')!
  const lifecycle = fixture.input.choreographyPlan.actorLifecycles.find(item =>
    item.actorInstanceRef === firstStrikeWeapon.actorInstanceId)!

  assert.equal(interception.targetRef, firstStrikeWeapon.actorInstanceId)
  assert.equal(lifecycle.firstSceneBeatRef, 'scene-beat-first-strike')
  assert.equal(lifecycle.lastSceneBeatRef, 'scene-beat-intercept')
})

test('fighter missile data link extends through a later cross-beat interception', () => {
  const fixture = realCrossBeatEngagementFixture()
  const plan = compileFinalScene(fixture.input)
  const firstStrike = fixture.input.choreographyPlan.weaponEngagements.find(engagement =>
    engagement.sceneBeatRef === 'scene-beat-first-strike')!
  const dataLink = plan.commands.find(command =>
    command.type === 'data_link.show'
    && command.params.linkKind === 'fighter-missile'
    && command.params.targetEntityId === firstStrike.weaponRef)!
  const targetHide = plan.commands.find(command =>
    command.type === 'model.hide' && command.targetId === firstStrike.weaponRef)!

  assert.equal(dataLink.startMs + dataLink.durationMs, targetHide.startMs)
})

test('final compiler lets an interaction presentation outlive a short subtitle', () => {
  const fixture = finalInputForEngagementFixture()
  fixture.input.narrationPlan = {
    ...fixture.input.narrationPlan,
    beats: fixture.input.narrationPlan.beats.map(beat => beat.subtitleId === 'subtitle-first-strike'
      ? { ...beat, estimatedDurationMs: SUBTITLE_VISUAL_LEAD_MS + 3_999 }
      : beat),
  }
  fixture.input.sceneBlueprint = {
    ...fixture.input.sceneBlueprint,
    sourceNarrationFingerprint: fingerprint(fixture.input.narrationPlan),
  }
  fixture.input.resolvedScenePlan = resolveSceneBlueprint({
    blueprint: fixture.input.sceneBlueprint,
    assetRegistry: fixture.input.assetRegistry,
  })
  fixture.input.choreographyPlan = compileChoreography({
    narrationPlan: fixture.input.narrationPlan,
    sceneBlueprint: fixture.input.sceneBlueprint,
    resolvedScenePlan: fixture.input.resolvedScenePlan,
    assetRegistry: fixture.input.assetRegistry,
  })

  const plan = compileFinalScene(fixture.input)
  const subtitle = plan.subtitles.find(item => item.subtitleId === 'subtitle-first-strike')!
  const cameraTail = plan.commands
    .filter(command => command.commandId.includes('scene-beat-first-strike')
      && (command.type === 'camera.transition' || command.type === 'camera.follow_actor' || command.type === 'camera.follow_group'))
    .reduce((latest, command) => Math.max(latest, command.startMs + command.durationMs), 0)

  assert.ok(cameraTail > subtitle.startMs + subtitle.durationMs)
})

test('compiles grounded missile engagements with establishing and supported phase shots', () => {
  const fixture = multiEngagementChoreographyFixture()
  const actorRef = (groupRef: string) => fixture.resolvedScenePlan.resolvedActors
    .find(actor => actor.actorGroupRef === groupRef)!.actorInstanceId
  const firstStrike = actorRef('group:weapon-first-strike')
  const intercept = actorRef('group:weapon-intercept')
  const counterattack = actorRef('group:weapon-counterattack')
  const su30 = actorRef('group:india-su30-adampur')
  const jf17 = actorRef('group:pakistan-jf17-minhas')
  const rafale = actorRef('group:india-rafale-ambala')

  assert.deepEqual(fixture.choreographyPlan.weaponEngagements.map(engagement => ({
    launcherRef: engagement.launcherRef,
    weaponRef: engagement.weaponRef,
    targetRef: engagement.targetRef,
    outcome: engagement.outcome,
    evidenceRefs: engagement.evidenceRefs,
  })), [
    { launcherRef: su30, weaponRef: firstStrike, targetRef: jf17, outcome: 'intercepted', evidenceRefs: ['ev-first-strike'] },
    { launcherRef: jf17, weaponRef: intercept, targetRef: firstStrike, outcome: 'interception', evidenceRefs: ['ev-intercept'] },
    { launcherRef: jf17, weaponRef: counterattack, targetRef: rafale, outcome: 'destroyed', evidenceRefs: ['ev-counterattack'] },
  ])

  const phases = ['launch', 'midcourse', 'terminal', 'aftermath'] as const
  const phaseExpectations = [
    ['subtitle-first-strike', su30, firstStrike, jf17],
    ['subtitle-intercept', jf17, intercept, firstStrike],
    ['subtitle-counterattack', jf17, counterattack, rafale],
  ] as const
  for (const [subtitleId, launcherRef, weaponRef, targetRef] of phaseExpectations) {
    const shots = fixture.choreographyPlan.shotPlan.filter(shot => shot.subtitleId === subtitleId)
    const expectedPhases = weaponRef === firstStrike ? phases.slice(0, 2) : phases
    const phaseShots = shots.filter(shot => shot.phase)
    assert.deepEqual(shots.map(shot => shot.phase), [undefined, ...expectedPhases])
    assert.ok(shots.every(shot => shot.startConstraint === `time:${subtitleId}:subtitle-visual-lead`))
    assert.deepEqual(phaseShots.map(shot => shot.subjectRefs), [
      [launcherRef, weaponRef],
      [weaponRef, targetRef],
      ...(weaponRef === firstStrike ? [] : [[weaponRef, targetRef], [targetRef]]),
    ])
    assert.deepEqual(phaseShots.map(shot => shot.visibilityRequirements), [
      [launcherRef, weaponRef],
      [weaponRef, targetRef],
      ...(weaponRef === firstStrike ? [] : [[weaponRef, targetRef], [targetRef]]),
    ])
  }
  for (const subtitleId of ['subtitle-deployment', 'subtitle-summary']) {
    const shots = fixture.choreographyPlan.shotPlan.filter(shot => shot.subtitleId === subtitleId)
    assert.equal(shots.length, 1)
    assert.equal(shots[0]?.phase, undefined)
  }
})

test('compiles the real cross-beat engagement shape from explicit intents', () => {
  const fixture = realCrossBeatEngagementFixture()
  const actorRef = (groupRef: string) => fixture.input.resolvedScenePlan.resolvedActors
    .find(actor => actor.actorGroupRef === groupRef)!.actorInstanceId
  const firstStrike = actorRef('group:weapon-first-strike')
  const intercept = actorRef('group:weapon-intercept')
  const counterattack = actorRef('group:weapon-counterattack')
  const su30 = actorRef('group:india-su30-adampur')
  const jf17 = actorRef('group:pakistan-jf17-minhas')
  const rafale = actorRef('group:india-rafale-ambala')
  const choreography = fixture.input.choreographyPlan
  const actors = fixture.input.resolvedScenePlan.resolvedActors
  const groupRoles = new Map(fixture.input.sceneBlueprint.actorGroups.map(group => [group.groupId, group.role]))

  assert.equal(actors.length, 15)
  assert.equal(actors.filter(actor => groupRoles.get(actor.actorGroupRef) !== 'weapon-launch').length, 12)
  assert.equal(actors.filter(actor => groupRoles.get(actor.actorGroupRef) === 'weapon-launch').length, 3)
  assert.deepEqual(
    fixture.input.sceneBlueprint.actorGroups.filter(group => group.role === 'early-warning-support').map(group => group.groupId),
    ['group:india-netra-awacs', 'group:pakistan-awacs-proxy'],
  )
  assert.equal(new Set(fixture.input.resolvedScenePlan.actorRouteAssignments
    .map(assignment => assignment.trajectoryAssetRef)).size, 15)

  assert.deepEqual(choreography.weaponEngagements.map(engagement => ({
    launcherRef: engagement.launcherRef,
    weaponRef: engagement.weaponRef,
    targetRef: engagement.targetRef,
    outcome: engagement.outcome,
  })), [
    { launcherRef: su30, weaponRef: firstStrike, targetRef: jf17, outcome: 'intercepted' },
    { launcherRef: jf17, weaponRef: intercept, targetRef: firstStrike, outcome: 'interception' },
    { launcherRef: jf17, weaponRef: counterattack, targetRef: rafale, outcome: 'destroyed' },
  ])
  assert.equal(choreography.relationSegments.filter(relation => relation.linkKind === 'fighter-missile').length, 3)
  for (const subtitleId of ['subtitle-first-strike', 'subtitle-intercept', 'subtitle-counterattack']) {
    const firstStrikePhases = subtitleId === 'subtitle-first-strike'
      ? ['launch', 'midcourse']
      : ['launch', 'midcourse', 'terminal', 'aftermath']
    assert.deepEqual(
      choreography.shotPlan.filter(shot => shot.subtitleId === subtitleId).map(shot => shot.phase),
      [undefined, ...firstStrikePhases],
    )
  }

  const plan = compileFinalScene(fixture.input)
  const impactVideos = plan.commands.filter(command => command.type === 'video.play'
    && command.params.assetId === 'video:missile-impact')
  assert.equal(impactVideos.length, 2)
  assert.ok(impactVideos.some(command => command.evidenceRefs.includes('ev-intercept')))
  assert.ok(impactVideos.some(command => command.evidenceRefs.includes('ev-counterattack')))
  const destroyedStates = plan.commands.filter(command => command.type === 'model.set_state'
    && command.params.state === 'destroyed')
  assert.deepEqual(destroyedStates.map(command => command.targetId), [rafale])
})

test('uses reviewed first-strike group references regardless of scene fact wording', () => {
  const fixture = multiEngagementChoreographyFixture()
  fixture.sceneBlueprint.sceneBeats = fixture.sceneBlueprint.sceneBeats.map(beat => beat.sceneBeatId === 'scene-beat-first-strike'
    ? {
        ...beat,
        actorRefs: ['group:weapon-first-strike', 'group:india-su30-adampur'],
        requiredFacts: ['Pakistan reports Indian fighters.'],
      }
    : beat)
  fixture.resolvedScenePlan.sourceBlueprintFingerprint = fingerprint(fixture.sceneBlueprint)

  const choreography = compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan: fixture.resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  })

  assert.equal(choreography.weaponEngagements.some(engagement =>
    engagement.sceneBeatRef === 'scene-beat-first-strike'), true)
})

test('does not parse first-strike target identity from required facts', () => {
  const requiredFacts = [
    'The AWACS tracks Pakistani fighters.',
    'The AWACS tracks Pakistani aircraft.',
    "The AWACS tracks Pakistan's fighters.",
    "The AWACS tracks Pakistan's aircraft.",
    'The AWACS tracks fighters of Pakistan.',
    'The AWACS tracks aircraft of Pakistan.',
    '\u5370\u65b9\u9884\u8b66\u673a\u8ddf\u8e2a\u5df4\u65b9\u6218\u673a\u3002',
    '\u5370\u65b9\u9884\u8b66\u673a\u8ddf\u8e2a\u5df4\u65b9\u98de\u673a\u3002',
  ]
  for (const requiredFact of requiredFacts) {
    const fixture = multiEngagementChoreographyFixture()
    fixture.sceneBlueprint.sceneBeats = fixture.sceneBlueprint.sceneBeats.map(beat => beat.sceneBeatId === 'scene-beat-first-strike'
      ? {
          ...beat,
          actorRefs: ['group:weapon-first-strike', 'group:india-su30-adampur'],
          requiredFacts: [requiredFact],
        }
      : beat)
    fixture.resolvedScenePlan.sourceBlueprintFingerprint = fingerprint(fixture.sceneBlueprint)

    const choreography = compileChoreography({
      narrationPlan: fixture.narrationPlan,
      sceneBlueprint: fixture.sceneBlueprint,
      resolvedScenePlan: fixture.resolvedScenePlan,
      assetRegistry: fixture.assetRegistry,
    })

    assert.equal(choreography.weaponEngagements.some(engagement =>
      engagement.sceneBeatRef === 'scene-beat-first-strike'), true, requiredFact)
  }
})

test('uses reviewed interception group references regardless of scene fact wording', () => {
  const fixture = multiEngagementChoreographyFixture()
  fixture.sceneBlueprint.sceneBeats = fixture.sceneBlueprint.sceneBeats.map(beat => beat.sceneBeatId === 'scene-beat-intercept'
    ? {
        ...beat,
        actorRefs: ['group:weapon-intercept', 'group:pakistan-jf17-minhas'],
        requiredFacts: ['An incoming Pakistani missile threatens an Indian aircraft.'],
      }
    : beat)
  fixture.resolvedScenePlan.sourceBlueprintFingerprint = fingerprint(fixture.sceneBlueprint)

  const choreography = compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan: fixture.resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  })

  assert.equal(choreography.weaponEngagements.some(engagement =>
    engagement.sceneBeatRef === 'scene-beat-intercept'), true)
})

test('does not parse interception target identity from required facts', () => {
  const requiredFacts = [
    'JF-17 intercepts the incoming Indian missile.',
    'JF-17 intercepts the Indian incoming missile.',
    'JF-17 intercepts the Indian first-strike missile.',
    'JF-17 intercepts the first-strike Indian missile.',
    '\u5df4\u65b9 JF-17 \u62e6\u622a\u5370\u65b9\u6765\u88ad\u5bfc\u5f39\u3002',
  ]
  for (const requiredFact of requiredFacts) {
    const fixture = multiEngagementChoreographyFixture()
    fixture.sceneBlueprint.sceneBeats = fixture.sceneBlueprint.sceneBeats.map(beat => beat.sceneBeatId === 'scene-beat-intercept'
      ? {
          ...beat,
          actorRefs: ['group:weapon-intercept', 'group:pakistan-jf17-minhas'],
          requiredFacts: [requiredFact],
        }
      : beat)
    fixture.resolvedScenePlan.sourceBlueprintFingerprint = fingerprint(fixture.sceneBlueprint)

    const choreography = compileChoreography({
      narrationPlan: fixture.narrationPlan,
      sceneBlueprint: fixture.sceneBlueprint,
      resolvedScenePlan: fixture.resolvedScenePlan,
      assetRegistry: fixture.assetRegistry,
    })

    assert.equal(choreography.weaponEngagements.some(engagement =>
      engagement.sceneBeatRef === 'scene-beat-intercept'), true, requiredFact)
  }
})

test('keeps reviewed counterattack outcomes unconfirmed regardless of scene text', () => {
  const cases = [
    {
      requiredFacts: ['JF-17 counterattacks the Rafale and drives it off.'],
      forbiddenClaims: [],
    },
    {
      requiredFacts: ['JF-17 counterattacks the Rafale and destroys it.'],
      forbiddenClaims: ['confirmed destruction'],
    },
    {
      requiredFacts: ['JF-17 counterattacks the Rafale and destroys it.'],
      forbiddenClaims: ['confirmed outcome'],
    },
    {
      requiredFacts: ['JF-17 counterattacks the Rafale and destroys it.'],
      forbiddenClaims: ['confirmed target destruction'],
    },
    {
      requiredFacts: ['JF-17 counterattacks the Rafale and destroys it.'],
      forbiddenClaims: ['确认战果'],
    },
  ]
  for (const { requiredFacts, forbiddenClaims } of cases) {
    const fixture = multiEngagementChoreographyFixture()
    fixture.sceneBlueprint.engagementIntents = fixture.sceneBlueprint.engagementIntents.map(intent =>
      intent.engagementIntentId === 'intent:counterattack'
        ? { ...intent, assertedOutcome: 'unconfirmed' }
        : intent)
    fixture.sceneBlueprint.sceneBeats = fixture.sceneBlueprint.sceneBeats.map(beat => beat.sceneBeatId === 'scene-beat-counterattack'
      ? { ...beat, requiredFacts, forbiddenClaims }
      : beat)
    fixture.resolvedScenePlan.sourceBlueprintFingerprint = fingerprint(fixture.sceneBlueprint)

    const choreography = compileChoreography({
      narrationPlan: fixture.narrationPlan,
      sceneBlueprint: fixture.sceneBlueprint,
      resolvedScenePlan: fixture.resolvedScenePlan,
      assetRegistry: fixture.assetRegistry,
    })

    assert.equal(
      choreography.weaponEngagements.find(engagement => engagement.sceneBeatRef === 'scene-beat-counterattack')?.outcome,
      'unconfirmed',
    )
  }
})

test('resolves the reviewed target when a counterattack beat omits the target group', () => {
  const fixture = multiEngagementChoreographyFixture()
  fixture.sceneBlueprint.sceneBeats = fixture.sceneBlueprint.sceneBeats.map(beat => beat.sceneBeatId === 'scene-beat-counterattack'
    ? { ...beat, actorRefs: ['group:weapon-counterattack', 'group:pakistan-jf17-minhas'] }
    : beat)
  fixture.resolvedScenePlan.sourceBlueprintFingerprint = fingerprint(fixture.sceneBlueprint)

  const choreography = compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan: fixture.resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  })

  assert.equal(
    choreography.weaponEngagements.some(engagement => engagement.sceneBeatRef === 'scene-beat-counterattack'),
    true,
  )
})

test('emits independent engagements and phase shots for every weapon actor in one launch group', () => {
  const fixture = multiEngagementChoreographyFixture()
  const originalActor = fixture.resolvedScenePlan.resolvedActors.find(actor =>
    actor.actorGroupRef === 'group:weapon-counterattack')!
  const originalAssignment = fixture.resolvedScenePlan.actorRouteAssignments.find(assignment =>
    assignment.actorInstanceRef === originalActor.actorInstanceId)!
  const duplicateActor = {
    ...originalActor,
    actorInstanceId: 'actor:weapon-counterattack:wingman-1',
    role: 'wingman' as const,
    ordinal: 1,
  }
  fixture.sceneBlueprint.actorGroups = fixture.sceneBlueprint.actorGroups.map(group => group.groupId === 'group:weapon-counterattack'
    ? { ...group, quantityDecision: { ...group.quantityDecision, value: 2 } }
    : group)
  fixture.resolvedScenePlan = {
    ...fixture.resolvedScenePlan,
    sourceBlueprintFingerprint: fingerprint(fixture.sceneBlueprint),
    resolvedActors: [...fixture.resolvedScenePlan.resolvedActors, duplicateActor],
    actorRouteAssignments: [
      ...fixture.resolvedScenePlan.actorRouteAssignments,
      {
        ...originalAssignment,
        actorInstanceRef: duplicateActor.actorInstanceId,
        trajectoryAssetRef: 'trajectory:ambala-su30mki-1',
        segmentId: `${originalAssignment.segmentId}:wingman-1`,
      },
    ],
  }

  const choreography = compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan: fixture.resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  })
  const engagements = choreography.weaponEngagements.filter(engagement =>
    engagement.sceneBeatRef === 'scene-beat-counterattack')
  const shots = choreography.shotPlan.filter(shot => shot.subtitleId === 'subtitle-counterattack')

  assert.equal(engagements.length, 2)
  assert.equal(new Set(engagements.map(engagement => engagement.weaponRef)).size, 2)
  assert.equal(shots.length, 9)
  assert.equal(new Set(shots.map(shot => shot.shotId)).size, 9)
})

test('the final Indo-Pak compiler emits exact multi-actor choreography with media and subtitle lead', () => {
  const fixture = multiActorCompilerFixture()
  const plan = compileFinalScene(fixture.input)

  assert.equal(canonicalJson(plan), canonicalJson(compileFinalScene(fixture.input)))
  assert.deepEqual(plan.entities.map(entity => entity.entityId), fixture.resolvedScenePlan.resolvedActors.map(actor => actor.actorInstanceId))
  assert.equal(plan.entities.length, 15)
  const firstRoutes = new Set<string>()
  const followTargets = new Set<string>()
  for (const entity of plan.entities) {
    const actor = fixture.resolvedScenePlan.resolvedActors.find(item => item.actorInstanceId === entity.entityId)!
    const group = fixture.sceneBlueprint.actorGroups.find(item => item.groupId === actor.actorGroupRef)!
    const formation = fixture.resolvedScenePlan.resolvedFormationBundles.find(item => item.actorGroupRef === actor.actorGroupRef)!
    const scenario = indoPakTrajectoryScenario.bundles.find(item => item.bundleId === formation.bundleId)!
    assert.equal(entity.modelAssetId, scenario.modelAssetRef)
    assert.equal(entity.kind, group.role.includes('weapon') ? 'missile' : 'aircraft')
    const actorCommands = plan.commands.filter(command => command.targetId === entity.entityId)
    const spawns = actorCommands.filter(command => command.type === 'model.spawn')
    const follows = actorCommands.filter(command => command.type === 'model.follow_path')
    const hides = actorCommands.filter(command => command.type === 'model.hide')
    assert.equal(spawns.length, 1, entity.entityId)
    assert.equal(follows.length, 1, entity.entityId)
    assert.equal(hides.length, 1, entity.entityId)
    const spawn = spawns[0]!
    const follow = follows[0]!
    const hide = hides[0]!
    const lifecycle = fixture.choreographyPlan.actorLifecycles.find(item => item.actorInstanceRef === entity.entityId)!
    const firstBeat = fixture.sceneBlueprint.sceneBeats.find(item => item.sceneBeatId === lifecycle.firstSceneBeatRef)!
    const lastBeat = fixture.sceneBlueprint.sceneBeats.find(item => item.sceneBeatId === lifecycle.lastSceneBeatRef)!
    const firstSubtitle = plan.subtitles.find(item => item.subtitleId === firstBeat.subtitleId)!
    const lastSubtitle = plan.subtitles.find(item => item.subtitleId === lastBeat.subtitleId)!
    const motion = fixture.choreographyPlan.motionSegments.find(item => item.actorInstanceRef === entity.entityId)!
    assert.equal(motion.coverage, 'actor-lifecycle')
    assert.equal(spawn.startMs, firstSubtitle.startMs + 800)
    assert.equal(follow.startMs, spawn.startMs + spawn.durationMs)
    assert.equal(follow.startMs + follow.durationMs, lastSubtitle.startMs + lastSubtitle.durationMs)
    assert.equal(hide.startMs, follow.startMs + follow.durationMs)
    assert.equal(follow.params.entityId, entity.entityId)
    assert.equal(follow.params.trajectoryAssetId, entity.defaultTrajectoryAssetId)
    followTargets.add(follow.targetId)
    firstRoutes.add(follow.params.trajectoryAssetId)
  }
  assert.equal(followTargets.size, plan.entities.length)
  assert.equal(firstRoutes.size, plan.entities.length)
  assert.equal(plan.diagnostics.some(item => item.code === 'TRAJECTORY_SYNTHESIZED'), false)
  assert.equal(fixture.resolvedScenePlan.actorRouteAssignments.some(item => item.sourceKind === 'illustrative'), false)

  const deploymentShot = fixture.choreographyPlan.shotPlan.find(shot => shot.subtitleId === 'subtitle-deployment')!
  const bounds = deploymentShot.subjectRefs.map(actorId => {
    const routeId = fixture.resolvedScenePlan.actorRouteAssignments.find(item => item.actorInstanceRef === actorId)!.trajectoryAssetRef
    const route = fixture.assetRegistry.assets.find(asset => asset.assetId === routeId)
    assert.ok(route?.kind === 'trajectory' && route.trajectory.bounds)
    return route.trajectory.bounds
  })
  const union = [
    [Math.min(...bounds.map(item => item[0][0])), Math.min(...bounds.map(item => item[0][1]))],
    [Math.max(...bounds.map(item => item[1][0])), Math.max(...bounds.map(item => item[1][1]))],
  ] as [[number, number], [number, number]]
  const camera = plan.commands.find(command => command.type === 'camera.transition' && command.eventUnitId === 'unit-deployment')
  if (camera?.type !== 'camera.transition') assert.fail('Expected deployment camera')
  assert.deepEqual(camera.params.center, [(union[0][0] + union[1][0]) / 2, (union[0][1] + union[1][1]) / 2])
  const longitudeSpan = (union[1][0] - union[0][0]) * Math.cos(camera.params.center[1] * Math.PI / 180)
  const expectedZoom = Math.min(11, Math.max(4, Math.log2(360 / (Math.max(
    longitudeSpan,
    union[1][1] - union[0][1],
    0.01,
  ) * 2.5))))
  assert.equal(camera.params.zoom, expectedZoom)

  assert.deepEqual(plan.subtitles.map(item => [item.subtitleId, item.text, item.evidenceRefs]),
    fixture.narrationPlan.beats.map(item => [item.subtitleId, item.text, item.evidenceRefs]))
  assert.equal(plan.totalDurationMs, Math.max(
    ...plan.subtitles.map(item => item.startMs + item.durationMs),
    ...plan.commands.map(item => item.startMs + item.durationMs),
    ...plan.informationCards.map(item => item.startMs + item.durationMs),
  ))
  for (const subtitle of plan.subtitles) {
    assert.ok(plan.commands.filter(command => command.eventUnitId === subtitle.eventUnitId)
      .every(command => command.startMs >= subtitle.startMs + 800))
  }
  assert.ok(plan.commands.some(command => command.type === 'image.show'))
  assert.ok(plan.commands.some(command => command.type === 'video.play'))
  const expectedSources = new Set([
    'accepted-indo-pak', 'narrative-artifact-indo-pak', 'narration-artifact-indo-pak',
    'blueprint-artifact-indo-pak', 'resolved-artifact-indo-pak', 'choreography-artifact-indo-pak',
    'registry-artifact-indo-pak',
  ])
  assert.ok(plan.lineage.every(item => item.sourceArtifactIds.length === expectedSources.size
    && item.sourceArtifactIds.every(id => expectedSources.has(id))))
})

test('planner and scheduler keep exact subtitle duration parity across importance and Han boundaries', () => {
  const source = input()
  source.narrativePlan.sourceEventPlan.fingerprint = fingerprint(source.eventPlan)
  source.narrativePlan.subtitles = [
    { subtitleId: 'subtitle-high', eventUnitId: 'unit-1', text: '\u4e00'.repeat(3), evidenceRefs: ['ev-1'], importance: 'high' },
    { subtitleId: 'subtitle-medium', eventUnitId: 'unit-1', text: '\u4e00'.repeat(16), evidenceRefs: ['ev-1'], importance: 'medium' },
    { subtitleId: 'subtitle-low', eventUnitId: 'unit-1', text: '\u4e00'.repeat(17), evidenceRefs: ['ev-1'], importance: 'low' },
  ]

  const narrationPlan = buildNarrationPlan({
    eventPlan: source.eventPlan,
    narrativePlan: source.narrativePlan,
  })
  const scheduled = scheduleNarrative({
    eventPlan: source.eventPlan,
    narrativePlan: source.narrativePlan,
    commandDrafts: [],
    informationCardDrafts: [],
    capabilities: capabilityManifest,
  })

  assert.deepEqual(
    scheduled.subtitles.map(subtitle => subtitle.durationMs),
    narrationPlan.beats.map(beat => beat.estimatedDurationMs),
  )
  assert.deepEqual(scheduled.subtitles.map(subtitle => subtitle.durationMs), [6_000, 5_000, 5_000])
})

test('actor lifecycle ignores unsubtitled boundary beats and binds the internal subtitled beat', () => {
  const fixture = multiActorCompilerFixture()
  const launchBeat = fixture.sceneBlueprint.sceneBeats.find(beat => beat.sceneBeatId === 'scene-beat-launch')!
  const { subtitleId: _subtitleId, ...unsubtitledLaunchBeat } = launchBeat
  fixture.sceneBlueprint.sceneBeats = [
    {
      ...unsubtitledLaunchBeat,
      sceneBeatId: 'scene-beat-launch-before-subtitle',
      purpose: 'Prepare the launch actor before narration',
    },
    ...fixture.sceneBlueprint.sceneBeats,
    {
      ...unsubtitledLaunchBeat,
      sceneBeatId: 'scene-beat-launch-after-subtitle',
      purpose: 'Retain the launch actor after narration',
    },
  ]
  fixture.resolvedScenePlan.sourceBlueprintFingerprint = fingerprint(fixture.sceneBlueprint)
  const choreographyPlan = compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan: fixture.resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  })
  fixture.choreographyPlan = choreographyPlan
  fixture.input.choreographyPlan = choreographyPlan

  const missile = fixture.resolvedScenePlan.resolvedActors.find(actor =>
    actor.actorGroupRef === 'group:weapon-unit-launch')!
  const lifecycle = choreographyPlan.actorLifecycles.find(item => item.actorInstanceRef === missile.actorInstanceId)!
  assert.equal(lifecycle.firstSceneBeatRef, launchBeat.sceneBeatId)
  assert.equal(lifecycle.lastSceneBeatRef, launchBeat.sceneBeatId)
  assert.ok(compileFinalScene(fixture.input).commands.some(command =>
    command.type === 'model.follow_path' && command.targetId === missile.actorInstanceId))

  fixture.sceneBlueprint.sceneBeats = fixture.sceneBlueprint.sceneBeats.map(beat => {
    if (!beat.actorRefs.includes(missile.actorGroupRef)) return beat
    const { subtitleId: _boundSubtitleId, ...unsubtitledBeat } = beat
    return unsubtitledBeat
  })
  fixture.resolvedScenePlan.sourceBlueprintFingerprint = fingerprint(fixture.sceneBlueprint)
  assert.throws(() => compileChoreography({
    narrationPlan: fixture.narrationPlan,
    sceneBlueprint: fixture.sceneBlueprint,
    resolvedScenePlan: fixture.resolvedScenePlan,
    assetRegistry: fixture.assetRegistry,
  }), (error: unknown) => error instanceof CompilationError
    && error.diagnostics.some(item => item.code === 'ACTOR_SCENE_BEAT_UNBOUND'))
})

test('final compiler reports the stable conflict when an actor lifecycle cannot fit the minimum follow duration', () => {
  const fixture = multiActorCompilerFixture()
  fixture.narrationPlan.beats.find(beat => beat.subtitleId === 'subtitle-launch')!.estimatedDurationMs = 5_000
  fixture.sceneBlueprint.sourceNarrationFingerprint = fingerprint(fixture.narrationPlan)
  fixture.resolvedScenePlan.sourceBlueprintFingerprint = fingerprint(fixture.sceneBlueprint)
  fixture.choreographyPlan.sourceResolvedScenePlanFingerprint = fingerprint(fixture.resolvedScenePlan)

  assert.throws(() => compileFinalScene(fixture.input), (error: unknown) =>
    error instanceof CompilationError
    && error.diagnostics.some(item => item.code === 'NARRATION_VISUAL_DURATION_CONFLICT'))
})

test('final compiler honors a blueprint image intent when the narrative template is withdrawal', () => {
  const fixture = multiActorCompilerFixture()
  fixture.narrativePlan.sceneRequirements.at(-1)!.preferredTemplate = 'withdrawal'

  const imageCommands = compileFinalScene(fixture.input).commands.filter(command => command.type === 'image.show')

  assert.equal(imageCommands.length, 1)
  assert.equal(imageCommands[0]!.params.assetId, 'image:summary')
})

test('final compiler selects the registered deployment illustration from a multi-media catalog', () => {
  const fixture = multiActorCompilerFixture()
  const sourceImage = fixture.assetRegistry.assets.find(asset => asset.assetId === 'image:summary')!
  if (sourceImage.kind !== 'image') assert.fail('Expected image fixture')
  fixture.assetRegistry.assets.push(
    { ...sourceImage, assetId: 'image:aew-illustration', displayName: 'AWACS illustration', aliases: [] },
    { ...sourceImage, assetId: 'image:airport', displayName: 'Airport', aliases: [] },
  )
  fixture.sceneBlueprint.sceneBeats = fixture.sceneBlueprint.sceneBeats.map(beat =>
    beat.sceneBeatId === 'scene-beat-deployment' ? { ...beat, mediaIntents: ['image'] } : beat)

  const plan = compileFinalScene(refreshFinalChoreographyFixture(fixture))
  const deploymentImage = plan.commands.find(command =>
    command.type === 'image.show' && command.eventUnitId === 'unit-deployment')

  assert.equal(deploymentImage?.type, 'image.show')
  if (deploymentImage?.type !== 'image.show') assert.fail('Expected deployment image')
  assert.equal(deploymentImage.params.assetId, 'image:aew-illustration')
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

test('withdrawal hides the model only after its follow path completes', () => {
  const plan = compileScene(input('withdrawal'))
  const spawn = plan.commands.find(command => command.type === 'model.spawn')
  const follow = plan.commands.find(command => command.type === 'model.follow_path')
  const hide = plan.commands.find(command => command.type === 'model.hide')

  assert.ok(spawn)
  assert.ok(follow)
  assert.ok(hide)
  assert.ok(follow.startMs >= spawn.startMs + spawn.durationMs)
  assert.ok(hide.startMs >= follow.startMs + follow.durationMs)
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

test('generic entities stay unbound when multiple aircraft models exist', () => {
  const compilerInput = input('deployment')
  const original = compilerInput.assetRegistry.assets.find(asset => asset.kind === 'model')!
  compilerInput.assetRegistry.assets.push(cloneAsset(original, {
    assetId: 'model:rafale', displayName: 'Rafale', aliases: ['阵风'],
  }))
  compilerInput.narrativePlan.sceneRequirements[0]!.focusEntities.push('airborne early warning')

  const plan = compileScene(compilerInput)
  assert.equal(plan.entities.find(entity => entity.displayName === 'JF-17')?.modelAssetId, 'model:jf17')
  assert.equal(plan.entities.find(entity => entity.displayName === 'airborne early warning')?.modelAssetId, undefined)
  assert.equal(plan.entities.find(entity => entity.displayName === 'airborne early warning')?.kind, 'other')
})

test('registered model aliases match entity names with contextual prefixes', () => {
  const compilerInput = input('status_explanation')
  const model = compilerInput.assetRegistry.assets.find(asset => asset.kind === 'model')!
  model.aliases = ['JF-17 formation']
  compilerInput.narrativePlan.sceneRequirements[0]!.focusEntities = ['blue JF-17 formation']

  const entity = compileScene(compilerInput).entities.find(item => item.displayName === 'blue JF-17 formation')
  assert.equal(entity?.modelAssetId, 'model:jf17')
})

test('movement templates target the first focus entity with a registered model', () => {
  const compilerInput = input('deployment')
  compilerInput.narrativePlan.sceneRequirements[0]!.focusEntities = ['airborne early warning', 'JF-17']

  const plan = compileScene(compilerInput)
  const follow = plan.commands.find(command => command.type === 'model.follow_path')
  assert.equal(follow?.targetId, plan.entities.find(entity => entity.displayName === 'JF-17')?.entityId)
})

test('state templates do not emit model commands for entities without a model asset', () => {
  for (const template of ['attack_chain', 'electronic_warfare'] as const) {
    const compilerInput = input(template)
    compilerInput.narrativePlan.sceneRequirements[0]!.focusEntities = ['unmodeled command entity']

    const plan = compileScene(compilerInput)
    const unmodeled = plan.entities.find(entity => entity.displayName === 'unmodeled command entity')

    assert.ok(unmodeled)
    assert.equal(unmodeled.modelAssetId, undefined)
    assert.equal(
      plan.commands.some(command => command.targetId === unmodeled.entityId && command.type.startsWith('model.')),
      false,
    )
  }
})

test('non-ASCII entity names receive distinct stable runtime IDs', () => {
  const compilerInput = input('status_explanation')
  compilerInput.narrativePlan.sceneRequirements[0]!.focusEntities = ['预警机', '地面雷达']

  const first = compileScene(compilerInput).entities
  const second = compileScene(compilerInput).entities
  assert.equal(new Set(first.map(entity => entity.entityId)).size, 2)
  assert.deepEqual(first.map(entity => entity.entityId), second.map(entity => entity.entityId))
  assert.ok(first.every(entity => entity.entityId.startsWith('entity:other-')))
})

test('mixed-script entity names with the same ASCII core remain distinct', () => {
  const compilerInput = input('status_explanation')
  compilerInput.narrativePlan.sceneRequirements[0]!.focusEntities = ['苏-30MKI', '印方苏-30MKI编队']

  const entities = compileScene(compilerInput).entities
  assert.equal(new Set(entities.map(entity => entity.entityId)).size, 2)
  assert.ok(entities.every(entity => /^entity:30mki-[0-9a-f]{12}$/.test(entity.entityId)))
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

test('camera center follows the bounds of the selected trajectory', () => {
  const ambalaInput = input('deployment')
  const minhasInput = input('deployment')
  const original = minhasInput.assetRegistry.assets.find(asset => asset.kind === 'trajectory')!
  if (original.kind !== 'trajectory') assert.fail('Expected trajectory')
  minhasInput.assetRegistry.assets.push(cloneAsset(original, {
    assetId: 'trajectory:minhas',
    displayName: 'Minhas route',
    aliases: ['selected Minhas route'],
    trajectory: {
      ...original.trajectory,
      bounds: [[71.8424174764746, 31.4704662866473], [74.3300338060499, 33.8839897314659]],
    },
  }))
  minhasInput.narrativePlan.sceneRequirements[0]!.motionRequirements = ['selected Minhas route']

  const ambalaCamera = compileScene(ambalaInput).commands.find(command => command.type === 'camera.transition')
  const minhasCamera = compileScene(minhasInput).commands.find(command => command.type === 'camera.transition')

  assert.ok(ambalaCamera)
  assert.ok(minhasCamera)
  assert.deepEqual(ambalaCamera.params.center.map(value => Number(value.toFixed(3))), [75.710, 30.559])
  assert.deepEqual(minhasCamera.params.center.map(value => Number(value.toFixed(3))), [73.086, 32.677])
  assert.notDeepEqual(ambalaCamera.params.center, minhasCamera.params.center)
})

test('counterattack camera is perceptibly tighter and more dynamic than the preceding phase', () => {
  const compilerInput = input('interception')
  compilerInput.narrativePlan.sceneRequirements.push({
    ...compilerInput.narrativePlan.sceneRequirements[0]!,
    requirementId: 'requirement-counterattack',
    preferredTemplate: 'counterattack',
    stateChanges: ['counterattack'],
  })

  const cameras = compileScene(compilerInput).commands.filter(command => command.type === 'camera.transition')
  assert.equal(cameras.length, 2)
  assert.ok(cameras[1]!.params.zoom - cameras[0]!.params.zoom >= 0.75)
  assert.ok(Math.abs(cameras[1]!.params.bearing - cameras[0]!.params.bearing) >= 20)
  assert.ok(Math.abs(cameras[1]!.params.pitch - cameras[0]!.params.pitch) >= 10)
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

test('requirement aliases select one trajectory from multiple available candidates', () => {
  const compilerInput = input('deployment')
  const original = compilerInput.assetRegistry.assets.find(asset => asset.kind === 'trajectory')!
  compilerInput.assetRegistry.assets.push(cloneAsset(original, {
    assetId: 'trajectory:zzz-alternate', displayName: 'Alternate route', aliases: ['alternate registered route'],
  }))
  compilerInput.narrativePlan.sceneRequirements[0]!.motionRequirements = ['alternate registered route']
  const follow = compileScene(compilerInput).commands.find(command => command.type === 'model.follow_path')
  assert.equal(follow?.params.action === 'model.follow_path' ? follow.params.trajectoryAssetId : undefined, 'trajectory:zzz-alternate')
})

test('focus entity asset aliases take priority over lower-level semantic matches', () => {
  const compilerInput = input('deployment')
  const original = compilerInput.assetRegistry.assets.find(asset => asset.kind === 'trajectory')!
  original.aliases = ['JF-17 route']
  compilerInput.assetRegistry.assets.push(cloneAsset(original, {
    assetId: 'trajectory:alternate', displayName: 'Alternate route', aliases: ['alternate registered route'],
  }))
  compilerInput.narrativePlan.sceneRequirements[0]!.motionRequirements = ['alternate registered route']

  const follow = compileScene(compilerInput).commands.find(command => command.type === 'model.follow_path')
  assert.equal(follow?.params.action === 'model.follow_path' ? follow.params.trajectoryAssetId : undefined, 'trajectory:jf17-1')
})

test('ordered focus entities select the first available compatible trajectory', () => {
  const compilerInput = input('deployment')
  const original = compilerInput.assetRegistry.assets.find(asset => asset.kind === 'trajectory')!
  original.aliases = ['JF-17 route']
  compilerInput.assetRegistry.assets.push(cloneAsset(original, {
    assetId: 'trajectory:wingman', displayName: 'Wingman route', aliases: ['wingman aircraft route'],
  }))
  compilerInput.narrativePlan.sceneRequirements[0]!.focusEntities = ['JF-17', 'wingman aircraft']

  const follow = compileScene(compilerInput).commands.find(command => command.type === 'model.follow_path')
  assert.equal(follow?.params.action === 'model.follow_path' ? follow.params.trajectoryAssetId : undefined, 'trajectory:jf17-1')
})

test('trajectory aliases match prefixed entity names without their type suffix', () => {
  const compilerInput = input('deployment')
  const original = compilerInput.assetRegistry.assets.find(asset => asset.kind === 'trajectory')!
  original.aliases = ['苏-30MKI编队航迹']
  compilerInput.assetRegistry.assets.push(cloneAsset(original, {
    assetId: 'trajectory:alternate', displayName: 'Alternate route', aliases: [],
  }))
  compilerInput.narrativePlan.sceneRequirements[0]!.focusEntities = ['印方苏-30MKI编队', 'JF-17']

  const follow = compileScene(compilerInput).commands.find(command => command.type === 'model.follow_path')
  assert.equal(follow?.params.action === 'model.follow_path' ? follow.params.trajectoryAssetId : undefined, 'trajectory:jf17-1')
})

test('a missing first trajectory does not hide the only available candidate', () => {
  const compilerInput = input('deployment', 'missing')
  const original = compilerInput.assetRegistry.assets.find(asset => asset.kind === 'trajectory')!
  compilerInput.assetRegistry.assets.push(cloneAsset(original, {
    assetId: 'trajectory:available', displayName: 'Available route', availability: 'available',
  }))
  const follow = compileScene(compilerInput).commands.find(command => command.type === 'model.follow_path')
  assert.equal(follow?.params.action === 'model.follow_path' ? follow.params.trajectoryAssetId : undefined, 'trajectory:available')
})

test('ambiguous trajectory candidates fail instead of choosing lexicographically', () => {
  const compilerInput = input('deployment')
  const original = compilerInput.assetRegistry.assets.find(asset => asset.kind === 'trajectory')!
  compilerInput.assetRegistry.assets.push(cloneAsset(original, {
    assetId: 'trajectory:alternate', displayName: 'Alternate route', aliases: [],
  }))
  assert.throws(() => compileScene(compilerInput), (error: unknown) =>
    error instanceof CompilationError && error.diagnostics.some(item => item.code === 'ASSET_SELECTION_AMBIGUOUS'))
})

test('requirement aliases select image and video assets and reject ambiguity', () => {
  for (const testCase of [
    { template: 'return_and_summary' as const, kind: 'image' as const, requirementField: 'attentionRequirements' as const, alias: 'mission summary panel', command: 'image.show' },
    { template: 'attack_chain' as const, kind: 'video' as const, requirementField: 'attentionRequirements' as const, alias: 'engagement clip', command: 'video.play' },
  ]) {
    const compilerInput = input(testCase.template)
    const original = compilerInput.assetRegistry.assets.find(asset => asset.kind === testCase.kind)!
    compilerInput.assetRegistry.assets.push(cloneAsset(original, {
      assetId: `${testCase.kind}:zzz-alternate`, displayName: `Alternate ${testCase.kind}`, aliases: [testCase.alias],
    }))
    compilerInput.narrativePlan.sceneRequirements[0]![testCase.requirementField] = [testCase.alias]
    const selected = compileScene(compilerInput).commands.find(command => command.type === testCase.command)
    assert.equal(selected && 'assetId' in selected.params ? selected.params.assetId : undefined, `${testCase.kind}:zzz-alternate`)

    compilerInput.narrativePlan.sceneRequirements[0]![testCase.requirementField] = ['no exact alias']
    assert.throws(() => compileScene(compilerInput), (error: unknown) =>
      error instanceof CompilationError && error.diagnostics.some(item => item.code === 'ASSET_SELECTION_AMBIGUOUS'))
  }
})

test('status explanation emits an image command when a semantic image alias matches', () => {
  const compilerInput = input('status_explanation')
  const image = compilerInput.assetRegistry.assets.find(asset => asset.kind === 'image')!
  image.aliases = ['status illustration']
  compilerInput.narrativePlan.sceneRequirements[0]!.attentionRequirements = ['status illustration']

  const command = compileScene(compilerInput).commands.find(item => item.type === 'image.show')
  assert.equal(command && 'assetId' in command.params ? command.params.assetId : undefined, 'image:summary')
})

function compilerToolFixture() {
  const source = input()
  source.eventPlan.eventUnits[0]!.locationRefs = ['Minhas']
  source.eventPlan.eventUnits[0]!.worldStateChange = 'Four JF-17 fighters departed Minhas'
  source.narrativePlan.sceneRequirements[0]!.spatialRelations = ['Minhas']
  source.narrativePlan.sceneRequirements[0]!.requiredFacts = ['Four JF-17 fighters departed Minhas']
  const minhasBundle = indoPakTrajectoryScenario.bundles.find(bundle => bundle.bundleId === 'formation:pakistan-jf17-minhas')!
  const model = source.assetRegistry.assets.find(asset => asset.kind === 'model')!
  source.assetRegistry.assets = [
    model,
    ...minhasBundle.routeAssetRefs.map((assetId, index): AssetRegistryEntry => ({
      assetId, kind: 'trajectory', displayName: assetId, aliases: [],
      fingerprint: `sha256:${(index + 11).toString(16).padStart(64, '0')}`, size: 10,
      availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
      mediaType: 'application/vnd.ise.trajectory+json',
      trajectory: {
        format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt',
        startTimeMs: 0, endTimeMs: 180_000, monotonic: true,
        bounds: [[72 + index * 0.1, 31], [72.5 + index * 0.1, 31.5]],
      },
    })),
  ]
  const acceptedFingerprint = fingerprint(source.eventPlan)
  source.narrativePlan.sourceEventPlan.fingerprint = acceptedFingerprint
  const artifacts = new ArtifactStore()
  artifacts.createMany([
    {
      id: source.eventPlanArtifactId,
      type: EVENT_PLAN_ACCEPTED_ARTIFACT,
      createdBy: 'user',
      data: source.eventPlan,
      metadata: { fingerprint: acceptedFingerprint },
    },
    {
      id: 'evidence-1',
      type: EVIDENCE_IR_ARTIFACT,
      createdBy: 'tool',
      data: {
        schemaVersion: 'evidence-ir/v1',
        documentId: source.eventPlan.documentId,
        records: [{
          evidenceId: 'ev-1',
          sourceRef: 'docx:p1',
          claim: '4 JF-17 fighters departed Minhas.',
          kind: 'explicit_fact',
          entities: ['JF-17', 'Minhas'],
          locationExpression: 'Minhas',
          confidence: 1,
          ambiguities: [],
        }],
      },
    },
    {
      id: 'narrative-artifact-1',
      type: NARRATIVE_PLAN_ARTIFACT,
      createdBy: 'agent',
      data: source.narrativePlan,
    },
    {
      id: 'registry-artifact-1',
      type: ASSET_REGISTRY_ARTIFACT,
      createdBy: 'tool',
      data: source.assetRegistry,
    },
  ])
  const context: AgentContext = {
    workspace: process.cwd(),
    artifacts,
    domainState: new DomainStateStore(),
    goal: {
      objective: 'compile fixture', status: 'active', turnCount: 0, maxTurns: 1,
      evidence: [], remainingIssues: [], startedAt: new Date(0).toISOString(),
    },
  }
  const compile = createCompilerTools()[0]!
  const compileInput = {
    eventPlanArtifactId: source.eventPlanArtifactId,
    evidenceArtifactId: 'evidence-1',
    narrativePlanArtifactId: 'narrative-artifact-1',
    assetRegistryArtifactId: 'registry-artifact-1',
    capabilityManifestVersion: 'ise-capabilities/v1',
    assetRegistryVersion: source.assetRegistry.registryVersion,
  }
  return { compile, compileInput, context }
}

test('compiler tool requires the exact EvidenceIR artifact ID', async () => {
  const { compile, compileInput, context } = compilerToolFixture()
  const { evidenceArtifactId: _omitted, ...withoutEvidence } = compileInput

  await assert.rejects(() => compile.execute(withoutEvidence, context))
})

test('compiler tool returns resolved planning artifacts in dependency order with compiled lineage IDs', async () => {
  const { compile, compileInput, context } = compilerToolFixture()
  const result = await compile.execute(compileInput, context)

  assert.deepEqual(result.artifacts?.map(artifact => artifact.type), [
    NARRATION_PLAN_ARTIFACT,
    SCENE_BLUEPRINT_ARTIFACT,
    RESOLVED_SCENE_PLAN_ARTIFACT,
    CHOREOGRAPHY_PLAN_ARTIFACT,
    COMPILED_RUNTIME_ARTIFACT,
  ])
  const [narration, blueprint, resolved, choreography, compiled] = result.artifacts!
  assert.ok(compiled)
  assert.equal(compiled.metadata?.narrationPlanArtifactId, narration!.id)
  assert.equal(compiled.metadata?.sceneBlueprintArtifactId, blueprint!.id)
  assert.equal(compiled.metadata?.resolvedScenePlanArtifactId, resolved!.id)
  assert.equal(choreography?.metadata?.resolvedScenePlanArtifactId, resolved!.id)
  assert.equal(compiled.metadata?.choreographyPlanArtifactId, choreography!.id)
})
