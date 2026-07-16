import { createHash } from 'node:crypto'
import { eventPlanSchema, type EventPlan } from '../contracts/eventPlan.ts'
import { narrativePlanSchema, type NarrativePlan, type SceneRequirement, type TemplateName } from '../contracts/narrativePlan.ts'
import { assetRegistrySnapshotSchema, type AssetRegistryEntry, type AssetRegistrySnapshot } from '../contracts/assetRegistry.ts'
import {
  canonicalRuntimePlanSchema,
  type CanonicalCommand,
  type CanonicalRuntimePlan,
  type CommandDraft,
  type RuntimeEntity,
} from '../contracts/runtimePlan.ts'
import { narrationPlanSchema, type NarrationPlan } from '../contracts/narrationPlan.ts'
import { sceneBlueprintSchema, type SceneBlueprint } from '../contracts/sceneBlueprint.ts'
import { resolvedScenePlanSchema, type ResolvedScenePlan } from '../contracts/resolvedScenePlan.ts'
import { choreographyPlanSchema, type ChoreographyPlan } from '../contracts/choreographyPlan.ts'
import { indoPakTrajectoryScenario } from '../config/indoPakTrajectoryScenario.ts'
import { AssetRegistry, normalizeAssetName } from '../services/assetRegistry.ts'
import { canonicalJson, fingerprint } from '../services/fingerprint.ts'
import { CompilationError, diagnostic } from '../services/runtimeDiagnostics.ts'
import { capabilityManifest } from './capabilityManifest.ts'
import {
  cameraParamsForBounds,
  expandRequirement,
  expandRequestedMedia,
  expandSupplementalRequirement,
  inferTemplateFromStateChange,
  type CameraProfile,
  type InformationCardDraft,
} from './templates.ts'
import { scheduleNarrative } from './scheduler.ts'

export interface LegacyCompilerInput {
  eventPlanArtifactId: string
  narrativePlanArtifactId?: string
  assetRegistryArtifactId?: string
  eventPlan: EventPlan
  narrativePlan: NarrativePlan
  assetRegistry: AssetRegistrySnapshot
}

const movementTemplates = new Set<TemplateName>([
  'deployment', 'interception', 'counterattack', 'withdrawal', 'generic_movement',
])

function entityId(value: string): string {
  const slug = value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const digest = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12)
  const stableName = /[^\x00-\x7f]/.test(value) ? `${slug || 'other'}-${digest}` : slug || `other-${digest}`
  return `entity:${stableName}`
}

export interface CompilerInput {
  eventPlanArtifactId: string
  narrativePlanArtifactId: string
  narrationPlanArtifactId: string
  sceneBlueprintArtifactId: string
  resolvedScenePlanArtifactId: string
  choreographyPlanArtifactId: string
  assetRegistryArtifactId: string
  eventPlan: EventPlan
  narrativePlan: NarrativePlan
  narrationPlan: NarrationPlan
  sceneBlueprint: SceneBlueprint
  resolvedScenePlan: ResolvedScenePlan
  choreographyPlan: ChoreographyPlan
  assetRegistry: AssetRegistrySnapshot
}

function semanticGroups(requirement: SceneRequirement): string[][] {
  return [
    ...requirement.focusEntities.map(value => [value]),
    requirement.motionRequirements,
    requirement.spatialRelations,
    requirement.stateChanges,
    requirement.attentionRequirements,
    requirement.requiredFacts,
  ]
}

function matchesSemanticValue(entry: AssetRegistryEntry, values: readonly string[]): boolean {
  const requested = values.map(normalizeAssetName)
  const canonicalNames = [entry.assetId, entry.displayName].map(normalizeAssetName)
  if (canonicalNames.some(name => requested.includes(name))) return true
  const aliasNames = entry.aliases.flatMap(alias => {
    const name = normalizeAssetName(alias)
    const stem = name.replace(/(?:航迹|\s*route)$/u, '').trim()
    return stem && stem !== name ? [name, stem] : [name]
  })
  return aliasNames.some(name =>
    requested.some(value => name === value || (
      Math.min(name.length, value.length) >= 2 && (name.includes(value) || value.includes(name))
    )))
}

function selectAsset(
  registry: AssetRegistry,
  kind: AssetRegistryEntry['kind'],
  requirement: SceneRequirement,
): AssetRegistryEntry | undefined {
  const allCandidates = [...registry.entries.values()]
    .filter(entry => entry.kind === kind)
    .sort((left, right) => left.assetId.localeCompare(right.assetId))
  let firstFailure: CompilationError | undefined
  const resolveCandidates = (candidates: readonly AssetRegistryEntry[]): AssetRegistryEntry | undefined => {
    const resolved = new Map<string, AssetRegistryEntry>()
    for (const candidate of candidates) {
      try {
        const entry = registry.resolve(candidate.assetId)
        if (entry?.kind === kind) resolved.set(entry.assetId, entry)
      } catch (error) {
        if (!(error instanceof CompilationError)) throw error
        firstFailure ??= error
      }
    }
    if (resolved.size > 1) {
      throw new CompilationError([diagnostic(
        'ASSET_SELECTION_AMBIGUOUS',
        `${requirement.requirementId} ${kind} maps to ${[...resolved.keys()].join(', ')}`,
      )])
    }
    return resolved.size === 1 ? resolved.values().next().value : undefined
  }

  for (const values of semanticGroups(requirement)) {
    const candidates = allCandidates.filter(entry => matchesSemanticValue(entry, values))
    if (candidates.length === 0) continue
    const selected = resolveCandidates(candidates)
    if (selected) return selected
  }
  const fallback = resolveCandidates(allCandidates)
  if (fallback) return fallback
  if (firstFailure) throw firstFailure
  return undefined
}

function resolveModel(registry: AssetRegistry, name: string): Extract<AssetRegistryEntry, { kind: 'model' }> | undefined {
  const candidates = [...registry.entries.values()]
    .filter((entry): entry is Extract<AssetRegistryEntry, { kind: 'model' }> =>
      entry.kind === 'model' && matchesSemanticValue(entry, [name]))
    .sort((left, right) => left.assetId.localeCompare(right.assetId))
    .map(entry => registry.resolve(entry.assetId))
    .filter((entry): entry is Extract<AssetRegistryEntry, { kind: 'model' }> => entry?.kind === 'model')
  if (candidates.length > 1) throw new CompilationError([diagnostic(
    'ASSET_SELECTION_AMBIGUOUS',
    `${name} model maps to ${candidates.map(item => item.assetId).join(', ')}`,
  )])
  return candidates[0]
}

function buildEntities(eventPlan: EventPlan, narrativePlan: NarrativePlan, registry: AssetRegistry): RuntimeEntity[] {
  const focusNames = [...new Set(narrativePlan.sceneRequirements.flatMap(item => item.focusEntities))]
  if (focusNames.length === 0) focusNames.push(...new Set(eventPlan.eventUnits.flatMap(item => item.participants)))
  return focusNames.sort().map(name => {
    const model = resolveModel(registry, name)
    return {
      entityId: entityId(name),
      displayName: name,
      kind: model?.model.entityTypes.includes('aircraft') ? 'aircraft' : 'other',
      ...(model ? { modelAssetId: model.assetId } : {}),
      initialState: 'normal',
    }
  })
}

function assetId(entry: AssetRegistryEntry | undefined, kind: AssetRegistryEntry['kind']): string | undefined {
  return entry?.kind === kind ? entry.assetId : undefined
}

function validatePlan(plan: CanonicalRuntimePlan, input: LegacyCompilerInput): void {
  const unitEvidence = new Map(input.eventPlan.eventUnits.map(unit => [unit.eventUnitId, new Set(unit.evidenceRefs)]))
  const outputIds = new Set<string>()
  const registerOutput = (id: string) => {
    if (outputIds.has(id)) throw new CompilationError([diagnostic('DUPLICATE_OUTPUT_ID', id)])
    outputIds.add(id)
  }
  const validateEvidenceAndTime = (item: {
    eventUnitId: string; evidenceRefs: string[]; startMs: number; durationMs: number
  }, id: string) => {
    const allowed = unitEvidence.get(item.eventUnitId)
    if (!allowed || item.evidenceRefs.some(reference => !allowed.has(reference))) {
      throw new CompilationError([diagnostic('OUTPUT_EVIDENCE_INVALID', id)])
    }
    if (item.startMs + item.durationMs > plan.totalDurationMs) {
      throw new CompilationError([diagnostic('OUTPUT_DURATION_INVALID', id)])
    }
  }
  const entityIds = new Set<string>()
  for (const entity of plan.entities) {
    if (entityIds.has(entity.entityId)) throw new CompilationError([diagnostic('DUPLICATE_ENTITY_ID', entity.entityId)])
    entityIds.add(entity.entityId)
  }
  for (const subtitle of plan.subtitles) {
    registerOutput(subtitle.subtitleId)
    validateEvidenceAndTime(subtitle, subtitle.subtitleId)
  }
  for (const card of plan.informationCards) {
    registerOutput(card.cardId)
    validateEvidenceAndTime(card, card.cardId)
  }
  const commandIds = new Set<string>()
  for (const command of plan.commands) {
    registerOutput(command.commandId)
    if (commandIds.has(command.commandId)) throw new CompilationError([diagnostic('DUPLICATE_COMMAND_ID', command.commandId)])
    commandIds.add(command.commandId)
    const allowed = unitEvidence.get(command.eventUnitId)
    if (!allowed || command.evidenceRefs.some(reference => !allowed.has(reference))) {
      throw new CompilationError([diagnostic('COMMAND_EVIDENCE_INVALID', command.commandId, 'error', { commandId: command.commandId })])
    }
    if (command.startMs + command.durationMs > plan.totalDurationMs) {
      throw new CompilationError([diagnostic('COMMAND_DURATION_INVALID', command.commandId, 'error', { commandId: command.commandId })])
    }
    if (command.durationMs < capabilityManifest.minimumDurations[command.type]) {
      throw new CompilationError([diagnostic('CAPABILITY_MINIMUM_VIOLATED', command.commandId, 'error', { commandId: command.commandId })])
    }
  }
  if (plan.totalDurationMs > input.narrativePlan.targetDurationMs) {
    throw new CompilationError([diagnostic('RUNTIME_DURATION_EXCEEDED', `${plan.totalDurationMs} exceeds ${input.narrativePlan.targetDurationMs}`)])
  }
  const lineageIds = plan.lineage.map(item => item.outputId)
  if (new Set(lineageIds).size !== lineageIds.length || lineageIds.some(id => !outputIds.has(id)) || outputIds.size !== lineageIds.length) {
    throw new CompilationError([diagnostic('LINEAGE_OUTPUT_MISMATCH', 'Lineage must reference every output exactly once')])
  }
  for (const command of plan.commands) {
    for (const dependency of command.dependsOn) {
      if (!commandIds.has(dependency)) throw new CompilationError([diagnostic('COMMAND_DEPENDENCY_MISSING', `${command.commandId}: ${dependency}`)])
    }
  }
  const byId = new Map(plan.commands.map(command => [command.commandId, command]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (command: CanonicalCommand) => {
    if (visiting.has(command.commandId)) throw new CompilationError([diagnostic('COMMAND_DEPENDENCY_CYCLE', command.commandId)])
    if (visited.has(command.commandId)) return
    visiting.add(command.commandId)
    for (const id of command.dependsOn) visit(byId.get(id)!)
    visiting.delete(command.commandId)
    visited.add(command.commandId)
  }
  for (const command of plan.commands) visit(command)
  const noOverlap = (commands: CanonicalCommand[], code: string) => {
    const ordered = [...commands].sort((left, right) => left.startMs - right.startMs)
    for (let index = 1; index < ordered.length; index++) {
      if (ordered[index]!.startMs < ordered[index - 1]!.startMs + ordered[index - 1]!.durationMs) {
        throw new CompilationError([diagnostic(code, `${ordered[index - 1]!.commandId}, ${ordered[index]!.commandId}`)])
      }
    }
  }
  noOverlap(plan.commands.filter(command => command.type === 'camera.transition'), 'CAMERA_COMMAND_OVERLAP')
  for (const target of new Set(plan.commands.filter(command => command.type === 'model.set_state').map(command => command.targetId))) {
    noOverlap(plan.commands.filter(command => command.type === 'model.set_state' && command.targetId === target), 'STATE_COMMAND_OVERLAP')
  }
}

export function compileLegacyScene(rawInput: LegacyCompilerInput): CanonicalRuntimePlan {
  const eventPlan = eventPlanSchema.parse(rawInput.eventPlan)
  const narrativePlan = narrativePlanSchema.parse(rawInput.narrativePlan)
  const assetRegistry = assetRegistrySnapshotSchema.parse(rawInput.assetRegistry)
  if (
    narrativePlan.sourceEventPlan.artifactId !== rawInput.eventPlanArtifactId
    || narrativePlan.sourceEventPlan.planId !== eventPlan.planId
    || narrativePlan.sourceEventPlan.version !== eventPlan.version
  ) throw new CompilationError([diagnostic('SOURCE_EVENT_PLAN_MISMATCH', rawInput.eventPlanArtifactId)])
  const registry = new AssetRegistry(assetRegistry)
  const entities = buildEntities(eventPlan, narrativePlan, registry)
  const entitiesByName = new Map(entities.map(entity => [entity.displayName, entity]))
  const commands = []
  const cards: InformationCardDraft[] = []
  for (const requirement of narrativePlan.sceneRequirements) {
    const unit = eventPlan.eventUnits.find(item => item.eventUnitId === requirement.eventUnitId)
    if (!unit) throw new CompilationError([diagnostic('EVENT_UNIT_NOT_FOUND', requirement.eventUnitId)])
    const template = requirement.preferredTemplate ?? inferTemplateFromStateChange(requirement)
    const requiresMovement = movementTemplates.has(template)
    const focusEntities = requirement.focusEntities.flatMap(name => {
      const entity = entitiesByName.get(name)
      return entity ? [entity] : []
    })
    const entity = requiresMovement
      ? focusEntities.find(item => item.modelAssetId) ?? focusEntities[0] ?? entities[0]
      : focusEntities[0] ?? entities[0]
    if (!entity) throw new CompilationError([diagnostic('ENTITY_NOT_FOUND', requirement.requirementId)])
    const trajectory = requiresMovement ? selectAsset(registry, 'trajectory', requirement) : undefined
    const image = template === 'return_and_summary' || template === 'status_explanation'
      ? selectAsset(registry, 'image', requirement)
      : undefined
    const video = template === 'attack_chain' ? selectAsset(registry, 'video', requirement) : undefined
    const geojson = template === 'electronic_warfare' ? selectAsset(registry, 'geojson', requirement) : undefined
    if (requiresMovement && !trajectory) throw new CompilationError([diagnostic('REQUIRED_ASSET_MISSING', 'trajectory')])
    if (requiresMovement && !entity.modelAssetId) throw new CompilationError([diagnostic('REQUIRED_ASSET_MISSING', 'model')])
    let expansion
    try {
      expansion = expandRequirement(requirement, {
        eventUnit: unit,
        entity,
        modelAssetId: entity.modelAssetId,
        trajectoryAssetId: assetId(trajectory, 'trajectory'),
        trajectoryBounds: trajectory?.kind === 'trajectory' ? trajectory.trajectory.bounds : undefined,
        imageAssetId: assetId(image, 'image'),
        videoAssetId: assetId(video, 'video'),
        geojsonAssetId: assetId(geojson, 'geojson'),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new CompilationError([diagnostic(
        message.includes('TRAJECTORY') ? 'REQUIRED_ASSET_MISSING' : 'TEMPLATE_EXPANSION_FAILED',
        message,
      )])
    }
    commands.push(...expansion.commands)
    cards.push(...expansion.informationCards)
  }
  const scheduled = scheduleNarrative({
    eventPlan,
    narrativePlan,
    commandDrafts: commands,
    informationCardDrafts: cards,
    capabilities: capabilityManifest,
  })
  const sourceArtifactIds = [
    rawInput.eventPlanArtifactId,
    rawInput.narrativePlanArtifactId ?? narrativePlan.narrativePlanId,
    rawInput.assetRegistryArtifactId ?? assetRegistry.registryVersion,
  ]
  const outputIds = [
    ...scheduled.subtitles.map(item => [item.subtitleId, item.evidenceRefs] as const),
    ...scheduled.commands.map(item => [item.commandId, item.evidenceRefs] as const),
    ...scheduled.informationCards.map(item => [item.cardId, item.evidenceRefs] as const),
  ]
  const plan = canonicalRuntimePlanSchema.parse({
    schemaVersion: 'canonical-runtime-plan/v1',
    planId: `runtime:${narrativePlan.narrativePlanId}`,
    sourceDocumentId: eventPlan.documentId,
    eventPlanArtifactId: rawInput.eventPlanArtifactId,
    eventPlanId: eventPlan.planId,
    narrativePlanId: narrativePlan.narrativePlanId,
    capabilityManifestVersion: capabilityManifest.version,
    assetRegistryVersion: assetRegistry.registryVersion,
    totalDurationMs: scheduled.totalDurationMs,
    entities: entities.sort((left, right) => left.entityId.localeCompare(right.entityId)),
    subtitles: scheduled.subtitles.sort((left, right) => left.subtitleId.localeCompare(right.subtitleId)),
    commands: scheduled.commands.sort((left, right) => left.commandId.localeCompare(right.commandId)),
    informationCards: scheduled.informationCards.sort((left, right) => left.cardId.localeCompare(right.cardId)),
    lineage: outputIds.map(([outputId, evidenceRefs]) => ({ outputId, sourceArtifactIds, evidenceRefs }))
      .sort((left, right) => left.outputId.localeCompare(right.outputId)),
    diagnostics: [...registry.diagnostics].sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`)),
  })
  validatePlan(plan, { ...rawInput, eventPlan, narrativePlan, assetRegistry })
  return plan
}

function fail(code: string, message: string): never {
  throw new CompilationError([diagnostic(code, message)])
}

function exactAvailableAsset(
  assetRegistry: AssetRegistrySnapshot,
  assetId: string,
  kind: AssetRegistryEntry['kind'],
): AssetRegistryEntry {
  const asset = assetRegistry.assets.find(candidate => candidate.assetId === assetId)
  if (!asset || asset.kind !== kind || asset.availability !== 'available') {
    fail('REQUIRED_ASSET_MISSING', `${kind}: ${assetId}`)
  }
  return asset
}

function routeBounds(
  assetRegistry: AssetRegistrySnapshot,
  trajectoryAssetId: string,
): [[number, number], [number, number]] {
  const asset = exactAvailableAsset(assetRegistry, trajectoryAssetId, 'trajectory')
  if (asset.kind !== 'trajectory' || !asset.trajectory.bounds) {
    fail('REQUIRED_ASSET_MISSING', `trajectory bounds: ${trajectoryAssetId}`)
  }
  return asset.trajectory.bounds
}

function unionBounds(
  bounds: readonly [[number, number], [number, number]][],
): [[number, number], [number, number]] {
  return [
    [Math.min(...bounds.map(item => item[0][0])), Math.min(...bounds.map(item => item[0][1]))],
    [Math.max(...bounds.map(item => item[1][0])), Math.max(...bounds.map(item => item[1][1]))],
  ]
}

function cameraProfile(template: TemplateName): CameraProfile {
  if (template === 'counterattack') return 'counterattack'
  if (template === 'interception') return 'interception'
  return 'deployment'
}

export function compileScene(rawInput: CompilerInput): CanonicalRuntimePlan {
  const eventPlan = eventPlanSchema.parse(rawInput.eventPlan)
  const narrativePlan = narrativePlanSchema.parse(rawInput.narrativePlan)
  const narrationPlan = narrationPlanSchema.parse(rawInput.narrationPlan)
  const sceneBlueprint = sceneBlueprintSchema.parse(rawInput.sceneBlueprint)
  const resolvedScenePlan = resolvedScenePlanSchema.parse(rawInput.resolvedScenePlan)
  const choreographyPlan = choreographyPlanSchema.parse(rawInput.choreographyPlan)
  const assetRegistry = assetRegistrySnapshotSchema.parse(rawInput.assetRegistry)
  if (
    narrativePlan.sourceEventPlan.artifactId !== rawInput.eventPlanArtifactId
    || narrativePlan.sourceEventPlan.planId !== eventPlan.planId
    || narrativePlan.sourceEventPlan.version !== eventPlan.version
    || narrativePlan.sourceEventPlan.fingerprint !== fingerprint(eventPlan)
    || narrationPlan.sourceEventPlanId !== eventPlan.planId
    || narrationPlan.sourceEventPlanFingerprint !== fingerprint(eventPlan)
    || narrationPlan.sourceNarrativePlanId !== narrativePlan.narrativePlanId
    || sceneBlueprint.sourceNarrationPlanId !== narrationPlan.narrationPlanId
    || sceneBlueprint.sourceNarrationFingerprint !== fingerprint(narrationPlan)
    || resolvedScenePlan.sourceBlueprintId !== sceneBlueprint.blueprintId
    || resolvedScenePlan.sourceBlueprintFingerprint !== fingerprint(sceneBlueprint)
    || choreographyPlan.sourceResolvedScenePlanId !== resolvedScenePlan.resolvedScenePlanId
    || choreographyPlan.sourceResolvedScenePlanFingerprint !== fingerprint(resolvedScenePlan)
  ) fail('FINAL_DOMAIN_SOURCE_MISMATCH', rawInput.eventPlanArtifactId)
  if (canonicalJson(choreographyPlan.actorInstances) !== canonicalJson(resolvedScenePlan.resolvedActors)) {
    fail('CHOREOGRAPHY_ACTOR_SET_INVALID', choreographyPlan.choreographyPlanId)
  }

  const eventUnits = new Map(eventPlan.eventUnits.map(unit => [unit.eventUnitId, unit]))
  const sceneBeats = new Map(sceneBlueprint.sceneBeats.map(beat => [beat.sceneBeatId, beat]))
  const actorGroups = new Map(sceneBlueprint.actorGroups.map(group => [group.groupId, group]))
  const formationBundles = new Map(resolvedScenePlan.resolvedFormationBundles.map(bundle => [bundle.actorGroupRef, bundle]))
  const scenarioBundles = new Map(indoPakTrajectoryScenario.bundles.map(bundle => [bundle.bundleId, bundle]))
  const assignments = new Map(resolvedScenePlan.actorRouteAssignments.map(assignment => [assignment.actorInstanceRef, assignment]))
  const lifecycles = new Map(choreographyPlan.actorLifecycles.map(lifecycle => [lifecycle.actorInstanceRef, lifecycle]))
  const motions = new Map(choreographyPlan.motionSegments.map(segment => [segment.actorInstanceRef, segment]))
  const entities = resolvedScenePlan.resolvedActors.map(actor => {
    const group = actorGroups.get(actor.actorGroupRef)
    const formation = formationBundles.get(actor.actorGroupRef)
    const scenario = formation ? scenarioBundles.get(formation.bundleId) : undefined
    const assignment = assignments.get(actor.actorInstanceId)
    if (!group || !formation || !scenario || !assignment || assignment.sourceKind !== 'catalog') {
      fail('CHOREOGRAPHY_ACTOR_BINDING_INVALID', actor.actorInstanceId)
    }
    if (motions.get(actor.actorInstanceId)?.routeAssignmentRef !== assignment.segmentId) {
      fail('CHOREOGRAPHY_ROUTE_ASSIGNMENT_INVALID', actor.actorInstanceId)
    }
    exactAvailableAsset(assetRegistry, scenario.modelAssetRef, 'model')
    exactAvailableAsset(assetRegistry, assignment.trajectoryAssetRef, 'trajectory')
    return {
      entityId: actor.actorInstanceId,
      displayName: `${group.semanticEntityRef} ${actor.role === 'leader' ? 'leader' : `wingman ${actor.ordinal}`}`,
      kind: group.role.includes('weapon') ? 'missile' as const : 'aircraft' as const,
      modelAssetId: scenario.modelAssetRef,
      defaultTrajectoryAssetId: assignment.trajectoryAssetRef,
      initialState: 'normal' as const,
    }
  })
  if (
    assignments.size !== entities.length
    || lifecycles.size !== entities.length
    || new Set([...assignments.values()].map(assignment => assignment.trajectoryAssetRef)).size !== entities.length
  ) fail('CHOREOGRAPHY_ACTOR_BINDING_INVALID', choreographyPlan.choreographyPlanId)

  const commands: CommandDraft[] = []
  const informationCards: InformationCardDraft[] = []
  for (const actor of resolvedScenePlan.resolvedActors) {
    const entity = entities.find(candidate => candidate.entityId === actor.actorInstanceId)!
    const assignment = assignments.get(actor.actorInstanceId)!
    const lifecycle = lifecycles.get(actor.actorInstanceId)
    const firstBeat = lifecycle ? sceneBeats.get(lifecycle.firstSceneBeatRef) : undefined
    const lastBeat = lifecycle ? sceneBeats.get(lifecycle.lastSceneBeatRef) : undefined
    const firstUnit = firstBeat ? eventUnits.get(firstBeat.eventUnitId) : undefined
    const lastUnit = lastBeat ? eventUnits.get(lastBeat.eventUnitId) : undefined
    if (!lifecycle || !firstBeat || !lastBeat || !firstUnit || !lastUnit) {
      fail('ACTOR_SCENE_BEAT_UNBOUND', actor.actorInstanceId)
    }
    const spawnId = `cmd:${actor.actorInstanceId}:spawn`
    const followId = `cmd:${actor.actorInstanceId}:follow-1`
    commands.push({
      commandId: spawnId,
      eventUnitId: firstUnit.eventUnitId,
      targetId: actor.actorInstanceId,
      type: 'model.spawn',
      params: { action: 'model.spawn', entityId: actor.actorInstanceId, modelAssetId: entity.modelAssetId! },
      dependsOn: [], onFailure: 'abort', evidenceRefs: [...firstUnit.evidenceRefs], desiredDurationMs: 500,
    })
    commands.push({
      commandId: followId,
      eventUnitId: firstUnit.eventUnitId,
      targetId: actor.actorInstanceId,
      type: 'model.follow_path',
      params: { action: 'model.follow_path', entityId: actor.actorInstanceId, trajectoryAssetId: assignment.trajectoryAssetRef },
      dependsOn: [spawnId], onFailure: 'abort', evidenceRefs: [...firstUnit.evidenceRefs], desiredDurationMs: 6_000,
    })
    commands.push({
      commandId: `cmd:${actor.actorInstanceId}:hide`,
      eventUnitId: lastUnit.eventUnitId,
      targetId: actor.actorInstanceId,
      type: 'model.hide',
      params: { action: 'model.hide', entityId: actor.actorInstanceId },
      dependsOn: [followId], onFailure: 'abort', evidenceRefs: [...lastUnit.evidenceRefs], desiredDurationMs: 500,
    })
  }

  for (const shot of choreographyPlan.shotPlan) {
    const beat = shot.sceneBeatRefs.length === 1 ? sceneBeats.get(shot.sceneBeatRefs[0]!) : undefined
    const unit = beat ? eventUnits.get(beat.eventUnitId) : undefined
    if (!beat || !unit) fail('CHOREOGRAPHY_SHOT_BINDING_INVALID', shot.shotId)
    const subjectBounds = shot.subjectRefs.map(actorId => {
      const assignment = assignments.get(actorId)
      if (!assignment) fail('CHOREOGRAPHY_SHOT_BINDING_INVALID', `${shot.shotId}: ${actorId}`)
      return routeBounds(assetRegistry, assignment.trajectoryAssetRef)
    })
    const requirement = narrativePlan.sceneRequirements.find(item => item.eventUnitId === unit.eventUnitId)
    const template = requirement?.preferredTemplate ?? (requirement ? inferTemplateFromStateChange(requirement) : 'deployment')
    commands.push({
      commandId: `cmd:${shot.shotId}:camera`, eventUnitId: unit.eventUnitId, targetId: 'camera:main',
      type: 'camera.transition', params: cameraParamsForBounds(unionBounds(subjectBounds), cameraProfile(template)),
      dependsOn: [], onFailure: 'abort', evidenceRefs: [...unit.evidenceRefs], desiredDurationMs: 1_500,
    })
  }

  const registry = new AssetRegistry(assetRegistry)
  for (const requirement of narrativePlan.sceneRequirements) {
    const unit = eventUnits.get(requirement.eventUnitId)
    const beat = sceneBlueprint.sceneBeats.find(item => item.eventUnitId === requirement.eventUnitId)
    const actorId = beat?.actorRefs.flatMap(groupRef =>
      resolvedScenePlan.resolvedActors.filter(actor => actor.actorGroupRef === groupRef))[0]?.actorInstanceId
    const entity = actorId ? entities.find(candidate => candidate.entityId === actorId) : entities[0]
    if (!unit || !entity) fail('EVENT_UNIT_NOT_FOUND', requirement.eventUnitId)
    const template = requirement.preferredTemplate ?? inferTemplateFromStateChange(requirement)
    const mediaIntents = beat?.mediaIntents ?? []
    const image = mediaIntents.includes('image') || template === 'return_and_summary' || template === 'status_explanation'
      ? selectAsset(registry, 'image', requirement)
      : undefined
    const video = mediaIntents.includes('video') || template === 'attack_chain'
      ? selectAsset(registry, 'video', requirement)
      : undefined
    const geojson = template === 'electronic_warfare' ? selectAsset(registry, 'geojson', requirement) : undefined
    const expansion = expandSupplementalRequirement(requirement, {
      eventUnit: unit,
      entity,
      modelAssetId: entity.modelAssetId,
      trajectoryAssetId: entity.defaultTrajectoryAssetId,
      trajectoryBounds: entity.defaultTrajectoryAssetId
        ? routeBounds(assetRegistry, entity.defaultTrajectoryAssetId)
        : undefined,
      imageAssetId: assetId(image, 'image'),
      videoAssetId: assetId(video, 'video'),
      geojsonAssetId: assetId(geojson, 'geojson'),
    })
    commands.push(...expansion.commands)
    informationCards.push(...expansion.informationCards)
    const requestedMedia = expandRequestedMedia(mediaIntents, {
      requirement,
      eventUnit: unit,
      entity,
      modelAssetId: entity.modelAssetId,
      trajectoryAssetId: entity.defaultTrajectoryAssetId,
      trajectoryBounds: entity.defaultTrajectoryAssetId
        ? routeBounds(assetRegistry, entity.defaultTrajectoryAssetId)
        : undefined,
      imageAssetId: assetId(image, 'image'),
      videoAssetId: assetId(video, 'video'),
      geojsonAssetId: assetId(geojson, 'geojson'),
    }, expansion.commands)
    commands.push(...requestedMedia.commands)
    informationCards.push(...requestedMedia.informationCards)
  }

  const scheduled = scheduleNarrative({
    eventPlan,
    narrativePlan,
    narrationPlan,
    commandDrafts: commands,
    informationCardDrafts: informationCards,
    capabilities: capabilityManifest,
  })
  const sourceArtifactIds = [
    rawInput.eventPlanArtifactId,
    rawInput.narrativePlanArtifactId,
    rawInput.narrationPlanArtifactId,
    rawInput.sceneBlueprintArtifactId,
    rawInput.resolvedScenePlanArtifactId,
    rawInput.choreographyPlanArtifactId,
    rawInput.assetRegistryArtifactId,
  ]
  const outputIds = [
    ...scheduled.subtitles.map(item => [item.subtitleId, item.evidenceRefs] as const),
    ...scheduled.commands.map(item => [item.commandId, item.evidenceRefs] as const),
    ...scheduled.informationCards.map(item => [item.cardId, item.evidenceRefs] as const),
  ]
  const diagnostics = [...assetRegistry.diagnostics, ...resolvedScenePlan.diagnostics]
    .sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`))
  const plan = canonicalRuntimePlanSchema.parse({
    schemaVersion: 'canonical-runtime-plan/v1',
    planId: `runtime:${choreographyPlan.choreographyPlanId}`,
    sourceDocumentId: eventPlan.documentId,
    eventPlanArtifactId: rawInput.eventPlanArtifactId,
    eventPlanId: eventPlan.planId,
    narrativePlanId: narrativePlan.narrativePlanId,
    capabilityManifestVersion: capabilityManifest.version,
    assetRegistryVersion: assetRegistry.registryVersion,
    totalDurationMs: scheduled.totalDurationMs,
    entities: [...entities].sort((left, right) => left.entityId.localeCompare(right.entityId)),
    subtitles: [...scheduled.subtitles].sort((left, right) => left.subtitleId.localeCompare(right.subtitleId)),
    commands: [...scheduled.commands].sort((left, right) => left.commandId.localeCompare(right.commandId)),
    informationCards: [...scheduled.informationCards].sort((left, right) => left.cardId.localeCompare(right.cardId)),
    lineage: outputIds.map(([outputId, evidenceRefs]) => ({ outputId, sourceArtifactIds, evidenceRefs }))
      .sort((left, right) => left.outputId.localeCompare(right.outputId)),
    diagnostics,
  })
  validatePlan(plan, rawInput)
  return plan
}
