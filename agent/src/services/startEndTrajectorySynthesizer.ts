import { trajectorySchema, type NormalizedTrajectory } from '@ise/runtime-contracts'
import { fingerprint } from './fingerprint.ts'

export type TrajectoryRequest = {
  actorId: string
  start: { coordinates: [number, number]; altitudeM?: number }
  end: { coordinates: [number, number]; altitudeM?: number }
  source: 'document'
  sourceRefs: string[]
  pathStyle: 'great_circle' | 'intercept'
  startMs: number
  endMs: number
  speedKmh?: number
  targetActorId?: string
}

export type GeneratedTrajectory = {
  assetId: `trajectory:${string}`
  sourceKind: 'generated'
  generationMethod: 'document-endpoints-v1'
  sourceRefs: string[]
  pathStyle: TrajectoryRequest['pathStyle']
  targetActorId?: string
  points: NormalizedTrajectory['points']
}

const EARTH_RADIUS_M = 6_371_008.8
const DEFAULT_ALTITUDE_M = 9_000

function assertCoordinates(value: [number, number] | undefined, label: string): asserts value is [number, number] {
  if (!value || value.length !== 2 || !value.every(Number.isFinite)
    || value[0]! < -180 || value[0]! > 180 || value[1]! < -90 || value[1]! > 90) {
    throw new Error(`INVALID_TRAJECTORY_${label.toUpperCase()}`)
  }
}

function assertRequest(request: TrajectoryRequest): void {
  if (!request.actorId || request.source !== 'document' || request.sourceRefs.length === 0) {
    throw new Error('INVALID_TRAJECTORY_REQUEST')
  }
  assertCoordinates(request.start?.coordinates, 'start')
  assertCoordinates(request.end?.coordinates, 'end')
  if (!Number.isInteger(request.startMs) || !Number.isInteger(request.endMs) || request.endMs <= request.startMs) {
    throw new Error('INVALID_TRAJECTORY_TIME_WINDOW')
  }
}

function radians(value: number): number { return value * Math.PI / 180 }
function degrees(value: number): number { return value * 180 / Math.PI }

function vector(coordinates: [number, number]): [number, number, number] {
  const longitude = radians(coordinates[0])
  const latitude = radians(coordinates[1])
  const cosLatitude = Math.cos(latitude)
  return [cosLatitude * Math.cos(longitude), cosLatitude * Math.sin(longitude), Math.sin(latitude)]
}

function coordinates(value: [number, number, number]): [number, number] {
  return [degrees(Math.atan2(value[1], value[0])), degrees(Math.atan2(value[2], Math.hypot(value[0], value[1])))]
}

function interpolate(start: [number, number], end: [number, number], ratio: number): [number, number] {
  const left = vector(start)
  const right = vector(end)
  const dot = Math.min(1, Math.max(-1, left[0] * right[0] + left[1] * right[1] + left[2] * right[2]))
  const angle = Math.acos(dot)
  if (angle < 1e-9) return [...start]
  const sine = Math.sin(angle)
  if (Math.abs(sine) < 1e-9) {
    const longitudeDelta = ((((end[0] - start[0]) % 360) + 540) % 360) - 180
    return [start[0] + longitudeDelta * ratio, start[1] + (end[1] - start[1]) * ratio]
  }
  const leftWeight = Math.sin((1 - ratio) * angle) / sine
  const rightWeight = Math.sin(ratio * angle) / sine
  const point: [number, number, number] = [
    left[0] * leftWeight + right[0] * rightWeight,
    left[1] * leftWeight + right[1] * rightWeight,
    left[2] * leftWeight + right[2] * rightWeight,
  ]
  return coordinates(point)
}

function distanceKm(start: [number, number], end: [number, number]): number {
  const latitudeDelta = radians(end[1] - start[1])
  const longitudeDelta = radians((((end[0] - start[0]) % 360) + 540) % 360 - 180)
  const startLatitude = radians(start[1])
  const endLatitude = radians(end[1])
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) / 1_000
}

function bounds(points: NormalizedTrajectory['points']): [[number, number], [number, number]] {
  return [
    [Math.min(...points.map(point => point.longitude)), Math.min(...points.map(point => point.latitude))],
    [Math.max(...points.map(point => point.longitude)), Math.max(...points.map(point => point.latitude))],
  ]
}

export function synthesizeStartEndTrajectory(request: TrajectoryRequest): GeneratedTrajectory {
  assertRequest(request)
  const distance = distanceKm(request.start.coordinates, request.end.coordinates)
  const pointCount = Math.max(16, Math.min(32, Math.round(distance / 25) + 16))
  const duration = request.endMs - request.startMs
  if (duration < pointCount - 1) throw new Error('INVALID_TRAJECTORY_TIME_WINDOW')
  const startAltitude = request.start.altitudeM ?? DEFAULT_ALTITUDE_M
  const endAltitude = request.end.altitudeM ?? startAltitude
  const points = Array.from({ length: pointCount }, (_, index) => {
    const ratio = index / (pointCount - 1)
    const [longitude, latitude] = index === 0
      ? request.start.coordinates
      : index === pointCount - 1
        ? request.end.coordinates
        : interpolate(request.start.coordinates, request.end.coordinates, ratio)
    return {
      timeMs: request.startMs + Math.round(duration * ratio),
      longitude,
      latitude,
      altitudeM: startAltitude + (endAltitude - startAltitude) * ratio,
    }
  })
  const normalized = trajectorySchema.parse({ schemaVersion: 'ise-trajectory/v1', points: points.map(point => ({
    ...point,
    timeMs: point.timeMs - request.startMs,
  })) })
  const digest = fingerprint({ request, points }).slice('sha256:'.length, 'sha256:'.length + 16)
  return {
    assetId: `trajectory:generated-${digest}`,
    sourceKind: 'generated',
    generationMethod: 'document-endpoints-v1',
    sourceRefs: [...request.sourceRefs],
    pathStyle: request.pathStyle,
    ...(request.targetActorId ? { targetActorId: request.targetActorId } : {}),
    points: normalized.points.map(point => ({ ...point, timeMs: point.timeMs + request.startMs })),
  }
}

export function generatedTrajectoryBounds(trajectory: GeneratedTrajectory): [[number, number], [number, number]] {
  return bounds(trajectory.points)
}
