import type { EventPlan } from '../contracts/eventPlan.ts'
import type { SceneRequirement, TemplateName } from '../contracts/narrativePlan.ts'
import type { CommandDraft, RuntimeEntity } from '../contracts/runtimePlan.ts'

export interface InformationCardDraft {
  cardId: string
  eventUnitId: string
  text: string
  evidenceRefs: string[]
  desiredDurationMs: number
}

export interface TemplateContext {
  requirement: SceneRequirement
  eventUnit: EventPlan['eventUnits'][number]
  entity: RuntimeEntity
  modelAssetId?: string
  trajectoryAssetId?: string
  trajectoryBounds?: [[number, number], [number, number]]
  imageAssetId?: string
  videoAssetId?: string
  geojsonAssetId?: string
}

export interface TemplateExpansion {
  commands: CommandDraft[]
  informationCards: InformationCardDraft[]
}

export type TemplateExpander = (context: TemplateContext) => TemplateExpansion

export type CameraProfile = 'deployment' | 'interception' | 'counterattack'

export function cameraParamsForBounds(
  [[west, south], [east, north]]: [[number, number], [number, number]],
  profile: CameraProfile,
) {
  const center: [number, number] = [(west + east) / 2, (south + north) / 2]
  const longitudeSpan = (east - west) * Math.cos(center[1] * Math.PI / 180)
  const span = Math.max(longitudeSpan, north - south, 0.01)
  const baseZoom = Math.min(11, Math.max(4, Math.log2(360 / (span * 2.5))))
  const profiles = {
    deployment: { zoomOffset: 0, pitch: 38, bearing: 0 },
    interception: { zoomOffset: 0.4, pitch: 48, bearing: 15 },
    counterattack: { zoomOffset: 1.25, pitch: 60, bearing: 40 },
  } as const
  const view = profiles[profile]
  return {
    center,
    zoom: Math.min(24, baseZoom + view.zoomOffset),
    pitch: view.pitch,
    bearing: view.bearing,
    easing: 'easeInOut' as const,
  }
}

function safeId(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item'
}

function builder(context: TemplateContext) {
  let ordinal = 0
  const commands: CommandDraft[] = []
  const informationCards: InformationCardDraft[] = []
  const common = (targetId: string) => ({
    commandId: `cmd:${safeId(context.eventUnit.eventUnitId)}:${safeId(context.requirement.requirementId)}:${++ordinal}`,
    eventUnitId: context.eventUnit.eventUnitId,
    targetId,
    dependsOn: [] as string[],
    onFailure: 'abort' as const,
    evidenceRefs: [...context.eventUnit.evidenceRefs],
  })
  const spawnAndFollow = () => {
    if (!context.modelAssetId) throw new Error('REQUIRED_MODEL_ASSET_MISSING')
    if (!context.trajectoryAssetId) throw new Error('REQUIRED_TRAJECTORY_ASSET_MISSING')
    const spawn = {
      ...common(context.entity.entityId),
      type: 'model.spawn' as const,
      params: { action: 'model.spawn' as const, entityId: context.entity.entityId, modelAssetId: context.modelAssetId },
      desiredDurationMs: 500,
    }
    commands.push(spawn)
    const follow: CommandDraft = {
      ...common(context.entity.entityId),
      type: 'model.follow_path',
      dependsOn: [spawn.commandId],
      params: { action: 'model.follow_path', entityId: context.entity.entityId, trajectoryAssetId: context.trajectoryAssetId },
      desiredDurationMs: 6_000,
    }
    commands.push(follow)
    return { spawn, follow }
  }
  const camera = (profile: CameraProfile) => {
    if (!context.trajectoryBounds) throw new Error('REQUIRED_TRAJECTORY_BOUNDS_MISSING')
    commands.push({
      ...common('camera:main'), type: 'camera.transition',
      params: cameraParamsForBounds(context.trajectoryBounds, profile),
      desiredDurationMs: 1_500,
    })
  }
  const state = (value: 'normal' | 'warning' | 'disabled' | 'hidden') => {
    if (!context.modelAssetId) return
    commands.push({
      ...common(context.entity.entityId), type: 'model.set_state',
      params: { action: 'model.set_state', entityId: context.entity.entityId, state: value },
      desiredDurationMs: 1_000,
    })
  }
  const card = (text: string) => informationCards.push({
    cardId: `card:${safeId(context.eventUnit.eventUnitId)}:${safeId(context.requirement.requirementId)}:${informationCards.length + 1}`,
    eventUnitId: context.eventUnit.eventUnitId,
    text,
    evidenceRefs: [...context.eventUnit.evidenceRefs],
    desiredDurationMs: 4_000,
  })
  return { commands, informationCards, common, spawnAndFollow, camera, state, card }
}

const deployment: TemplateExpander = context => {
  const out = builder(context); out.spawnAndFollow(); out.camera('deployment'); return out
}
const attackChain: TemplateExpander = context => {
  const out = builder(context); out.state('warning')
  if (context.videoAssetId) out.commands.push({
    ...out.common('overlay:video'), type: 'video.play',
    params: { assetId: context.videoAssetId, layout: { xPct: 60, yPct: 5, widthPct: 35, heightPct: 30, zIndex: 20, opacity: 1, fit: 'contain' }, volume: 0, playbackRate: 1, loop: false },
    desiredDurationMs: 6_000,
  }); else out.card('Engagement video unavailable')
  return out
}
const interception: TemplateExpander = context => {
  const out = builder(context); out.spawnAndFollow(); out.camera('interception'); return out
}
const electronicWarfare: TemplateExpander = context => {
  const out = builder(context); out.state('disabled')
  if (context.geojsonAssetId) out.commands.push({
    ...out.common('map:electronic-warfare'), type: 'geojson.show',
    params: { assetId: context.geojsonAssetId, lineColor: '#ffcc00', lineWidth: 2, fillColor: '#ffcc00', fillOpacity: 0.15, circleColor: '#ffcc00', circleRadius: 5, keepAfterEnd: false },
    desiredDurationMs: 5_000,
  }); else out.card('Electronic-warfare area unavailable')
  return out
}
const counterattack: TemplateExpander = context => {
  const out = builder(context); out.spawnAndFollow(); out.state('warning'); out.camera('counterattack'); return out
}
const withdrawal: TemplateExpander = context => {
  const out = builder(context); const { follow } = out.spawnAndFollow(); out.commands.push({
    ...out.common(context.entity.entityId), type: 'model.hide',
    dependsOn: [follow.commandId],
    params: { action: 'model.hide', entityId: context.entity.entityId }, desiredDurationMs: 500,
  }); return out
}
const returnAndSummary: TemplateExpander = context => {
  const out = builder(context)
  if (context.imageAssetId) out.commands.push({
    ...out.common('overlay:summary'), type: 'image.show',
    params: { assetId: context.imageAssetId, layout: { xPct: 65, yPct: 8, widthPct: 30, heightPct: 30, zIndex: 20, opacity: 1, fit: 'contain' }, enter: 'fade', exit: 'fade' },
    desiredDurationMs: 5_000,
  }); else out.card('Summary image unavailable')
  return out
}
const genericMovement: TemplateExpander = context => {
  const out = builder(context); out.spawnAndFollow(); return out
}
const statusExplanation: TemplateExpander = context => {
  const out = builder(context)
  if (context.imageAssetId) out.commands.push({
    ...out.common('overlay:status'), type: 'image.show',
    params: { assetId: context.imageAssetId, layout: { xPct: 65, yPct: 8, widthPct: 30, heightPct: 30, zIndex: 20, opacity: 1, fit: 'contain' }, enter: 'fade', exit: 'fade' },
    desiredDurationMs: 5_000,
  })
  out.commands.push({
    ...out.common('marker:status'), type: 'marker.show',
    params: { coordinates: [74.5, 32.5], label: context.requirement.requiredFacts[0] ?? context.eventUnit.title, color: '#ffcc00' },
    desiredDurationMs: 4_000,
  }); return out
}

export const restrictedTemplates: Record<TemplateName, TemplateExpander> = {
  deployment,
  attack_chain: attackChain,
  interception,
  electronic_warfare: electronicWarfare,
  counterattack,
  withdrawal,
  return_and_summary: returnAndSummary,
  generic_movement: genericMovement,
  status_explanation: statusExplanation,
}

const templateTerms: readonly [TemplateName, readonly string[]][] = [
  ['electronic_warfare', ['electronic warfare', 'jam', 'disabled']],
  ['counterattack', ['counterattack', 'counter attack']],
  ['interception', ['interception', 'intercept']],
  ['withdrawal', ['withdrawal', 'withdraw']],
  ['return_and_summary', ['return', 'summary']],
  ['attack_chain', ['attack', 'engage']],
  ['deployment', ['deployment', 'deploy']],
  ['generic_movement', ['movement', 'move', 'route']],
]

export function inferTemplateFromStateChange(requirement: SceneRequirement): TemplateName {
  const source = requirement.stateChanges.join(' ').normalize('NFKC').toLowerCase()
  return templateTerms.find(([, terms]) => terms.some(term => source.includes(term)))?.[0] ?? 'status_explanation'
}

export function expandRequirement(requirement: SceneRequirement, context: Omit<TemplateContext, 'requirement'>): TemplateExpansion {
  const template = requirement.preferredTemplate ?? inferTemplateFromStateChange(requirement)
  return restrictedTemplates[template]({ ...context, requirement })
}

const supplementalTemplates = new Set<TemplateName>([
  'attack_chain', 'electronic_warfare', 'return_and_summary', 'status_explanation',
])

export function expandSupplementalRequirement(
  requirement: SceneRequirement,
  context: Omit<TemplateContext, 'requirement'>,
): TemplateExpansion {
  const template = requirement.preferredTemplate ?? inferTemplateFromStateChange(requirement)
  if (!supplementalTemplates.has(template)) return { commands: [], informationCards: [] }
  const expanded = restrictedTemplates[template]({ ...context, requirement })
  return {
    commands: expanded.commands.filter(command => !command.type.startsWith('model.') && command.type !== 'camera.transition'),
    informationCards: expanded.informationCards,
  }
}

export function expandRequestedMedia(
  mediaIntents: readonly string[],
  context: TemplateContext,
  existingCommands: readonly CommandDraft[],
): TemplateExpansion {
  const commands: CommandDraft[] = []
  const informationCards: InformationCardDraft[] = []
  const common = (kind: 'image' | 'video', targetId: string) => ({
    commandId: `cmd:${safeId(context.eventUnit.eventUnitId)}:${safeId(context.requirement.requirementId)}:media:${kind}`,
    eventUnitId: context.eventUnit.eventUnitId,
    targetId,
    dependsOn: [] as string[],
    onFailure: 'abort' as const,
    evidenceRefs: [...context.eventUnit.evidenceRefs],
  })
  if (mediaIntents.includes('image') && !existingCommands.some(command => command.type === 'image.show')) {
    if (context.imageAssetId) commands.push({
      ...common('image', 'overlay:summary'),
      type: 'image.show',
      params: {
        assetId: context.imageAssetId,
        layout: { xPct: 65, yPct: 8, widthPct: 30, heightPct: 30, zIndex: 20, opacity: 1, fit: 'contain' },
        enter: 'fade',
        exit: 'fade',
      },
      desiredDurationMs: 5_000,
    })
    else informationCards.push({
      cardId: `card:${safeId(context.eventUnit.eventUnitId)}:${safeId(context.requirement.requirementId)}:media:image`,
      eventUnitId: context.eventUnit.eventUnitId,
      text: 'Summary image unavailable',
      evidenceRefs: [...context.eventUnit.evidenceRefs],
      desiredDurationMs: 4_000,
    })
  }
  if (mediaIntents.includes('video') && !existingCommands.some(command => command.type === 'video.play')) {
    if (context.videoAssetId) commands.push({
      ...common('video', 'overlay:video'),
      type: 'video.play',
      params: {
        assetId: context.videoAssetId,
        layout: { xPct: 60, yPct: 5, widthPct: 35, heightPct: 30, zIndex: 20, opacity: 1, fit: 'contain' },
        volume: 0,
        playbackRate: 1,
        loop: false,
      },
      desiredDurationMs: 6_000,
    })
    else informationCards.push({
      cardId: `card:${safeId(context.eventUnit.eventUnitId)}:${safeId(context.requirement.requirementId)}:media:video`,
      eventUnitId: context.eventUnit.eventUnitId,
      text: 'Engagement video unavailable',
      evidenceRefs: [...context.eventUnit.evidenceRefs],
      desiredDurationMs: 4_000,
    })
  }
  return { commands, informationCards }
}
