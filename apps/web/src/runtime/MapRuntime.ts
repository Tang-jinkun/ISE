import type { SceneTrack } from '@ise/runtime-contracts';
import { runtimeMapEngine } from '@/lib/mapEngine';
import type mapboxgl from 'mapbox-gl';
import { z } from 'zod';
import { SceneRuntimeError } from './errors';
import type { ModelEntityFrameSnapshot } from './ModelRuntime';
import type { ResourceManager } from './ResourceManager';

type MarkerItem = Extract<SceneTrack, { type: 'marker' }>['items'][number];
type GeojsonItem = Extract<SceneTrack, { type: 'geojson' }>['items'][number];
type CameraItem = Extract<SceneTrack, { type: 'camera' }>['items'][number];
type CameraParams = CameraItem['params'];
type StaticCameraParams = Extract<CameraParams, { center: [number, number] }>;
type DynamicCameraParams = Exclude<CameraParams, StaticCameraParams>;
type StaticCameraItem = Omit<CameraItem, 'params'> & { params: StaticCameraParams };
type DynamicCameraItem = Omit<CameraItem, 'params'> & { params: DynamicCameraParams };
type ActorCameraItem = Omit<CameraItem, 'params'> & {
  params: Extract<DynamicCameraParams, { action: 'camera.follow_actor' }>;
};
type GroupCameraItem = Omit<CameraItem, 'params'> & {
  params: Extract<DynamicCameraParams, { action: 'camera.follow_group' }>;
};

interface CameraState {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

interface PreparedGeojson {
  trackId: string;
  item: GeojsonItem;
  data: unknown;
}

interface PreparedCamera {
  item: CameraItem;
  start: CameraState;
}

export interface MarkerPort {
  setLngLat(coordinates: [number, number]): MarkerPort;
  addTo(map: mapboxgl.Map): MarkerPort;
  remove(): void;
}

export interface MapRuntimeDependencies {
  createMarker(element: HTMLElement): MarkerPort;
}

export interface RuntimeTrail {
  entityId: string;
  coordinates: ReadonlyArray<readonly [number, number]>;
}

const browserDependencies: MapRuntimeDependencies = {
  createMarker: (element) => new runtimeMapEngine.Marker({ element }),
};

const geoId = (trackId: string, itemId: string) => `ise:geo:${trackId}:${itemId}`;
const trailId = (entityId: string) => `ise:trail:${entityId}`;

export class MapRuntime {
  private markerItems: MarkerItem[] = [];
  private geojsonItems: PreparedGeojson[] = [];
  private cameraItems: PreparedCamera[] = [];
  private initialCamera: CameraState | undefined;
  private readonly renderedMarkers = new Map<string, MarkerPort>();
  private readonly renderedGeojson = new Set<string>();
  private readonly renderedTrails = new Set<string>();
  private readonly acquiredGeojsonAssetIds: string[] = [];
  private lastTimeMs = 0;
  private lastSnapshots: readonly ModelEntityFrameSnapshot[] = [];
  private lastTrails: RuntimeTrail[] = [];
  private listenerRegistered = false;
  private disposed = false;

  constructor(
    private readonly map: mapboxgl.Map,
    private readonly resources: ResourceManager,
    private readonly dependencies: MapRuntimeDependencies = browserDependencies,
  ) {}

  async load(tracks: SceneTrack[], signal?: AbortSignal) {
    this.assertUsable();
    const visibleTracks = tracks.filter((track) => track.visible);
    this.markerItems = visibleTracks
      .filter((track): track is Extract<SceneTrack, { type: 'marker' }> => track.type === 'marker')
      .flatMap((track) => track.items);

    const geojsonTracks = visibleTracks.filter(
      (track): track is Extract<SceneTrack, { type: 'geojson' }> => track.type === 'geojson',
    );
    for (const track of geojsonTracks) {
      for (const item of track.items) {
        const asset = await this.acquire(item.assetId, signal);
        let data: unknown;
        try {
          const document = await asset.readJson();
          this.assertLoadActive(signal);
          data = geojsonDocumentSchema.parse(document);
        } catch (error) {
          this.assertLoadActive(signal);
          throw new SceneRuntimeError(
            'GEOJSON_INVALID',
            `GeoJSON document is invalid: ${item.assetId}`,
            item.assetId,
            { cause: error },
          );
        }
        this.geojsonItems.push({ trackId: track.trackId, item, data });
      }
    }

    this.assertLoadActive(signal);
    this.initialCamera = {
      center: [this.map.getCenter().lng, this.map.getCenter().lat],
      zoom: this.map.getZoom(),
      pitch: this.map.getPitch(),
      bearing: this.map.getBearing(),
    };
    const sortedCameraItems = visibleTracks
      .filter((track): track is Extract<SceneTrack, { type: 'camera' }> => track.type === 'camera')
      .flatMap((track) => track.items)
      .map((item, index) => ({ item, index }))
      .sort(
        (left, right) =>
          left.item.startMs - right.item.startMs ||
          left.item.id.localeCompare(right.item.id) ||
          left.index - right.index,
      )
      .map(({ item }) => item);

    let cameraStart = this.initialCamera;
    let previous: CameraItem | undefined;
    for (const item of sortedCameraItems) {
      if (previous && item.startMs < previous.startMs + previous.durationMs) {
        throw new Error(`Camera intervals overlap: ${previous.id} and ${item.id}`);
      }
      this.cameraItems.push({ item, start: cameraStart });
      if (isStaticCameraItem(item)) {
        cameraStart = cameraTarget(item);
      }
      previous = item;
    }

    if (!this.listenerRegistered) {
      this.assertLoadActive(signal);
      this.map.on('style.load', this.handleStyleLoad);
      this.listenerRegistered = true;
    }
  }

  applyBase(timeMs: number, snapshots: readonly ModelEntityFrameSnapshot[] = []) {
    if (this.disposed) {
      return;
    }
    this.lastTimeMs = finiteTime(timeMs);
    this.lastSnapshots = snapshots;
    this.applyMarkers(this.lastTimeMs);
    this.applyGeojson(this.lastTimeMs);
    this.applyCamera(this.lastTimeMs, snapshots);
  }

  applyTrails(trails: RuntimeTrail[]) {
    if (this.disposed) {
      return;
    }
    this.lastTrails = trails.map((trail) => ({
      entityId: trail.entityId,
      coordinates: [...trail.coordinates],
    }));
    const desired = new Set<string>();

    for (const trail of trails) {
      if (trail.coordinates.length === 0) {
        continue;
      }
      const id = trailId(trail.entityId);
      desired.add(id);
      const data = lineFeature(trail.coordinates);
      const source = this.map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
      } else if (this.map.isStyleLoaded()) {
        this.map.addSource(id, { type: 'geojson', data });
      }
      if (!this.map.getLayer(id) && this.map.getSource(id)) {
        this.map.addLayer({
          id,
          type: 'line',
          source: id,
          paint: { 'line-color': '#f4d35e', 'line-width': 2 },
        });
      }
      if (this.map.getSource(id)) {
        this.renderedTrails.add(id);
      }
    }

    for (const id of [...this.renderedTrails]) {
      if (!desired.has(id)) {
        this.removeLayerAndSource(id);
        this.renderedTrails.delete(id);
      }
    }
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
    for (const marker of this.renderedMarkers.values()) {
      marker.remove();
    }
    this.renderedMarkers.clear();

    for (const entry of this.geojsonItems) {
      this.removeGeojson(entry);
    }
    this.renderedGeojson.clear();
    for (const id of [...this.renderedTrails]) {
      this.removeLayerAndSource(id);
    }
    this.renderedTrails.clear();

    for (const assetId of this.acquiredGeojsonAssetIds) {
      this.resources.release(assetId);
    }
    this.acquiredGeojsonAssetIds.length = 0;
    this.geojsonItems = [];
    this.markerItems = [];
    this.cameraItems = [];
    this.lastTrails = [];
  }

  private readonly handleStyleLoad = () => {
    if (this.disposed) {
      return;
    }
    this.renderedGeojson.clear();
    this.renderedTrails.clear();
    this.applyBase(this.lastTimeMs, this.lastSnapshots);
    this.applyTrails(this.lastTrails);
  };

  private async acquire(assetId: string, signal?: AbortSignal) {
    const asset = await this.resources.acquire(assetId, 'geojson', signal);
    try {
      this.assertLoadActive(signal);
    } catch (error) {
      this.resources.release(assetId);
      throw error;
    }
    this.acquiredGeojsonAssetIds.push(assetId);
    return asset;
  }

  private applyMarkers(timeMs: number) {
    const desired = new Set<string>();
    for (const item of this.markerItems) {
      if (!isActive(item, timeMs)) {
        continue;
      }
      desired.add(item.id);
      if (this.renderedMarkers.has(item.id)) {
        continue;
      }
      const element = document.createElement('div');
      element.textContent = item.params.label;
      element.dataset.runtimeKind = 'marker';
      Object.assign(element.style, {
        backgroundColor: item.params.color,
        pointerEvents: 'none',
      });
      const marker = this.dependencies
        .createMarker(element)
        .setLngLat(item.params.coordinates)
        .addTo(this.map);
      this.renderedMarkers.set(item.id, marker);
    }

    for (const [itemId, marker] of this.renderedMarkers) {
      if (!desired.has(itemId)) {
        marker.remove();
        this.renderedMarkers.delete(itemId);
      }
    }
  }

  private applyGeojson(timeMs: number) {
    const desired = new Set<string>();
    for (const entry of this.geojsonItems) {
      const endMs = entry.item.startMs + entry.item.durationMs;
      const shouldRender =
        timeMs >= entry.item.startMs &&
        (timeMs < endMs || (entry.item.params.keepAfterEnd && timeMs >= endMs));
      const id = geoId(entry.trackId, entry.item.id);
      if (shouldRender) {
        desired.add(id);
        this.addGeojson(entry);
      }
    }

    for (const id of [...this.renderedGeojson]) {
      if (!desired.has(id)) {
        const entry = this.geojsonItems.find(
          (candidate) => geoId(candidate.trackId, candidate.item.id) === id,
        );
        if (entry) {
          this.removeGeojson(entry);
        }
      }
    }
  }

  private addGeojson(entry: PreparedGeojson) {
    if (!this.map.isStyleLoaded()) {
      return;
    }
    const id = geoId(entry.trackId, entry.item.id);
    if (!this.map.getSource(id)) {
      this.map.addSource(id, { type: 'geojson', data: entry.data as never });
    }
    const { params } = entry.item;
    if (!this.map.getLayer(`${id}:fill`)) {
      this.map.addLayer({
        id: `${id}:fill`,
        type: 'fill',
        source: id,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': params.fillColor, 'fill-opacity': params.fillOpacity },
      });
    }
    if (!this.map.getLayer(`${id}:line`)) {
      this.map.addLayer({
        id: `${id}:line`,
        type: 'line',
        source: id,
        filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
        paint: { 'line-color': params.lineColor, 'line-width': params.lineWidth },
      });
    }
    if (!this.map.getLayer(`${id}:circle`)) {
      this.map.addLayer({
        id: `${id}:circle`,
        type: 'circle',
        source: id,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': params.circleColor, 'circle-radius': params.circleRadius },
      });
    }
    this.renderedGeojson.add(id);
  }

  private removeGeojson(entry: PreparedGeojson) {
    const id = geoId(entry.trackId, entry.item.id);
    this.safeRemoveLayer(`${id}:circle`);
    this.safeRemoveLayer(`${id}:line`);
    this.safeRemoveLayer(`${id}:fill`);
    this.safeRemoveSource(id);
    this.renderedGeojson.delete(id);
  }

  private applyCamera(timeMs: number, snapshots: readonly ModelEntityFrameSnapshot[]) {
    if (!this.initialCamera) {
      return;
    }
    const staticState = this.staticCameraState(timeMs);
    const dynamicItem = this.cameraItems
      .map(({ item }) => item)
      .find((item) => isDynamicCameraItem(item) && isActive(item, timeMs));
    if (!dynamicItem || !isDynamicCameraItem(dynamicItem)) {
      this.map.jumpTo(staticState);
      return;
    }
    const target = dynamicCameraTarget(this.map, dynamicItem, snapshots);
    if (!target) {
      this.map.jumpTo(staticState);
      return;
    }
    const transitionMs = dynamicItem.params.transitionMs;
    const state =
      transitionMs > 0 && timeMs < dynamicItem.startMs + transitionMs
        ? interpolateCamera(
            this.previousCameraPolicy(dynamicItem, timeMs, snapshots),
            target,
            clamp01((timeMs - dynamicItem.startMs) / transitionMs),
          )
        : target;
    this.map.jumpTo(state);
  }

  private staticCameraState(timeMs: number): CameraState {
    let state = this.initialCamera!;
    for (const prepared of this.cameraItems) {
      const { item, start } = prepared;
      if (timeMs < item.startMs) {
        break;
      }
      if (!isStaticCameraItem(item)) {
        continue;
      }
      const endMs = item.startMs + item.durationMs;
      if (item.durationMs > 0 && timeMs < endMs) {
        const progress = clamp01((timeMs - item.startMs) / item.durationMs);
        const eased =
          item.params.easing === 'easeInOut'
            ? progress * progress * (3 - 2 * progress)
            : progress;
        state = interpolateCamera(start, cameraTarget(item), eased);
        break;
      }
      state = cameraTarget(item);
    }
    return state;
  }

  private previousCameraPolicy(
    item: DynamicCameraItem,
    timeMs: number,
    snapshots: readonly ModelEntityFrameSnapshot[],
  ): CameraState {
    const index = this.cameraItems.findIndex((candidate) => candidate.item === item);
    const previous = index > 0 ? this.cameraItems[index - 1]?.item : undefined;
    if (previous && isDynamicCameraItem(previous)) {
      const state = dynamicCameraTarget(this.map, previous, snapshots);
      if (state) {
        return state;
      }
    }
    return this.staticCameraState(timeMs);
  }

  private removeLayerAndSource(id: string) {
    this.safeRemoveLayer(id);
    this.safeRemoveSource(id);
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

  private safeRemoveSource(id: string) {
    try {
      if (this.map.getSource(id)) {
        this.map.removeSource(id);
      }
    } catch {
      // The shared style may already be tearing down.
    }
  }

  private assertUsable() {
    if (this.disposed) {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Map runtime is disposed');
    }
  }

  private assertLoadActive(signal?: AbortSignal) {
    this.assertUsable();
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Map load aborted', 'AbortError');
    }
  }
}

function isActive(item: { startMs: number; durationMs: number }, timeMs: number) {
  return item.startMs <= timeMs && timeMs < item.startMs + item.durationMs;
}

function isStaticCameraItem(item: CameraItem): item is StaticCameraItem {
  return !('action' in item.params);
}

function isDynamicCameraItem(
  item: CameraItem,
): item is DynamicCameraItem {
  return !isStaticCameraItem(item);
}

function cameraTarget(item: StaticCameraItem): CameraState {
  return {
    center: item.params.center,
    zoom: item.params.zoom,
    pitch: item.params.pitch,
    bearing: item.params.bearing,
  };
}

function dynamicCameraTarget(
  map: mapboxgl.Map,
  item: DynamicCameraItem,
  snapshots: readonly ModelEntityFrameSnapshot[],
): CameraState | undefined {
  switch (item.params.action) {
    case 'camera.follow_actor':
      return actorCameraTarget(item.params, snapshots);
    case 'camera.follow_group':
      return groupCameraTarget(map, item.params, snapshots);
  }
}

function actorCameraTarget(
  params: ActorCameraItem['params'],
  snapshots: readonly ModelEntityFrameSnapshot[],
): CameraState | undefined {
  const subject = snapshots.find(
    (snapshot) => snapshot.entityId === params.entityId && snapshot.visible && hasCoordinates(snapshot),
  );
  if (!subject || subject.longitude === undefined || subject.latitude === undefined) {
    return undefined;
  }
  const headingRad = degreesToRadians(subject.headingDeg ?? 0);
  const offsetDeg = params.lookAheadMs / 100_000;
  return {
    center: [
      normalizeLongitude(subject.longitude + Math.sin(headingRad) * offsetDeg),
      clampLatitude(subject.latitude + Math.cos(headingRad) * offsetDeg),
    ],
    zoom: params.zoom,
    pitch: params.pitch,
    bearing: params.bearing,
  };
}

function groupCameraTarget(
  map: mapboxgl.Map,
  params: GroupCameraItem['params'],
  snapshots: readonly ModelEntityFrameSnapshot[],
): CameraState | undefined {
  const snapshotByEntityId = new Map(snapshots.map((snapshot) => [snapshot.entityId, snapshot]));
  const subjects = params.entityIds
    .map((entityId) => snapshotByEntityId.get(entityId))
    .filter((snapshot): snapshot is ModelEntityFrameSnapshot =>
      snapshot !== undefined && snapshot.visible && hasCoordinates(snapshot),
    );
  if (subjects.length === 0) {
    return undefined;
  }
  if (subjects.length === 1) {
    const subject = subjects[0]!;
    return {
      center: [subject.longitude!, subject.latitude!],
      zoom: params.maxZoom,
      pitch: params.pitch,
      bearing: params.bearing,
    };
  }
  const longitudes = subjects.map((subject) => subject.longitude!);
  const latitudes = subjects.map((subject) => subject.latitude!);
  const fitted = map.cameraForBounds(
    [
      [Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)],
    ],
    { padding: params.paddingPx },
  );
  if (!fitted) {
    return undefined;
  }
  const center = cameraCenter(fitted.center);
  const zoom = fitted.zoom;
  if (!center || typeof zoom !== 'number' || !Number.isFinite(zoom)) {
    return undefined;
  }
  return {
    center,
    zoom: clamp(zoom, params.minZoom, params.maxZoom),
    pitch: params.pitch,
    bearing: params.bearing,
  };
}

function hasCoordinates(
  snapshot: ModelEntityFrameSnapshot,
): snapshot is ModelEntityFrameSnapshot & { longitude: number; latitude: number } {
  return Number.isFinite(snapshot.longitude) && Number.isFinite(snapshot.latitude);
}

function cameraCenter(center: mapboxgl.LngLatLike | undefined): [number, number] | undefined {
  if (!center) {
    return undefined;
  }
  if (Array.isArray(center)) {
    return Number.isFinite(center[0]) && Number.isFinite(center[1]) ? [center[0], center[1]] : undefined;
  }
  const longitude = 'lng' in center ? center.lng : center.lon;
  return Number.isFinite(longitude) && Number.isFinite(center.lat) ? [longitude, center.lat] : undefined;
}

function interpolateCamera(start: CameraState, end: CameraState, ratio: number): CameraState {
  return {
    center: [
      interpolateLongitude(start.center[0], end.center[0], ratio),
      lerp(start.center[1], end.center[1], ratio),
    ],
    zoom: lerp(start.zoom, end.zoom, ratio),
    pitch: lerp(start.pitch, end.pitch, ratio),
    bearing: interpolateBearing(start.bearing, end.bearing, ratio),
  };
}

function interpolateLongitude(start: number, end: number, ratio: number) {
  const delta = shortestAngle(start, end);
  const longitude = start + delta * ratio;
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function interpolateBearing(start: number, end: number, ratio: number) {
  return start + shortestAngle(start, end) * ratio;
}

function shortestAngle(start: number, end: number) {
  return ((((end - start) % 360) + 540) % 360) - 180;
}

function lerp(start: number, end: number, ratio: number) {
  return start + (end - start) * ratio;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function normalizeLongitude(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function clampLatitude(value: number) {
  return clamp(value, -90, 90);
}

function finiteTime(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function lineFeature(coordinates: ReadonlyArray<readonly [number, number]>) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: coordinates.map(([longitude, latitude]) => [longitude, latitude]),
    },
  };
}

const longitudeSchema = z.number().finite().min(-180).max(180);
const latitudeSchema = z.number().finite().min(-90).max(90);
const positionSchema = z
  .tuple([longitudeSchema, latitudeSchema])
  .rest(z.number().finite());
const pointCoordinatesSchema = positionSchema;
const multiPointCoordinatesSchema = z.array(positionSchema).min(1);
const lineCoordinatesSchema = z.array(positionSchema).min(2);
const multiLineCoordinatesSchema = z.array(lineCoordinatesSchema).min(1);
const linearRingSchema = z
  .array(positionSchema)
  .min(4)
  .refine(
    (positions) =>
      positions[0]?.length === positions.at(-1)?.length &&
      positions[0]?.every((coordinate, index) => coordinate === positions.at(-1)?.[index]),
    'Linear ring must be closed',
  );
const polygonCoordinatesSchema = z.array(linearRingSchema).min(1);
const multiPolygonCoordinatesSchema = z.array(polygonCoordinatesSchema).min(1);

const pointGeometrySchema = z
  .object({ type: z.literal('Point'), coordinates: pointCoordinatesSchema })
  .passthrough();
const multiPointGeometrySchema = z
  .object({ type: z.literal('MultiPoint'), coordinates: multiPointCoordinatesSchema })
  .passthrough();
const lineGeometrySchema = z
  .object({ type: z.literal('LineString'), coordinates: lineCoordinatesSchema })
  .passthrough();
const multiLineGeometrySchema = z
  .object({ type: z.literal('MultiLineString'), coordinates: multiLineCoordinatesSchema })
  .passthrough();
const polygonGeometrySchema = z
  .object({ type: z.literal('Polygon'), coordinates: polygonCoordinatesSchema })
  .passthrough();
const multiPolygonGeometrySchema = z
  .object({ type: z.literal('MultiPolygon'), coordinates: multiPolygonCoordinatesSchema })
  .passthrough();

const geometrySchema: z.ZodType<unknown> = z.lazy(() => geometryUnionSchema);
const geometryCollectionSchema = z
  .object({ type: z.literal('GeometryCollection'), geometries: z.array(geometrySchema) })
  .passthrough();
const geometryUnionSchema = z.discriminatedUnion('type', [
  pointGeometrySchema,
  multiPointGeometrySchema,
  lineGeometrySchema,
  multiLineGeometrySchema,
  polygonGeometrySchema,
  multiPolygonGeometrySchema,
  geometryCollectionSchema,
]);
const featureSchema = z
  .object({
    type: z.literal('Feature'),
    properties: z.record(z.string(), z.unknown()).nullable(),
    geometry: geometrySchema.nullable(),
    id: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
const featureCollectionSchema = z
  .object({ type: z.literal('FeatureCollection'), features: z.array(featureSchema) })
  .passthrough();
const geojsonDocumentSchema = z.union([
  featureSchema,
  featureCollectionSchema,
  geometryCollectionSchema,
]);
