import type { ImageSet } from './linkedin/image.js';

/** A LinkedIn date: always partial, never a timestamp. Consumers can format; they cannot un-format. */
export interface PartialDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

export interface DateRange {
  start: PartialDate | null;
  end: PartialDate | null;
  /** True when LinkedIn marks the entry as ongoing (no end date). */
  current: boolean;
  /** Inclusive month count when both ends are known, else null. */
  durationMonths: number | null;
}

export interface Location {
  /** Human-readable place, e.g. "London, England, United Kingdom". */
  display: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
  /** LinkedIn's geo URN, resolvable even when no display name is returned. */
  geoUrn: string | null;
}

export interface ProfileCore {
  publicIdentifier: string | null;
  entityUrn: string | null;
  memberId: string | null;
  profileUrl: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  headline: string | null;
  about: string | null;
  location: Location;
  industry: string | null;
  pronouns: string | null;
  isOpenToWork: boolean;
  isHiring: boolean;
  isPremium: boolean;
  isInfluencer: boolean;
  connectionsCount: number | null;
  followersCount: number | null;
  connectionDegree: string | null;
  images: {
    profile: ImageSet | null;
    background: ImageSet | null;
  };
}

export interface Experience {
  title: string | null;
  employmentType: string | null;
  companyName: string | null;
  companyUrn: string | null;
  companyUrl: string | null;
  companyLogo: ImageSet | null;
  location: string | null;
  description: string | null;
  dates: DateRange;
}

export interface Education {
  schoolName: string | null;
  schoolUrn: string | null;
  schoolUrl: string | null;
  schoolLogo: ImageSet | null;
  degree: string | null;
  fieldOfStudy: string | null;
  grade: string | null;
  activities: string | null;
  description: string | null;
  dates: DateRange;
}

export interface Skill {
  name: string;
  endorsementCount: number | null;
}

export interface Certification {
  name: string | null;
  authority: string | null;
  authorityUrn: string | null;
  authorityLogo: ImageSet | null;
  licenseNumber: string | null;
  url: string | null;
  dates: DateRange;
}

export interface Language {
  name: string | null;
  proficiency: string | null;
}

export interface Volunteering {
  role: string | null;
  organization: string | null;
  cause: string | null;
  description: string | null;
  dates: DateRange;
}

export interface Honor {
  title: string | null;
  issuer: string | null;
  description: string | null;
  issuedOn: PartialDate | null;
}

export interface Project {
  title: string | null;
  description: string | null;
  url: string | null;
  dates: DateRange;
}

export interface Course {
  name: string | null;
  number: string | null;
}

export interface Publication {
  name: string | null;
  publisher: string | null;
  description: string | null;
  url: string | null;
  publishedOn: PartialDate | null;
}

/** Per-section outcome, so a caller can tell "absent" from "we failed to read it". */
export type SectionStatus = 'ok' | 'empty' | 'partial' | 'unavailable';

export interface ResponseMeta {
  fetchedAt: string;
  cached: boolean;
  /** Which Voyager decoration answered. */
  source: string;
  sections: Record<string, SectionStatus>;
  warnings: string[];
  elapsedMs?: number;
}

export interface ProfileResponse {
  inputUrl: string;
  profile: ProfileCore;
  experience: Experience[];
  education: Education[];
  skills: Skill[];
  certifications: Certification[];
  languages: Language[];
  volunteering: Volunteering[];
  honors: Honor[];
  projects: Project[];
  courses: Course[];
  publications: Publication[];
  meta: ResponseMeta;
  /** Present only when ?raw=true. */
  raw?: unknown;
}
