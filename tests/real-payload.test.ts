import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProfileResponse } from '../src/linkedin/parse/index.js';
import { parseProfileUrl } from '../src/linkedin/url.js';
import type { NormalizedPayload } from '../src/linkedin/graph.js';

/**
 * Parses a real Voyager response captured from
 * /identity/dash/profiles?…decorationId=…FullProfileWithEntities-101.
 *
 * The synthetic fixture proves the resolver handles the shape we designed for.
 * This one proves it handles the shape LinkedIn actually sends.
 */
const payload = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/real-profile-dash.json'), 'utf8'),
) as NormalizedPayload;

const result = buildProfileResponse(parseProfileUrl('aditya-umale-2b489025a'), {
  full: payload,
  skillPages: [],
  warnings: [],
  source: 'test:FullProfileWithEntities-101',
});

describe('real Voyager payload', () => {
  it('reads identity from the live shape', () => {
    expect(result.profile.fullName).toBe('Aditya Umale');
    expect(result.profile.publicIdentifier).toBe('aditya-umale-2b489025a');
    expect(result.profile.memberId).toMatch(/^ACoAA/);
    expect(result.profile.headline).toContain('graspnote.com');
    expect(result.profile.about).toBeTruthy();
  });

  it('trims the stray whitespace LinkedIn stores in names', () => {
    // The raw payload has firstName "Aditya " with a trailing space.
    expect(result.profile.firstName).toBe('Aditya');
    expect(result.profile.fullName).not.toMatch(/\s{2}/);
  });

  it('resolves the industry through its URN pointer', () => {
    expect(result.profile.industry).toBe('Computer Software');
  });

  it('builds a usable image URL from rootUrl plus the widest artifact', () => {
    const photo = result.profile.images.profile;
    expect(photo?.largest).toMatch(/^https:\/\//);
    // rootUrl ends mid-segment ("…shrink_") and the artifact supplies the rest.
    expect(photo?.largest).toContain('profile-originalphoto-shrink_');
    expect(photo!.sizes.length).toBeGreaterThan(1);
    expect(photo!.sizes[0]!.width).toBeGreaterThanOrEqual(photo!.sizes.at(-1)!.width!);
  });

  it('flattens position groups into every individual role', () => {
    expect(result.experience).toHaveLength(5);
    const titles = result.experience.map((e) => e.title);
    expect(titles).toContain('Founding Engineer');
    expect(titles).toContain('Vice President');
  });

  it('resolves employment type through its URN', () => {
    const internship = result.experience.find((e) => e.title === 'Full Stack Engineer');
    expect(internship?.employmentType).toBe('Internship');
    expect(internship?.companyName).toBe('AgiledCoders');
  });

  it('computes inclusive durations and marks ongoing roles current', () => {
    const vp = result.experience.find((e) => e.title === 'Vice President');
    // September 2024 to March 2025 inclusive is 7 months.
    expect(vp?.dates.durationMonths).toBe(7);
    expect(vp?.dates.current).toBe(false);
    expect(result.experience.some((e) => e.dates.current)).toBe(true);
  });

  it('resolves company logos and URLs from the company URN', () => {
    const withLogo = result.experience.filter((e) => e.companyLogo);
    expect(withLogo.length).toBeGreaterThan(0);
    expect(withLogo[0]!.companyUrl).toMatch(/^https:\/\/www\.linkedin\.com\/company\//);
  });

  it('parses education and certifications', () => {
    expect(result.education[0]?.schoolName).toContain('College of Engineering');
    expect(result.certifications).toHaveLength(2);
    expect(result.certifications.map((c) => c.authority)).toContain('E-Cell, IIT Bombay');
    expect(result.certifications.some((c) => c.licenseNumber === 'ecell2021')).toBe(true);
  });

  it('reads the inline skills', () => {
    expect(result.skills.length).toBeGreaterThanOrEqual(20);
    expect(result.skills.map((s) => s.name)).toContain('MySQL');
    // This decoration returns skill names only; endorsements need another call.
    expect(result.skills.every((s) => s.endorsementCount === null)).toBe(true);
  });

  it('reports genuinely empty sections as empty rather than failing', () => {
    expect(result.languages).toEqual([]);
    expect(result.meta.sections['languages']).toBe('empty');
    expect(result.meta.sections['experience']).toBe('ok');
    expect(Object.values(result.meta.sections)).not.toContain('unavailable');
  });

  it('resolves the location through the geo URN pointer', () => {
    // Several Geo entities in `included` are bare stubs; only the one the
    // profile points at carries a name, so this has to follow the pointer
    // rather than scan for the first Geo it finds.
    expect(result.profile.location.display).toBe('Akola, Maharashtra, India');
    expect(result.profile.location.countryCode).toBe('IN');
    expect(result.profile.location.geoUrn).toMatch(/^urn:li:fsd_geo:/);
    expect(result.meta.warnings).toEqual([]);
  });
});
