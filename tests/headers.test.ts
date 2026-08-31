import { describe, expect, it } from 'vitest';
import { voyagerHeaders } from '../src/linkedin/client.js';
import type { Config } from '../src/config.js';

const base = {
  clientVersion: '1.13.0',
  userAgent: '',
} as unknown as Config;

function track(userAgent: string) {
  const headers = voyagerHeaders('ajax:123', { ...base, userAgent });
  return JSON.parse(headers['x-li-track']) as { deviceFormFactor: string };
}

describe('voyagerHeaders', () => {
  it('sends the headers Voyager requires', () => {
    const h = voyagerHeaders('ajax:123', base);
    expect(h.accept).toBe('application/vnd.linkedin.normalized+json+2.1');
    expect(h['x-restli-protocol-version']).toBe('2.0.0');
    // The CSRF token must carry no quotation marks, unlike the cookie.
    expect(h['csrf-token']).toBe('ajax:123');
    expect(h['csrf-token']).not.toContain('"');
  });

  it('keeps the announced form factor consistent with the user agent', () => {
    expect(track('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131 Safari/537.36').deviceFormFactor).toBe('DESKTOP');
    expect(track('Mozilla/5.0 (Linux; Android 14; Pixel 9) Chrome/151 Mobile Safari/537.36').deviceFormFactor).toBe('MOBILE');
    expect(track('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148').deviceFormFactor).toBe('MOBILE');
    expect(track('Mozilla/5.0 (iPad; CPU OS 17_0) Safari/604.1').deviceFormFactor).toBe('TABLET');
  });
});
