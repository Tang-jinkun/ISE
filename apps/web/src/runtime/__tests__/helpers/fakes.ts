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
