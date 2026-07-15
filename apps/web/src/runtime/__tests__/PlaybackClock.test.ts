import { describe, expect, expectTypeOf, it } from 'vitest';
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
