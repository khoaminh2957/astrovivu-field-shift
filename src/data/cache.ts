/**
 * Response cache: IndexedDB (idb-keyval) in the browser, `.cache/` on disk in Node. Both are
 * loaded lazily so the browser bundle never touches `node:fs` and Node never touches IndexedDB.
 */
import { isNode, nodeImport } from './env';

interface Entry<T> {
  at: number;
  value: T;
}

type FsP = typeof import('node:fs/promises');
type PathM = typeof import('node:path');
type CryptoM = typeof import('node:crypto');

let disabled = false;
/** Tests and the live smoke can bypass the cache. */
export function setCacheEnabled(on: boolean): void {
  disabled = !on;
}

const DAY = 86_400_000;
export const TTL = { short: DAY / 8, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY } as const;

async function diskPath(key: string): Promise<string> {
  const path = await nodeImport<PathM>('node:path');
  const crypto = await nodeImport<CryptoM>('node:crypto');
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  const prefix = key.split(':')[0].replace(/[^a-z0-9_-]/gi, '') || 'misc';
  return path.join(process.cwd(), '.cache', 'data', prefix, `${hash}.json`);
}

async function read<T>(key: string): Promise<Entry<T> | undefined> {
  try {
    if (isNode) {
      const fs = await nodeImport<FsP>('node:fs/promises');
      return JSON.parse(await fs.readFile(await diskPath(key), 'utf8')) as Entry<T>;
    }
    if (typeof indexedDB === 'undefined') return undefined;
    const { get } = await import('idb-keyval');
    return (await get(key)) as Entry<T> | undefined;
  } catch {
    return undefined;
  }
}

async function write<T>(key: string, value: T): Promise<void> {
  const entry: Entry<T> = { at: Date.now(), value };
  try {
    if (isNode) {
      const fs = await nodeImport<FsP>('node:fs/promises');
      const path = await nodeImport<PathM>('node:path');
      const file = await diskPath(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(entry));
      return;
    }
    if (typeof indexedDB === 'undefined') return;
    const { set } = await import('idb-keyval');
    await set(key, entry);
  } catch {
    // A full or blocked store must never break a data load.
  }
}

/** Return a fresh cached value or compute, store and return it. Failures are never cached. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (!disabled) {
    const hit = await read<T>(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  }
  const value = await fn();
  if (!disabled) await write(key, value);
  return value;
}

/** Round a coordinate for cache keys (~110 m), so tiny vertex nudges reuse responses. */
export const ck = (v: number, d = 3) => v.toFixed(d);
