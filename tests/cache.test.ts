import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TtlCache } from '../src/cache.js';

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cache-test-'));
  dirs.push(dir);
  return join(dir, 'cache.json');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('TtlCache', () => {
  it('returns a value before it expires and drops it after', async () => {
    const cache = new TtlCache<string>(30, 10);
    cache.set('a', 'value');
    expect(cache.get('a')).toBe('value');
    await new Promise((r) => setTimeout(r, 45));
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry past the cap', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' is now the most recent, so 'b' should go first.
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('survives a restart when backed by a file', () => {
    const file = tempFile();
    const first = new TtlCache<string>(60_000, 10, file);
    first.set('profile', 'warmed');
    expect(existsSync(file)).toBe(true);

    // A new instance stands in for a restarted container.
    const second = new TtlCache<string>(60_000, 10, file);
    expect(second.get('profile')).toBe('warmed');
  });

  it('does not reload entries that expired while the process was down', async () => {
    const file = tempFile();
    new TtlCache<string>(20, 10, file).set('stale', 'value');
    await new Promise((r) => setTimeout(r, 40));
    expect(new TtlCache<string>(20, 10, file).get('stale')).toBeUndefined();
  });

  it('works when the snapshot file cannot be read', () => {
    const cache = new TtlCache<string>(60_000, 10, '/nonexistent/dir/cache.json');
    cache.set('a', 'b');
    expect(cache.get('a')).toBe('b');
  });
});
