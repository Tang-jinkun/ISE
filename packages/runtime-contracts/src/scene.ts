import { z } from 'zod';

const canonicalNonBlankString = z.string().regex(/^\S(?:[\s\S]*\S)?$/);
const nonEmptyId = canonicalNonBlankString;
const milliseconds = z.number().int().nonnegative();
const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
const coordinates = z.tuple([longitude, latitude]);
const assetId = z.string().regex(
  /^(model|trajectory|video|image|geojson):[a-z0-9][a-z0-9._-]*$/
);
const state = z.enum(['normal', 'warning', 'disabled', 'destroyed', 'hidden']);

export const diagnosticSchema = z.strictObject({
  code: nonEmptyId,
  severity: z.enum(['warning', 'error']),
  recoverable: z.boolean(),
  eventUnitId: nonEmptyId.optional(),
  commandId: nonEmptyId.optional(),
  assetId: assetId.optional(),
  message: canonicalNonBlankString
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

export const sceneEntitySchema = z.strictObject({
  entityId: nonEmptyId,
  displayName: canonicalNonBlankString,
  kind: z.enum(['aircraft', 'missile', 'location', 'other']),
  modelAssetId: assetId.regex(/^model:/).optional(),
  defaultTrajectoryAssetId: assetId.regex(/^trajectory:/).optional(),
  initialState: state
});
export type SceneEntity = z.infer<typeof sceneEntitySchema>;
const generatedTrajectorySchema = z.strictObject({
  assetId: assetId.regex(/^trajectory:/), generationMethod: z.literal('document-endpoints-v1'), sourceRefs: z.array(nonEmptyId).min(1),
  trajectory: z.strictObject({ format: z.literal('ise-trajectory/v1'), timeUnit: z.literal('ms'), coordinateOrder: z.literal('lng-lat-alt'), startTimeMs: milliseconds, endTimeMs: milliseconds, monotonic: z.literal(true), bounds: z.tuple([coordinates, coordinates]), points: z.array(z.strictObject({ timeMs: milliseconds, longitude, latitude, altitudeM: z.number().finite() })).min(2) }),
});
export type GeneratedTrajectory = z.infer<typeof generatedTrajectorySchema>;

export const overlayLayoutSchema = z.strictObject({
  xPct: z.number().finite().min(0).max(100),
  yPct: z.number().finite().min(0).max(100),
  widthPct: z.number().finite().positive().max(100),
  heightPct: z.number().finite().positive().max(100),
  zIndex: z.number().int(),
  opacity: z.number().finite().min(0).max(1),
  fit: z.enum(['contain', 'cover'])
});
export type OverlayLayout = z.infer<typeof overlayLayoutSchema>;

const baseItemShape = {
  id: nonEmptyId,
  eventUnitId: nonEmptyId,
  startMs: milliseconds,
  durationMs: milliseconds,
  evidenceRefs: z.array(nonEmptyId).min(1)
};

const subtitleParamsSchema = z.strictObject({
  text: canonicalNonBlankString,
  position: z.enum(['top', 'bottom']),
  maxWidthPct: z.number().finite().positive().max(100)
});
const imageParamsSchema = z.strictObject({
  layout: overlayLayoutSchema,
  enter: z.enum(['none', 'fade']),
  exit: z.enum(['none', 'fade'])
});
const videoParamsSchema = z.strictObject({
  layout: overlayLayoutSchema,
  volume: z.number().finite().min(0).max(1),
  playbackRate: z.number().finite().positive(),
  loop: z.boolean()
});
const markerParamsSchema = z.strictObject({
  coordinates,
  label: canonicalNonBlankString,
  color: canonicalNonBlankString
});
const geojsonParamsSchema = z.strictObject({
  lineColor: canonicalNonBlankString,
  lineWidth: z.number().finite().nonnegative(),
  fillColor: canonicalNonBlankString,
  fillOpacity: z.number().finite().min(0).max(1),
  circleColor: canonicalNonBlankString,
  circleRadius: z.number().finite().nonnegative(),
  keepAfterEnd: z.boolean()
});
const cameraTransitionParamsSchema = z.strictObject({
  center: coordinates,
  zoom: z.number().finite().min(0).max(24),
  pitch: z.number().finite().min(0).max(85),
  bearing: z.number().finite().min(-360).max(360),
  easing: z.enum(['linear', 'easeInOut'])
});
const cameraFollowActorParamsSchema = z.strictObject({
  action: z.literal('camera.follow_actor'),
  entityId: nonEmptyId,
  framing: z.enum(['tracking', 'close']),
  zoom: z.number().finite().min(0).max(24),
  pitch: z.number().finite().min(0).max(85),
  bearing: z.number().finite().min(-360).max(360),
  lookAheadMs: milliseconds,
  transitionMs: milliseconds
});
const cameraFollowGroupParamsSchema = z.strictObject({
  action: z.literal('camera.follow_group'),
  entityIds: z.array(nonEmptyId).min(1),
  framing: z.enum(['global', 'formation', 'engagement']),
  paddingPx: z.number().finite().nonnegative(),
  minZoom: z.number().finite().min(0).max(24),
  maxZoom: z.number().finite().min(0).max(24),
  pitch: z.number().finite().min(0).max(85),
  bearing: z.number().finite().min(-360).max(360),
  transitionMs: milliseconds
}).superRefine((params, context) => {
  if (params.minZoom > params.maxZoom) {
    context.addIssue({ code: 'custom', path: ['minZoom'], message: 'minZoom must not exceed maxZoom' });
  }
});
const cameraParamsSchema = z.union([
  cameraTransitionParamsSchema,
  cameraFollowActorParamsSchema,
  cameraFollowGroupParamsSchema
]);
const dataLinkParamsSchema = z.strictObject({
  sourceEntityId: nonEmptyId,
  targetEntityId: nonEmptyId,
  linkKind: z.enum(['awacs-fighter', 'fighter-missile'])
});
const hybridTimingSchema = z.strictObject({
  solver: z.literal('hybrid'),
  sourceTimeOriginMs: milliseconds.optional(),
  sourceStartMs: milliseconds,
  sourceEndMs: milliseconds,
  startMs: milliseconds,
  endMs: milliseconds,
  syncGroupId: nonEmptyId.optional(),
  status: z.enum(['resolved', 'unresolved']),
});
const spatialBindingSchema = z.strictObject({
  anchorEntityId: nonEmptyId,
  anchorLongitudeDeg: z.number().finite(),
  anchorLatitudeDeg: z.number().finite(),
  anchorAltitudeM: z.number().finite(),
  terminalLongitudeDeg: z.number().finite(),
  terminalLatitudeDeg: z.number().finite(),
  terminalAltitudeM: z.number().finite(),
});

export const modelActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('model.spawn'), entityId: nonEmptyId }),
  z.strictObject({
    action: z.literal('model.follow_path'),
    entityId: nonEmptyId,
    trajectoryAssetId: assetId.regex(/^trajectory:/),
    timing: hybridTimingSchema.extend({ spatialBinding: spatialBindingSchema.optional() }).optional(),
  }),
  z.strictObject({
    action: z.literal('model.set_state'),
    entityId: nonEmptyId,
    state
  }),
  z.strictObject({ action: z.literal('model.hide'), entityId: nonEmptyId })
]);

const subtitleItemSchema = z.strictObject({ ...baseItemShape, params: subtitleParamsSchema });
const imageItemSchema = z.strictObject({
  ...baseItemShape,
  assetId: assetId.regex(/^image:/),
  params: imageParamsSchema
});
const videoItemSchema = z.strictObject({
  ...baseItemShape,
  assetId: assetId.regex(/^video:/),
  params: videoParamsSchema
});
const markerItemSchema = z.strictObject({ ...baseItemShape, params: markerParamsSchema });
const geojsonItemSchema = z.strictObject({
  ...baseItemShape,
  assetId: assetId.regex(/^geojson:/),
  params: geojsonParamsSchema
});
const cameraItemSchema = z.strictObject({ ...baseItemShape, params: cameraParamsSchema });
const modelItemSchema = z.strictObject({ ...baseItemShape, params: modelActionSchema });
const dataLinkItemSchema = z.strictObject({ ...baseItemShape, params: dataLinkParamsSchema });

export const sceneInteractionSchema = z.strictObject({
  interactionId: nonEmptyId,
  engagementId: nonEmptyId,
  interactionTimeMs: milliseconds,
  interactionPoint: z.strictObject({
    longitudeDeg: z.number().finite(),
    latitudeDeg: z.number().finite(),
    altitudeM: z.number().finite(),
  }).optional(),
  spatialToleranceM: z.number().finite().nonnegative(),
  temporalToleranceMs: milliseconds,
  status: z.enum(['resolved', 'unresolved']),
  propagatedFromInteractionId: nonEmptyId.optional(),
  diagnostics: z.array(canonicalNonBlankString),
});
export type SceneInteraction = z.infer<typeof sceneInteractionSchema>;

export const sceneTrackItemSchema = z.union([
  subtitleItemSchema,
  imageItemSchema,
  videoItemSchema,
  markerItemSchema,
  geojsonItemSchema,
  cameraItemSchema,
  modelItemSchema,
  dataLinkItemSchema
]);
export type SceneTrackItem = z.infer<typeof sceneTrackItemSchema>;

const trackBase = {
  trackId: nonEmptyId,
  label: canonicalNonBlankString,
  visible: z.boolean()
};
export const sceneTrackSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...trackBase, type: z.literal('subtitle'), items: z.array(subtitleItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('image'), items: z.array(imageItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('video'), items: z.array(videoItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('marker'), items: z.array(markerItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('geojson'), items: z.array(geojsonItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('camera'), items: z.array(cameraItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('model'), items: z.array(modelItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('data_link'), items: z.array(dataLinkItemSchema) })
]);
export type SceneTrack = z.infer<typeof sceneTrackSchema>;

const baseSceneProjectConfigSchema = z.strictObject({
  schemaVersion: z.literal('ise-scene/v1'),
  sourceDocumentId: nonEmptyId,
  eventPlanArtifactId: nonEmptyId,
  runtimePlanArtifactId: nonEmptyId,
  totalDurationMs: milliseconds,
  entities: z.array(sceneEntitySchema),
  generatedTrajectories: z.array(generatedTrajectorySchema).default([]),
  tracks: z.array(sceneTrackSchema),
  interactions: z.array(sceneInteractionSchema).default([]),
  diagnostics: z.array(diagnosticSchema)
});

export const sceneProjectConfigSchema = baseSceneProjectConfigSchema.superRefine((config, context) => {
  const entityIds = new Set<string>();
  for (const [index, entity] of config.entities.entries()) {
    if (entityIds.has(entity.entityId)) {
      context.addIssue({ code: 'custom', path: ['entities', index, 'entityId'], message: 'Duplicate entityId' });
    }
    entityIds.add(entity.entityId);
  }

  const trackIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const [trackIndex, track] of config.tracks.entries()) {
    if (trackIds.has(track.trackId)) {
      context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'trackId'], message: 'Duplicate trackId' });
    }
    trackIds.add(track.trackId);
    for (const [itemIndex, trackItem] of track.items.entries()) {
      if (itemIds.has(trackItem.id)) {
        context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'id'], message: 'Duplicate item id' });
      }
      itemIds.add(trackItem.id);
      if (trackItem.startMs + trackItem.durationMs > config.totalDurationMs) {
        context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex], message: 'Track item exceeds totalDurationMs' });
      }
    }

    if (track.type === 'model') {
      for (const [itemIndex, trackItem] of track.items.entries()) {
        if (!entityIds.has(trackItem.params.entityId)) {
          context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'params', 'entityId'], message: 'Unknown model entityId' });
        }
      }
    }
    if (track.type === 'camera') {
      for (const [itemIndex, trackItem] of track.items.entries()) {
        if ('action' in trackItem.params && trackItem.params.action === 'camera.follow_actor') {
          if (!entityIds.has(trackItem.params.entityId)) {
            context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'params', 'entityId'], message: 'Unknown camera follow actor entityId' });
          }
        }
        if ('action' in trackItem.params && trackItem.params.action === 'camera.follow_group') {
          const groupEntityIds = new Set<string>();
          for (const [entityIndex, entityId] of trackItem.params.entityIds.entries()) {
            if (!entityIds.has(entityId)) {
              context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'params', 'entityIds', entityIndex], message: 'Unknown camera follow group entityId' });
            }
            if (groupEntityIds.has(entityId)) {
              context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'params', 'entityIds', entityIndex], message: 'Duplicate camera follow group entityId' });
            }
            groupEntityIds.add(entityId);
          }
        }
      }
    }
    if (track.type === 'data_link') {
      for (const [itemIndex, trackItem] of track.items.entries()) {
        if (!entityIds.has(trackItem.params.sourceEntityId)) {
          context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'params', 'sourceEntityId'], message: 'Unknown data link sourceEntityId' });
        }
        if (!entityIds.has(trackItem.params.targetEntityId)) {
          context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'params', 'targetEntityId'], message: 'Unknown data link targetEntityId' });
        }
        if (trackItem.params.sourceEntityId === trackItem.params.targetEntityId) {
          context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'items', itemIndex, 'params', 'targetEntityId'], message: 'Data link endpoints must differ' });
        }
      }
    }
  }
});
export type SceneProjectConfig = z.infer<typeof sceneProjectConfigSchema>;

export const sceneProjectConfigJsonSchema = {
  ...z.toJSONSchema(baseSceneProjectConfigSchema, {
    target: 'draft-2020-12'
  }),
  $comment: 'The runtime parser is authoritative for relational invariants including duplicate IDs, item-overrun arithmetic, and entity references.'
};
