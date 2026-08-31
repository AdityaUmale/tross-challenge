import { InvalidUrlError } from '../errors.js';

/**
 * LinkedIn member URLs come in two flavours, and Voyager's `memberIdentity`
 * parameter accepts either, so one lookup covers both:
 *
 *   /in/williamhgates        -> vanity slug
 *   /in/ACwAAABc...          -> opaque member id
 */
export interface ProfileIdentifier {
  /** What Voyager's memberIdentity parameter receives. */
  value: string;
  kind: 'vanity' | 'memberId';
  /** Canonical public URL, useful to echo back to the caller. */
  canonicalUrl: string;
}

/** Member ids are base64-ish and always start with AC. */
const MEMBER_ID = /^AC[A-Za-z0-9_-]{8,}$/;
/** Vanity slugs allow unicode letters (LinkedIn permits non-Latin names). */
const VANITY = /^[\p{L}\p{N}][\p{L}\p{N}-]{1,98}[\p{L}\p{N}]$/u;

/** Paths that look profile-ish but are not member profiles we can fetch. */
const REJECTED: Array<{ test: RegExp; reason: string }> = [
  { test: /\/company\//i, reason: 'a company page' },
  { test: /\/school\//i, reason: 'a school page' },
  { test: /\/showcase\//i, reason: 'a showcase page' },
  { test: /\/groups?\//i, reason: 'a group page' },
  { test: /\/posts?\//i, reason: 'a post' },
  { test: /\/pulse\//i, reason: 'an article' },
  { test: /\/jobs?\//i, reason: 'a job posting' },
  { test: /\/search\//i, reason: 'a search results page' },
  { test: /\/pub\/dir\//i, reason: 'a public directory page' },
  { test: /\/sales\//i, reason: 'a Sales Navigator page' },
  { test: /^\/talent\//i, reason: 'a Recruiter page' },
];

function fail(input: string, detail: string): never {
  throw new InvalidUrlError(
    `Not a LinkedIn member profile URL: ${detail} Expected something like https://www.linkedin.com/in/username`,
    { input },
  );
}

/**
 * Accepts a full URL, a bare path, or a bare vanity name, and tolerates the
 * regional hosts, locale prefixes, trailing slashes and ?trk= tracking junk
 * that people actually paste.
 */
export function parseProfileUrl(input: string): ProfileIdentifier {
  const raw = input?.trim();
  if (!raw) fail(input, 'the input was empty.');

  // A bare vanity name, e.g. "williamhgates", is a reasonable thing to accept.
  if (!raw.includes('/') && !raw.includes('.')) {
    return identify(raw, raw);
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    fail(input, 'it could not be parsed as a URL.');
  }

  const host = url.hostname.toLowerCase();
  if (!/(^|\.)linkedin\.com$/.test(host)) {
    fail(input, `the host "${url.hostname}" is not linkedin.com.`);
  }
  if (/^(www\.)?linkedin\.com$/.test(host) === false && /^[a-z]{2}\./.test(host) === false) {
    // Regional subdomains (in., uk., de.) are fine; anything else is suspect.
    fail(input, `the host "${url.hostname}" is not a public LinkedIn host.`);
  }

  // Strip a locale prefix such as /en-us/in/foo before matching. The lookahead
  // matters: without it this eats the "/in" of every plain profile URL, since
  // "in" is itself two letters.
  const path = url.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/(?:in|pub)\/)/i, '');

  for (const { test, reason } of REJECTED) {
    if (test.test(path)) fail(input, `that is ${reason}, not a member profile.`);
  }

  const match = /\/(?:in|pub)\/([^/?#]+)/i.exec(path);
  if (!match?.[1]) fail(input, 'the path does not contain an /in/ segment.');

  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    slug = match[1];
  }
  return identify(slug, input);
}

function identify(slug: string, original: string): ProfileIdentifier {
  const value = slug.replace(/\/+$/, '').trim();
  if (!value) fail(original, 'no username was found in the URL.');

  if (MEMBER_ID.test(value)) {
    return { value, kind: 'memberId', canonicalUrl: `https://www.linkedin.com/in/${value}` };
  }
  if (!VANITY.test(value)) {
    fail(original, `"${value}" is not a valid LinkedIn username.`);
  }
  return { value, kind: 'vanity', canonicalUrl: `https://www.linkedin.com/in/${value}` };
}
