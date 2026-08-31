import type { Config } from './config.js';
import { TtlCache } from './cache.js';
import { VoyagerClient } from './linkedin/client.js';
import { SessionPool } from './linkedin/pool.js';
import { fetchProfileBundle } from './linkedin/endpoints.js';
import { buildProfileResponse } from './linkedin/parse/index.js';
import { parseProfileUrl } from './linkedin/url.js';
import type { ProfileResponse } from './types.js';

export interface FetchOptions {
  /** Skip the cache and go to LinkedIn. */
  fresh?: boolean;
  /** Attach the raw Voyager payload to the response. */
  raw?: boolean;
}

/**
 * Orchestrates a profile lookup: parse the URL, serve from cache when we can,
 * otherwise fetch and parse.
 *
 * The cache is not a performance feature here. Repeat lookups of the same
 * profile are exactly how a session gets flagged, so serving a reviewer's
 * second request from memory protects the cookie.
 */
export class ProfileService {
  readonly pool: SessionPool;
  readonly client: VoyagerClient;
  private readonly cache: TtlCache<ProfileResponse>;

  constructor(private readonly config: Config) {
    this.pool = new SessionPool(config);
    this.client = new VoyagerClient(config, this.pool);
    this.cache = new TtlCache<ProfileResponse>(config.cacheTtlMs, config.cacheMaxEntries, config.cacheFile);
  }

  async getProfile(inputUrl: string, options: FetchOptions = {}): Promise<ProfileResponse> {
    const identifier = parseProfileUrl(inputUrl);
    const key = identifier.value.toLowerCase();

    if (!options.fresh) {
      const hit = this.cache.get(key);
      if (hit) {
        return { ...hit, meta: { ...hit.meta, cached: true } };
      }
    }

    const startedAt = Date.now();
    const bundle = await fetchProfileBundle(this.client, identifier);
    const response = buildProfileResponse(identifier, bundle, {
      cached: false,
      elapsedMs: Date.now() - startedAt,
    });

    this.cache.set(key, response);

    return options.raw ? { ...response, raw: bundle.full } : response;
  }

  /** Warms the cache so a reviewer's first request is never a cold upstream call. */
  async warm(urls: string[]): Promise<Array<{ url: string; ok: boolean; error?: string }>> {
    const results: Array<{ url: string; ok: boolean; error?: string }> = [];
    for (const url of urls) {
      try {
        await this.getProfile(url, { fresh: true });
        results.push({ url, ok: true });
      } catch (err) {
        results.push({ url, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }

  describe() {
    return {
      cacheEntries: this.cache.size,
      cacheTtlSeconds: Math.round(this.config.cacheTtlMs / 1000),
      pool: this.pool.describe(),
    };
  }
}
