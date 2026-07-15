import type { OverlayLayout, SceneTrack } from '@ise/runtime-contracts';
import { SceneRuntimeError } from './errors';
import type { LoadedAsset, ResourceManager } from './ResourceManager';
import type { RuntimeDiagnosticSink, RuntimeFrame } from './types';

type SubtitleItem = Extract<SceneTrack, { type: 'subtitle' }>['items'][number];
type ImageItem = Extract<SceneTrack, { type: 'image' }>['items'][number];
type VideoItem = Extract<SceneTrack, { type: 'video' }>['items'][number];
type VideoAccess = Extract<LoadedAsset['access'], { mediaType: 'video/mp4' }>;

interface SubtitleOverlay {
  item: SubtitleItem;
  element: HTMLElement;
}

interface ImageOverlay {
  item: ImageItem;
  element: HTMLElement;
  image?: HTMLImageElement;
}

interface VideoOverlay {
  item: VideoItem;
  element: HTMLVideoElement;
  access: VideoAccess;
  playbackGeneration: number;
  expectsPlayback: boolean;
}

interface MediaSnapshot {
  video: HTMLVideoElement;
  muted: boolean;
  volume: number;
}

interface UnlockAttempt {
  generation: number;
  snapshots: MediaSnapshot[];
}

export interface OverlayRuntimeDependencies {
  createImage(): HTMLImageElement;
  createVideo(): HTMLVideoElement;
}

const browserOverlayDependencies: OverlayRuntimeDependencies = {
  createImage: () => document.createElement('img'),
  createVideo: () => document.createElement('video'),
};

const FADE_MS = 300;

export class OverlayRuntime {
  private readonly layer = document.createElement('div');
  private readonly subtitles: SubtitleOverlay[] = [];
  private readonly images: ImageOverlay[] = [];
  private readonly videos: VideoOverlay[] = [];
  private readonly acquiredAssetIds: string[] = [];
  private loadController: AbortController | undefined;
  private activeUnlock: UnlockAttempt | undefined;
  private lifecycleGeneration = 0;
  private unlockGeneration = 0;
  private loaded = false;
  private loading = false;
  private mediaUnlocked = false;
  private disposed = false;

  constructor(
    private readonly overlayRoot: HTMLElement,
    private readonly resources: ResourceManager,
    private readonly emitDiagnostic: RuntimeDiagnosticSink,
    private readonly dependencies: OverlayRuntimeDependencies = browserOverlayDependencies,
  ) {
    this.layer.dataset.iseRuntimeOverlay = '';
    Object.assign(this.layer.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
    });
    this.overlayRoot.append(this.layer);
  }

  async load(tracks: SceneTrack[], signal?: AbortSignal) {
    this.assertUsable();
    if (this.loaded || this.loading) {
      throw new SceneRuntimeError('RUNTIME_NOT_LOADED', 'Overlay runtime is already loaded');
    }

    this.loading = true;
    const controller = new AbortController();
    this.loadController = controller;
    const handleExternalAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', handleExternalAbort, { once: true });
    if (signal?.aborted) {
      handleExternalAbort();
    }

    try {
      const visibleTracks = tracks.filter((track) => track.visible);
      for (const track of visibleTracks) {
        switch (track.type) {
          case 'subtitle':
            for (const item of track.items) {
              this.createSubtitle(item);
            }
            break;
          case 'image':
            for (const item of track.items) {
              await this.createImage(item, controller.signal);
            }
            break;
          case 'video':
            for (const item of track.items) {
              await this.createVideo(item, controller.signal);
            }
            break;
          default:
            break;
        }
      }
      throwIfAborted(controller.signal);
      this.loaded = true;
    } catch (error) {
      this.cleanupContent();
      throw error;
    } finally {
      signal?.removeEventListener('abort', handleExternalAbort);
      if (this.loadController === controller) {
        this.loadController = undefined;
      }
      this.loading = false;
    }
  }

  async unlockMedia() {
    this.assertUsable();
    if (!this.loaded) {
      throw new SceneRuntimeError('RUNTIME_NOT_LOADED', 'Overlay runtime is not loaded');
    }
    if (this.mediaUnlocked) {
      return;
    }

    this.restoreActiveUnlock();
    const lifecycleGeneration = this.lifecycleGeneration;
    const unlockGeneration = ++this.unlockGeneration;

    const snapshots: MediaSnapshot[] = this.videos.map(({ element }) => ({
      video: element,
      muted: element.muted,
      volume: element.volume,
    }));
    this.activeUnlock = { generation: unlockGeneration, snapshots };
    const attempts = snapshots.map(({ video }) => {
      video.muted = true;
      try {
        return Promise.resolve(video.play());
      } catch (error) {
        return Promise.reject(error);
      }
    });

    try {
      await Promise.all(attempts);
    } catch (error) {
      this.restoreUnlockAttempt(unlockGeneration);
      this.assertCurrentUnlock(lifecycleGeneration, unlockGeneration);
      throw new SceneRuntimeError(
        'MEDIA_AUTOPLAY_BLOCKED',
        error instanceof Error ? error.message : 'Media autoplay was blocked',
        undefined,
        { cause: error },
      );
    }

    this.restoreUnlockAttempt(unlockGeneration);
    this.assertCurrentUnlock(lifecycleGeneration, unlockGeneration);
    this.mediaUnlocked = true;
  }

  apply(frame: RuntimeFrame) {
    if (this.disposed) {
      return;
    }
    if (!this.loaded) {
      throw new SceneRuntimeError('RUNTIME_NOT_LOADED', 'Overlay runtime is not loaded');
    }
    const timeMs = finiteTime(frame.timeMs);

    for (const overlay of this.subtitles) {
      overlay.element.style.display = isActive(overlay.item, timeMs) ? '' : 'none';
    }
    for (const overlay of this.images) {
      const active = isActive(overlay.item, timeMs);
      overlay.element.style.display = active ? '' : 'none';
      if (active) {
        overlay.element.style.opacity = String(overlayOpacity(overlay.item, timeMs));
      }
    }
    for (const overlay of this.videos) {
      this.applyVideo(overlay, frame, timeMs);
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.unlockGeneration += 1;
    this.restoreActiveUnlock();
    this.loadController?.abort(
      new SceneRuntimeError('RUNTIME_DISPOSED', 'Overlay runtime is disposed'),
    );
    this.loadController = undefined;
    this.cleanupContent();
    this.layer.remove();
  }

  private createSubtitle(item: SubtitleItem) {
    const element = document.createElement('div');
    element.dataset.runtimeKind = 'subtitle';
    element.dataset.position = item.params.position;
    element.textContent = item.params.text;
    Object.assign(element.style, {
      position: 'absolute',
      left: '50%',
      maxWidth: `${item.params.maxWidthPct}%`,
      transform: 'translateX(-50%)',
      zIndex: '1000',
      pointerEvents: 'none',
      display: 'none',
      ...(item.params.position === 'top' ? { top: '5%' } : { bottom: '5%' }),
    });
    this.layer.append(element);
    this.subtitles.push({ item, element });
  }

  private async createImage(item: ImageItem, signal: AbortSignal) {
    let asset: LoadedAsset | undefined;
    let image: HTMLImageElement | undefined;
    try {
      asset = await this.acquire(item.assetId, 'image', signal);
      throwIfAborted(signal);
      image = this.dependencies.createImage();
      image.dataset.runtimeKind = 'image';
      image.alt = '';
      image.src = asset.objectUrl;
      applyLayout(image, item.params.layout);
      image.style.display = 'none';
      this.layer.append(image);
      await abortable(Promise.resolve().then(() => image!.decode()), signal);
      this.images.push({ item, element: image, image });
    } catch (error) {
      image?.removeAttribute('src');
      image?.remove();
      if (asset) {
        this.releaseAcquired(item.assetId);
      }
      if (isAbortOrDispose(error, signal)) {
        throw error;
      }
      this.createImageFallback(item, error);
    }
  }

  private createImageFallback(item: ImageItem, error: unknown) {
    const fallback = document.createElement('div');
    fallback.dataset.runtimeKind = 'image-fallback';
    fallback.textContent = 'Image unavailable';
    applyLayout(fallback, item.params.layout);
    fallback.style.display = 'none';
    this.layer.append(fallback);
    this.images.push({ item, element: fallback });
    this.emitDiagnostic({
      code: 'IMAGE_ASSET_UNAVAILABLE',
      severity: 'warning',
      recoverable: true,
      eventUnitId: item.eventUnitId,
      assetId: item.assetId,
      message: error instanceof Error ? error.message : `Image unavailable: ${item.assetId}`,
    });
  }

  private async createVideo(item: VideoItem, signal: AbortSignal) {
    const asset = await this.acquire(item.assetId, 'video', signal);
    throwIfAborted(signal);
    if (asset.access.mediaType !== 'video/mp4') {
      throw new SceneRuntimeError(
        'ASSET_METADATA_INVALID',
        `Video metadata is invalid: ${item.assetId}`,
        item.assetId,
      );
    }

    const video = this.dependencies.createVideo();
    video.dataset.runtimeKind = 'video';
    video.preload = 'auto';
    video.playsInline = true;
    video.controls = false;
    video.src = asset.objectUrl;
    applyLayout(video, item.params.layout);
    video.style.display = 'none';
    this.layer.append(video);
    this.videos.push({
      item,
      element: video,
      access: asset.access,
      playbackGeneration: 0,
      expectsPlayback: false,
    });

    try {
      const metadata = waitForVideoMetadata(video, signal);
      video.load();
      await metadata;
    } catch (error) {
      if (isAbortOrDispose(error, signal)) {
        throw error;
      }
      const runtimeError = new SceneRuntimeError(
        'MEDIA_DECODE_FAILED',
        error instanceof Error ? error.message : `Video decode failed: ${item.assetId}`,
        item.assetId,
        { cause: error },
      );
      this.emitDiagnostic({
        code: 'MEDIA_DECODE_FAILED',
        severity: 'error',
        recoverable: false,
        eventUnitId: item.eventUnitId,
        assetId: item.assetId,
        message: runtimeError.message,
      });
      throw runtimeError;
    }
  }

  private applyVideo(overlay: VideoOverlay, frame: RuntimeFrame, timeMs: number) {
    const { item, element: video, access } = overlay;
    if (!isActive(item, timeMs)) {
      video.style.display = 'none';
      this.invalidatePlayback(overlay);
      video.pause();
      return;
    }

    video.style.display = '';
    video.style.opacity = String(item.params.layout.opacity);
    video.playbackRate = item.params.playbackRate;
    video.volume = item.params.volume;
    video.loop = item.params.loop;
    const targetSeconds = ((timeMs - item.startMs) / 1_000) * item.params.playbackRate;
    const durationSeconds = access.video.durationMs / 1_000;
    const bounded =
      item.params.loop && durationSeconds > 0
        ? targetSeconds % durationSeconds
        : Math.min(targetSeconds, durationSeconds);
    if (frame.forceMediaSeek || Math.abs(video.currentTime - bounded) > 0.08) {
      video.currentTime = bounded;
    }

    if (frame.playing && this.mediaUnlocked) {
      const playbackGeneration = ++overlay.playbackGeneration;
      const lifecycleGeneration = this.lifecycleGeneration;
      overlay.expectsPlayback = true;
      try {
        void Promise.resolve(video.play()).catch((error) =>
          this.handlePlaybackRejection(
            overlay,
            lifecycleGeneration,
            playbackGeneration,
            error,
          ),
        );
      } catch (error) {
        this.handlePlaybackRejection(
          overlay,
          lifecycleGeneration,
          playbackGeneration,
          error,
        );
      }
    } else {
      this.invalidatePlayback(overlay);
      video.pause();
    }
  }

  private handlePlaybackRejection(
    overlay: VideoOverlay,
    lifecycleGeneration: number,
    playbackGeneration: number,
    error: unknown,
  ) {
    if (
      isAbortError(error) ||
      this.disposed ||
      lifecycleGeneration !== this.lifecycleGeneration ||
      playbackGeneration !== overlay.playbackGeneration ||
      !overlay.expectsPlayback ||
      !this.mediaUnlocked
    ) {
      return;
    }
    this.reportPlaybackFailure(overlay, error);
  }

  private reportPlaybackFailure(overlay: VideoOverlay, error: unknown) {
    this.invalidatePlayback(overlay);
    overlay.element.pause();
    this.emitDiagnostic({
      code: 'VIDEO_PLAYBACK_FAILED',
      severity: 'error',
      recoverable: false,
      eventUnitId: overlay.item.eventUnitId,
      assetId: overlay.item.assetId,
      message: error instanceof Error ? error.message : 'Video playback failed',
    });
  }

  private async acquire(
    assetId: string,
    role: 'image' | 'video',
    signal: AbortSignal,
  ) {
    const asset = await this.resources.acquire(assetId, role, signal);
    this.acquiredAssetIds.push(assetId);
    return asset;
  }

  private releaseAcquired(assetId: string) {
    const index = this.acquiredAssetIds.lastIndexOf(assetId);
    if (index < 0) {
      return;
    }
    this.acquiredAssetIds.splice(index, 1);
    this.resources.release(assetId);
  }

  private cleanupContent() {
    for (const { element } of this.subtitles) {
      element.remove();
    }
    for (const { element, image } of this.images) {
      image?.removeAttribute('src');
      element.remove();
    }
    for (const overlay of this.videos) {
      const { element } = overlay;
      this.invalidatePlayback(overlay);
      element.pause();
      element.removeAttribute('src');
      element.load();
      element.remove();
    }
    this.subtitles.length = 0;
    this.images.length = 0;
    this.videos.length = 0;
    for (const assetId of this.acquiredAssetIds) {
      this.resources.release(assetId);
    }
    this.acquiredAssetIds.length = 0;
    this.loaded = false;
    this.mediaUnlocked = false;
  }

  private assertUsable() {
    if (this.disposed) {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Overlay runtime is disposed');
    }
  }

  private assertCurrentUnlock(lifecycleGeneration: number, unlockGeneration: number) {
    if (this.disposed || lifecycleGeneration !== this.lifecycleGeneration) {
      throw new SceneRuntimeError('RUNTIME_DISPOSED', 'Overlay runtime is disposed');
    }
    if (unlockGeneration !== this.unlockGeneration) {
      throw new DOMException('Media unlock attempt was superseded', 'AbortError');
    }
  }

  private restoreUnlockAttempt(unlockGeneration: number) {
    if (this.activeUnlock?.generation !== unlockGeneration) {
      return;
    }
    this.restoreActiveUnlock();
  }

  private restoreActiveUnlock() {
    if (!this.activeUnlock) {
      return;
    }
    const { snapshots } = this.activeUnlock;
    this.activeUnlock = undefined;
    restoreMedia(snapshots);
  }

  private invalidatePlayback(overlay: VideoOverlay) {
    overlay.playbackGeneration += 1;
    overlay.expectsPlayback = false;
  }
}

function applyLayout(element: HTMLElement, layout: OverlayLayout) {
  Object.assign(element.style, {
    position: 'absolute',
    left: `${layout.xPct}%`,
    top: `${layout.yPct}%`,
    width: `${layout.widthPct}%`,
    height: `${layout.heightPct}%`,
    zIndex: String(layout.zIndex),
    opacity: String(layout.opacity),
    objectFit: layout.fit,
    pointerEvents: 'none',
  });
}

function overlayOpacity(item: ImageItem, timeMs: number) {
  const endMs = item.startMs + item.durationMs;
  const enter =
    item.params.enter === 'fade' ? Math.min(1, (timeMs - item.startMs) / FADE_MS) : 1;
  const exit = item.params.exit === 'fade' ? Math.min(1, (endMs - timeMs) / FADE_MS) : 1;
  return item.params.layout.opacity * Math.max(0, Math.min(enter, exit));
}

function isActive(item: { startMs: number; durationMs: number }, timeMs: number) {
  return item.startMs <= timeMs && timeMs < item.startMs + item.durationMs;
}

function finiteTime(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function restoreMedia(snapshots: MediaSnapshot[]) {
  for (const { video, muted, volume } of snapshots) {
    video.pause();
    video.muted = muted;
    video.volume = volume;
  }
}

function waitForVideoMetadata(video: HTMLVideoElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleLoaded);
      video.removeEventListener('error', handleError);
      signal.removeEventListener('abort', handleAbort);
    };
    const finish = (callback: () => void) => {
      cleanup();
      callback();
    };
    const handleLoaded = () => finish(resolve);
    const handleError = () =>
      finish(() => reject(new Error(`Video metadata failed to load: ${video.currentSrc}`)));
    const handleAbort = () => finish(() => reject(abortReason(signal)));
    video.addEventListener('loadedmetadata', handleLoaded, { once: true });
    video.addEventListener('error', handleError, { once: true });
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) {
      handleAbort();
    }
  });
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => finish(() => reject(abortReason(signal)));
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    const finish = (callback: () => void) => {
      cleanup();
      callback();
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException('Overlay load aborted', 'AbortError');
}

function isAbortOrDispose(error: unknown, signal: AbortSignal) {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof SceneRuntimeError && error.code === 'RUNTIME_DISPOSED')
  );
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
