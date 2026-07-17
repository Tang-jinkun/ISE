import assert from 'node:assert/strict'
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
  const routeEntries: AssetRegistryEntry[] = routeIds.map((assetId, index) => ({
    assetId, kind: 'trajectory', displayName: assetId, aliases: [],
    fingerprint: `sha256:${(index + 1).toString(16).padStart(64, '0')}`, size: 10,
    availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
    mediaType: 'application/vnd.ise.trajectory+json',
    trajectory: {
      format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt',
      startTimeMs: 0, endTimeMs: 180_000, monotonic: true,
      bounds: [[70 + index * 0.1, 28 + index * 0.05], [70.5 + index * 0.1, 28.4 + index * 0.05]],
    },
  }))
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
    estimatedDurationMs: 6_000,
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
    assert.equal(cameras.length, 4)
    assert.equal(cameras[0]?.startMs, subtitle.startMs + 800)
    assert.ok(cameras[2]!.params.zoom > cameras[0]!.params.zoom)
    assert.ok(cameras.every(command => command.startMs + command.durationMs <= subtitle.startMs + subtitle.durationMs))
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

test('final compiler rejects an engagement subtitle too short for its four phase cameras', () => {
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

  assert.throws(() => compileFinalScene(fixture.input), (error: unknown) =>
    error instanceof CompilationError
    && error.diagnostics.some(item => item.code === 'NARRATION_VISUAL_DURATION_CONFLICT'))
})

test('compiles grounded missile engagements and four ordered phase shots', () => {
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
    assert.deepEqual(shots.map(shot => shot.phase), phases)
    assert.ok(shots.every(shot => shot.startConstraint === `time:${subtitleId}:subtitle-visual-lead`))
    assert.deepEqual(shots.map(shot => shot.subjectRefs), [
      [launcherRef, weaponRef],
      [weaponRef, targetRef],
      [weaponRef, targetRef],
      [targetRef],
    ])
    assert.deepEqual(shots.map(shot => shot.visibilityRequirements), [
      [launcherRef, weaponRef],
      [weaponRef, targetRef],
      [weaponRef, targetRef],
      [targetRef],
    ])
  }
  for (const subtitleId of ['subtitle-deployment', 'subtitle-summary']) {
    const shots = fixture.choreographyPlan.shotPlan.filter(shot => shot.subtitleId === subtitleId)
    assert.equal(shots.length, 1)
    assert.equal(shots[0]?.phase, undefined)
  }
})

test('keeps counterattack outcomes unconfirmed without grounded and allowed destruction facts', () => {
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

test('does not borrow global fighter actors when a counterattack beat omits its Rafale target', () => {
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
    false,
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
  assert.equal(shots.length, 8)
  assert.equal(new Set(shots.map(shot => shot.shotId)).size, 8)
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
