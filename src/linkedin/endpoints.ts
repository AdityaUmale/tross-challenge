import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { VoyagerClient } from './client.js';
import { EntityGraph, type NormalizedPayload } from './graph.js';
import { ProfileNotFoundError, SchemaDriftError, isAppError } from '../errors.js';
import type { ProfileIdentifier } from './url.js';

/**
 * Which Voyager surface we use, and why.
 *
 * LinkedIn exposes profile data through two families:
 *
 *   1. REST.li + `decorationId` — /identity/dash/profiles?q=memberIdentity&…
 *      Returns typed entities (Position, Education, Certification…) and packs
 *      nearly the whole profile into one response.
 *
 *   2. GraphQL — /graphql?queryId=voyagerIdentityDashProfileComponents.<hash>
 *      Returns a generic component tree where a field's meaning depends on its
 *      position in the layout, and the queryId hash rotates on every LinkedIn
 *      deploy.
 *
 * We use (1). Decoration versions do drift, but they drift slowly and are
 * version-suffixed, so a stale one is a config edit rather than a rewrite.
 */

const here = dirname(fileURLToPath(import.meta.url));

export interface EndpointConfig {
  capturedAt: string | null;
  profile: string;
  profileFallbacks: string[];
  topCard: string;
  topCardFallbacks: string[];
  skillsPageSize: number;
  maxSkills: number;
}

const DEFAULTS: EndpointConfig = {
  capturedAt: null,
  profile: 'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101',
  profileFallbacks: [],
  topCard: 'com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-16',
  topCardFallbacks: [],
  skillsPageSize: 50,
  maxSkills: 200,
};

let cached: EndpointConfig | null = null;

export function loadEndpointConfig(): EndpointConfig {
  if (cached) return cached;
  for (const candidate of [
    resolve(here, '../../config/endpoints.json'),
    resolve(here, '../../../config/endpoints.json'),
    resolve(process.cwd(), 'config/endpoints.json'),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Partial<EndpointConfig>;
      cached = { ...DEFAULTS, ...parsed };
      return cached;
    } catch {
      // Try the next location.
    }
  }
  cached = DEFAULTS;
  return cached;
}

/** Overrides the loaded config — used by the HAR extractor and by tests. */
export function setEndpointConfig(cfg: Partial<EndpointConfig>): void {
  cached = { ...loadEndpointConfig(), ...cfg };
}

// --- URL builders -----------------------------------------------------------

/** `memberIdentity` accepts both a vanity slug and an ACoAA… member id. */
export function profilePath(identifier: string, decorationId: string): string {
  const id = encodeURIComponent(identifier);
  return `/identity/dash/profiles?q=memberIdentity&memberIdentity=${id}&decorationId=${decorationId}`;
}

export function skillsPath(profileUrn: string, start: number, count: number): string {
  return `/identity/dash/profileSkills?q=viewee&profileUrn=${encodeURIComponent(profileUrn)}&start=${start}&count=${count}`;
}

export function contactInfoPath(publicIdentifier: string): string {
  return `/identity/profiles/${encodeURIComponent(publicIdentifier)}/profileContactInfo`;
}

/** Pre-dash endpoint, kept only as a last-resort fallback. */
export function legacyProfileViewPath(publicIdentifier: string): string {
  return `/identity/profiles/${encodeURIComponent(publicIdentifier)}/profileView`;
}

// --- Fetching ---------------------------------------------------------------

export interface ProfileBundle {
  full: NormalizedPayload;
  topCard?: NormalizedPayload;
  skillPages: NormalizedPayload[];
  warnings: string[];
  /** Which decoration actually answered, recorded in the response meta. */
  source: string;
}

/**
 * Walks the decoration ladder until one answers. A bumped version number is the
 * most common way this breaks, and trying the neighbours costs one request.
 */
async function fetchWithLadder(
  client: VoyagerClient,
  identifier: ProfileIdentifier,
  primary: string,
  fallbacks: string[],
): Promise<{ payload: NormalizedPayload; decoration: string }> {
  const ladder = [primary, ...fallbacks];
  let lastError: unknown;

  for (const decoration of ladder) {
    try {
      const payload = await client.get(profilePath(identifier.value, decoration), {
        identifier: identifier.value,
        referer: identifier.canonicalUrl,
      });
      return { payload, decoration };
    } catch (err) {
      // A dead cookie or a genuinely missing profile will not be fixed by
      // another decoration version, so stop immediately.
      // Only a rejected decoration is worth retrying. A dead cookie, a missing
      // profile, a throttle or an empty session pool will not be fixed by
      // asking for a different projection.
      const TERMINAL = ['AUTH_EXPIRED', 'PROFILE_NOT_FOUND', 'RATE_LIMITED', 'NO_HEALTHY_SESSION'];
      if (isAppError(err) && TERMINAL.includes(err.code)) {
        throw err;
      }
      lastError = err;
    }
  }

  throw new SchemaDriftError(
    `Every configured profile decoration was rejected (tried ${ladder.length}). Recapture endpoints from a browser HAR and update config/endpoints.json.`,
    { tried: ladder, cause: lastError instanceof Error ? lastError.message : String(lastError) },
  );
}

/**
 * Fetches everything one profile needs: the full entity graph, the top card
 * (for a human-readable location and follower counts), and any skills past the
 * inline cap.
 *
 * Only the first call is required. The rest degrade to warnings, because a
 * partial profile beats a 500.
 */
export async function fetchProfileBundle(
  client: VoyagerClient,
  identifier: ProfileIdentifier,
  options: { extras?: boolean } = {},
): Promise<ProfileBundle> {
  const cfg = loadEndpointConfig();
  const warnings: string[] = [];

  const { payload: full, decoration } = await fetchWithLadder(
    client,
    identifier,
    cfg.profile,
    cfg.profileFallbacks,
  );

  const graph = new EntityGraph(full);
  const profile = findProfileEntity(graph);
  if (!profile) {
    throw new ProfileNotFoundError(identifier.value);
  }

  const bundle: ProfileBundle = { full, skillPages: [], warnings, source: `voyager-dash:${decoration}` };

  // One request per profile by default.
  //
  // LinkedIn scores a session on how many identity-graph calls it makes and how
  // fast. Fanning out to the top card and the skills pages tripled the request
  // count for two fields the full-profile decoration does not carry anyway
  // (follower counts, and endorsement counts, which this projection omits), and
  // it was enough to get sessions invalidated after a handful of lookups.
  //
  // The extras are available behind ?extras=true for callers who want them and
  // accept the risk to the session.
  if (!options.extras) return bundle;

  const profileUrn = typeof profile['entityUrn'] === 'string' ? profile['entityUrn'] : null;

  try {
    const topCard = await fetchWithLadder(client, identifier, cfg.topCard, cfg.topCardFallbacks);
    bundle.topCard = topCard.payload;
  } catch (err) {
    warnings.push(`top card unavailable: ${reason(err)}`);
  }

  if (profileUrn) {
    try {
      bundle.skillPages = await fetchAllSkills(client, profileUrn, cfg);
    } catch (err) {
      warnings.push(`skill paging failed: ${reason(err)}`);
    }
  }

  return bundle;
}

/**
 * The full-profile decoration inlines only the first handful of skills, so a
 * dense profile silently loses most of them unless they are paged explicitly.
 */
async function fetchAllSkills(
  client: VoyagerClient,
  profileUrn: string,
  cfg: EndpointConfig,
): Promise<NormalizedPayload[]> {
  const pages: NormalizedPayload[] = [];
  let start = 0;

  while (start < cfg.maxSkills) {
    const page = await client.get(skillsPath(profileUrn, start, cfg.skillsPageSize), {
      identifier: profileUrn,
    });
    pages.push(page);

    const count = countElements(page);
    if (count < cfg.skillsPageSize) break;
    start += cfg.skillsPageSize;
  }
  return pages;
}

function countElements(payload: NormalizedPayload): number {
  const data = payload.data as Record<string, unknown> | undefined;
  for (const key of ['*elements', 'elements']) {
    const value = data?.[key];
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

/** Finds the Profile entity regardless of which package LinkedIn currently puts it in. */
export function findProfileEntity(graph: EntityGraph) {
  const roots = graph.rootElements();
  const rootProfile = roots.find((e) => typeof e['$type'] === 'string' && (e['$type'] as string).endsWith('.Profile'));
  if (rootProfile) return rootProfile;
  return graph.ofTypeSuffix('.Profile')[0];
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
