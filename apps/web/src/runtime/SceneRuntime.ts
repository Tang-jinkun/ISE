import {
  sceneProjectConfigSchema,
  type Diagnostic,
  type SceneEntity,
  type SceneProjectConfig,
  type SceneTrack,
} from '@ise/runtime-contracts';
import { MapRuntime, type RuntimeTrail } from './MapRuntime';
import { ModelRuntime, type ModelEntityFrameSnapshot } from './ModelRuntime';
import { DataLinkRuntime } from './DataLinkRuntime';
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
  applyBase(timeMs: number, snapshots: readonly ModelEntityFrameSnapshot[]): void;
  applyTrails(trails: RuntimeTrail[]): void;
  dispose(): void;
}

interface ModelRuntimePort {
  load(entities: SceneEntity[], tracks: SceneTrack[], signal?: AbortSignal): Promise<void>;
  apply(timeMs: number): RuntimeTrail[];
  getFrameSnapshot(): ModelEntityFrameSnapshot[];
  dispose(): void;
}

interface OverlayRuntimePort {
  load(tracks: SceneTrack[], signal?: AbortSignal): Promise<void>;
  unlockMedia(): Promise<void>;
  apply(frame: RuntimeFrame): void;
  dispose(): void;
}

interface DataLinkRuntimePort {
  load(tracks: SceneTrack[], signal?: AbortSignal): Promise<void>;
  apply(timeMs: number, snapshots: readonly ModelEntityFrameSnapshot[]): void;
  dispose(): void;
}

interface ResourceManagerPort {
  dispose(): void;
}

export interface SceneRuntimeDependencies {
  clock: PlaybackClockPort;
  mapRuntime: MapRuntimePort;
  modelRuntime: ModelRuntimePort;
  dataLinkRuntime: DataLinkRuntimePort;
  overlayRuntime: OverlayRuntimePort;
  resources: ResourceManagerPort;
}

type RuntimeState = 'idle' | 'loading' | 'ready' | 'disposed';

export class SceneRuntimeImpl implements SceneRuntime {
  private readonly clock: PlaybackClockPort;
  private readonly mapRuntime: MapRuntimePort;
  private readonly modelRuntime: ModelRuntimePort;
  private readonly dataLinkRuntime: DataLinkRuntimePort;
  private readonly overlayRuntime: OverlayRuntimePort;
  private readonly resources: ResourceManagerPort;
  private state: RuntimeState = 'idle';
  private config: SceneProjectConfig | undefined;
  private loadController: AbortController | undefined;
  private unsubscribeClock: (() => void) | undefined;
  private suppressClockFrame = false;
  private mediaUnlocked = false;
  private playIntentGeneration = 0;
  private playbackDesired = false;
  private ownersDisposed = false;

  constructor(
    private readonly options: SceneRuntimeOptions,
    dependencies?: SceneRuntimeDependencies,
  ) {
    const resolved = dependencies ?? createBrowserDependencies(options, this.emitDiagnostic);
    this.clock = resolved.clock;
    this.mapRuntime = resolved.mapRuntime;
    this.modelRuntime = resolved.modelRuntime;
    this.dataLinkRuntime = resolved.dataLinkRuntime;
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
    let loadStage: 'map' | 'model' | 'data-link' | 'overlay' | 'initial-frame' = 'map';

    try {
      const visibleTracks = config.tracks.filter((track) => track.visible);
      await this.mapRuntime.load(
        visibleTracks.filter(isMapTrack),
        controller.signal,
      );
      this.assertActiveLoad(controller);
      loadStage = 'model';
      await this.modelRuntime.load(
        config.entities,
        visibleTracks.filter(
          (track): track is Extract<SceneTrack, { type: 'model' }> => track.type === 'model',
        ),
        controller.signal,
      );
      this.assertActiveLoad(controller);
      loadStage = 'data-link';
      await this.dataLinkRuntime.load(
        visibleTracks.filter(isDataLinkTrack),
        controller.signal,
      );
      this.assertActiveLoad(controller);
      loadStage = 'overlay';
      await this.overlayRuntime.load(
        visibleTracks.filter(isOverlayTrack),
        controller.signal,
      );
      this.assertActiveLoad(controller);

      this.config = config;
      this.withSuppressedClockFrame(() => this.clock.setDuration(config.totalDurationMs));
      this.assertActiveLoad(controller);
      this.state = 'ready';
      loadStage = 'initial-frame';
      this.applyLifecycleFrame({ timeMs: 0, playing: false, forceMediaSeek: true });
    } catch (error) {
      if (this.isDisposed()) {
        throw disposedError(error);
      }
      const loadError = normalizeLoadError(error, loadStage);
      this.state = 'disposed';
      controller.abort(loadError);
      try {
        this.disposeOwners();
      } catch (cleanupError) {
        throw new AggregateError(
          [loadError, cleanupError],
          'Scene runtime load failed and cleanup also failed',
        );
      }
      throw loadError;
    } finally {
      if (this.loadController === controller) {
        this.loadController = undefined;
      }
    }
  }

  async play() {
    this.assertReady();
    const intentGeneration = ++this.playIntentGeneration;
    this.playbackDesired = true;
    if (this.clock.currentTimeMs >= this.config!.totalDurationMs) {
      this.playbackDesired = false;
      return;
    }
    if (!this.mediaUnlocked) {
      try {
        await this.overlayRuntime.unlockMedia();
      } catch (error) {
        if (!this.isCurrentPlayIntent(intentGeneration)) {
          if (this.isDisposed()) {
            throw disposedError(error);
          }
          return;
        }
        this.playbackDesired = false;
        throw error;
      }
      this.assertReady();
      this.mediaUnlocked = true;
    }
    if (!this.isCurrentPlayIntent(intentGeneration)) {
      return;
    }
    this.clock.play();
    this.applyLifecycleFrame({
      timeMs: this.clock.currentTimeMs,
      playing: this.clock.isPlaying,
      forceMediaSeek: false,
    });
  }

  pause() {
    this.cancelPlayIntent();
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
    this.cancelPlayIntent(resume);
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
    this.cancelPlayIntent();
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
    this.cancelPlayIntent();
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
    const trails = this.modelRuntime.apply(frame.timeMs);
    const snapshots = this.modelRuntime.getFrameSnapshot();
    this.mapRuntime.applyBase(frame.timeMs, snapshots);
    this.mapRuntime.applyTrails(trails);
    this.dataLinkRuntime.apply(frame.timeMs, snapshots);
    this.overlayRuntime.apply(frame);
    this.options.overlayRoot.dataset.runtimeModels = JSON.stringify(
      snapshots,
    );
    this.options.overlayRoot.dataset.runtimeTimeMs = String(Math.round(frame.timeMs));
  }

  private handleFrameError(error: unknown) {
    this.cancelPlayIntent();
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

  private cancelPlayIntent(playbackDesired = false) {
    this.playIntentGeneration += 1;
    this.playbackDesired = playbackDesired;
  }

  private isCurrentPlayIntent(generation: number) {
    return this.playbackDesired && generation === this.playIntentGeneration;
  }

  private disposeOwners() {
    if (this.ownersDisposed) {
      return;
    }
    this.ownersDisposed = true;
    const errors: unknown[] = [];
    const attempt = (operation: () => void) => {
      try {
        operation();
      } catch (error) {
        errors.push(error);
      }
    };
    const unsubscribeClock = this.unsubscribeClock;
    this.unsubscribeClock = undefined;
    this.config = undefined;
    this.mediaUnlocked = false;
    delete this.options.overlayRoot.dataset.runtimeTimeMs;
    delete this.options.overlayRoot.dataset.runtimeModels;

    attempt(() => unsubscribeClock?.());
    attempt(() => this.overlayRuntime.dispose());
    attempt(() => this.dataLinkRuntime.dispose());
    attempt(() => this.modelRuntime.dispose());
    attempt(() => this.mapRuntime.dispose());
    attempt(() => this.resources.dispose());
    attempt(() => this.clock.dispose());

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to dispose scene runtime owners');
    }
  }
}

function normalizeLoadError(
  error: unknown,
  stage: 'map' | 'model' | 'data-link' | 'overlay' | 'initial-frame',
) {
  if (error instanceof Error) return error;
  const suffix = error === undefined || error === null
    ? 'without an error'
    : `with ${String(error)}`;
  return new SceneRuntimeError(
    'RUNTIME_NOT_LOADED',
    `Scene runtime ${stage} stage failed ${suffix}`,
  );
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
    dataLinkRuntime: new DataLinkRuntime(options.map),
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

function isDataLinkTrack(
  track: SceneTrack,
): track is Extract<SceneTrack, { type: 'data_link' }> {
  return track.type === 'data_link';
}

function disposedError(cause: unknown) {
  if (cause instanceof SceneRuntimeError && cause.code === 'RUNTIME_DISPOSED') {
    return cause;
  }
  return new SceneRuntimeError('RUNTIME_DISPOSED', 'Scene runtime is disposed', undefined, {
    cause,
  });
}
