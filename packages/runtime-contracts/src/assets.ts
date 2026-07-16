import { z } from 'zod';

export const assetIdSchema = z.string().regex(
  /^(model|trajectory|video|image|geojson):[a-z0-9][a-z0-9._-]*$/
);
export const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const trajectoryCurationSchema = z.strictObject({
  policyId: z.literal('trajectory.shift-suffix/v1'),
  expectedSourceFingerprint: fingerprintSchema,
  startIndex: z.number().int().positive(),
  deltaMs: z.number().int().positive(),
});
export type TrajectoryCuration = z.infer<typeof trajectoryCurationSchema>;

export const trajectoryRepairMetadataSchema = z.strictObject({
  sourceFingerprint: fingerprintSchema,
  repairRuleVersion: z.string().min(1),
  affectedSampleRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  boundaryTimesBeforeMs: z.tuple([z.number().int(), z.number().int()]),
  boundaryTimesAfterMs: z.tuple([z.number().int(), z.number().int()]),
  offsetMs: z.number().int(),
});
export type TrajectoryRepairMetadata = z.infer<typeof trajectoryRepairMetadataSchema>;

const canonicalNonBlankString = z.string().regex(/^\S(?:[\s\S]*\S)?$/);
const safeRelativePath = z.string().regex(
  /^(?!\s)(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*\/\/)(?!.*\/$)(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$)).*\S$/
);

export const modelAssetMetadataSchema = z.strictObject({
  scale: z.number().finite().positive(),
  rotationOffsetDeg: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite()
  ]),
  altitudeOffsetM: z.number().finite(),
  entityTypes: z.array(z.enum(['aircraft', 'missile', 'other'])).min(1)
});

export const trajectoryAssetMetadataSchema = z.strictObject({
  format: z.literal('ise-trajectory/v1'),
  timeUnit: z.literal('ms'),
  coordinateOrder: z.literal('lng-lat-alt'),
  startTimeMs: z.number().int().nonnegative(),
  endTimeMs: z.number().int().nonnegative(),
  monotonic: z.literal(true),
  bounds: z.tuple([
    z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
    z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)])
  ]).refine(([[west, south], [east, north]]) => west <= east && south <= north, {
    message: 'bounds must be ordered southwest to northeast'
  }).optional(),
  curation: trajectoryCurationSchema.optional(),
  repair: trajectoryRepairMetadataSchema.optional(),
}).refine(value => value.endTimeMs >= value.startTimeMs, {
  message: 'endTimeMs must be greater than or equal to startTimeMs',
  path: ['endTimeMs']
});

export const videoAssetMetadataSchema = z.strictObject({
  durationMs: z.number().int().positive(),
  codec: canonicalNonBlankString
});

export const imageAssetMetadataSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fit: z.enum(['contain', 'cover'])
});

const commonEntryShape = {
  displayName: canonicalNonBlankString,
  aliases: z.array(canonicalNonBlankString),
  fingerprint: fingerprintSchema,
  sourceRelativePath: safeRelativePath,
  objectName: safeRelativePath,
  size: z.number().int().nonnegative(),
  availability: z.enum(['available', 'missing', 'invalid']),
  criticality: z.enum(['required', 'optional']),
  fallbackAssetIds: z.array(assetIdSchema),
  allowFallback: z.boolean()
};

const modelEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^model:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('model'),
  mediaType: z.literal('model/gltf-binary'),
  model: modelAssetMetadataSchema
});
const trajectoryEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^trajectory:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('trajectory'),
  mediaType: z.literal('application/vnd.ise.trajectory+json'),
  trajectory: trajectoryAssetMetadataSchema
});
const videoEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^video:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('video'),
  mediaType: z.literal('video/mp4'),
  video: videoAssetMetadataSchema
});
const imageEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^image:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('image'),
  mediaType: z.enum(['image/png', 'image/jpeg']),
  image: imageAssetMetadataSchema
});
const geojsonEntrySchema = z.strictObject({
  ...commonEntryShape,
  assetId: z.string().regex(/^geojson:[a-z0-9][a-z0-9._-]*$/),
  kind: z.literal('geojson'),
  mediaType: z.literal('application/geo+json')
});

export const assetManifestEntrySchema = z.discriminatedUnion('kind', [
  modelEntrySchema,
  trajectoryEntrySchema,
  videoEntrySchema,
  imageEntrySchema,
  geojsonEntrySchema
]);
export type AssetManifestEntry = z.infer<typeof assetManifestEntrySchema>;

export const publicAssetCatalogEntrySchema = z.discriminatedUnion('kind', [
  modelEntrySchema.omit({ sourceRelativePath: true, objectName: true }),
  trajectoryEntrySchema.omit({ sourceRelativePath: true, objectName: true }),
  videoEntrySchema.omit({ sourceRelativePath: true, objectName: true }),
  imageEntrySchema.omit({ sourceRelativePath: true, objectName: true }),
  geojsonEntrySchema.omit({ sourceRelativePath: true, objectName: true })
]);
export type PublicAssetCatalogEntry = z.infer<typeof publicAssetCatalogEntrySchema>;

export const assetNameMappingSchema = z.strictObject({
  sourceName: canonicalNonBlankString,
  sourceKind: z.enum(['report', 'trajectory', 'model', 'operator']),
  assetId: assetIdSchema,
  note: canonicalNonBlankString
});

const assetSeedManifestBaseSchema = z.strictObject({
  schemaVersion: z.literal('ise-assets/v1'),
  assets: z.array(assetManifestEntrySchema).min(1),
  nameMappings: z.array(assetNameMappingSchema)
});

export const assetSeedManifestSchema = assetSeedManifestBaseSchema.superRefine((manifest, context) => {
  const assetIds = new Set<string>();
  const assetsById = new Map(manifest.assets.map(entry => [entry.assetId, entry]));
  const objectNames = new Set<string>();
  const sourcePaths = new Set<string>();
  for (const [index, entry] of manifest.assets.entries()) {
    for (const [value, seen, field] of [
      [entry.assetId, assetIds, 'assetId'],
      [entry.objectName, objectNames, 'objectName'],
      [entry.sourceRelativePath, sourcePaths, 'sourceRelativePath']
    ] as const) {
      if (seen.has(value)) {
        context.addIssue({ code: 'custom', path: ['assets', index, field], message: `Duplicate ${field}` });
      }
      seen.add(value);
    }
  }
  for (const [index, entry] of manifest.assets.entries()) {
    if (!entry.allowFallback && entry.fallbackAssetIds.length > 0) {
      context.addIssue({ code: 'custom', path: ['assets', index, 'allowFallback'], message: 'Fallback IDs require allowFallback' });
    }
    for (const fallback of entry.fallbackAssetIds) {
      const target = assetsById.get(fallback);
      if (!target || fallback === entry.assetId) {
        context.addIssue({ code: 'custom', path: ['assets', index, 'fallbackAssetIds'], message: 'Fallback must reference another manifest asset' });
      } else if (target.kind !== entry.kind) {
        context.addIssue({ code: 'custom', path: ['assets', index, 'fallbackAssetIds'], message: 'Fallback must reference an asset of the same kind' });
      }
    }
  }

  const visitState = new Map<string, 'visiting' | 'visited'>();
  const visit = (entry: AssetManifestEntry) => {
    visitState.set(entry.assetId, 'visiting');
    const entryIndex = manifest.assets.indexOf(entry);
    for (const [fallbackIndex, fallback] of entry.fallbackAssetIds.entries()) {
      const target = assetsById.get(fallback);
      if (!target || target.kind !== entry.kind) continue;
      if (visitState.get(fallback) === 'visiting') {
        context.addIssue({
          code: 'custom',
          path: ['assets', entryIndex, 'fallbackAssetIds', fallbackIndex],
          message: 'Fallback references form a cycle'
        });
      } else if (visitState.get(fallback) !== 'visited') {
        visit(target);
      }
    }
    visitState.set(entry.assetId, 'visited');
  };
  for (const entry of manifest.assets) {
    if (visitState.get(entry.assetId) === undefined) visit(entry);
  }

  for (const [index, mapping] of manifest.nameMappings.entries()) {
    if (!assetIds.has(mapping.assetId)) {
      context.addIssue({ code: 'custom', path: ['nameMappings', index, 'assetId'], message: 'Mapping references an unknown assetId' });
    }
  }
});
export type AssetSeedManifest = z.infer<typeof assetSeedManifestSchema>;

const resolvedAssetAccessCommonShape = {
  url: z.url(),
  fingerprint: fingerprintSchema,
  size: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime({ offset: true })
};

const resolvedAssetAccessSchemaVariants = [
  z.strictObject({
    ...resolvedAssetAccessCommonShape,
    assetId: z.string().regex(/^model:[a-z0-9][a-z0-9._-]*$/),
    mediaType: z.literal('model/gltf-binary'),
    model: modelAssetMetadataSchema
  }),
  z.strictObject({
    ...resolvedAssetAccessCommonShape,
    assetId: z.string().regex(/^trajectory:[a-z0-9][a-z0-9._-]*$/),
    mediaType: z.literal('application/vnd.ise.trajectory+json'),
    trajectory: trajectoryAssetMetadataSchema
  }),
  z.strictObject({
    ...resolvedAssetAccessCommonShape,
    assetId: z.string().regex(/^video:[a-z0-9][a-z0-9._-]*$/),
    mediaType: z.literal('video/mp4'),
    video: videoAssetMetadataSchema
  }),
  z.strictObject({
    ...resolvedAssetAccessCommonShape,
    assetId: z.string().regex(/^image:[a-z0-9][a-z0-9._-]*$/),
    mediaType: z.enum(['image/png', 'image/jpeg']),
    image: imageAssetMetadataSchema
  }),
  z.strictObject({
    ...resolvedAssetAccessCommonShape,
    assetId: z.string().regex(/^geojson:[a-z0-9][a-z0-9._-]*$/),
    mediaType: z.literal('application/geo+json')
  })
];

export const resolvedAssetAccessSchema = z.union([
  resolvedAssetAccessSchemaVariants[0]!,
  resolvedAssetAccessSchemaVariants[1]!,
  resolvedAssetAccessSchemaVariants[2]!,
  resolvedAssetAccessSchemaVariants[3]!,
  resolvedAssetAccessSchemaVariants[4]!
]);
export type ResolvedAssetAccess = z.infer<typeof resolvedAssetAccessSchema>;

export const assetSeedManifestJsonSchema = {
  ...z.toJSONSchema(assetSeedManifestBaseSchema, {
    target: 'draft-2020-12'
  }),
  $comment: 'The runtime parser is authoritative for relational invariants including duplicate IDs, cross-record references, and fallback cycles.'
};
export const resolvedAssetAccessJsonSchema = {
  ...z.toJSONSchema(resolvedAssetAccessSchema, {
    target: 'draft-2020-12'
  }),
  $comment: 'The runtime Zod parser is authoritative for trajectory endTimeMs >= startTimeMs ordering because standard JSON Schema has no portable property-comparison keyword; this schema otherwise expresses the strict per-kind resolved-access structure.'
};
