import type { SceneTrack } from '@ise/runtime-contracts';
import type mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { ModelEntityFrameSnapshot } from './ModelRuntime';
import { SceneRuntimeError } from './errors';

type DataLinkItem = Extract<SceneTrack, { type: 'data_link' }>['items'][number];

const layerId = 'ise-data-link-runtime';
const linkColors = {
  'awacs-fighter': 0x22d3ee,
  'fighter-missile': 0xf59e0b,
} as const;
const pointColors = {
  'awacs-fighter': { source: 0x22d3ee, target: 0x67e8f9, packet: 0xecfeff },
  'fighter-missile': { source: 0xf59e0b, target: 0xfbbf24, packet: 0xfff7d6 },
} as const;
const packetTravelMs = 1_200;
const packetArrivalHoldMs = 300;
const packetCycleMs = packetTravelMs + packetArrivalHoldMs;
const sourceMarkerSizePx = 6;
const targetMarkerSizePx = 9;
const packetSizePx = 7;

export interface DataLinkRuntimeDependencies {
  createRenderer(options: THREE.WebGLRendererParameters): THREE.WebGLRenderer;
}

interface DataLinkInstance {
  item: DataLinkItem;
  line: Line2;
  sourceMarker: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  targetMarker: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  packet: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  targetBaseColor: THREE.Color;
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
      const geometry = new LineGeometry();
      geometry.setPositions([0, 0, 0, 0, 0, 0]);
      const material = new LineMaterial({
        color: linkColors[item.params.linkKind],
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      setLineWidth(material, 2);
      const line = new Line2(geometry, material);
      line.name = item.id;
      line.visible = false;
      line.frustumCulled = false;
      line.renderOrder = 10_000;
      const colors = pointColors[item.params.linkKind];
      const sourceMarker = createPoint(
        `${item.id}:source`, colors.source, sourceMarkerSizePx, 10_001,
      );
      const targetMarker = createPoint(
        `${item.id}:target`, colors.target, targetMarkerSizePx, 10_002,
      );
      const packet = createPoint(
        `${item.id}:packet-0`, colors.packet, packetSizePx, 10_003,
      );
      this.scene.add(line, sourceMarker, targetMarker, packet);
      this.instances.push({
        item,
        line,
        sourceMarker,
        targetMarker,
        packet,
        targetBaseColor: new THREE.Color(colors.target),
      });
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
    for (const instance of this.instances) {
      const { item, line, sourceMarker, targetMarker, packet, targetBaseColor } = instance;
      const source = entities.get(item.params.sourceEntityId);
      const target = entities.get(item.params.targetEntityId);
      if (!isActive(item, timeMs) || !isRenderableEndpoint(source) || !isRenderableEndpoint(target)) {
        setInstanceVisibility(instance, false);
        continue;
      }
      setInstanceVisibility(instance, true);
      for (const visual of [line, sourceMarker, targetMarker, packet]) {
        visual.position.fromArray(source.position);
      }
      const delta: [number, number, number] = [
        target.position[0] - source.position[0],
        target.position[1] - source.position[1],
        target.position[2] - source.position[2],
      ];
      const start = line.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
      const end = line.geometry.getAttribute('instanceEnd') as THREE.InterleavedBufferAttribute;
      start.setXYZ(0, 0, 0, 0);
      end.setXYZ(0, ...delta);
      start.data.needsUpdate = true;
      end.data.needsUpdate = true;
      setPointOffset(sourceMarker, [0, 0, 0]);
      setPointOffset(targetMarker, delta);
      const packetState = dataPacketState(timeMs, item.startMs);
      setPointOffset(packet, [
        delta[0] * packetState.progress,
        delta[1] * packetState.progress,
        delta[2] * packetState.progress,
      ]);
      packet.material.opacity = 0.98 * packetState.packetOpacity;
      targetMarker.material.size = targetMarkerSizePx + 5 * packetState.arrivalIntensity;
      targetMarker.material.opacity = 0.9 + 0.1 * packetState.arrivalIntensity;
      targetMarker.material.color
        .copy(targetBaseColor)
        .lerp(new THREE.Color(0xffffff), 0.7 * packetState.arrivalIntensity);
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
    for (const instance of this.instances) {
      for (const visual of instanceVisuals(instance)) {
        this.scene.remove(visual);
        visual.geometry.dispose();
        visual.material.dispose();
      }
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
        this.updateMaterialResolution();
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
        this.updateMaterialResolution();
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

  private updateMaterialResolution() {
    const canvas = this.map.getCanvas();
    for (const { line } of this.instances) {
      line.material.resolution.set(canvas.width, canvas.height);
    }
  }

  private assertUsable() {
    if (this.disposed) {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Data link runtime is disposed');
    }
  }
}

function setLineWidth(material: LineMaterial, width: number) {
  (material as LineMaterial & { linewidth: number }).linewidth = width;
}

function createPoint(name: string, color: number, size: number, renderOrder: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    sizeAttenuation: false,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const point = new THREE.Points(geometry, material);
  point.name = name;
  point.visible = false;
  point.frustumCulled = false;
  point.renderOrder = renderOrder;
  return point;
}

function setPointOffset(
  point: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>,
  offset: readonly [number, number, number],
) {
  const positions = point.geometry.getAttribute('position') as THREE.BufferAttribute;
  positions.setXYZ(0, ...offset);
  positions.needsUpdate = true;
}

function instanceVisuals(instance: DataLinkInstance) {
  return [instance.line, instance.sourceMarker, instance.targetMarker, instance.packet] as const;
}

function setInstanceVisibility(instance: DataLinkInstance, visible: boolean) {
  for (const visual of instanceVisuals(instance)) {
    visual.visible = visible;
  }
}

function dataPacketState(timeMs: number, startMs: number) {
  const elapsedMs = Math.max(0, timeMs - startMs);
  const cycleTimeMs = elapsedMs % packetCycleMs;
  if (cycleTimeMs < packetTravelMs) {
    return {
      progress: cycleTimeMs / packetTravelMs,
      packetOpacity: 1,
      arrivalIntensity: 0,
    };
  }
  const holdProgress = (cycleTimeMs - packetTravelMs) / packetArrivalHoldMs;
  return {
    progress: 1,
    packetOpacity: 1 - holdProgress,
    arrivalIntensity: 1 - holdProgress,
  };
}

function isActive(item: DataLinkItem, timeMs: number) {
  return item.startMs <= timeMs && timeMs < item.startMs + item.durationMs;
}

function isRenderableEndpoint(
  snapshot: ModelEntityFrameSnapshot | undefined,
): snapshot is ModelEntityFrameSnapshot {
  return Boolean(snapshot?.visible && snapshot.position.every(Number.isFinite));
}
