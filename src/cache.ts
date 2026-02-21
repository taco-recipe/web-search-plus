type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TtlLruCache<T> {
  private readonly maxEntries: number;
  private readonly store: Map<string, CacheEntry<T>>;

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, maxEntries);
    this.store = new Map<string, CacheEntry<T>>();
  }

  get(key: string): T | undefined {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }

    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds: number): void {
    const expiresAt = Date.now() + Math.max(1, ttlSeconds) * 1000;
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt });

    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (!oldest) break;
      this.store.delete(oldest);
    }
  }
}
