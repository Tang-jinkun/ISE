import { z } from 'zod';

const nonEmptyId = z.string().trim().min(1);
const milliseconds = z.number().int().nonnegative();
const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
const coordinates = z.tuple([longitude, latitude]);
const assetId = z.string().regex(
  /^(model|trajectory|video|image|geojson):[a-z0-9][a-z0-9._-]*$/
);
const state = z.enum(['normal', 'warning', 'disabled', 'hidden']);

export const diagnosticSchema = z.strictObject({
  code: nonEmptyId,
  severity: z.enum(['warning', 'error']),
  recoverable: z.boolean(),
  eventUnitId: nonEmptyId.optional(),
  commandId: nonEmptyId.optional(),
  assetId: assetId.optional(),
  message: z.string().trim().min(1)
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

export const sceneEntitySchema = z.strictObject({
  entityId: nonEmptyId,
  displayName: z.string().trim().min(1),
  kind: z.enum(['aircraft', 'missile', 'location', 'other']),
  modelAssetId: assetId.regex(/^model:/).optional(),
  defaultTrajectoryAssetId: assetId.regex(/^trajectory:/).optional(),
  initialState: state
});
export type SceneEntity = z.infer<typeof sceneEntitySchema>;

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
  text: z.string().trim().min(1),
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
  label: z.string().trim().min(1),
  color: z.string().trim().min(1)
});
const geojsonParamsSchema = z.strictObject({
  lineColor: z.string().trim().min(1),
  lineWidth: z.number().finite().nonnegative(),
  fillColor: z.string().trim().min(1),
  fillOpacity: z.number().finite().min(0).max(1),
  circleColor: z.string().trim().min(1),
  circleRadius: z.number().finite().nonnegative(),
  keepAfterEnd: z.boolean()
});
const cameraParamsSchema = z.strictObject({
  center: coordinates,
  zoom: z.number().finite().min(0).max(24),
  pitch: z.number().finite().min(0).max(85),
  bearing: z.number().finite().min(-360).max(360),
  easing: z.enum(['linear', 'easeInOut'])
});

export const modelActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('model.spawn'), entityId: nonEmptyId }),
  z.strictObject({
    action: z.literal('model.follow_path'),
    entityId: nonEmptyId,
    trajectoryAssetId: assetId.regex(/^trajectory:/)
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

export const sceneTrackItemSchema = z.union([
  subtitleItemSchema,
  imageItemSchema,
  videoItemSchema,
  markerItemSchema,
  geojsonItemSchema,
  cameraItemSchema,
  modelItemSchema
]);
export type SceneTrackItem = z.infer<typeof sceneTrackItemSchema>;

const trackBase = {
  trackId: nonEmptyId,
  label: z.string().trim().min(1),
  visible: z.boolean()
};
export const sceneTrackSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...trackBase, type: z.literal('subtitle'), items: z.array(subtitleItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('image'), items: z.array(imageItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('video'), items: z.array(videoItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('marker'), items: z.array(markerItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('geojson'), items: z.array(geojsonItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('camera'), items: z.array(cameraItemSchema) }),
  z.strictObject({ ...trackBase, type: z.literal('model'), items: z.array(modelItemSchema) })
]);
export type SceneTrack = z.infer<typeof sceneTrackSchema>;

const baseSceneProjectConfigSchema = z.strictObject({
  schemaVersion: z.literal('ise-scene/v1'),
  sourceDocumentId: nonEmptyId,
  eventPlanArtifactId: nonEmptyId,
  runtimePlanArtifactId: nonEmptyId,
  totalDurationMs: milliseconds,
  entities: z.array(sceneEntitySchema),
  tracks: z.array(sceneTrackSchema),
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
  }
});
export type SceneProjectConfig = z.infer<typeof sceneProjectConfigSchema>;

export const sceneProjectConfigJsonSchema = {
  ...z.toJSONSchema(baseSceneProjectConfigSchema, {
    target: 'draft-2020-12'
  }),
  $comment: 'The runtime parser is authoritative for relational invariants including duplicate IDs, item-overrun arithmetic, and entity references.'
};
