# ISE Scene Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React-independent, deterministic SceneRuntime that plays validated `SceneProjectConfig` map, GLB trajectory, subtitle, image, and video tracks through one requestAnimationFrame clock and passes real WebGL canvas acceptance tests.

**Architecture:** `SceneRuntimeImpl` owns one `PlaybackClock` and coordinates resource, map, model, and overlay runtimes with a single synchronous frame application path. `ResourceManager` resolves stable asset IDs into short-lived access records and in-memory object URLs; `MapRuntime`, `ModelRuntime`, and `OverlayRuntime` consume only preloaded resources, so pause, seek, and replay recompute state without track-local timers.

**Tech Stack:** TypeScript 5.9, Mapbox GL JS 3.18, Three.js 0.185.1, GLTFLoader, Vitest 4 with jsdom, Playwright 1.61.1, `@ise/runtime-contracts`

## Global Constraints

- Run on Node.js `>=20.19.0`.
- The Wave 1 Foundation baseline must already contain `apps/web`, `@ise/runtime-contracts`, `three@0.185.1`, `@types/three@0.185.1`, `@playwright/test@1.61.1`, and the root lockfile changes. It does not contain Playwright `webServer` or `/runtime-harness`; the parallel Web/API workstream owns those files. This runtime workstream does not modify a package manifest, lockfile, page, route, store, NestJS service, Agent service, or shared contract.
- Tasks 1 through 8 are Wave 1 and run only unit/typecheck commands available on the Foundation baseline. Task 9 is a Wave 2 integration task: start it only after the Web/API workstream with `apps/web/playwright.config.ts` and `/runtime-harness` has merged into the integration branch. Never run a harness-dependent command in the isolated Wave 1 runtime worktree.
- File ownership is limited to `apps/web/src/runtime/**` and `apps/web/e2e/runtime-rendering.spec.ts`.
- Consume `SceneProjectConfig`, `SceneTrack`, `SceneTrackItem`, `SceneEntity`, `Diagnostic`, and `ResolvedAssetAccess` from `@ise/runtime-contracts`; do not duplicate or weaken their schemas.
- `SceneTrack` is the `type`-discriminated union with common fields `{ trackId, type, label, visible, items }`; supported types are exactly `subtitle`, `image`, `video`, `marker`, `geojson`, `camera`, and `model`.
- Model action literals are exactly `model.spawn`, `model.follow_path`, `model.set_state`, and `model.hide`. Unknown actions fail before runtime execution through shared schema validation.
- `ResolvedAssetAccess` is `{ assetId, url, fingerprint, mediaType, size, expiresAt, model?, trajectory?, video?, image? }`. It remains in memory only; signed URLs and `expiresAt` are never copied into scene configuration or browser persistence.
- Model metadata is exactly `{ scale:number, rotationOffsetDeg:[number,number,number], altitudeOffsetM:number, entityTypes:('aircraft'|'missile'|'other')[] }`. Missing model metadata, incompatible entity kind, missing trajectory metadata, missing GLB, missing trajectory, and video load/decode failure make `load()` reject.
- Trajectory metadata is exactly `{ format:'ise-trajectory/v1', timeUnit:'ms', coordinateOrder:'lng-lat-alt', startTimeMs, endTimeMs, monotonic:true }`; content is `{ schemaVersion:'ise-trajectory/v1', points:[{ timeMs, longitude, latitude, altitudeM }] }`. The browser never parses source datetime strings.
- Seed normalization must distribute duplicate source timestamps before runtime. Runtime rejects any v1 trajectory whose `timeMs` values are not strictly increasing, whose metadata bounds do not match the document, or whose coordinates are out of range.
- `PlaybackClock` is the only business-time source and uses `requestAnimationFrame`. No runtime track may call `setTimeout`, `setInterval`, `map.easeTo`, Threebox `followPath()`, or create a second playback RAF loop.
- Import Three.js and `GLTFLoader` from the npm package. Do not import `public/plot_utils/three.js` revision 110, `public/plot_utils/threebox-plugin`, the old timer stores, or the broken legacy `modelManager` hooks.
- Each GLB is parsed once per fingerprint, each entity is a cloned Three.js scene, and model scale/orientation/altitude always come from `ResolvedAssetAccess.model`; there are no calibration defaults.
- Video time is derived from the playhead as `(playheadMs - startMs) / 1000 * playbackRate`. Images and videos use the same percentage-based `OverlayLayout`; a 300 ms deterministic fade multiplier implements `enter:'fade'` and `exit:'fade'`.
- A call to `play()` from the page's user gesture performs the first media unlock. Autoplay rejection leaves the clock paused and rejects `play()`.
- Active intervals are start-inclusive and end-exclusive: `startMs <= timeMs && timeMs < startMs + durationMs`. `geojson.params.keepAfterEnd` persists a layer only after its start.
- `seek()` pauses the clock, applies map/model/trail/overlay/camera/video state at the exact clamped target, and resumes only when playback was active before the seek. `replay()` always performs a non-resuming seek to zero followed by `play()`.
- `dispose()` aborts in-flight loads and releases custom layers, Mapbox layers/sources/markers, Three.js GPU objects, media nodes, object URLs, RAF handles, and event listeners. It must not call `forceContextLoss()` on Mapbox's shared WebGL context.
- Large MP4, GLB, and trajectory files are not added to Git. Real acceptance resolves only stable registered asset IDs.
- The real asset catalog IDs are fixed: models `model:j10`, `model:jf17`, `model:mig29`, `model:pl15e`, `model:rafale`, `model:su30mki`; videos `video:ooda-chain`, `video:runway-exit`, `video:missile-impact`, `video:cockpit-jamming`, `video:damage-check`, `video:bomb-explosion`, `video:radar-offline`, `video:target-lock`; images `image:ground-radar`, `image:cockpit-hud`, `image:airport`, `image:aew-illustration`; primary trajectories `trajectory:ambala-rafale-1`, `trajectory:minhas-j10ce-1`, and `trajectory:pakistan-missile-1`.
- After the Wave 2 merge, Playwright uses the real `/runtime-harness?fixture=runtime-main|runtime-catalog` and the fixed selectors `[data-testid=runtime-map]`, `[data-testid=runtime-overlay]`, `[data-testid=runtime-play]`, `[data-testid=runtime-pause]`, `[data-testid=runtime-seek]`, `[data-testid=runtime-replay]`, `[data-testid=runtime-time]`, and `[data-testid=runtime-status]`. Missing Mapbox credentials, WebGL, or seeded assets fails acceptance; tests are not skipped and do not substitute a mocked canvas.

### Frozen Shared Inputs

These are read-only references to the shared package, not types to recreate in `apps/web`. Derive track/item aliases from exported discriminated unions; the shared package does not export a separate `TrackType` symbol:

```ts
import type {
  NormalizedTrajectory, OverlayLayout, ResolvedAssetAccess, SceneEntity,
  SceneProjectConfig, SceneTrack, SceneTrackItem
} from '@ise/runtime-contracts';

type TrackType = SceneTrack['type'];
type TrackOf<T extends TrackType> = Extract<SceneTrack, { type: T }>;
type TrackItemOf<T extends TrackType> = TrackOf<T>['items'][number];
type SubtitleParams = { text: string; position: 'top' | 'bottom'; maxWidthPct: number };
type ImageParams = { layout: OverlayLayout; enter: 'none' | 'fade'; exit: 'none' | 'fade' };
type VideoParams = { layout: OverlayLayout; volume: number; playbackRate: number; loop: boolean };
type MarkerParams = { coordinates: [number, number]; label: string; color: string };
type GeojsonParams = {
  lineColor: string; lineWidth: number; fillColor: string; fillOpacity: number;
  circleColor: string; circleRadius: number; keepAfterEnd: boolean;
};
type CameraParams = {
  center: [number, number]; zoom: number; pitch: number; bearing: number;
  easing: 'linear' | 'easeInOut';
};
type ModelParams =
  | { action: 'model.spawn'; entityId: string }
  | { action: 'model.follow_path'; entityId: string; trajectoryAssetId: string }
  | { action: 'model.set_state'; entityId: string; state: 'normal' | 'warning' | 'disabled' | 'hidden' }
  | { action: 'model.hide'; entityId: string };

type TrajectoryMetadata = NonNullable<ResolvedAssetAccess['trajectory']>;
```

---

## Reviewed Baseline

- `intelligents_sceneditor_front/src/pages/Scene/components/SceneCanvas.tsx` creates a Mapbox map and stores it globally, but has no overlay root or runtime lifecycle.
- `intelligents_sceneditor_front/src/pages/Scene/components/Timeline.tsx` imports four built-in mock scenes and renders play/stop buttons without handlers. `Scene/index.tsx` converts UI clips into another transient store format and the seek effect does not execute playback.
- `intelligents_sceneditor_front/src/stores/taskSceneStore.ts` holds separate timer lists for every track family. The three legacy playback hooks use 100 ms intervals, per-item timeouts, camera RAF loops, and a missing `modelManager`; they are reference material only.
- The old video jump path sets `currentTime` without `playbackRate`, and the model path calls Threebox `followPath()`. Neither behavior is migrated.
- `public/plot_utils` contains Three.js revision 110, global-script GLTFLoader, and Threebox bundles. The runtime uses modern ESM package imports instead.
- All six local GLBs have valid `glTF` version 2 headers and declared lengths equal to file lengths. The raw source trajectory folder contains repeated second-resolution timestamps and one decreasing timestamp in `AMBALA Su-30MKI-1.json`; seed conversion must repair duplicates deterministically and reject/rebuild the decreasing source before catalog acceptance.
- Eight MP4 files exist, but `ffprobe` is unavailable in this workspace. Seed registration must provide browser-compatible codec/duration metadata; `runtime-catalog` verifies actual browser decoding.

## File Map

- `apps/web/src/runtime/types.ts` owns runtime-only ports, frame state, public `SceneRuntime` and factory option types.
- `apps/web/src/runtime/errors.ts` owns stable runtime error codes and `SceneRuntimeError`.
- `apps/web/src/runtime/PlaybackClock.ts` owns the sole business clock.
- `apps/web/src/runtime/glb.ts` validates GLB headers and disposes parsed templates.
- `apps/web/src/runtime/ResourceManager.ts` resolves, refreshes, fetches, caches, reference-counts, and releases assets.
- `apps/web/src/runtime/trajectory.ts` validates normalized trajectory documents and performs binary-search interpolation, heading, and pitch calculations.
- `apps/web/src/runtime/MapRuntime.ts` owns markers, GeoJSON layers, dynamic trajectory trails, deterministic camera frames, style reload, and cleanup.
- `apps/web/src/runtime/ModelRuntime.ts` owns the Mapbox custom layer, Three.js renderer, GLTF clones, action reduction, transforms, visual states, and GPU cleanup.
- `apps/web/src/runtime/OverlayRuntime.ts` owns subtitle/image/video DOM, layout, media unlock, playhead correction, fallback image cards, and cleanup.
- `apps/web/src/runtime/SceneRuntime.ts` owns load/play/pause/seek/replay/dispose orchestration.
- `apps/web/src/runtime/index.ts` is the only public runtime entry point.
- `apps/web/src/runtime/testing/runtimeFixtures.ts` provides validated `runtime-main` and `runtime-catalog` configurations without asset URLs.
- `apps/web/src/runtime/__tests__/*.test.ts` provides focused Vitest coverage; `apps/web/src/runtime/__tests__/helpers/fakes.ts` provides typed clock, Mapbox, media, and resource fakes.
- `apps/web/e2e/runtime-rendering.spec.ts` performs desktop/mobile real-asset rendering and canvas-pixel acceptance.

### Task 1: Runtime Ports, Errors, and PlaybackClock

**Files:**
- Create: `apps/web/src/runtime/types.ts`
- Create: `apps/web/src/runtime/errors.ts`
- Create: `apps/web/src/runtime/PlaybackClock.ts`
- Create: `apps/web/src/runtime/__tests__/helpers/fakes.ts`
- Create: `apps/web/src/runtime/__tests__/PlaybackClock.test.ts`

**Interfaces:**
- Consumes: `SceneProjectConfig` and `ResolvedAssetAccess` from `@ise/runtime-contracts`; browser `requestAnimationFrame` and `performance.now()`.
- Produces: `SceneRuntime`, `SceneRuntimeOptions`, `RuntimeFrame`, `RuntimeDiagnosticSink`, `FrameScheduler`, `PlaybackClockPort`, `SceneRuntimeError`, and `PlaybackClock`.

- [ ] **Step 1: Write the failing public-type and clock tests**

```ts
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ResolvedAssetAccess } from '@ise/runtime-contracts';
import { PlaybackClock } from '../PlaybackClock';
import type { SceneRuntime, SceneRuntimeOptions } from '../types';
import { FakeFrameScheduler } from './helpers/fakes';

describe('PlaybackClock', () => {
  it('uses one RAF and derives elapsed business time from its timestamp', () => {
    const scheduler = new FakeFrameScheduler();
    const frames: number[] = [];
    const clock = new PlaybackClock(scheduler);
    clock.setDuration(1_000);
    clock.subscribe((frame) => frames.push(frame.timeMs));

    clock.play();
    clock.play();
    expect(scheduler.pendingCount).toBe(1);
    scheduler.advanceTo(250);
    scheduler.advanceTo(700);

    expect(frames).toEqual([250, 700]);
    expect(clock.currentTimeMs).toBe(700);
  });

  it('clamps seek, freezes pause, stops at duration, and cancels on dispose', () => {
    const scheduler = new FakeFrameScheduler();
    const clock = new PlaybackClock(scheduler);
    clock.setDuration(500);
    clock.seek(900);
    expect(clock.currentTimeMs).toBe(500);
    clock.seek(100);
    clock.play();
    scheduler.advanceTo(250);
    clock.pause();
    expect(clock.currentTimeMs).toBe(350);
    scheduler.advanceTo(400);
    expect(clock.currentTimeMs).toBe(350);
    clock.play();
    scheduler.advanceTo(700);
    expect(clock.currentTimeMs).toBe(500);
    expect(clock.isPlaying).toBe(false);
    clock.dispose();
    expect(scheduler.pendingCount).toBe(0);
  });
});

it('freezes the Web integration signature', () => {
  expectTypeOf<SceneRuntimeOptions['resolveAsset']>().toEqualTypeOf<
    (assetId: string, signal?: AbortSignal) => Promise<ResolvedAssetAccess>
  >();
  expectTypeOf<SceneRuntime>().toMatchTypeOf<{
    load(config: import('@ise/runtime-contracts').SceneProjectConfig): Promise<void>;
    play(): Promise<void>;
    pause(): void;
    seek(timeMs: number): Promise<void>;
    replay(): Promise<void>;
    dispose(): void;
  }>();
});
```

Add this deterministic scheduler to `helpers/fakes.ts`:

```ts
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
  get pendingCount() { return this.callbacks.size; }
  advanceTo(nowMs: number) {
    this.nowMs = nowMs;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback(nowMs));
  }
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/PlaybackClock.test.ts`

Expected: FAIL with module resolution errors for `../PlaybackClock` and `../types`.

- [ ] **Step 3: Implement the stable ports and clock**

Put these public ports in `types.ts`:

```ts
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
```

Put stable codes in `errors.ts`:

```ts
export type SceneRuntimeErrorCode =
  | 'RUNTIME_DISPOSED'
  | 'RUNTIME_NOT_LOADED'
  | 'ASSET_ACCESS_EXPIRED'
  | 'ASSET_FETCH_FAILED'
  | 'ASSET_METADATA_INVALID'
  | 'GLB_INVALID'
  | 'TRAJECTORY_INVALID'
  | 'GEOJSON_INVALID'
  | 'MODEL_COMMAND_INVALID'
  | 'MEDIA_AUTOPLAY_BLOCKED'
  | 'MEDIA_DECODE_FAILED';

export class SceneRuntimeError extends Error {
  constructor(
    readonly code: SceneRuntimeErrorCode,
    message: string,
    readonly assetId?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SceneRuntimeError';
  }
}
```

Implement `PlaybackClock.ts` with one pending RAF at most:

```ts
import type { FrameScheduler, PlaybackClockPort, RuntimeFrame } from './types';

const browserScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now()
};

export class PlaybackClock implements PlaybackClockPort {
  private durationMs = 0;
  private timeMs = 0;
  private playing = false;
  private disposed = false;
  private startedAtMs = 0;
  private startedFromMs = 0;
  private rafId: number | undefined;
  private listeners = new Set<(frame: RuntimeFrame) => void>();

  constructor(private readonly scheduler: FrameScheduler = browserScheduler) {}
  get currentTimeMs() { return this.timeMs; }
  get isPlaying() { return this.playing; }

  setDuration(durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError('durationMs');
    this.durationMs = durationMs;
    this.seek(this.timeMs);
  }

  subscribe(listener: (frame: RuntimeFrame) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play() {
    if (this.disposed || this.playing || this.timeMs >= this.durationMs) return;
    this.playing = true;
    this.startedAtMs = this.scheduler.now();
    this.startedFromMs = this.timeMs;
    this.schedule();
  }

  pause() {
    if (!this.playing) return;
    this.timeMs = this.clamp(this.startedFromMs + this.scheduler.now() - this.startedAtMs);
    this.playing = false;
    this.cancelFrame();
    this.emit(false);
  }

  seek(timeMs: number) {
    this.timeMs = this.clamp(timeMs);
    if (this.playing) {
      this.startedAtMs = this.scheduler.now();
      this.startedFromMs = this.timeMs;
    }
    this.emit(true);
  }

  dispose() {
    this.disposed = true;
    this.playing = false;
    this.cancelFrame();
    this.listeners.clear();
  }

  private schedule() {
    if (this.rafId !== undefined || !this.playing) return;
    this.rafId = this.scheduler.request((timestamp) => {
      this.rafId = undefined;
      this.timeMs = this.clamp(this.startedFromMs + timestamp - this.startedAtMs);
      if (this.timeMs >= this.durationMs) this.playing = false;
      this.emit(false);
      this.schedule();
    });
  }

  private emit(forceMediaSeek: boolean) {
    const frame = { timeMs: this.timeMs, playing: this.playing, forceMediaSeek };
    this.listeners.forEach((listener) => listener(frame));
  }

  private cancelFrame() {
    if (this.rafId === undefined) return;
    this.scheduler.cancel(this.rafId);
    this.rafId = undefined;
  }

  private clamp(value: number) {
    return Math.min(this.durationMs, Math.max(0, Number.isFinite(value) ? value : 0));
  }
}
```

- [ ] **Step 4: Run tests and typecheck to verify GREEN**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/PlaybackClock.test.ts`

Expected: PASS, 3 tests.

Run: `npm run typecheck --workspace @ise/web`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit the clock boundary**

```bash
git add apps/web/src/runtime/types.ts apps/web/src/runtime/errors.ts apps/web/src/runtime/PlaybackClock.ts apps/web/src/runtime/__tests__/PlaybackClock.test.ts apps/web/src/runtime/__tests__/helpers/fakes.ts
git commit -m "feat(web): add deterministic playback clock"
```

### Task 2: ResourceManager, Signed Access Refresh, and GLB Validation

**Files:**
- Create: `apps/web/src/runtime/glb.ts`
- Create: `apps/web/src/runtime/ResourceManager.ts`
- Create: `apps/web/src/runtime/__tests__/ResourceManager.test.ts`

**Interfaces:**
- Consumes: `SceneRuntimeOptions['resolveAsset']`, `ResolvedAssetAccess`, `GLTFLoader.loadAsync(url)`, `fetch`, `URL.createObjectURL`, and `URL.revokeObjectURL`.
- Produces: `AssetRole`, `LoadedAsset`, `ResourceManager.acquire(assetId, role, signal?)`, `release(assetId)`, `dispose()`, `assertGlbHeader(buffer)`, and `disposeObject3D(root)`.

- [ ] **Step 1: Write failing cache, expiry, metadata, abort, and GLB tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedAssetAccess } from '@ise/runtime-contracts';
import { ResourceManager } from '../ResourceManager';
import { assertGlbHeader } from '../glb';

const modelAccess = (overrides: Partial<ResolvedAssetAccess> = {}): ResolvedAssetAccess => ({
  assetId: 'model:rafale', url: 'https://signed/model', fingerprint: `sha256:${'a'.repeat(64)}`,
  mediaType: 'model/gltf-binary', size: 12, expiresAt: '2099-01-01T00:00:00.000Z',
  model: { scale: 1, rotationOffsetDeg: [0, 0, 90] as [number, number, number], altitudeOffsetM: 15, entityTypes: ['aircraft'] },
  ...overrides
});

function glbBytes(length = 12) {
  const bytes = new Uint8Array(length);
  bytes.set([0x67, 0x6c, 0x54, 0x46]);
  new DataView(bytes.buffer).setUint32(4, 2, true);
  new DataView(bytes.buffer).setUint32(8, length, true);
  return bytes;
}

describe('ResourceManager', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(glbBytes())));
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:model'), revokeObjectURL: vi.fn() });
  });

  it('resolves and fetches once, reference-counts, and revokes at zero', async () => {
    const resolveAsset = vi.fn(async () => modelAccess());
    const manager = new ResourceManager({ resolveAsset, now: () => 0 });
    const first = await manager.acquire('model:rafale', 'model');
    const second = await manager.acquire('model:rafale', 'model');
    expect(first).toBe(second);
    expect(resolveAsset).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    manager.release('model:rafale');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    manager.release('model:rafale');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:model');
  });

  it('refreshes access expiring within 30 seconds and retries one 403', async () => {
    const resolveAsset = vi.fn()
      .mockResolvedValueOnce(modelAccess({ expiresAt: '1970-01-01T00:00:20.000Z' }))
      .mockResolvedValue(modelAccess());
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(new Response(glbBytes()));
    const manager = new ResourceManager({ resolveAsset, now: () => 0 });
    await manager.acquire('model:rafale', 'model');
    expect(resolveAsset).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a model without calibration metadata', async () => {
    const manager = new ResourceManager({ resolveAsset: async () => modelAccess({ model: undefined }), now: () => 0 });
    await expect(manager.acquire('model:rafale', 'model')).rejects.toMatchObject({ code: 'ASSET_METADATA_INVALID' });
  });

  it('passes the caller abort signal to resolver and fetch', async () => {
    const resolveAsset = vi.fn((_id, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))));
    const manager = new ResourceManager({ resolveAsset, now: () => 0 });
    const controller = new AbortController();
    const pending = manager.acquire('model:rafale', 'model', controller.signal);
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

it('accepts only GLB v2 with an exact declared length', () => {
  expect(() => assertGlbHeader(glbBytes().buffer)).not.toThrow();
  const invalid = glbBytes();
  new DataView(invalid.buffer).setUint32(8, 99, true);
  expect(() => assertGlbHeader(invalid.buffer)).toThrowError(/declared length/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/ResourceManager.test.ts`

Expected: FAIL because `ResourceManager` and `glb` do not exist.

- [ ] **Step 3: Implement strict validation and reference-counted loading**

Use these stable resource ports:

```ts
export type AssetRole = 'model' | 'trajectory' | 'video' | 'image' | 'geojson';

export interface LoadedAsset {
  access: ResolvedAssetAccess;
  objectUrl: string;
  blob: Blob;
  readJson(): Promise<unknown>;
  readGltf(): Promise<GLTF>;
}
```

Implement these required branches in `ResourceManager.acquire()`:

```ts
async acquire(assetId: string, role: AssetRole, signal?: AbortSignal): Promise<LoadedAsset> {
  this.assertUsable();
  const cached = this.entries.get(assetId);
  if (cached) {
    cached.refCount += 1;
    return cached.loaded;
  }

  const initialAccess = await this.resolveFresh(assetId, signal);
  this.assertMetadata(initialAccess, role);
  const { access, blob } = await this.fetchBlobWithOneRefresh(initialAccess, signal);
  const objectUrl = URL.createObjectURL(blob);
  let jsonPromise: Promise<unknown> | undefined;
  let gltfPromise: Promise<GLTF> | undefined;
  const loaded: LoadedAsset = {
    access,
    objectUrl,
    blob,
    readJson: () => (jsonPromise ??= blob.text().then(JSON.parse)),
    readGltf: () => (gltfPromise ??= blob.arrayBuffer().then((buffer) => {
      assertGlbHeader(buffer);
      return this.gltfLoader.loadAsync(objectUrl);
    }))
  };
  this.entries.set(assetId, { refCount: 1, loaded, getGltf: () => gltfPromise });
  return loaded;
}

private async resolveFresh(assetId: string, signal?: AbortSignal) {
  let access = await this.resolveAsset(assetId, signal);
  if (Date.parse(access.expiresAt) <= this.now() + 30_000) access = await this.resolveAsset(assetId, signal);
  if (!Number.isFinite(Date.parse(access.expiresAt)) || Date.parse(access.expiresAt) <= this.now()) {
    throw new SceneRuntimeError('ASSET_ACCESS_EXPIRED', `Asset access is expired: ${assetId}`, assetId);
  }
  return access;
}

release(assetId: string) {
  const entry = this.entries.get(assetId);
  if (!entry || --entry.refCount > 0) return;
  entry.getGltf()?.then((gltf) => disposeObject3D(gltf.scene)).catch(() => undefined);
  URL.revokeObjectURL(entry.loaded.objectUrl);
  this.entries.delete(assetId);
}
```

`fetchBlobWithOneRefresh()` must return the access record that actually fetched the blob, retry only HTTP 401/403 with a newly resolved access record, throw `ASSET_FETCH_FAILED` for non-OK responses, and preserve `AbortError`. Validate the refreshed record again and reject if its asset ID, fingerprint, role metadata, or size differs from the initial record; a signed URL refresh cannot silently switch asset content mid-load. Cache entries also store their `AssetRole`; acquiring the same asset ID under another role rejects `ASSET_METADATA_INVALID`. `assertMetadata()` must enforce role-specific metadata plus `access.assetId === requested assetId`; trajectory metadata must equal the fixed v1 values. `dispose()` marks the manager unusable and force-revokes every remaining entry regardless of reference count.

Implement the 12-byte header check and GPU traversal in `glb.ts`:

```ts
export function assertGlbHeader(buffer: ArrayBuffer) {
  if (buffer.byteLength < 12) throw new SceneRuntimeError('GLB_INVALID', 'GLB header is shorter than 12 bytes');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new SceneRuntimeError('GLB_INVALID', 'GLB magic is not glTF');
  if (view.getUint32(4, true) !== 2) throw new SceneRuntimeError('GLB_INVALID', 'GLB version is not 2');
  if (view.getUint32(8, true) !== buffer.byteLength) throw new SceneRuntimeError('GLB_INVALID', 'GLB declared length does not match payload');
}

export function disposeObject3D(root: THREE.Object3D) {
  const disposed = new Set<object>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && !disposed.has(mesh.geometry)) { mesh.geometry.dispose(); disposed.add(mesh.geometry); }
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    materials.forEach((material) => {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !disposed.has(value)) { value.dispose(); disposed.add(value); }
      }
      if (!disposed.has(material)) { material.dispose(); disposed.add(material); }
    });
  });
}
```

- [ ] **Step 4: Run the resource suite and typecheck to verify GREEN**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/ResourceManager.test.ts`

Expected: PASS, 5 tests.

Run: `npm run typecheck --workspace @ise/web`

Expected: PASS.

- [ ] **Step 5: Commit resource ownership**

```bash
git add apps/web/src/runtime/glb.ts apps/web/src/runtime/ResourceManager.ts apps/web/src/runtime/__tests__/ResourceManager.test.ts
git commit -m "feat(web): add runtime asset cache"
```

### Task 3: Normalized Trajectory Validation, Interpolation, Heading, and Pitch

**Files:**
- Create: `apps/web/src/runtime/trajectory.ts`
- Create: `apps/web/src/runtime/__tests__/trajectory.test.ts`

**Interfaces:**
- Consumes: `trajectorySchema`, `NormalizedTrajectory`, and `ResolvedAssetAccess['trajectory']` from `@ise/runtime-contracts`.
- Produces: runtime-only `PreparedTrajectory`, `TrajectorySample`, `prepareTrajectory(value, metadata)`, and `sampleTrajectory(trajectory, elapsedMs)`; it does not redefine the canonical trajectory schema or parse source datetimes.

- [ ] **Step 1: Write failing normalization and sampling tests**

```ts
import { describe, expect, it } from 'vitest';
import type { ResolvedAssetAccess } from '@ise/runtime-contracts';
import { prepareTrajectory, sampleTrajectory } from '../trajectory';

const metadata = {
  format: 'ise-trajectory/v1' as const, timeUnit: 'ms' as const,
  coordinateOrder: 'lng-lat-alt' as const, startTimeMs: 0, endTimeMs: 2_000, monotonic: true as const
} satisfies NonNullable<ResolvedAssetAccess['trajectory']>;
const document = {
  schemaVersion: 'ise-trajectory/v1',
  points: [
    { timeMs: 0, longitude: 76, latitude: 30, altitudeM: 1_000 },
    { timeMs: 1_000, longitude: 77, latitude: 30, altitudeM: 1_100 },
    { timeMs: 2_000, longitude: 78, latitude: 30, altitudeM: 1_200 }
  ]
};

describe('prepareTrajectory', () => {
  it('accepts canonical relative milliseconds without renormalizing them', () => {
    const trajectory = prepareTrajectory(document, metadata);
    expect(trajectory.points.map((point) => point.timeMs)).toEqual([0, 1_000, 2_000]);
    expect(trajectory.durationMs).toBe(2_000);
  });

  it.each([
    [{ ...document, points: [document.points[0], { ...document.points[1], timeMs: 0 }] }, 'strictly increasing'],
    [{ ...document, points: [{ ...document.points[0], longitude: 181 }, ...document.points.slice(1)] }, 'longitude'],
    [{ ...document, schemaVersion: 'raw-track/v0' }, 'schemaVersion'],
    [document, 'metadata bounds', { ...metadata, endTimeMs: 2_001 }]
  ] as const)('rejects invalid canonical input', (value, message, metadataOverride = metadata) => {
    expect(() => prepareTrajectory(value, metadataOverride)).toThrowError(new RegExp(message, 'i'));
  });
});

describe('sampleTrajectory', () => {
  const trajectory = prepareTrajectory(document, metadata);
  it('clamps first and last and linearly interpolates the midpoint', () => {
    expect(sampleTrajectory(trajectory, -1).longitude).toBe(76);
    expect(sampleTrajectory(trajectory, 500)).toMatchObject({ longitude: 76.5, latitude: 30, altitudeM: 1_050 });
    expect(sampleTrajectory(trajectory, 9_000).longitude).toBe(78);
  });

  it('computes eastbound heading and a positive climb pitch', () => {
    const sample = sampleTrajectory(trajectory, 500);
    expect(sample.headingDeg).toBeCloseTo(90, 3);
    expect(sample.pitchDeg).toBeGreaterThan(0);
    expect(sample.tailEndIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run the trajectory test and verify RED**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/trajectory.test.ts`

Expected: FAIL because `trajectory.ts` does not exist.

- [ ] **Step 3: Implement strict normalization and O(log n) sampling**

Import the canonical type and derive runtime-only output types:

```ts
import { trajectorySchema, type NormalizedTrajectory, type ResolvedAssetAccess } from '@ise/runtime-contracts';
import { SceneRuntimeError } from './errors';

type CanonicalPoint = NormalizedTrajectory['points'][number];
type TrajectoryMetadata = NonNullable<ResolvedAssetAccess['trajectory']>;
export interface PreparedTrajectory { points: CanonicalPoint[]; durationMs: number; }
export interface TrajectorySample extends CanonicalPoint { headingDeg: number; pitchDeg: number; tailEndIndex: number; }

export function prepareTrajectory(value: unknown, metadata: TrajectoryMetadata): PreparedTrajectory {
  const document = trajectorySchema.parse(value);
  const first = document.points[0]!;
  const last = document.points.at(-1)!;
  if (metadata.format !== 'ise-trajectory/v1' || metadata.timeUnit !== 'ms' ||
      metadata.coordinateOrder !== 'lng-lat-alt' || metadata.monotonic !== true ||
      first.timeMs !== 0 || first.timeMs !== metadata.startTimeMs || last.timeMs !== metadata.endTimeMs) {
    throw new SceneRuntimeError('TRAJECTORY_INVALID', 'Trajectory metadata bounds or canonical format do not match');
  }
  return { points: document.points, durationMs: last.timeMs - first.timeMs };
}
```

`trajectorySchema.parse()` supplies strict object, minimum-point, integer-millisecond, coordinate-range, and strict-monotonic validation. `prepareTrajectory()` adds exact metadata/document bound checks and does not subtract `startTimeMs`; foundation canonicalization already emits relative points and requires manifest bounds to equal the first/last canonical points.

Implement binary search and geodesic orientation as follows:

```ts
export function sampleTrajectory(trajectory: PreparedTrajectory, elapsedMs: number): TrajectorySample {
  const points = trajectory.points;
  const timeMs = Math.min(trajectory.durationMs, Math.max(0, elapsedMs));
  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (points[middle].timeMs <= timeMs) low = middle; else high = middle;
  }
  const start = points[low];
  const end = points[Math.min(low + 1, points.length - 1)];
  const ratio = end.timeMs === start.timeMs ? 0 : (timeMs - start.timeMs) / (end.timeMs - start.timeMs);
  const longitude = interpolateLongitude(start.longitude, end.longitude, ratio);
  const latitude = start.latitude + (end.latitude - start.latitude) * ratio;
  const altitudeM = start.altitudeM + (end.altitudeM - start.altitudeM) * ratio;
  const horizontalM = haversineMeters(start.longitude, start.latitude, end.longitude, end.latitude);
  return {
    timeMs, longitude, latitude, altitudeM,
    headingDeg: bearingDegrees(start.longitude, start.latitude, end.longitude, end.latitude),
    pitchDeg: horizontalM === 0 ? 0 : Math.atan2(end.altitudeM - start.altitudeM, horizontalM) * 180 / Math.PI,
    tailEndIndex: Math.min(low + 1, points.length - 1)
  };
}
```

`interpolateLongitude()` must use the shortest antimeridian delta. `bearingDegrees()` must return `[0,360)` with north `0` and east `90`. When two spatial points are identical, scan outward for the nearest non-identical segment before returning heading/pitch `0`.

- [ ] **Step 4: Run trajectory tests and typecheck to verify GREEN**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/trajectory.test.ts`

Expected: PASS, 7 tests.

Run: `npm run typecheck --workspace @ise/web`

Expected: PASS.

- [ ] **Step 5: Commit trajectory math**

```bash
git add apps/web/src/runtime/trajectory.ts apps/web/src/runtime/__tests__/trajectory.test.ts
git commit -m "feat(web): add deterministic trajectory sampling"
```

### Task 4: MapRuntime for Markers, GeoJSON, Trails, and Camera

**Files:**
- Create: `apps/web/src/runtime/MapRuntime.ts`
- Create: `apps/web/src/runtime/__tests__/MapRuntime.test.ts`
- Modify: `apps/web/src/runtime/__tests__/helpers/fakes.ts`

**Interfaces:**
- Consumes: visible `marker`, `geojson`, and `camera` tracks; `ResourceManager.acquire(assetId,'geojson')`; `RuntimeTrail[]`; `mapboxgl.Map`.
- Produces: `MarkerPort`, injectable `MapRuntimeDependencies.createMarker(element)`, `RuntimeTrail`, `MapRuntime.load(tracks, signal)`, `applyBase(timeMs)`, `applyTrails(trails)`, and `dispose()`.

- [ ] **Step 1: Write failing deterministic map lifecycle tests**

Add a `FakeMap` implementing the used Mapbox methods and event registry to `helpers/fakes.ts`. Then add these cases:

```ts
import type { SceneTrack } from '@ise/runtime-contracts';
import { describe, expect, it, vi } from 'vitest';
import type { LoadedAsset } from '../ResourceManager';
import { MapRuntime } from '../MapRuntime';
import { FakeMap } from './helpers/fakes';

type MarkerTrack = Extract<SceneTrack, { type: 'marker' }>;
type GeojsonTrack = Extract<SceneTrack, { type: 'geojson' }>;
type CameraTrack = Extract<SceneTrack, { type: 'camera' }>;
const evidenceRefs = ['fixture:evidence'];
const featureCollection = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: {
    type: 'LineString', coordinates: [[76, 30], [77, 31]]
  }}]
} as const;

function markerTrack(startMs: number, durationMs: number): MarkerTrack {
  return { trackId: 'markers', type: 'marker', label: 'Markers', visible: true, items: [{
    id: 'marker-item', eventUnitId: 'event-1', startMs, durationMs, evidenceRefs,
    params: { coordinates: [76, 30], label: 'Ambala', color: '#ff3344' }
  }] };
}

function geojsonTrack(assetId: string, startMs: number, durationMs: number, keepAfterEnd: boolean): GeojsonTrack {
  return { trackId: 'geo', type: 'geojson', label: 'GeoJSON', visible: true, items: [{
    id: 'geo-item', eventUnitId: 'event-1', startMs, durationMs, assetId, evidenceRefs,
    params: { lineColor: '#22ccff', lineWidth: 2, fillColor: '#225577', fillOpacity: 0.25,
      circleColor: '#ffffff', circleRadius: 4, keepAfterEnd }
  }] };
}

function cameraTrack(startMs: number, durationMs: number, params: CameraTrack['items'][number]['params']): CameraTrack {
  return { trackId: 'camera', type: 'camera', label: 'Camera', visible: true, items: [{
    id: 'camera-item', eventUnitId: 'event-1', startMs, durationMs, evidenceRefs, params
  }] };
}

function fakeResources(jsonByAssetId: Record<string, unknown>) {
  return {
    acquire: vi.fn(async (assetId: string) => ({
      readJson: async () => jsonByAssetId[assetId]
    } as LoadedAsset)),
    release: vi.fn()
  };
}

function markerDependencies(map: FakeMap) {
  return { createMarker: vi.fn(() => {
    let added = false;
    const marker = {
      setLngLat: vi.fn(() => marker),
      addTo: vi.fn(() => { if (!added) map.markerCount += 1; added = true; return marker; }),
      remove: vi.fn(() => { if (added) map.markerCount -= 1; added = false; })
    };
    return marker;
  }) };
}

it('adds active marker and geometry layers with namespaced IDs and removes expired items', async () => {
  const map = new FakeMap();
  const resources = fakeResources({ 'geo:border': featureCollection });
  const runtime = new MapRuntime(map as never, resources as never, markerDependencies(map));
  await runtime.load([markerTrack(100, 200), geojsonTrack('geo:border', 100, 200, false)]);
  runtime.applyBase(150);
  expect(map.markerCount).toBe(1);
  expect(map.layerIds()).toContain('ise:geo:geo-item:line');
  runtime.applyBase(300);
  expect(map.markerCount).toBe(0);
  expect(map.layerIds()).not.toContain('ise:geo:geo-item:line');
});

it('persists keepAfterEnd geometry and updates a deterministic trail source', async () => {
  const map = new FakeMap();
  const runtime = new MapRuntime(map as never, fakeResources({ 'geo:border': featureCollection }) as never, markerDependencies(map));
  await runtime.load([geojsonTrack('geo:border', 0, 100, true)]);
  runtime.applyBase(500);
  runtime.applyTrails([{ entityId: 'rafale-1', coordinates: [[76, 30], [77, 31]] }]);
  expect(map.layerIds()).toContain('ise:geo:geo-item:line');
  expect(map.sourceData('ise:trail:rafale-1')).toMatchObject({ geometry: { coordinates: [[76, 30], [77, 31]] } });
});

it('uses jumpTo with the same interpolated camera state after seek and replay', async () => {
  const map = new FakeMap({ center: [70, 20], zoom: 3, pitch: 0, bearing: 0 });
  const runtime = new MapRuntime(map as never, fakeResources({}) as never, markerDependencies(map));
  await runtime.load([cameraTrack(1_000, 1_000, { center: [80, 30], zoom: 7, pitch: 40, bearing: 90, easing: 'linear' })]);
  runtime.applyBase(1_500);
  const first = map.lastJump;
  runtime.applyBase(0);
  runtime.applyBase(1_500);
  expect(map.lastJump).toEqual(first);
  expect(map.easeTo).not.toHaveBeenCalled();
});

it('rebuilds owned layers after style.load and unregisters listeners on dispose', async () => {
  const map = new FakeMap();
  const runtime = new MapRuntime(map as never, fakeResources({ 'geo:border': featureCollection }) as never, markerDependencies(map));
  await runtime.load([geojsonTrack('geo:border', 0, 100, true)]);
  runtime.applyBase(50);
  map.clearStyleAndEmit('style.load');
  expect(map.layerIds()).toContain('ise:geo:geo-item:line');
  runtime.dispose();
  expect(map.listenerCount('style.load')).toBe(0);
  expect(map.layerIds()).toEqual([]);
});
```

Append this concrete Mapbox fake to `helpers/fakes.ts`; later model tests reuse it:

```ts
export class FakeMap {
  markerCount = 0;
  lastJump: Record<string, unknown> | undefined;
  readonly easeTo = vi.fn();
  readonly triggerRepaint = vi.fn();
  private camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  private layers = new Map<string, any>();
  private sources = new Map<string, { data: unknown; setData(data: unknown): void }>();
  private listeners = new Map<string, Set<() => void>>();
  private canvas = document.createElement('canvas');

  constructor(camera = { center: [70, 20] as [number, number], zoom: 3, pitch: 0, bearing: 0 }) {
    this.camera = camera;
  }
  readonly addSource = vi.fn((id: string, source: { data: unknown }) => {
    const entry = { data: source.data, setData: (data: unknown) => { entry.data = data; } };
    this.sources.set(id, entry);
  });
  readonly getSource = vi.fn((id: string) => this.sources.get(id));
  readonly removeSource = vi.fn((id: string) => this.sources.delete(id));
  readonly addLayer = vi.fn((layer: { id: string; onAdd?: (map: unknown, gl: unknown) => void }) => {
    this.layers.set(layer.id, layer);
    layer.onAdd?.(this, {});
  });
  readonly getLayer = vi.fn((id: string) => this.layers.get(id));
  readonly removeLayer = vi.fn((id: string) => {
    const layer = this.layers.get(id);
    layer?.onRemove?.(this, {});
    this.layers.delete(id);
  });
  readonly jumpTo = vi.fn((next: any) => {
    this.lastJump = next;
    const center = next.center ?? this.camera.center;
    this.camera = { center, zoom: next.zoom ?? this.camera.zoom,
      pitch: next.pitch ?? this.camera.pitch, bearing: next.bearing ?? this.camera.bearing };
  });
  getCenter() { return { lng: this.camera.center[0], lat: this.camera.center[1] }; }
  getZoom() { return this.camera.zoom; }
  getPitch() { return this.camera.pitch; }
  getBearing() { return this.camera.bearing; }
  getCanvas() { return this.canvas; }
  isStyleLoaded() { return true; }
  on(event: string, listener: () => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener); this.listeners.set(event, listeners);
  }
  off(event: string, listener: () => void) { this.listeners.get(event)?.delete(listener); }
  listenerCount(event: string) { return this.listeners.get(event)?.size ?? 0; }
  layerIds() { return [...this.layers.keys()]; }
  sourceData(id: string) { return this.sources.get(id)?.data; }
  clearStyleAndEmit(event: string) {
    this.layers.clear(); this.sources.clear();
    this.listeners.get(event)?.forEach((listener) => listener());
  }
}
```

- [ ] **Step 2: Run the map test and verify RED**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/MapRuntime.test.ts`

Expected: FAIL because `MapRuntime` does not exist.

- [ ] **Step 3: Implement namespaced, idempotent map state application**

Use this trail interface and layer naming:

```ts
export interface MarkerPort {
  setLngLat(coordinates: [number, number]): MarkerPort;
  addTo(map: mapboxgl.Map): MarkerPort;
  remove(): void;
}
export interface MapRuntimeDependencies { createMarker(element: HTMLElement): MarkerPort; }
export interface RuntimeTrail { entityId: string; coordinates: ReadonlyArray<readonly [number, number]>; }
const sourceId = (trackId: string, itemId: string) => `ise:geo:${trackId}:${itemId}`;
const trailId = (entityId: string) => `ise:trail:${entityId}`;
const browserDependencies: MapRuntimeDependencies = {
  createMarker: (element) => new mapboxgl.Marker({ element })
};
```

Use the exact constructor `constructor(map: mapboxgl.Map, resources: ResourceManager, dependencies: MapRuntimeDependencies = browserDependencies)` and store all three arguments as private readonly fields.

`load()` must filter `visible === true`, acquire and parse every GeoJSON asset, reject values that are not a GeoJSON `Feature`, `FeatureCollection`, or `GeometryCollection`, sort camera items by `startMs` then `id`, reject overlapping camera intervals, capture the map's initial camera, and register one `style.load` listener.

`applyBase()` must compute desired IDs from the supplied playhead and reconcile them against current markers/layers. For each GeoJSON source, add three filtered layers where applicable. `applyTrails()` independently reconciles the supplied entity trails, so SceneRuntime can apply map/camera state before model transforms without evaluating map items twice:

```ts
map.addLayer({ id: `${id}:fill`, type: 'fill', source: id,
  filter: ['==', ['geometry-type'], 'Polygon'],
  paint: { 'fill-color': params.fillColor, 'fill-opacity': params.fillOpacity } });
map.addLayer({ id: `${id}:line`, type: 'line', source: id,
  filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
  paint: { 'line-color': params.lineColor, 'line-width': params.lineWidth } });
map.addLayer({ id: `${id}:circle`, type: 'circle', source: id,
  filter: ['==', ['geometry-type'], 'Point'],
  paint: { 'circle-color': params.circleColor, 'circle-radius': params.circleRadius } });
```

Create marker elements with text content, background color, `data-runtime-kind="marker"`, and `pointer-events:none`; use `new mapboxgl.Marker({ element }).setLngLat(params.coordinates).addTo(map)`.

Camera application must never animate independently:

```ts
const progress = clamp01((timeMs - item.startMs) / item.durationMs);
const eased = item.params.easing === 'easeInOut' ? progress * progress * (3 - 2 * progress) : progress;
map.jumpTo({
  center: interpolateLngLat(start.center, item.params.center, eased),
  zoom: lerp(start.zoom, item.params.zoom, eased),
  pitch: lerp(start.pitch, item.params.pitch, eased),
  bearing: interpolateBearing(start.bearing, item.params.bearing, eased)
});
```

On `style.load`, clear internal rendered-ID sets, call `applyBase(lastTimeMs)`, then call `applyTrails(lastTrails)`. On dispose, release GeoJSON resources, remove layers before sources, remove markers and trails, call `map.off('style.load', listener)`, and tolerate a style already being removed.

- [ ] **Step 4: Run map tests and typecheck to verify GREEN**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/MapRuntime.test.ts`

Expected: PASS, 4 tests.

Run: `npm run typecheck --workspace @ise/web`

Expected: PASS.

- [ ] **Step 5: Commit deterministic map rendering**

```bash
git add apps/web/src/runtime/MapRuntime.ts apps/web/src/runtime/__tests__/MapRuntime.test.ts apps/web/src/runtime/__tests__/helpers/fakes.ts
git commit -m "feat(web): add deterministic map runtime"
```

### Task 5: ModelRuntime Custom Layer, GLTF Clones, and Model Actions

**Files:**
- Create: `apps/web/src/runtime/ModelRuntime.ts`
- Create: `apps/web/src/runtime/__tests__/ModelRuntime.test.ts`
- Modify: `apps/web/src/runtime/__tests__/helpers/fakes.ts`

**Interfaces:**
- Consumes: `SceneEntity[]`, visible model tracks, `ResourceManager`, normalized trajectories, `mapboxgl.MercatorCoordinate`, Three.js, and Mapbox's shared WebGL context.
- Produces: internal `ModelFrameState`, `reduceModelFrame(entity, items, trajectories, timeMs)`, `applyModelTransform(object, sample, metadata, projector)`, injectable `ModelRuntimeDependencies`, `ModelRuntime.load(entities, tracks, signal)`, `apply(timeMs): RuntimeTrail[]`, and `dispose()`; custom layer ID `ise-model-runtime`. Only `ModelRuntime` is re-exported through the runtime composition, while pure helpers remain module-internal API for focused tests.

- [ ] **Step 1: Write failing template, action, transform, and cleanup tests**

```ts
import * as THREE from 'three';
import type { ResolvedAssetAccess, SceneEntity, SceneTrack } from '@ise/runtime-contracts';
import { expect, it, vi } from 'vitest';
import { ModelRuntime, applyModelTransform, reduceModelFrame } from '../ModelRuntime';
import { prepareTrajectory, sampleTrajectory } from '../trajectory';
import { FakeMap } from './helpers/fakes';

type ModelTrack = Extract<SceneTrack, { type: 'model' }>;
type ModelItem = ModelTrack['items'][number];
const evidenceRefs = ['fixture:evidence'];
const validModelMetadata: NonNullable<ResolvedAssetAccess['model']> = {
  scale: 1, rotationOffsetDeg: [0, 0, 90], altitudeOffsetM: 0, entityTypes: ['aircraft']
};
const trajectoryMetadata: NonNullable<ResolvedAssetAccess['trajectory']> = {
  format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt',
  startTimeMs: 0, endTimeMs: 2_000, monotonic: true
};
const eastboundTrajectory = prepareTrajectory({ schemaVersion: 'ise-trajectory/v1', points: [
  { timeMs: 0, longitude: 76, latitude: 30, altitudeM: 1_000 },
  { timeMs: 1_000, longitude: 76.5, latitude: 30, altitudeM: 1_050 },
  { timeMs: 2_000, longitude: 77, latitude: 30, altitudeM: 1_100 }
] }, trajectoryMetadata);

function rafale(entityId: string): SceneEntity {
  return { entityId, displayName: entityId, kind: 'aircraft', modelAssetId: 'model:rafale',
    defaultTrajectoryAssetId: 'trajectory:ambala-rafale-1', initialState: 'normal' };
}
function action(startMs: number, durationMs: number, params: ModelItem['params']): ModelItem {
  return { id: `action-${startMs}-${params.action}`, eventUnitId: 'event-1', startMs, durationMs,
    evidenceRefs, params };
}
function modelActionTrack(items: ModelItem[]): ModelTrack {
  return { trackId: 'models', type: 'model', label: 'Models', visible: true, items };
}
function modelTrackFor(entityId: string): ModelTrack {
  return modelActionTrack([
    action(0, 1, { action: 'model.spawn', entityId }),
    action(1_000, 2_000, { action: 'model.follow_path', entityId,
      trajectoryAssetId: 'trajectory:ambala-rafale-1' })
  ]);
}
function followOnlyTrack(entityId: string): ModelTrack {
  return modelActionTrack([action(0, 2_000, { action: 'model.follow_path', entityId,
    trajectoryAssetId: 'trajectory:ambala-rafale-1' })]);
}

function modelHarness(options: { modelMetadata?: ResolvedAssetAccess['model'] } = {}) {
  const map = new FakeMap();
  const renderer = { autoClear: true, resetState: vi.fn(), render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn() };
  const template = new THREE.Group();
  const readGltf = vi.fn(async () => ({ scene: template }));
  const readJson = vi.fn(async () => ({ schemaVersion: 'ise-trajectory/v1', points: eastboundTrajectory.points }));
  const modelMetadata = Object.hasOwn(options, 'modelMetadata') ? options.modelMetadata : validModelMetadata;
  const resources = {
    acquire: vi.fn(async (assetId: string) => assetId.startsWith('model:') ? {
      access: { assetId, url: 'https://signed/model', fingerprint: `sha256:${'a'.repeat(64)}`,
        mediaType: 'model/gltf-binary', size: 12, expiresAt: '2099-01-01T00:00:00.000Z', model: modelMetadata },
      readGltf
    } : {
      access: { assetId, url: 'https://signed/trajectory', fingerprint: `sha256:${'b'.repeat(64)}`,
        mediaType: 'application/vnd.ise.trajectory+json', size: 100,
        expiresAt: '2099-01-01T00:00:00.000Z', trajectory: trajectoryMetadata },
      readJson
    }),
    release: vi.fn()
  };
  const clones: THREE.Object3D[] = [];
  const runtime = new ModelRuntime(map as never, resources as never, {
    createRenderer: () => renderer as never,
    cloneScene: (root) => { const clone = root.clone(true); clones.push(clone); return clone; },
    project: (_longitude, _latitude, altitudeM) => ({
      x: 0.25, y: 0.5, z: altitudeM / 1_000_000, meterInMercatorCoordinateUnits: () => 0.001
    })
  });
  return { map, renderer, runtime, readGltf, clones };
}

it('loads one GLB template and clones an instance per entity', async () => {
  const { map, readGltf, runtime, clones } = modelHarness();
  await runtime.load([rafale('one'), rafale('two')], [modelTrackFor('one'), modelTrackFor('two')]);
  expect(readGltf).toHaveBeenCalledTimes(1);
  expect(clones).toHaveLength(2);
  expect(clones[0]).not.toBe(clones[1]);
  expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'ise-model-runtime', type: 'custom', renderingMode: '3d' }));
});

it('reduces spawn/follow/state/hide at any seek time without timers', async () => {
  const items = modelActionTrack([
    action(0, 1, { action: 'model.spawn', entityId: 'one' }),
    action(1_000, 2_000, { action: 'model.follow_path', entityId: 'one', trajectoryAssetId: 'trajectory:ambala-rafale-1' }),
    action(1_500, 1, { action: 'model.set_state', entityId: 'one', state: 'warning' }),
    action(3_500, 1, { action: 'model.hide', entityId: 'one' })
  ]).items;
  const trajectories = new Map([['trajectory:ambala-rafale-1', eastboundTrajectory]]);
  const active = reduceModelFrame(rafale('one'), items, trajectories, 2_000);
  expect(active).toMatchObject({ visible: true, state: 'warning', sample: { longitude: 76.5, headingDeg: 90 } });
  expect(active.trail.coordinates.length).toBeGreaterThan(1);
  expect(reduceModelFrame(rafale('one'), items, trajectories, 3_600).visible).toBe(false);
});

it('applies Mercator scale, rotationOffsetDeg, altitudeOffsetM, and pitch', async () => {
  const object = new THREE.Group();
  const transform = applyModelTransform(object, { ...sampleTrajectory(eastboundTrajectory, 1_000), altitudeM: 1_050 }, {
    scale: 2, rotationOffsetDeg: [10, 20, 30], altitudeOffsetM: 50, entityTypes: ['aircraft']
  }, (_longitude, _latitude, altitudeM) => ({
    x: 0.25, y: 0.5, z: altitudeM / 1_000_000, meterInMercatorCoordinateUnits: () => 0.001
  }));
  expect(transform).toMatchObject({ altitudeM: 1_100, scaleFactor: 0.002 });
  expect(object.position.z).toBeCloseTo(0.0011);
});

it('rejects missing calibration, incompatible entity kind, and follow before spawn', async () => {
  await expect(modelHarness({ modelMetadata: undefined }).runtime.load([rafale('one')], [modelTrackFor('one')])).rejects.toMatchObject({ code: 'ASSET_METADATA_INVALID' });
  await expect(modelHarness({ modelMetadata: { ...validModelMetadata, entityTypes: ['missile'] } }).runtime.load([rafale('one')], [modelTrackFor('one')])).rejects.toMatchObject({ code: 'ASSET_METADATA_INVALID' });
  await expect(modelHarness({}).runtime.load([rafale('one')], [followOnlyTrack('one')])).rejects.toMatchObject({ code: 'MODEL_COMMAND_INVALID' });
});

it('removes the custom layer and disposes renderer/listeners without losing Mapbox context', async () => {
  const { map, renderer, runtime } = modelHarness();
  await runtime.load([rafale('one')], [modelTrackFor('one')]);
  runtime.dispose();
  expect(map.removeLayer).toHaveBeenCalledWith('ise-model-runtime');
  expect(renderer.dispose).toHaveBeenCalled();
  expect(renderer.forceContextLoss).not.toHaveBeenCalled();
  expect(map.listenerCount('style.load')).toBe(0);
});
```

- [ ] **Step 2: Run the model test and verify RED**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/ModelRuntime.test.ts`

Expected: FAIL because `ModelRuntime` does not exist.

- [ ] **Step 3: Implement the Mapbox custom layer and deterministic action reducer**

On load, resolve each referenced entity's `modelAssetId`, require model metadata and compatible `entity.kind`, resolve every default/follow trajectory, call `prepareTrajectory`, and validate that each `model.follow_path` has a prior `model.spawn` when ordered by `startMs` with original item order as the tie-breaker. Clone the parsed template scene and clone each mesh material so warning/disabled state never mutates another entity. Use the exact constructor `constructor(map: mapboxgl.Map, resources: ResourceManager, dependencies: ModelRuntimeDependencies = browserModelDependencies)`.

Implement the seek-safe command reducer as a pure function; command effects persist after their one-millisecond fixture items have ended:

```ts
export interface ModelFrameState {
  visible: boolean;
  state: SceneEntity['initialState'];
  sample?: TrajectorySample;
  trail: RuntimeTrail;
}

export function reduceModelFrame(
  entity: SceneEntity,
  inputItems: Extract<SceneTrack, { type: 'model' }>['items'],
  trajectories: ReadonlyMap<string, PreparedTrajectory>,
  timeMs: number
): ModelFrameState {
  const items = inputItems.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.params.entityId === entity.entityId)
    .sort((left, right) => left.item.startMs - right.item.startMs || left.index - right.index);
  let spawned = false;
  let state = entity.initialState;
  let sample: TrajectorySample | undefined;
  let trail: RuntimeTrail = { entityId: entity.entityId, coordinates: [] };
  const setTrajectory = (trajectoryId: string, progress: number) => {
    const trajectory = trajectories.get(trajectoryId);
    if (!trajectory) throw new SceneRuntimeError('MODEL_COMMAND_INVALID', `Missing trajectory ${trajectoryId}`, trajectoryId);
    sample = sampleTrajectory(trajectory, clamp01(progress) * trajectory.durationMs);
    trail = { entityId: entity.entityId, coordinates: [
      ...trajectory.points.slice(0, sample.tailEndIndex).map((point) => [point.longitude, point.latitude] as const),
      [sample.longitude, sample.latitude]
    ] };
  };

  for (const { item } of items) {
    if (item.startMs > timeMs) break;
    switch (item.params.action) {
      case 'model.spawn':
        spawned = true;
        if (entity.defaultTrajectoryAssetId) setTrajectory(entity.defaultTrajectoryAssetId, 0);
        break;
      case 'model.follow_path':
        if (!spawned) throw new SceneRuntimeError('MODEL_COMMAND_INVALID', 'model.follow_path requires model.spawn');
        setTrajectory(item.params.trajectoryAssetId,
          item.durationMs === 0 ? 1 : (timeMs - item.startMs) / item.durationMs);
        break;
      case 'model.set_state':
        state = item.params.state;
        break;
      case 'model.hide':
        spawned = false;
        break;
    }
  }
  return { visible: spawned && state !== 'hidden' && sample !== undefined, state, sample, trail };
}
```

Build the custom layer with Mapbox's canvas/context:

```ts
interface MercatorProjection {
  x: number; y: number; z: number;
  meterInMercatorCoordinateUnits(): number;
}
export interface ModelRuntimeDependencies {
  createRenderer(options: THREE.WebGLRendererParameters): THREE.WebGLRenderer;
  cloneScene(root: THREE.Object3D): THREE.Object3D;
  project(longitude: number, latitude: number, altitudeM: number): MercatorProjection;
}
const browserModelDependencies: ModelRuntimeDependencies = {
  createRenderer: (options) => new THREE.WebGLRenderer(options),
  cloneScene: (root) => root.clone(true),
  project: (longitude, latitude, altitudeM) =>
    mapboxgl.MercatorCoordinate.fromLngLat([longitude, latitude], altitudeM)
};

private createLayer(): mapboxgl.CustomLayerInterface {
  return {
    id: 'ise-model-runtime', type: 'custom', renderingMode: '3d',
    onAdd: (_map, gl) => {
      this.renderer = this.dependencies.createRenderer({ canvas: this.map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
    },
    render: (_gl, matrix) => {
      this.camera.projectionMatrix.fromArray(matrix as unknown as number[]);
      this.renderer?.resetState();
      this.renderer?.render(this.scene, this.camera);
    },
    onRemove: () => {
      this.renderer?.dispose();
      this.renderer = undefined;
    }
  };
}
```

Add one ambient light and one directional light. Re-add the custom layer after `style.load`; do not create a model-owned RAF. `apply(timeMs)` calls `reduceModelFrame` for every entity, applies its returned state and sample, and returns the non-empty trails. The reducer maps each follow command's clamped progress onto the full canonical trajectory duration and persists a completed path's last position until another command changes it.

Apply geographic transforms without defaults:

```ts
export function applyModelTransform(
  object: THREE.Object3D,
  sample: TrajectorySample,
  metadata: NonNullable<ResolvedAssetAccess['model']>,
  project: ModelRuntimeDependencies['project']
) {
  const altitudeM = sample.altitudeM + metadata.altitudeOffsetM;
  const mercator = project(sample.longitude, sample.latitude, altitudeM);
  const scaleFactor = mercator.meterInMercatorCoordinateUnits() * metadata.scale;
  object.position.set(mercator.x, mercator.y, mercator.z);
  object.scale.set(scaleFactor, -scaleFactor, scaleFactor);
  const motion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(sample.pitchDeg), 0, THREE.MathUtils.degToRad(-sample.headingDeg), 'XYZ'
  ));
  const [offsetX, offsetY, offsetZ] = metadata.rotationOffsetDeg;
  const correction = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(offsetX), THREE.MathUtils.degToRad(offsetY), THREE.MathUtils.degToRad(offsetZ), 'XYZ'
  ));
  object.quaternion.copy(motion).multiply(correction);
  return { altitudeM, scaleFactor };
}
```

For `normal`, restore cloned material colors/emissive/opacity. For `warning`, add a red emissive tint while preserving textures. For `disabled`, set opacity to `0.45` and color multiplier to `0.35`. For `hidden` state and `model.hide`, set object visibility false. Call `map.triggerRepaint()` after each apply. Build each `RuntimeTrail` from points through `tailEndIndex` plus the interpolated sample.

On dispose, unregister `style.load`, remove the custom layer when present, remove instances from the scene, release every acquired model/trajectory, and clear references. `ResourceManager` owns template GPU disposal; `ModelRuntime` owns only cloned materials and the renderer.

- [ ] **Step 4: Run model tests and typecheck to verify GREEN**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/ModelRuntime.test.ts`

Expected: PASS, 5 tests.

Run: `npm run typecheck --workspace @ise/web`

Expected: PASS.

- [ ] **Step 5: Commit controlled Three.js rendering**

```bash
git add apps/web/src/runtime/ModelRuntime.ts apps/web/src/runtime/__tests__/ModelRuntime.test.ts apps/web/src/runtime/__tests__/helpers/fakes.ts
git commit -m "feat(web): add mapbox three model runtime"
```

### Task 6: OverlayRuntime for Subtitle, Image, and Video Synchronization

**Files:**
- Create: `apps/web/src/runtime/OverlayRuntime.ts`
- Create: `apps/web/src/runtime/__tests__/OverlayRuntime.test.ts`
- Modify: `apps/web/src/runtime/__tests__/helpers/fakes.ts`

**Interfaces:**
- Consumes: visible subtitle/image/video tracks, `OverlayLayout`, image/video `LoadedAsset`, `RuntimeFrame`, `RuntimeDiagnosticSink`, and a supplied `overlayRoot`.
- Produces: injectable `OverlayRuntimeDependencies.createImage/createVideo`, `OverlayRuntime.load(tracks, signal)`, `unlockMedia()`, `apply(frame)`, and `dispose()`; owned DOM marked with `data-ise-runtime-overlay` and `data-runtime-kind`.

- [ ] **Step 1: Write failing layout, timing, media, fallback, and cleanup tests**

```ts
import type { Diagnostic, OverlayLayout, ResolvedAssetAccess, SceneTrack } from '@ise/runtime-contracts';
import { expect, it, vi } from 'vitest';
import type { LoadedAsset } from '../ResourceManager';
import { OverlayRuntime } from '../OverlayRuntime';

type ImageTrack = Extract<SceneTrack, { type: 'image' }>;
type VideoTrack = Extract<SceneTrack, { type: 'video' }>;
const defaultLayout: OverlayLayout = {
  xPct: 5, yPct: 5, widthPct: 30, heightPct: 30, zIndex: 10, opacity: 1, fit: 'contain'
};
const evidenceRefs = ['fixture:evidence'];

function imageTrack(layout: OverlayLayout = defaultLayout, options: {
  startMs?: number; durationMs?: number; enter?: 'none' | 'fade'; exit?: 'none' | 'fade'
} = {}): ImageTrack {
  return { trackId: 'images', type: 'image', label: 'Images', visible: true, items: [{
    id: 'image-item', eventUnitId: 'event-1', startMs: options.startMs ?? 0,
    durationMs: options.durationMs ?? 1_000, assetId: 'image:cockpit-hud', evidenceRefs,
    params: { layout, enter: options.enter ?? 'none', exit: options.exit ?? 'none' }
  }] };
}

function videoTrack(options: { startMs?: number; durationMs?: number; playbackRate?: number } = {}): VideoTrack {
  return { trackId: 'videos', type: 'video', label: 'Videos', visible: true, items: [{
    id: 'video-item', eventUnitId: 'event-1', startMs: options.startMs ?? 0,
    durationMs: options.durationMs ?? 4_000, assetId: 'video:missile-impact', evidenceRefs,
    params: { layout: defaultLayout, volume: 0.5, playbackRate: options.playbackRate ?? 1, loop: false }
  }] };
}

function overlayHarness(options: { failImage?: boolean; playRejects?: boolean } = {}) {
  const root = document.createElement('div');
  const diagnostics: Diagnostic[] = [];
  const image = document.createElement('img');
  Object.defineProperty(image, 'decode', { value: vi.fn(async () => undefined) });
  const video = document.createElement('video');
  Object.defineProperties(video, {
    play: { value: options.playRejects ? vi.fn(async () => { throw new DOMException('blocked', 'NotAllowedError'); }) : vi.fn(async () => undefined) },
    pause: { value: vi.fn() },
    load: { value: vi.fn(() => queueMicrotask(() => video.dispatchEvent(new Event('loadedmetadata')))) }
  });
  const imageAccess: ResolvedAssetAccess = {
    assetId: 'image:cockpit-hud', url: 'https://signed/image', fingerprint: `sha256:${'c'.repeat(64)}`,
    mediaType: 'image/png', size: 100, expiresAt: '2099-01-01T00:00:00.000Z',
    image: { width: 1280, height: 720, fit: 'contain' }
  };
  const videoAccess: ResolvedAssetAccess = {
    assetId: 'video:missile-impact', url: 'https://signed/video', fingerprint: `sha256:${'d'.repeat(64)}`,
    mediaType: 'video/mp4', size: 100, expiresAt: '2099-01-01T00:00:00.000Z',
    video: { durationMs: 4_000, codec: 'h264' }
  };
  const resources = {
    acquire: vi.fn(async (assetId: string) => {
      if (options.failImage && assetId.startsWith('image:')) throw new Error('missing image');
      return { access: assetId.startsWith('image:') ? imageAccess : videoAccess,
        objectUrl: assetId.startsWith('image:') ? 'blob:image' : 'blob:video' } as LoadedAsset;
    }),
    release: vi.fn()
  };
  const runtime = new OverlayRuntime(root, resources as never, (diagnostic) => diagnostics.push(diagnostic), {
    createImage: () => image,
    createVideo: () => video
  });
  return { root, image, video: video as HTMLVideoElement & { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> },
    resources, diagnostics, runtime };
}

it('uses one percentage layout and stable z-index for images and videos', async () => {
  const { root, runtime } = overlayHarness();
  await runtime.load([imageTrack({ xPct: 10, yPct: 20, widthPct: 30, heightPct: 40, zIndex: 7, opacity: .8, fit: 'cover' })]);
  runtime.apply({ timeMs: 500, playing: false, forceMediaSeek: true });
  const image = root.querySelector('[data-runtime-kind="image"]') as HTMLImageElement;
  expect(image.style.cssText).toContain('left: 10%');
  expect(image.style.cssText).toContain('object-fit: cover');
  expect(image.style.zIndex).toBe('7');
});

it('computes deterministic 300 ms entry and exit fades', async () => {
  const { root, runtime } = overlayHarness();
  await runtime.load([imageTrack(defaultLayout, { startMs: 1_000, durationMs: 1_000, enter: 'fade', exit: 'fade' })]);
  runtime.apply({ timeMs: 1_150, playing: false, forceMediaSeek: true });
  expect((root.querySelector('[data-runtime-kind="image"]') as HTMLElement).style.opacity).toBe('0.5');
  runtime.apply({ timeMs: 1_850, playing: false, forceMediaSeek: true });
  expect((root.querySelector('[data-runtime-kind="image"]') as HTMLElement).style.opacity).toBe('0.5');
});

it('sets video time from playhead and playbackRate on pause and seek', async () => {
  const { video, runtime } = overlayHarness();
  await runtime.load([videoTrack({ startMs: 2_000, durationMs: 4_000, playbackRate: 1.5 })]);
  runtime.apply({ timeMs: 3_000, playing: false, forceMediaSeek: true });
  expect(video.currentTime).toBe(1.5);
  expect(video.playbackRate).toBe(1.5);
  expect(video.pause).toHaveBeenCalled();
});

it('unlocks every video before playback and rejects autoplay failure', async () => {
  const accepted = overlayHarness();
  await accepted.runtime.load([videoTrack()]);
  await accepted.runtime.unlockMedia();
  expect(accepted.video.play).toHaveBeenCalledTimes(1);
  expect(accepted.video.pause).toHaveBeenCalled();
  const blocked = overlayHarness({ playRejects: true });
  await blocked.runtime.load([videoTrack()]);
  await expect(blocked.runtime.unlockMedia()).rejects.toMatchObject({ code: 'MEDIA_AUTOPLAY_BLOCKED' });
});

it('degrades only an unavailable image to an information card and releases all nodes/resources', async () => {
  const { root, resources, diagnostics, runtime } = overlayHarness({ failImage: true });
  await runtime.load([imageTrack()]);
  runtime.apply({ timeMs: 500, playing: false, forceMediaSeek: true });
  expect(root.querySelector('[data-runtime-kind="image-fallback"]')).toHaveTextContent('Image unavailable');
  expect(diagnostics).toContainEqual(expect.objectContaining({
    code: 'IMAGE_ASSET_UNAVAILABLE', severity: 'warning', recoverable: true
  }));
  runtime.dispose();
  expect(root.querySelector('[data-ise-runtime-overlay]')).toBeNull();
  expect(resources.release).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the overlay test and verify RED**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/OverlayRuntime.test.ts`

Expected: FAIL because `OverlayRuntime` does not exist.

- [ ] **Step 3: Implement deterministic DOM/media state**

Use the exact constructor `constructor(overlayRoot: HTMLElement, resources: ResourceManager, emitDiagnostic: RuntimeDiagnosticSink, dependencies: OverlayRuntimeDependencies = browserOverlayDependencies)`. Create one owned absolute layer inside `overlayRoot`:

```ts
export interface OverlayRuntimeDependencies {
  createImage(): HTMLImageElement;
  createVideo(): HTMLVideoElement;
}
const browserOverlayDependencies: OverlayRuntimeDependencies = {
  createImage: () => document.createElement('img'),
  createVideo: () => document.createElement('video')
};
this.layer = document.createElement('div');
this.layer.dataset.iseRuntimeOverlay = '';
Object.assign(this.layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
this.overlayRoot.append(this.layer);
```

For each image/video, acquire by asset ID. Await `image.decode()` for images. For videos, set `preload='auto'`, `playsInline=true`, `controls=false`, assign the object URL, call `load()`, and await `loadedmetadata`; emit a nonrecoverable error diagnostic and reject `error` as `MEDIA_DECODE_FAILED`. Missing images alone create a text information card with `data-runtime-kind="image-fallback"`, emit `{ code:'IMAGE_ASSET_UNAVAILABLE', severity:'warning', recoverable:true, eventUnitId, assetId, message }` through the diagnostic sink, and do not reject `load()`.

Apply shared layout exactly:

```ts
function applyLayout(element: HTMLElement, layout: OverlayLayout) {
  Object.assign(element.style, {
    position: 'absolute', left: `${layout.xPct}%`, top: `${layout.yPct}%`,
    width: `${layout.widthPct}%`, height: `${layout.heightPct}%`,
    zIndex: String(layout.zIndex), opacity: String(layout.opacity),
    objectFit: layout.fit, pointerEvents: 'none'
  });
}
```

`apply(frame)` hides inactive nodes, pauses inactive videos, computes fade opacity from the exact playhead, positions top/bottom subtitles with `maxWidthPct`, and synchronizes active video:

```ts
const FADE_MS = 300;
function overlayOpacity(item: Extract<SceneTrack, { type: 'image' }>['items'][number], timeMs: number) {
  const endMs = item.startMs + item.durationMs;
  const enter = item.params.enter === 'fade' ? Math.min(1, (timeMs - item.startMs) / FADE_MS) : 1;
  const exit = item.params.exit === 'fade' ? Math.min(1, (endMs - timeMs) / FADE_MS) : 1;
  return item.params.layout.opacity * Math.max(0, Math.min(enter, exit));
}

const targetSeconds = ((frame.timeMs - item.startMs) / 1_000) * item.params.playbackRate;
const durationSeconds = access.video!.durationMs / 1_000;
const bounded = item.params.loop && durationSeconds > 0 ? targetSeconds % durationSeconds : Math.min(targetSeconds, durationSeconds);
if (frame.forceMediaSeek || Math.abs(video.currentTime - bounded) > 0.08) video.currentTime = bounded;
video.playbackRate = item.params.playbackRate;
video.volume = item.params.volume;
if (frame.playing && this.mediaUnlocked) {
  void video.play().catch((error) => {
    video.pause();
    this.emitDiagnostic({ code: 'VIDEO_PLAYBACK_FAILED', severity: 'error', recoverable: false,
      eventUnitId: item.eventUnitId, ...(item.assetId ? { assetId: item.assetId } : {}),
      message: error instanceof Error ? error.message : 'Video playback failed' });
  });
} else video.pause();
```

`unlockMedia()` must synchronously call `play()` on all videos before its first `await`: temporarily mute each video, collect all play promises, then pause and restore mute/volume after `Promise.all`. If any promise rejects, pause every video and throw `MEDIA_AUTOPLAY_BLOCKED`.

`dispose()` aborts pending metadata/decode listeners, pauses videos, clears `src`, calls `load()` to release decoders, removes the owned layer, and releases each acquired resource.

- [ ] **Step 4: Run overlay tests and typecheck to verify GREEN**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/OverlayRuntime.test.ts`

Expected: PASS, 5 tests.

Run: `npm run typecheck --workspace @ise/web`

Expected: PASS.

- [ ] **Step 5: Commit synchronized overlays**

```bash
git add apps/web/src/runtime/OverlayRuntime.ts apps/web/src/runtime/__tests__/OverlayRuntime.test.ts apps/web/src/runtime/__tests__/helpers/fakes.ts
git commit -m "feat(web): add synchronized media overlays"
```

### Task 7: SceneRuntime Orchestration and Public Factory

**Files:**
- Create: `apps/web/src/runtime/SceneRuntime.ts`
- Create: `apps/web/src/runtime/index.ts`
- Create: `apps/web/src/runtime/__tests__/SceneRuntime.test.ts`
- Modify: `apps/web/src/runtime/__tests__/helpers/fakes.ts`

**Interfaces:**
- Consumes: all previous runtime components and validated `SceneProjectConfig`.
- Produces: internal injectable `SceneRuntimeDependencies` for unit tests, `createSceneRuntime(options: SceneRuntimeOptions): SceneRuntime`, and the exact six-method lifecycle.

- [ ] **Step 1: Write failing orchestration and factory tests**

```ts
import type mapboxgl from 'mapbox-gl';
import type { ResolvedAssetAccess, SceneProjectConfig } from '@ise/runtime-contracts';
import { expect, expectTypeOf, it, vi } from 'vitest';
import { SceneRuntimeImpl, type SceneRuntimeDependencies } from '../SceneRuntime';
import { createSceneRuntime, type SceneRuntime, type SceneRuntimeOptions } from '../index';

const validConfig: SceneProjectConfig = {
  schemaVersion: 'ise-scene/v1', sourceDocumentId: 'fixture-document',
  eventPlanArtifactId: 'fixture-events', runtimePlanArtifactId: 'fixture-runtime',
  totalDurationMs: 12_000, entities: [], tracks: [], diagnostics: []
};

function sceneRuntimeHarness(options: { modelLoadError?: Error } = {}) {
  const calls: string[] = [];
  const listeners = new Set<(frame: { timeMs: number; playing: boolean; forceMediaSeek: boolean }) => void>();
  const clock = {
    currentTimeMs: 0, isPlaying: false,
    setDuration: vi.fn((value: number) => calls.push(`clock.duration:${value}`)),
    subscribe: vi.fn((listener: (frame: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); }),
    play: vi.fn(() => { clock.isPlaying = true; calls.push('clock.play'); }),
    pause: vi.fn(() => { clock.isPlaying = false; calls.push('clock.pause');
      listeners.forEach((listener) => listener({ timeMs: clock.currentTimeMs, playing: false, forceMediaSeek: false })); }),
    seek: vi.fn((value: number) => { clock.currentTimeMs = value; calls.push(`clock.seek:${value}`);
      listeners.forEach((listener) => listener({ timeMs: value, playing: clock.isPlaying, forceMediaSeek: true })); }),
    dispose: vi.fn()
  };
  const mapRuntime = {
    load: vi.fn(async () => { calls.push('map.load'); }),
    applyBase: vi.fn((timeMs: number) => calls.push(`map.apply:${timeMs}`)),
    applyTrails: vi.fn(() => calls.push(`map.trails:${clock.currentTimeMs}`)),
    dispose: vi.fn()
  };
  const modelRuntime = {
    load: vi.fn(async () => { calls.push('model.load'); if (options.modelLoadError) throw options.modelLoadError; }),
    apply: vi.fn((timeMs: number) => { calls.push(`model.apply:${timeMs}`); return []; }),
    dispose: vi.fn()
  };
  const overlayRuntime = {
    load: vi.fn(async () => { calls.push('overlay.load'); }),
    unlockMedia: vi.fn(async () => { calls.push('overlay.unlock'); }),
    apply: vi.fn((frame: { timeMs: number; playing: boolean }) =>
      calls.push(`overlay.apply:${frame.timeMs}:${frame.playing ? 'playing' : 'paused'}`)),
    dispose: vi.fn()
  };
  const resources = { dispose: vi.fn() };
  const dependencies = { clock, mapRuntime, modelRuntime, overlayRuntime, resources } as unknown as SceneRuntimeDependencies;
  const runtimeOptions: SceneRuntimeOptions = {
    map: {} as mapboxgl.Map, overlayRoot: document.createElement('div'),
    resolveAsset: vi.fn(async () => { throw new Error('not used by component fakes'); })
  };
  const runtime = new SceneRuntimeImpl(runtimeOptions, dependencies);
  return { runtime, calls, disposals: () => ({ clock: clock.dispose.mock.calls.length,
    map: mapRuntime.dispose.mock.calls.length, model: modelRuntime.dispose.mock.calls.length,
    overlay: overlayRuntime.dispose.mock.calls.length, resources: resources.dispose.mock.calls.length }) };
}

it('exports the exact integration factory', () => {
  expectTypeOf(createSceneRuntime).toEqualTypeOf<(options: {
    map: mapboxgl.Map;
    overlayRoot: HTMLElement;
    resolveAsset(assetId: string, signal?: AbortSignal): Promise<ResolvedAssetAccess>;
  }) => SceneRuntime>();
});

it('loads resources before applying a paused zero frame', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  expect(harness.calls).toEqual([
    'map.load', 'model.load', 'overlay.load',
    'clock.duration:12000', 'map.apply:0', 'model.apply:0', 'map.trails:0', 'overlay.apply:0:paused'
  ]);
});

it('play unlocks media before starting the clock and pause freezes every component', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;
  await harness.runtime.play();
  expect(harness.calls.slice(0, 2)).toEqual(['overlay.unlock', 'clock.play']);
  harness.runtime.pause();
  expect(harness.calls).toContain('clock.pause');
  expect(harness.calls.at(-1)).toBe('overlay.apply:0:paused');
});

it('seek pauses, recomputes in map/model/trail/overlay order, and resumes only prior playback', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  await harness.runtime.play();
  harness.calls.length = 0;
  await harness.runtime.seek(6_000);
  expect(harness.calls).toEqual([
    'clock.pause', 'clock.seek:6000', 'map.apply:6000', 'model.apply:6000',
    'map.trails:6000', 'overlay.apply:6000:paused', 'clock.play'
  ]);
  harness.runtime.pause();
  harness.calls.length = 0;
  await harness.runtime.seek(2_000);
  expect(harness.calls).not.toContain('clock.play');
});

it('replay performs seek zero then play, and dispose aborts load and releases once', async () => {
  const harness = sceneRuntimeHarness();
  await harness.runtime.load(validConfig);
  harness.calls.length = 0;
  await harness.runtime.replay();
  expect(harness.calls).toContain('clock.seek:0');
  expect(harness.calls.at(-1)).toBe('clock.play');
  harness.runtime.dispose();
  harness.runtime.dispose();
  expect(harness.disposals()).toEqual({ clock: 1, map: 1, model: 1, overlay: 1, resources: 1 });
  await expect(harness.runtime.play()).rejects.toMatchObject({ code: 'RUNTIME_DISPOSED' });
});

it('rolls back all partial state when a critical load rejects', async () => {
  const harness = sceneRuntimeHarness({ modelLoadError: new Error('missing GLB') });
  await expect(harness.runtime.load(validConfig)).rejects.toThrow('missing GLB');
  expect(harness.disposals()).toMatchObject({ map: 1, model: 1, overlay: 1 });
});
```

- [ ] **Step 2: Run the scene runtime test and verify RED**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/SceneRuntime.test.ts`

Expected: FAIL because `SceneRuntime.ts` and `index.ts` do not exist.

- [ ] **Step 3: Implement atomic load and the six lifecycle methods**

`SceneRuntimeImpl` keeps states `idle | loading | ready | disposed`, one load `AbortController`, and the current config. `load()` first unloads a previous project, then creates fresh component instances, passes only visible discriminated tracks to each component, and commits ready state only after all critical loads succeed. It applies the initial frame synchronously after `clock.setDuration(config.totalDurationMs)`. Wire the component diagnostic sink to `overlayRoot.dispatchEvent(new CustomEvent<Diagnostic>('ise-runtime-diagnostic', { detail: diagnostic }))` so recoverable warnings remain structured without expanding the fixed factory signature.

Use one frame function for tick, seek, pause, and initial load:

```ts
private applyFrame(frame: RuntimeFrame) {
  this.mapRuntime.applyBase(frame.timeMs);
  const trails = this.modelRuntime.apply(frame.timeMs);
  this.mapRuntime.applyTrails(trails);
  this.overlayRuntime.apply(frame);
  this.options.overlayRoot.dataset.runtimeTimeMs = String(Math.round(frame.timeMs));
}
```

Implement lifecycle semantics exactly:

```ts
async play() {
  this.assertReady();
  if (!this.mediaUnlocked) {
    await this.overlayRuntime.unlockMedia();
    this.mediaUnlocked = true;
  }
  this.clock.play();
  this.applyFrame({ timeMs: this.clock.currentTimeMs, playing: true, forceMediaSeek: false });
}

pause() {
  if (this.state !== 'ready') return;
  this.clock.pause();
  this.applyFrame({ timeMs: this.clock.currentTimeMs, playing: false, forceMediaSeek: true });
}

async seek(timeMs: number) {
  this.assertReady();
  const resume = this.clock.isPlaying;
  if (resume) this.clock.pause();
  this.clock.seek(timeMs);
  this.applyFrame({ timeMs: this.clock.currentTimeMs, playing: false, forceMediaSeek: true });
  if (resume) this.clock.play();
}

async replay() {
  this.assertReady();
  this.clock.pause();
  this.clock.seek(0);
  this.applyFrame({ timeMs: 0, playing: false, forceMediaSeek: true });
  await this.play();
}
```

Clock subscription calls `applyFrame(frame)` for RAF ticks and completion. Guard against duplicate emissions from `clock.pause()`/`clock.seek()` by making those calls under a `suppressClockFrame` flag during lifecycle recomputation.

`dispose()` is idempotent: mark disposed first, abort the load, unsubscribe the clock, pause overlays, dispose child runtimes, resource manager, and clock, and delete runtime-owned dataset fields. A subsequent lifecycle call throws `RUNTIME_DISPOSED`; play/seek/replay before load throws `RUNTIME_NOT_LOADED`.

Export only the stable API in `index.ts`:

```ts
import { SceneRuntimeImpl } from './SceneRuntime';
import type { SceneRuntime, SceneRuntimeOptions } from './types';
export type { SceneRuntime, SceneRuntimeOptions } from './types';

export function createSceneRuntime(options: SceneRuntimeOptions): SceneRuntime {
  return new SceneRuntimeImpl(options);
}
```

- [ ] **Step 4: Run all runtime unit tests and typecheck to verify GREEN**

Run: `npm run test --workspace @ise/web -- --run src/runtime`

Expected: PASS for PlaybackClock, ResourceManager, trajectory, MapRuntime, ModelRuntime, OverlayRuntime, and SceneRuntime suites.

Run: `npm run typecheck --workspace @ise/web`

Expected: PASS.

- [ ] **Step 5: Commit the public runtime**

```bash
git add apps/web/src/runtime/SceneRuntime.ts apps/web/src/runtime/index.ts apps/web/src/runtime/__tests__/SceneRuntime.test.ts apps/web/src/runtime/__tests__/helpers/fakes.ts
git commit -m "feat(web): compose scene runtime lifecycle"
```

### Task 8: Validated Real Asset Fixtures (Wave 1)

**Files:**
- Create: `apps/web/src/runtime/testing/runtimeFixtures.ts`
- Create: `apps/web/src/runtime/__tests__/runtimeFixtures.test.ts`

**Interfaces:**
- Consumes: `SceneProjectConfig` and the stable asset IDs in Global Constraints; it has no page, router, Playwright config, or live resolver dependency.
- Produces: `RUNTIME_MAIN_CONFIG`, `RUNTIME_CATALOG_CONFIG`, and `RUNTIME_CATALOG_ASSET_IDS` for the Web/API-owned harness to import after workstream integration.

- [ ] **Step 1: Write a failing fixture coverage test**

```ts
import { expect, it } from 'vitest';
import { RUNTIME_CATALOG_ASSET_IDS, RUNTIME_CATALOG_CONFIG, RUNTIME_MAIN_CONFIG } from '../testing/runtimeFixtures';

it('references every required real asset without URLs', () => {
  expect(RUNTIME_CATALOG_ASSET_IDS.models).toHaveLength(6);
  expect(RUNTIME_CATALOG_ASSET_IDS.videos).toHaveLength(8);
  expect(RUNTIME_CATALOG_ASSET_IDS.images).toHaveLength(4);
  expect(RUNTIME_CATALOG_ASSET_IDS.trajectories).toEqual([
    'trajectory:ambala-rafale-1', 'trajectory:minhas-j10ce-1', 'trajectory:pakistan-missile-1'
  ]);
  const serialized = JSON.stringify(RUNTIME_CATALOG_CONFIG);
  Object.values(RUNTIME_CATALOG_ASSET_IDS).flat().forEach((assetId) => expect(serialized).toContain(assetId));
  expect(serialized).not.toMatch(/https?:|blob:|[A-Z]:\\/);
  expect(RUNTIME_MAIN_CONFIG.schemaVersion).toBe('ise-scene/v1');
});
```

- [ ] **Step 2: Run the fixture test and verify RED**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/runtimeFixtures.test.ts`

Expected: FAIL because `testing/runtimeFixtures.ts` does not exist.

- [ ] **Step 3: Add complete validated main and catalog fixture builders**

Define the catalog constants exactly:

```ts
export const RUNTIME_CATALOG_ASSET_IDS = {
  models: ['model:j10', 'model:jf17', 'model:mig29', 'model:pl15e', 'model:rafale', 'model:su30mki'],
  videos: ['video:ooda-chain', 'video:runway-exit', 'video:missile-impact', 'video:cockpit-jamming',
    'video:damage-check', 'video:bomb-explosion', 'video:radar-offline', 'video:target-lock'],
  images: ['image:ground-radar', 'image:cockpit-hud', 'image:airport', 'image:aew-illustration'],
  trajectories: ['trajectory:ambala-rafale-1', 'trajectory:minhas-j10ce-1', 'trajectory:pakistan-missile-1']
} as const;
```

Build `RUNTIME_MAIN_CONFIG` with total duration `12_000`, entities `rafale-main`, `j10-main`, and `pl15e-main`, their corresponding model/default trajectory IDs, and normal initial state. Include these exact events:

- camera at `0..1_000` targeting `[76.8165,30.4120]`, zoom `12`, pitch `55`, bearing `0`;
- Rafale `model.spawn`/`model.follow_path` at `1_000..4_000` on `trajectory:ambala-rafale-1`;
- camera and J-10 `model.spawn`/`model.follow_path` at `4_000..7_000` on `trajectory:minhas-j10ce-1`;
- camera and PL-15E `model.spawn`/`model.follow_path` at `7_000..10_000` on `trajectory:pakistan-missile-1`;
- `image:cockpit-hud` at `0..4_000` with layout `{xPct:70,yPct:5,widthPct:25,heightPct:30,zIndex:20,opacity:0.9,fit:'contain'}` and fade entry/exit;
- `video:missile-impact` at `7_000..11_000` with layout `{xPct:65,yPct:5,widthPct:30,heightPct:32,zIndex:30,opacity:1,fit:'cover'}`, volume `0.3`, playbackRate `1`, loop `false`;
- bottom subtitle `Runtime synchronized acceptance` at `500..11_500`, max width `70`.

Every item uses `eventUnitId:'fixture-runtime'` and `evidenceRefs:['fixture:e2e']`. Use deterministic IDs; do not call `crypto.randomUUID()`.

Build `RUNTIME_CATALOG_CONFIG` with six entities and model actions so all six GLBs and all three trajectories load; assign `pl15e` kind `missile` and the other models kind `aircraft`. Add all eight videos and four images as non-overlapping items with the shared acceptance layouts. Because runtime load is atomic and video/image load waits for browser metadata/decode, harness status `ready` proves that all 21 registered assets loaded.

- [ ] **Step 4: Run fixture test and shared schema validation to verify GREEN**

Run: `npm run test --workspace @ise/web -- --run src/runtime/__tests__/runtimeFixtures.test.ts`

Expected: PASS, 1 test.

Run: `npm run typecheck --workspace @ise/web`

Expected: PASS, proving both fixtures satisfy the discriminated shared types.

- [ ] **Step 5: Commit the Wave 1 fixture contract**

```bash
git add apps/web/src/runtime/testing/runtimeFixtures.ts apps/web/src/runtime/__tests__/runtimeFixtures.test.ts
git commit -m "test(web): add runtime acceptance fixtures"
```

### Task 9: Playwright Canvas-Pixel Acceptance (Wave 2 Only)

**Files:**
- Create: `apps/web/e2e/runtime-rendering.spec.ts`
- Modify only when a failing browser assertion identifies a runtime-owned defect: `apps/web/src/runtime/MapRuntime.ts`
- Modify only when a failing browser assertion identifies a runtime-owned defect: `apps/web/src/runtime/ModelRuntime.ts`
- Modify only when a failing browser assertion identifies a runtime-owned defect: `apps/web/src/runtime/OverlayRuntime.ts`
- Modify only when a failing browser assertion identifies a runtime-owned defect: `apps/web/src/runtime/SceneRuntime.ts`

**Interfaces:**
- Consumes: merged Web/API-owned `apps/web/playwright.config.ts`, `/runtime-harness`, its fixed controls/status selectors, real Mapbox, seeded resolver access, `RUNTIME_MAIN_CONFIG`, and `RUNTIME_CATALOG_CONFIG`.
- Produces: desktop/mobile browser evidence for nonblank canvas pixels, visible GLBs, deterministic play/pause/seek/replay, synchronized media, non-overlapping overlays, and all 21 catalog resources.

- [ ] **Step 1: Verify the Wave 2 prerequisite before writing the spec**

Run: `Test-Path apps/web/playwright.config.ts; Select-String -Path apps/web/src/router/index.tsx -Pattern 'runtime-harness'`

Expected: print `True` and at least one router match. If either check fails, stop this task because the Web/API workstream has not merged; Tasks 1 through 8 remain independently complete.

- [ ] **Step 2: Write the failing real-browser acceptance test**

Create `runtime-rendering.spec.ts` with this pixel sampler and two specs. The Web-owned Playwright config runs both specs in its desktop Chromium and mobile Chromium projects:

```ts
import { expect, test, type Locator } from '@playwright/test';

async function sampleCanvas(canvas: Locator, slot: string) {
  return canvas.evaluate(async (node: HTMLCanvasElement, key) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const gl = node.getContext('webgl2') ?? node.getContext('webgl');
    if (!gl) throw new Error('WebGL context unavailable');
    const pixels = new Uint8Array(node.width * node.height * 4);
    gl.readPixels(0, 0, node.width, node.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonZero = 0;
    let changed = 0;
    const buckets = new Set<number>();
    const store = window as typeof window & { __runtimePixels?: Record<string, Uint8Array> };
    const previous = store.__runtimePixels?.[key];
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (a > 0 && r + g + b > 12) nonZero += 1;
      buckets.add((r >> 5) * 64 + (g >> 5) * 8 + (b >> 5));
      if (previous && Math.abs(r - previous[i]) + Math.abs(g - previous[i + 1]) + Math.abs(b - previous[i + 2]) > 30) changed += 1;
    }
    store.__runtimePixels ??= {};
    store.__runtimePixels[key] = pixels;
    return { total: node.width * node.height, nonZero, colorBuckets: buckets.size, changed };
  }, slot);
}

test('runtime-main renders and restores', async ({ page }, testInfo) => {
    const viewportName = testInfo.project.name;
    await page.goto('/runtime-harness?fixture=runtime-main');
    await expect(page.getByTestId('runtime-status')).toHaveText('ready');
    const canvas = page.getByTestId('runtime-map').locator('canvas.mapboxgl-canvas');
    await expect(canvas).toBeVisible();
    const baseline = await sampleCanvas(canvas, `${viewportName}-model`);
    expect(baseline.nonZero / baseline.total).toBeGreaterThan(0.1);
    expect(baseline.colorBuckets).toBeGreaterThan(8);

    const seek = page.getByTestId('runtime-seek');
    await seek.fill('1200');
    await seek.dispatchEvent('change');
    await expect(page.getByTestId('runtime-time')).toHaveText('1200');
    const withRafale = await sampleCanvas(canvas, `${viewportName}-model`);
    expect(withRafale.changed).toBeGreaterThan(200);

    await page.getByTestId('runtime-play').click();
    await expect.poll(async () => Number(await page.getByTestId('runtime-time').textContent())).toBeGreaterThan(1200);
    await page.getByTestId('runtime-pause').click();
    const paused = Number(await page.getByTestId('runtime-time').textContent());
    await page.waitForTimeout(150);
    expect(Number(await page.getByTestId('runtime-time').textContent())).toBe(paused);

    await seek.fill('7500');
    await seek.dispatchEvent('change');
    const video = page.getByTestId('runtime-overlay').locator('video[data-runtime-kind="video"]');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(0.5, 1);
    await page.getByTestId('runtime-replay').click();
    await expect.poll(async () => Number(await page.getByTestId('runtime-time').textContent())).toBeLessThan(300);

    const controls = await Promise.all(['runtime-play','runtime-pause','runtime-seek','runtime-replay'].map((id) => page.getByTestId(id).boundingBox()));
    const overlays = await page.getByTestId('runtime-overlay').locator('[data-runtime-kind]:visible').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    for (const overlay of overlays) for (const control of controls) if (control) {
      const width = Math.max(0, Math.min(overlay.right, control.x + control.width) - Math.max(overlay.left, control.x));
      const height = Math.max(0, Math.min(overlay.bottom, control.y + control.height) - Math.max(overlay.top, control.y));
      expect(width * height).toBe(0);
    }
});

test('runtime-catalog parses and decodes all registered assets', async ({ page }) => {
  await page.goto('/runtime-harness?fixture=runtime-catalog');
  await expect(page.getByTestId('runtime-status')).toHaveText('ready', { timeout: 60_000 });
  await expect(page.getByTestId('runtime-map').locator('canvas.mapboxgl-canvas')).toBeVisible();
  await expect(page.getByTestId('runtime-overlay').locator('[data-runtime-kind="image"]')).toHaveCount(4);
  await expect(page.getByTestId('runtime-overlay').locator('video[data-runtime-kind="video"]')).toHaveCount(8);
});
```

- [ ] **Step 3: Run Playwright on the merged Wave 2 branch and verify RED before the final integration fixes**

Run: `npm run test:e2e --workspace @ise/web -- e2e/runtime-rendering.spec.ts`

Expected: FAIL on at least one rendering/status assertion until the real resolver, Mapbox calibration, and harness/runtime integration are exercised together. A missing token or seed asset is a test failure, not a skip.

- [ ] **Step 4: Fix only runtime-owned defects exposed by Playwright**

Permitted fixes are limited to `apps/web/src/runtime/**`: Three.js axis/rotation composition, resource decode sequencing, canvas repaint, deterministic camera values, overlay layout, and lifecycle ordering. A resolver response mismatch, missing seed asset, absent selector, page overlap outside the overlay root, or harness bug belongs to the base/Web integration owner and must be fixed there before rerunning; do not edit pages from this branch.

- [ ] **Step 5: Run complete verification and verify GREEN**

Run: `npm run test --workspace @ise/web -- --run src/runtime`

Expected: PASS for all runtime unit suites.

Run: `npm run typecheck --workspace @ise/web`

Expected: PASS.

Run: `npm run test:e2e --workspace @ise/web -- e2e/runtime-rendering.spec.ts`

Expected: PASS, 4 project executions (2 specs across desktop Chromium and mobile Chromium). Both viewport projects have canvas non-zero ratio above `0.1`, more than `8` color buckets, a Rafale seek changing more than `200` pixels, synchronized video time, unobscured controls, and all 21 real catalog assets loaded.

- [ ] **Step 6: Commit real rendering acceptance**

```bash
git add apps/web/e2e/runtime-rendering.spec.ts apps/web/src/runtime/MapRuntime.ts apps/web/src/runtime/ModelRuntime.ts apps/web/src/runtime/OverlayRuntime.ts apps/web/src/runtime/SceneRuntime.ts
git commit -m "test(web): verify real scene runtime rendering"
```

## Integration Risks

- The current repository has no npm `three` or Playwright dependency. The base migration must land the exact prerequisite versions and lockfile before this plan can execute without violating runtime file ownership.
- `ResolvedAssetAccess`, model/trajectory metadata, and `/runtime-harness` are cross-plan contracts. Type or selector drift blocks compilation or Playwright and must be corrected by the shared/Web owner, not locally duplicated.
- The raw `AMBALA Su-30MKI-1.json` source contains a decreasing timestamp. It cannot become a valid `ise-trajectory/v1` asset merely by asserting `monotonic:true`; seed import must reject or deterministically rebuild it before `runtime-catalog` can pass.
- MP4 codec/duration could not be inspected because `ffprobe` is unavailable. Browser `loadedmetadata`/`error` in `runtime-catalog` is the authoritative decode gate.
- Real model forward axes vary. `rotationOffsetDeg` must be calibrated in the registry for all six GLBs; runtime applies it exactly and never hides a bad registry entry with defaults.
- `gl.readPixels` depends on a real WebGL context and completed Mapbox render. CI needs Chromium GPU/WebGL support and a valid Mapbox token; software WebGL is acceptable only when it produces the same nonblank/pixel-difference assertions.
