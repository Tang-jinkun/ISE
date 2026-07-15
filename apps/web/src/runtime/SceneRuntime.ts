import {
  sceneProjectConfigSchema,
  type Diagnostic,
  type SceneEntity,
  type SceneProjectConfig,
  type SceneTrack,
} from '@ise/runtime-contracts';
import { MapRuntime, type RuntimeTrail } from './MapRuntime';
import { ModelRuntime } from './ModelRuntime';
import { OverlayRuntime } from './OverlayRuntime';
import { PlaybackClock } from './PlaybackClock';
import { ResourceManager } from './ResourceManager';
import { SceneRuntimeError } from './errors';
import type {
  PlaybackClockPort,
  RuntimeDiagnosticSink,
  RuntimeFrame,
  SceneRuntime,
  SceneRuntimeOptions,
} from './types';

interface MapRuntimePort {
  load(tracks: SceneTrack[], signal?: AbortSignal): Promise<void>;
  applyBase(timeMs: number): void;
  applyTrails(trails: RuntimeTrail[]): void;
  dispose(): void;
}

interface ModelRuntimePort {
  load(entities: SceneEntity[], tracks: SceneTrack[], signal?: AbortSignal): Promise<void>;
  apply(timeMs: number): RuntimeTrail[];
  dispose(): void;
}

interface OverlayRuntimePort {
  load(tracks: SceneTrack[], signal?: AbortSignal): Promise<void>;
  unlockMedia(): Promise<void>;
  apply(frame: RuntimeFrame): void;
  dispose(): void;
}

interface ResourceManagerPort {
  dispose(): void;
}

export interface SceneRuntimeDependencies {
  clock: PlaybackClockPort;
  mapRuntime: MapRuntimePort;
  modelRuntime: ModelRuntimePort;
  overlayRuntime: OverlayRuntimePort;
  resources: ResourceManagerPort;
}

type RuntimeState = 'idle' | 'loading' | 'ready' | 'disposed';

export class SceneRuntimeImpl implements SceneRuntime {
  private readonly clock: PlaybackClockPort;
  private readonly mapRuntime: MapRuntimePort;
  private readonly modelRuntime: ModelRuntimePort;
  private readonly overlayRuntime: OverlayRuntimePort;
  private readonly resources: ResourceManagerPort;
  private state: RuntimeState = 'idle';
  private config: SceneProjectConfig | undefined;
  private loadController: AbortController | undefined;
  private unsubscribeClock: (() => void) | undefined;
  private suppressClockFrame = false;
  private mediaUnlocked = false;
  private ownersDisposed = false;

  constructor(
    private readonly options: SceneRuntimeOptions,
    dependencies?: SceneRuntimeDependencies,
  ) {
    const resolved = dependencies ?? createBrowserDependencies(options, this.emitDiagnostic);
    this.clock = resolved.clock;
    this.mapRuntime = resolved.mapRuntime;
    this.modelRuntime = resolved.modelRuntime;
    this.overlayRuntime = resolved.overlayRuntime;
    this.resources = resolved.resources;
    this.unsubscribeClock = this.clock.subscribe(this.handleClockFrame);
  }

  async load(input: SceneProjectConfig) {
    this.assertUsable();
    if (this.state !== 'idle') {
      throw new SceneRuntimeError('RUNTIME_NOT_LOADED', 'Scene runtime already has a project');
    }
    const config = sceneProjectConfigSchema.parse(input);
    const controller = new AbortController();
    this.loadController = controller;
    this.state = 'loading';

    try {
      const visibleTracks = config.tracks.filter((track) => track.visible);
      await this.mapRuntime.load(
        visibleTracks.filter(isMapTrack),
        controller.signal,
      );
      this.assertActiveLoad(controller);
      await this.modelRuntime.load(
        config.entities,
        visibleTracks.filter(
          (track): track is Extract<SceneTrack, { type: 'model' }> => track.type === 'model',
        ),
        controller.signal,
      );
      this.assertActiveLoad(controller);
      await this.overlayRuntime.load(
        visibleTracks.filter(isOverlayTrack),
        controller.signal,
      );
      this.assertActiveLoad(controller);

      this.config = config;
      this.withSuppressedClockFrame(() => this.clock.setDuration(config.totalDurationMs));
      this.assertActiveLoad(controller);
      this.state = 'ready';
      this.applyLifecycleFrame({ timeMs: 0, playing: false, forceMediaSeek: true });
    } catch (error) {
      if (this.isDisposed()) {
        throw disposedError(error);
      }
      this.state = 'disposed';
      controller.abort(error);
      this.disposeOwners();
      throw error;
    } finally {
      if (this.loadController === controller) {
        this.loadController = undefined;
      }
    }
  }

  async play() {
    this.assertReady();
    if (this.clock.currentTimeMs >= this.config!.totalDurationMs) {
      return;
    }
    if (!this.mediaUnlocked) {
      await this.overlayRuntime.unlockMedia();
      this.assertReady();
      this.mediaUnlocked = true;
    }
    this.clock.play();
    this.applyLifecycleFrame({
      timeMs: this.clock.currentTimeMs,
      playing: this.clock.isPlaying,
      forceMediaSeek: false,
    });
  }

  pause() {
    if (this.state !== 'ready') {
      return;
    }
    this.withSuppressedClockFrame(() => this.clock.pause());
    this.applyLifecycleFrame({
      timeMs: this.clock.currentTimeMs,
      playing: false,
      forceMediaSeek: true,
    });
  }

  async seek(timeMs: number) {
    this.assertReady();
    const resume = this.clock.isPlaying;
    this.withSuppressedClockFrame(() => {
      if (resume) {
        this.clock.pause();
      }
      this.clock.seek(timeMs);
    });
    this.applyLifecycleFrame({
      timeMs: this.clock.currentTimeMs,
      playing: false,
      forceMediaSeek: true,
    });
    if (resume) {
      this.clock.play();
    }
  }

  async replay() {
    this.assertReady();
    this.withSuppressedClockFrame(() => {
      this.clock.pause();
      this.clock.seek(0);
    });
    this.applyLifecycleFrame({ timeMs: 0, playing: false, forceMediaSeek: true });
    await this.play();
  }

  dispose() {
    if (this.state === 'disposed') {
      return;
    }
    this.state = 'disposed';
    this.loadController?.abort(
      new SceneRuntimeError('RUNTIME_DISPOSED', 'Scene runtime is disposed'),
    );
    this.loadController = undefined;
    this.disposeOwners();
  }

  private readonly handleClockFrame = (frame: RuntimeFrame) => {
    if (this.suppressClockFrame || this.state !== 'ready') {
      return;
    }
    try {
      this.applyFrame(frame);
    } catch (error) {
      this.handleFrameError(error);
    }
  };

  private applyLifecycleFrame(frame: RuntimeFrame) {
    try {
      this.applyFrame(frame);
    } catch (error) {
      this.handleFrameError(error);
      throw error;
    }
  }

  private applyFrame(frame: RuntimeFrame) {
    this.mapRuntime.applyBase(frame.timeMs);
    const trails = this.modelRuntime.apply(frame.timeMs);
    this.mapRuntime.applyTrails(trails);
    this.overlayRuntime.apply(frame);
    this.options.overlayRoot.dataset.runtimeTimeMs = String(Math.round(frame.timeMs));
  }

  private handleFrameError(error: unknown) {
    if (this.state === 'ready' && this.clock.isPlaying) {
      this.withSuppressedClockFrame(() => this.clock.pause());
    }
    this.emitDiagnostic({
      code: 'RUNTIME_FRAME_FAILED',
      severity: 'error',
      recoverable: false,
      message: error instanceof Error ? error.message : 'Runtime frame application failed',
    });
  }

  private readonly emitDiagnostic: RuntimeDiagnosticSink = (diagnostic) => {
    this.options.overlayRoot.dispatchEvent(
      new CustomEvent<Diagnostic>('ise-runtime-diagnostic', { detail: diagnostic }),
    );
  };

  private withSuppressedClockFrame<T>(operation: () => T) {
    const previous = this.suppressClockFrame;
    this.suppressClockFrame = true;
    try {
      return operation();
    } finally {
      this.suppressClockFrame = previous;
    }
  }

  private assertActiveLoad(controller: AbortController) {
    if (
      this.state === 'disposed' ||
      controller.signal.aborted ||
      this.loadController !== controller
    ) {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Scene runtime is disposed');
    }
  }

  private assertReady() {
    this.assertUsable();
    if (this.state !== 'ready') {
      throw new SceneRuntimeError('RUNTIME_NOT_LOADED', 'Scene runtime is not loaded');
    }
  }

  private assertUsable() {
    if (this.state === 'disposed') {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Scene runtime is disposed');
    }
  }

  private isDisposed() {
    return this.state === 'disposed';
  }

  private disposeOwners() {
    if (this.ownersDisposed) {
      return;
    }
    this.ownersDisposed = true;
    this.unsubscribeClock?.();
    this.unsubscribeClock = undefined;
    this.overlayRuntime.dispose();
    this.modelRuntime.dispose();
    this.mapRuntime.dispose();
    this.resources.dispose();
    this.clock.dispose();
    this.config = undefined;
    this.mediaUnlocked = false;
    delete this.options.overlayRoot.dataset.runtimeTimeMs;
  }
}

function createBrowserDependencies(
  options: SceneRuntimeOptions,
  emitDiagnostic: RuntimeDiagnosticSink,
): SceneRuntimeDependencies {
  const resources = new ResourceManager({ resolveAsset: options.resolveAsset });
  return {
    clock: new PlaybackClock(),
    mapRuntime: new MapRuntime(options.map, resources),
    modelRuntime: new ModelRuntime(options.map, resources),
    overlayRuntime: new OverlayRuntime(options.overlayRoot, resources, emitDiagnostic),
    resources,
  };
}

function isMapTrack(
  track: SceneTrack,
): track is Extract<SceneTrack, { type: 'marker' | 'geojson' | 'camera' }> {
  return track.type === 'marker' || track.type === 'geojson' || track.type === 'camera';
}

function isOverlayTrack(
  track: SceneTrack,
): track is Extract<SceneTrack, { type: 'subtitle' | 'image' | 'video' }> {
  return track.type === 'subtitle' || track.type === 'image' || track.type === 'video';
}

function disposedError(cause: unknown) {
  if (cause instanceof SceneRuntimeError && cause.code === 'RUNTIME_DISPOSED') {
    return cause;
  }
  return new SceneRuntimeError('RUNTIME_DISPOSED', 'Scene runtime is disposed', undefined, {
    cause,
  });
}
