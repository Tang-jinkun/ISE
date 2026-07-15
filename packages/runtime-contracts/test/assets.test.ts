import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetSeedManifestJsonSchema,
  assetSeedManifestSchema,
  resolvedAssetAccessJsonSchema,
  resolvedAssetAccessSchema,
  type AssetSeedManifest
} from '../src/index.js';
import { compileJsonSchema } from './json-schema.js';

const fingerprint = `sha256:${'a'.repeat(64)}`;

function validManifest(): AssetSeedManifest {
  return {
    schemaVersion: 'ise-assets/v1',
    assets: [{
      assetId: 'model:jf17',
      kind: 'model',
      displayName: 'JF-17',
      aliases: ['JF-17 Thunder'],
      fingerprint,
      sourceRelativePath: 'models/JF-17.glb',
      objectName: 'demo/models/JF-17.glb',
      mediaType: 'model/gltf-binary',
      size: 1466636,
      availability: 'available',
      criticality: 'required',
      fallbackAssetIds: [],
      allowFallback: false,
      model: {
        scale: 1,
        rotationOffsetDeg: [0, 0, 90],
        altitudeOffsetM: 0,
        entityTypes: ['aircraft']
      }
    }],
    nameMappings: [{
      sourceName: 'JF-17',
      sourceKind: 'model',
      assetId: 'model:jf17',
      note: 'The GLB source is authoritative for this mapping.'
    }]
  };
}

function addModelEntry(manifest: AssetSeedManifest, assetId: string) {
  const entry = structuredClone(manifest.assets[0]!);
  if (entry.kind !== 'model') assert.fail('Expected model entry');
  const slug = assetId.split(':')[1]!;
  entry.assetId = assetId;
  entry.displayName = slug;
  entry.aliases = [];
  entry.sourceRelativePath = `models/${slug}.glb`;
  entry.objectName = `demo/models/${slug}.glb`;
  entry.fallbackAssetIds = [];
  manifest.assets.push(entry);
  return entry;
}

function validResolvedAccess() {
  return {
    assetId: 'model:jf17',
    url: 'https://minio.example.test/signed-object',
    fingerprint,
    mediaType: 'model/gltf-binary',
    size: 1466636,
    expiresAt: '2026-07-15T12:05:00.000Z',
    model: {
      scale: 1,
      rotationOffsetDeg: [0, 0, 90] as [number, number, number],
      altitudeOffsetM: 0,
      entityTypes: ['aircraft'] as const
    }
  };
}

test('accepts a strict model seed entry with separate availability and criticality', () => {
  const parsed = assetSeedManifestSchema.parse(validManifest());
  const entry = parsed.assets[0];
  assert.equal(entry?.availability, 'available');
  assert.equal(entry?.criticality, 'required');
  assert.equal(entry?.kind, 'model');
  if (entry?.kind !== 'model') assert.fail('Expected model entry');
  assert.deepEqual(entry.model.rotationOffsetDeg, [0, 0, 90]);
});

test('rejects uppercase fingerprints, absolute paths, traversal, and unknown fields', () => {
  const uppercase = validManifest() as AssetSeedManifest & { assets: any[] };
  uppercase.assets[0].fingerprint = `sha256:${'A'.repeat(64)}`;
  assert.equal(assetSeedManifestSchema.safeParse(uppercase).success, false);

  const absolute = validManifest() as AssetSeedManifest & { assets: any[] };
  absolute.assets[0].sourceRelativePath = 'C:\\assets\\JF-17.glb';
  assert.equal(assetSeedManifestSchema.safeParse(absolute).success, false);

  const traversal = validManifest() as AssetSeedManifest & { assets: any[] };
  traversal.assets[0].objectName = '../outside/JF-17.glb';
  assert.equal(assetSeedManifestSchema.safeParse(traversal).success, false);

  const unknown = validManifest() as AssetSeedManifest & { assets: any[] };
  unknown.assets[0].localPath = '/tmp/JF-17.glb';
  assert.equal(assetSeedManifestSchema.safeParse(unknown).success, false);
});

test('rejects noncanonical public strings in both Zod and JSON Schema', () => {
  const validate = compileJsonSchema(assetSeedManifestJsonSchema);
  const cases: Array<(manifest: AssetSeedManifest & { assets: any[]; nameMappings: any[] }) => void> = [
    manifest => { manifest.assets[0].displayName = ''; },
    manifest => { manifest.assets[0].displayName = '   '; },
    manifest => { manifest.assets[0].displayName = ' JF-17 '; },
    manifest => { manifest.assets[0].aliases = [' JF-17 Thunder ']; },
    manifest => { manifest.assets[0].sourceRelativePath = ' models/JF-17.glb'; },
    manifest => { manifest.assets[0].sourceRelativePath = 'models/JF-17.glb '; },
    manifest => { manifest.assets[0].sourceRelativePath = ' C:/assets/JF-17.glb '; },
    manifest => { manifest.assets[0].sourceRelativePath = 'C:/assets/JF-17.glb'; },
    manifest => { manifest.assets[0].sourceRelativePath = '/assets/JF-17.glb'; },
    manifest => { manifest.assets[0].sourceRelativePath = '../models/JF-17.glb'; },
    manifest => { manifest.assets[0].sourceRelativePath = 'models\\JF-17.glb'; },
    manifest => { manifest.nameMappings[0].sourceName = ' JF-17 '; },
    manifest => { manifest.nameMappings[0].note = ' mapping note '; }
  ];

  for (const mutate of cases) {
    const manifest = validManifest() as AssetSeedManifest & { assets: any[]; nameMappings: any[] };
    mutate(manifest);
    assert.equal(assetSeedManifestSchema.safeParse(manifest).success, false);
    assert.equal(validate(manifest), false, JSON.stringify(validate.errors));
  }
});

test('rejects duplicate assets and unresolved fallbacks or name mappings', () => {
  const duplicate = validManifest();
  duplicate.assets.push(duplicate.assets[0]!);
  assert.equal(assetSeedManifestSchema.safeParse(duplicate).success, false);

  const fallback = validManifest() as AssetSeedManifest & { assets: any[] };
  fallback.assets[0].fallbackAssetIds = ['model:missing'];
  assert.equal(assetSeedManifestSchema.safeParse(fallback).success, false);

  const mapping = validManifest();
  mapping.nameMappings[0]!.assetId = 'model:missing';
  assert.equal(assetSeedManifestSchema.safeParse(mapping).success, false);
});

test('rejects fallback targets of another kind and cycles of any length', () => {
  const crossKind = validManifest() as AssetSeedManifest & { assets: any[] };
  const image = structuredClone(crossKind.assets[0]);
  delete image.model;
  Object.assign(image, {
    assetId: 'image:ground-radar',
    kind: 'image',
    displayName: 'Ground radar',
    sourceRelativePath: 'images/ground-radar.png',
    objectName: 'demo/images/ground-radar.png',
    mediaType: 'image/png',
    image: { width: 1, height: 1, fit: 'contain' }
  });
  crossKind.assets.push(image);
  crossKind.assets[0].allowFallback = true;
  crossKind.assets[0].fallbackAssetIds = ['image:ground-radar'];
  assert.equal(assetSeedManifestSchema.safeParse(crossKind).success, false);

  const cyclic = validManifest();
  const second = addModelEntry(cyclic, 'model:mig29');
  const third = addModelEntry(cyclic, 'model:rafale');
  const first = cyclic.assets[0]!;
  first.allowFallback = true;
  first.fallbackAssetIds = [second.assetId];
  second.allowFallback = true;
  second.fallbackAssetIds = [third.assetId];
  third.allowFallback = true;
  third.fallbackAssetIds = [first.assetId];
  assert.equal(assetSeedManifestSchema.safeParse(cyclic).success, false);
});

test('accepts resolved access but rejects storage and seed-only fields', () => {
  const access = validResolvedAccess();
  assert.equal(resolvedAssetAccessSchema.safeParse(access).success, true);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, objectName: 'secret/key' }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, availability: 'available' }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, criticality: 'required' }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, fallbackAssetIds: [] }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, allowFallback: false }).success, false);
});

test('rejects resolved access when asset kind, metadata, or media type disagree', () => {
  const model = validResolvedAccess();
  assert.equal(
    resolvedAssetAccessSchema.safeParse({ ...model, mediaType: 'video/mp4' }).success,
    false
  );

  const { model: _model, ...common } = model;
  const video = {
    ...common,
    assetId: 'video:missile-impact',
    mediaType: 'video/mp4',
    video: { durationMs: 1000, codec: 'h264' }
  };
  assert.equal(resolvedAssetAccessSchema.safeParse(video).success, true);
  assert.equal(
    resolvedAssetAccessSchema.safeParse({ ...video, assetId: 'model:jf17' }).success,
    false
  );
});

test('exports strict seed and resolved-access JSON Schemas', () => {
  assert.equal(assetSeedManifestJsonSchema.additionalProperties, false);
  const schemaVersion = assetSeedManifestJsonSchema.properties?.schemaVersion;
  assert.equal(
    typeof schemaVersion === 'object' && schemaVersion !== null ? schemaVersion.const : undefined,
    'ise-assets/v1'
  );
  assert.match(assetSeedManifestJsonSchema.$comment ?? '', /runtime parser.*relational/i);

  const validateSeed = compileJsonSchema(assetSeedManifestJsonSchema);
  assert.equal(validateSeed(validManifest()), true, JSON.stringify(validateSeed.errors));
  const traversal = validManifest() as AssetSeedManifest & { assets: any[] };
  traversal.assets[0].sourceRelativePath = '../models/JF-17.glb';
  assert.equal(validateSeed(traversal), false);

  const validateAccess = compileJsonSchema(resolvedAssetAccessJsonSchema);
  const model = validResolvedAccess();
  assert.equal(validateAccess(model), true, JSON.stringify(validateAccess.errors));
  assert.equal(validateAccess({ ...model, mediaType: 'video/mp4' }), false);
  assert.equal(
    validateAccess({ ...model, assetId: 'video:missile-impact' }),
    false
  );
  assert.equal(validateAccess({ ...model, objectName: 'secret/key' }), false);
  assert.match(resolvedAssetAccessJsonSchema.$comment ?? '', /runtime.*per-kind/i);
});

test('documents trajectory time ordering as a runtime-only JSON Schema invariant', () => {
  const access = {
    assetId: 'trajectory:reversed',
    url: 'https://minio.example.test/trajectory',
    fingerprint,
    mediaType: 'application/vnd.ise.trajectory+json',
    size: 100,
    expiresAt: '2026-07-15T12:05:00.000Z',
    trajectory: {
      format: 'ise-trajectory/v1',
      timeUnit: 'ms',
      coordinateOrder: 'lng-lat-alt',
      startTimeMs: 1000,
      endTimeMs: 0,
      monotonic: true
    }
  };
  assert.equal(resolvedAssetAccessSchema.safeParse(access).success, false);

  const validate = compileJsonSchema(resolvedAssetAccessJsonSchema);
  assert.equal(validate(access), true, JSON.stringify(validate.errors));
  assert.match(
    resolvedAssetAccessJsonSchema.$comment ?? '',
    /runtime.*endTimeMs.*startTimeMs.*JSON Schema/i
  );
});
