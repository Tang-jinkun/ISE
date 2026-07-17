import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sceneProjectConfigJsonSchema,
  sceneProjectConfigSchema,
  type SceneProjectConfig
} from '../src/index.js';
import { compileJsonSchema } from './json-schema.js';

const item = {
  id: 'item-1',
  eventUnitId: 'event-1',
  startMs: 0,
  durationMs: 1000,
  evidenceRefs: ['evidence-1']
};

function validConfig(): SceneProjectConfig {
  return {
    schemaVersion: 'ise-scene/v1',
    sourceDocumentId: 'document-1',
    eventPlanArtifactId: 'artifact-event-1',
    runtimePlanArtifactId: 'artifact-runtime-1',
    totalDurationMs: 5000,
    entities: [{
      entityId: 'entity-jf17',
      displayName: 'JF-17',
      kind: 'aircraft',
      modelAssetId: 'model:jf17',
      defaultTrajectoryAssetId: 'trajectory:ambala-rafale-1',
      initialState: 'normal'
    }, {
      entityId: 'entity-awacs',
      displayName: 'Netra AWACS',
      kind: 'aircraft',
      modelAssetId: 'model:netra-awacs',
      defaultTrajectoryAssetId: 'trajectory:india-awacs-1',
      initialState: 'normal'
    }],
    tracks: [
      { trackId: 'subtitle-1', type: 'subtitle', label: 'Subtitles', visible: true, items: [{ ...item, params: { text: 'Contact', position: 'bottom', maxWidthPct: 80 } }] },
      { trackId: 'image-1', type: 'image', label: 'Image', visible: true, items: [{ ...item, id: 'item-image-1', assetId: 'image:ground-radar', params: { layout: { xPct: 5, yPct: 5, widthPct: 30, heightPct: 30, zIndex: 10, opacity: 1, fit: 'contain' }, enter: 'fade', exit: 'fade' } }] },
      { trackId: 'video-1', type: 'video', label: 'Video', visible: true, items: [{ ...item, id: 'item-video-1', assetId: 'video:missile-impact', params: { layout: { xPct: 60, yPct: 5, widthPct: 35, heightPct: 30, zIndex: 20, opacity: 1, fit: 'cover' }, volume: 0.8, playbackRate: 1, loop: false } }] },
      { trackId: 'marker-1', type: 'marker', label: 'Marker', visible: true, items: [{ ...item, id: 'item-marker-1', params: { coordinates: [76.8, 30.4], label: 'Ambala', color: '#ff0000' } }] },
      { trackId: 'geojson-1', type: 'geojson', label: 'GeoJSON', visible: true, items: [{ ...item, id: 'item-geojson-1', assetId: 'geojson:airspace', params: { lineColor: '#00ffff', lineWidth: 2, fillColor: '#004455', fillOpacity: 0.2, circleColor: '#ffffff', circleRadius: 4, keepAfterEnd: false } }] },
      { trackId: 'camera-1', type: 'camera', label: 'Camera', visible: true, items: [{ ...item, id: 'item-camera-1', params: { center: [76.8, 30.4], zoom: 8, pitch: 45, bearing: 90, easing: 'easeInOut' } }] },
      { trackId: 'model-1', type: 'model', label: 'Models', visible: true, items: [{ ...item, id: 'item-model-1', params: { action: 'model.follow_path', entityId: 'entity-jf17', trajectoryAssetId: 'trajectory:ambala-rafale-1' } }] },
      { trackId: 'data-link-1', type: 'data_link', label: 'Data link', visible: true, items: [{ ...item, id: 'item-data-link-1', params: { sourceEntityId: 'entity-jf17', targetEntityId: 'entity-awacs', linkKind: 'awacs-fighter' } }] }
    ],
    diagnostics: []
  } as unknown as SceneProjectConfig;
}

test('accepts all eight frozen track variants', () => {
  const parsed = sceneProjectConfigSchema.parse(validConfig());
  assert.deepEqual(parsed.tracks.map(track => track.type), [
    'subtitle', 'image', 'video', 'marker', 'geojson', 'camera', 'model', 'data_link'
  ]);
});

test('data link tracks require distinct known endpoints and strict link kinds', () => {
  const unknownEndpoint = validConfig() as SceneProjectConfig & { tracks: any[] };
  unknownEndpoint.tracks[7].items[0].params.targetEntityId = 'entity:missing';
  assert.equal(sceneProjectConfigSchema.safeParse(unknownEndpoint).success, false);

  const sameEndpoint = validConfig() as SceneProjectConfig & { tracks: any[] };
  sameEndpoint.tracks[7].items[0].params.targetEntityId = 'entity-jf17';
  assert.equal(sceneProjectConfigSchema.safeParse(sameEndpoint).success, false);

  const unknownKind = validConfig() as SceneProjectConfig & { tracks: any[] };
  unknownKind.tracks[7].items[0].params.linkKind = 'fighter-fighter';
  assert.equal(sceneProjectConfigSchema.safeParse(unknownKind).success, false);

  const extraField = validConfig() as SceneProjectConfig & { tracks: any[] };
  extraField.tracks[7].items[0].params.coordinates = [[76, 30], [77, 31]];
  assert.equal(sceneProjectConfigSchema.safeParse(extraField).success, false);
});

test('camera tracks support strict actor and group follow actions with known unique entities', () => {
  const actorFollow = validConfig() as SceneProjectConfig & { tracks: any[] };
  actorFollow.tracks[5].items[0].params = {
    action: 'camera.follow_actor', entityId: 'entity-jf17', framing: 'tracking', zoom: 12,
    pitch: 45, bearing: 90, lookAheadMs: 500, transitionMs: 250
  };
  assert.equal(sceneProjectConfigSchema.safeParse(actorFollow).success, true);

  const groupFollow = validConfig() as SceneProjectConfig & { tracks: any[] };
  groupFollow.tracks[5].items[0].params = {
    action: 'camera.follow_group', entityIds: ['entity-jf17', 'entity-awacs'], framing: 'formation',
    paddingPx: 24, minZoom: 6, maxZoom: 14, pitch: 30, bearing: -45, transitionMs: 500
  };
  assert.equal(sceneProjectConfigSchema.safeParse(groupFollow).success, true);

  const unknownActor = validConfig() as SceneProjectConfig & { tracks: any[] };
  unknownActor.tracks[5].items[0].params = { ...actorFollow.tracks[5].items[0].params, entityId: 'missing' };
  assert.equal(sceneProjectConfigSchema.safeParse(unknownActor).success, false);

  const unknownGroup = validConfig() as SceneProjectConfig & { tracks: any[] };
  unknownGroup.tracks[5].items[0].params = { ...groupFollow.tracks[5].items[0].params, entityIds: ['entity-jf17', 'missing'] };
  assert.equal(sceneProjectConfigSchema.safeParse(unknownGroup).success, false);

  const duplicateGroup = validConfig() as SceneProjectConfig & { tracks: any[] };
  duplicateGroup.tracks[5].items[0].params = { ...groupFollow.tracks[5].items[0].params, entityIds: ['entity-jf17', 'entity-jf17'] };
  assert.equal(sceneProjectConfigSchema.safeParse(duplicateGroup).success, false);

  const invalidBounds = validConfig() as SceneProjectConfig & { tracks: any[] };
  invalidBounds.tracks[5].items[0].params = { ...groupFollow.tracks[5].items[0].params, minZoom: 15, maxZoom: 14 };
  assert.equal(sceneProjectConfigSchema.safeParse(invalidBounds).success, false);
});

test('accepts destroyed model state and rejects unknown states', () => {
  const destroyed = validConfig() as SceneProjectConfig & { tracks: any[] };
  destroyed.tracks[6].items[0].params = {
    action: 'model.set_state', entityId: 'entity-jf17', state: 'destroyed'
  };
  assert.equal(sceneProjectConfigSchema.safeParse(destroyed).success, true);

  const unknown = validConfig() as SceneProjectConfig & { tracks: any[] };
  unknown.tracks[6].items[0].params = {
    action: 'model.set_state', entityId: 'entity-jf17', state: 'exploded'
  };
  assert.equal(sceneProjectConfigSchema.safeParse(unknown).success, false);
});

test('rejects unknown properties at the root and nested item levels', () => {
  assert.equal(sceneProjectConfigSchema.safeParse({ ...validConfig(), extra: true }).success, false);
  const nested = validConfig() as SceneProjectConfig & { tracks: any[] };
  nested.tracks[0].items[0].params.extra = true;
  assert.equal(sceneProjectConfigSchema.safeParse(nested).success, false);
});

test('rejects incompatible versions, unsafe asset ids, bad time, and missing evidence', () => {
  const version = { ...validConfig(), schemaVersion: 'ise-scene/v2' };
  assert.equal(sceneProjectConfigSchema.safeParse(version).success, false);

  const unsafe = validConfig() as SceneProjectConfig & { tracks: any[] };
  unsafe.tracks[1].items[0].assetId = 'C:\\assets\\radar.png';
  assert.equal(sceneProjectConfigSchema.safeParse(unsafe).success, false);

  const badTime = validConfig() as SceneProjectConfig & { tracks: any[] };
  badTime.tracks[0].items[0].startMs = -1;
  assert.equal(sceneProjectConfigSchema.safeParse(badTime).success, false);

  const noEvidence = validConfig() as SceneProjectConfig & { tracks: any[] };
  noEvidence.tracks[0].items[0].evidenceRefs = [];
  assert.equal(sceneProjectConfigSchema.safeParse(noEvidence).success, false);
});

test('rejects duplicate ids, items beyond duration, and unknown model entities', () => {
  const duplicate = validConfig();
  duplicate.tracks.push(duplicate.tracks[0]!);
  assert.equal(sceneProjectConfigSchema.safeParse(duplicate).success, false);

  const overrun = validConfig() as SceneProjectConfig & { tracks: any[] };
  overrun.tracks[0].items[0].startMs = 4900;
  overrun.tracks[0].items[0].durationMs = 200;
  assert.equal(sceneProjectConfigSchema.safeParse(overrun).success, false);

  const unknownEntity = validConfig() as SceneProjectConfig & { tracks: any[] };
  unknownEntity.tracks[6].items[0].params.entityId = 'missing';
  assert.equal(sceneProjectConfigSchema.safeParse(unknownEntity).success, false);
});

test('requires kind-specific asset IDs only on image, video, and geojson items', () => {
  for (const trackIndex of [1, 2, 4]) {
    const missing = validConfig() as SceneProjectConfig & { tracks: any[] };
    delete missing.tracks[trackIndex].items[0].assetId;
    assert.equal(sceneProjectConfigSchema.safeParse(missing).success, false);
  }

  const wrongKinds = [
    [1, 'video:missile-impact'],
    [2, 'image:ground-radar'],
    [4, 'image:ground-radar']
  ] as const;
  for (const [trackIndex, wrongAssetId] of wrongKinds) {
    const wrong = validConfig() as SceneProjectConfig & { tracks: any[] };
    wrong.tracks[trackIndex].items[0].assetId = wrongAssetId;
    assert.equal(sceneProjectConfigSchema.safeParse(wrong).success, false);
  }

  for (const trackIndex of [0, 3, 5, 6]) {
    const irrelevant = validConfig() as SceneProjectConfig & { tracks: any[] };
    irrelevant.tracks[trackIndex].items[0].assetId = 'image:ground-radar';
    assert.equal(sceneProjectConfigSchema.safeParse(irrelevant).success, false);
  }
});

test('rejects blank, whitespace-wrapped IDs and other noncanonical public strings in Zod and JSON Schema', () => {
  const validate = compileJsonSchema(sceneProjectConfigJsonSchema);
  const cases: Array<(config: SceneProjectConfig & { tracks: any[]; entities: any[] }) => void> = [
    config => { config.sourceDocumentId = '   '; },
    config => { config.sourceDocumentId = ' document-1 '; },
    config => { config.entities[0].entityId = ' entity-jf17 '; },
    config => { config.entities[0].displayName = ' JF-17 '; },
    config => { config.tracks[0].trackId = ' subtitle-1 '; },
    config => { config.tracks[0].label = ' Subtitles '; },
    config => { config.tracks[0].items[0].id = ' item-1 '; },
    config => { config.tracks[0].items[0].evidenceRefs = [' evidence-1 ']; },
    config => { config.tracks[0].items[0].params.text = ' Contact '; }
  ];

  for (const mutate of cases) {
    const config = validConfig() as SceneProjectConfig & { tracks: any[]; entities: any[] };
    mutate(config);
    assert.equal(sceneProjectConfigSchema.safeParse(config).success, false);
    assert.equal(validate(config), false, JSON.stringify(validate.errors));
  }
});

test('exports a strict JSON Schema', () => {
  assert.equal(sceneProjectConfigJsonSchema.additionalProperties, false);
  assert.deepEqual(sceneProjectConfigJsonSchema.properties?.schemaVersion, {
    type: 'string',
    const: 'ise-scene/v1'
  });
  assert.match(sceneProjectConfigJsonSchema.$comment ?? '', /runtime parser.*relational/i);

  const validate = compileJsonSchema(sceneProjectConfigJsonSchema);
  assert.equal(validate(validConfig()), true, JSON.stringify(validate.errors));

  const missing = validConfig() as SceneProjectConfig & { tracks: any[] };
  delete missing.tracks[1].items[0].assetId;
  assert.equal(validate(missing), false);

  const wrongKind = validConfig() as SceneProjectConfig & { tracks: any[] };
  wrongKind.tracks[2].items[0].assetId = 'image:ground-radar';
  assert.equal(validate(wrongKind), false);

  const irrelevant = validConfig() as SceneProjectConfig & { tracks: any[] };
  irrelevant.tracks[6].items[0].assetId = 'model:jf17';
  assert.equal(validate(irrelevant), false);
});
