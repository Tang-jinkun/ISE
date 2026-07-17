import type { SceneTrack } from '@ise/runtime-contracts';
import type mapboxgl from 'mapbox-gl';
import type { ModelEntityFrameSnapshot } from './ModelRuntime';
import { SceneRuntimeError } from './errors';

type DataLinkItem = Extract<SceneTrack, { type: 'data_link' }>['items'][number];

const sourceId = 'ise:data-links';
const layerIds = {
  awacsFighter: 'ise:data-links:awacs-fighter',
  fighterMissile: 'ise:data-links:fighter-missile',
} as const;

interface DataLinkFeatureCollection {
  type: 'FeatureCollection';
  features: DataLinkFeature[];
}

interface DataLinkFeature {
  type: 'Feature';
  properties: { id: string; linkKind: DataLinkItem['params']['linkKind'] };
  geometry: {
    type: 'LineString';
    coordinates: [[number, number], [number, number]];
  };
}

const emptyFeatureCollection = (): DataLinkFeatureCollection => ({
  type: 'FeatureCollection',
  features: [],
});

export class DataLinkRuntime {
  private items: DataLinkItem[] = [];
  private lastFeatures = emptyFeatureCollection();
  private listenerRegistered = false;
  private disposed = false;

  constructor(private readonly map: mapboxgl.Map) {}

  async load(tracks: SceneTrack[], signal?: AbortSignal) {
    this.assertUsable();
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Data link load aborted', 'AbortError');
    }
    this.items = tracks
      .filter((track): track is Extract<SceneTrack, { type: 'data_link' }> => (
        track.visible && track.type === 'data_link'
      ))
      .flatMap((track) => track.items);
    if (!this.listenerRegistered) {
      this.map.on('style.load', this.handleStyleLoad);
      this.listenerRegistered = true;
    }
    this.ensureStyle();
  }

  apply(timeMs: number, snapshots: readonly ModelEntityFrameSnapshot[]) {
    if (this.disposed) {
      return;
    }
    const entities = new Map(snapshots.map((snapshot) => [snapshot.entityId, snapshot]));
    this.lastFeatures = {
      type: 'FeatureCollection',
      features: this.items.flatMap((item) => {
        if (!isActive(item, timeMs)) {
          return [];
        }
        const source = entities.get(item.params.sourceEntityId);
        const target = entities.get(item.params.targetEntityId);
        if (!isRenderableEndpoint(source) || !isRenderableEndpoint(target)) {
          return [];
        }
        return [{
          type: 'Feature' as const,
          properties: { id: item.id, linkKind: item.params.linkKind },
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [source.longitude, source.latitude],
              [target.longitude, target.latitude],
            ],
          },
        }];
      }),
    };
    this.ensureStyle();
    const source = this.map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
    source?.setData(this.lastFeatures as never);
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
    this.safeRemoveLayer(layerIds.awacsFighter);
    this.safeRemoveLayer(layerIds.fighterMissile);
    this.safeRemoveSource();
    this.items = [];
    this.lastFeatures = emptyFeatureCollection();
  }

  private readonly handleStyleLoad = () => {
    if (!this.disposed) {
      this.ensureStyle();
    }
  };

  private ensureStyle() {
    if (!this.map.isStyleLoaded()) {
      return;
    }
    if (!this.map.getSource(sourceId)) {
      this.map.addSource(sourceId, { type: 'geojson', data: this.lastFeatures as never });
    }
    if (!this.map.getLayer(layerIds.awacsFighter)) {
      this.map.addLayer({
        id: layerIds.awacsFighter,
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'linkKind'], 'awacs-fighter'],
        paint: { 'line-color': '#22d3ee', 'line-width': 2 },
      });
    }
    if (!this.map.getLayer(layerIds.fighterMissile)) {
      this.map.addLayer({
        id: layerIds.fighterMissile,
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'linkKind'], 'fighter-missile'],
        paint: { 'line-color': '#f59e0b', 'line-width': 2 },
      });
    }
  }

  private safeRemoveLayer(id: string) {
    try {
      if (this.map.getLayer(id)) {
        this.map.removeLayer(id);
      }
    } catch {
      // The shared style may already be tearing down.
    }
  }

  private safeRemoveSource() {
    try {
      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
    } catch {
      // The shared style may already be tearing down.
    }
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
): snapshot is ModelEntityFrameSnapshot & { longitude: number; latitude: number } {
  return Boolean(
    snapshot?.visible && Number.isFinite(snapshot.longitude) && Number.isFinite(snapshot.latitude),
  );
}
