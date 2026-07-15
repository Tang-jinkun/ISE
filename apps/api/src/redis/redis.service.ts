import { Injectable, OnModuleDestroy } from '@nestjs/common';

type StoreValue = {
  value: string;
  expiresAt: number | null;
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly store = new Map<string, StoreValue>();

  async set(key: string, value: string, ttlSeconds?: number) {
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string) {
    this.store.delete(key);
  }

  async onModuleDestroy() {
    this.store.clear();
  }
}
