import { z } from 'zod'
import { compilationDiagnosticSchema } from '../services/runtimeDiagnostics.ts'

export const runtimeEntitySchema = z.strictObject({
  entityId: z.string().min(1),
  displayName: z.string().min(1),
  kind: z.enum(['aircraft', 'missile', 'location', 'other']),
  modelAssetId: z.string().regex(/^model:[a-z0-9][a-z0-9._-]*$/).optional(),
  defaultTrajectoryAssetId: z.string().regex(/^trajectory:[a-z0-9][a-z0-9._-]*$/).optional(),
  initialState: z.enum(['normal', 'warning', 'disabled', 'destroyed', 'hidden']),
})
export type RuntimeEntity = z.infer<typeof runtimeEntitySchema>

export const scheduledSubtitleSchema = z.strictObject({
  subtitleId: z.string().min(1),
  eventUnitId: z.string().min(1),
  text: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  importance: z.enum(['high', 'medium', 'low']),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  position: z.enum(['top', 'bottom']),
  maxWidthPct: z.number().positive().max(100),
})
export type ScheduledSubtitle = z.infer<typeof scheduledSubtitleSchema>

export const informationCardSchema = z.strictObject({
  cardId: z.string().min(1),
  eventUnitId: z.string().min(1),
  text: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  evidenceRefs: z.array(z.string().min(1)).min(1),
})
export type InformationCard = z.infer<typeof informationCardSchema>

export const lineageSchema = z.strictObject({
  outputId: z.string().min(1),
  sourceArtifactIds: z.array(z.string().min(1)).min(1),
  evidenceRefs: z.array(z.string().min(1)),
})

export const runtimeCommandTypeSchema = z.enum([
  'image.show', 'video.play', 'marker.show', 'geojson.show', 'camera.transition',
  'camera.follow_actor', 'camera.follow_group',
  'data_link.show', 'model.spawn', 'model.follow_path', 'model.set_state', 'model.hide',
])
export type RuntimeCommandType = z.infer<typeof runtimeCommandTypeSchema>

export const overlayLayoutSchema = z.strictObject({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  widthPct: z.number().positive().max(100),
  heightPct: z.number().positive().max(100),
  zIndex: z.number().int(),
  opacity: z.number().min(0).max(1),
  fit: z.enum(['contain', 'cover']),
})

const commandBase = {
  commandId: z.string().min(1),
  eventUnitId: z.string().min(1),
  targetId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  dependsOn: z.array(z.string().min(1)),
  onFailure: z.enum(['abort', 'warn', 'skip']),
  evidenceRefs: z.array(z.string().min(1)),
}

export const runtimeCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...commandBase, type: z.literal('image.show'), params: z.strictObject({
    assetId: z.string().regex(/^image:/), layout: overlayLayoutSchema,
    enter: z.enum(['none', 'fade']), exit: z.enum(['none', 'fade']),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('video.play'), params: z.strictObject({
    assetId: z.string().regex(/^video:/), layout: overlayLayoutSchema,
    volume: z.number().min(0).max(1), playbackRate: z.number().positive().max(4), loop: z.boolean(),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('marker.show'), params: z.strictObject({
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    label: z.string().min(1), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('geojson.show'), params: z.strictObject({
    assetId: z.string().regex(/^geojson:/), lineColor: z.string().min(1), lineWidth: z.number().nonnegative(),
    fillColor: z.string().min(1), fillOpacity: z.number().min(0).max(1),
    circleColor: z.string().min(1), circleRadius: z.number().nonnegative(), keepAfterEnd: z.boolean(),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('camera.transition'), params: z.strictObject({
    center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    zoom: z.number().min(0).max(24), pitch: z.number().min(0).max(85),
    bearing: z.number().min(-360).max(360), easing: z.enum(['linear', 'easeInOut']),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('camera.follow_actor'), params: z.strictObject({
    action: z.literal('camera.follow_actor'), entityId: z.string().min(1), framing: z.enum(['tracking', 'close']),
    zoom: z.number().min(0).max(24), pitch: z.number().min(0).max(85), bearing: z.number().min(-360).max(360),
    lookAheadMs: z.number().int().nonnegative(), transitionMs: z.number().int().nonnegative(),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('camera.follow_group'), params: z.strictObject({
    action: z.literal('camera.follow_group'),
    entityIds: z.array(z.string().min(1)).min(1).refine(ids => new Set(ids).size === ids.length, 'entityIds must be unique'),
    framing: z.enum(['global', 'formation', 'engagement']), paddingPx: z.number().finite().nonnegative(),
    minZoom: z.number().min(0).max(24), maxZoom: z.number().min(0).max(24),
    pitch: z.number().min(0).max(85), bearing: z.number().min(-360).max(360), transitionMs: z.number().int().nonnegative(),
  }).refine(params => params.minZoom <= params.maxZoom, { message: 'minZoom must not exceed maxZoom', path: ['minZoom'] }) }),
  z.strictObject({ ...commandBase, type: z.literal('data_link.show'), params: z.strictObject({
    sourceEntityId: z.string().min(1), targetEntityId: z.string().min(1),
    linkKind: z.enum(['awacs-fighter', 'fighter-missile']),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('model.spawn'), params: z.strictObject({
    action: z.literal('model.spawn'), entityId: z.string().min(1), modelAssetId: z.string().regex(/^model:/),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('model.follow_path'), params: z.strictObject({
    action: z.literal('model.follow_path'), entityId: z.string().min(1), trajectoryAssetId: z.string().regex(/^trajectory:/),
    timing: z.strictObject({
      solver: z.literal('hybrid'),
      sourceTimeOriginMs: z.number().int().nonnegative().optional(),
      sourceStartMs: z.number().int().nonnegative(),
      sourceEndMs: z.number().int().nonnegative(),
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().nonnegative(),
      syncGroupId: z.string().min(1).optional(),
      status: z.enum(['resolved', 'unresolved']),
      spatialBinding: z.strictObject({
        anchorEntityId: z.string().min(1),
        anchorLongitudeDeg: z.number().finite(),
        anchorLatitudeDeg: z.number().finite(),
        anchorAltitudeM: z.number().finite(),
        terminalLongitudeDeg: z.number().finite(),
        terminalLatitudeDeg: z.number().finite(),
        terminalAltitudeM: z.number().finite(),
      }).optional(),
    }).optional(),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('model.set_state'), params: z.strictObject({
    action: z.literal('model.set_state'), entityId: z.string().min(1), state: z.enum(['normal', 'warning', 'disabled', 'destroyed', 'hidden']),
  }) }),
  z.strictObject({ ...commandBase, type: z.literal('model.hide'), params: z.strictObject({
    action: z.literal('model.hide'), entityId: z.string().min(1),
  }) }),
])

export type CanonicalCommand = z.infer<typeof runtimeCommandSchema>
export type CommandDraft = CanonicalCommand extends infer Command
  ? Command extends CanonicalCommand
    ? Omit<Command, 'startMs' | 'durationMs'> & { desiredDurationMs?: number }
    : never
  : never

export const canonicalRuntimePlanSchema = z.strictObject({
  schemaVersion: z.literal('canonical-runtime-plan/v1'),
  planId: z.string().min(1),
  sourceDocumentId: z.string().min(1),
  eventPlanArtifactId: z.string().min(1),
  eventPlanId: z.string().min(1),
  narrativePlanId: z.string().min(1),
  capabilityManifestVersion: z.literal('ise-capabilities/v1'),
  assetRegistryVersion: z.string().min(1),
  totalDurationMs: z.number().int().positive(),
  entities: z.array(runtimeEntitySchema),
  subtitles: z.array(scheduledSubtitleSchema),
  commands: z.array(runtimeCommandSchema),
  informationCards: z.array(informationCardSchema),
  lineage: z.array(lineageSchema),
  diagnostics: z.array(compilationDiagnosticSchema),
})

export type CanonicalRuntimePlan = z.infer<typeof canonicalRuntimePlanSchema>
