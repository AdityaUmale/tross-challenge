/**
 * Live end-to-end check against LinkedIn, without starting the server.
 *
 * This is the reverse-engineering gate: if `npm run probe` prints a real
 * profile, the browserless path works and everything else is plumbing.
 *
 * Usage:
 *   npm run probe                                    # verify the session only
 *   npm run probe -- https://linkedin.com/in/foo     # fetch and parse a profile
 *   npm run probe -- <url> --save                    # also write a fixture
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { ProfileService } from '../src/service.js';
import { fetchProfileBundle } from '../src/linkedin/endpoints.js';
import { parseProfileUrl } from '../src/linkedin/url.js';
import { isAppError } from '../src/errors.js';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file; rely on the ambient environment.
}

const ROOT = resolve(import.meta.dirname, '..');

function summarize(label: string, items: unknown[]): void {
  console.log(`  ${label.padEnd(16)} ${items.length}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  const save = args.includes('--save');

  const config = loadConfig();
  if (config.sessions.length === 0) {
    console.error('No LI_AT configured. Copy .env.example to .env and paste your li_at cookie.');
    process.exit(1);
  }

  const service = new ProfileService(config);

  console.log(`Sessions configured: ${config.sessions.length}`);
  process.stdout.write('Verifying session against /voyager/api/me ... ');
  try {
    const me = await service.client.verifySession();
    console.log(`ok${me.publicIdentifier ? ` (logged in as ${me.publicIdentifier})` : ''}`);
  } catch (err) {
    console.log('FAILED');
    console.error(`\n  ${err instanceof Error ? err.message : String(err)}`);
    if (isAppError(err) && err.code === 'AUTH_EXPIRED') {
      console.error('\n  The li_at cookie is expired or invalid. Grab a fresh one:');
      console.error('  DevTools -> Application -> Cookies -> https://www.linkedin.com -> li_at');
    }
    process.exit(1);
  }

  if (!url) {
    console.log('\nSession works. Pass a profile URL to fetch one:');
    console.log('  npm run probe -- https://www.linkedin.com/in/williamhgates');
    return;
  }

  const identifier = parseProfileUrl(url);
  console.log(`\nFetching ${identifier.value} (${identifier.kind}) ...`);

  const startedAt = Date.now();
  const bundle = await fetchProfileBundle(service.client, identifier);
  const profile = await service.getProfile(url, { fresh: true });
  const elapsed = Date.now() - startedAt;

  console.log(`\n${profile.profile.fullName ?? '(no name)'} — ${profile.profile.headline ?? '(no headline)'}`);
  console.log(`${profile.profile.location.display ?? '(no location)'}  ·  ${elapsed}ms  ·  ${bundle.source}\n`);

  summarize('experience', profile.experience);
  summarize('education', profile.education);
  summarize('skills', profile.skills);
  summarize('certifications', profile.certifications);
  summarize('languages', profile.languages);
  summarize('volunteering', profile.volunteering);
  summarize('honors', profile.honors);
  summarize('projects', profile.projects);
  summarize('publications', profile.publications);

  console.log(`\n  photo            ${profile.profile.images.profile?.largest ?? '(none)'}`);

  if (profile.meta.warnings.length) {
    console.log('\nWarnings:');
    for (const w of profile.meta.warnings) console.log(`  - ${w}`);
  }

  if (save) {
    const dir = join(ROOT, 'tests', 'fixtures');
    mkdirSync(dir, { recursive: true });
    const write = (suffix: string, value: unknown) => {
      const file = join(dir, `probe-${identifier.value}-${suffix}.json`);
      writeFileSync(file, JSON.stringify(value, null, 2));
      console.log(`  ${file}`);
    };
    console.log('\nSaved:');
    write('raw', bundle.full);
    write('parsed', profile);
    if (bundle.topCard) write('topcard', bundle.topCard);
    bundle.skillPages.forEach((page, i) => write(`skills-${i}`, page));
  } else {
    console.log('\nFull JSON:');
    console.log(JSON.stringify(profile, null, 2));
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  if (isAppError(err) && err.details) console.error(JSON.stringify(err.details, null, 2));
  process.exit(1);
});
