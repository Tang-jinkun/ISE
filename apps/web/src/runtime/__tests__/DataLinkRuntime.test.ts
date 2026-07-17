import type { SceneTrack } from '@ise/runtime-contracts';
import { expect, it } from 'vitest';
import { DataLinkRuntime } from '../DataLinkRuntime';
import type { ModelEntityFrameSnapshot } from '../ModelRuntime';
import { FakeMap } from './helpers/fakes';

type DataLinkTrack = Extract<SceneTrack, { type: 'data_link' }>;

const evidenceRefs = ['fixture:evidence'];
const sourceId = 'ise:data-links';
const awacsFighterLayerId = 'ise:data-links:awacs-fighter';
const fighterMissileLayerId = 'ise:data-links:fighter-missile';

function dataLinkTrack(
  items: DataLinkTrack['items'],
  visible = true,
): DataLinkTrack {
  return {
    trackId: 'data-links',
    type: 'data_link',
    label: 'Data links',
    visible,
    items,
  };
}

function link(
  id: string,
  sourceEntityId: string,
  targetEntityId: string,
  linkKind: 'awacs-fighter' | 'fighter-missile',
  startMs = 0,
  durationMs = 1_000,
): DataLinkTrack['items'][number] {
  return {
    id,
    eventUnitId: `event-${id}`,
    startMs,
    durationMs,
    evidenceRefs,
    params: { sourceEntityId, targetEntityId, linkKind },
  };
}

function snapshot(
  entityId: string,
  longitude: number | undefined,
  latitude: number | undefined,
  visible = true,
): ModelEntityFrameSnapshot {
  return {
    entityId,
    visible,
    longitude,
    latitude,
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
  };
}

function features(map: FakeMap) {
  return (map.sourceData(sourceId) as { features: unknown[] }).features;
}

it('updates line endpoints from the current moving model snapshots', async () => {
  const map = new FakeMap();
  const runtime = new DataLinkRuntime(map as never);
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter')])]);

  runtime.apply(250, [snapshot('awacs', 76, 30), snapshot('fighter', 77, 31)]);
  runtime.apply(500, [snapshot('awacs', 76.5, 30.5), snapshot('fighter', 77.5, 31.5)]);

  expect(features(map)).toEqual([
    expect.objectContaining({
      properties: { id: 'awacs-to-fighter', linkKind: 'awacs-fighter' },
      geometry: { type: 'LineString', coordinates: [[76.5, 30.5], [77.5, 31.5]] },
    }),
  ]);
});

it.each([
  ['missing', [snapshot('awacs', 76, 30)]],
  ['hidden', [snapshot('awacs', 76, 30), snapshot('fighter', 77, 31, false)]],
  ['non-finite', [snapshot('awacs', Number.NaN, 30), snapshot('fighter', 77, 31)]],
])('hides a link with a %s endpoint', async (_condition, endpoints) => {
  const map = new FakeMap();
  const runtime = new DataLinkRuntime(map as never);
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter')])]);

  runtime.apply(500, endpoints);

  expect(features(map)).toEqual([]);
});

it('keeps concurrent link kinds as independent features', async () => {
  const map = new FakeMap();
  const runtime = new DataLinkRuntime(map as never);
  await runtime.load([
    dataLinkTrack([
      link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter'),
      link('fighter-to-missile', 'fighter', 'missile', 'fighter-missile'),
    ]),
  ]);

  runtime.apply(500, [
    snapshot('awacs', 76, 30),
    snapshot('fighter', 77, 31),
    snapshot('missile', 78, 32),
  ]);

  expect(features(map)).toEqual([
    expect.objectContaining({ properties: { id: 'awacs-to-fighter', linkKind: 'awacs-fighter' } }),
    expect.objectContaining({ properties: { id: 'fighter-to-missile', linkKind: 'fighter-missile' } }),
  ]);
});

it('renders no feature outside an item active window', async () => {
  const map = new FakeMap();
  const runtime = new DataLinkRuntime(map as never);
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter', 100, 200)])]);

  runtime.apply(99, [snapshot('awacs', 76, 30), snapshot('fighter', 77, 31)]);
  expect(features(map)).toEqual([]);
  runtime.apply(300, [snapshot('awacs', 76, 30), snapshot('fighter', 77, 31)]);
  expect(features(map)).toEqual([]);
});

it('restores source, filtered layers, and the latest data after a style reload', async () => {
  const map = new FakeMap();
  const runtime = new DataLinkRuntime(map as never);
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter')])]);
  runtime.apply(500, [snapshot('awacs', 76, 30), snapshot('fighter', 77, 31)]);

  map.clearStyleAndEmit('style.load');

  expect(map.layerIds()).toEqual([awacsFighterLayerId, fighterMissileLayerId]);
  expect(features(map)).toEqual([
    expect.objectContaining({
      geometry: expect.objectContaining({ coordinates: [[76, 30], [77, 31]] }),
    }),
  ]);
});

it('unregisters its listener and removes layers before its source idempotently', async () => {
  const map = new FakeMap();
  const runtime = new DataLinkRuntime(map as never);
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter')])]);

  runtime.dispose();
  runtime.dispose();

  expect(map.listenerCount('style.load')).toBe(0);
  expect(map.removeLayer.mock.invocationCallOrder).toHaveLength(2);
  expect(map.removeSource.mock.invocationCallOrder).toHaveLength(1);
  expect(map.removeLayer.mock.invocationCallOrder[1]).toBeLessThan(
    map.removeSource.mock.invocationCallOrder[0]!,
  );
  expect(map.layerIds()).toEqual([]);
  expect(map.sourceData(sourceId)).toBeUndefined();
});
