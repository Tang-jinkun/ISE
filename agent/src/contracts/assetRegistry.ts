import { z } from 'zod'
import { compilationDiagnosticSchema } from '../services/runtimeDiagnostics.ts'

const common = {
  displayName: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  availability: z.enum(['available', 'missing', 'invalid']),
  criticality: z.enum(['required', 'optional']),
  fallbackAssetIds: z.array(z.string().min(1)),
  allowFallback: z.boolean(),
}

export const assetRegistryEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...common,
    assetId: z.string().regex(/^model:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('model'),
    mediaType: z.literal('model/gltf-binary'),
    model: z.strictObject({
      scale: z.number().positive(),
      rotationOffsetDeg: z.tuple([z.number(), z.number(), z.number()]),
      altitudeOffsetM: z.number(),
      entityTypes: z.array(z.enum(['aircraft', 'missile', 'other'])).min(1),
    }),
  }),
  z.strictObject({
    ...common,
    assetId: z.string().regex(/^trajectory:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('trajectory'),
    mediaType: z.literal('application/vnd.ise.trajectory+json'),
    trajectory: z.strictObject({
      format: z.literal('ise-trajectory/v1'),
      timeUnit: z.literal('ms'),
      coordinateOrder: z.literal('lng-lat-alt'),
      startTimeMs: z.number().int().nonnegative(),
      endTimeMs: z.number().int().nonnegative(),
      monotonic: z.literal(true),
      bounds: z.tuple([
        z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
        z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
      ]).refine(([[west, south], [east, north]]) => west <= east && south <= north, {
        message: 'bounds must be ordered southwest to northeast',
      }).optional(),
    }).refine(value => value.startTimeMs <= value.endTimeMs, { path: ['endTimeMs'], message: 'Invalid trajectory time range' }),
  }),
  z.strictObject({
    ...common,
    assetId: z.string().regex(/^video:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('video'),
    mediaType: z.literal('video/mp4'),
    video: z.strictObject({ durationMs: z.number().int().positive(), codec: z.string().min(1) }),
  }),
  z.strictObject({
    ...common,
    assetId: z.string().regex(/^image:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('image'),
    mediaType: z.enum(['image/png', 'image/jpeg']),
    image: z.strictObject({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fit: z.enum(['contain', 'cover']),
    }),
  }),
  z.strictObject({
    ...common,
    assetId: z.string().regex(/^geojson:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('geojson'),
    mediaType: z.literal('application/geo+json'),
  }),
])

export type AssetRegistryEntry = z.infer<typeof assetRegistryEntrySchema>

const assetRegistrySnapshotBaseSchema = z.strictObject({
  schemaVersion: z.literal('asset-registry/v1'),
  registryVersion: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  assets: z.array(assetRegistryEntrySchema),
  diagnostics: z.array(compilationDiagnosticSchema),
})

export const assetRegistrySnapshotSchema = assetRegistrySnapshotBaseSchema.superRefine((snapshot, context) => {
  const entries = new Map<string, AssetRegistryEntry>()
  for (const [index, entry] of snapshot.assets.entries()) {
    if (entries.has(entry.assetId)) context.addIssue({ code: 'custom', path: ['assets', index, 'assetId'], message: 'Duplicate assetId' })
    entries.set(entry.assetId, entry)
  }
  for (const [index, entry] of snapshot.assets.entries()) {
    if (!entry.allowFallback && entry.fallbackAssetIds.length > 0) {
      context.addIssue({ code: 'custom', path: ['assets', index, 'fallbackAssetIds'], message: 'Fallback IDs require allowFallback' })
    }
    for (const fallbackId of entry.fallbackAssetIds) {
      const fallback = entries.get(fallbackId)
      if (!fallback || fallbackId === entry.assetId) {
        context.addIssue({ code: 'custom', path: ['assets', index, 'fallbackAssetIds'], message: 'Fallback must reference another asset' })
      } else if (fallback.kind !== entry.kind) {
        context.addIssue({ code: 'custom', path: ['assets', index, 'fallbackAssetIds'], message: 'Fallback must keep the same kind' })
      }
    }
  }
  const state = new Map<string, 'visiting' | 'visited'>()
  const visit = (entry: AssetRegistryEntry, path: string[]) => {
    state.set(entry.assetId, 'visiting')
    for (const fallbackId of entry.fallbackAssetIds) {
      const fallback = entries.get(fallbackId)
      if (!fallback || fallback.kind !== entry.kind) continue
      if (state.get(fallbackId) === 'visiting') {
        context.addIssue({ code: 'custom', path: ['assets'], message: `Fallback cycle: ${[...path, fallbackId].join(' -> ')}` })
      } else if (state.get(fallbackId) !== 'visited') visit(fallback, [...path, fallbackId])
    }
    state.set(entry.assetId, 'visited')
  }
  for (const entry of snapshot.assets) if (!state.has(entry.assetId)) visit(entry, [entry.assetId])
})

export type AssetRegistrySnapshot = z.infer<typeof assetRegistrySnapshotSchema>
