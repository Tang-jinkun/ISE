import { assetManifestEntrySchema, type AssetManifestEntry } from './assets.js';
import { prepareTrajectorySource } from './trajectoryCuration.js';

const decoder = new TextDecoder('utf-8', { fatal: true });

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  );
  return `sha256:${[...digest].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function validateGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 12 || decoder.decode(bytes.subarray(0, 4)) !== 'glTF') {
    throw new Error('Invalid GLB magic');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 2) throw new Error('Invalid GLB version');
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('Invalid GLB declared length');
}

function validateMp4(bytes: Uint8Array) {
  if (bytes.byteLength < 12 || decoder.decode(bytes.subarray(4, 8)) !== 'ftyp') {
    throw new Error('Invalid MP4 magic');
  }
}

function validateImage(entry: Extract<AssetManifestEntry, { kind: 'image' }>, bytes: Uint8Array) {
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (entry.mediaType === 'image/png' && !png) throw new Error('Invalid PNG magic');
  if (entry.mediaType === 'image/jpeg' && !jpeg) throw new Error('Invalid JPEG magic');
}

function validateGeoJson(bytes: Uint8Array) {
  const value = JSON.parse(decoder.decode(bytes)) as { type?: unknown };
  const allowed = new Set([
    'Feature', 'FeatureCollection', 'Point', 'MultiPoint', 'LineString',
    'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'
  ]);
  if (typeof value !== 'object' || value === null || !allowed.has(String(value.type))) {
    throw new Error('Invalid GeoJSON root type');
  }
}

async function prepareTrajectory(entry: Extract<AssetManifestEntry, { kind: 'trajectory' }>, bytes: Uint8Array) {
  if (entry.trajectory.curation === undefined && entry.trajectory.repair !== undefined) {
    throw new Error('Trajectory repair metadata requires curation');
  }
  if (entry.trajectory.curation !== undefined && entry.trajectory.repair === undefined) {
    throw new Error('Trajectory curation requires repair metadata');
  }
  const prepared = await prepareTrajectorySource(entry.assetId, bytes, entry.trajectory.curation);
  if (
    prepared.repair !== undefined &&
    entry.trajectory.repair !== undefined &&
    JSON.stringify(entry.trajectory.repair) !== JSON.stringify(prepared.repair)
  ) {
    throw new Error('Trajectory repair metadata does not match recomputed source repair');
  }
  const normalized = prepared.normalized;
  const first = normalized.points[0]!;
  const last = normalized.points.at(-1)!;
  if (entry.trajectory.startTimeMs !== first.timeMs || entry.trajectory.endTimeMs !== last.timeMs) {
    throw new Error('Trajectory metadata time range does not match normalized bytes');
  }
  return prepared.bytes;
}

export async function prepareAssetForUpload(
  inputEntry: AssetManifestEntry,
  sourceBytes: Uint8Array
): Promise<Uint8Array> {
  const entry = assetManifestEntrySchema.parse(inputEntry);
  let prepared = sourceBytes;
  if (entry.kind === 'trajectory') prepared = await prepareTrajectory(entry, sourceBytes);
  else if (entry.kind === 'model') validateGlb(sourceBytes);
  else if (entry.kind === 'video') validateMp4(sourceBytes);
  else if (entry.kind === 'image') validateImage(entry, sourceBytes);
  else validateGeoJson(sourceBytes);

  if (prepared.byteLength !== entry.size) {
    throw new Error(`Asset size mismatch for ${entry.assetId}`);
  }
  if (await sha256(prepared) !== entry.fingerprint) {
    throw new Error(`Asset fingerprint mismatch for ${entry.assetId}`);
  }
  return prepared;
}
