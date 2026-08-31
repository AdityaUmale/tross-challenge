/**
 * Environment parsing. Fails fast and loudly at boot rather than at the first
 * request, and never echoes a secret value in an error message.
 */

function str(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`);
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be an integer, got "${raw}".`);
  return n;
}

/** Splits a comma-separated env var, dropping blanks. */
function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * One LinkedIn session. `jsessionId` is optional: the client bootstraps it from
 * li_at when absent, which also keeps the lidc datacenter cookie fresh.
 */
export interface SessionCredentials {
  liAt?: string;
  jsessionId?: string;
  /**
   * A complete Cookie header copied from a real Voyager request. Preferred
   * over `liAt`: it carries the browser's whole jar and needs no bootstrap.
   */
  cookieHeader?: string;
}

function buildSessions(): SessionCredentials[] {
  // A pasted Cookie header wins: it is the closest thing to what a browser
  // actually sends. Semicolons separate cookies, so these are newline-separated.
  const cookieHeaders = (process.env['LI_COOKIE'] ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (cookieHeaders.length) {
    return cookieHeaders.map((cookieHeader) => ({ cookieHeader }));
  }

  const liAts = list('LI_AT');
  const jsessions = list('LI_JSESSIONID');

  if (jsessions.length && jsessions.length !== liAts.length) {
    throw new Error(
      `LI_JSESSIONID has ${jsessions.length} value(s) but LI_AT has ${liAts.length}. ` +
        `Either omit LI_JSESSIONID entirely (recommended — it is bootstrapped automatically) ` +
        `or supply one per li_at in the same order.`,
    );
  }

  return liAts.map((liAt, i) => {
    const js = jsessions[i];
    return js ? { liAt, jsessionId: js } : { liAt };
  });
}

export interface Config {
  port: number;
  host: string;
  nodeEnv: string;
  logLevel: string;
  /** Empty means auth is disabled — intended for local development only. */
  apiKeys: string[];
  sessions: SessionCredentials[];
  userAgent: string;
  clientVersion: string;
  /** IANA zone reported in x-li-track. Should match the machine that owns the cookie. */
  timezone: string;
  timezoneOffset: number;
  maxConcurrency: number;
  maxRetries: number;
  timeoutMs: number;
  cooldownMs: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  /** Optional path to persist the cache across restarts. */
  cacheFile?: string;
}

export function loadConfig(): Config {
  const cfg: Config = {
    port: int('PORT', 8080),
    host: str('HOST', '0.0.0.0'),
    nodeEnv: str('NODE_ENV', 'development'),
    logLevel: str('LOG_LEVEL', 'info'),
    apiKeys: list('API_KEYS'),
    sessions: buildSessions(),
    userAgent: str(
      'LI_USER_AGENT',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ),
    clientVersion: str('LI_CLIENT_VERSION', '1.13.36270'),
    // A browser reports its real zone. UTC with a desktop UA reads as a server.
    timezone: str('LI_TIMEZONE', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    timezoneOffset: int('LI_TIMEZONE_OFFSET', -new Date().getTimezoneOffset() / 60),
    maxConcurrency: int('LI_MAX_CONCURRENCY', 2),
    maxRetries: int('LI_MAX_RETRIES', 3),
    timeoutMs: int('LI_TIMEOUT_MS', 20_000),
    cooldownMs: int('LI_COOLDOWN_MS', 15 * 60_000),
    cacheTtlMs: int('CACHE_TTL_SECONDS', 6 * 60 * 60) * 1000,
    cacheMaxEntries: int('CACHE_MAX_ENTRIES', 500),
  };
  const cacheFile = process.env['CACHE_FILE']?.trim();
  if (cacheFile) cfg.cacheFile = cacheFile;

  if (cfg.nodeEnv === 'production' && cfg.apiKeys.length === 0) {
    throw new Error('API_KEYS must be set in production; an unauthenticated LinkedIn proxy is not something to deploy.');
  }
  return cfg;
}

/** Safe to log and to return from /health — contains no secret material. */
export function describeConfig(cfg: Config) {
  return {
    nodeEnv: cfg.nodeEnv,
    sessionsConfigured: cfg.sessions.length,
    authEnabled: cfg.apiKeys.length > 0,
    maxConcurrency: cfg.maxConcurrency,
    cacheTtlSeconds: Math.round(cfg.cacheTtlMs / 1000),
  };
}
