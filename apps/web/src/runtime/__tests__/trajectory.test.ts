import { describe, expect, it } from 'vitest';
import type { ResolvedAssetAccess } from '@ise/runtime-contracts';
import { prepareTrajectory, sampleTrajectory } from '../trajectory';

const metadata = {
  format: 'ise-trajectory/v1' as const,
  timeUnit: 'ms' as const,
  coordinateOrder: 'lng-lat-alt' as const,
  startTimeMs: 0,
  endTimeMs: 2_000,
  monotonic: true as const,
} satisfies Extract<ResolvedAssetAccess, { mediaType: 'application/vnd.ise.trajectory+json' }>['trajectory'];

const document = {
  schemaVersion: 'ise-trajectory/v1',
  points: [
    { timeMs: 0, longitude: 76, latitude: 30, altitudeM: 1_000 },
    { timeMs: 1_000, longitude: 77, latitude: 30, altitudeM: 1_100 },
    { timeMs: 2_000, longitude: 78, latitude: 30, altitudeM: 1_200 },
  ],
};

const invalidTrajectoryCases: Array<[unknown, string, typeof metadata]> = [
  [
    { ...document, points: [document.points[0], { ...document.points[1], timeMs: 0 }] },
    'strictly increasing',
    metadata,
  ],
  [
    {
      ...document,
      points: [{ ...document.points[0], longitude: 181 }, ...document.points.slice(1)],
    },
    'longitude',
    metadata,
  ],
  [{ ...document, schemaVersion: 'raw-track/v0' }, 'schemaVersion', metadata],
  [document, 'metadata bounds', { ...metadata, endTimeMs: 2_001 }],
];

describe('prepareTrajectory', () => {
  it('accepts canonical relative milliseconds without renormalizing them', () => {
    const trajectory = prepareTrajectory(document, metadata);
    expect(trajectory.points.map((point) => point.timeMs)).toEqual([0, 1_000, 2_000]);
    expect(trajectory.durationMs).toBe(2_000);
  });

  it.each(invalidTrajectoryCases)(
    'rejects invalid canonical input',
    (value, message, metadataOverride) => {
      expect(() => prepareTrajectory(value, metadataOverride)).toThrowError(
        new RegExp(message, 'i'),
      );
    },
  );
});

describe('sampleTrajectory', () => {
  const trajectory = prepareTrajectory(document, metadata);

  it('clamps first and last and linearly interpolates the midpoint', () => {
    expect(sampleTrajectory(trajectory, -1).longitude).toBe(76);
    expect(sampleTrajectory(trajectory, 500)).toMatchObject({
      longitude: 76.5,
      latitude: 30,
      altitudeM: 1_050,
    });
    expect(sampleTrajectory(trajectory, 9_000).longitude).toBe(78);
  });

  it('computes eastbound heading and a positive climb pitch', () => {
    const sample = sampleTrajectory(trajectory, 500);
    expect(sample.headingDeg).toBeCloseTo(89.75, 2);
    expect(sample.pitchDeg).toBeGreaterThan(0);
    expect(sample.tailEndIndex).toBe(1);
  });

  it('uses spherical initial bearing for a high-latitude long segment', () => {
    const highLatitude = prepareTrajectory(
      {
        schemaVersion: 'ise-trajectory/v1',
        points: [
          { timeMs: 0, longitude: 0, latitude: 80, altitudeM: 1_000 },
          { timeMs: 1_000, longitude: 90, latitude: 80, altitudeM: 1_000 },
        ],
      },
      { ...metadata, endTimeMs: 1_000 },
    );

    expect(sampleTrajectory(highLatitude, 500).headingDeg).toBeCloseTo(45.44, 2);
  });

  it('uses the shortest spherical segment across the antimeridian', () => {
    const antimeridian = prepareTrajectory(
      {
        schemaVersion: 'ise-trajectory/v1',
        points: [
          { timeMs: 0, longitude: 179, latitude: 10, altitudeM: 1_000 },
          { timeMs: 1_000, longitude: -179, latitude: 10, altitudeM: 1_000 },
        ],
      },
      { ...metadata, endTimeMs: 1_000 },
    );

    const sample = sampleTrajectory(antimeridian, 500);
    expect(Math.abs(sample.longitude)).toBeCloseTo(180, 6);
    expect(sample.headingDeg).toBeCloseTo(89.826, 3);
  });
});
