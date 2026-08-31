import type { Config } from '../config.js';
import { NoHealthySessionError } from '../errors.js';
import { LinkedInSession } from './session.js';

/**
 * Round-robin pool of LinkedIn sessions.
 *
 * With one cookie this is a thin wrapper; with several it lets a 999 take one
 * session out of rotation for a cooldown instead of taking the service down.
 */
export class SessionPool {
  private readonly sessions: LinkedInSession[];
  private cursor = 0;

  constructor(private readonly config: Config) {
    this.sessions = config.sessions.map(
      (creds, i) => new LinkedInSession(`session-${i + 1}`, creds, config.userAgent, config.timeoutMs),
    );
  }

  get size(): number {
    return this.sessions.length;
  }

  get availableCount(): number {
    return this.sessions.filter((s) => s.isAvailable).length;
  }

  /** True when at least one session could serve a request right now. */
  get healthy(): boolean {
    return this.availableCount > 0;
  }

  /**
   * Next available session, bootstrapped and ready to sign a request.
   * Throws 503 rather than queueing: a caller would rather be told the service
   * has no working cookie than hang waiting for a cooldown to lapse.
   */
  async acquire(): Promise<LinkedInSession> {
    if (this.sessions.length === 0) {
      throw new NoHealthySessionError('No LinkedIn session is configured. Set LI_AT.');
    }

    for (let i = 0; i < this.sessions.length; i++) {
      const session = this.sessions[(this.cursor + i) % this.sessions.length];
      if (!session?.isAvailable) continue;
      this.cursor = (this.cursor + i + 1) % this.sessions.length;
      await session.ensureReady();
      return session;
    }

    const anyDead = this.sessions.every((s) => s.state === 'dead');
    throw new NoHealthySessionError(
      anyDead
        ? 'Every configured LinkedIn cookie has been rejected. Refresh LI_AT.'
        : 'All LinkedIn sessions are cooling down after rate limiting. Try again shortly.',
    );
  }

  /** Per-session status for /health. Contains no secrets. */
  describe() {
    return {
      configured: this.sessions.length,
      available: this.availableCount,
      sessions: this.sessions.map((s) => s.describe()),
    };
  }
}

/**
 * Caps how many requests are in flight against LinkedIn at once.
 * Steady low concurrency is tolerated far better than bursts.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
