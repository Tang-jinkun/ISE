import { createHash } from 'node:crypto'
import { eventPlanSchema, type EventPlan } from '../contracts/eventPlan.ts'
import { narrativePlanSchema, type NarrativePlan, type SceneRequirement, type TemplateName } from '../contracts/narrativePlan.ts'
import { assetRegistrySnapshotSchema, type AssetRegistryEntry, type AssetRegistrySnapshot } from '../contracts/assetRegistry.ts'
import {
  canonicalRuntimePlanSchema,
  runtimeCommandSchema,
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
import { solveHybridTiming, solveSynchronizedHybridTiming } from './hybridTimingSolver.ts'
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
  preferredMediaAssetIds,
  type CameraProfile,
  type InformationCardDraft,
} from './templates.ts'
import { scheduleNarrative, SUBTITLE_VISUAL_LEAD_MS } from './scheduler.ts'

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
  preferredAssetIds: readonly string[] = [],
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
  for (const preferredAssetId of preferredAssetIds) {
    const candidate = registry.entries.get(preferredAssetId)
    if (!candidate || candidate.kind !== kind) continue
    const selected = resolveCandidates([candidate])
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
  noOverlap(plan.commands.filter(command => command.type.startsWith('camera.')), 'CAMERA_COMMAND_OVERLAP')
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
      ? selectAsset(registry, 'image', requirement, preferredMediaAssetIds(template, 'image'))
      : undefined
    const video = template === 'attack_chain'
      ? selectAsset(registry, 'video', requirement, preferredMediaAssetIds(template, 'video'))
      : undefined
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
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

function routePointAtPlaybackTime(
  assetRegistry: AssetRegistrySnapshot,
  trajectoryAssetId: string,
  playbackTimeMs: number,
  followStartMs: number,
  followEndMs: number,
): [number, number] {
  const asset = exactAvailableAsset(assetRegistry, trajectoryAssetId, 'trajectory')
  if (asset.kind !== 'trajectory' || !asset.trajectory.points) {
    fail('REQUIRED_ASSET_MISSING', `trajectory geometry: ${trajectoryAssetId}`)
  }
  const progress = followEndMs <= followStartMs
    ? 1
    : Math.max(0, Math.min(1, (playbackTimeMs - followStartMs) / (followEndMs - followStartMs)))
  const points = asset.trajectory.points
  const firstTimeMs = points[0]!.timeMs
  const timeMs = firstTimeMs + progress * (points.at(-1)!.timeMs - firstTimeMs)
  let low = 0
  let high = points.length - 1
  while (low + 1 < high) {
    const middle = (low + high) >>> 1
    if (points[middle]!.timeMs <= timeMs) low = middle
    else high = middle
  }
  const start = points[low]!
  const end = points[Math.min(low + 1, points.length - 1)]!
  const ratio = end.timeMs === start.timeMs ? 0 : (timeMs - start.timeMs) / (end.timeMs - start.timeMs)
  const longitudeDelta = ((((end.longitude - start.longitude) % 360) + 540) % 360) - 180
  const longitude = start.longitude + longitudeDelta * ratio
  return [
    ((((longitude + 180) % 360) + 360) % 360) - 180,
    start.latitude + (end.latitude - start.latitude) * ratio,
  ]
}

function routeSampleAtPlaybackTime(
  assetRegistry: AssetRegistrySnapshot,
  trajectoryAssetId: string,
  playbackTimeMs: number,
  followStartMs: number,
  followEndMs: number,
): { longitude: number, latitude: number, altitudeM: number } {
  const asset = exactAvailableAsset(assetRegistry, trajectoryAssetId, 'trajectory')
  if (asset.kind !== 'trajectory' || !asset.trajectory.points?.length) {
    fail('REQUIRED_ASSET_MISSING', `trajectory geometry: ${trajectoryAssetId}`)
  }
  const progress = followEndMs <= followStartMs
    ? 1
    : Math.max(0, Math.min(1, (playbackTimeMs - followStartMs) / (followEndMs - followStartMs)))
  const points = asset.trajectory.points
  const first = points[0]!
  const last = points.at(-1)!
  const [longitude, latitude] = routePointAtPlaybackTime(assetRegistry, trajectoryAssetId, playbackTimeMs, followStartMs, followEndMs)
  return {
    longitude,
    latitude,
    altitudeM: first.altitudeM + (last.altitudeM - first.altitudeM) * progress,
  }
}

function approximateDistanceMeters(
  left: { longitude: number, latitude: number },
  right: { longitude: number, latitude: number },
): number {
  const latitudeRadians = (left.latitude + right.latitude) * Math.PI / 360
  const longitudeMeters = (left.longitude - right.longitude) * 111_320 * Math.cos(latitudeRadians)
  const latitudeMeters = (left.latitude - right.latitude) * 110_540
  return Math.hypot(longitudeMeters, latitudeMeters)
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
  const actorCommandDrafts: Array<{
    actorInstanceRef: string
    spawn: CommandDraft
    follow: CommandDraft
    hide: CommandDraft
  }> = []
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
    const spawn: CommandDraft = {
      commandId: spawnId,
      eventUnitId: firstUnit.eventUnitId,
      targetId: actor.actorInstanceId,
      type: 'model.spawn',
      params: { action: 'model.spawn', entityId: actor.actorInstanceId, modelAssetId: entity.modelAssetId! },
      dependsOn: [], onFailure: 'abort', evidenceRefs: [...firstUnit.evidenceRefs], desiredDurationMs: 500,
    }
    const follow: CommandDraft = {
      commandId: followId,
      eventUnitId: firstUnit.eventUnitId,
      targetId: actor.actorInstanceId,
      type: 'model.follow_path',
      params: (() => {
        const trajectory = exactAvailableAsset(assetRegistry, assignment.trajectoryAssetRef, 'trajectory')
        if (trajectory.kind !== 'trajectory') fail('REQUIRED_ASSET_MISSING', assignment.trajectoryAssetRef)
        const points = trajectory.trajectory.points
        const sourceStartMs = points?.[0]?.timeMs ?? trajectory.trajectory.startTimeMs
        const sourceEndMs = points?.at(-1)?.timeMs ?? trajectory.trajectory.endTimeMs
        const engagement = choreographyPlan.weaponEngagements.find(item =>
          item.weaponRef === actor.actorInstanceId || item.targetRef === actor.actorInstanceId)
        const counterpartRef = engagement
          ? engagement.weaponRef === actor.actorInstanceId ? engagement.targetRef : engagement.weaponRef
          : undefined
        const counterpartAssignment = counterpartRef ? assignments.get(counterpartRef) : undefined
        const counterpartAsset = counterpartAssignment
          ? exactAvailableAsset(assetRegistry, counterpartAssignment.trajectoryAssetRef, 'trajectory')
          : undefined
        const counterpartOrigin = counterpartAsset?.kind === 'trajectory' ? counterpartAsset.trajectory.sourceTimeOriginMs : undefined
        const timingResult = solveHybridTiming(
          { sourceStartMs, sourceEndMs, sourceTimeOriginMs: trajectory.trajectory.sourceTimeOriginMs },
          { startMs: 0, endMs: Math.max(1, sourceEndMs - sourceStartMs) },
        )
        return {
          action: 'model.follow_path' as const,
          entityId: actor.actorInstanceId,
          trajectoryAssetId: assignment.trajectoryAssetRef,
          timing: {
            ...timingResult,
            status: counterpartOrigin !== undefined && trajectory.trajectory.sourceTimeOriginMs !== undefined
              && counterpartOrigin !== trajectory.trajectory.sourceTimeOriginMs ? 'unresolved' : timingResult.status,
            syncGroupId: engagement ? `engagement:${engagement.engagementId}` : undefined,
          },
        }
      })(),
      dependsOn: [spawnId], onFailure: 'abort', evidenceRefs: [...firstUnit.evidenceRefs],
    }
    const hide: CommandDraft = {
      commandId: `cmd:${actor.actorInstanceId}:hide`,
      eventUnitId: lastUnit.eventUnitId,
      targetId: actor.actorInstanceId,
      type: 'model.hide',
      params: { action: 'model.hide', entityId: actor.actorInstanceId },
      dependsOn: [followId], onFailure: 'abort', evidenceRefs: [...lastUnit.evidenceRefs], desiredDurationMs: 500,
    }
    actorCommandDrafts.push({ actorInstanceRef: actor.actorInstanceId, spawn, follow, hide })
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
      ? selectAsset(registry, 'image', requirement, preferredMediaAssetIds(template, 'image'))
      : undefined
    const video = mediaIntents.includes('video') || template === 'attack_chain'
      ? selectAsset(registry, 'video', requirement, preferredMediaAssetIds(template, 'video'))
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
  const subtitles = new Map(scheduled.subtitles.map(subtitle => [subtitle.subtitleId, subtitle]))
  const actorPlaybackWindows = new Map(resolvedScenePlan.resolvedActors.map(actor => {
    const lifecycle = lifecycles.get(actor.actorInstanceId)
    const firstBeat = lifecycle ? sceneBeats.get(lifecycle.firstSceneBeatRef) : undefined
    const lastBeat = lifecycle ? sceneBeats.get(lifecycle.lastSceneBeatRef) : undefined
    const firstSubtitle = firstBeat?.subtitleId ? subtitles.get(firstBeat.subtitleId) : undefined
    const lastSubtitle = lastBeat?.subtitleId ? subtitles.get(lastBeat.subtitleId) : undefined
    if (!firstSubtitle || !lastSubtitle) fail('ACTOR_SCENE_BEAT_UNBOUND', actor.actorInstanceId)
    const spawnStartMs = firstSubtitle.startMs + SUBTITLE_VISUAL_LEAD_MS
    const followStartMs = spawnStartMs + capabilityManifest.minimumDurations['model.spawn']
    return [actor.actorInstanceId, {
      spawnStartMs,
      followStartMs,
      followEndMs: lastSubtitle.startMs + lastSubtitle.durationMs,
    }] as const
  }))
  const engagementTimingStatus = new Map<string, 'resolved' | 'unresolved'>()
  // Resolve engagement actors against one shared source clock when the
  // imported trajectories carry an origin. Legacy relative-only routes retain
  // their existing subtitle fit, while the result is still emitted below.
  for (const engagement of choreographyPlan.weaponEngagements) {
    const weaponAssignment = assignments.get(engagement.weaponRef)
    const targetAssignment = assignments.get(engagement.targetRef)
    const weaponWindow = actorPlaybackWindows.get(engagement.weaponRef)
    const targetWindow = actorPlaybackWindows.get(engagement.targetRef)
    if (!weaponAssignment || !targetAssignment || !weaponWindow || !targetWindow) continue
    const weaponAsset = exactAvailableAsset(assetRegistry, weaponAssignment.trajectoryAssetRef, 'trajectory')
    const targetAsset = exactAvailableAsset(assetRegistry, targetAssignment.trajectoryAssetRef, 'trajectory')
    if (weaponAsset.kind !== 'trajectory' || targetAsset.kind !== 'trajectory') continue
    if (weaponAsset.trajectory.sourceTimeOriginMs === undefined || targetAsset.trajectory.sourceTimeOriginMs === undefined) continue
    const timing = solveSynchronizedHybridTiming([
      {
        sourceStartMs: weaponAsset.trajectory.startTimeMs,
        sourceEndMs: weaponAsset.trajectory.endTimeMs,
        sourceTimeOriginMs: weaponAsset.trajectory.sourceTimeOriginMs,
      },
      {
        sourceStartMs: targetAsset.trajectory.startTimeMs,
        sourceEndMs: targetAsset.trajectory.endTimeMs,
        sourceTimeOriginMs: targetAsset.trajectory.sourceTimeOriginMs,
      },
    ], {
      startMs: Math.max(weaponWindow.followStartMs, targetWindow.followStartMs),
      endMs: Math.min(weaponWindow.followEndMs, targetWindow.followEndMs),
    })
    engagementTimingStatus.set(engagement.weaponRef, timing.status)
    engagementTimingStatus.set(engagement.targetRef, timing.status)
    if (timing.status === 'resolved') {
      actorPlaybackWindows.set(engagement.weaponRef, { ...weaponWindow, followStartMs: timing.startMs, followEndMs: timing.endMs })
      actorPlaybackWindows.set(engagement.targetRef, { ...targetWindow, followStartMs: timing.startMs, followEndMs: timing.endMs })
    }
  }
  // A weapon trajectory's absolute first sample is its launch instant. Anchor
  // that instant to the launcher's existing source-clock playback so the
  // weapon is born at the platform instead of drifting ahead of or behind it
  // when their narrative windows have different durations.
  for (const engagement of choreographyPlan.weaponEngagements) {
    const launcherAssignment = assignments.get(engagement.launcherRef)
    const weaponAssignment = assignments.get(engagement.weaponRef)
    const launcherWindow = actorPlaybackWindows.get(engagement.launcherRef)
    const weaponWindow = actorPlaybackWindows.get(engagement.weaponRef)
    if (!launcherAssignment || !weaponAssignment || !launcherWindow || !weaponWindow) continue
    const launcherAsset = exactAvailableAsset(assetRegistry, launcherAssignment.trajectoryAssetRef, 'trajectory')
    const weaponAsset = exactAvailableAsset(assetRegistry, weaponAssignment.trajectoryAssetRef, 'trajectory')
    if (launcherAsset.kind !== 'trajectory' || weaponAsset.kind !== 'trajectory') continue
    const launcherOrigin = launcherAsset.trajectory.sourceTimeOriginMs
    const weaponOrigin = weaponAsset.trajectory.sourceTimeOriginMs
    const launcherSourceStartMs = launcherAsset.trajectory.startTimeMs
    const launcherSourceEndMs = launcherAsset.trajectory.endTimeMs
    let launchSourceMs = launcherOrigin !== undefined && weaponOrigin !== undefined
      ? weaponOrigin + weaponAsset.trajectory.startTimeMs - launcherOrigin
      : undefined
    if (launchSourceMs === undefined) {
      const weaponStart = weaponAsset.trajectory.points?.[0]
      const closestLauncherPoint = weaponStart && launcherAsset.trajectory.points
        ? launcherAsset.trajectory.points.reduce((closest, point) => {
          const distanceM = approximateDistanceMeters(point, weaponStart)
          return !closest || distanceM < closest.distanceM ? { point, distanceM } : closest
        }, undefined as { point: { timeMs: number, longitude: number, latitude: number }, distanceM: number } | undefined)
        : undefined
      if (!closestLauncherPoint || closestLauncherPoint.distanceM > 25_000) continue
      launchSourceMs = closestLauncherPoint.point.timeMs
    }
    if (launchSourceMs < launcherSourceStartMs || launchSourceMs > launcherSourceEndMs) continue
    const launcherProgress = (launchSourceMs - launcherSourceStartMs)
      / Math.max(1, launcherSourceEndMs - launcherSourceStartMs)
    const anchoredFollowStartMs = Math.round(launcherWindow.followStartMs
      + launcherProgress * (launcherWindow.followEndMs - launcherWindow.followStartMs))
    const followStartMs = Math.max(weaponWindow.followStartMs, anchoredFollowStartMs)
    if (followStartMs >= weaponWindow.followEndMs - capabilityManifest.minimumDurations['model.follow_path']) continue
    actorPlaybackWindows.set(engagement.weaponRef, {
      ...weaponWindow,
      spawnStartMs: followStartMs - capabilityManifest.minimumDurations['model.spawn'],
      followStartMs,
    })
  }
  // Bind every resolved weapon route to its launcher and target geometry. The
  // catalog route remains the shape source; this only supplies scene-specific
  // start/end anchors for the runtime transform.
  for (const engagement of choreographyPlan.weaponEngagements) {
    const launcherAssignment = assignments.get(engagement.launcherRef)
    const weaponAssignment = assignments.get(engagement.weaponRef)
    const targetAssignment = assignments.get(engagement.targetRef)
    if (!launcherAssignment || !weaponAssignment || !targetAssignment) continue
    const launcherAsset = exactAvailableAsset(assetRegistry, launcherAssignment.trajectoryAssetRef, 'trajectory')
    const weaponAsset = exactAvailableAsset(assetRegistry, weaponAssignment.trajectoryAssetRef, 'trajectory')
    const targetAsset = exactAvailableAsset(assetRegistry, targetAssignment.trajectoryAssetRef, 'trajectory')
    if (launcherAsset.kind !== 'trajectory' || weaponAsset.kind !== 'trajectory' || targetAsset.kind !== 'trajectory') continue
    const weaponDraft = actorCommandDrafts.find(item => item.actorInstanceRef === engagement.weaponRef)?.follow
    if (!weaponDraft || weaponDraft.type !== 'model.follow_path' || !weaponDraft.params.timing) continue
    const launcherWindow = actorPlaybackWindows.get(engagement.launcherRef)
    if (!launcherWindow) continue
    const launcherPoints = launcherAsset.trajectory.points
    const weaponPoints = weaponAsset.trajectory.points
    const targetPoints = targetAsset.trajectory.points
    const targetPoint = targetPoints?.at(-1)
    if (!launcherPoints?.length || !weaponPoints?.length || !targetPoints?.length || !targetPoint) continue
    const weaponWindow = actorPlaybackWindows.get(engagement.weaponRef)
    const launchProgress = weaponWindow
      ? clamp01((weaponWindow.followStartMs - launcherWindow.followStartMs)
        / Math.max(1, launcherWindow.followEndMs - launcherWindow.followStartMs))
      : 0
    const launchSourceMs = launcherAsset.trajectory.startTimeMs
      + launchProgress * (launcherAsset.trajectory.endTimeMs - launcherAsset.trajectory.startTimeMs)
    const launcherPoint = launcherPoints.reduce((best, point) =>
      Math.abs(point.timeMs - launchSourceMs) < Math.abs(best.timeMs - launchSourceMs) ? point : best, launcherPoints[0]!)
    weaponDraft.params.timing = {
      ...weaponDraft.params.timing,
      spatialBinding: {
        anchorEntityId: engagement.launcherRef,
        anchorLongitudeDeg: launcherPoint.longitude,
        anchorLatitudeDeg: launcherPoint.latitude,
        anchorAltitudeM: launcherPoint.altitudeM,
        terminalLongitudeDeg: targetPoint.longitude,
        terminalLatitudeDeg: targetPoint.latitude,
        terminalAltitudeM: targetPoint.altitudeM,
      },
    }
  }
  const cameraCommands: CanonicalCommand[] = []
  const interactionEndMs = new Map<string, number>()
  const destroyedTargetHides = new Map<string, CanonicalCommand>()
  const interceptedTargetHides = new Map<string, CanonicalCommand>()
  const engagementForShot = (shot: ChoreographyPlan['shotPlan'][number]) =>
    choreographyPlan.weaponEngagements.find(engagement =>
      shot.shotId.includes(`:${engagement.weaponRef}:`))
  const impactEngagements = choreographyPlan.weaponEngagements.filter(engagement =>
    engagement.outcome === 'interception' || engagement.outcome === 'destroyed')
  if (impactEngagements.length > 0) exactAvailableAsset(assetRegistry, 'video:missile-impact', 'video')
  for (const narrationBeat of narrationPlan.beats) {
    const subtitle = subtitles.get(narrationBeat.subtitleId)
    if (!subtitle) fail('NARRATION_SCENE_BEAT_UNBOUND', narrationBeat.subtitleId)
    const subtitleShots = choreographyPlan.shotPlan.filter(shot => shot.subtitleId === narrationBeat.subtitleId)
    if (subtitleShots.length === 0) continue
    const phaseShots = subtitleShots.filter(shot => shot.phase)
    const shotIntervals = new Map<string, readonly [number, number]>()
    const visualStartMs = subtitle.startMs + SUBTITLE_VISUAL_LEAD_MS
    const visualEndMs = subtitle.startMs + subtitle.durationMs
    const transitionDurationMs = capabilityManifest.minimumDurations['camera.transition']
    const followMinimumMs = capabilityManifest.minimumDurations['camera.follow_group']
    const intervalMinimumMs = transitionDurationMs + followMinimumMs
    if (phaseShots.length > 0) {
      const establishing = subtitleShots.find(shot => !shot.phase)
      if (!establishing || subtitleShots.length !== phaseShots.length + 1
        || visualEndMs - visualStartMs < subtitleShots.length * intervalMinimumMs) {
        fail('NARRATION_VISUAL_DURATION_CONFLICT', narrationBeat.subtitleId)
      }
      const establishingEndMs = visualStartMs + intervalMinimumMs
      shotIntervals.set(establishing.shotId, [visualStartMs, establishingEndMs])
      const remainingMs = visualEndMs - establishingEndMs
      const phaseBaseDurationMs = Math.floor(remainingMs / phaseShots.length)
      let cursorMs = establishingEndMs
      for (const [index, shot] of phaseShots.entries()) {
        const endMs = index === phaseShots.length - 1
          ? visualEndMs
          : cursorMs + phaseBaseDurationMs
        shotIntervals.set(shot.shotId, [cursorMs, endMs])
        cursorMs = endMs
      }
    } else {
      for (const shot of subtitleShots) {
        if (visualEndMs - visualStartMs < intervalMinimumMs) {
          fail('NARRATION_VISUAL_DURATION_CONFLICT', narrationBeat.subtitleId)
        }
        shotIntervals.set(shot.shotId, [visualStartMs, visualEndMs])
      }
    }
    for (const shot of phaseShots) {
      const engagement = engagementForShot(shot)
      const interval = shotIntervals.get(shot.shotId)
      if (shot.phase === 'terminal' && engagement && interval) {
        interactionEndMs.set(engagement.engagementId, interval[1])
      }
      if (shot.phase !== 'terminal' || engagement?.outcome !== 'destroyed' || !interval) continue
      const weaponPlayback = actorPlaybackWindows.get(engagement.weaponRef)
      if (!weaponPlayback) fail('CHOREOGRAPHY_SHOT_BINDING_INVALID', shot.shotId)
      actorPlaybackWindows.set(engagement.weaponRef, {
        ...weaponPlayback,
        followEndMs: interval[1],
      })
    }
    for (const shot of subtitleShots) {
      const sceneBeat = shot.sceneBeatRefs.length === 1 ? sceneBeats.get(shot.sceneBeatRefs[0]!) : undefined
      const unit = sceneBeat ? eventUnits.get(sceneBeat.eventUnitId) : undefined
      const engagement = engagementForShot(shot)
      const interval = shotIntervals.get(shot.shotId)
      if (!sceneBeat || !unit || !interval) fail('CHOREOGRAPHY_SHOT_BINDING_INVALID', shot.shotId)
      const [startMs, endMs] = interval
      const isEngagementShot = phaseShots.length > 0
      if (shot.phase && !engagement) fail('CHOREOGRAPHY_SHOT_BINDING_INVALID', shot.shotId)
      const subjectRefs = shot.phase === 'launch'
        ? [engagement!.launcherRef, engagement!.weaponRef]
        : shot.phase === 'midcourse'
          ? [engagement!.weaponRef, engagement!.targetRef]
          : shot.phase === 'terminal'
            && (engagement?.outcome === 'interception' || engagement?.outcome === 'destroyed')
            ? [engagement.weaponRef, engagement.targetRef]
          : shot.phase === 'aftermath' && engagement?.outcome === 'interception'
            ? [engagement.launcherRef, engagement.weaponRef]
            : shot.phase
              ? [engagement!.targetRef]
              : shot.subjectRefs.length >= 5
                ? resolvedScenePlan.resolvedActors
                  .filter(actor => {
                    const playback = actorPlaybackWindows.get(actor.actorInstanceId)
                    return playback !== undefined
                      && playback.followStartMs < subtitle.startMs + subtitle.durationMs
                      && playback.followEndMs > subtitle.startMs
                  })
                  .map(actor => actor.actorInstanceId)
                : shot.subjectRefs
      if (subjectRefs.length === 0) fail('CHOREOGRAPHY_SHOT_BINDING_INVALID', shot.shotId)
      const subjectBounds = subjectRefs.map(actorId => {
        const assignment = assignments.get(actorId)
        const playbackWindow = actorPlaybackWindows.get(actorId)
        if (!assignment || !playbackWindow) fail('CHOREOGRAPHY_SHOT_BINDING_INVALID', `${shot.shotId}: ${actorId}`)
        if (!shot.phase) return routeBounds(assetRegistry, assignment.trajectoryAssetRef)
        const point = routePointAtPlaybackTime(
          assetRegistry,
          assignment.trajectoryAssetRef,
          startMs + transitionDurationMs,
          playbackWindow.followStartMs,
          playbackWindow.followEndMs,
        )
        return [point, point] as [[number, number], [number, number]]
      })
      const requirement = narrativePlan.sceneRequirements.find(item => item.eventUnitId === unit.eventUnitId)
      const template = requirement?.preferredTemplate ?? (requirement ? inferTemplateFromStateChange(requirement) : 'deployment')
      const camera = cameraParamsForBounds(unionBounds(subjectBounds), cameraProfile(template))
      const followStartMs = startMs + transitionDurationMs
      const evidenceRefs = engagement ? engagement.evidenceRefs : unit.evidenceRefs
      cameraCommands.push(runtimeCommandSchema.parse({
        commandId: `cmd:${shot.shotId}:camera`, eventUnitId: unit.eventUnitId, targetId: 'camera:main',
        type: 'camera.transition',
        params: camera,
        startMs, durationMs: transitionDurationMs, dependsOn: [], onFailure: 'abort', evidenceRefs: [...evidenceRefs],
      }))
      if (subjectRefs.length === 1) {
        cameraCommands.push(runtimeCommandSchema.parse({
          commandId: `cmd:${shot.shotId}:follow-actor`, eventUnitId: unit.eventUnitId, targetId: 'camera:main',
          type: 'camera.follow_actor', params: {
            action: 'camera.follow_actor', entityId: subjectRefs[0]!,
            framing: shot.phase === 'terminal' || shot.phase === 'aftermath' ? 'close' : 'tracking',
            zoom: Math.min(11.5, camera.zoom), pitch: Math.min(35, camera.pitch), bearing: camera.bearing,
            lookAheadMs: 0, transitionMs: transitionDurationMs,
          },
          startMs: followStartMs, durationMs: endMs - followStartMs,
          dependsOn: [], onFailure: 'abort', evidenceRefs: [...evidenceRefs],
        }))
      } else {
        const global = !isEngagementShot && subjectRefs.length >= 5
        const interceptionTerminal = shot.phase === 'terminal' && engagement?.outcome === 'interception'
        cameraCommands.push(runtimeCommandSchema.parse({
          commandId: `cmd:${shot.shotId}:follow-group`, eventUnitId: unit.eventUnitId, targetId: 'camera:main',
          type: 'camera.follow_group', params: {
            action: 'camera.follow_group', entityIds: subjectRefs,
            framing: global ? 'global' : isEngagementShot ? 'engagement' : 'formation',
            paddingPx: global ? 120 : interceptionTerminal ? 180 : 100,
            minZoom: global ? 4 : isEngagementShot ? 6 : 5,
            maxZoom: global ? 7 : interceptionTerminal ? 8 : isEngagementShot ? 10 : 9,
            pitch: global ? 35 : interceptionTerminal ? Math.min(35, camera.pitch) : camera.pitch,
            bearing: camera.bearing, transitionMs: transitionDurationMs,
          },
          startMs: followStartMs, durationMs: endMs - followStartMs,
          dependsOn: [], onFailure: 'abort', evidenceRefs: [...evidenceRefs],
        }))
      }
      if (shot.phase === 'terminal' && (engagement!.outcome === 'interception' || engagement!.outcome === 'destroyed')) {
        cameraCommands.push(runtimeCommandSchema.parse({
          commandId: `cmd:${shot.shotId}:impact-video`, eventUnitId: unit.eventUnitId, targetId: 'overlay:missile-impact',
          type: 'video.play', params: {
            assetId: 'video:missile-impact',
            layout: { xPct: 64, yPct: 6, widthPct: 30, heightPct: 24, zIndex: 30, opacity: 1, fit: 'cover' },
            volume: 0, playbackRate: 1, loop: false,
          },
          startMs: followStartMs, durationMs: endMs - followStartMs,
          dependsOn: [], onFailure: 'abort', evidenceRefs: [...engagement!.evidenceRefs],
        }))
        if (engagement!.outcome === 'interception') {
          const interceptedHide = runtimeCommandSchema.parse({
            commandId: `cmd:${shot.shotId}:intercepted-hide`, eventUnitId: unit.eventUnitId, targetId: engagement!.targetRef,
            type: 'model.hide', params: { action: 'model.hide', entityId: engagement!.targetRef },
            // Keep both weapons visible through the terminal interval so the
            // shared endpoint is observable before the intercepted weapon is
            // removed from the scene.
            startMs: endMs, durationMs: capabilityManifest.minimumDurations['model.hide'],
            dependsOn: [], onFailure: 'abort', evidenceRefs: [...engagement!.evidenceRefs],
          })
          const existingHide = interceptedTargetHides.get(engagement!.targetRef)
          if (!existingHide || interceptedHide.startMs < existingHide.startMs) {
            interceptedTargetHides.set(engagement!.targetRef, interceptedHide)
          }
        }
      }
      if (shot.phase === 'aftermath' && engagement!.outcome === 'destroyed') {
        const stateDurationMs = 1_000
        cameraCommands.push(runtimeCommandSchema.parse({
          commandId: `cmd:${shot.shotId}:destroyed`, eventUnitId: unit.eventUnitId, targetId: engagement!.targetRef,
          type: 'model.set_state', params: { action: 'model.set_state', entityId: engagement!.targetRef, state: 'destroyed' },
          startMs, durationMs: stateDurationMs, dependsOn: [], onFailure: 'abort', evidenceRefs: [...engagement!.evidenceRefs],
        }))
        destroyedTargetHides.set(engagement!.targetRef, runtimeCommandSchema.parse({
          commandId: `cmd:${shot.shotId}:destroyed-hide`, eventUnitId: unit.eventUnitId, targetId: engagement!.targetRef,
          type: 'model.hide', params: { action: 'model.hide', entityId: engagement!.targetRef },
          startMs: endMs, durationMs: capabilityManifest.minimumDurations['model.hide'],
          dependsOn: [], onFailure: 'abort', evidenceRefs: [...engagement!.evidenceRefs],
        }))
      }
    }
  }
  const scheduleActorCommand = (
    draft: CommandDraft,
    startMs: number,
    durationMs: number,
  ): CanonicalCommand => {
    const { desiredDurationMs: _desiredDurationMs, ...command } = draft
    return runtimeCommandSchema.parse({ ...command, startMs, durationMs })
  }
  // Close each engagement at the terminal shot boundary. This makes the two
  // routes and their target state share the same observable interaction time.
  for (const engagement of choreographyPlan.weaponEngagements) {
    const interactionEnd = interactionEndMs.get(engagement.engagementId)
    if (interactionEnd === undefined) continue
    const weaponWindow = actorPlaybackWindows.get(engagement.weaponRef)
    const targetWindow = actorPlaybackWindows.get(engagement.targetRef)
    const weaponDraft = actorCommandDrafts.find(item => item.actorInstanceRef === engagement.weaponRef)?.follow
    const targetAssignment = assignments.get(engagement.targetRef)
    const weaponAssignment = assignments.get(engagement.weaponRef)
    if (!weaponWindow || !targetWindow || !weaponDraft || weaponDraft.type !== 'model.follow_path'
      || !weaponDraft.params.timing || !targetAssignment || !weaponAssignment) continue
    const interactionStart = Math.max(weaponWindow.followStartMs, targetWindow.followStartMs)
    if (interactionEnd <= interactionStart) continue
    actorPlaybackWindows.set(engagement.weaponRef, { ...weaponWindow, followEndMs: interactionEnd })
    actorPlaybackWindows.set(engagement.targetRef, { ...targetWindow, followEndMs: interactionEnd })
    const targetPoint = routeSampleAtPlaybackTime(
      assetRegistry,
      targetAssignment.trajectoryAssetRef,
      interactionEnd,
      targetWindow.followStartMs,
      targetWindow.followEndMs,
    )
    const launcherAssignment = assignments.get(engagement.launcherRef)
    const launcherWindow = actorPlaybackWindows.get(engagement.launcherRef)
    const launchPoint = launcherAssignment && launcherWindow
      ? routeSampleAtPlaybackTime(assetRegistry, launcherAssignment.trajectoryAssetRef, weaponWindow.followStartMs,
        launcherWindow.followStartMs, launcherWindow.followEndMs)
      : undefined
    const binding = weaponDraft.params.timing.spatialBinding
    if (binding && targetPoint && launchPoint) {
      weaponDraft.params.timing = {
        ...weaponDraft.params.timing,
        spatialBinding: {
          ...binding,
          anchorLongitudeDeg: launchPoint.longitude,
          anchorLatitudeDeg: launchPoint.latitude,
          anchorAltitudeM: launchPoint.altitudeM,
          terminalLongitudeDeg: targetPoint.longitude,
          terminalLatitudeDeg: targetPoint.latitude,
          terminalAltitudeM: targetPoint.altitudeM,
        },
      }
    }
  }
  const actorCommands = actorCommandDrafts.flatMap(({ actorInstanceRef, spawn, follow, hide }) => {
    const playbackWindow = actorPlaybackWindows.get(actorInstanceRef)
    if (!playbackWindow) fail('ACTOR_SCENE_BEAT_UNBOUND', actorInstanceRef)
    const { spawnStartMs, followStartMs, followEndMs } = playbackWindow
    const spawnDurationMs = capabilityManifest.minimumDurations['model.spawn']
    const followDurationMs = followEndMs - followStartMs
    if (followDurationMs < capabilityManifest.minimumDurations['model.follow_path']) {
      fail('NARRATION_VISUAL_DURATION_CONFLICT', actorInstanceRef)
    }
    const destroyedHide = destroyedTargetHides.get(actorInstanceRef)
    const interceptedHide = interceptedTargetHides.get(actorInstanceRef)
    const followWithNarrativeWindow = follow.type === 'model.follow_path' && follow.params.timing
      ? {
        ...follow,
        params: {
          ...follow.params,
          timing: {
            ...follow.params.timing,
            startMs: followStartMs,
            endMs: followEndMs,
          },
        },
      }
      : follow
    return [
      scheduleActorCommand(spawn, spawnStartMs, spawnDurationMs),
      scheduleActorCommand(followWithNarrativeWindow, followStartMs, followDurationMs),
      ...(destroyedHide || interceptedHide ? [] : [scheduleActorCommand(hide, followEndMs, capabilityManifest.minimumDurations['model.hide'])]),
    ]
  })
  const modelHides = [
    ...actorCommands,
    ...destroyedTargetHides.values(),
    ...interceptedTargetHides.values(),
  ].filter((command): command is Extract<CanonicalCommand, { type: 'model.hide' }> => command.type === 'model.hide')
  const dataLinkCommands = choreographyPlan.relationSegments.map(relation => {
    const sceneBeat = sceneBeats.get(relation.sceneBeatRef)
    const subtitle = sceneBeat?.subtitleId ? subtitles.get(sceneBeat.subtitleId) : undefined
    const unit = sceneBeat ? eventUnits.get(sceneBeat.eventUnitId) : undefined
    if (!sceneBeat || !subtitle || !unit) fail('NARRATION_SCENE_BEAT_UNBOUND', relation.sceneBeatRef)
    const startMs = subtitle.startMs + SUBTITLE_VISUAL_LEAD_MS
    const targetHide = relation.linkKind === 'fighter-missile'
      ? modelHides.find(command => command.params.entityId === relation.targetRef)
      : undefined
    const endMs = targetHide?.startMs ?? subtitle.startMs + subtitle.durationMs
    return runtimeCommandSchema.parse({
      commandId: `cmd:${relation.segmentId}:show`, eventUnitId: unit.eventUnitId,
      targetId: `data-link:${relation.sourceRef}:${relation.targetRef}`,
      type: 'data_link.show', params: {
        sourceEntityId: relation.sourceRef, targetEntityId: relation.targetRef, linkKind: relation.linkKind,
      },
      startMs, durationMs: endMs - startMs,
      dependsOn: [], onFailure: 'abort', evidenceRefs: [...relation.evidenceRefs],
    })
  })
  const finalCommands = [
    ...scheduled.commands,
    ...dataLinkCommands,
    ...cameraCommands,
    ...actorCommands,
    ...destroyedTargetHides.values(),
    ...interceptedTargetHides.values(),
  ]
  const totalDurationMs = Math.max(
    1,
    ...scheduled.subtitles.map(item => item.startMs + item.durationMs),
    ...finalCommands.map(item => item.startMs + item.durationMs),
    ...scheduled.informationCards.map(item => item.startMs + item.durationMs),
  )
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
    ...finalCommands.map(item => [item.commandId, item.evidenceRefs] as const),
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
    totalDurationMs,
    entities: [...entities].sort((left, right) => left.entityId.localeCompare(right.entityId)),
    subtitles: [...scheduled.subtitles].sort((left, right) => left.subtitleId.localeCompare(right.subtitleId)),
    commands: [...finalCommands].sort((left, right) => left.commandId.localeCompare(right.commandId)),
    informationCards: [...scheduled.informationCards].sort((left, right) => left.cardId.localeCompare(right.cardId)),
    lineage: outputIds.map(([outputId, evidenceRefs]) => ({ outputId, sourceArtifactIds, evidenceRefs }))
      .sort((left, right) => left.outputId.localeCompare(right.outputId)),
    diagnostics,
  })
  validatePlan(plan, rawInput)
  return plan
}
