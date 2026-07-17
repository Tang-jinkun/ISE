import type { SceneTrack } from '@ise/runtime-contracts';
import type mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import type { ModelEntityFrameSnapshot } from './ModelRuntime';
import { SceneRuntimeError } from './errors';

type DataLinkItem = Extract<SceneTrack, { type: 'data_link' }>['items'][number];

const layerId = 'ise-data-link-runtime';
const linkColors = {
  'awacs-fighter': 0x22d3ee,
  'fighter-missile': 0xf59e0b,
} as const;

export interface DataLinkRuntimeDependencies {
  createRenderer(options: THREE.WebGLRendererParameters): THREE.WebGLRenderer;
}

interface DataLinkInstance {
  item: DataLinkItem;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

const browserDependencies: DataLinkRuntimeDependencies = {
  createRenderer: (options) => new THREE.WebGLRenderer(options),
};

export class DataLinkRuntime {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly instances: DataLinkInstance[] = [];
  private renderer: THREE.WebGLRenderer | undefined;
  private listenerRegistered = false;
  private disposed = false;

  constructor(
    private readonly map: mapboxgl.Map,
    private readonly dependencies: DataLinkRuntimeDependencies = browserDependencies,
  ) {}

  async load(tracks: SceneTrack[], signal?: AbortSignal) {
    this.assertUsable();
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Data link load aborted', 'AbortError');
    }
    const items = tracks
      .filter((track): track is Extract<SceneTrack, { type: 'data_link' }> => (
        track.visible && track.type === 'data_link'
      ))
      .flatMap((track) => track.items);
    for (const item of items) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const material = new THREE.LineBasicMaterial({
        color: linkColors[item.params.linkKind],
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      const line = new THREE.Line(geometry, material);
      line.name = item.id;
      line.visible = false;
      line.frustumCulled = false;
      line.renderOrder = 10_000;
      this.scene.add(line);
      this.instances.push({ item, line });
    }
    if (!this.listenerRegistered) {
      this.map.on('style.load', this.handleStyleLoad);
      this.listenerRegistered = true;
    }
    this.addLayerIfPossible();
  }

  apply(timeMs: number, snapshots: readonly ModelEntityFrameSnapshot[]) {
    if (this.disposed) {
      return;
    }
    const entities = new Map(snapshots.map((snapshot) => [snapshot.entityId, snapshot]));
    for (const { item, line } of this.instances) {
      const source = entities.get(item.params.sourceEntityId);
      const target = entities.get(item.params.targetEntityId);
      if (!isActive(item, timeMs) || !isRenderableEndpoint(source) || !isRenderableEndpoint(target)) {
        line.visible = false;
        continue;
      }
      line.visible = true;
      line.position.fromArray(source.position);
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      positions.setXYZ(0, 0, 0, 0);
      positions.setXYZ(
        1,
        target.position[0] - source.position[0],
        target.position[1] - source.position[1],
        target.position[2] - source.position[2],
      );
      positions.needsUpdate = true;
    }
    this.map.triggerRepaint();
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
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
    for (const { line } of this.instances) {
      this.scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    this.instances.length = 0;
  }

  private readonly handleStyleLoad = () => {
    if (this.disposed) {
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
                  defaultProjectionData: { mainMatrix: ArrayLike<number> };
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

  private disposeRenderer() {
    this.renderer?.dispose();
    this.renderer = undefined;
  }

  private assertUsable() {
    if (this.disposed) {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Data link runtime is disposed');
    }
  }
}

function isActive(item: DataLinkItem, timeMs: number) {
  return item.startMs <= timeMs && timeMs < item.startMs + item.durationMs;
}

function isRenderableEndpoint(
  snapshot: ModelEntityFrameSnapshot | undefined,
): snapshot is ModelEntityFrameSnapshot {
  return Boolean(snapshot?.visible && snapshot.position.every(Number.isFinite));
}
