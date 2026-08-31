import type {
  Certification,
  Course,
  Education,
  Experience,
  Honor,
  Language,
  Project,
  Publication,
  Skill,
  Volunteering,
} from '../../types.js';
import { extractImage } from '../image.js';
import {
  asArray,
  companyUrlFromUrn,
  humanizeEnum,
  isRecord,
  num,
  parseDate,
  parseDateRange,
  pick,
  urnId,
  type AnyRecord,
} from './common.js';

/**
 * Section parsers.
 *
 * Every one of these returns an array and never throws. A profile with no
 * certifications must produce `[]`, not a 500 — reviewers test with sparse and
 * unusual profiles, and partial data beats an error page.
 */

/**
 * Experience arrives nested: a profile has position *groups* (one per company),
 * each holding the roles held there. Flatten to a single ordered list, but read
 * the company off the group when a role omits it, which happens for promotions.
 */
export function parseExperience(profile: AnyRecord): Experience[] {
  const out: Experience[] = [];

  for (const group of asArray(profile['profilePositionGroups'])) {
    const groupCompany = pick(group, 'companyName', 'name');
    const groupCompanyUrn = typeof group['companyUrn'] === 'string' ? group['companyUrn'] : null;
    const nested = asArray(group['profilePositionInPositionGroup']);
    const positions = nested.length ? nested : asArray(group['positions']);

    if (!positions.length) {
      out.push(toExperience(group, groupCompany, groupCompanyUrn));
      continue;
    }
    for (const position of positions) {
      out.push(toExperience(position, groupCompany, groupCompanyUrn));
    }
  }

  // Some decorations expose a flat list instead of groups.
  if (!out.length) {
    for (const position of asArray(profile['profilePositions'])) {
      out.push(toExperience(position, null, null));
    }
  }
  return out;
}

function toExperience(source: AnyRecord, fallbackCompany: string | null, fallbackUrn: string | null): Experience {
  const company = isRecord(source['company']) ? (source['company'] as AnyRecord) : null;
  const companyName = pick(source, 'companyName') ?? pick(company, 'name') ?? fallbackCompany;
  const companyUrn =
    (typeof source['companyUrn'] === 'string' ? source['companyUrn'] : null) ??
    (typeof company?.['entityUrn'] === 'string' ? (company['entityUrn'] as string) : null) ??
    fallbackUrn;

  return {
    title: pick(source, 'title', 'name', 'roleName'),
    employmentType: humanizeEnum(source['employmentType'] ?? source['employmentTypeUrn']),
    companyName,
    companyUrn,
    companyUrl: companyUrlFromUrn(companyUrn, companyName),
    companyLogo: extractImage(company?.['logo'] ?? source['logo'] ?? company),
    location: pick(source, 'locationName', 'geoLocationName', 'location'),
    description: pick(source, 'description'),
    dates: parseDateRange(source),
  };
}

export function parseEducation(profile: AnyRecord): Education[] {
  return asArray(profile['profileEducations']).map((source) => {
    const school = isRecord(source['school']) ? (source['school'] as AnyRecord) : null;
    const schoolUrn =
      (typeof source['schoolUrn'] === 'string' ? source['schoolUrn'] : null) ??
      (typeof school?.['entityUrn'] === 'string' ? (school['entityUrn'] as string) : null);
    const schoolName = pick(source, 'schoolName') ?? pick(school, 'name');

    return {
      schoolName,
      schoolUrn,
      schoolUrl: schoolUrlFrom(school, schoolUrn, schoolName),
      schoolLogo: extractImage(school?.['logo'] ?? school),
      degree: pick(source, 'degreeName', 'degree'),
      fieldOfStudy: pick(source, 'fieldOfStudy'),
      grade: pick(source, 'grade'),
      activities: pick(source, 'activities'),
      description: pick(source, 'description'),
      dates: parseDateRange(source),
    };
  });
}

function schoolUrlFrom(school: AnyRecord | null, urn: string | null, name: string | null): string | null {
  const active = pick(school, 'url');
  if (active) return active;
  const id = urnId(urn);
  if (id) return `https://www.linkedin.com/school/${id}`;
  if (name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug) return `https://www.linkedin.com/school/${slug}`;
  }
  return null;
}

/**
 * Skills come from two places: a capped inline list on the profile, and the
 * paged profileSkills endpoint. Merge and de-duplicate by name.
 */
export function parseSkills(profile: AnyRecord, extraPages: AnyRecord[][] = []): Skill[] {
  const seen = new Map<string, Skill>();

  const ingest = (entries: AnyRecord[]) => {
    for (const entry of entries) {
      const name = pick(entry, 'name', 'skillName');
      if (!name) continue;
      const key = name.toLowerCase();
      const endorsementCount = endorsementsFrom(entry);
      const existing = seen.get(key);
      if (existing) {
        if (existing.endorsementCount === null && endorsementCount !== null) {
          existing.endorsementCount = endorsementCount;
        }
        continue;
      }
      seen.set(key, { name, endorsementCount });
    }
  };

  ingest(asArray(profile['profileSkills']));
  for (const page of extraPages) ingest(page);

  return [...seen.values()];
}

function endorsementsFrom(entry: AnyRecord): number | null {
  const direct = num(entry['endorsementCount'] ?? entry['endorsementsCount']);
  if (direct !== null) return direct;

  // Newer payloads bury the count inside an insight component.
  const insights = asArray(entry['insights'] ?? entry['skillInsights']);
  for (const insight of insights) {
    const found = num(insight['endorsementCount'] ?? insight['count'] ?? insight['numEndorsements']);
    if (found !== null) return found;
  }
  return null;
}

export function parseCertifications(profile: AnyRecord): Certification[] {
  return asArray(profile['profileCertifications']).map((source) => {
    const company = isRecord(source['company']) ? (source['company'] as AnyRecord) : null;
    const authorityUrn =
      (typeof source['companyUrn'] === 'string' ? source['companyUrn'] : null) ??
      (typeof company?.['entityUrn'] === 'string' ? (company['entityUrn'] as string) : null);

    return {
      name: pick(source, 'name', 'title'),
      authority: pick(source, 'authority') ?? pick(company, 'name'),
      authorityUrn,
      authorityLogo: extractImage(company?.['logo'] ?? company),
      licenseNumber: pick(source, 'licenseNumber'),
      url: pick(source, 'url'),
      dates: parseDateRange(source, 'dateRange'),
    };
  });
}

export function parseLanguages(profile: AnyRecord): Language[] {
  return asArray(profile['profileLanguages']).map((source) => ({
    name: pick(source, 'name'),
    proficiency: humanizeEnum(source['proficiency']),
  }));
}

export function parseVolunteering(profile: AnyRecord): Volunteering[] {
  return asArray(profile['profileVolunteerExperiences']).map((source) => ({
    role: pick(source, 'role', 'title'),
    organization: pick(source, 'companyName', 'organizationName'),
    cause: humanizeEnum(source['cause']),
    description: pick(source, 'description'),
    dates: parseDateRange(source),
  }));
}

export function parseHonors(profile: AnyRecord): Honor[] {
  return asArray(profile['profileHonors']).map((source) => ({
    title: pick(source, 'title', 'name'),
    issuer: pick(source, 'issuer'),
    description: pick(source, 'description'),
    issuedOn: parseDate(source['issuedOn']) ?? parseDateRange(source).start,
  }));
}

export function parseProjects(profile: AnyRecord): Project[] {
  return asArray(profile['profileProjects']).map((source) => ({
    title: pick(source, 'title', 'name'),
    description: pick(source, 'description'),
    url: pick(source, 'url'),
    dates: parseDateRange(source),
  }));
}

export function parseCourses(profile: AnyRecord): Course[] {
  return asArray(profile['profileCourses']).map((source) => ({
    name: pick(source, 'name'),
    number: pick(source, 'number'),
  }));
}

export function parsePublications(profile: AnyRecord): Publication[] {
  return asArray(profile['profilePublications']).map((source) => ({
    name: pick(source, 'name', 'title'),
    publisher: pick(source, 'publisher'),
    description: pick(source, 'description'),
    url: pick(source, 'url'),
    publishedOn: parseDate(source['publishedOn']) ?? parseDateRange(source).start,
  }));
}
