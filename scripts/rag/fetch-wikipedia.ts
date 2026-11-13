/**
 * Downloads plain-text Wikipedia extracts (CC BY-SA 4.0) for the curated crops and concept
 * articles, English plus the Vietnamese article linked from it. Raw API responses are cached
 * under `.cache/rag/wikipedia/`; normalised snapshots (with revision id for attribution) are
 * written to `data/rag/raw/wikipedia/<lang>/<slug>.json`, which is what the index build reads.
 *
 * Manners: one request at a time, 1 s apart (Wikimedia answered 429 at 4 req/s), Retry-After honoured, `maxlag=5`, 20 s timeout, 3 retries with backoff.
 * Usage: `npx tsx scripts/rag/fetch-wikipedia.ts [--refresh]`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from '../../src/rag/text';
import { CONCEPT_ARTICLES, CURATED } from './curated';

export interface WikiSnapshot {
  lang: 'en' | 'vi';
  title: string;
  pageid: number;
  revid: number;
  url: string;
  fetchedAt: string;
  extract: string;
  /** English title this snapshot was reached from (for vi pages). */
  fromEn?: string;
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const CACHE = path.join(ROOT, '.cache/rag/wikipedia');
export const SNAP_DIR = path.join(ROOT, 'data/rag/raw/wikipedia');
const UA = 'AstrovivuRAG/0.1 (NASA Space Apps Challenge 2026 hackathon; offline index build)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after') ?? 0);
        if (wait > 0) await sleep(Math.min(wait, 60) * 1000);
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      const body = (await res.json()) as { error?: { code: string } };
      if (body.error?.code === 'maxlag') throw new Error('maxlag');
      return body;
    } catch (e) {
      lastErr = e;
      if (String(e).includes('not retried')) break;
      await sleep(5000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

interface ApiPage {
  pageid?: number;
  title: string;
  missing?: boolean;
  extract?: string;
  lastrevid?: number;
  fullurl?: string;
  langlinks?: { lang: string; title: string }[];
}

async function fetchPage(lang: 'en' | 'vi', title: string, refresh: boolean): Promise<ApiPage | null> {
  const cacheFile = path.join(CACHE, lang, `${slugify(title)}.json`);
  if (!refresh && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as ApiPage | null;
  const params = new URLSearchParams({
    action: 'query',
    prop: lang === 'en' ? 'extracts|info|langlinks' : 'extracts|info',
    explaintext: '1',
    exsectionformat: 'wiki',
    inprop: 'url',
    redirects: '1',
    titles: title,
    format: 'json',
    formatversion: '2',
    maxlag: '5',
  });
  if (lang === 'en') params.set('lllang', 'vi');
  const body = (await getJson(`https://${lang}.wikipedia.org/w/api.php?${params}`)) as { query?: { pages?: ApiPage[] } };
  await sleep(1000);
  const page = body.query?.pages?.[0];
  const out = page && !page.missing && page.extract ? page : null;
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

function writeSnapshot(s: WikiSnapshot, slug: string, refresh = false): void {
  const file = path.join(SNAP_DIR, s.lang, `${slug}.json`);
  if (!refresh && fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(s, null, 1)}\n`);
}

export async function fetchAll(refresh = false): Promise<{ ok: number; missing: string[] }> {
  const titles = [...CURATED.map((c) => c.wiki), ...CONCEPT_ARTICLES.map((c) => c.wiki)];
  const missing: string[] = [];
  let ok = 0;
  for (const title of titles) {
    const slug = slugify(title);
    const enFile = path.join(SNAP_DIR, 'en', `${slug}.json`);
    const viFile = path.join(SNAP_DIR, 'vi', `${slug}.json`);
    // Pages already snapshotted in both languages are skipped; otherwise the raw cache answers
    // without network, and only the missing language is downloaded.
    if (!refresh && fs.existsSync(enFile) && fs.existsSync(viFile)) {
      ok++;
      continue;
    }
    try {
      const en = await fetchPage('en', title, refresh);
      if (!en) {
        missing.push(`en:${title}`);
        continue;
      }
      const fetchedAt = new Date().toISOString();
      writeSnapshot(
        { lang: 'en', title: en.title, pageid: en.pageid ?? 0, revid: en.lastrevid ?? 0, url: en.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(en.title)}`, fetchedAt, extract: en.extract ?? '' },
        slug,
        refresh,
      );
      ok++;
      const viTitle = en.langlinks?.find((l) => l.lang === 'vi')?.title;
      if (!viTitle) {
        missing.push(`vi:${title}`);
        continue;
      }
      const vi = await fetchPage('vi', viTitle, refresh);
      if (!vi) {
        missing.push(`vi:${title}`);
        continue;
      }
      writeSnapshot(
        { lang: 'vi', title: vi.title, pageid: vi.pageid ?? 0, revid: vi.lastrevid ?? 0, url: vi.fullurl ?? `https://vi.wikipedia.org/wiki/${encodeURIComponent(vi.title)}`, fetchedAt, extract: vi.extract ?? '', fromEn: en.title },
        slug,
        refresh,
      );
      console.log(`  ${title} -> vi:${vi.title}`);
    } catch (e) {
      console.warn(`  ! ${title}: ${String(e)}`);
      missing.push(`err:${title}`);
    }
  }
  return { ok, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const refresh = process.argv.includes('--refresh');
  fetchAll(refresh).then((r) => {
    console.log(`Wikipedia snapshots: ${r.ok} English pages; missing: ${r.missing.join(', ') || 'none'}`);
  });
}
