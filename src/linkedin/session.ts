import type { SessionCredentials } from '../config.js';

/**
 * Cookie handling for a Voyager session.
 *
 * The only secret an operator supplies is `li_at`. Everything else is minted
 * here: hitting linkedin.com once with `li_at` alone returns a `JSESSIONID` in
 * `Set-Cookie`, and the `csrf-token` header is that value with its surrounding
 * quotes stripped.
 *
 * Bootstrapping rather than pasting a second cookie buys three things: one
 * secret to manage instead of two, a CSRF token that is always current, and —
 * the part that actually matters in production — a live `lidc` datacenter
 * affinity cookie, which measurably reduces HTTP 999 bot-detection responses.
 */

export type CookieJar = Map<string, string>;

/** Cookies LinkedIn rotates that are worth carrying between requests. */
const TRACKED = new Set(['li_at', 'JSESSIONID', 'lidc', 'bcookie', 'bscookie', 'liap', 'li_rm', 'lang']);

export function serializeCookies(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Applies a response's Set-Cookie headers to the jar, keeping quoting intact. */
export function applySetCookies(jar: CookieJar, setCookies: string[]): void {
  for (const header of setCookies) {
    const pair = header.split(';', 1)[0];
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;

    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!TRACKED.has(name)) continue;
    // A deletion looks like an empty value; do not let it clobber a live cookie.
    if (!value || value === '""') continue;
    jar.set(name, value);
  }
}

/**
 * Parses a Cookie header copied from a real request, e.g.
 * `li_at=AQED…; JSESSIONID="ajax:123"; bcookie="v=2&…"; lidc="b=…"`.
 *
 * Preferred over supplying `li_at` alone: the browser's own jar carries
 * bcookie, bscookie, lidc and liap, which is what a logged-in client looks
 * like, and it removes the need to synthesise a session with an extra request.
 */
export function parseCookieHeader(header: string): CookieJar {
  const jar: CookieJar = new Map();
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && value) jar.set(name, value);
  }
  return jar;
}

/** `"ajax:1234"` -> `ajax:1234`. The header must not carry the quotes. */
/** A JSESSIONID in LinkedIn's own format, for the double-submit CSRF check. */
function mintJsessionId(): string {
  let digits = '';
  for (let i = 0; i < 19; i++) digits += Math.floor(Math.random() * 10);
  return `"ajax:${digits}"`;
}

export function csrfFromJsessionId(jsessionId: string): string {
  return jsessionId.replace(/^"+|"+$/g, '');
}

export type SessionState = 'fresh' | 'ready' | 'cooling' | 'dead';

export class LinkedInSession {
  readonly id: string;
  readonly jar: CookieJar = new Map();
  private csrf: string | null = null;
  private cooldownUntil = 0;
  private dead = false;
  private bootstrapping: Promise<void> | null = null;

  constructor(
    id: string,
    credentials: SessionCredentials,
    private readonly userAgent: string,
    private readonly timeoutMs: number,
  ) {
    this.id = id;

    if (credentials.cookieHeader) {
      for (const [k, v] of parseCookieHeader(credentials.cookieHeader)) this.jar.set(k, v);
    }
    if (credentials.liAt) this.jar.set('li_at', credentials.liAt);

    if (credentials.jsessionId) {
      const quoted = /^".*"$/.test(credentials.jsessionId)
        ? credentials.jsessionId
        : `"${credentials.jsessionId}"`;
      this.jar.set('JSESSIONID', quoted);
      this.csrf = csrfFromJsessionId(credentials.jsessionId);
    }
  }

  get state(): SessionState {
    if (this.dead) return 'dead';
    if (Date.now() < this.cooldownUntil) return 'cooling';
    return this.csrf ? 'ready' : 'fresh';
  }

  get isAvailable(): boolean {
    return !this.dead && Date.now() >= this.cooldownUntil;
  }

  get csrfToken(): string | null {
    return this.csrf;
  }

  /** Cools the session off after a 999 or 429 so we stop hammering with it. */
  cooldown(ms: number): void {
    this.cooldownUntil = Date.now() + ms;
  }

  /** Marks the cookie permanently unusable — expired, or challenged. */
  kill(): void {
    this.dead = true;
    this.csrf = null;
  }

  /** Forces the next request to re-derive a CSRF token. */
  invalidateCsrf(): void {
    this.csrf = null;
  }

  /** Ensures a CSRF token exists, bootstrapping once even under concurrency. */
  async ensureReady(): Promise<void> {
    if (this.csrf) return;
    this.bootstrapping ??= this.bootstrap().finally(() => {
      this.bootstrapping = null;
    });
    await this.bootstrapping;
  }

  /**
   * Establishes a CSRF token for the session.
   *
   * LinkedIn validates CSRF by double submission: the `csrf-token` header only
   * has to match the `JSESSIONID` cookie sent alongside it. The value does not
   * have to be server-issued.
   *
   * So we ask for one first — a server-issued token also warms `lidc` and
   * `bcookie`, which reduces HTTP 999 responses — but when LinkedIn answers a
   * page request without setting one, which it does intermittently, we mint our
   * own instead of failing. Authentication comes from `li_at`; this token only
   * satisfies the CSRF check.
   */
  private async bootstrap(): Promise<void> {
    // A pasted browser jar already carries a server-issued JSESSIONID, so
    // there is nothing to warm up. Making the request anyway would be an extra
    // non-browser call against the session for no gain.
    if (!this.jar.has('JSESSIONID')) {
      try {
        await this.requestSessionCookies();
      } catch {
        // Not fatal; li_at still carries the authentication.
      }
    }

    let jsessionId = this.jar.get('JSESSIONID');
    if (!jsessionId) {
      jsessionId = mintJsessionId();
      this.jar.set('JSESSIONID', jsessionId);
    }
    this.csrf = csrfFromJsessionId(jsessionId);
  }

  /** One page load carrying only `li_at`, purely for its Set-Cookie response. */
  private async requestSessionCookies(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch('https://www.linkedin.com/', {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          cookie: serializeCookies(this.jar),
          'user-agent': this.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      applySetCookies(this.jar, res.headers.getSetCookie());
    } finally {
      clearTimeout(timer);
    }
  }

  /** Safe to expose on /health — reveals no cookie material. */
  describe() {
    return {
      id: this.id,
      state: this.state,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - Date.now()),
    };
  }
}
