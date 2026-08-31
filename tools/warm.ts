/**
 * Warms the cache with a set of profiles, one at a time.
 *
 * Run this against the deployed instance shortly before it is reviewed. Every
 * warmed profile is then served from cache, so a reviewer sees real data
 * without a live Voyager call — which both protects the session and means a
 * temporary block does not read as a broken API.
 *
 * Usage:
 *   npm run warm -- <url> [url...]                 # local, writes CACHE_FILE
 *   npm run warm -- --remote https://host --key K <url>...
 */
import { loadConfig } from '../src/config.js';
import { ProfileService } from '../src/service.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Rely on the ambient environment.
}

/** LinkedIn tolerates steady traffic far better than bursts. */
const GAP_MS = 8000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function warmRemote(host: string, key: string | undefined, urls: string[]): Promise<void> {
  for (const [i, url] of urls.entries()) {
    const target = `${host.replace(/\/$/, '')}/v1/profiles?url=${encodeURIComponent(url)}&fresh=true`;
    process.stdout.write(`[${i + 1}/${urls.length}] ${url} ... `);
    const res = await fetch(target, { headers: key ? { 'x-api-key': key } : {} });
    const body = (await res.json()) as { profile?: { fullName?: string }; error?: { message?: string } };
    console.log(res.ok ? `ok — ${body.profile?.fullName ?? 'parsed'}` : `FAILED (${res.status}) ${body.error?.message ?? ''}`);
    if (i < urls.length - 1) await sleep(GAP_MS);
  }
}

async function warmLocal(urls: string[]): Promise<void> {
  const config = loadConfig();
  if (!config.cacheFile) {
    console.warn('CACHE_FILE is not set, so this run warms memory only and is lost on exit.\n');
  }
  const service = new ProfileService(config);
  for (const [i, url] of urls.entries()) {
    process.stdout.write(`[${i + 1}/${urls.length}] ${url} ... `);
    try {
      const profile = await service.getProfile(url, { fresh: true });
      console.log(`ok — ${profile.profile.fullName ?? 'parsed'}`);
    } catch (err) {
      console.log(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
    if (i < urls.length - 1) await sleep(GAP_MS);
  }
}

async function main(): Promise<void> {
  const remote = flag('remote');
  const key = flag('key');
  const urls = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== remote && a !== key);

  if (!urls.length) {
    console.error('Pass one or more profile URLs.\n  npm run warm -- https://www.linkedin.com/in/<username>');
    process.exit(1);
  }
  console.log(`Warming ${urls.length} profile(s), ${GAP_MS / 1000}s apart.\n`);
  if (remote) await warmRemote(remote, key, urls);
  else await warmLocal(urls);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
