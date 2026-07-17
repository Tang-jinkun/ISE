import type { SceneTrack } from '@ise/runtime-contracts';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { DataLinkRuntime } from '../DataLinkRuntime';
import type { ModelEntityFrameSnapshot } from '../ModelRuntime';
import { FakeMap } from './helpers/fakes';

type DataLinkTrack = Extract<SceneTrack, { type: 'data_link' }>;

const evidenceRefs = ['fixture:evidence'];
const sourceId = 'ise:data-links';
const layerId = 'ise-data-link-runtime';

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
  position: [number, number, number] = [0, 0, 0],
): ModelEntityFrameSnapshot {
  return {
    entityId,
    state: 'normal',
    visible,
    longitude,
    latitude,
    position,
    quaternion: [0, 0, 0, 1],
  };
}

function rendererHarness() {
  const map = new FakeMap();
  const renderers: Array<{
    autoClear: boolean;
    resetState: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  const createRenderer = vi.fn(() => {
    const renderer = {
      autoClear: true,
      resetState: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    };
    renderers.push(renderer);
    return renderer as never;
  });
  const runtime = new DataLinkRuntime(map as never, {
    createRenderer,
  });
  return { map, renderers, createRenderer, runtime };
}

function renderedLines(
  map: FakeMap,
  renderer: { render: ReturnType<typeof vi.fn> },
) {
  const layer = map.getLayer(layerId) as {
    render(gl: unknown, matrix: Float64Array): void;
  };
  layer.render({}, new Float64Array(new THREE.Matrix4().identity().toArray()));
  const scene = renderer.render.mock.calls.at(-1)![0] as THREE.Scene;
  return scene.children.filter((child): child is THREE.Line => child instanceof THREE.Line);
}

it('renders altitude-aware endpoints from model Mercator positions with distinct link styling', async () => {
  const { map, renderers, runtime } = rendererHarness();
  await runtime.load([
    dataLinkTrack([
      link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter'),
      link('fighter-to-missile', 'fighter', 'missile', 'fighter-missile'),
    ]),
  ]);

  runtime.apply(500, [
    snapshot('awacs', 76, 30, true, [0.25, 0.4, 0.00012]),
    snapshot('fighter', 77, 31, true, [0.27, 0.42, 0.00018]),
    snapshot('missile', 78, 32, true, [0.31, 0.45, 0.00033]),
  ]);
  const lines = renderedLines(map, renderers[0]!);
  expect(lines).toHaveLength(2);
  const byName = new Map(lines.map((lineItem) => [lineItem.name, lineItem]));
  const awacsLine = byName.get('awacs-to-fighter')!;
  const missileLine = byName.get('fighter-to-missile')!;
  expect(awacsLine.position.toArray()).toEqual([0.25, 0.4, 0.00012]);
  expect([...awacsLine.geometry.getAttribute('position').array]).toEqual([
    0, 0, 0, expect.closeTo(0.02), expect.closeTo(0.02), expect.closeTo(0.00006),
  ]);
  expect(missileLine.position.toArray()).toEqual([0.27, 0.42, 0.00018]);
  expect([...missileLine.geometry.getAttribute('position').array]).toEqual([
    0, 0, 0, expect.closeTo(0.04), expect.closeTo(0.03), expect.closeTo(0.00015),
  ]);
  expect((awacsLine.material as THREE.LineBasicMaterial).color.getHexString()).toBe('22d3ee');
  expect((missileLine.material as THREE.LineBasicMaterial).color.getHexString()).toBe('f59e0b');
  expect(map.getSource(sourceId)).toBeUndefined();
});

it('updates line endpoints from the current moving model snapshots', async () => {
  const { map, renderers, runtime } = rendererHarness();
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter')])]);

  runtime.apply(250, [
    snapshot('awacs', 76, 30, true, [0.2, 0.3, 0.0001]),
    snapshot('fighter', 77, 31, true, [0.25, 0.35, 0.0002]),
  ]);
  runtime.apply(500, [
    snapshot('awacs', 76.5, 30.5, true, [0.3, 0.4, 0.0002]),
    snapshot('fighter', 77.5, 31.5, true, [0.38, 0.47, 0.0004]),
  ]);

  const lineItem = renderedLines(map, renderers[0]!)[0]!;
  expect(lineItem.position.toArray()).toEqual([0.3, 0.4, 0.0002]);
  expect([...lineItem.geometry.getAttribute('position').array]).toEqual([
    0, 0, 0, expect.closeTo(0.08), expect.closeTo(0.07), expect.closeTo(0.0002),
  ]);
});

it.each([
  ['missing', [snapshot('awacs', 76, 30, true, [0.2, 0.3, 0.0001])]],
  ['hidden', [
    snapshot('awacs', 76, 30, true, [0.2, 0.3, 0.0001]),
    snapshot('fighter', 77, 31, false, [0.3, 0.4, 0.0002]),
  ]],
  ['non-finite', [
    snapshot('awacs', 76, 30, true, [Number.NaN, 0.3, 0.0001]),
    snapshot('fighter', 77, 31, true, [0.3, 0.4, 0.0002]),
  ]],
])('hides a link with a %s endpoint', async (_condition, endpoints) => {
  const { map, renderers, runtime } = rendererHarness();
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter')])]);

  runtime.apply(500, endpoints);

  expect(renderedLines(map, renderers[0]!).every((lineItem) => !lineItem.visible)).toBe(true);
});

it('keeps concurrent link kinds as independent lines', async () => {
  const { map, renderers, runtime } = rendererHarness();
  await runtime.load([
    dataLinkTrack([
      link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter'),
      link('fighter-to-missile', 'fighter', 'missile', 'fighter-missile'),
    ]),
  ]);

  runtime.apply(500, [
    snapshot('awacs', 76, 30, true, [0.2, 0.3, 0.0001]),
    snapshot('fighter', 77, 31, true, [0.3, 0.4, 0.0002]),
    snapshot('missile', 78, 32, true, [0.4, 0.5, 0.0003]),
  ]);

  expect(renderedLines(map, renderers[0]!).filter((lineItem) => lineItem.visible).map((lineItem) => lineItem.name))
    .toEqual(['awacs-to-fighter', 'fighter-to-missile']);
});

it('renders no line outside an item active window', async () => {
  const { map, renderers, runtime } = rendererHarness();
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter', 100, 200)])]);
  const endpoints = [
    snapshot('awacs', 76, 30, true, [0.2, 0.3, 0.0001]),
    snapshot('fighter', 77, 31, true, [0.3, 0.4, 0.0002]),
  ];

  runtime.apply(99, endpoints);
  expect(renderedLines(map, renderers[0]!)[0]!.visible).toBe(false);
  runtime.apply(300, endpoints);
  expect(renderedLines(map, renderers[0]!)[0]!.visible).toBe(false);
});

it('restores the custom layer and latest lines after a style reload', async () => {
  const { map, renderers, runtime } = rendererHarness();
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter')])]);
  runtime.apply(500, [
    snapshot('awacs', 76, 30, true, [0.2, 0.3, 0.0001]),
    snapshot('fighter', 77, 31, true, [0.3, 0.4, 0.0002]),
  ]);

  map.clearStyleAndEmit('style.load');

  expect(map.layerIds()).toEqual([layerId]);
  expect(renderers).toHaveLength(2);
  expect(renderers[0]!.dispose).toHaveBeenCalledTimes(1);
  expect(renderedLines(map, renderers[1]!)[0]!.visible).toBe(true);
});

it('unregisters its listener and removes the custom layer idempotently', async () => {
  const { map, renderers, runtime } = rendererHarness();
  await runtime.load([dataLinkTrack([link('awacs-to-fighter', 'awacs', 'fighter', 'awacs-fighter')])]);

  runtime.dispose();
  runtime.dispose();

  expect(map.listenerCount('style.load')).toBe(0);
  expect(map.removeLayer).toHaveBeenCalledTimes(1);
  expect(map.removeLayer).toHaveBeenCalledWith(layerId);
  expect(map.removeSource).not.toHaveBeenCalled();
  expect(renderers[0]!.dispose).toHaveBeenCalledTimes(1);
  expect(map.layerIds()).toEqual([]);
});
