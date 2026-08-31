/**
 * Turns a browser HAR into two things we need:
 *
 *   1. The list of Voyager endpoints the LinkedIn web app actually called,
 *      with the decoration IDs and GraphQL queryIds in use *today* — written
 *      to config/endpoints.json so a version bump is a config edit.
 *
 *   2. Response bodies saved as fixtures, so parsers can be developed and
 *      tested with no network and no credentials.
 *
 * Usage:  npm run har -- captures/profile.har
 *
 * A HAR contains your live session cookie. captures/ and *.har are gitignored,
 * and request headers are dropped here rather than written anywhere.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

interface HarEntry {
  request?: { url?: string; method?: string };
  response?: { status?: number; content?: { text?: string; encoding?: string; mimeType?: string } };
}

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const ENDPOINTS = join(ROOT, 'config', 'endpoints.json');

function findHar(argv: string[]): string {
  const explicit = argv.find((a) => a.endsWith('.har'));
  if (explicit) return resolve(explicit);

  const dir = join(ROOT, 'captures');
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith('.har'));
  } catch {
    // No captures directory yet.
  }
  if (!entries.length) {
    console.error(
      'No HAR found.\n\n' +
        'Capture one first:\n' +
        '  DevTools -> Network -> check Fetch/XHR -> filter "voyager"\n' +
        '  open a profile, expand every section, then\n' +
        '  right-click the request list -> "Copy all as HAR (with content)"\n' +
        '  save it into captures/\n\n' +
        'Then: npm run har -- captures/<file>.har',
    );
    process.exit(1);
  }
  return join(dir, entries.sort().at(-1)!);
}

/** Strips contact details so a fixture from a real profile is safe to commit. */
function redact(json: string): string {
  return json
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'redacted@example.com')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '+10000000000');
}

function slugify(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+\/voyager\/api\/?/, '');
  return (
    path
      .split('?')[0]!
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'root'
  );
}

function main(): void {
  const harPath = findHar(process.argv.slice(2));
  const har = JSON.parse(readFileSync(harPath, 'utf8')) as { log?: { entries?: HarEntry[] } };
  const entries = har.log?.entries ?? [];

  const voyager = entries.filter((e) => (e.request?.url ?? '').includes('/voyager/api/'));
  if (!voyager.length) {
    console.error(
      `No /voyager/api/ requests in ${basename(harPath)}.\n` +
        'Make sure "Fetch/XHR" was selected and you reloaded the profile page while recording.',
    );
    process.exit(1);
  }

  mkdirSync(FIXTURES, { recursive: true });

  const decorations = new Set<string>();
  const queryIds = new Set<string>();
  const seenPaths = new Map<string, number>();
  let saved = 0;

  for (const entry of voyager) {
    const url = entry.request!.url!;
    const status = entry.response?.status ?? 0;

    for (const m of url.matchAll(/decorationId=([^&]+)/g)) {
      decorations.add(decodeURIComponent(m[1]!));
    }
    for (const m of url.matchAll(/queryId=([^&]+)/g)) {
      queryIds.add(decodeURIComponent(m[1]!));
    }

    const body = entry.response?.content?.text;
    if (!body || entry.response?.content?.encoding === 'base64' || status !== 200) continue;

    let pretty: string;
    try {
      pretty = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      continue;
    }

    const slug = slugify(url);
    const n = (seenPaths.get(slug) ?? 0) + 1;
    seenPaths.set(slug, n);
    const name = n === 1 ? `${slug}.json` : `${slug}-${n}.json`;
    writeFileSync(join(FIXTURES, name), redact(pretty));
    saved++;
  }

  // Merge newly captured decorations in front of the existing ladder.
  const profileDecos = [...decorations].filter((d) => /FullProfileWithEntities|FullProfile/i.test(d));
  const topCardDecos = [...decorations].filter((d) => /TopCard/i.test(d));

  const current = JSON.parse(readFileSync(ENDPOINTS, 'utf8')) as Record<string, unknown>;
  const merge = (fresh: string[], primary: string, fallbacks: string[]) => {
    const ordered = [...new Set([...fresh, primary, ...fallbacks])].filter(Boolean);
    return { primary: ordered[0]!, fallbacks: ordered.slice(1) };
  };

  const profile = merge(profileDecos, current['profile'] as string, (current['profileFallbacks'] as string[]) ?? []);
  const topCard = merge(topCardDecos, current['topCard'] as string, (current['topCardFallbacks'] as string[]) ?? []);

  const next = {
    ...current,
    capturedAt: new Date().toISOString(),
    profile: profile.primary,
    profileFallbacks: profile.fallbacks,
    topCard: topCard.primary,
    topCardFallbacks: topCard.fallbacks,
  };
  writeFileSync(ENDPOINTS, `${JSON.stringify(next, null, 2)}\n`);

  console.log(`\nHAR: ${basename(harPath)}`);
  console.log(`Voyager requests: ${voyager.length}`);
  console.log(`Fixtures written: ${saved} -> tests/fixtures/`);

  console.log(`\nDecoration IDs seen (${decorations.size}):`);
  for (const d of [...decorations].sort()) console.log(`  ${d}`);

  if (queryIds.size) {
    console.log(`\nGraphQL queryIds seen (${queryIds.size}):`);
    for (const q of [...queryIds].sort()) console.log(`  ${q}`);
  }

  console.log('\nEndpoint paths:');
  const paths = new Set(voyager.map((e) => (e.request!.url!.split('?')[0] ?? '').replace(/^https?:\/\/[^/]+/, '')));
  for (const p of [...paths].sort()) console.log(`  ${p}`);

  console.log(`\nUpdated config/endpoints.json (profile decoration: ${profile.primary})`);
}

main();
