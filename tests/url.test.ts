import { describe, expect, it } from 'vitest';
import { parseProfileUrl } from '../src/linkedin/url.js';
import { InvalidUrlError } from '../src/errors.js';

describe('parseProfileUrl', () => {
  it('accepts the URL shapes people actually paste', () => {
    const cases: Array<[string, string]> = [
      ['https://www.linkedin.com/in/williamhgates', 'williamhgates'],
      ['https://www.linkedin.com/in/williamhgates/', 'williamhgates'],
      ['http://linkedin.com/in/williamhgates', 'williamhgates'],
      ['www.linkedin.com/in/williamhgates', 'williamhgates'],
      ['linkedin.com/in/williamhgates?trk=public_profile_browsemap', 'williamhgates'],
      ['https://in.linkedin.com/in/williamhgates', 'williamhgates'],
      ['https://www.linkedin.com/en-us/in/williamhgates', 'williamhgates'],
      ['williamhgates', 'williamhgates'],
    ];
    for (const [input, expected] of cases) {
      expect(parseProfileUrl(input).value, input).toBe(expected);
    }
  });

  it('recognises opaque member ids as well as vanity slugs', () => {
    const memberId = parseProfileUrl('https://www.linkedin.com/in/ACwAAABc1234xyz');
    expect(memberId.kind).toBe('memberId');
    expect(parseProfileUrl('https://www.linkedin.com/in/ada-lovelace').kind).toBe('vanity');
  });

  it('handles non-Latin vanity names', () => {
    expect(parseProfileUrl('https://www.linkedin.com/in/андрей-иванов').value).toBe('андрей-иванов');
  });

  it('decodes percent-encoded slugs', () => {
    expect(parseProfileUrl('https://www.linkedin.com/in/jos%C3%A9-garcia').value).toBe('josé-garcia');
  });

  it('rejects non-profile LinkedIn URLs with a useful message', () => {
    const cases = [
      'https://www.linkedin.com/company/microsoft',
      'https://www.linkedin.com/school/mit',
      'https://www.linkedin.com/feed/update/urn:li:activity:123',
      'https://www.linkedin.com/jobs/view/123',
      'https://www.linkedin.com/sales/lead/abc',
    ];
    for (const input of cases) {
      expect(() => parseProfileUrl(input), input).toThrow(InvalidUrlError);
    }
  });

  it('rejects other hosts', () => {
    expect(() => parseProfileUrl('https://example.com/in/foo')).toThrow(InvalidUrlError);
    expect(() => parseProfileUrl('https://linkedin.com.evil.tld/in/foo')).toThrow(InvalidUrlError);
  });

  it('rejects empty input', () => {
    expect(() => parseProfileUrl('')).toThrow(InvalidUrlError);
  });
});
