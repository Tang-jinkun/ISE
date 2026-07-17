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
  const actorsForGroup = (groupRef: string) =>
    resolvedScenePlan.resolvedActors
      .filter(actor => actor.actorGroupRef === groupRef)
      .sort((left, right) => left.ordinal - right.ordinal || left.actorInstanceId.localeCompare(right.actorInstanceId))
  const actorForCurrentBeat = (
    sceneBeat: SceneBlueprint['sceneBeats'][number],
    predicate: (group: SceneBlueprint['actorGroups'][number]) => boolean,
  ): string | undefined => {
    for (const groupRef of sceneBeat.actorRefs) {
      const group = groups.get(groupRef)
      if (group && predicate(group)) return actorsForGroup(groupRef)[0]?.actorInstanceId
    }
    return undefined
  }
  const weaponEngagements = sceneBlueprint.sceneBeats.flatMap(sceneBeat => {
    const narrationBeat = narrationPlan.beats.find(beat => beat.subtitleId === sceneBeat.subtitleId)
    if (!narrationBeat) return []
    const weaponGroups = sceneBeat.actorRefs
      .map(groupRef => groups.get(groupRef))
      .filter((group): group is SceneBlueprint['actorGroups'][number] => group?.role === 'weapon-launch'
        && group.lifecycle === `event-scoped:${sceneBeat.eventUnitId}`)
      .sort((left, right) => left.groupId.localeCompare(right.groupId))
    return weaponGroups.flatMap(weaponGroup => actorsForGroup(weaponGroup.groupId).flatMap(weaponActor => {
      const weaponRef = weaponActor.actorInstanceId
      const fighter = (side: string, platform: 'su30' | 'jf17' | 'rafale') => actorForCurrentBeat(sceneBeat, group => {
        if (group.role !== 'fighter-formation' || group.side !== side) return false
        const entity = group.semanticEntityRef.toLocaleLowerCase('en-US')
        if (platform === 'su30') return /su[- ]?30mki|30mki/u.test(entity)
        if (platform === 'jf17') return /jf[- ]?17/u.test(entity)
        return /rafale/u.test(entity)
      })
      const firstStrikeWeapon = actorForCurrentBeat(sceneBeat, group =>
        group.role === 'weapon-launch' && group.behaviorProfile === 'weapon-launch/india-first-strike/v1')
      const profile = weaponGroup.behaviorProfile
      const confirmedDestruction = sceneBeat.requiredFacts.some(fact =>
        /\bdestroyed\b|\bdestroys\b|击毁|坠毁|命中并击毁/iu.test(fact))
        && !sceneBeat.forbiddenClaims.some(claim =>
          /confirmed\s+(?:outcome|destruction|destroyed|target\s+destruction)|确认(?:战果|毁伤|击毁|命中结果)/iu.test(claim))
      const specification = profile === 'weapon-launch/india-first-strike/v1'
        ? { launcherRef: fighter('india', 'su30'), targetRef: fighter('pakistan', 'jf17'), outcome: 'intercepted' }
        : profile === 'weapon-launch/pakistan-intercept/v1'
          ? { launcherRef: fighter('pakistan', 'jf17'), targetRef: firstStrikeWeapon, outcome: 'interception' }
          : profile === 'weapon-launch/pakistan-counterattack/v1'
            ? { launcherRef: fighter('pakistan', 'jf17'), targetRef: fighter('india', 'rafale'), outcome: confirmedDestruction ? 'destroyed' : 'unconfirmed' }
            : undefined
      if (!specification?.launcherRef || !specification.targetRef) return []
      return [{
        engagementId: `engagement:${sceneBeat.sceneBeatId}:${weaponRef}`,
        sceneBeatRef: sceneBeat.sceneBeatId,
        launcherRef: specification.launcherRef,
        weaponRef,
        targetRef: specification.targetRef,
        outcome: specification.outcome,
        evidenceRefs: [...narrationBeat.evidenceRefs],
      }]
    }))
  })
  const engagementsBySceneBeat = new Map<string, typeof weaponEngagements>()
  for (const engagement of weaponEngagements) {
    const entries = engagementsBySceneBeat.get(engagement.sceneBeatRef) ?? []
    entries.push(engagement)
    engagementsBySceneBeat.set(engagement.sceneBeatRef, entries)
  }
  const fighterMissileRelationSegments = weaponEngagements.map(engagement => ({
      segmentId: `data-link:fighter-missile:${engagement.launcherRef}:${engagement.weaponRef}`,
      sceneBeatRef: engagement.sceneBeatRef,
      sourceRef: engagement.launcherRef,
      targetRef: engagement.weaponRef,
      linkKind: 'fighter-missile' as const,
      evidenceRefs: [...engagement.evidenceRefs],
    }))
  const subtitleOrder = new Map(narrationPlan.beats.map((beat, index) => [beat.subtitleId, index]))
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
            segmentId: `data-link:awacs-fighter:${awacsActor.actorInstanceId}:${fighterActor.actorInstanceId}`,
            sceneBeatRef: sceneBeat.sceneBeatId,
            sourceRef: awacsActor.actorInstanceId,
            targetRef: fighterActor.actorInstanceId,
            linkKind: 'awacs-fighter' as const,
            evidenceRefs: [...narrationBeat.evidenceRefs],
          }))),
      ))
    })
  const awacsRelationsByPair = new Map<string, (typeof awacsRelationCandidates)[number]>()
  for (const relation of [...awacsRelationCandidates].sort((left, right) => {
    const leftOrder = subtitleOrder.get(sceneBlueprint.sceneBeats.find(beat => beat.sceneBeatId === left.sceneBeatRef)?.subtitleId ?? '') ?? Number.MAX_SAFE_INTEGER
    const rightOrder = subtitleOrder.get(sceneBlueprint.sceneBeats.find(beat => beat.sceneBeatId === right.sceneBeatRef)?.subtitleId ?? '') ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || left.sceneBeatRef.localeCompare(right.sceneBeatRef) || left.segmentId.localeCompare(right.segmentId)
  })) {
    const pairKey = `${relation.linkKind}\u0000${relation.sourceRef}\u0000${relation.targetRef}`
    if (!awacsRelationsByPair.has(pairKey)) awacsRelationsByPair.set(pairKey, relation)
  }
  const relationSegments = [...fighterMissileRelationSegments, ...awacsRelationsByPair.values()]
    .sort((left, right) => left.segmentId.localeCompare(right.segmentId))
  const shotPlan = narrationPlan.beats.flatMap(narrationBeat => {
    const sceneBeat = sceneBlueprint.sceneBeats.find(beat => beat.subtitleId === narrationBeat.subtitleId)
    if (!sceneBeat) fail('NARRATION_SCENE_BEAT_UNBOUND', narrationBeat.subtitleId)
    const engagements = engagementsBySceneBeat.get(sceneBeat.sceneBeatId) ?? []
    if (engagements.length > 0) {
      return engagements.flatMap(engagement => {
      const phases = [
        { phase: 'launch' as const, subjectRefs: [engagement.launcherRef, engagement.weaponRef], movement: 'track-launcher-to-weapon' },
        { phase: 'midcourse' as const, subjectRefs: [engagement.weaponRef, engagement.targetRef], movement: 'track-weapon-to-target' },
        { phase: 'terminal' as const, subjectRefs: [engagement.weaponRef, engagement.targetRef], movement: 'track-terminal-weapon-to-target' },
        { phase: 'aftermath' as const, subjectRefs: [engagement.targetRef], movement: 'hold-target-outcome' },
      ]
      return phases.map(({ phase, subjectRefs, movement }) => ({
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
      })
    }
    const subjectRefs = nearestSubjectRefs(sceneBlueprint.sceneBeats.indexOf(sceneBeat))
    if (subjectRefs.length === 0) fail('SCENE_BEAT_SUBJECTS_EMPTY', sceneBeat.sceneBeatId)
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
