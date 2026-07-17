import type { RuntimeCommandType } from '../contracts/runtimePlan.ts'

export interface CapabilityManifest {
  version: 'ise-capabilities/v1'
  commands: readonly RuntimeCommandType[]
  modelActions: readonly ['model.spawn', 'model.follow_path', 'model.set_state', 'model.hide']
  minimumDurations: Readonly<Record<RuntimeCommandType, number>>
  markerFallbackEntityKinds: readonly ['location', 'other']
}

export const capabilityManifest: CapabilityManifest = {
  version: 'ise-capabilities/v1',
  commands: [
    'image.show', 'video.play', 'marker.show', 'geojson.show', 'camera.transition',
    'data_link.show', 'model.spawn', 'model.follow_path', 'model.set_state', 'model.hide',
  ],
  modelActions: ['model.spawn', 'model.follow_path', 'model.set_state', 'model.hide'],
  minimumDurations: {
    'image.show': 4_000,
    'video.play': 1_000,
    'marker.show': 4_000,
    'geojson.show': 4_000,
    'camera.transition': 1_000,
    'data_link.show': 1_000,
    'model.spawn': 500,
    'model.follow_path': 4_000,
    'model.set_state': 1_000,
    'model.hide': 500,
  },
  markerFallbackEntityKinds: ['location', 'other'],
}
