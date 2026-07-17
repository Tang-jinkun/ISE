import { vi } from 'vitest';
import type { FrameScheduler } from '../../types';

export class FakeFrameScheduler implements FrameScheduler {
  private nowMs = 0;
  private nextId = 1;
  private callbacks = new Map<number, FrameRequestCallback>();

  readonly request = vi.fn((callback: FrameRequestCallback) => {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  });

  readonly cancel = vi.fn((id: number) => this.callbacks.delete(id));
  readonly now = () => this.nowMs;

  get pendingCount() {
    return this.callbacks.size;
  }

  advanceTo(nowMs: number) {
    this.nowMs = nowMs;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback(nowMs));
  }
}

export class FakeMap {
  markerCount = 0;
  lastJump: Record<string, unknown> | undefined;
  readonly easeTo = vi.fn();
  readonly cameraForBounds = vi.fn();
  readonly triggerRepaint = vi.fn();
  private camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  private layers = new Map<string, any>();
  private sources = new Map<string, { data: unknown; setData(data: unknown): void }>();
  private listeners = new Map<string, Set<() => void>>();
  private canvas = document.createElement('canvas');

  constructor(
    camera = { center: [70, 20] as [number, number], zoom: 3, pitch: 0, bearing: 0 },
  ) {
    this.camera = camera;
  }

  readonly addSource = vi.fn((id: string, source: { data: unknown }) => {
    const entry = {
      data: source.data,
      setData: (data: unknown) => {
        entry.data = data;
      },
    };
    this.sources.set(id, entry);
  });

  readonly getSource = vi.fn((id: string) => this.sources.get(id));
  readonly removeSource = vi.fn((id: string) => this.sources.delete(id));
  readonly addLayer = vi.fn(
    (layer: { id: string; onAdd?: (map: unknown, gl: unknown) => void }) => {
      this.layers.set(layer.id, layer);
      layer.onAdd?.(this, {});
    },
  );
  readonly getLayer = vi.fn((id: string) => this.layers.get(id));
  readonly removeLayer = vi.fn((id: string) => {
    const layer = this.layers.get(id);
    layer?.onRemove?.(this, {});
    this.layers.delete(id);
  });
  readonly jumpTo = vi.fn((next: any) => {
    this.lastJump = next;
    const center = next.center ?? this.camera.center;
    this.camera = {
      center,
      zoom: next.zoom ?? this.camera.zoom,
      pitch: next.pitch ?? this.camera.pitch,
      bearing: next.bearing ?? this.camera.bearing,
    };
  });

  getCenter() {
    return { lng: this.camera.center[0], lat: this.camera.center[1] };
  }

  getZoom() {
    return this.camera.zoom;
  }

  getPitch() {
    return this.camera.pitch;
  }

  getBearing() {
    return this.camera.bearing;
  }

  getCanvas() {
    return this.canvas;
  }

  isStyleLoaded() {
    return true;
  }

  on(event: string, listener: () => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: () => void) {
    this.listeners.get(event)?.delete(listener);
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }

  layerIds() {
    return [...this.layers.keys()];
  }

  sourceData(id: string) {
    return this.sources.get(id)?.data;
  }

  clearStyleAndEmit(event: string) {
    this.layers.clear();
    this.sources.clear();
    this.listeners.get(event)?.forEach((listener) => listener());
  }
}
