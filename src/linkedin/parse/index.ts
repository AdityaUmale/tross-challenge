import type { ProfileBundle } from '../endpoints.js';
import { findProfileEntity } from '../endpoints.js';
import { EntityGraph, type NormalizedPayload } from '../graph.js';
import { extractImage } from '../image.js';
import { SchemaDriftError } from '../../errors.js';
import type { ProfileIdentifier } from '../url.js';
import type { Location, ProfileCore, ProfileResponse, SectionStatus } from '../../types.js';
import { isRecord, num, pick, urnId, type AnyRecord } from './common.js';
import {
  parseCertifications,
  parseCourses,
  parseEducation,
  parseExperience,
  parseHonors,
  parseLanguages,
  parseProjects,
  parsePublications,
  parseSkills,
  parseVolunteering,
} from './sections.js';

/**
 * Turns a fetched bundle into the response we serve.
 *
 * The controlling rule: never throw for a missing section. Anything we cannot
 * read becomes an empty array plus a `meta.sections` status, so a caller can
 * distinguish "this person has no certifications" from "we failed to read them".
 */
export function buildProfileResponse(
  identifier: ProfileIdentifier,
  bundle: ProfileBundle,
  options: { cached?: boolean; elapsedMs?: number } = {},
): ProfileResponse {
  const graph = new EntityGraph(bundle.full);
  const rawProfile = findProfileEntity(graph);
  if (!rawProfile) {
    throw new SchemaDriftError('No Profile entity found in the Voyager response.', {
      typesSeen: graph.types().slice(0, 25),
    });
  }

  const profile = graph.hydrate<AnyRecord>(rawProfile);
  const topCard = bundle.topCard ? hydrateTopCard(bundle.topCard) : null;
  const skillPages = bundle.skillPages.map((page) => hydrateElements(page));

  const warnings = [...bundle.warnings];
  const sections: Record<string, SectionStatus> = {};

  const section = <T>(name: string, fn: () => T[]): T[] => {
    try {
      const value = fn();
      sections[name] = value.length ? 'ok' : 'empty';
      return value;
    } catch (err) {
      sections[name] = 'unavailable';
      warnings.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  };

  const experience = section('experience', () => parseExperience(profile));
  const education = section('education', () => parseEducation(profile));
  const skills = section('skills', () => parseSkills(profile, skillPages));
  const certifications = section('certifications', () => parseCertifications(profile));
  const languages = section('languages', () => parseLanguages(profile));
  const volunteering = section('volunteering', () => parseVolunteering(profile));
  const honors = section('honors', () => parseHonors(profile));
  const projects = section('projects', () => parseProjects(profile));
  const courses = section('courses', () => parseCourses(profile));
  const publications = section('publications', () => parsePublications(profile));

  // Skills were paged separately; say so when the extra pages did not arrive.
  if (skills.length && !skillPages.length && bundle.warnings.some((w) => w.startsWith('skill paging'))) {
    sections['skills'] = 'partial';
  }

  const core = buildCore(identifier, profile, topCard);
  sections['profile'] = core.fullName ? 'ok' : 'partial';
  if (!core.location.display) {
    warnings.push(
      'location display name unavailable: the full-profile decoration returns an unresolved Geo stub. ' +
        'countryCode and geoUrn are still populated.',
    );
  }

  return {
    inputUrl: identifier.canonicalUrl,
    profile: core,
    experience,
    education,
    skills,
    certifications,
    languages,
    volunteering,
    honors,
    projects,
    courses,
    publications,
    meta: {
      fetchedAt: new Date().toISOString(),
      cached: options.cached ?? false,
      source: bundle.source,
      sections,
      warnings,
      ...(options.elapsedMs !== undefined ? { elapsedMs: options.elapsedMs } : {}),
    },
  };
}

function buildCore(
  identifier: ProfileIdentifier,
  profile: AnyRecord,
  topCard: AnyRecord | null,
): ProfileCore {
  const publicIdentifier = pick(profile, 'publicIdentifier') ?? (identifier.kind === 'vanity' ? identifier.value : null);
  const entityUrn = typeof profile['entityUrn'] === 'string' ? profile['entityUrn'] : null;

  const firstName = pick(profile, 'firstName') ?? pick(topCard, 'firstName');
  const lastName = pick(profile, 'lastName') ?? pick(topCard, 'lastName');
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || null;

  return {
    publicIdentifier,
    entityUrn,
    memberId: urnId(entityUrn),
    profileUrl: publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : identifier.canonicalUrl,
    firstName,
    lastName,
    fullName,
    headline: pick(profile, 'headline') ?? pick(topCard, 'headline'),
    about: pick(profile, 'summary', 'about'),
    location: buildLocation(profile, topCard),
    industry: pick(profile, 'industryName') ?? readIndustry(profile),
    pronouns: pick(profile, 'pronoun', 'standardizedPronoun'),
    isOpenToWork: readFlag(profile, topCard, 'openToWork'),
    isHiring: readFlag(profile, topCard, 'hiring'),
    isPremium: profile['premium'] === true || topCard?.['premium'] === true,
    isInfluencer: profile['influencer'] === true || topCard?.['influencer'] === true,
    connectionsCount: num(profile['connectionsCount']) ?? num(topCard?.['connectionsCount']),
    followersCount: num(profile['followerCount']) ?? num(topCard?.['followerCount']) ?? num(topCard?.['followersCount']),
    connectionDegree: readDegree(profile) ?? readDegree(topCard),
    images: {
      profile: extractImage(profile['profilePicture'] ?? topCard?.['profilePicture']),
      background: extractImage(profile['backgroundPicture'] ?? topCard?.['backgroundPicture'] ?? profile['backgroundImage']),
    },
  };
}

function buildLocation(profile: AnyRecord, topCard: AnyRecord | null): Location {
  const geoLocation = record(profile['geoLocation']) ?? record(topCard?.['geoLocation']);
  const profileLocation = record(profile['location']) ?? record(topCard?.['location']);
  // `geoLocation.geo` is only populated by decorations that resolve the Geo
  // entity. The full-profile projection returns a bare stub, so the display
  // name comes from the top card when one is available.
  const geo = record(geoLocation?.['geo']) ?? record(topCard?.['geo']);

  const display =
    pick(profile, 'geoLocationName', 'locationName') ??
    pick(topCard, 'geoLocationName', 'locationName') ??
    pick(geo, 'defaultLocalizedName', 'defaultLocalizedNameWithoutCountryName', 'localizedName', 'name');

  const country =
    pick(record(geo?.['country']), 'defaultLocalizedName', 'name') ?? pick(profile, 'countryName');

  const countryCode = pick(profileLocation, 'countryCode') ?? pick(profile, 'countryCode');
  const postalCode = pick(profileLocation, 'postalCode') ?? pick(geoLocation, 'postalCode');

  const geoUrn =
    (typeof geoLocation?.['geoUrn'] === 'string' ? (geoLocation['geoUrn'] as string) : null) ??
    (typeof geo?.['entityUrn'] === 'string' ? (geo['entityUrn'] as string) : null);

  return {
    display,
    country,
    countryCode: countryCode ? countryCode.toUpperCase() : null,
    postalCode,
    geoUrn,
  };
}

function record(value: unknown): AnyRecord | null {
  return isRecord(value) ? value : null;
}

function readIndustry(profile: AnyRecord): string | null {
  const industry = profile['industry'] ?? profile['industryV2'];
  if (isRecord(industry)) return pick(industry, 'name', 'localizedName');
  return null;
}

/**
 * The open-to-work and hiring badges live in a photo frame overlay rather than
 * as a boolean, so detect them by frame type.
 */
function readFlag(profile: AnyRecord, topCard: AnyRecord | null, kind: 'openToWork' | 'hiring'): boolean {
  const needle = kind === 'openToWork' ? 'OPEN_TO_WORK' : 'HIRING';

  for (const source of [profile, topCard]) {
    if (!source) continue;
    if (source[kind] === true) return true;

    // The badge is expressed as a photo frame type, e.g.
    // PHOTO_FRAME_TYPE_OPEN_TO_WORK, not as a boolean.
    for (const key of ['profilePictureFrameType', 'frameType', 'memberBadgeType']) {
      const value = source[key];
      if (typeof value === 'string' && value.toUpperCase().includes(needle)) return true;
    }

    const badges = record(source['memberBadges']);
    if (badges?.[kind] === true) return true;
  }
  return false;
}

function readDegree(source: AnyRecord | null): string | null {
  if (!source) return null;
  const raw = source['distance'] ?? source['memberDistance'] ?? source['connectionDistance'];
  const value = typeof raw === 'string' ? raw : isRecord(raw) ? pick(raw, 'value') : null;
  if (!value) return null;
  const map: Record<string, string> = {
    SELF: 'self',
    DISTANCE_1: '1st',
    DISTANCE_2: '2nd',
    DISTANCE_3: '3rd',
    OUT_OF_NETWORK: 'out of network',
  };
  return map[value.toUpperCase()] ?? value;
}

function hydrateTopCard(payload: NormalizedPayload): AnyRecord | null {
  const graph = new EntityGraph(payload);
  const entity = findProfileEntity(graph);
  return entity ? graph.hydrate<AnyRecord>(entity) : null;
}

/** Hydrates a paged collection response into a flat array of entities. */
function hydrateElements(payload: NormalizedPayload): AnyRecord[] {
  const graph = new EntityGraph(payload);
  const roots = graph.rootElements();
  if (roots.length) return roots.map((e) => graph.hydrate<AnyRecord>(e));
  // Fall back to every skill-shaped entity present.
  return graph.ofTypeSuffix('.Skill').map((e) => graph.hydrate<AnyRecord>(e));
}
