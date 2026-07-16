import { z } from 'zod';
import {
  trajectoryCurationSchema,
  trajectoryRepairMetadataSchema,
  type TrajectoryCuration,
  type TrajectoryRepairMetadata,
} from './assets.js';
import {
  normalizeTrajectorySamples,
  rawTrajectorySampleSchema,
  type NormalizedTrajectory,
  type RawTrajectorySample,
} from './trajectory.js';

export { trajectoryCurationSchema, trajectoryRepairMetadataSchema } from './assets.js';
export type { TrajectoryCuration, TrajectoryRepairMetadata } from './assets.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const curatedTrajectoryId = 'trajectory:ambala-su30mki-1';

export type PreparedTrajectorySource = {
  bytes: Uint8Array;
  normalized: NormalizedTrajectory;
  repair?: TrajectoryRepairMetadata;
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
  return `sha256:${[...digest].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function parseTimestamp(timestamp: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(timestamp);
  if (!match) throw new Error(`Invalid trajectory timestamp: ${timestamp}`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '0'] = match;
  const parsed = Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    Number(hourText),
    Number(minuteText),
    Number(secondText),
    Number(fraction.padEnd(3, '0')),
  );
  const check = new Date(parsed);
  if (
    check.getUTCFullYear() !== Number(yearText) ||
    check.getUTCMonth() !== Number(monthText) - 1 ||
    check.getUTCDate() !== Number(dayText) ||
    check.getUTCHours() !== Number(hourText) ||
    check.getUTCMinutes() !== Number(minuteText) ||
    check.getUTCSeconds() !== Number(secondText) ||
    check.getUTCMilliseconds() !== Number(fraction.padEnd(3, '0'))
  ) {
    throw new Error(`Invalid trajectory timestamp: ${timestamp}`);
  }
  return parsed;
}

function shiftTimestamp(timestamp: string, deltaMs: number): string {
  const parsed = parseTimestamp(timestamp);
  const shifted = new Date(parsed + deltaMs);
  if (!Number.isFinite(shifted.getTime())) throw new Error(`Invalid trajectory timestamp: ${timestamp}`);
  const year = shifted.getUTCFullYear().toString().padStart(4, '0');
  const month = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = shifted.getUTCDate().toString().padStart(2, '0');
  const hour = shifted.getUTCHours().toString().padStart(2, '0');
  const minute = shifted.getUTCMinutes().toString().padStart(2, '0');
  const second = shifted.getUTCSeconds().toString().padStart(2, '0');
  const millisecond = shifted.getUTCMilliseconds();
  return `${year}-${month}-${day} ${hour}:${minute}:${second}${millisecond === 0 ? '' : `.${millisecond.toString().padStart(3, '0')}`}`;
}

function parseRaw(bytes: Uint8Array): RawTrajectorySample[] {
  return z.array(rawTrajectorySampleSchema).min(2).parse(JSON.parse(decoder.decode(bytes)));
}

export async function prepareTrajectorySource(
  assetId: string,
  sourceBytes: Uint8Array,
  curation?: TrajectoryCuration,
): Promise<PreparedTrajectorySource> {
  const parsedCuration = curation === undefined ? undefined : trajectoryCurationSchema.parse(curation);

  if (parsedCuration !== undefined) {
    if (assetId !== curatedTrajectoryId) {
      throw new Error(`Trajectory curation is not permitted for ${assetId}`);
    }
    const actualFingerprint = await sha256(sourceBytes);
    if (actualFingerprint !== parsedCuration.expectedSourceFingerprint) {
      throw new Error(`Trajectory source fingerprint mismatch for ${assetId}`);
    }
  }

  const raw = parseRaw(sourceBytes);
  let preparedRaw = raw;
  let repair: PreparedTrajectorySource['repair'];

  if (parsedCuration !== undefined) {
    if (parsedCuration.startIndex >= raw.length) {
      throw new Error(`Trajectory curation startIndex is outside source for ${assetId}`);
    }
    const originMs = parseTimestamp(raw[0]!.timestamp);
    const previousTimeMs = parseTimestamp(raw[parsedCuration.startIndex - 1]!.timestamp) - originMs;
    const startTimeBeforeMs = parseTimestamp(raw[parsedCuration.startIndex]!.timestamp) - originMs;
    preparedRaw = raw.map((sample, index) =>
      index >= parsedCuration.startIndex
        ? { ...sample, timestamp: shiftTimestamp(sample.timestamp, parsedCuration.deltaMs) }
        : sample,
    );
    repair = trajectoryRepairMetadataSchema.parse({
      sourceFingerprint: parsedCuration.expectedSourceFingerprint,
      repairRuleVersion: parsedCuration.policyId,
      affectedSampleRange: [parsedCuration.startIndex, raw.length - 1],
      boundaryTimesBeforeMs: [previousTimeMs, startTimeBeforeMs],
      boundaryTimesAfterMs: [previousTimeMs, startTimeBeforeMs + parsedCuration.deltaMs],
      offsetMs: parsedCuration.deltaMs,
    });
  }

  const normalized = normalizeTrajectorySamples(preparedRaw);
  return { bytes: encoder.encode(JSON.stringify(normalized)), normalized, repair };
}
