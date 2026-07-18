import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTrajectorySamples, trajectorySchema } from '../src/index.js';

const point = (timestamp: string, longitude: number) => ({
  timestamp,
  latitude: 30.4,
  longitude,
  altitude: 1000
});

test('normalizes source fields to relative milliseconds and canonical names', () => {
  const output = normalizeTrajectorySamples([
    point('2025-05-07 00:00:08', 76.8),
    point('2025-05-07 00:00:09', 76.9)
  ]);
  assert.deepEqual(output, {
    schemaVersion: 'ise-trajectory/v1',
    sourceTimeOriginMs: Date.UTC(2025, 4, 7, 0, 0, 8),
    points: [
      { timeMs: 0, longitude: 76.8, latitude: 30.4, altitudeM: 1000 },
      { timeMs: 1000, longitude: 76.9, latitude: 30.4, altitudeM: 1000 }
    ]
  });
  assert.equal(trajectorySchema.safeParse(output).success, true);
});

test('spreads duplicate timestamps across the next positive gap in source order', () => {
  const output = normalizeTrajectorySamples([
    point('2025-05-07 00:00:08', 76.80),
    point('2025-05-07 00:00:08', 76.81),
    point('2025-05-07 00:00:09', 76.82)
  ]);
  assert.deepEqual(output.points.map(value => value.timeMs), [0, 500, 1000]);
  assert.deepEqual(output.points.map(value => value.longitude), [76.80, 76.81, 76.82]);
});

test('uses the previous gap for a duplicate terminal group', () => {
  const output = normalizeTrajectorySamples([
    point('2025-05-07 00:00:08', 76.80),
    point('2025-05-07 00:00:09', 76.81),
    point('2025-05-07 00:00:09', 76.82),
    point('2025-05-07 00:00:09', 76.83)
  ]);
  assert.deepEqual(output.points.map(value => value.timeMs), [0, 1000, 1333, 1666]);
});

test('uses a 1000ms gap when every timestamp is identical', () => {
  const output = normalizeTrajectorySamples([
    point('2025-05-07 00:00:08', 76.80),
    point('2025-05-07 00:00:08', 76.81),
    point('2025-05-07 00:00:08', 76.82)
  ]);
  assert.deepEqual(output.points.map(value => value.timeMs), [0, 333, 666]);
});

test('rejects source-order reversal, invalid coordinates, and an unspreadable group', () => {
  assert.throws(() => normalizeTrajectorySamples([
    point('2025-05-07 00:00:09', 76.8),
    point('2025-05-07 00:00:08', 76.9)
  ]), /source order/);
  assert.throws(() => normalizeTrajectorySamples([
    { ...point('2025-05-07 00:00:08', 76.8), latitude: 91 },
    point('2025-05-07 00:00:09', 76.9)
  ]));
  assert.throws(() => normalizeTrajectorySamples([
    point('2025-05-07 00:00:08.000', 76.80),
    point('2025-05-07 00:00:08.000', 76.81),
    point('2025-05-07 00:00:08.001', 76.82)
  ]), /strictly increasing/);
});
