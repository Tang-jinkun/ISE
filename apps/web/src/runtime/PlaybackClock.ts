import type { FrameScheduler, PlaybackClockPort, RuntimeFrame } from './types';

const browserScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
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

  get currentTimeMs() {
    return this.timeMs;
  }

  get isPlaying() {
    return this.playing;
  }

  setDuration(durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError('durationMs');
    }
    this.durationMs = durationMs;
    this.seek(this.timeMs);
  }

  subscribe(listener: (frame: RuntimeFrame) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play() {
    if (this.disposed || this.playing || this.timeMs >= this.durationMs) {
      return;
    }
    this.playing = true;
    this.startedAtMs = this.scheduler.now();
    this.startedFromMs = this.timeMs;
    this.schedule();
  }

  pause() {
    if (!this.playing) {
      return;
    }
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
    if (this.rafId !== undefined || !this.playing) {
      return;
    }
    this.rafId = this.scheduler.request((timestamp) => {
      this.rafId = undefined;
      this.timeMs = this.clamp(this.startedFromMs + timestamp - this.startedAtMs);
      if (this.timeMs >= this.durationMs) {
        this.playing = false;
      }
      this.emit(false);
      this.schedule();
    });
  }

  private emit(forceMediaSeek: boolean) {
    const frame = { timeMs: this.timeMs, playing: this.playing, forceMediaSeek };
    this.listeners.forEach((listener) => listener(frame));
  }

  private cancelFrame() {
    if (this.rafId === undefined) {
      return;
    }
    this.scheduler.cancel(this.rafId);
    this.rafId = undefined;
  }

  private clamp(value: number) {
    return Math.min(this.durationMs, Math.max(0, Number.isFinite(value) ? value : 0));
  }
}
