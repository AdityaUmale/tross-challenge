import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * TTL + LRU cache. Deliberately in-process: this service answers a handful of
 * profiles, not a pipeline, and a Redis dependency would be more operational
 * surface than the problem deserves.
 *
 * The point is not speed. Repeatedly fetching the same profile is how a
 * LinkedIn session gets flagged, so a cache hit protects the cookie.
 *
 * Optionally backed by a file. A container restart would otherwise drop every
 * entry, and a cold cache plus an unhealthy session means a caller sees an
 * error where a recent answer exists.
 */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly file?: string,
  ) {
    if (file) this.load();
  }

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;

    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Re-insert so iteration order tracks recency for the LRU eviction below.
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
    this.persist();
  }

  /** Entries with their remaining lifetime, for /health. */
  describe(): Array<{ key: string; expiresInSeconds: number }> {
    const now = Date.now();
    return [...this.store.entries()]
      .filter(([, v]) => v.expiresAt > now)
      .map(([key, v]) => ({ key, expiresInSeconds: Math.round((v.expiresAt - now) / 1000) }));
  }

  private load(): void {
    if (!this.file) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Array<[string, { value: T; expiresAt: number }]>;
      const now = Date.now();
      for (const [key, entry] of raw) {
        if (entry?.expiresAt > now) this.store.set(key, entry);
      }
    } catch {
      // No snapshot yet, or an unreadable one. Starting empty is correct.
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Write then rename so a crash mid-write cannot leave a torn file.
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.store.entries()]));
      renameSync(tmp, this.file);
    } catch {
      // A cache that cannot be written is still a working cache.
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }
}
