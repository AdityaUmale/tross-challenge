import type { Config } from '../config.js';
import {
  AuthExpiredError,
  ProfileNotFoundError,
  RateLimitedError,
  UpstreamError,
  isAppError,
} from '../errors.js';
import type { NormalizedPayload } from './graph.js';
import { SessionPool, Semaphore } from './pool.js';
import { applySetCookies, serializeCookies, type LinkedInSession } from './session.js';

const VOYAGER_BASE = 'https://www.linkedin.com/voyager/api';
const MAX_REDIRECT_HOPS = 3;

export interface RequestContext {
  /** What we were fetching, so a 404 can name the profile. */
  identifier?: string;
  /** Sent as Referer; LinkedIn is likelier to serve a request that looks navigational. */
  referer?: string;
}

/**
 * The minimal header set Voyager accepts, established by replaying a captured
 * browser request and removing headers until it broke.
 *
 * `accept: application/vnd.linkedin.normalized+json+2.1` is the important one:
 * it switches the response from deeply-nested objects to the flat
 * `{data, included[]}` graph that graph.ts indexes.
 */
export function voyagerHeaders(csrfToken: string, config: Config, ctx: RequestContext = {}) {
  return {
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    'accept-language': 'en-US,en;q=0.9',
    'csrf-token': csrfToken,
    'x-restli-protocol-version': '2.0.0',
    'x-li-lang': 'en_US',
    'x-li-track': JSON.stringify({
      clientVersion: config.clientVersion,
      mpVersion: config.clientVersion,
      osName: 'web',
      timezoneOffset: 0,
      timezone: 'UTC',
      deviceFormFactor: deviceFormFactor(config.userAgent),
      mpName: 'voyager-web',
    }),
    'user-agent': config.userAgent,
    referer: ctx.referer ?? 'https://www.linkedin.com/feed/',
  } satisfies Record<string, string>;
}


/**
 * True when a response deletes the session cookie. LinkedIn signals an
 * invalidated session this way — a 302 carrying `li_at=delete me; Max-Age=0` —
 * rather than with a 401.
 */
function clearsSessionCookie(res: Response): boolean {
  return res.headers
    .getSetCookie()
    .some((c) => /^li_at=/i.test(c) && /Max-Age=0|Expires=Thu, 01[- ]Jan[- ]1970/i.test(c));
}

/**
 * `x-li-track` announces a form factor, and it has to agree with the
 * User-Agent. Claiming DESKTOP while sending a mobile UA is a contradictory
 * fingerprint, and LinkedIn treats mismatched clients as automated.
 */
function deviceFormFactor(userAgent: string): 'DESKTOP' | 'MOBILE' | 'TABLET' {
  if (/\biPad\b|\bTablet\b/i.test(userAgent)) return 'TABLET';
  if (/\bMobi|\bAndroid\b|\biPhone\b/i.test(userAgent)) return 'MOBILE';
  return 'DESKTOP';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter, so retries from parallel calls do not align. */
function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 8000);
  return base + Math.random() * 400;
}

export class VoyagerClient {
  private readonly semaphore: Semaphore;

  constructor(
    private readonly config: Config,
    readonly pool: SessionPool,
  ) {
    this.semaphore = new Semaphore(config.maxConcurrency);
  }

  /**
   * GETs a Voyager path (relative to /voyager/api) and returns the normalized
   * payload. Retries transient failures; raises a typed AppError otherwise.
   */
  async get(path: string, ctx: RequestContext = {}): Promise<NormalizedPayload> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const session = await this.pool.acquire();
      try {
        return await this.semaphore.run(() => this.attempt(session, path, ctx));
      } catch (err) {
        lastError = err;

        // A dead cookie or a missing profile will not improve with a retry.
        if (isAppError(err)) {
          switch (err.code) {
            case 'PROFILE_NOT_FOUND':
              throw err;
            case 'AUTH_EXPIRED':
              session.kill();
              throw err;
            case 'RATE_LIMITED':
              session.cooldown(this.config.cooldownMs);
              break;
          }
        }
        if (attempt < this.config.maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
      }
    }

    if (isAppError(lastError)) throw lastError;
    throw new UpstreamError(
      `LinkedIn request failed after ${this.config.maxRetries + 1} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      { path },
    );
  }

  private async attempt(
    session: LinkedInSession,
    path: string,
    ctx: RequestContext,
  ): Promise<NormalizedPayload> {
    let url = path.startsWith('http') ? path : `${VOYAGER_BASE}${path}`;

    // LinkedIn answers with a redirect back to the same URL when it wants to
    // pin the session to a datacenter: the response carries an updated `lidc`
    // cookie and the request is expected to be replayed with it. Redirects stay
    // manual so a login or checkpoint bounce is still distinguishable from
    // this, but the affinity hop has to be followed or nothing ever succeeds.
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const res = await this.send(session, url, ctx, path);

      // Keep rotating cookies (notably lidc) current.
      applySetCookies(session.jar, res.headers.getSetCookie());

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location') ?? '';
        if (/\/checkpoint\/|\/uas\/login|\/authwall/i.test(location)) {
          throw new AuthExpiredError(
            'LinkedIn redirected to a login or security checkpoint. The cookie is expired or the account needs verification in a browser.',
          );
        }
        if (!location) {
          throw new UpstreamError('LinkedIn sent a redirect with no location.', { path, status: res.status });
        }
        // A redirect that also expires li_at is LinkedIn invalidating the
        // session rather than steering the request. It loops forever if
        // followed, so report it as what it is.
        if (clearsSessionCookie(res)) {
          throw new AuthExpiredError(
            'LinkedIn expired the session cookie while serving this request. ' +
              'The li_at value is no longer valid — sign in again in a browser, clear any security checkpoint, and copy a fresh cookie.',
          );
        }
        url = new URL(location, url).toString();
        continue;
      }

      this.classify(res, session, path, ctx);
      return await this.readJson(res, path);
    }

    throw new UpstreamError(
      `LinkedIn kept redirecting after ${MAX_REDIRECT_HOPS} hops without serving a response.`,
      { path },
    );
  }

  private async send(
    session: LinkedInSession,
    url: string,
    ctx: RequestContext,
    path: string,
  ): Promise<Response> {
    const csrf = session.csrfToken;
    if (!csrf) throw new AuthExpiredError('Session has no CSRF token.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          ...voyagerHeaders(csrf, this.config, ctx),
          cookie: serializeCookies(session.jar),
        },
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new UpstreamError(`LinkedIn request timed out after ${this.config.timeoutMs}ms.`, { path });
      }
      throw new UpstreamError(
        `Network error calling LinkedIn: ${err instanceof Error ? err.message : String(err)}`,
        { path },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async readJson(res: Response, path: string): Promise<NormalizedPayload> {
    const text = await res.text();
    if (!text.trim()) {
      throw new UpstreamError('LinkedIn returned an empty body.', { path, status: res.status });
    }
    try {
      return JSON.parse(text) as NormalizedPayload;
    } catch {
      // An HTML body here almost always means we were served a login or
      // challenge page without an explicit redirect status.
      if (/^\s*<(!doctype|html)/i.test(text)) {
        throw new AuthExpiredError('LinkedIn returned an HTML page instead of JSON — the session is not logged in.');
      }
      throw new UpstreamError('LinkedIn returned a body that is not JSON.', {
        path,
        preview: text.slice(0, 200),
      });
    }
  }

  /** Maps an upstream response onto our typed errors. Returns for 2xx. */
  private classify(res: Response, session: LinkedInSession, path: string, ctx: RequestContext): void {
    const { status } = res;

    if (status >= 200 && status < 300) return;

    if (status === 401 || status === 403) {
      throw new AuthExpiredError(`LinkedIn rejected the session (HTTP ${status}).`);
    }

    // 999 is LinkedIn's bot-detection status. It is not documented and not a
    // standard code, and in practice it is the failure you hit from a
    // datacenter IP rather than a residential one.
    if (status === 999) {
      session.cooldown(this.config.cooldownMs);
      throw new RateLimitedError(
        'LinkedIn blocked the request (HTTP 999, bot detection). The session is cooling down.',
        { path, status },
      );
    }

    if (status === 429) {
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      throw new RateLimitedError('LinkedIn throttled the request (HTTP 429).', {
        path,
        ...(Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter } : {}),
      });
    }

    if (status === 404) {
      throw new ProfileNotFoundError(ctx.identifier ?? path);
    }

    throw new UpstreamError(`LinkedIn returned HTTP ${status}.`, { path, status });
  }

  /**
   * Cheap liveness probe: /voyager/api/me identifies the logged-in member.
   * Used by /health and by the probe tool to prove a cookie works before
   * anything else is attempted.
   */
  async verifySession(): Promise<{ ok: true; publicIdentifier: string | null }> {
    const payload = await this.get('/me', { identifier: 'me' });
    const included = Array.isArray(payload.included) ? payload.included : [];
    for (const entity of included) {
      if (entity && typeof entity === 'object') {
        const pid = (entity as Record<string, unknown>)['publicIdentifier'];
        if (typeof pid === 'string') return { ok: true, publicIdentifier: pid };
      }
    }
    return { ok: true, publicIdentifier: null };
  }
}
