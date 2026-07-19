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
  const routeAssets = new Set([
    ...assetRegistry.assets
    .filter(asset => asset.kind === 'trajectory' && asset.availability === 'available')
    .map(asset => asset.assetId),
    ...resolvedScenePlan.generatedTrajectoryAssets.map(asset => asset.assetId),
  ])
  const assignments = new Map(resolvedScenePlan.actorRouteAssignments.map(assignment => [
    assignment.actorInstanceRef,
    assignment,
  ]))
  const staticActors = new Set(resolvedScenePlan.staticActorBindings.map(binding => binding.actorInstanceRef))
  const movingActors = resolvedScenePlan.resolvedActors.filter(actor => !staticActors.has(actor.actorInstanceId))
  if (
    assignments.size !== movingActors.length
    || new Set(resolvedScenePlan.actorRouteAssignments.map(item => item.trajectoryAssetRef)).size !== assignments.size
  ) fail('CHOREOGRAPHY_ROUTE_ASSIGNMENT_INVALID', resolvedScenePlan.resolvedScenePlanId)

  const motionSegments = movingActors.map(actor => {
    const assignment = assignments.get(actor.actorInstanceId)
    if (!assignment || !routeAssets.has(assignment.trajectoryAssetRef)) {
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
  const actorsForGroup = (groupRef: string) =>
    resolvedScenePlan.resolvedActors
      .filter(actor => actor.actorGroupRef === groupRef)
      .sort((left, right) => left.ordinal - right.ordinal || left.actorInstanceId.localeCompare(right.actorInstanceId))
  const leadActorForGroup = (groupRef: string) => actorsForGroup(groupRef)
    .filter(actor => !staticActors.has(actor.actorInstanceId))
    .sort((left, right) => left.ordinal - right.ordinal)[0]
  const rawWeaponEngagements = sceneBlueprint.engagementIntents.flatMap(intent => {
    const launcher = leadActorForGroup(intent.launcherGroupRef)
    const target = leadActorForGroup(intent.targetGroupRef)
    const weapons = actorsForGroup(intent.weaponGroupRef)
      .filter(actor => !staticActors.has(actor.actorInstanceId))
      .sort((left, right) => left.ordinal - right.ordinal)
    if (!launcher || !target || weapons.length === 0) return []
    const sceneBeat = sceneBlueprint.sceneBeats.find(beat => beat.eventUnitId === intent.eventUnitId)
    if (!sceneBeat) return []
    return weapons.map(weapon => ({
      engagementId: `engagement:${sceneBeat.sceneBeatId}:${weapon.actorInstanceId}`,
      sceneBeatRef: sceneBeat.sceneBeatId,
      launcherRef: launcher.actorInstanceId,
      weaponRef: weapon.actorInstanceId,
      targetRef: target.actorInstanceId,
      outcome: intent.assertedOutcome,
      evidenceRefs: [...intent.evidenceRefs],
    }))
  })
  // A single weapon actor has one runtime lifecycle. Models may describe the
  // same interaction across multiple adjacent scene beats; collapse those
  // repeated projections before generating commands and shot plans.
  const engagementByWeapon = new Map<string, (typeof rawWeaponEngagements)[number]>()
  for (const engagement of rawWeaponEngagements) {
    const existing = engagementByWeapon.get(engagement.weaponRef)
    if (!existing) {
      engagementByWeapon.set(engagement.weaponRef, engagement)
      continue
    }
    existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...engagement.evidenceRefs])]
    if (engagement.outcome === 'destroyed' || (existing.outcome === 'unconfirmed' && engagement.outcome !== 'unconfirmed')) {
      existing.outcome = engagement.outcome
    }
  }
  const weaponEngagements = [...engagementByWeapon.values()]
  const engagementsBySceneBeat = new Map<string, typeof weaponEngagements>()
  for (const engagement of weaponEngagements) {
    const entries = engagementsBySceneBeat.get(engagement.sceneBeatRef) ?? []
    entries.push(engagement)
    engagementsBySceneBeat.set(engagement.sceneBeatRef, entries)
  }
  const actorLifecycles = resolvedScenePlan.resolvedActors.map(actor => {
    const referencedBeats = sceneBlueprint.sceneBeats.filter(beat => {
      if (!beat.subtitleId) return false
      if (beat.actorRefs.includes(actor.actorGroupRef)) return true
      if ((engagementsBySceneBeat.get(beat.sceneBeatId) ?? []).some(engagement =>
        engagement.launcherRef === actor.actorInstanceId
        || engagement.weaponRef === actor.actorInstanceId
        || engagement.targetRef === actor.actorInstanceId)) return true
      return nearestSubjectRefs(sceneBlueprint.sceneBeats.indexOf(beat)).includes(actor.actorInstanceId)
    })
    if (referencedBeats.length === 0) fail('ACTOR_SCENE_BEAT_UNBOUND', actor.actorInstanceId)
    return {
      actorInstanceRef: actor.actorInstanceId,
      firstSceneBeatRef: referencedBeats[0]!.sceneBeatId,
      lastSceneBeatRef: referencedBeats.at(-1)!.sceneBeatId,
    }
  })
  const fighterMissileRelationSegments = weaponEngagements.map(engagement => ({
      segmentId: `data-link:fighter-missile:${engagement.launcherRef}:${engagement.weaponRef}`,
      sceneBeatRef: engagement.sceneBeatRef,
      sourceRef: engagement.launcherRef,
      targetRef: engagement.weaponRef,
      linkKind: 'fighter-missile' as const,
      evidenceRefs: [...engagement.evidenceRefs],
    }))
  const awacsRelationCandidates = sceneBlueprint.sceneBeats.flatMap(sceneBeat => {
      const supportText = [
        sceneBeat.purpose,
        ...sceneBeat.behaviorIntents,
        ...sceneBeat.requiredFacts,
      ].join(' ')
      if (!/(?:data[ -]?link|target information|warning|guidance|tracking|\u6570\u636e\u94fe|\u76ee\u6807\u4fe1\u606f|\u9884\u8b66|\u5f15\u5bfc|\u8ddf\u8e2a)/iu.test(supportText)) return []
      const narrationBeat = narrationPlan.beats.find(beat => beat.subtitleId === sceneBeat.subtitleId)
      if (!narrationBeat) return []
      const awacsGroups = sceneBeat.actorRefs
        .map(groupRef => groups.get(groupRef))
        .filter((group): group is SceneBlueprint['actorGroups'][number] => group !== undefined
          && (group.role === 'early-warning-support' || /(?:awacs|aew|early warning)/iu.test(group.semanticEntityRef)))
      const fighterGroups = sceneBeat.actorRefs
        .map(groupRef => groups.get(groupRef))
        .filter((group): group is SceneBlueprint['actorGroups'][number] => group?.role === 'fighter-formation')
      return awacsGroups.flatMap(awacsGroup => actorsForGroup(awacsGroup.groupId).flatMap(awacsActor =>
        fighterGroups
          .filter(fighterGroup => fighterGroup.side === awacsGroup.side)
          .flatMap(fighterGroup => actorsForGroup(fighterGroup.groupId).map(fighterActor => ({
            segmentId: `data-link:awacs-fighter:${awacsActor.actorInstanceId}:${fighterActor.actorInstanceId}:${sceneBeat.sceneBeatId}`,
            sceneBeatRef: sceneBeat.sceneBeatId,
            sourceRef: awacsActor.actorInstanceId,
            targetRef: fighterActor.actorInstanceId,
            linkKind: 'awacs-fighter' as const,
            evidenceRefs: [...narrationBeat.evidenceRefs],
          }))),
      ))
    })
  const relationSegments = [...fighterMissileRelationSegments, ...awacsRelationCandidates]
    .sort((left, right) => left.segmentId.localeCompare(right.segmentId))
  const sceneBeatOrder = new Map(sceneBlueprint.sceneBeats.map((beat, index) => [beat.sceneBeatId, index]))
  const weaponsResolvedByLaterEngagement = new Set(weaponEngagements
    .filter(engagement => weaponEngagements.some(candidate =>
      candidate.targetRef === engagement.weaponRef
      && (sceneBeatOrder.get(candidate.sceneBeatRef) ?? -1) > (sceneBeatOrder.get(engagement.sceneBeatRef) ?? -1)))
    .map(engagement => engagement.weaponRef))
  const shotPlan = narrationPlan.beats.flatMap(narrationBeat => {
    const sceneBeat = sceneBlueprint.sceneBeats.find(beat => beat.subtitleId === narrationBeat.subtitleId)
    if (!sceneBeat) fail('NARRATION_SCENE_BEAT_UNBOUND', narrationBeat.subtitleId)
    const engagements = engagementsBySceneBeat.get(sceneBeat.sceneBeatId) ?? []
    if (engagements.length > 0) {
      const subjectRefs = nearestSubjectRefs(sceneBlueprint.sceneBeats.indexOf(sceneBeat))
      if (subjectRefs.length === 0) return []
      return [{
        shotId: `shot:${sceneBeat.sceneBeatId}:establishing`,
        subtitleId: narrationBeat.subtitleId,
        sceneBeatRefs: [sceneBeat.sceneBeatId],
        intent: `engagement:establishing`,
        subjectRefs,
        framing: 'engagement-establishing',
        movement: 'track-engagement-context',
        startConstraint: `time:${narrationBeat.subtitleId}:subtitle-visual-lead`,
        durationRange: {
          minMs: narrationBeat.estimatedDurationMs,
          maxMs: narrationBeat.estimatedDurationMs,
        },
        transition: 'easeInOut',
        visibilityRequirements: subjectRefs,
      }, ...engagements.flatMap(engagement => {
      const phases = [
        { phase: 'launch' as const, subjectRefs: [engagement.launcherRef, engagement.weaponRef], movement: 'track-launcher-to-weapon' },
        { phase: 'midcourse' as const, subjectRefs: [engagement.weaponRef, engagement.targetRef], movement: 'track-weapon-to-target' },
        { phase: 'terminal' as const, subjectRefs: [engagement.weaponRef, engagement.targetRef], movement: 'track-terminal-weapon-to-target' },
        { phase: 'aftermath' as const, subjectRefs: [engagement.targetRef], movement: 'hold-target-outcome' },
      ]
      const supportedPhases = weaponsResolvedByLaterEngagement.has(engagement.weaponRef)
        ? phases.slice(0, 2)
        : phases
      return supportedPhases.map(({ phase, subjectRefs, movement }) => ({
        shotId: `shot:${sceneBeat.sceneBeatId}:${engagement.weaponRef}:${phase}`,
        subtitleId: narrationBeat.subtitleId,
        sceneBeatRefs: [sceneBeat.sceneBeatId],
        intent: `engagement:${engagement.outcome}:${phase}`,
        subjectRefs,
        framing: `engagement-${phase}`,
        movement,
        startConstraint: `time:${narrationBeat.subtitleId}:subtitle-visual-lead`,
        durationRange: {
          minMs: narrationBeat.estimatedDurationMs,
          maxMs: narrationBeat.estimatedDurationMs,
        },
        transition: 'easeInOut',
        visibilityRequirements: subjectRefs,
        phase,
      }))
      })]
    }
    const subjectRefs = nearestSubjectRefs(sceneBlueprint.sceneBeats.indexOf(sceneBeat))
    if (subjectRefs.length === 0) return []
    return [{
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
    }]
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
    weaponEngagements,
    relationSegments,
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
