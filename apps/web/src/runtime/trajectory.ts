import {
  trajectorySchema,
  type NormalizedTrajectory,
  type ResolvedAssetAccess,
} from '@ise/runtime-contracts';
import { SceneRuntimeError } from './errors';

type CanonicalPoint = NormalizedTrajectory['points'][number];
type TrajectoryMetadata = Extract<
  ResolvedAssetAccess,
  { mediaType: 'application/vnd.ise.trajectory+json' }
>['trajectory'];

export interface PreparedTrajectory {
  points: CanonicalPoint[];
  durationMs: number;
}

export interface TrajectorySample extends CanonicalPoint {
  headingDeg: number;
  pitchDeg: number;
  tailEndIndex: number;
}

export function prepareTrajectory(
  value: unknown,
  metadata: TrajectoryMetadata,
): PreparedTrajectory {
  let document: NormalizedTrajectory;
  try {
    document = trajectorySchema.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trajectory schema validation failed';
    throw new SceneRuntimeError('TRAJECTORY_INVALID', message, undefined, { cause: error });
  }

  const first = document.points[0]!;
  const last = document.points.at(-1)!;
  if (
    metadata.format !== 'ise-trajectory/v1' ||
    metadata.timeUnit !== 'ms' ||
    metadata.coordinateOrder !== 'lng-lat-alt' ||
    metadata.monotonic !== true ||
    first.timeMs !== 0 ||
    first.timeMs !== metadata.startTimeMs ||
    last.timeMs !== metadata.endTimeMs
  ) {
    throw new SceneRuntimeError(
      'TRAJECTORY_INVALID',
      'Trajectory metadata bounds or canonical format do not match',
    );
  }

  return {
    points: document.points,
    durationMs: last.timeMs - first.timeMs,
  };
}

export function sampleTrajectory(
  trajectory: PreparedTrajectory,
  elapsedMs: number,
): TrajectorySample {
  const points = trajectory.points;
  const finiteElapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const timeMs = Math.min(trajectory.durationMs, Math.max(0, finiteElapsedMs));

  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (points[middle]!.timeMs <= timeMs) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const start = points[low]!;
  const end = points[Math.min(low + 1, points.length - 1)]!;
  const ratio = end.timeMs === start.timeMs ? 0 : (timeMs - start.timeMs) / (end.timeMs - start.timeMs);
  const longitude = interpolateLongitude(start.longitude, end.longitude, ratio);
  const latitude = start.latitude + (end.latitude - start.latitude) * ratio;
  const altitudeM = start.altitudeM + (end.altitudeM - start.altitudeM) * ratio;
  const [orientationStart, orientationEnd] = orientationSegment(points, low);
  const horizontalM = haversineMeters(
    orientationStart.longitude,
    orientationStart.latitude,
    orientationEnd.longitude,
    orientationEnd.latitude,
  );

  return {
    timeMs,
    longitude,
    latitude,
    altitudeM,
    headingDeg:
      horizontalM === 0
        ? 0
        : bearingDegrees(
            orientationStart.longitude,
            orientationStart.latitude,
            orientationEnd.longitude,
            orientationEnd.latitude,
          ),
    pitchDeg:
      horizontalM === 0
        ? 0
        : (Math.atan2(orientationEnd.altitudeM - orientationStart.altitudeM, horizontalM) *
            180) /
          Math.PI,
    tailEndIndex: Math.min(low + 1, points.length - 1),
  };
}

function orientationSegment(
  points: CanonicalPoint[],
  segmentStartIndex: number,
): [CanonicalPoint, CanonicalPoint] {
  const currentStart = points[segmentStartIndex]!;
  const currentEnd = points[Math.min(segmentStartIndex + 1, points.length - 1)]!;
  if (!sameSpatialPoint(currentStart, currentEnd)) {
    return [currentStart, currentEnd];
  }

  for (let distance = 1; distance < points.length; distance += 1) {
    const previousIndex = segmentStartIndex - distance;
    if (previousIndex >= 0) {
      const previousStart = points[previousIndex]!;
      const previousEnd = points[previousIndex + 1]!;
      if (!sameSpatialPoint(previousStart, previousEnd)) {
        return [previousStart, previousEnd];
      }
    }

    const nextIndex = segmentStartIndex + distance;
    if (nextIndex < points.length - 1) {
      const nextStart = points[nextIndex]!;
      const nextEnd = points[nextIndex + 1]!;
      if (!sameSpatialPoint(nextStart, nextEnd)) {
        return [nextStart, nextEnd];
      }
    }
  }

  return [currentStart, currentEnd];
}

function sameSpatialPoint(left: CanonicalPoint, right: CanonicalPoint) {
  return (
    left.longitude === right.longitude &&
    left.latitude === right.latitude &&
    left.altitudeM === right.altitudeM
  );
}

function interpolateLongitude(start: number, end: number, ratio: number) {
  const delta = ((((end - start) % 360) + 540) % 360) - 180;
  const longitude = start + delta * ratio;
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function haversineMeters(
  startLongitude: number,
  startLatitude: number,
  endLongitude: number,
  endLatitude: number,
) {
  const earthRadiusM = 6_371_008.8;
  const startLatitudeRad = degreesToRadians(startLatitude);
  const endLatitudeRad = degreesToRadians(endLatitude);
  const latitudeDelta = endLatitudeRad - startLatitudeRad;
  const longitudeDelta = degreesToRadians(shortestLongitudeDelta(startLongitude, endLongitude));
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitudeRad) *
      Math.cos(endLatitudeRad) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function bearingDegrees(
  startLongitude: number,
  startLatitude: number,
  endLongitude: number,
  endLatitude: number,
) {
  const startLatitudeRad = degreesToRadians(startLatitude);
  const endLatitudeRad = degreesToRadians(endLatitude);
  const longitudeDelta = degreesToRadians(shortestLongitudeDelta(startLongitude, endLongitude));
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitudeRad);
  const x =
    Math.cos(startLatitudeRad) * Math.sin(endLatitudeRad) -
    Math.sin(startLatitudeRad) * Math.cos(endLatitudeRad) * Math.cos(longitudeDelta);
  if (x === 0 && y === 0) {
    return 0;
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function shortestLongitudeDelta(start: number, end: number) {
  return ((((end - start) % 360) + 540) % 360) - 180;
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}
