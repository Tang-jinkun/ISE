import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetSeedManifestJsonSchema,
  assetSeedManifestSchema,
  resolvedAssetAccessJsonSchema,
  resolvedAssetAccessSchema,
  type AssetSeedManifest
} from '../src/index.js';

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

test('accepts resolved access but rejects storage and seed-only fields', () => {
  const access = {
    assetId: 'model:jf17',
    url: 'https://minio.example.test/signed-object',
    fingerprint,
    mediaType: 'model/gltf-binary',
    size: 1466636,
    expiresAt: '2026-07-15T12:05:00.000Z',
    model: {
      scale: 1,
      rotationOffsetDeg: [0, 0, 90],
      altitudeOffsetM: 0,
      entityTypes: ['aircraft']
    }
  };
  assert.equal(resolvedAssetAccessSchema.safeParse(access).success, true);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, objectName: 'secret/key' }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, availability: 'available' }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, criticality: 'required' }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, fallbackAssetIds: [] }).success, false);
  assert.equal(resolvedAssetAccessSchema.safeParse({ ...access, allowFallback: false }).success, false);
});

test('exports strict seed and resolved-access JSON Schemas', () => {
  assert.equal(assetSeedManifestJsonSchema.additionalProperties, false);
  const schemaVersion = assetSeedManifestJsonSchema.properties?.schemaVersion;
  assert.equal(
    typeof schemaVersion === 'object' && schemaVersion !== null ? schemaVersion.const : undefined,
    'ise-assets/v1'
  );
  assert.equal(resolvedAssetAccessJsonSchema.additionalProperties, false);
});
