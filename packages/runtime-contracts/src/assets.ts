import { z } from 'zod';

export const assetIdSchema = z.string().regex(
  /^(model|trajectory|video|image|geojson):[a-z0-9][a-z0-9._-]*$/
);
export const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const safeRelativePath = z.string().trim().min(1).regex(
  /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*\/\/)(?!.*\/$)(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$)).+$/
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
  monotonic: z.literal(true)
}).refine(value => value.endTimeMs >= value.startTimeMs, {
  message: 'endTimeMs must be greater than or equal to startTimeMs',
  path: ['endTimeMs']
});

export const videoAssetMetadataSchema = z.strictObject({
  durationMs: z.number().int().positive(),
  codec: z.string().trim().min(1)
});

export const imageAssetMetadataSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fit: z.enum(['contain', 'cover'])
});

const commonEntryShape = {
  displayName: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)),
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

export const assetNameMappingSchema = z.strictObject({
  sourceName: z.string().trim().min(1),
  sourceKind: z.enum(['report', 'trajectory', 'model', 'operator']),
  assetId: assetIdSchema,
  note: z.string().trim().min(1)
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
  $comment: 'The runtime parser is authoritative for relational invariants including duplicate IDs, cross-record references, fallback cycles, and trimmed path normalization.'
};
export const resolvedAssetAccessJsonSchema = {
  ...z.toJSONSchema(resolvedAssetAccessSchema, {
    target: 'draft-2020-12'
  }),
  $comment: 'This JSON Schema expresses the strict per-kind resolved-access structure; the runtime parser remains authoritative for relational invariants outside this record.'
};
