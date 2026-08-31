import { describe, expect, it } from 'vitest';
import { EntityGraph } from '../src/linkedin/graph.js';
import { isLinkedInHost } from '../src/linkedin/client.js';
import { parseProfileUrl } from '../src/linkedin/url.js';
import { InvalidUrlError } from '../src/errors.js';

describe('redirect host allowlist', () => {
  it('accepts linkedin.com and its subdomains', () => {
    for (const host of ['www.linkedin.com', 'linkedin.com', 'in.linkedin.com']) {
      expect(isLinkedInHost(host), host).toBe(true);
    }
  });

  it('rejects hosts that merely contain or suffix linkedin.com', () => {
    // Following one of these would send li_at to a third party.
    for (const host of ['evil.com', 'linkedin.com.evil.com', 'notlinkedin.com', 'linkedin.co']) {
      expect(isLinkedInHost(host), host).toBe(false);
    }
  });
});

describe('prototype pollution', () => {
  it('does not let an upstream payload set Object.prototype', () => {
    const hostile = {
      data: { '*elements': ['urn:a'] },
      included: [
        {
          entityUrn: 'urn:a',
          $type: 'x.Profile',
          firstName: 'Real',
          __proto__: { polluted: 'yes' },
          constructor: { polluted: 'yes' },
        },
      ],
    };
    const graph = new EntityGraph(JSON.parse(JSON.stringify(hostile)));
    const out = graph.hydrate<Record<string, unknown>>(graph.rootElements()[0]!);

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    // Legitimate fields still come through.
    expect(out['firstName']).toBe('Real');
  });
});

describe('URL validation as an SSRF boundary', () => {
  it('refuses any host that is not linkedin.com', () => {
    for (const url of [
      'https://evil.com/in/foo',
      'https://linkedin.com.evil.com/in/foo',
      'http://169.254.169.254/in/foo',
      'https://localhost/in/foo',
    ]) {
      expect(() => parseProfileUrl(url), url).toThrow(InvalidUrlError);
    }
  });

  it('produces an identifier safe to interpolate into a Voyager path', () => {
    // Anything that could break out of the query parameter must be rejected
    // outright rather than escaped downstream.
    for (const url of [
      'https://www.linkedin.com/in/foo&bar=1',
      'https://www.linkedin.com/in/foo bar',
      'https://www.linkedin.com/in/../../etc/passwd',
    ]) {
      let identifier: string | null = null;
      try {
        identifier = parseProfileUrl(url).value;
      } catch {
        continue; // Rejecting is the preferred outcome.
      }
      expect(identifier).toMatch(/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u);
    }
  });
});
