import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { sceneProjectConfigSchema } from '@ise/runtime-contracts'
import { BaseRuntimeAdapter } from '../src/adapters/baseRuntimeAdapter.ts'
import { compileChoreography } from '../src/compiler/choreographyCompiler.ts'
import { compileScene } from '../src/compiler/sceneCompiler.ts'
import { eventPlanSchema, type EventPlan } from '../src/contracts/eventPlan.ts'
import { narrativePlanSchema, type NarrativePlan } from '../src/contracts/narrativePlan.ts'
import { canonicalRuntimePlanSchema } from '../src/contracts/runtimePlan.ts'
import { buildNarrationPlan } from '../src/planning/narrationPlanner.ts'
import { resolveSceneBlueprint } from '../src/planning/resolveSceneBlueprint.ts'
import { buildSceneBlueprint } from '../src/planning/sceneBlueprintPlanner.ts'
import { createAssetRegistrySnapshot } from '../src/services/assetRegistry.ts'
import { parseBattleReport } from '../src/services/documentParser.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { CompilationError } from '../src/services/runtimeDiagnostics.ts'

const fixture = new URL('./fixtures/north-sea-evacuation-interception.docx', import.meta.url)

test('a second real DOCX compiles deterministic generated routes and grounded interactions', async () => {
  const parsed = await parseBattleReport(await readFile(fixture))
  const seedText = await readFile(new URL('../../provenance/assets.seed.json', import.meta.url), 'utf8')
  const seed = JSON.parse(seedText) as { assets: unknown[] }
  const assetRegistry = createAssetRegistrySnapshot(seed.assets)

  const record = (pattern: RegExp) => {
    const match = parsed.evidence.records.find(candidate => pattern.test(candidate.claim))
    assert.ok(match, `Missing expected fixture evidence: ${pattern}`)
    return match
  }
  const awacsRoute = record(/operates one Boeing E-3A Sentry AWACS/iu)
  const awacsLink = record(/sends target information by data link/iu)
  const rafaleRoute = record(/formation of four Rafale aircraft/iu)
  const j10Route = record(/formation of four J-10 aircraft/iu)
  const firstLaunch = record(/lead Blue Rafale launches one PL-15E/iu)
  const firstOutcome = record(/geometry intersects.*confirmed destroyed/iu)
  const firstLink = record(/terminal-guidance data by data link/iu)
  const secondLaunch = record(/surviving Red J-10 launches one PL-15E/iu)
  const secondOutcome = record(/No geometric intersection.*outcome remains unconfirmed/iu)
  const secondLink = record(/weapon-status data by data link/iu)

  const acceptedArtifactId = 'artifact:event-plan:north-sea'
  const eventPlan: EventPlan = eventPlanSchema.parse({
    schemaVersion: 'event-plan/v1',
    planId: 'event-plan:north-sea',
    documentId: parsed.document.documentId,
    version: 1,
    eventUnits: [
      {
        eventUnitId: 'event:north-sea-blue-deployment',
        title: 'Blue patrol and data link',
        worldStateChange: 'One Boeing E-3A Sentry AWACS patrols and shares target information by data link with four Rafale aircraft.',
        participants: ['Boeing E-3A Sentry AWACS', 'Rafale'],
        locationRefs: [awacsRoute.locationExpression!, rafaleRoute.locationExpression!],
        evidenceRefs: [awacsRoute.evidenceId, awacsLink.evidenceId, rafaleRoute.evidenceId],
        inferenceRefs: [],
        uncertainties: [],
        narrativePurpose: 'Establish the Blue patrol and its data link.',
        importance: 'high',
      },
      {
        eventUnitId: 'event:north-sea-red-deployment',
        title: 'Red formation approaches',
        worldStateChange: 'Four J-10 aircraft approach on their documented route.',
        participants: ['J-10'],
        locationRefs: [j10Route.locationExpression!],
        evidenceRefs: [j10Route.evidenceId],
        inferenceRefs: [],
        uncertainties: [],
        narrativePurpose: 'Establish the opposing formation.',
        importance: 'high',
      },
      {
        eventUnitId: 'event:north-sea-first-launch',
        title: 'First missile launches',
        worldStateChange: 'The lead Blue Rafale launches one PL-15E at the lead Red J-10.',
        participants: ['Blue Rafale', 'PL-15E', 'Red J-10'],
        locationRefs: [firstLaunch.locationExpression!],
        evidenceRefs: [firstLaunch.evidenceId],
        inferenceRefs: [],
        uncertainties: [],
        narrativePurpose: 'Show the grounded first launch.',
        importance: 'high',
      },
      {
        eventUnitId: 'event:north-sea-first-outcome',
        title: 'First missile destroys its target',
        worldStateChange: 'Intersecting geometry confirms the first missile target destroyed.',
        participants: ['Blue Rafale', 'PL-15E', 'Red J-10'],
        locationRefs: [firstOutcome.locationExpression!],
        evidenceRefs: [firstOutcome.evidenceId, firstLink.evidenceId],
        inferenceRefs: [],
        uncertainties: [],
        narrativePurpose: 'Show the grounded successful engagement outcome.',
        importance: 'high',
      },
      {
        eventUnitId: 'event:north-sea-second-launch',
        title: 'Second missile launches',
        worldStateChange: 'A surviving Red J-10 launches one PL-15E toward the Blue Rafale formation.',
        participants: ['Red J-10', 'PL-15E', 'Blue Rafale'],
        locationRefs: [secondLaunch.locationExpression!],
        evidenceRefs: [secondLaunch.evidenceId],
        inferenceRefs: [],
        uncertainties: [],
        narrativePurpose: 'Show the grounded counter-launch.',
        importance: 'high',
      },
      {
        eventUnitId: 'event:north-sea-second-outcome',
        title: 'Second missile remains unresolved',
        worldStateChange: 'No intersection is established and the second missile outcome remains unconfirmed.',
        participants: ['Red J-10', 'PL-15E', 'Blue Rafale'],
        locationRefs: [secondOutcome.locationExpression!],
        evidenceRefs: [secondOutcome.evidenceId, secondLink.evidenceId],
        inferenceRefs: [],
        uncertainties: ['No hit, destruction, or miss may be claimed.'],
        narrativePurpose: 'Keep the second engagement outcome explicitly unresolved.',
        importance: 'high',
      },
    ],
    omittedEvidence: parsed.evidence.records
      .map(item => item.evidenceId)
      .filter(evidenceId => ![
        awacsRoute, awacsLink, rafaleRoute, j10Route, firstLaunch,
        firstOutcome, firstLink, secondLaunch, secondOutcome, secondLink,
      ].some(item => item.evidenceId === evidenceId)),
    warnings: [],
  })
  const narrativePlan: NarrativePlan = narrativePlanSchema.parse({
    schemaVersion: 'narrative-plan/v1',
    narrativePlanId: 'narrative:north-sea',
    sourceEventPlan: {
      artifactId: acceptedArtifactId,
      planId: eventPlan.planId,
      version: eventPlan.version,
      fingerprint: fingerprint(eventPlan),
    },
    targetDurationMs: 60_000,
    subtitles: eventPlan.eventUnits.map((unit, index) => ({
      subtitleId: `subtitle:north-sea-${index + 1}`,
      eventUnitId: unit.eventUnitId,
      text: unit.worldStateChange,
      evidenceRefs: unit.evidenceRefs,
      importance: unit.importance,
    })),
    sceneRequirements: eventPlan.eventUnits.map((unit, index) => ({
      requirementId: `requirement:north-sea-${index + 1}`,
      eventUnitId: unit.eventUnitId,
      focusEntities: unit.participants,
      spatialRelations: index >= 2 ? ['weapon route relative to target route'] : [],
      stateChanges: unit.eventUnitId === 'event:north-sea-first-outcome'
        ? ['target destroyed at grounded intersection']
        : [],
      motionRequirements: index === 0
        ? ['patrol documented routes and share target information by data link']
        : ['follow documented routes'],
      attentionRequirements: [`show ${unit.title}`],
      requiredFacts: [unit.worldStateChange],
      forbiddenClaims: unit.eventUnitId === 'event:north-sea-second-outcome'
        ? ['confirmed hit', 'destruction', 'miss']
        : [],
      preferredTemplate: index < 2 ? 'deployment' as const : 'attack_chain' as const,
    })),
  })

  const narrationPlan = buildNarrationPlan({ eventPlan, narrativePlan })
  const sceneBlueprint = buildSceneBlueprint({ eventPlan, narrativePlan, narrationPlan, evidence: parsed.evidence })
  const resolvedScenePlan = resolveSceneBlueprint({ blueprint: sceneBlueprint, assetRegistry, evidence: parsed.evidence })
  const choreographyPlan = compileChoreography({ narrationPlan, sceneBlueprint, resolvedScenePlan, assetRegistry })
  const runtimePlan = canonicalRuntimePlanSchema.parse(compileScene({
    eventPlanArtifactId: acceptedArtifactId,
    narrativePlanArtifactId: 'artifact:narrative:north-sea',
    narrationPlanArtifactId: 'artifact:narration:north-sea',
    sceneBlueprintArtifactId: 'artifact:blueprint:north-sea',
    resolvedScenePlanArtifactId: 'artifact:resolved:north-sea',
    choreographyPlanArtifactId: 'artifact:choreography:north-sea',
    assetRegistryArtifactId: 'artifact:assets:repository',
    eventPlan,
    narrativePlan,
    narrationPlan,
    sceneBlueprint,
    resolvedScenePlan,
    choreographyPlan,
    assetRegistry,
  }))
  const sceneProject = sceneProjectConfigSchema.parse(new BaseRuntimeAdapter().adapt(runtimePlan, 'artifact:runtime'))

  assert.equal(sceneBlueprint.scenarioPack?.packId, 'generic/v1')
  assert.deepEqual(sceneBlueprint.actorGroups.map(group => ({
    semanticEntityRef: group.semanticEntityRef,
    quantity: group.quantityDecision.value,
    lifecycle: group.lifecycle,
  })), [
    { semanticEntityRef: 'Boeing E-3A Sentry AWACS', quantity: 1, lifecycle: 'scene-persistent' },
    { semanticEntityRef: 'Rafale', quantity: 4, lifecycle: 'scene-persistent' },
    { semanticEntityRef: 'J-10', quantity: 4, lifecycle: 'scene-persistent' },
    { semanticEntityRef: 'PL-15E', quantity: 1, lifecycle: 'event-scoped:event:north-sea-first-launch' },
    { semanticEntityRef: 'PL-15E', quantity: 1, lifecycle: 'event-scoped:event:north-sea-second-launch' },
  ])
  assert.equal(resolvedScenePlan.resolvedActors.length, 11)
  assert.equal(resolvedScenePlan.actorRouteAssignments.length, 11)
  assert.equal(resolvedScenePlan.generatedTrajectoryAssets.length, 11)
  assert.ok(resolvedScenePlan.actorRouteAssignments.every(item => item.sourceKind === 'generated'))
  assert.deepEqual(choreographyPlan.weaponEngagements.map(item => ({
    outcome: item.outcome,
    evidenceRefs: item.evidenceRefs,
  })), [
    { outcome: 'destroyed', evidenceRefs: [firstLaunch.evidenceId, firstOutcome.evidenceId, firstLink.evidenceId] },
    { outcome: 'unconfirmed', evidenceRefs: [secondLaunch.evidenceId, secondOutcome.evidenceId, secondLink.evidenceId] },
  ])
  assert.ok(choreographyPlan.relationSegments.some(item => item.linkKind === 'awacs-fighter'))
  const fighterMissileRelations = choreographyPlan.relationSegments.filter(item => item.linkKind === 'fighter-missile')
  const relationEvidenceByEvent = new Map(fighterMissileRelations.map(relation => [
    sceneBlueprint.sceneBeats.find(beat => beat.sceneBeatId === relation.sceneBeatRef)!.eventUnitId,
    relation.evidenceRefs,
  ]))
  assert.deepEqual(relationEvidenceByEvent.get('event:north-sea-first-launch'), [firstLaunch.evidenceId])
  assert.deepEqual(relationEvidenceByEvent.get('event:north-sea-second-launch'), [secondLaunch.evidenceId])
  const fighterMissileCommands = runtimePlan.commands.filter(command =>
    command.type === 'data_link.show' && command.params.linkKind === 'fighter-missile')
  const commandEvidenceByEvent = new Map(fighterMissileCommands.map(command => [command.eventUnitId, command.evidenceRefs]))
  assert.deepEqual(commandEvidenceByEvent.get('event:north-sea-first-launch'), [firstLaunch.evidenceId])
  assert.deepEqual(commandEvidenceByEvent.get('event:north-sea-second-launch'), [secondLaunch.evidenceId])
  const [firstEngagement, secondEngagement] = choreographyPlan.weaponEngagements
  const firstInteraction = runtimePlan.interactions.find(item => item.engagementId === firstEngagement!.engagementId)!
  const secondInteraction = runtimePlan.interactions.find(item => item.engagementId === secondEngagement!.engagementId)!
  assert.equal(firstInteraction.status, 'resolved')
  assert.equal(secondInteraction.status, 'unresolved')
  const firstOutcomeSubtitle = runtimePlan.subtitles.find(item => item.eventUnitId === 'event:north-sea-first-outcome')!
  const firstOutcomeVisualStartMs = firstOutcomeSubtitle.startMs + 800
  const impactVideo = runtimePlan.commands.find(command => command.type === 'video.play'
    && command.commandId.includes(`:${firstEngagement!.weaponRef}:terminal:`))!
  const destroyedState = runtimePlan.commands.find(command => command.type === 'model.set_state'
    && command.targetId === firstEngagement!.targetRef && command.params.state === 'destroyed')!
  const outcomeHides = runtimePlan.commands.filter(command => command.type === 'model.hide'
    && (command.targetId === firstEngagement!.weaponRef || command.targetId === firstEngagement!.targetRef))
  assert.ok(firstInteraction.interactionTimeMs >= firstOutcomeVisualStartMs,
    `Interaction ${firstInteraction.interactionTimeMs} precedes outcome visual start ${firstOutcomeVisualStartMs}`)
  assert.ok(impactVideo.startMs >= firstOutcomeVisualStartMs,
    `Impact video ${impactVideo.startMs} precedes outcome visual start ${firstOutcomeVisualStartMs}`)
  assert.ok(destroyedState.startMs >= firstOutcomeVisualStartMs,
    `Destroyed state ${destroyedState.startMs} precedes outcome visual start ${firstOutcomeVisualStartMs}`)
  assert.equal(outcomeHides.length, 2)
  assert.ok(outcomeHides.every(command => command.startMs >= firstOutcomeVisualStartMs),
    `Outcome hide precedes outcome visual start ${firstOutcomeVisualStartMs}`)
  const trackTypes = sceneProject.tracks.map(track => track.type)
  assert.ok(['subtitle', 'image', 'video', 'model', 'camera', 'data-link'].every(type => trackTypes.includes(type)),
    `Missing required track type from: ${trackTypes.join(', ')}`)
  const serializedSceneProject = JSON.stringify(sceneProject)
  const forbiddenLegacyMatch = serializedSceneProject.match(/india|pakistan|Adampur|Minhas/iu)
  assert.equal(forbiddenLegacyMatch, null, forbiddenLegacyMatch === null ? undefined
    : serializedSceneProject.slice(Math.max(0, forbiddenLegacyMatch.index! - 120), forbiddenLegacyMatch.index! + 120))

  const unboundBlueprint = {
    ...sceneBlueprint,
    engagementIntents: sceneBlueprint.engagementIntents.map((intent, index) => index === 0
      ? { ...intent, evidenceRefs: [firstOutcome.evidenceId] }
      : intent),
  }
  assert.throws(() => compileChoreography({
    narrationPlan,
    sceneBlueprint: unboundBlueprint,
    resolvedScenePlan: {
      ...resolvedScenePlan,
      sourceBlueprintFingerprint: fingerprint(unboundBlueprint),
    },
    assetRegistry,
  }), (error: unknown) => error instanceof CompilationError
    && error.diagnostics.some(item => item.code === 'CHOREOGRAPHY_RELATION_EVIDENCE_UNBOUND'))
})
