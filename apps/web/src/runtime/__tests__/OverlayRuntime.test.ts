import type {
  Diagnostic,
  OverlayLayout,
  ResolvedAssetAccess,
  SceneTrack,
} from '@ise/runtime-contracts';
import { expect, it, type Mock, vi } from 'vitest';
import { OverlayRuntime } from '../OverlayRuntime';
import type { LoadedAsset } from '../ResourceManager';

type SubtitleTrack = Extract<SceneTrack, { type: 'subtitle' }>;
type ImageTrack = Extract<SceneTrack, { type: 'image' }>;
type VideoTrack = Extract<SceneTrack, { type: 'video' }>;

const defaultLayout: OverlayLayout = {
  xPct: 5,
  yPct: 5,
  widthPct: 30,
  heightPct: 30,
  zIndex: 10,
  opacity: 1,
  fit: 'contain',
};
const evidenceRefs = ['fixture:evidence'];

function imageTrack(
  layout: OverlayLayout = defaultLayout,
  options: {
    startMs?: number;
    durationMs?: number;
    enter?: 'none' | 'fade';
    exit?: 'none' | 'fade';
    assetId?: `image:${string}`;
    itemId?: string;
  } = {},
): ImageTrack {
  return {
    trackId: `images-${options.itemId ?? 'image-item'}`,
    type: 'image',
    label: 'Images',
    visible: true,
    items: [
      {
        id: options.itemId ?? 'image-item',
        eventUnitId: 'event-1',
        startMs: options.startMs ?? 0,
        durationMs: options.durationMs ?? 1_000,
        assetId: options.assetId ?? 'image:cockpit-hud',
        evidenceRefs,
        params: {
          layout,
          enter: options.enter ?? 'none',
          exit: options.exit ?? 'none',
        },
      },
    ],
  };
}

function videoTrack(
  options: {
    startMs?: number;
    durationMs?: number;
    playbackRate?: number;
    volume?: number;
    loop?: boolean;
    layout?: OverlayLayout;
    assetId?: `video:${string}`;
    itemId?: string;
  } = {},
): VideoTrack {
  return {
    trackId: `videos-${options.itemId ?? 'video-item'}`,
    type: 'video',
    label: 'Videos',
    visible: true,
    items: [
      {
        id: options.itemId ?? 'video-item',
        eventUnitId: 'event-1',
        startMs: options.startMs ?? 0,
        durationMs: options.durationMs ?? 4_000,
        assetId: options.assetId ?? 'video:missile-impact',
        evidenceRefs,
        params: {
          layout: options.layout ?? defaultLayout,
          volume: options.volume ?? 0.5,
          playbackRate: options.playbackRate ?? 1,
          loop: options.loop ?? false,
        },
      },
    ],
  };
}

function subtitleTrack(
  position: 'top' | 'bottom',
  options: { startMs?: number; durationMs?: number; itemId?: string; text?: string } = {},
): SubtitleTrack {
  return {
    trackId: `subtitles-${position}`,
    type: 'subtitle',
    label: 'Subtitles',
    visible: true,
    items: [
      {
        id: options.itemId ?? `subtitle-${position}`,
        eventUnitId: 'event-1',
        startMs: options.startMs ?? 0,
        durationMs: options.durationMs ?? 1_000,
        evidenceRefs,
        params: {
          text: options.text ?? `${position} subtitle`,
          position,
          maxWidthPct: 60,
        },
      },
    ],
  };
}

type FakeVideo = HTMLVideoElement & {
  play: Mock<() => Promise<void>>;
  pause: Mock<() => void>;
  load: Mock<() => void>;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushPromiseReactions() {
  await Promise.resolve();
  await Promise.resolve();
}

function playbackFailureDiagnostics(diagnostics: Diagnostic[]) {
  return diagnostics.filter((diagnostic) => diagnostic.code === 'VIDEO_PLAYBACK_FAILED');
}

function overlayHarness(
  options: {
    failImageAssetIds?: string[];
    rejectImageDecode?: boolean;
    videoMetadata?: 'loaded' | 'error' | 'pending';
    createPlay?: (index: number) => ReturnType<typeof vi.fn>;
  } = {},
) {
  const root = document.createElement('div');
  const unrelated = document.createElement('div');
  unrelated.dataset.owner = 'page';
  root.append(unrelated);
  const diagnostics: Diagnostic[] = [];
  const images: HTMLImageElement[] = [];
  const videos: FakeVideo[] = [];
  const failImageAssetIds = new Set(options.failImageAssetIds ?? []);
  const imageAccess = (assetId: string): ResolvedAssetAccess => ({
    assetId: assetId as `image:${string}`,
    url: 'https://signed/image',
    fingerprint: `sha256:${'c'.repeat(64)}`,
    mediaType: 'image/png',
    size: 100,
    expiresAt: '2099-01-01T00:00:00.000Z',
    image: { width: 1_280, height: 720, fit: 'contain' },
  });
  const videoAccess = (assetId: string): ResolvedAssetAccess => ({
    assetId: assetId as `video:${string}`,
    url: 'https://signed/video',
    fingerprint: `sha256:${'d'.repeat(64)}`,
    mediaType: 'video/mp4',
    size: 100,
    expiresAt: '2099-01-01T00:00:00.000Z',
    video: { durationMs: 4_000, codec: 'h264' },
  });
  const resources = {
    acquire: vi.fn(async (assetId: string) => {
      if (failImageAssetIds.has(assetId)) {
        throw new Error(`missing ${assetId}`);
      }
      return {
        access: assetId.startsWith('image:') ? imageAccess(assetId) : videoAccess(assetId),
        objectUrl: assetId.startsWith('image:') ? `blob:${assetId}` : `blob:${assetId}`,
      } as LoadedAsset;
    }),
    release: vi.fn(),
  };
  const runtime = new OverlayRuntime(
    root,
    resources as never,
    (diagnostic) => diagnostics.push(diagnostic),
    {
      createImage: () => {
        const image = document.createElement('img');
        Object.defineProperty(image, 'decode', {
          configurable: true,
          value: options.rejectImageDecode
            ? vi.fn(async () => {
                throw new DOMException('decode failed', 'EncodingError');
              })
            : vi.fn(async () => undefined),
        });
        images.push(image);
        return image;
      },
      createVideo: () => {
        const video = document.createElement('video') as FakeVideo;
        const index = videos.length;
        Object.defineProperties(video, {
          play: {
            configurable: true,
            value: options.createPlay?.(index) ?? vi.fn(async () => undefined),
          },
          pause: { configurable: true, value: vi.fn() },
          load: {
            configurable: true,
            value: vi.fn(() => {
              if (options.videoMetadata === 'pending') {
                return;
              }
              queueMicrotask(() =>
                video.dispatchEvent(
                  new Event(options.videoMetadata === 'error' ? 'error' : 'loadedmetadata'),
                ),
              );
            }),
          },
        });
        videos.push(video);
        return video;
      },
    },
  );
  return { root, unrelated, images, videos, resources, diagnostics, runtime };
}

it('uses independent percentage layouts and stable z-index for image and video overlays', async () => {
  const imageLayout: OverlayLayout = {
    xPct: 10,
    yPct: 20,
    widthPct: 30,
    heightPct: 40,
    zIndex: 7,
    opacity: 0.8,
    fit: 'cover',
  };
  const videoLayout: OverlayLayout = {
    xPct: 55,
    yPct: 10,
    widthPct: 35,
    heightPct: 25,
    zIndex: 12,
    opacity: 0.6,
    fit: 'contain',
  };
  const { root, runtime } = overlayHarness();
  await runtime.load([imageTrack(imageLayout), videoTrack({ layout: videoLayout })]);

  runtime.apply({ timeMs: 500, playing: false, forceMediaSeek: true });
  const image = root.querySelector('[data-runtime-kind="image"]') as HTMLImageElement;
  const video = root.querySelector('[data-runtime-kind="video"]') as HTMLVideoElement;

  expect(image.style.cssText).toContain('left: 10%');
  expect(image.style.cssText).toContain('top: 20%');
  expect(image.style.cssText).toContain('width: 30%');
  expect(image.style.cssText).toContain('object-fit: cover');
  expect(image.style.zIndex).toBe('7');
  expect(video.style.cssText).toContain('left: 55%');
  expect(video.style.cssText).toContain('top: 10%');
  expect(video.style.cssText).toContain('width: 35%');
  expect(video.style.zIndex).toBe('12');
});

it('positions top and bottom subtitles and uses half-open active intervals', async () => {
  const { root, runtime } = overlayHarness();
  await runtime.load([subtitleTrack('top'), subtitleTrack('bottom')]);

  runtime.apply({ timeMs: 0, playing: false, forceMediaSeek: true });
  const top = root.querySelector('[data-runtime-kind="subtitle"][data-position="top"]') as HTMLElement;
  const bottom = root.querySelector(
    '[data-runtime-kind="subtitle"][data-position="bottom"]',
  ) as HTMLElement;
  expect(top.style.display).not.toBe('none');
  expect(top.style.top).toBe('5%');
  expect(top.style.maxWidth).toBe('min(60%, calc(100% - 32px))');
  expect(bottom.style.bottom).toBe('5%');
  expect(bottom.style.width).toBe('max-content');
  expect(bottom.style.maxWidth).toBe('min(60%, calc(100% - 32px))');
  expect(bottom.style.boxSizing).toBe('border-box');
  expect(bottom.style.padding).toBe('10px 16px');
  expect(bottom.style.color).toBe('rgb(17, 24, 39)');
  expect(bottom.style.backgroundColor).toBe('rgba(255, 255, 255, 0.84)');
  expect(bottom.style.backdropFilter).toBe('blur(12px) saturate(140%)');
  expect(
    (bottom.style as CSSStyleDeclaration & { webkitBackdropFilter: string })
      .webkitBackdropFilter,
  ).toBe('blur(12px) saturate(140%)');
  expect(bottom.style.borderRadius).toBe('8px');
  expect(bottom.style.border).toBe('1px solid rgba(255, 255, 255, 0.6)');
  expect(bottom.style.boxShadow).toBe('0 4px 16px rgba(15, 23, 42, 0.12)');
  expect(bottom.style.textAlign).toBe('center');
  expect(bottom.style.fontSize).toBe('16px');
  expect(bottom.style.fontWeight).toBe('500');
  expect(bottom.style.lineHeight).toBe('1.6');
  expect(bottom.style.whiteSpace).toBe('pre-wrap');
  expect(bottom.style.overflowWrap).toBe('anywhere');
  expect(bottom.style.letterSpacing).toBe('0px');

  runtime.apply({ timeMs: 1_000, playing: false, forceMediaSeek: true });
  expect(top.style.display).toBe('none');
  expect(bottom.style.display).toBe('none');
});

it('computes deterministic 300 ms fade endpoints from the exact playhead', async () => {
  const layout = { ...defaultLayout, opacity: 0.8 };
  const { root, runtime } = overlayHarness();
  await runtime.load([
    imageTrack(layout, {
      startMs: 1_000,
      durationMs: 1_000,
      enter: 'fade',
      exit: 'fade',
    }),
  ]);
  const image = root.querySelector('[data-runtime-kind="image"]') as HTMLElement;

  runtime.apply({ timeMs: 1_000, playing: false, forceMediaSeek: true });
  expect(image.style.opacity).toBe('0');
  runtime.apply({ timeMs: 1_150, playing: false, forceMediaSeek: true });
  expect(image.style.opacity).toBe('0.4');
  runtime.apply({ timeMs: 1_300, playing: false, forceMediaSeek: true });
  expect(image.style.opacity).toBe('0.8');
  runtime.apply({ timeMs: 1_700, playing: false, forceMediaSeek: true });
  expect(image.style.opacity).toBe('0.8');
  runtime.apply({ timeMs: 1_850, playing: false, forceMediaSeek: true });
  expect(image.style.opacity).toBe('0.4');
  runtime.apply({ timeMs: 2_000, playing: false, forceMediaSeek: true });
  expect(image.style.display).toBe('none');
});

it('sets video time, playbackRate, volume, and loop from the paused seek frame', async () => {
  const { videos, runtime } = overlayHarness();
  await runtime.load([
    videoTrack({
      startMs: 2_000,
      durationMs: 8_000,
      playbackRate: 1.5,
      volume: 0.25,
      loop: true,
    }),
  ]);
  const video = videos[0]!;

  runtime.apply({ timeMs: 3_000, playing: false, forceMediaSeek: true });
  expect(video.currentTime).toBe(1.5);
  expect(video.playbackRate).toBe(1.5);
  expect(video.volume).toBe(0.25);
  expect(video.loop).toBe(true);
  expect(video.pause).toHaveBeenCalled();

  runtime.apply({ timeMs: 6_000, playing: false, forceMediaSeek: true });
  expect(video.currentTime).toBe(2);
});

it('pauses video at the half-open end boundary', async () => {
  const { videos, runtime } = overlayHarness();
  await runtime.load([videoTrack({ startMs: 1_000, durationMs: 1_000 })]);
  const video = videos[0]!;

  runtime.apply({ timeMs: 2_000, playing: true, forceMediaSeek: false });

  expect(video.style.display).toBe('none');
  expect(video.pause).toHaveBeenCalled();
});

it('calls play synchronously on every video during the first media unlock', async () => {
  const resolvers: Array<() => void> = [];
  const { videos, runtime } = overlayHarness({
    createPlay: () =>
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
  });
  await runtime.load([
    videoTrack({ itemId: 'video-one' }),
    videoTrack({ itemId: 'video-two', assetId: 'video:second' }),
  ]);
  videos[0]!.muted = false;
  videos[0]!.volume = 0.4;
  videos[1]!.muted = true;
  videos[1]!.volume = 0.7;

  const unlocking = runtime.unlockMedia();

  expect(videos[0]!.play).toHaveBeenCalledTimes(1);
  expect(videos[1]!.play).toHaveBeenCalledTimes(1);
  expect(videos.every((video) => video.muted)).toBe(true);
  resolvers.forEach((resolve) => resolve());
  await unlocking;
  expect(videos[0]!.pause).toHaveBeenCalled();
  expect(videos[1]!.pause).toHaveBeenCalled();
  expect(videos[0]!.muted).toBe(false);
  expect(videos[0]!.volume).toBe(0.4);
  expect(videos[1]!.muted).toBe(true);
  expect(videos[1]!.volume).toBe(0.7);

  await runtime.unlockMedia();
  expect(videos[0]!.play).toHaveBeenCalledTimes(1);
  expect(videos[1]!.play).toHaveBeenCalledTimes(1);
});

it('rejects a pending media unlock as RUNTIME_DISPOSED when disposed before play settles', async () => {
  const gate = deferred<void>();
  const { diagnostics, runtime } = overlayHarness({
    createPlay: () => vi.fn(() => gate.promise),
  });
  await runtime.load([videoTrack()]);

  const unlocking = runtime.unlockMedia();
  runtime.dispose();
  gate.resolve();

  await expect(unlocking).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
  expect(diagnostics).toEqual([]);
});

it('lets a newer media unlock own restoration and invalidates the older attempt', async () => {
  const firstGate = deferred<void>();
  const secondGate = deferred<void>();
  const play = vi
    .fn<() => Promise<void>>()
    .mockImplementationOnce(() => firstGate.promise)
    .mockImplementationOnce(() => secondGate.promise);
  const { diagnostics, videos, runtime } = overlayHarness({ createPlay: () => play });
  await runtime.load([videoTrack()]);
  videos[0]!.muted = false;
  videos[0]!.volume = 0.4;

  const firstUnlock = runtime.unlockMedia();
  const secondUnlock = runtime.unlockMedia();
  secondGate.resolve();
  await secondUnlock;

  expect(videos[0]!.muted).toBe(false);
  expect(videos[0]!.volume).toBe(0.4);
  firstGate.reject(new Error('superseded unlock failed late'));
  await expect(firstUnlock).rejects.toMatchObject({ name: 'AbortError' });
  expect(videos[0]!.muted).toBe(false);
  expect(videos[0]!.volume).toBe(0.4);
  expect(diagnostics).toEqual([]);
});

it('rejects media unlock when autoplay is blocked and pauses every video', async () => {
  const { videos, runtime } = overlayHarness({
    createPlay: (index) =>
      index === 0
        ? vi.fn(async () => {
            throw new DOMException('blocked', 'NotAllowedError');
          })
        : vi.fn(async () => undefined),
  });
  await runtime.load([
    videoTrack({ itemId: 'video-one' }),
    videoTrack({ itemId: 'video-two', assetId: 'video:second' }),
  ]);

  await expect(runtime.unlockMedia()).rejects.toMatchObject({
    code: 'MEDIA_AUTOPLAY_BLOCKED',
  });
  expect(videos[0]!.play).toHaveBeenCalledTimes(1);
  expect(videos[1]!.play).toHaveBeenCalledTimes(1);
  expect(videos[0]!.pause).toHaveBeenCalled();
  expect(videos[1]!.pause).toHaveBeenCalled();
});

it('reports asynchronous video playback failure after a successful unlock', async () => {
  const play = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('decoder stopped'));
  const { diagnostics, runtime } = overlayHarness({ createPlay: () => play });
  await runtime.load([videoTrack()]);
  await runtime.unlockMedia();

  runtime.apply({ timeMs: 500, playing: true, forceMediaSeek: false });
  await Promise.resolve();

  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'VIDEO_PLAYBACK_FAILED',
      severity: 'error',
      recoverable: false,
      assetId: 'video:missile-impact',
    }),
  );
});

it('ignores a late playback rejection after the clock pauses the active video', async () => {
  const gate = deferred<void>();
  const play = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => gate.promise);
  const { diagnostics, runtime } = overlayHarness({ createPlay: () => play });
  await runtime.load([videoTrack()]);
  await runtime.unlockMedia();
  runtime.apply({ timeMs: 500, playing: true, forceMediaSeek: false });

  runtime.apply({ timeMs: 500, playing: false, forceMediaSeek: false });
  gate.reject(new Error('late rejection after pause'));
  await flushPromiseReactions();

  expect(playbackFailureDiagnostics(diagnostics)).toEqual([]);
});

it('ignores a late playback rejection after a seek makes the video inactive', async () => {
  const gate = deferred<void>();
  const play = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => gate.promise);
  const { diagnostics, runtime } = overlayHarness({ createPlay: () => play });
  await runtime.load([videoTrack({ durationMs: 1_000 })]);
  await runtime.unlockMedia();
  runtime.apply({ timeMs: 500, playing: true, forceMediaSeek: false });

  runtime.apply({ timeMs: 1_000, playing: true, forceMediaSeek: true });
  gate.reject(new Error('late rejection after inactive seek'));
  await flushPromiseReactions();

  expect(playbackFailureDiagnostics(diagnostics)).toEqual([]);
});

it('ignores a late playback rejection after the runtime is disposed', async () => {
  const gate = deferred<void>();
  const play = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => gate.promise);
  const { diagnostics, runtime } = overlayHarness({ createPlay: () => play });
  await runtime.load([videoTrack()]);
  await runtime.unlockMedia();
  runtime.apply({ timeMs: 500, playing: true, forceMediaSeek: false });

  runtime.dispose();
  gate.reject(new Error('late rejection after dispose'));
  await flushPromiseReactions();

  expect(playbackFailureDiagnostics(diagnostics)).toEqual([]);
});

it('ignores a late rejection from a playback attempt superseded by a newer attempt', async () => {
  const gate = deferred<void>();
  const play = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => gate.promise)
    .mockResolvedValueOnce(undefined);
  const { diagnostics, runtime } = overlayHarness({ createPlay: () => play });
  await runtime.load([videoTrack()]);
  await runtime.unlockMedia();
  runtime.apply({ timeMs: 500, playing: true, forceMediaSeek: false });

  runtime.apply({ timeMs: 550, playing: true, forceMediaSeek: false });
  gate.reject(new Error('late rejection from superseded play'));
  await flushPromiseReactions();

  expect(playbackFailureDiagnostics(diagnostics)).toEqual([]);
});

it('degrades an unavailable image to a layout-preserving information card', async () => {
  const { root, resources, diagnostics, runtime } = overlayHarness({
    failImageAssetIds: ['image:cockpit-hud'],
  });
  await runtime.load([imageTrack()]);

  runtime.apply({ timeMs: 500, playing: false, forceMediaSeek: true });
  const fallback = root.querySelector('[data-runtime-kind="image-fallback"]') as HTMLElement;
  expect(fallback).toHaveTextContent('Image unavailable');
  expect(fallback.style.left).toBe('5%');
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'IMAGE_ASSET_UNAVAILABLE',
      severity: 'warning',
      recoverable: true,
      assetId: 'image:cockpit-hud',
    }),
  );
  runtime.dispose();
  expect(resources.release).not.toHaveBeenCalledWith('image:cockpit-hud');
});

it('falls back after image decode failure and releases the acquired image once', async () => {
  const { root, resources, runtime } = overlayHarness({ rejectImageDecode: true });
  await runtime.load([imageTrack()]);

  expect(root.querySelector('[data-runtime-kind="image-fallback"]')).toHaveTextContent(
    'Image unavailable',
  );
  expect(resources.release.mock.calls).toEqual([['image:cockpit-hud']]);
  runtime.dispose();
  expect(resources.release.mock.calls).toEqual([['image:cockpit-hud']]);
});

it('rejects video decode failure and rolls back every successful acquisition', async () => {
  const { root, resources, diagnostics, runtime } = overlayHarness({ videoMetadata: 'error' });

  await expect(runtime.load([imageTrack(), videoTrack()])).rejects.toMatchObject({
    code: 'MEDIA_DECODE_FAILED',
  });

  expect(resources.release.mock.calls).toEqual([
    ['image:cockpit-hud'],
    ['video:missile-impact'],
  ]);
  expect(root.querySelector('[data-runtime-kind]')).toBeNull();
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'MEDIA_DECODE_FAILED',
      severity: 'error',
      recoverable: false,
      assetId: 'video:missile-impact',
    }),
  );
});

it('disposes nodes, media decoders, and acquired resources without revoking manager URLs', async () => {
  const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL');
  const { root, unrelated, images, videos, resources, runtime } = overlayHarness();
  await runtime.load([imageTrack(), videoTrack()]);
  const videoInitialLoadCalls = videos[0]!.load.mock.calls.length;

  runtime.dispose();
  runtime.dispose();

  expect(root.querySelector('[data-ise-runtime-overlay]')).toBeNull();
  expect(root.contains(unrelated)).toBe(true);
  expect(images[0]!.hasAttribute('src')).toBe(false);
  expect(videos[0]!.hasAttribute('src')).toBe(false);
  expect(videos[0]!.pause).toHaveBeenCalled();
  expect(videos[0]!.load).toHaveBeenCalledTimes(videoInitialLoadCalls + 1);
  expect(resources.release.mock.calls).toEqual([
    ['image:cockpit-hud'],
    ['video:missile-impact'],
  ]);
  expect(revokeObjectUrl).not.toHaveBeenCalled();
  revokeObjectUrl.mockRestore();
});
