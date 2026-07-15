import type mapboxgl from 'mapbox-gl';
import type { Diagnostic, ResolvedAssetAccess, SceneProjectConfig } from '@ise/runtime-contracts';

export interface SceneRuntime {
  load(config: SceneProjectConfig): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(timeMs: number): Promise<void>;
  replay(): Promise<void>;
  dispose(): void;
}

export interface SceneRuntimeOptions {
  map: mapboxgl.Map;
  overlayRoot: HTMLElement;
  resolveAsset(assetId: string, signal?: AbortSignal): Promise<ResolvedAssetAccess>;
}

export interface RuntimeFrame {
  timeMs: number;
  playing: boolean;
  forceMediaSeek: boolean;
}

export type RuntimeDiagnosticSink = (diagnostic: Diagnostic) => void;

export interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
  now(): number;
}

export interface PlaybackClockPort {
  readonly currentTimeMs: number;
  readonly isPlaying: boolean;
  setDuration(durationMs: number): void;
  subscribe(listener: (frame: RuntimeFrame) => void): () => void;
  play(): void;
  pause(): void;
  seek(timeMs: number): void;
  dispose(): void;
}
