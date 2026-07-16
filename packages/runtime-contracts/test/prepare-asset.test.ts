import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  normalizeTrajectorySamples,
  prepareAssetForUpload,
  prepareTrajectorySource,
  type AssetManifestEntry,
  type RawTrajectorySample
} from '../src/index.js';

const fingerprint = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function glbBytes(): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set(new TextEncoder().encode('glTF'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  return bytes;
}

function modelEntry(bytes: Uint8Array): AssetManifestEntry {
  return {
    assetId: 'model:jf17',
    kind: 'model',
    displayName: 'JF-17',
    aliases: [],
    fingerprint: fingerprint(bytes),
    sourceRelativePath: 'models/JF-17.glb',
    objectName: 'demo/models/JF-17.glb',
    mediaType: 'model/gltf-binary',
    size: bytes.byteLength,
    availability: 'available',
    criticality: 'required',
    fallbackAssetIds: [],
    allowFallback: false,
    model: { scale: 1, rotationOffsetDeg: [0, 0, 90], altitudeOffsetM: 0, entityTypes: ['aircraft'] }
  };
}

test('returns valid non-trajectory bytes unchanged', async () => {
  const bytes = glbBytes();
  const prepared = await prepareAssetForUpload(modelEntry(bytes), bytes);
  assert.equal(prepared, bytes);
});

test('rejects fingerprint, declared size, and GLB magic mismatches', async () => {
  const bytes = glbBytes();
  await assert.rejects(
    prepareAssetForUpload({ ...modelEntry(bytes), fingerprint: `sha256:${'0'.repeat(64)}` }, bytes),
    /fingerprint/
  );
  await assert.rejects(
    prepareAssetForUpload({ ...modelEntry(bytes), size: 13 }, bytes),
    /size/
  );
  const badMagic = bytes.slice();
  badMagic[0] = 0;
  await assert.rejects(prepareAssetForUpload(modelEntry(badMagic), badMagic), /GLB/);
});

test('normalizes trajectory JSON before size and fingerprint validation', async () => {
  const raw: RawTrajectorySample[] = [
    { timestamp: '2025-05-07 00:00:08', latitude: 30.4, longitude: 76.80, altitude: 1000 },
    { timestamp: '2025-05-07 00:00:08', latitude: 30.4, longitude: 76.81, altitude: 1100 },
    { timestamp: '2025-05-07 00:00:09', latitude: 30.4, longitude: 76.82, altitude: 1200 }
  ];
  const expected = new TextEncoder().encode(JSON.stringify(normalizeTrajectorySamples(raw)));
  const source = new TextEncoder().encode(JSON.stringify(raw, null, 2));
  const entry: AssetManifestEntry = {
    assetId: 'trajectory:ambala-rafale-1',
    kind: 'trajectory',
    displayName: 'Ambala Rafale 1',
    aliases: [],
    fingerprint: fingerprint(expected),
    sourceRelativePath: 'trajectories/AMBALA Rafale-1.json',
    objectName: 'demo/trajectories/ambala-rafale-1.json',
    mediaType: 'application/vnd.ise.trajectory+json',
    size: expected.byteLength,
    availability: 'available',
    criticality: 'required',
    fallbackAssetIds: [],
    allowFallback: false,
    trajectory: {
      format: 'ise-trajectory/v1',
      timeUnit: 'ms',
      coordinateOrder: 'lng-lat-alt',
      startTimeMs: 0,
      endTimeMs: 1000,
      monotonic: true
    }
  };
  assert.deepEqual(await prepareAssetForUpload(entry, source), expected);
});

test('requires exact recomputed repair metadata for curated trajectories', async () => {
  const raw: RawTrajectorySample[] = [
    { timestamp: '2025-05-07 00:00:09', latitude: 30.4, longitude: 76.8, altitude: 1000 },
    { timestamp: '2025-05-07 00:00:08', latitude: 30.41, longitude: 76.82, altitude: 1200 },
  ];
  const source = new TextEncoder().encode(JSON.stringify(raw));
  const curation = {
    policyId: 'trajectory.shift-suffix/v1' as const,
    expectedSourceFingerprint: fingerprint(source),
    startIndex: 1,
    deltaMs: 2_000,
  };
  const prepared = await prepareTrajectorySource('trajectory:ambala-su30mki-1', source, curation);
  const entry: AssetManifestEntry = {
    assetId: 'trajectory:ambala-su30mki-1',
    kind: 'trajectory',
    displayName: 'AMBALA Su-30MKI 1',
    aliases: [],
    fingerprint: fingerprint(prepared.bytes),
    sourceRelativePath: 'trajectories/AMBALA Su-30MKI-1.json',
    objectName: 'demo/trajectories/ambala-su30mki-1.json',
    mediaType: 'application/vnd.ise.trajectory+json',
    size: prepared.bytes.byteLength,
    availability: 'available',
    criticality: 'required',
    fallbackAssetIds: [],
    allowFallback: false,
    trajectory: {
      format: 'ise-trajectory/v1',
      timeUnit: 'ms',
      coordinateOrder: 'lng-lat-alt',
      startTimeMs: 0,
      endTimeMs: 1_000,
      monotonic: true,
      curation,
      repair: {
        sourceFingerprint: curation.expectedSourceFingerprint,
        repairRuleVersion: curation.policyId,
        affectedSampleRange: [1, 1],
        boundaryTimesBeforeMs: [0, -1_000],
        boundaryTimesAfterMs: [0, 1_000],
        offsetMs: 2_000,
      },
    },
  };

  assert.deepEqual(await prepareAssetForUpload(entry, source), prepared.bytes);
  await assert.rejects(
    prepareAssetForUpload({
      ...entry,
      trajectory: { ...entry.trajectory, repair: { ...entry.trajectory.repair!, offsetMs: 1_000 } },
    }, source),
    /repair metadata does not match/i,
  );
  const { repair: _repair, ...withoutRepair } = entry.trajectory;
  await assert.rejects(
    prepareAssetForUpload({ ...entry, trajectory: withoutRepair }, source),
    /curation requires repair metadata/i,
  );
  const { curation: _curation, ...withoutCuration } = entry.trajectory;
  await assert.rejects(
    prepareAssetForUpload({ ...entry, trajectory: withoutCuration }, source),
    /repair metadata requires curation/i,
  );
});

test('validates MP4, PNG/JPEG, and GeoJSON magic before returning bytes', async () => {
  const mp4 = new Uint8Array(12);
  mp4.set(new TextEncoder().encode('ftyp'), 4);
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const geojson = new TextEncoder().encode('{"type":"FeatureCollection","features":[]}');
  const common = {
    displayName: 'fixture', aliases: [], availability: 'available' as const,
    criticality: 'optional' as const, fallbackAssetIds: [], allowFallback: false
  };
  const entries: Array<[AssetManifestEntry, Uint8Array]> = [
    [{ ...common, assetId: 'video:missile-impact', kind: 'video', fingerprint: fingerprint(mp4), sourceRelativePath: 'video/impact.mp4', objectName: 'demo/video/impact.mp4', mediaType: 'video/mp4', size: mp4.byteLength, video: { durationMs: 1000, codec: 'h264' } }, mp4],
    [{ ...common, assetId: 'image:ground-radar', kind: 'image', fingerprint: fingerprint(png), sourceRelativePath: 'image/radar.png', objectName: 'demo/image/radar.png', mediaType: 'image/png', size: png.byteLength, image: { width: 1, height: 1, fit: 'contain' } }, png],
    [{ ...common, assetId: 'image:aew-illustration', kind: 'image', fingerprint: fingerprint(jpeg), sourceRelativePath: 'image/aew.jpg', objectName: 'demo/image/aew.jpg', mediaType: 'image/jpeg', size: jpeg.byteLength, image: { width: 1, height: 1, fit: 'contain' } }, jpeg],
    [{ ...common, assetId: 'geojson:airspace', kind: 'geojson', fingerprint: fingerprint(geojson), sourceRelativePath: 'geo/airspace.geojson', objectName: 'demo/geo/airspace.geojson', mediaType: 'application/geo+json', size: geojson.byteLength }, geojson]
  ];
  for (const [entry, bytes] of entries) {
    assert.equal(await prepareAssetForUpload(entry, bytes), bytes);
  }
});

test('rejects invalid MP4, PNG, JPEG, and GeoJSON bytes before fingerprint acceptance', async () => {
  const invalidMp4 = new Uint8Array(12);
  const invalidPng = Uint8Array.from([0, 80, 78, 71, 13, 10, 26, 10]);
  const invalidJpeg = Uint8Array.from([0xff, 0xd8, 0, 0]);
  const invalidGeoJson = new TextEncoder().encode('{"type":"Topology","objects":{}}');
  const common = {
    displayName: 'invalid fixture', aliases: [], availability: 'invalid' as const,
    criticality: 'optional' as const, fallbackAssetIds: [], allowFallback: false
  };
  const cases: Array<[AssetManifestEntry, Uint8Array, RegExp]> = [
    [{ ...common, assetId: 'video:invalid', kind: 'video', fingerprint: fingerprint(invalidMp4), sourceRelativePath: 'video/invalid.mp4', objectName: 'demo/video/invalid.mp4', mediaType: 'video/mp4', size: invalidMp4.byteLength, video: { durationMs: 1000, codec: 'h264' } }, invalidMp4, /MP4/],
    [{ ...common, assetId: 'image:invalid-png', kind: 'image', fingerprint: fingerprint(invalidPng), sourceRelativePath: 'image/invalid.png', objectName: 'demo/image/invalid.png', mediaType: 'image/png', size: invalidPng.byteLength, image: { width: 1, height: 1, fit: 'contain' } }, invalidPng, /PNG/],
    [{ ...common, assetId: 'image:invalid-jpeg', kind: 'image', fingerprint: fingerprint(invalidJpeg), sourceRelativePath: 'image/invalid.jpg', objectName: 'demo/image/invalid.jpg', mediaType: 'image/jpeg', size: invalidJpeg.byteLength, image: { width: 1, height: 1, fit: 'contain' } }, invalidJpeg, /JPEG/],
    [{ ...common, assetId: 'geojson:invalid', kind: 'geojson', fingerprint: fingerprint(invalidGeoJson), sourceRelativePath: 'geo/invalid.geojson', objectName: 'demo/geo/invalid.geojson', mediaType: 'application/geo+json', size: invalidGeoJson.byteLength }, invalidGeoJson, /GeoJSON/]
  ];

  for (const [entry, bytes, expectedError] of cases) {
    await assert.rejects(prepareAssetForUpload(entry, bytes), expectedError);
  }
});
