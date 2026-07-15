import type { ResolvedAssetAccess, SceneEntity, SceneTrack } from '@ise/runtime-contracts';
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ModelRuntime, applyModelTransform, reduceModelFrame } from '../ModelRuntime';
import { prepareTrajectory, sampleTrajectory } from '../trajectory';
import { FakeMap } from './helpers/fakes';

type ModelTrack = Extract<SceneTrack, { type: 'model' }>;
type ModelItem = ModelTrack['items'][number];
type ModelMetadata = Extract<
  ResolvedAssetAccess,
  { mediaType: 'model/gltf-binary' }
>['model'];
type TrajectoryMetadata = Extract<
  ResolvedAssetAccess,
  { mediaType: 'application/vnd.ise.trajectory+json' }
>['trajectory'];

const evidenceRefs = ['fixture:evidence'];
const validModelMetadata: ModelMetadata = {
  scale: 1,
  rotationOffsetDeg: [0, 0, 90],
  altitudeOffsetM: 0,
  entityTypes: ['aircraft'],
};
const trajectoryMetadata: TrajectoryMetadata = {
  format: 'ise-trajectory/v1',
  timeUnit: 'ms',
  coordinateOrder: 'lng-lat-alt',
  startTimeMs: 0,
  endTimeMs: 2_000,
  monotonic: true,
};
const trajectoryDocument = {
  schemaVersion: 'ise-trajectory/v1' as const,
  points: [
    { timeMs: 0, longitude: 76, latitude: 30, altitudeM: 1_000 },
    { timeMs: 1_000, longitude: 76.5, latitude: 30, altitudeM: 1_050 },
    { timeMs: 2_000, longitude: 77, latitude: 30, altitudeM: 1_100 },
  ],
};
const eastboundTrajectory = prepareTrajectory(trajectoryDocument, trajectoryMetadata);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function rafale(entityId: string): SceneEntity {
  return {
    entityId,
    displayName: entityId,
    kind: 'aircraft',
    modelAssetId: 'model:rafale',
    defaultTrajectoryAssetId: 'trajectory:ambala-rafale-1',
    initialState: 'normal',
  };
}

function action(startMs: number, durationMs: number, params: ModelItem['params']): ModelItem {
  return {
    id: `action-${startMs}-${params.action}-${params.entityId}`,
    eventUnitId: 'event-1',
    startMs,
    durationMs,
    evidenceRefs,
    params,
  };
}

function modelActionTrack(items: ModelItem[]): ModelTrack {
  return { trackId: 'models', type: 'model', label: 'Models', visible: true, items };
}

function modelTrackFor(entityId: string, extraItems: ModelItem[] = []): ModelTrack {
  return modelActionTrack([
    action(0, 1, { action: 'model.spawn', entityId }),
    action(1_000, 2_000, {
      action: 'model.follow_path',
      entityId,
      trajectoryAssetId: 'trajectory:ambala-rafale-1',
    }),
    ...extraItems,
  ]);
}

function followOnlyTrack(entityId: string): ModelTrack {
  return modelActionTrack([
    action(0, 2_000, {
      action: 'model.follow_path',
      entityId,
      trajectoryAssetId: 'trajectory:ambala-rafale-1',
    }),
  ]);
}

function modelHarness(
  options: {
    modelMetadata?: ModelMetadata;
    template?: THREE.Object3D;
    readGltfGate?: Promise<void>;
  } = {},
) {
  const map = new FakeMap();
  const renderers: Array<{
    autoClear: boolean;
    resetState: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    forceContextLoss: ReturnType<typeof vi.fn>;
  }> = [];
  const createRenderer = vi.fn(() => {
    const renderer = {
      autoClear: true,
      resetState: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
      forceContextLoss: vi.fn(),
    };
    renderers.push(renderer);
    return renderer as never;
  });
  const template = options.template ?? new THREE.Group();
  const readGltf = vi.fn(async () => {
    await options.readGltfGate;
    return { scene: template };
  });
  const readJson = vi.fn(async () => trajectoryDocument);
  const modelMetadata = Object.hasOwn(options, 'modelMetadata')
    ? options.modelMetadata
    : validModelMetadata;
  const resources = {
    acquire: vi.fn(async (assetId: string) =>
      assetId.startsWith('model:')
        ? {
            access: {
              assetId,
              url: 'https://signed/model',
              fingerprint: `sha256:${'a'.repeat(64)}`,
              mediaType: 'model/gltf-binary',
              size: 12,
              expiresAt: '2099-01-01T00:00:00.000Z',
              model: modelMetadata,
            },
            readGltf,
          }
        : {
            access: {
              assetId,
              url: 'https://signed/trajectory',
              fingerprint: `sha256:${'b'.repeat(64)}`,
              mediaType: 'application/vnd.ise.trajectory+json',
              size: 100,
              expiresAt: '2099-01-01T00:00:00.000Z',
              trajectory: trajectoryMetadata,
            },
            readJson,
          },
    ),
    release: vi.fn(),
  };
  const clones: THREE.Object3D[] = [];
  const runtime = new ModelRuntime(map as never, resources as never, {
    createRenderer,
    cloneScene: (root) => {
      const clone = root.clone(true);
      clones.push(clone);
      return clone;
    },
    project: (_longitude, _latitude, altitudeM) => ({
      x: 0.25,
      y: 0.5,
      z: altitudeM / 1_000_000,
      meterInMercatorCoordinateUnits: () => 0.001,
    }),
  });
  return { map, renderers, createRenderer, resources, runtime, readGltf, readJson, clones };
}

function transformSnapshot(object: THREE.Object3D) {
  return {
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(),
    visible: object.visible,
  };
}

it('loads one GLB template and clones an instance per entity', async () => {
  const { map, readGltf, resources, runtime, clones } = modelHarness();

  await runtime.load(
    [rafale('one'), rafale('two')],
    [modelTrackFor('one'), modelTrackFor('two')],
  );

  expect(resources.acquire).toHaveBeenCalledTimes(2);
  expect(readGltf).toHaveBeenCalledTimes(1);
  expect(clones).toHaveLength(2);
  expect(clones[0]).not.toBe(clones[1]);
  expect(map.addLayer).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'ise-model-runtime',
      type: 'custom',
      renderingMode: '3d',
    }),
  );
});

it('does not resume loading or leak ownership after disposal during readGltf', async () => {
  const gate = deferred<void>();
  const { map, resources, runtime, readGltf, clones } = modelHarness({
    readGltfGate: gate.promise,
  });
  const loading = runtime.load([rafale('one')], [modelTrackFor('one')]);
  await vi.waitFor(() => expect(readGltf).toHaveBeenCalledTimes(1));

  runtime.dispose();
  gate.resolve();

  await expect(loading).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
  expect(resources.acquire.mock.calls).toEqual([['model:rafale', 'model', undefined]]);
  expect(resources.release.mock.calls).toEqual([['model:rafale']]);
  expect(clones).toEqual([]);
  expect(map.listenerCount('style.load')).toBe(0);
  expect(map.layerIds()).not.toContain('ise-model-runtime');
});

it('reduces spawn, follow, state, and hide at any seek time', () => {
  const items = modelActionTrack([
    action(0, 1, { action: 'model.spawn', entityId: 'one' }),
    action(1_000, 2_000, {
      action: 'model.follow_path',
      entityId: 'one',
      trajectoryAssetId: 'trajectory:ambala-rafale-1',
    }),
    action(1_500, 1, { action: 'model.set_state', entityId: 'one', state: 'warning' }),
    action(3_500, 1, { action: 'model.hide', entityId: 'one' }),
  ]).items;
  const trajectories = new Map([['trajectory:ambala-rafale-1', eastboundTrajectory]]);
  const expectedSample = sampleTrajectory(eastboundTrajectory, 1_000);

  const active = reduceModelFrame(rafale('one'), items, trajectories, 2_000);

  expect(active.visible).toBe(true);
  expect(active.state).toBe('warning');
  expect(active.sample).toMatchObject({ longitude: 76.5 });
  expect(active.sample?.headingDeg).toBeCloseTo(expectedSample.headingDeg);
  expect(active.trail.coordinates).toEqual([
    [76, 30],
    [76.5, 30],
  ]);
  expect(reduceModelFrame(rafale('one'), items, trajectories, 3_600).visible).toBe(false);
});

it('keeps the trail valid at the exact spawn position', () => {
  const frame = reduceModelFrame(
    rafale('one'),
    modelTrackFor('one').items,
    new Map([['trajectory:ambala-rafale-1', eastboundTrajectory]]),
    0,
  );

  expect(frame.trail.coordinates).toEqual([
    [76, 30],
    [76, 30],
  ]);
});

it('applies Mercator scale, rotation calibration, altitude calibration, heading, and pitch', () => {
  const object = new THREE.Group();
  const sample = sampleTrajectory(eastboundTrajectory, 1_000);

  const transform = applyModelTransform(
    object,
    sample,
    {
      scale: 2,
      rotationOffsetDeg: [10, 20, 30],
      altitudeOffsetM: 50,
      entityTypes: ['aircraft'],
    },
    (_longitude, _latitude, altitudeM) => ({
      x: 0.25,
      y: 0.5,
      z: altitudeM / 1_000_000,
      meterInMercatorCoordinateUnits: () => 0.001,
    }),
  );

  expect(transform).toEqual({ altitudeM: 1_100, scaleFactor: 0.002 });
  expect(object.position.toArray()).toEqual([0.25, 0.5, 0.0011]);
  expect(object.scale.toArray()).toEqual([0.002, -0.002, 0.002]);
  expect(object.quaternion.equals(new THREE.Quaternion())).toBe(false);
});

it('uses eastbound trajectory heading in the model quaternion', () => {
  const object = new THREE.Group();
  const sample = sampleTrajectory(eastboundTrajectory, 500);
  const metadata: ModelMetadata = {
    scale: 1,
    rotationOffsetDeg: [0, 0, 0],
    altitudeOffsetM: 0,
    entityTypes: ['aircraft'],
  };
  const expected = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(sample.pitchDeg),
      0,
      THREE.MathUtils.degToRad(-sample.headingDeg),
      'XYZ',
    ),
  );

  applyModelTransform(object, sample, metadata, (_longitude, _latitude, altitudeM) => ({
    x: 0,
    y: 0,
    z: altitudeM,
    meterInMercatorCoordinateUnits: () => 1,
  }));

  expect(sample.headingDeg).toBeGreaterThan(80);
  expect(object.quaternion.angleTo(expected)).toBeCloseTo(0);
  expect(object.quaternion.equals(new THREE.Quaternion())).toBe(false);
});

it('produces the identical entity transform when applying the same seek time again', async () => {
  const { runtime, clones } = modelHarness();
  await runtime.load([rafale('one')], [modelTrackFor('one')]);

  runtime.apply(1_750);
  const first = transformSnapshot(clones[0]!);
  runtime.apply(0);
  runtime.apply(1_750);

  expect(transformSnapshot(clones[0]!)).toEqual(first);
});

it('clones mesh materials per entity so state changes stay isolated', async () => {
  const templateMaterial = new THREE.MeshStandardMaterial({
    color: 0x88aacc,
    emissive: 0x101010,
    opacity: 0.8,
    transparent: true,
  });
  const template = new THREE.Group();
  template.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), templateMaterial));
  const { runtime, clones } = modelHarness({ template });
  await runtime.load(
    [rafale('one'), rafale('two')],
    [
      modelTrackFor('one', [
        action(1_500, 1, {
          action: 'model.set_state',
          entityId: 'one',
          state: 'warning',
        }),
      ]),
      modelTrackFor('two'),
    ],
  );

  runtime.apply(2_000);
  const firstMaterial = (clones[0]!.children[0] as THREE.Mesh)
    .material as THREE.MeshStandardMaterial;
  const secondMaterial = (clones[1]!.children[0] as THREE.Mesh)
    .material as THREE.MeshStandardMaterial;

  expect(firstMaterial).not.toBe(secondMaterial);
  expect(firstMaterial).not.toBe(templateMaterial);
  expect(firstMaterial.emissive.r).toBeGreaterThan(secondMaterial.emissive.r);
  expect(secondMaterial.color.getHex()).toBe(templateMaterial.color.getHex());
  expect(secondMaterial.opacity).toBe(templateMaterial.opacity);
});

it('rejects missing calibration metadata', async () => {
  const { runtime } = modelHarness({ modelMetadata: undefined });

  await expect(runtime.load([rafale('one')], [modelTrackFor('one')])).rejects.toMatchObject({
    code: 'ASSET_METADATA_INVALID',
  });
});

it('rejects model metadata that is incompatible with the entity kind', async () => {
  const { runtime } = modelHarness({
    modelMetadata: { ...validModelMetadata, entityTypes: ['missile'] },
  });

  await expect(runtime.load([rafale('one')], [modelTrackFor('one')])).rejects.toMatchObject({
    code: 'ASSET_METADATA_INVALID',
  });
});

it('rejects follow_path when no ordered spawn command precedes it', async () => {
  const { runtime } = modelHarness();

  await expect(runtime.load([rafale('one')], [followOnlyTrack('one')])).rejects.toMatchObject({
    code: 'MODEL_COMMAND_INVALID',
  });
});

it('renders with the Mapbox canvas and shared WebGL context', async () => {
  const { map, renderers, createRenderer, runtime } = modelHarness();
  await runtime.load([rafale('one')], [modelTrackFor('one')]);
  const layer = map.getLayer('ise-model-runtime') as {
    render(gl: unknown, matrix: number[]): void;
  };
  const renderer = renderers[0]!;

  layer.render({}, new THREE.Matrix4().identity().toArray());

  expect(createRenderer).toHaveBeenCalledWith({
    canvas: map.getCanvas(),
    context: expect.any(Object),
    antialias: true,
  });
  expect(renderer.autoClear).toBe(false);
  expect(renderer.resetState).toHaveBeenCalledTimes(1);
  expect(renderer.render).toHaveBeenCalledTimes(1);
});

it('re-adds the custom layer after style reload and repaints after apply', async () => {
  const { map, renderers, runtime } = modelHarness();
  await runtime.load([rafale('one')], [modelTrackFor('one')]);

  runtime.apply(500);
  map.clearStyleAndEmit('style.load');

  expect(map.layerIds()).toContain('ise-model-runtime');
  expect(map.addLayer).toHaveBeenCalledTimes(2);
  expect(renderers).toHaveLength(2);
  expect(renderers[0]!.dispose).toHaveBeenCalledTimes(1);
  expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
});

it('disposes owned materials, renderer, listeners, and acquired assets exactly once', async () => {
  const templateMaterial = new THREE.MeshStandardMaterial({ color: 0x88aacc });
  const templateGeometry = new THREE.BoxGeometry(1, 1, 1);
  const template = new THREE.Group();
  template.add(new THREE.Mesh(templateGeometry, templateMaterial));
  const templateMaterialDispose = vi.spyOn(templateMaterial, 'dispose');
  const templateGeometryDispose = vi.spyOn(templateGeometry, 'dispose');
  const { map, renderers, resources, runtime, clones } = modelHarness({ template });
  await runtime.load([rafale('one')], [modelTrackFor('one')]);
  const clonedMaterial = (clones[0]!.children[0] as THREE.Mesh).material as THREE.Material;
  const clonedMaterialDispose = vi.spyOn(clonedMaterial, 'dispose');

  runtime.dispose();
  runtime.dispose();

  expect(map.removeLayer).toHaveBeenCalledTimes(1);
  expect(map.removeLayer).toHaveBeenCalledWith('ise-model-runtime');
  expect(renderers[0]!.dispose).toHaveBeenCalledTimes(1);
  expect(renderers[0]!.forceContextLoss).not.toHaveBeenCalled();
  expect(map.listenerCount('style.load')).toBe(0);
  expect(resources.release.mock.calls).toEqual([
    ['model:rafale'],
    ['trajectory:ambala-rafale-1'],
  ]);
  expect(clonedMaterialDispose).toHaveBeenCalledTimes(1);
  expect(templateMaterialDispose).not.toHaveBeenCalled();
  expect(templateGeometryDispose).not.toHaveBeenCalled();
});
