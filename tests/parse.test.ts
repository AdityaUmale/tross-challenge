import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EntityGraph } from '../src/linkedin/graph.js';
import { buildProfileResponse } from '../src/linkedin/parse/index.js';
import { parseProfileUrl } from '../src/linkedin/url.js';
import { extractImage } from '../src/linkedin/image.js';
import type { ProfileBundle } from '../src/linkedin/endpoints.js';

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/synthetic-profile.json'), 'utf8'),
);

function build(overrides: Partial<ProfileBundle> = {}) {
  const bundle: ProfileBundle = {
    full: fixture,
    skillPages: [],
    warnings: [],
    source: 'test',
    ...overrides,
  };
  return buildProfileResponse(parseProfileUrl('https://www.linkedin.com/in/ada-lovelace-synthetic'), bundle);
}

describe('EntityGraph', () => {
  it('indexes included entities by URN', () => {
    const graph = new EntityGraph(fixture);
    expect(graph.size).toBeGreaterThan(10);
    expect(graph.get('urn:li:fsd_profile:ACoAAASYNTH1')?.['firstName']).toBe('Ada');
  });

  it('follows *-prefixed pointers and collapses collections to arrays', () => {
    const graph = new EntityGraph(fixture);
    const profile = graph.hydrate<Record<string, unknown>>(graph.rootElements()[0]!);
    expect(Array.isArray(profile['profilePositionGroups'])).toBe(true);
    expect((profile['profilePositionGroups'] as unknown[]).length).toBe(2);
  });

  it('survives a reference cycle', () => {
    const cyclic = {
      data: { '*elements': ['urn:a'] },
      included: [
        { entityUrn: 'urn:a', $type: 'x.Profile', '*peer': 'urn:b' },
        { entityUrn: 'urn:b', $type: 'x.Other', '*peer': 'urn:a' },
      ],
    };
    const graph = new EntityGraph(cyclic);
    expect(() => graph.hydrate(graph.rootElements()[0]!)).not.toThrow();
  });
});

describe('image extraction', () => {
  it('joins rootUrl with the widest artifact', () => {
    const image = extractImage({
      vectorImage: {
        rootUrl: 'https://media.licdn.com/x/',
        artifacts: [
          { width: 100, fileIdentifyingUrlPathSegment: 'a.jpg' },
          { width: 800, fileIdentifyingUrlPathSegment: 'b.jpg' },
        ],
      },
    });
    expect(image?.largest).toBe('https://media.licdn.com/x/b.jpg');
    expect(image?.sizes).toHaveLength(2);
  });

  it('returns null when there is no image rather than throwing', () => {
    expect(extractImage(undefined)).toBeNull();
    expect(extractImage({ profilePicture: null })).toBeNull();
  });
});

describe('profile response', () => {
  const result = build();

  it('reads core identity fields', () => {
    expect(result.profile.fullName).toBe('Ada Lovelace');
    expect(result.profile.headline).toContain('Principal Engineer');
    expect(result.profile.location.display).toBe('London, England, United Kingdom');
    expect(result.profile.publicIdentifier).toBe('ada-lovelace-synthetic');
    expect(result.profile.memberId).toBe('ACoAAASYNTH1');
    expect(result.profile.isPremium).toBe(true);
  });

  it('detects the open-to-work photo frame', () => {
    expect(result.profile.isOpenToWork).toBe(true);
  });

  it('picks the largest profile photo', () => {
    expect(result.profile.images.profile?.largest).toBe(
      'https://media.licdn.com/dms/image/v2/SYNTH/shrink_800_800/photo.jpg',
    );
  });

  it('flattens position groups into an ordered experience list', () => {
    expect(result.experience).toHaveLength(3);
    expect(result.experience[0]?.title).toBe('Principal Engineer');
    // The role omits companyName; it must be inherited from its position group.
    expect(result.experience[0]?.companyName).toBe('Analytical Engines');
    expect(result.experience[0]?.companyUrl).toBe('https://www.linkedin.com/company/99001');
    expect(result.experience[0]?.companyLogo?.largest).toContain('logo_200.png');
  });

  it('marks an open-ended role current and computes durations', () => {
    expect(result.experience[0]?.dates.current).toBe(true);
    expect(result.experience[0]?.dates.end).toBeNull();
    expect(result.experience[1]?.dates.current).toBe(false);
    expect(result.experience[1]?.dates.durationMonths).toBe(38);
  });

  it('humanizes LinkedIn enums', () => {
    expect(result.experience[0]?.employmentType).toBe('Full time');
    expect(result.languages[0]?.proficiency).toBe('Native or bilingual');
  });

  it('parses education, skills and certifications', () => {
    expect(result.education[0]?.schoolName).toBe('University of London');
    expect(result.education[0]?.degree).toBe('BSc');
    expect(result.skills.map((s) => s.name)).toEqual(['TypeScript', 'Compilers']);
    expect(result.skills[0]?.endorsementCount).toBe(42);
    expect(result.skills[1]?.endorsementCount).toBeNull();
    expect(result.certifications[0]?.authority).toBe('Amazon Web Services');
  });

  it('merges paged skills and de-duplicates by name', () => {
    const paged = build({
      skillPages: [
        {
          data: { '*elements': ['urn:li:fsd_profileSkill:P1', 'urn:li:fsd_profileSkill:P2'] },
          included: [
            { entityUrn: 'urn:li:fsd_profileSkill:P1', $type: 'x.ProfileSkill', name: 'TypeScript', endorsementCount: 99 },
            { entityUrn: 'urn:li:fsd_profileSkill:P2', $type: 'x.ProfileSkill', name: 'Rust', endorsementCount: 7 },
          ],
        },
      ],
    });
    expect(paged.skills.map((s) => s.name)).toEqual(['TypeScript', 'Compilers', 'Rust']);
    // The inline value wins; paging must not overwrite a known count.
    expect(paged.skills[0]?.endorsementCount).toBe(42);
  });

  it('reports an empty section as empty, not missing', () => {
    expect(result.honors).toEqual([]);
    expect(result.meta.sections['honors']).toBe('empty');
    expect(result.meta.sections['experience']).toBe('ok');
  });

  it('returns empty arrays for sections the payload omits entirely', () => {
    expect(result.projects).toEqual([]);
    expect(result.publications).toEqual([]);
    expect(result.meta.sections['projects']).toBe('empty');
  });
});

describe('sparse profile', () => {
  it('does not throw when only a name is present', () => {
    const bare = {
      data: { '*elements': ['urn:li:fsd_profile:BARE'] },
      included: [
        {
          entityUrn: 'urn:li:fsd_profile:BARE',
          $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
          firstName: 'Sparse',
          lastName: 'Person',
        },
      ],
    };
    const result = buildProfileResponse(
      parseProfileUrl('sparse-person'),
      { full: bare, skillPages: [], warnings: [], source: 'test' },
    );
    expect(result.profile.fullName).toBe('Sparse Person');
    expect(result.experience).toEqual([]);
    expect(result.profile.images.profile).toBeNull();
    expect(result.meta.warnings.join(' ')).toContain('location display name unavailable');
  });
});
