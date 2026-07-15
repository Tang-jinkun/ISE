import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'path';
import { promisify } from 'util';
import {
  assetNameMappingSchema,
  assetSeedManifestSchema,
  modelAssetMetadataSchema,
  normalizeTrajectorySamples,
  prepareAssetForUpload,
  type AssetManifestEntry,
  type AssetSeedManifest,
  type RawTrajectorySample,
} from '@ise/runtime-contracts';

const execFileAsync = promisify(execFile);
const sourceMapSchemaVersion = 'ise-asset-source-map/v1';
const reversedOptionalTrajectoryId = 'trajectory:ambala-su30mki-1';

type AssetKind = 'model' | 'trajectory' | 'video' | 'image';

interface SourceAsset {
  assetId: string;
  sourceRelativePath: string;
  displayName: string;
  aliases: string[];
  criticality: 'required' | 'optional';
}

interface SourceMap {
  schemaVersion: typeof sourceMapSchemaVersion;
  assets: SourceAsset[];
  nameMappings: AssetSeedManifest['nameMappings'];
}

interface BrowserMetadata {
  assetId: string;
  status: 'loadedmetadata';
  durationMs: number;
  codec: string;
}

export interface BuildAssetManifestOptions {
  sourceRoot: string;
  sourceMapPath: string;
  browserMetadataPath: string;
  calibrationPath: string;
  outputPath: string;
  ffprobePath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
) {
  const expected = new Set(expectedKeys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = expectedKeys.filter((key) => !(key in value));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unrecognized fields: ${unknown.join(', ')}`);
  }
  if (missing.length > 0) {
    throw new Error(`${label} is missing fields: ${missing.join(', ')}`);
  }
}

function assertNonBlankString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-blank canonical string`);
  }
}

function assertNoTransportSecrets(json: string, label: string) {
  if (/https?:\/\//i.test(json) || /Bearer\s/i.test(json)) {
    throw new Error(`${label} contains an unrecognized URL or Bearer token`);
  }
  if (/"[^"]*(?:token|secret|signedurl)[^"]*"\s*:/i.test(json)) {
    throw new Error(`${label} contains an unrecognized secret or signed URL field`);
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function assertSafeRelativePath(value: unknown): asserts value is string {
  assertNonBlankString(value, 'sourceRelativePath');
  if (
    isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid sourceRelativePath: ${value}`);
  }
}

function assetKind(assetId: string): AssetKind {
  const [kind, name, ...rest] = assetId.split(':');
  if (
    rest.length > 0 ||
    !name ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(name) ||
    !['model', 'trajectory', 'video', 'image'].includes(kind)
  ) {
    throw new Error(`Invalid assetId: ${assetId}`);
  }
  return kind as AssetKind;
}

function parseSourceAsset(value: unknown, index: number): SourceAsset {
  if (!isRecord(value)) throw new Error(`source map asset ${index} must be an object`);
  assertExactKeys(
    value,
    ['assetId', 'sourceRelativePath', 'displayName', 'aliases', 'criticality'],
    `source map asset ${index}`,
  );
  assertNonBlankString(value.assetId, `source map asset ${index} assetId`);
  assetKind(value.assetId);
  assertSafeRelativePath(value.sourceRelativePath);
  assertNonBlankString(value.displayName, `source map asset ${index} displayName`);
  if (!Array.isArray(value.aliases)) {
    throw new Error(`source map asset ${index} aliases must be an array`);
  }
  const aliases = value.aliases.map((alias, aliasIndex) => {
    assertNonBlankString(alias, `source map asset ${index} alias ${aliasIndex}`);
    return alias;
  });
  if (value.criticality !== 'required' && value.criticality !== 'optional') {
    throw new Error(`source map asset ${index} has invalid criticality`);
  }
  return {
    assetId: value.assetId,
    sourceRelativePath: value.sourceRelativePath,
    displayName: value.displayName,
    aliases,
    criticality: value.criticality,
  };
}

function parseSourceMap(text: string): SourceMap {
  assertNoTransportSecrets(text, 'asset source map');
  const value = parseJson(text, 'asset source map');
  if (!isRecord(value)) throw new Error('Asset source map must be an object');
  assertExactKeys(value, ['schemaVersion', 'assets', 'nameMappings'], 'asset source map');
  if (value.schemaVersion !== sourceMapSchemaVersion) {
    throw new Error(`Asset source map schemaVersion must be ${sourceMapSchemaVersion}`);
  }
  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    throw new Error('Asset source map assets must be a non-empty array');
  }
  if (!Array.isArray(value.nameMappings)) {
    throw new Error('Asset source map nameMappings must be an array');
  }
  return {
    schemaVersion: value.schemaVersion,
    assets: value.assets.map(parseSourceAsset),
    nameMappings: value.nameMappings.map((mapping) => assetNameMappingSchema.parse(mapping)),
  };
}

async function readOptionalBrowserMetadata(path: string): Promise<Map<string, BrowserMetadata>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error;
  }
  assertNoTransportSecrets(text, 'browser metadata');
  const value = parseJson(text, 'browser metadata');
  if (!Array.isArray(value)) throw new Error('Browser metadata must be an array');
  const records = value.map((record, index): BrowserMetadata => {
    if (!isRecord(record)) throw new Error(`Browser metadata record ${index} must be an object`);
    assertExactKeys(
      record,
      ['assetId', 'status', 'durationMs', 'codec'],
      `browser metadata record ${index}`,
    );
    assertNonBlankString(record.assetId, `browser metadata record ${index} assetId`);
    if (assetKind(record.assetId) !== 'video') {
      throw new Error(`Browser metadata record ${index} must reference a video`);
    }
    if (record.status !== 'loadedmetadata') {
      throw new Error(`Browser metadata failed for ${record.assetId}`);
    }
    if (!Number.isInteger(record.durationMs) || Number(record.durationMs) <= 0) {
      throw new Error(`Browser metadata durationMs is invalid for ${record.assetId}`);
    }
    assertNonBlankString(record.codec, `browser metadata codec for ${record.assetId}`);
    return {
      assetId: record.assetId,
      status: record.status,
      durationMs: Number(record.durationMs),
      codec: record.codec,
    };
  });
  return new Map(records.map((record) => [record.assetId, record]));
}

async function readCalibrations(path: string) {
  const text = await readFile(path, 'utf8');
  assertNoTransportSecrets(text, 'model calibration');
  const value = parseJson(text, 'model calibration');
  if (!isRecord(value)) throw new Error('Model calibration must be an object keyed by asset ID');
  return new Map(
    Object.entries(value).map(([assetId, calibration]) => {
      if (assetKind(assetId) !== 'model') {
        throw new Error(`Model calibration has invalid asset ID: ${assetId}`);
      }
      return [assetId, modelAssetMetadataSchema.parse(calibration)] as const;
    }),
  );
}

function resolveSourcePath(sourceRoot: string, sourceRelativePath: string) {
  const candidate = resolve(sourceRoot, sourceRelativePath);
  const pathFromRoot = relative(sourceRoot, candidate);
  if (
    pathFromRoot === '' ||
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error('Asset source path escapes the configured source root');
  }
  return candidate;
}

function fingerprint(bytes: Buffer) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function readSourceBytes(path: string, assetId: string) {
  try {
    return await readFile(path);
  } catch {
    throw new Error(`Unable to read operator source bytes for ${assetId}`);
  }
}

function validateGlb(bytes: Buffer) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('Invalid GLB magic');
  }
  if (bytes.readUInt32LE(4) !== 2) throw new Error('Invalid GLB version');
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB declared length');
}

function readPngDimensions(bytes: Buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    !signature.every((value, index) => bytes[index] === value) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR' ||
    bytes.readUInt32BE(8) !== 13
  ) {
    throw new Error('Invalid PNG signature or IHDR');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) throw new Error('Invalid PNG dimensions');
  return { width, height, fit: 'contain' as const };
}

function validateMp4(bytes: Buffer) {
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') {
    throw new Error('Invalid MP4 magic');
  }
}

async function probeVideo(
  filePath: string,
  assetId: string,
  ffprobePath: string,
  browserMetadata: Map<string, BrowserMetadata>,
) {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_name,codec_tag_string:format=duration',
      '-of',
      'json',
      filePath,
    ]);
    const value = parseJson(stdout, 'ffprobe output');
    if (!isRecord(value) || !Array.isArray(value.streams) || !isRecord(value.format)) {
      throw new Error('ffprobe output has an invalid shape');
    }
    const stream = value.streams.find(isRecord);
    const durationSeconds = Number(value.format.duration);
    const durationMs = Math.round(durationSeconds * 1000);
    const codecTag = stream?.codec_tag_string;
    const codecName = stream?.codec_name;
    const codec =
      typeof codecTag === 'string' && codecTag.trim().length > 0
        ? codecTag
        : typeof codecName === 'string'
          ? codecName
          : '';
    if (!Number.isFinite(durationSeconds) || durationMs <= 0 || codec.trim().length === 0) {
      throw new Error('ffprobe did not return a duration and codec');
    }
    return { durationMs, codec };
  } catch {
    const fallback = browserMetadata.get(assetId);
    if (!fallback) {
      throw new Error(`Browser metadata required for ${assetId} after ffprobe failed`);
    }
    return { durationMs: fallback.durationMs, codec: fallback.codec };
  }
}

function commonEntry(source: SourceAsset, bytes: Buffer, kind: AssetKind) {
  const extension =
    kind === 'trajectory' ? '.json' : extname(source.sourceRelativePath).toLowerCase();
  return {
    assetId: source.assetId,
    kind,
    displayName: source.displayName,
    aliases: source.aliases,
    fingerprint: fingerprint(bytes),
    sourceRelativePath: source.sourceRelativePath,
    objectName: `demo-assets/${kind}/${source.assetId.slice(kind.length + 1)}${extension}`,
    size: bytes.byteLength,
    availability: 'available' as const,
    criticality: source.criticality,
    fallbackAssetIds: [],
    allowFallback: false,
  };
}

async function buildEntry(
  source: SourceAsset,
  bytes: Buffer,
  sourcePath: string,
  browserMetadata: Map<string, BrowserMetadata>,
  calibrations: Awaited<ReturnType<typeof readCalibrations>>,
  ffprobePath: string,
): Promise<AssetManifestEntry> {
  const kind = assetKind(source.assetId);
  if (kind === 'model') {
    validateGlb(bytes);
    const calibration = calibrations.get(source.assetId);
    if (!calibration) throw new Error(`Model calibration required for ${source.assetId}`);
    const entry: AssetManifestEntry = {
      ...commonEntry(source, bytes, kind),
      kind,
      mediaType: 'model/gltf-binary',
      model: calibration,
    };
    await prepareAssetForUpload(entry, bytes);
    return entry;
  }

  if (kind === 'image') {
    if (extname(source.sourceRelativePath).toLowerCase() !== '.png') {
      throw new Error(`Unsupported image type for ${source.assetId}`);
    }
    const entry: AssetManifestEntry = {
      ...commonEntry(source, bytes, kind),
      kind,
      mediaType: 'image/png',
      image: readPngDimensions(bytes),
    };
    await prepareAssetForUpload(entry, bytes);
    return entry;
  }

  if (kind === 'video') {
    validateMp4(bytes);
    const video = await probeVideo(sourcePath, source.assetId, ffprobePath, browserMetadata);
    const entry: AssetManifestEntry = {
      ...commonEntry(source, bytes, kind),
      kind,
      mediaType: 'video/mp4',
      video,
    };
    await prepareAssetForUpload(entry, bytes);
    return entry;
  }

  if (source.assetId === reversedOptionalTrajectoryId) {
    if (source.criticality !== 'optional') {
      throw new Error(`${reversedOptionalTrajectoryId} must remain optional`);
    }
    const raw = JSON.parse(bytes.toString('utf8')) as RawTrajectorySample[];
    try {
      normalizeTrajectorySamples(raw);
    } catch (error) {
      if (error instanceof Error && /reverse source order/i.test(error.message)) {
        return {
          ...commonEntry(source, bytes, kind),
          kind,
          mediaType: 'application/vnd.ise.trajectory+json',
          availability: 'invalid',
          trajectory: {
            format: 'ise-trajectory/v1',
            timeUnit: 'ms',
            coordinateOrder: 'lng-lat-alt',
            startTimeMs: 0,
            endTimeMs: 0,
            monotonic: true,
          },
        };
      }
      throw error;
    }
    throw new Error(`${reversedOptionalTrajectoryId} no longer contains reversed timestamps`);
  }

  const raw = JSON.parse(bytes.toString('utf8')) as RawTrajectorySample[];
  const normalized = normalizeTrajectorySamples(raw);
  const prepared = Buffer.from(JSON.stringify(normalized));
  const entry: AssetManifestEntry = {
    ...commonEntry(source, prepared, kind),
    kind,
    mediaType: 'application/vnd.ise.trajectory+json',
    trajectory: {
      format: 'ise-trajectory/v1',
      timeUnit: 'ms',
      coordinateOrder: 'lng-lat-alt',
      startTimeMs: normalized.points[0]!.timeMs,
      endTimeMs: normalized.points.at(-1)!.timeMs,
      monotonic: true,
    },
  };
  await prepareAssetForUpload(entry, bytes);
  return entry;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function buildAssetManifest(
  options: BuildAssetManifestOptions,
): Promise<AssetSeedManifest> {
  if (!isAbsolute(options.sourceRoot)) {
    throw new Error('sourceRoot must be absolute');
  }
  const sourceRoot = resolve(options.sourceRoot);
  const sourceMap = parseSourceMap(await readFile(options.sourceMapPath, 'utf8'));
  const browserMetadata = await readOptionalBrowserMetadata(options.browserMetadataPath);
  const calibrations = await readCalibrations(options.calibrationPath);
  const entries: AssetManifestEntry[] = [];
  for (const source of sourceMap.assets) {
    const sourcePath = resolveSourcePath(sourceRoot, source.sourceRelativePath);
    const bytes = await readSourceBytes(sourcePath, source.assetId);
    entries.push(
      await buildEntry(
        source,
        bytes,
        sourcePath,
        browserMetadata,
        calibrations,
        options.ffprobePath ?? 'ffprobe',
      ),
    );
  }

  const manifest = assetSeedManifestSchema.parse({
    schemaVersion: 'ise-assets/v1',
    assets: entries.sort((left, right) => compareText(left.assetId, right.assetId)),
    nameMappings: sourceMap.nameMappings.sort((left, right) =>
      compareText(
        `${left.sourceName}\0${left.sourceKind}\0${left.assetId}`,
        `${right.sourceName}\0${right.sourceKind}\0${right.assetId}`,
      ),
    ),
  });
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export async function main() {
  const sourceRoot = process.env.ISE_ASSET_SOURCE_ROOT;
  if (!sourceRoot || !isAbsolute(sourceRoot)) {
    throw new Error('ISE_ASSET_SOURCE_ROOT must be an absolute path');
  }
  const provenanceRoot = resolve(__dirname, '../../../../provenance');
  await buildAssetManifest({
    sourceRoot,
    sourceMapPath: resolve(provenanceRoot, 'asset-source-map.json'),
    browserMetadataPath: resolve(provenanceRoot, 'asset-browser-metadata.json'),
    calibrationPath: resolve(provenanceRoot, 'asset-model-calibration.json'),
    outputPath: resolve(provenanceRoot, 'assets.seed.json'),
  });
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
