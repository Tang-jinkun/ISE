import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { BaseRuntimeAdapter } from '../src/adapters/baseRuntimeAdapter.ts'
import { compileChoreography } from '../src/compiler/choreographyCompiler.ts'
import { compileScene } from '../src/compiler/sceneCompiler.ts'
import type { AssetRegistrySnapshot } from '../src/contracts/assetRegistry.ts'
import { canonicalRuntimePlanSchema } from '../src/contracts/runtimePlan.ts'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import type { NarrativePlan } from '../src/contracts/narrativePlan.ts'
import { buildNarrationPlan } from '../src/planning/narrationPlanner.ts'
import { resolveSceneBlueprint } from '../src/planning/resolveSceneBlueprint.ts'
import { buildSceneBlueprint } from '../src/planning/sceneBlueprintPlanner.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { parseBattleReport } from '../src/services/documentParser.ts'
import { sceneProjectConfigSchema } from '@ise/runtime-contracts'

const fixture = new URL('./fixtures/cross-document-air-rescue-report.docx', import.meta.url)
const hash = `sha256:${'a'.repeat(64)}`

function assetRegistry(): AssetRegistrySnapshot {
  return {
    schemaVersion: 'asset-registry/v1',
    registryVersion: hash,
    assets: [
      {
        assetId: 'model:generic-aircraft', kind: 'model', displayName: 'Generic aircraft', aliases: ['aircraft', 'formation', 'interceptor', 'sensor'],
        fingerprint: hash, size: 1, availability: 'available', criticality: 'required', fallbackAssetIds: [], allowFallback: false,
        mediaType: 'model/gltf-binary', model: { scale: 1, rotationOffsetDeg: [0, 0, 0], altitudeOffsetM: 0, entityTypes: ['aircraft', 'other'] },
      },
      {
        assetId: 'image:rescue-map', kind: 'image', displayName: 'Rescue map', aliases: ['rescue', 'summary', 'map'],
        fingerprint: hash, size: 1, availability: 'available', criticality: 'optional', fallbackAssetIds: [], allowFallback: false,
        mediaType: 'image/png', image: { width: 1280, height: 720, fit: 'contain' },
      },
    ],
    diagnostics: [],
  }
}

test('a second real DOCX compiles to grounded static markers without fabricated interactions', async () => {
  const parsed = await parseBattleReport(await readFile(fixture))
  const factual = parsed.evidence.records.filter(record => /^08:\d{2}/u.test(record.claim))
  assert.equal(factual.length, 4)
  assert.ok(factual.every(record => record.locationExpression?.startsWith('coordinates:')))

  const participantSets = [
    ['Falcon'],
    ['Red Ridge'],
    ['Falcon'],
    ['Red Ridge'],
  ]
  const eventPlan: EventPlan = {
    schemaVersion: 'event-plan/v1', planId: 'event-plan:cross-document', documentId: parsed.document.documentId, version: 1,
    eventUnits: factual.map((record, index) => ({
      eventUnitId: `cross-event-${index + 1}`,
      title: ['Deployment', 'Detection', 'Data relay', 'Unresolved approach'][index]!,
      worldStateChange: record.claim,
      participants: participantSets[index]!,
      locationRefs: [record.locationExpression!],
      evidenceRefs: [record.evidenceId], inferenceRefs: [], uncertainties: index === 3 ? ['No confirmed lock, launch, interception, or damage'] : [],
      narrativePurpose: index === 3 ? 'Keep the approach unresolved' : 'Explain the exercise sequence',
      importance: index === 3 ? 'high' : 'medium',
    })),
    omittedEvidence: [], warnings: [],
  }
  const acceptedArtifactId = 'artifact:event-plan:cross-document'
  const narrativePlan: NarrativePlan = {
    schemaVersion: 'narrative-plan/v1', narrativePlanId: 'narrative:cross-document',
    sourceEventPlan: { artifactId: acceptedArtifactId, planId: eventPlan.planId, version: 1, fingerprint: fingerprint(eventPlan) },
    targetDurationMs: 60_000,
    subtitles: eventPlan.eventUnits.map((unit, index) => ({
      subtitleId: `cross-subtitle-${index + 1}`, eventUnitId: unit.eventUnitId, text: unit.worldStateChange,
      evidenceRefs: [...unit.evidenceRefs], importance: unit.importance,
    })),
    sceneRequirements: eventPlan.eventUnits.map((unit, index) => ({
      requirementId: `cross-requirement-${index + 1}`, eventUnitId: unit.eventUnitId,
      focusEntities: [...unit.participants], spatialRelations: [], stateChanges: [], motionRequirements: [],
      attentionRequirements: ['show grounded exercise position'], requiredFacts: [unit.worldStateChange],
      forbiddenClaims: index === 3 ? ['confirmed target lock', 'weapon launch', 'interception', 'damage'] : [],
      preferredTemplate: 'generic_movement' as const,
    })),
  }

  const registry = assetRegistry()
  const narrationPlan = buildNarrationPlan({ eventPlan, narrativePlan })
  const sceneBlueprint = buildSceneBlueprint({ eventPlan, narrativePlan, narrationPlan, evidence: parsed.evidence })
  const resolvedScenePlan = resolveSceneBlueprint({ blueprint: sceneBlueprint, assetRegistry: registry })
  const choreographyPlan = compileChoreography({ narrationPlan, sceneBlueprint, resolvedScenePlan, assetRegistry: registry })
  const runtimePlan = canonicalRuntimePlanSchema.parse(compileScene({
    eventPlanArtifactId: acceptedArtifactId,
    narrativePlanArtifactId: 'artifact:narrative', narrationPlanArtifactId: 'artifact:narration',
    sceneBlueprintArtifactId: 'artifact:blueprint', resolvedScenePlanArtifactId: 'artifact:resolved',
    choreographyPlanArtifactId: 'artifact:choreography', assetRegistryArtifactId: 'artifact:assets',
    eventPlan, narrativePlan, narrationPlan, sceneBlueprint, resolvedScenePlan, choreographyPlan, assetRegistry: registry,
  }))
  const sceneProject = sceneProjectConfigSchema.parse(new BaseRuntimeAdapter().adapt(runtimePlan, 'artifact:runtime'))

  const falcon = sceneBlueprint.actorGroups.find(group => group.semanticEntityRef === 'Falcon')
  assert.equal(falcon?.quantityDecision.value, 4)
  assert.equal(resolvedScenePlan.actorRouteAssignments.length, 0)
  assert.ok(resolvedScenePlan.staticActorBindings.length >= 4)
  assert.ok(runtimePlan.commands.some(command => command.type === 'marker.show'))
  assert.equal(runtimePlan.commands.some(command => command.type === 'model.follow_path'), false)
  assert.deepEqual(runtimePlan.interactions, [])
  assert.equal(runtimePlan.commands.some(command => command.type === 'model.set_state' && command.params.state === 'destroyed'), false)
  assert.ok(sceneProject.tracks.some(track => track.type === 'marker' && track.items.length > 0))
  assert.equal(JSON.stringify(runtimePlan).includes('indo-pak'), false)
})
