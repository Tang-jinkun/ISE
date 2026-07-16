import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  prepareTrajectorySource,
  trajectoryCurationSchema,
  type RawTrajectorySample,
} from '../src/index.js';

const raw: RawTrajectorySample[] = [
  { timestamp: '2025-05-07 00:00:08', latitude: 30.4, longitude: 76.8, altitude: 1000 },
  { timestamp: '2025-05-07 00:00:09', latitude: 30.41, longitude: 76.82, altitude: 1200 },
  { timestamp: '2025-05-07 00:00:08', latitude: 30.42, longitude: 76.84, altitude: 1400 },
];
const rawBytes = new TextEncoder().encode(JSON.stringify(raw));
const rawFingerprint = `sha256:${createHash('sha256').update(rawBytes).digest('hex')}`;

test('curates the Su-30 suffix and returns deterministic canonical bytes', async () => {
  const curation = {
    policyId: 'trajectory.shift-suffix/v1',
    expectedSourceFingerprint: rawFingerprint,
    startIndex: 2,
    deltaMs: 2_000,
  } as const;

  const first = await prepareTrajectorySource('trajectory:ambala-su30mki-1', rawBytes, curation);
  const second = await prepareTrajectorySource('trajectory:ambala-su30mki-1', rawBytes, curation);

  assert.deepEqual(first, second);
  assert.equal(first.normalized.points[0]!.timeMs, 0);
  assert.equal(first.normalized.points[1]!.timeMs + 1_000, first.normalized.points[2]!.timeMs);
  assert.equal(first.repair?.affectedRange.startIndex, 2);
  assert.equal(first.repair?.deltaMs, 2_000);
  assert.deepEqual(first.normalized.points.map(point => [point.longitude, point.latitude, point.altitudeM]), [
    [76.8, 30.4, 1000],
    [76.82, 30.41, 1200],
    [76.84, 30.42, 1400],
  ]);
});

test('rejects curation for another asset or a mismatched source fingerprint', async () => {
  const curation = {
    policyId: 'trajectory.shift-suffix/v1',
    expectedSourceFingerprint: rawFingerprint,
    startIndex: 2,
    deltaMs: 2_000,
  } as const;
  assert.deepEqual(trajectoryCurationSchema.parse(curation), curation);
  assert.throws(() => trajectoryCurationSchema.parse({ ...curation, extra: true }));
  await assert.rejects(
    prepareTrajectorySource('trajectory:ambala-su30mki-1', rawBytes, {
      ...curation,
      expectedSourceFingerprint: `sha256:${'0'.repeat(64)}`,
    }),
    /fingerprint/i,
  );
  await assert.rejects(
    prepareTrajectorySource('trajectory:ambala-rafale-1', rawBytes, curation),
    /curation|asset/i,
  );
});
