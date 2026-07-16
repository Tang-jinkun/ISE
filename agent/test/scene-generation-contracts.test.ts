import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHOREOGRAPHY_PLAN_ARTIFACT,
  NARRATION_PLAN_ARTIFACT,
  RESOLVED_SCENE_PLAN_ARTIFACT,
  SCENE_BLUEPRINT_ARTIFACT,
} from '../src/contracts/artifactTypes.ts'
import { choreographyPlanSchema } from '../src/contracts/choreographyPlan.ts'
import { narrationPlanSchema } from '../src/contracts/narrationPlan.ts'
import { resolvedScenePlanSchema } from '../src/contracts/resolvedScenePlan.ts'
import {
  actorGroupSchema,
  actorInstanceSchema,
  quantityDecisionSchema,
  sceneBlueprintSchema,
} from '../src/contracts/sceneBlueprint.ts'
import {
  actorRouteAssignmentSchema,
  formationBundleSchema,
  scenarioTrajectoryMappingSchema,
  trajectoryCatalogSchema,
  type ActorRouteAssignment,
} from '../src/contracts/trajectoryCatalog.ts'

const fingerprint = `sha256:${'1'.repeat(64)}`
type IsExact<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
const trajectoryRefIsTemplateLiteral: IsExact<
  ActorRouteAssignment['trajectoryAssetRef'],
  `trajectory:${string}`
> = true

const quantityDecision = {
  value: 4,
  constraint: 'exact' as const,
  source: 'default' as const,
  evidenceRefs: [],
  defaultPolicyId: 'fighter-formation/v1',
  reason: 'No explicit quantity',
}

const actorGroup = {
  groupId: 'group:india-rafale',
  semanticEntityRef: 'entity:india-rafale',
  side: 'india',
  locationRef: 'location:ambala',
  platformType: 'fighter',
  role: 'strike-fighter',
  quantityDecision,
  formationPattern: 'finger-four',
  leaderPolicy: 'stable-first-member',
  behaviorProfile: 'fighter-formation/v1',
  lifecycle: 'scene-persistent',
}

const actorInstance = {
  actorInstanceId: 'actor:india-rafale:leader',
  actorGroupRef: 'group:india-rafale',
  role: 'leader' as const,
  ordinal: 0,
}

const formationBundle = {
  bundleId: 'formation:india-rafale-ambala',
  actorGroupRef: actorGroup.groupId,
  routeAssetRefs: ['trajectory:ambala-rafale-1'],
  recommendedActorCount: 1,
  role: 'strike-fighter',
  side: 'india',
  semanticTags: ['rafale'],
  scenarioBindings: ['indo-pak/v1'],
  mappingAuthority: 'scenario_config' as const,
  diagnostics: [],
}

const routeAssignment = {
  actorInstanceRef: actorInstance.actorInstanceId,
  formationBundleRef: formationBundle.bundleId,
  trajectoryAssetRef: 'trajectory:ambala-rafale-1',
  segmentId: 'segment:india-rafale:departure',
  resamplePolicy: 'preserve-source-samples' as const,
  timeMapping: { mode: 'fit-window' as const, startMs: 800, durationMs: 12_000 },
  spatialPathMode: 'preserve' as const,
  sourceKind: 'catalog' as const,
  matchReason: 'Exact scenario alias and location match',
  lineage: ['catalog:indo-pak/v1', formationBundle.bundleId],
}

test('quantity decisions and actor contracts accept the stable final-domain fields', () => {
  assert.equal(trajectoryRefIsTemplateLiteral, true)
  assert.equal(quantityDecisionSchema.parse(quantityDecision).value, 4)
  assert.equal(actorGroupSchema.parse(actorGroup).groupId, 'group:india-rafale')
  assert.equal(actorInstanceSchema.parse(actorInstance).role, 'leader')
  assert.equal(quantityDecisionSchema.safeParse({ ...quantityDecision, unexpected: true }).success, false)
  assert.equal(actorGroupSchema.safeParse({ ...actorGroup, unexpected: true }).success, false)
})

test('NarrationPlan is strict and contains semantic narration beats only', () => {
  const plan = {
    schemaVersion: 'ise.narration-plan/v1',
    narrationPlanId: 'narration:1',
    sourceEventPlanId: 'event-plan:1',
    sourceEventPlanFingerprint: fingerprint,
    sourceNarrativePlanId: 'narrative:1',
    beats: [{
      subtitleId: 'subtitle:1',
      eventUnitId: 'event:1',
      text: 'The formation departs.',
      evidenceRefs: ['evidence:1'],
      beatRole: 'action',
      attentionTarget: 'entity:india-rafale',
      importance: 'high',
      estimatedDurationMs: 4_000,
    }],
    diagnostics: [],
  }

  assert.equal(narrationPlanSchema.parse(plan).schemaVersion, NARRATION_PLAN_ARTIFACT)
  assert.equal(narrationPlanSchema.safeParse({ ...plan, unexpected: true }).success, false)
})

test('SceneBlueprint binds its exact NarrationPlan fingerprint and rejects unknown fields', () => {
  const minimalBlueprint = {
    schemaVersion: 'ise.scene-blueprint/v1',
    blueprintId: 'blueprint:1',
    sourceNarrationPlanId: 'narration:1',
    sourceNarrationFingerprint: fingerprint,
    actorGroups: [],
    sceneBeats: [],
    diagnostics: [],
  }
  const blueprint = {
    ...minimalBlueprint,
    actorGroups: [actorGroup],
    sceneBeats: [{
      sceneBeatId: 'scene-beat:1',
      subtitleId: 'subtitle:1',
      eventUnitId: 'event:1',
      purpose: 'Show the formation departure',
      actorRefs: [actorGroup.groupId],
      behaviorIntents: ['formation_departure'],
      spatialConstraints: ['depart-from:ambala'],
      stateTransitions: ['grounded->airborne'],
      cameraIntent: 'group-frame',
      mediaIntents: [],
      requiredFacts: ['evidence:1'],
      forbiddenClaims: [],
      fidelity: 'evidence',
      priority: 'high',
    }],
    diagnostics: [],
  }

  assert.equal(sceneBlueprintSchema.safeParse(minimalBlueprint).success, true)
  assert.equal(sceneBlueprintSchema.parse(blueprint).schemaVersion, SCENE_BLUEPRINT_ARTIFACT)
  assert.equal(sceneBlueprintSchema.safeParse({ ...blueprint, unexpected: true }).success, false)
  assert.equal(sceneBlueprintSchema.safeParse({
    ...blueprint,
    sourceNarrationFingerprint: 'sha256:not-a-fingerprint',
  }).success, false)
})

test('catalog bundles and route assignments preserve source samples and spatial paths', () => {
  const catalog = {
    schemaVersion: 'ise.trajectory-catalog/v1',
    catalogId: 'trajectory-catalog:indo-pak',
    fingerprint,
    entries: [{
      trajectoryAssetId: 'trajectory:ambala-rafale-1',
      fingerprint,
      routeLabel: 'AMBALA Rafale 1',
      side: 'india',
      semanticTags: ['rafale'],
      scenarioBindings: ['indo-pak/v1'],
      startTimeMs: 0,
      endTimeMs: 119_000,
      validationStatus: 'curated_repair',
      repairRecord: {
        sourceFingerprint: fingerprint,
        repairRuleVersion: 'trajectory.shift-suffix/v1',
        affectedSampleRange: [91, 119],
        boundaryTimesBeforeMs: [90_000, 89_000],
        boundaryTimesAfterMs: [90_000, 91_000],
        offsetMs: 2_000,
      },
    }],
  }
  const mapping = {
    schemaVersion: 'ise.scenario-trajectory-mapping/v1',
    scenarioId: 'indo-pak/v1',
    bundles: [{
      bundleId: formationBundle.bundleId,
      modelAssetRef: 'model:rafale',
      routeAssetRefs: formationBundle.routeAssetRefs,
      semanticEntityAliases: ['Rafale'],
      locationRefs: [actorGroup.locationRef],
      diagnostics: [],
    }],
  }

  assert.equal(trajectoryCatalogSchema.parse(catalog).entries.length, 1)
  assert.equal(scenarioTrajectoryMappingSchema.parse(mapping).bundles.length, 1)
  assert.equal(scenarioTrajectoryMappingSchema.safeParse({
    ...mapping,
    bundles: [{ ...mapping.bundles[0], unexpected: true }],
  }).success, false)
  assert.equal(formationBundleSchema.parse(formationBundle).mappingAuthority, 'scenario_config')
  assert.equal(actorRouteAssignmentSchema.parse(routeAssignment).spatialPathMode, 'preserve')
  assert.equal(actorRouteAssignmentSchema.safeParse({ ...routeAssignment, unexpected: true }).success, false)
  assert.equal(actorRouteAssignmentSchema.safeParse({
    ...routeAssignment,
    timeMapping: { ...routeAssignment.timeMapping, unexpected: true },
  }).success, false)
  assert.equal(trajectoryCatalogSchema.safeParse({
    ...catalog,
    entries: [{
      ...catalog.entries[0]!,
      repairRecord: { ...catalog.entries[0]!.repairRecord, unexpected: true },
    }],
  }).success, false)
})

test('ResolvedScenePlan binds blueprint, catalog, and scenario mapping fingerprints', () => {
  const resolved = {
    schemaVersion: 'ise.resolved-scene-plan/v1',
    resolvedScenePlanId: 'resolved-scene-plan:1',
    sourceBlueprintId: 'blueprint:1',
    sourceBlueprintFingerprint: fingerprint,
    trajectoryCatalogFingerprint: fingerprint,
    scenarioMappingFingerprint: fingerprint,
    resolvedActors: [actorInstance],
    resolvedLocations: [],
    resolvedAssets: [],
    resolvedFormationBundles: [formationBundle],
    actorRouteAssignments: [routeAssignment],
    fallbackTrajectoryRecipes: [{
      recipeId: 'fallback:1',
      actorGroupRef: actorGroup.groupId,
      reason: 'No registered route capacity',
      sourceKind: 'illustrative',
      approvedByUser: true,
      generatorVersion: 'trajectory-synthesizer/v1',
      lineage: ['blueprint:1'],
    }],
    resolvedBehaviors: [],
    resolvedMedia: [],
    fallbackDecisions: [],
    diagnostics: [],
  }

  assert.equal(resolvedScenePlanSchema.parse(resolved).schemaVersion, RESOLVED_SCENE_PLAN_ARTIFACT)
  assert.equal(resolvedScenePlanSchema.safeParse({
    ...resolved,
    scenarioMappingFingerprint: 'missing',
  }).success, false)
  assert.equal(resolvedScenePlanSchema.safeParse({ ...resolved, unexpected: true }).success, false)
  assert.equal(resolvedScenePlanSchema.safeParse({
    ...resolved,
    fallbackTrajectoryRecipes: [{ ...resolved.fallbackTrajectoryRecipes[0], unexpected: true }],
  }).success, false)
})

test('ChoreographyPlan carries expanded actors and no exact runtime commands', () => {
  const choreography = {
    schemaVersion: 'ise.choreography-plan/v1',
    choreographyPlanId: 'choreography:1',
    sourceResolvedScenePlanId: 'resolved-scene-plan:1',
    sourceResolvedScenePlanFingerprint: fingerprint,
    actorInstances: [actorInstance],
    actorLifecycles: [{
      actorInstanceRef: actorInstance.actorInstanceId,
      firstSceneBeatRef: 'scene-beat:1',
      lastSceneBeatRef: 'scene-beat:2',
    }],
    motionSegments: [],
    formationSegments: [],
    weaponEngagements: [],
    relationSegments: [],
    effectSegments: [],
    shotPlan: [],
    overlayPlan: [],
    timeConstraints: [],
    lineage: [],
  }

  assert.equal(choreographyPlanSchema.parse(choreography).schemaVersion, CHOREOGRAPHY_PLAN_ARTIFACT)
  assert.equal(choreographyPlanSchema.safeParse({ ...choreography, commands: [] }).success, false)
  assert.equal(choreographyPlanSchema.safeParse({
    ...choreography,
    actorLifecycles: [{ ...choreography.actorLifecycles[0], unexpected: true }],
  }).success, false)
})
