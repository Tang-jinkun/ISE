import {
  assetRegistrySnapshotSchema,
  type AssetRegistrySnapshot,
} from '../contracts/assetRegistry.ts'
import {
  choreographyPlanSchema,
  type ChoreographyPlan,
} from '../contracts/choreographyPlan.ts'
import { narrationPlanSchema, type NarrationPlan } from '../contracts/narrationPlan.ts'
import {
  resolvedScenePlanSchema,
  type ResolvedScenePlan,
} from '../contracts/resolvedScenePlan.ts'
import {
  sceneBlueprintSchema,
  type SceneBlueprint,
} from '../contracts/sceneBlueprint.ts'
import { fingerprint } from '../services/fingerprint.ts'
import { CompilationError, diagnostic } from '../services/runtimeDiagnostics.ts'

export interface CompileChoreographyInput {
  narrationPlan: NarrationPlan
  sceneBlueprint: SceneBlueprint
  resolvedScenePlan: ResolvedScenePlan
  assetRegistry: AssetRegistrySnapshot
}

function fail(code: string, message: string): never {
  throw new CompilationError([diagnostic(code, message)])
}

export function compileChoreography(rawInput: CompileChoreographyInput): ChoreographyPlan {
  const narrationPlan = narrationPlanSchema.parse(rawInput.narrationPlan)
  const sceneBlueprint = sceneBlueprintSchema.parse(rawInput.sceneBlueprint)
  const resolvedScenePlan = resolvedScenePlanSchema.parse(rawInput.resolvedScenePlan)
  const assetRegistry = assetRegistrySnapshotSchema.parse(rawInput.assetRegistry)
  if (
    sceneBlueprint.sourceNarrationPlanId !== narrationPlan.narrationPlanId
    || resolvedScenePlan.sourceBlueprintId !== sceneBlueprint.blueprintId
    || resolvedScenePlan.sourceBlueprintFingerprint !== fingerprint(sceneBlueprint)
  ) fail('CHOREOGRAPHY_SOURCE_MISMATCH', resolvedScenePlan.resolvedScenePlanId)
  if (resolvedScenePlan.diagnostics.some(item => item.code === 'TRAJECTORY_SYNTHESIZED')) {
    fail('CHOREOGRAPHY_ROUTE_ASSIGNMENT_INVALID', 'Synthesized trajectories are forbidden')
  }

  const routeAssets = new Set(assetRegistry.assets
    .filter(asset => asset.kind === 'trajectory' && asset.availability === 'available')
    .map(asset => asset.assetId))
  const assignments = new Map(resolvedScenePlan.actorRouteAssignments.map(assignment => [
    assignment.actorInstanceRef,
    assignment,
  ]))
  if (
    assignments.size !== resolvedScenePlan.resolvedActors.length
    || new Set(resolvedScenePlan.actorRouteAssignments.map(item => item.trajectoryAssetRef)).size !== assignments.size
  ) fail('CHOREOGRAPHY_ROUTE_ASSIGNMENT_INVALID', resolvedScenePlan.resolvedScenePlanId)

  const actorLifecycles = resolvedScenePlan.resolvedActors.map(actor => {
    const referencedBeats = sceneBlueprint.sceneBeats.filter(beat =>
      beat.subtitleId && beat.actorRefs.includes(actor.actorGroupRef))
    if (referencedBeats.length === 0) fail('ACTOR_SCENE_BEAT_UNBOUND', actor.actorInstanceId)
    return {
      actorInstanceRef: actor.actorInstanceId,
      firstSceneBeatRef: referencedBeats[0]!.sceneBeatId,
      lastSceneBeatRef: referencedBeats.at(-1)!.sceneBeatId,
    }
  })
  const motionSegments = resolvedScenePlan.resolvedActors.map(actor => {
    const assignment = assignments.get(actor.actorInstanceId)
    if (!assignment || assignment.sourceKind !== 'catalog' || !routeAssets.has(assignment.trajectoryAssetRef)) {
      fail('CHOREOGRAPHY_ROUTE_ASSIGNMENT_INVALID', actor.actorInstanceId)
    }
    const sceneBeat = sceneBlueprint.sceneBeats.find(beat => beat.actorRefs.includes(actor.actorGroupRef))!
    return {
      segmentId: `motion:${actor.actorInstanceId}:${sceneBeat.sceneBeatId}`,
      actorInstanceRef: actor.actorInstanceId,
      sceneBeatRef: sceneBeat.sceneBeatId,
      behavior: sceneBeat.behaviorIntents[0] ?? 'follow-registered-route',
      routeAssignmentRef: assignment.segmentId,
      coverage: 'actor-lifecycle' as const,
    }
  })
  const groups = new Map(sceneBlueprint.actorGroups.map(group => [group.groupId, group]))
  const formationSegments = sceneBlueprint.sceneBeats.flatMap(beat => beat.actorRefs.flatMap(groupRef => {
    const actorInstanceRefs = resolvedScenePlan.resolvedActors
      .filter(actor => actor.actorGroupRef === groupRef)
      .map(actor => actor.actorInstanceId)
    if (actorInstanceRefs.length < 2) return []
    return [{
      segmentId: `formation:${beat.sceneBeatId}:${groupRef}`,
      sceneBeatRef: beat.sceneBeatId,
      actorInstanceRefs,
      formationPattern: groups.get(groupRef)?.formationPattern ?? 'formation',
    }]
  }))
  const subjectsForBeat = (beat: SceneBlueprint['sceneBeats'][number]) => resolvedScenePlan.resolvedActors
    .filter(actor => beat.actorRefs.includes(actor.actorGroupRef))
    .map(actor => actor.actorInstanceId)
  const nearestSubjectRefs = (beatIndex: number): string[] => {
    const direct = subjectsForBeat(sceneBlueprint.sceneBeats[beatIndex]!)
    if (direct.length > 0) return direct
    for (let distance = 1; distance < sceneBlueprint.sceneBeats.length; distance++) {
      const previous = sceneBlueprint.sceneBeats[beatIndex - distance]
      if (previous) {
        const subjects = subjectsForBeat(previous)
        if (subjects.length > 0) return subjects
      }
      const next = sceneBlueprint.sceneBeats[beatIndex + distance]
      if (next) {
        const subjects = subjectsForBeat(next)
        if (subjects.length > 0) return subjects
      }
    }
    return []
  }
  const shotPlan = narrationPlan.beats.map(narrationBeat => {
    const sceneBeat = sceneBlueprint.sceneBeats.find(beat => beat.subtitleId === narrationBeat.subtitleId)
    if (!sceneBeat) fail('NARRATION_SCENE_BEAT_UNBOUND', narrationBeat.subtitleId)
    const subjectRefs = nearestSubjectRefs(sceneBlueprint.sceneBeats.indexOf(sceneBeat))
    if (subjectRefs.length === 0) fail('SCENE_BEAT_SUBJECTS_EMPTY', sceneBeat.sceneBeatId)
    return {
      shotId: `shot:${sceneBeat.sceneBeatId}`,
      subtitleId: narrationBeat.subtitleId,
      sceneBeatRefs: [sceneBeat.sceneBeatId],
      intent: sceneBeat.cameraIntent,
      subjectRefs,
      framing: 'catalog-route-bounds-union',
      movement: 'track-subject-formation',
      startConstraint: `time:${narrationBeat.subtitleId}:subtitle-visual-lead`,
      durationRange: {
        minMs: narrationBeat.estimatedDurationMs,
        maxMs: narrationBeat.estimatedDurationMs,
      },
      transition: 'easeInOut',
      visibilityRequirements: subjectRefs,
    }
  })
  const timeConstraints = narrationPlan.beats.map(beat => ({
    constraintId: `time:${beat.subtitleId}:subtitle-visual-lead`,
    subjectRef: beat.subtitleId,
    kind: 'subtitle-visual-lead',
    valueMs: 800,
  }))
  const lineage = motionSegments.map(segment => ({
    outputRef: segment.segmentId,
    sourceRefs: [
      segment.actorInstanceRef,
      segment.sceneBeatRef,
      segment.routeAssignmentRef,
      resolvedScenePlan.resolvedScenePlanId,
    ],
  }))
  const content = {
    sourceResolvedScenePlanId: resolvedScenePlan.resolvedScenePlanId,
    sourceResolvedScenePlanFingerprint: fingerprint(resolvedScenePlan),
    actorInstances: resolvedScenePlan.resolvedActors,
    actorLifecycles,
    motionSegments,
    formationSegments,
    weaponEngagements: [],
    relationSegments: [],
    effectSegments: [],
    shotPlan,
    overlayPlan: [],
    timeConstraints,
    lineage,
  }
  const identity = fingerprint(content)
  return choreographyPlanSchema.parse({
    schemaVersion: 'ise.choreography-plan/v1',
    choreographyPlanId: `choreography:${identity.slice('sha256:'.length, 'sha256:'.length + 16)}`,
    ...content,
  })
}
