import type { ResolvedAssetAccess, SceneEntity, SceneTrack } from '@ise/runtime-contracts';
import type mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { runtimeMapEngine } from '@/lib/mapEngine';
import { SceneRuntimeError } from './errors';
import type { RuntimeTrail } from './MapRuntime';
import type { LoadedAsset, ResourceManager } from './ResourceManager';
import {
  type PreparedTrajectory,
  prepareTrajectory,
  sampleTrajectory,
  type TrajectorySample,
} from './trajectory';

type ModelTrack = Extract<SceneTrack, { type: 'model' }>;
type ModelItem = ModelTrack['items'][number];
type ModelMetadata = Extract<ResolvedAssetAccess, { mediaType: 'model/gltf-binary' }>['model'];

interface MercatorProjection {
  x: number;
  y: number;
  z: number;
  meterInMercatorCoordinateUnits(): number;
}

export interface ModelRuntimeDependencies {
  createRenderer(options: THREE.WebGLRendererParameters): THREE.WebGLRenderer;
  cloneScene(root: THREE.Object3D): THREE.Object3D;
  project(longitude: number, latitude: number, altitudeM: number): MercatorProjection;
}

export interface ModelFrameState {
  visible: boolean;
  state: SceneEntity['initialState'];
  stateStartMs?: number;
  trajectoryAssetId?: string;
  sample?: TrajectorySample;
  trail: RuntimeTrail;
}

export interface ModelEntityPositionSnapshot {
  entityId: string;
  state: SceneEntity['initialState'];
  visible: boolean;
  longitude?: number;
  latitude?: number;
  headingDeg?: number;
}

export interface ModelEntityFrameSnapshot extends ModelEntityPositionSnapshot {
  modelAssetId?: string;
  defaultTrajectoryAssetId?: string;
  trajectoryAssetId?: string;
  projectedSizePx?: number;
  appliedScale?: number;
  altitudeM?: number;
  pitchDeg?: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

interface MaterialState {
  material: THREE.Material;
  color?: THREE.Color;
  emissive?: THREE.Color;
  opacity: number;
  transparent: boolean;
}

interface ModelInstance {
  entity: SceneEntity;
  items: ModelItem[];
  transform: ModelTransformHierarchy;
  nativeExtent: number;
  metadata: ModelMetadata;
  materials: MaterialState[];
  projectedSizePx?: number;
  appliedScale?: number;
  frame?: ModelFrameState;
}

export interface ModelTransformHierarchy {
  mercatorRoot: THREE.Group;
  motionRoot: THREE.Group;
  calibrationRoot: THREE.Group;
  content: THREE.Object3D;
}

interface ResolvedModel {
  metadata: ModelMetadata;
  template: THREE.Object3D;
}

const layerId = 'ise-model-runtime';
const mapboxTileSizePx = 512;
const minimumProjectedSizePx = 36;

const browserModelDependencies: ModelRuntimeDependencies = {
  createRenderer: (options) => new THREE.WebGLRenderer(options),
  cloneScene: (root) => root.clone(true),
  project: (longitude, latitude, altitudeM) =>
    runtimeMapEngine.MercatorCoordinate.fromLngLat([longitude, latitude], altitudeM),
};

export function reduceModelFrame(
  entity: SceneEntity,
  inputItems: ModelTrack['items'],
  trajectories: ReadonlyMap<string, PreparedTrajectory>,
  timeMs: number,
): ModelFrameState {
  const items = inputItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.params.entityId === entity.entityId)
    .sort((left, right) => left.item.startMs - right.item.startMs || left.index - right.index);
  const seekTimeMs = finiteTime(timeMs);
  let spawned = false;
  let state = entity.initialState;
  let stateStartMs: number | undefined;
  let trajectoryAssetId: string | undefined;
  let sample: TrajectorySample | undefined;
  let trail: RuntimeTrail = { entityId: entity.entityId, coordinates: [] };

  const setTrajectory = (trajectoryId: string, progress: number) => {
    const trajectory = trajectories.get(trajectoryId);
    if (!trajectory) {
      throw new SceneRuntimeError(
        'MODEL_COMMAND_INVALID',
        `Missing trajectory ${trajectoryId}`,
        trajectoryId,
      );
    }
    trajectoryAssetId = trajectoryId;
    sample = sampleTrajectory(trajectory, clamp01(progress) * trajectory.durationMs);
    const coordinates: Array<readonly [number, number]> = trajectory.points
      .slice(0, sample.tailEndIndex)
      .map((point) => [point.longitude, point.latitude] as const);
    const interpolated = [sample.longitude, sample.latitude] as const;
    const tail = coordinates.at(-1);
    if (
      coordinates.length === 1 ||
      !tail ||
      tail[0] !== interpolated[0] ||
      tail[1] !== interpolated[1]
    ) {
      coordinates.push(interpolated);
    }
    trail = { entityId: entity.entityId, coordinates };
  };

  for (const { item } of items) {
    if (item.startMs > seekTimeMs) {
      break;
    }
    switch (item.params.action) {
      case 'model.spawn':
        spawned = true;
        if (entity.defaultTrajectoryAssetId) {
          setTrajectory(entity.defaultTrajectoryAssetId, 0);
        }
        break;
      case 'model.follow_path':
        if (!spawned) {
          throw new SceneRuntimeError(
            'MODEL_COMMAND_INVALID',
            'model.follow_path requires model.spawn',
          );
        }
        const timing = item.params.timing;
        if (timing && timing.endMs > timing.startMs && timing.sourceEndMs >= timing.sourceStartMs) {
          const narrativeProgress = clamp01((seekTimeMs - timing.startMs) / (timing.endMs - timing.startMs));
          const sourceTimeMs = timing.sourceStartMs + narrativeProgress * (timing.sourceEndMs - timing.sourceStartMs);
          const sourceProgress = (sourceTimeMs - timing.sourceStartMs)
            / Math.max(1, timing.sourceEndMs - timing.sourceStartMs);
          setTrajectory(item.params.trajectoryAssetId, sourceProgress);
        } else {
          setTrajectory(
            item.params.trajectoryAssetId,
            item.durationMs === 0 ? 1 : (seekTimeMs - item.startMs) / item.durationMs,
          );
        }
        break;
      case 'model.set_state':
        state = item.params.state;
        stateStartMs = item.startMs;
        break;
      case 'model.hide':
        spawned = false;
        break;
    }
  }

  return {
    visible: spawned && state !== 'hidden' && sample !== undefined,
    state,
    ...(stateStartMs !== undefined ? { stateStartMs } : {}),
    ...(trajectoryAssetId ? { trajectoryAssetId } : {}),
    sample,
    trail,
  };
}

export function createModelTransformHierarchy(content: THREE.Object3D): ModelTransformHierarchy {
  const mercatorRoot = new THREE.Group();
  const motionRoot = new THREE.Group();
  const calibrationRoot = new THREE.Group();
  calibrationRoot.add(content);
  motionRoot.add(calibrationRoot);
  mercatorRoot.add(motionRoot);
  return { mercatorRoot, motionRoot, calibrationRoot, content };
}

export function applyModelTransform(
  transform: ModelTransformHierarchy,
  sample: TrajectorySample,
  metadata: ModelMetadata,
  project: ModelRuntimeDependencies['project'],
  destroyedElapsedMs?: number,
) {
  const altitudeM = sample.altitudeM + metadata.altitudeOffsetM;
  const mercator = project(sample.longitude, sample.latitude, altitudeM);
  const scaleFactor = mercator.meterInMercatorCoordinateUnits() * metadata.scale;
  transform.mercatorRoot.position.set(mercator.x, mercator.y, mercator.z);
  transform.mercatorRoot.scale.set(scaleFactor, -scaleFactor, scaleFactor);

  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    THREE.MathUtils.degToRad(-sample.headingDeg),
  );
  const pitch = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    THREE.MathUtils.degToRad(sample.pitchDeg),
  );
  const [offsetX, offsetY, offsetZ] = metadata.rotationOffsetDeg;
  const correction = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(offsetX),
      THREE.MathUtils.degToRad(offsetY),
      THREE.MathUtils.degToRad(offsetZ),
      'XYZ',
    ),
  );
  transform.motionRoot.quaternion.copy(yaw).multiply(pitch);
  if (destroyedElapsedMs !== undefined) {
    const progress = THREE.MathUtils.smoothstep(
      Math.min(1_000, Math.max(0, destroyedElapsedMs)),
      0,
      1_000,
    );
    const lossOfControl = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(-55 * progress),
        THREE.MathUtils.degToRad(160 * progress),
        0,
        'XYZ',
      ),
    );
    transform.motionRoot.quaternion.multiply(lossOfControl);
  }
  transform.calibrationRoot.quaternion.copy(correction);

  return { altitudeM, scaleFactor };
}

export class ModelRuntime {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly instances: ModelInstance[] = [];
  private readonly trajectories = new Map<string, PreparedTrajectory>();
  private readonly acquiredAssetIds: string[] = [];
  private renderer: THREE.WebGLRenderer | undefined;
  private listenerRegistered = false;
  private loaded = false;
  private disposed = false;

  constructor(
    private readonly map: mapboxgl.Map,
    private readonly resources: ResourceManager,
    private readonly dependencies: ModelRuntimeDependencies = browserModelDependencies,
  ) {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0, -70, 100).normalize();
    this.scene.add(directionalLight);
  }

  async load(entities: SceneEntity[], tracks: SceneTrack[], signal?: AbortSignal) {
    this.assertUsable();
    if (this.loaded) {
      throw new SceneRuntimeError('RUNTIME_NOT_LOADED', 'Model runtime is already loaded');
    }

    const items = tracks
      .filter((track): track is ModelTrack => track.visible && track.type === 'model')
      .flatMap((track) => track.items);
    const entityById = new Map(entities.map((entity) => [entity.entityId, entity]));
    const referencedEntityIds = [...new Set(items.map((item) => item.params.entityId))];

    try {
      for (const entityId of referencedEntityIds) {
        const entity = entityById.get(entityId);
        if (!entity) {
          throw new SceneRuntimeError(
            'MODEL_COMMAND_INVALID',
            `Model command references unknown entity ${entityId}`,
          );
        }
        validateCommandOrder(entityId, items);
      }

      const models = await this.loadModels(
        referencedEntityIds.map((entityId) => entityById.get(entityId)!),
        signal,
      );
      this.assertLoadActive(signal);
      await this.loadTrajectories(
        referencedEntityIds.map((entityId) => entityById.get(entityId)!),
        items,
        signal,
      );
      this.assertLoadActive(signal);

      for (const entityId of referencedEntityIds) {
        const entity = entityById.get(entityId)!;
        const modelAssetId = entity.modelAssetId;
        const model = modelAssetId ? models.get(modelAssetId) : undefined;
        if (!model) {
          throw new SceneRuntimeError(
            'ASSET_METADATA_INVALID',
            `Entity has no resolved model calibration: ${entity.entityId}`,
            modelAssetId,
          );
        }
        if (!model.metadata.entityTypes.includes(entity.kind as 'aircraft' | 'missile' | 'other')) {
          throw new SceneRuntimeError(
            'ASSET_METADATA_INVALID',
            `Model ${modelAssetId} is incompatible with entity kind ${entity.kind}`,
            modelAssetId,
          );
        }

        const content = this.dependencies.cloneScene(model.template);
        const transform = createModelTransformHierarchy(content);
        const nativeExtent = modelNativeExtent(content);
        const materials = cloneEntityMaterials(content);
        transform.mercatorRoot.visible = false;
        this.scene.add(transform.mercatorRoot);
        this.instances.push({
          entity,
          items: items.filter((item) => item.params.entityId === entityId),
          transform,
          nativeExtent,
          metadata: model.metadata,
          materials,
        });
      }

      this.assertLoadActive(signal);
      this.map.on('style.load', this.handleStyleLoad);
      this.listenerRegistered = true;
      this.loaded = true;
      this.addLayerIfPossible();
    } catch (error) {
      this.cleanupOwnedState();
      throw error;
    }
  }

  apply(timeMs: number): RuntimeTrail[] {
    if (this.disposed) {
      return [];
    }
    if (!this.loaded) {
      throw new SceneRuntimeError('RUNTIME_NOT_LOADED', 'Model runtime is not loaded');
    }

    const trails: RuntimeTrail[] = [];
    for (const instance of this.instances) {
      const frame = reduceModelFrame(instance.entity, instance.items, this.trajectories, timeMs);
      applyMaterialState(instance.materials, frame.state);
      if (frame.sample) {
        const { scaleFactor } = applyModelTransform(
          instance.transform,
          frame.sample,
          instance.metadata,
          this.dependencies.project,
          frame.state === 'destroyed' && frame.stateStartMs !== undefined
            ? finiteTime(timeMs) - frame.stateStartMs
            : undefined,
        );
        const size = modelDisplaySize(scaleFactor, instance.nativeExtent, this.map.getZoom());
        instance.transform.mercatorRoot.scale.set(
          size.appliedScale,
          -size.appliedScale,
          size.appliedScale,
        );
        instance.appliedScale = size.appliedScale;
        instance.projectedSizePx = size.projectedSizePx;
      }
      instance.transform.mercatorRoot.visible = frame.visible;
      instance.frame = frame;
      if (frame.visible && frame.trail.coordinates.length > 0) {
        trails.push(frame.trail);
      }
    }
    this.map.triggerRepaint();
    return trails;
  }

  getFrameSnapshot(): ModelEntityFrameSnapshot[] {
    return this.instances.map(({ entity, transform, frame, appliedScale, projectedSizePx }) => ({
      entityId: entity.entityId,
      state: frame?.state ?? entity.initialState,
      ...(entity.modelAssetId ? { modelAssetId: entity.modelAssetId } : {}),
      ...(entity.defaultTrajectoryAssetId
        ? { defaultTrajectoryAssetId: entity.defaultTrajectoryAssetId }
        : {}),
      ...(frame?.trajectoryAssetId ? { trajectoryAssetId: frame.trajectoryAssetId } : {}),
      visible: transform.mercatorRoot.visible,
      ...(appliedScale !== undefined ? { appliedScale } : {}),
      ...(projectedSizePx !== undefined ? { projectedSizePx } : {}),
      ...(frame?.sample
        ? {
            longitude: frame.sample.longitude,
            latitude: frame.sample.latitude,
            altitudeM: frame.sample.altitudeM,
            headingDeg: frame.sample.headingDeg,
            pitchDeg: frame.sample.pitchDeg,
          }
        : {}),
      position: transform.mercatorRoot.position.toArray() as [number, number, number],
      quaternion: transform.motionRoot.quaternion
        .clone()
        .multiply(transform.calibrationRoot.quaternion)
        .toArray() as [number, number, number, number],
    }));
  }

  getPositionSnapshotAt(timeMs: number): ModelEntityPositionSnapshot[] {
    return this.instances.map(({ entity, items }) => {
      const frame = reduceModelFrame(entity, items, this.trajectories, timeMs);
      return {
        entityId: entity.entityId,
        state: frame.state,
        visible: frame.visible,
        ...(frame.sample
          ? {
              longitude: frame.sample.longitude,
              latitude: frame.sample.latitude,
              headingDeg: frame.sample.headingDeg,
            }
          : {}),
      };
    });
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cleanupOwnedState();
  }

  private async loadModels(entities: SceneEntity[], signal?: AbortSignal) {
    const models = new Map<string, ResolvedModel>();
    const templates = new Map<string, THREE.Object3D>();
    const modelAssetIds = [
      ...new Set(
        entities.map((entity) => entity.modelAssetId).filter((assetId) => assetId !== undefined),
      ),
    ];

    for (const assetId of modelAssetIds) {
      const asset = await this.acquire(assetId, 'model', signal);
      const metadata = modelMetadata(asset, assetId);
      let template = templates.get(asset.access.fingerprint);
      if (!template) {
        const gltf = await asset.readGltf();
        this.assertLoadActive(signal);
        template = gltf.scene;
        templates.set(asset.access.fingerprint, template);
      }
      models.set(assetId, { metadata, template });
    }
    return models;
  }

  private async loadTrajectories(
    entities: SceneEntity[],
    items: ModelItem[],
    signal?: AbortSignal,
  ) {
    const trajectoryAssetIds = new Set<string>();
    for (const entity of entities) {
      if (entity.defaultTrajectoryAssetId) {
        trajectoryAssetIds.add(entity.defaultTrajectoryAssetId);
      }
    }
    for (const item of items) {
      if (item.params.action === 'model.follow_path') {
        trajectoryAssetIds.add(item.params.trajectoryAssetId);
      }
    }

    for (const assetId of trajectoryAssetIds) {
      const asset = await this.acquire(assetId, 'trajectory', signal);
      if (
        asset.access.mediaType !== 'application/vnd.ise.trajectory+json' ||
        !asset.access.trajectory
      ) {
        throw new SceneRuntimeError(
          'ASSET_METADATA_INVALID',
          `Trajectory metadata is missing: ${assetId}`,
          assetId,
        );
      }
      try {
        const document = await asset.readJson();
        this.assertLoadActive(signal);
        this.trajectories.set(assetId, prepareTrajectory(document, asset.access.trajectory));
      } catch (error) {
        this.assertLoadActive(signal);
        if (error instanceof SceneRuntimeError) {
          throw error;
        }
        throw new SceneRuntimeError(
          'TRAJECTORY_INVALID',
          `Trajectory document is invalid: ${assetId}`,
          assetId,
          { cause: error },
        );
      }
    }
  }

  private async acquire(assetId: string, role: 'model' | 'trajectory', signal?: AbortSignal) {
    const asset = await this.resources.acquire(assetId, role, signal);
    try {
      this.assertLoadActive(signal);
    } catch (error) {
      this.resources.release(assetId);
      throw error;
    }
    this.acquiredAssetIds.push(assetId);
    return asset;
  }

  private readonly handleStyleLoad = () => {
    if (this.disposed || !this.loaded) {
      return;
    }
    this.disposeRenderer();
    this.addLayerIfPossible();
  };

  private addLayerIfPossible() {
    if (this.map.isStyleLoaded() && !this.map.getLayer(layerId)) {
      this.map.addLayer(this.createLayer());
    }
  }

  private createLayer(): mapboxgl.CustomLayerInterface {
    return {
      id: layerId,
      type: 'custom',
      renderingMode: '3d',
      onAdd: (_map, gl) => {
        this.disposeRenderer();
        this.renderer = this.dependencies.createRenderer({
          canvas: this.map.getCanvas(),
          context: gl,
          antialias: true,
        });
        this.renderer.autoClear = false;
      },
      render: (_gl, matrix) => {
        const projectionMatrix =
          Array.isArray(matrix) || ArrayBuffer.isView(matrix)
            ? matrix
            : (
                matrix as unknown as {
                  defaultProjectionData: {
                    mainMatrix: ArrayLike<number>;
                  };
                }
              ).defaultProjectionData.mainMatrix;
        this.camera.projectionMatrix.fromArray(projectionMatrix);
        this.renderer?.resetState();
        this.renderer?.render(this.scene, this.camera);
      },
      onRemove: () => {
        this.disposeRenderer();
      },
    };
  }

  private cleanupOwnedState() {
    if (this.listenerRegistered) {
      this.map.off('style.load', this.handleStyleLoad);
      this.listenerRegistered = false;
    }
    try {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      } else {
        this.disposeRenderer();
      }
    } catch {
      this.disposeRenderer();
    }

    for (const instance of this.instances) {
      this.scene.remove(instance.transform.mercatorRoot);
      for (const state of instance.materials) {
        state.material.dispose();
      }
    }
    this.instances.length = 0;
    this.trajectories.clear();
    for (const assetId of this.acquiredAssetIds) {
      this.resources.release(assetId);
    }
    this.acquiredAssetIds.length = 0;
    this.loaded = false;
  }

  private disposeRenderer() {
    this.renderer?.dispose();
    this.renderer = undefined;
  }

  private assertUsable() {
    if (this.disposed) {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Model runtime is disposed');
    }
  }

  private assertLoadActive(signal?: AbortSignal) {
    this.assertUsable();
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Model load aborted', 'AbortError');
    }
  }
}

function validateCommandOrder(entityId: string, inputItems: ModelItem[]) {
  const items = inputItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.params.entityId === entityId)
    .sort((left, right) => left.item.startMs - right.item.startMs || left.index - right.index);
  let spawned = false;
  for (const { item } of items) {
    switch (item.params.action) {
      case 'model.spawn':
        spawned = true;
        break;
      case 'model.follow_path':
        if (!spawned) {
          throw new SceneRuntimeError(
            'MODEL_COMMAND_INVALID',
            `model.follow_path requires a prior model.spawn for ${entityId}`,
          );
        }
        break;
      case 'model.hide':
        spawned = false;
        break;
      case 'model.set_state':
        break;
    }
  }
}

function modelMetadata(asset: LoadedAsset, assetId: string): ModelMetadata {
  if (asset.access.mediaType !== 'model/gltf-binary' || !asset.access.model) {
    throw new SceneRuntimeError(
      'ASSET_METADATA_INVALID',
      `Model calibration metadata is missing: ${assetId}`,
      assetId,
    );
  }
  return asset.access.model;
}

function cloneEntityMaterials(root: THREE.Object3D) {
  const clones = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => cloneMaterial(material, clones));
    } else {
      mesh.material = cloneMaterial(mesh.material, clones);
    }
  });
  return [...clones.values()].map(snapshotMaterial);
}

function modelNativeExtent(root: THREE.Object3D) {
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  return Number.isFinite(extent) && extent > 0 ? extent : 0;
}

function modelDisplaySize(scaleFactor: number, nativeExtent: number, zoom: number) {
  const worldSizePx = mapboxTileSizePx * 2 ** zoom;
  if (
    !Number.isFinite(scaleFactor) ||
    !Number.isFinite(nativeExtent) ||
    nativeExtent <= 0 ||
    !Number.isFinite(worldSizePx) ||
    worldSizePx <= 0
  ) {
    return { appliedScale: scaleFactor, projectedSizePx: 0 };
  }
  const minimumScale = minimumProjectedSizePx / (nativeExtent * worldSizePx);
  const appliedScale = Math.max(scaleFactor, minimumScale);
  return {
    appliedScale,
    projectedSizePx: nativeExtent * appliedScale * worldSizePx,
  };
}

function cloneMaterial(material: THREE.Material, clones: Map<THREE.Material, THREE.Material>) {
  const existing = clones.get(material);
  if (existing) {
    return existing;
  }
  const clone = material.clone();
  if (
    clone instanceof THREE.MeshStandardMaterial &&
    !clone.map &&
    !clone.envMap &&
    clone.metalness >= 0.9
  ) {
    clone.metalness = 0.2;
    clone.roughness = 0.55;
  }
  clones.set(material, clone);
  return clone;
}

function snapshotMaterial(material: THREE.Material): MaterialState {
  return {
    material,
    color: materialColor(material, 'color')?.clone(),
    emissive: materialColor(material, 'emissive')?.clone(),
    opacity: material.opacity,
    transparent: material.transparent,
  };
}

function applyMaterialState(materials: MaterialState[], state: SceneEntity['initialState']) {
  for (const snapshot of materials) {
    const { material } = snapshot;
    const color = materialColor(material, 'color');
    const emissive = materialColor(material, 'emissive');
    if (color && snapshot.color) {
      color.copy(snapshot.color);
    }
    if (emissive && snapshot.emissive) {
      emissive.copy(snapshot.emissive);
    }
    material.opacity = snapshot.opacity;
    material.transparent = snapshot.transparent;

    if (state === 'warning' && emissive) {
      emissive.r = Math.min(1, emissive.r + 0.5);
    } else if (state === 'disabled') {
      if (color && snapshot.color) {
        color.copy(snapshot.color).multiplyScalar(0.35);
      }
      material.opacity = 0.45;
      material.transparent = true;
    } else if (state === 'destroyed') {
      color?.multiplyScalar(0.18);
      emissive?.multiplyScalar(0.1);
    }
    material.needsUpdate = true;
  }
}

function materialColor(material: THREE.Material, key: 'color' | 'emissive') {
  const value = (material as unknown as Record<string, unknown>)[key];
  return value instanceof THREE.Color ? value : undefined;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function finiteTime(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
