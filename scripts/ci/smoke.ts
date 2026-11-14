/**
 * Smoke test of a built site: the page a visitor gets first, every script and stylesheet that page
 * loads, and the crop catalogue the app cannot start without. It answers one question, "does this
 * build come up at all", for `vite preview` in CI and for the production site after a deployment.
 *
 *   npx tsx scripts/ci/smoke.ts http://127.0.0.1:4173 --wait=30
 *   npx tsx scripts/ci/smoke.ts https://astrovivu-field-shift.vercel.app
 *
 * `--wait=N` keeps trying for N seconds until the server answers (a preview server needs a moment
 * to start). Exit code 1 when a check fails. In GitHub Actions the result is added to the job summary.
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Same-origin scripts and stylesheets the page loads before it can render. */
export function pageAssets(html: string, pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const found = new Set<string>();
  const tags = html.match(/<(script|link)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const isScript = /^<script/i.test(tag);
    if (!isScript && !/\brel=["']?(stylesheet|modulepreload)\b/i.test(tag)) continue;
    const ref = new RegExp(`\\b${isScript ? 'src' : 'href'}=["']([^"']+)["']`, 'i').exec(tag)?.[1];
    if (!ref) continue;
    const url = new URL(ref, page);
    if (url.origin === page.origin) found.add(url.href);
  }
  return [...found];
}

async function get(url: string): Promise<{ status: number; type: string; body: string }> {
  let last: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'astrovivu-smoke-test' }, redirect: 'follow' });
      // A 5xx may be a deployment still switching over: worth another try. Anything else is an answer.
      if (res.status >= 500 && attempt < ATTEMPTS - 1) continue;
      return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function check(name: string, run: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await run() };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

const kb = (text: string): string => `${(Buffer.byteLength(text) / 1024).toFixed(0)} kB`;

export async function smoke(baseUrl: string): Promise<Check[]> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const checks: Check[] = [];
  let html = '';

  checks.push(
    await check('page', async () => {
      const res = await get(base);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      if (!res.type.includes('text/html')) throw new Error(`content type "${res.type}", expected text/html`);
      if (!/id=["']root["']/.test(res.body)) throw new Error('no element with id "root": this is not the app');
      html = res.body;
      return `HTTP 200, ${kb(res.body)}`;
    }),
  );
  if (!html) return checks;

  const assets = pageAssets(html, base);
  checks.push(
    await check('page loads a script', async () => {
      const scripts = assets.filter((a) => new URL(a).pathname.endsWith('.js'));
      if (scripts.length === 0) throw new Error('the page references no same-origin script');
      return `${scripts.length} script(s), ${assets.length - scripts.length} stylesheet(s)`;
    }),
  );
  for (const asset of assets) {
    const path = new URL(asset).pathname;
    checks.push(
      await check(path, async () => {
        const res = await get(asset);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const expected = path.endsWith('.css') ? 'css' : 'javascript';
        // A host that answers every unknown path with index.html would pass a status check alone.
        if (!res.type.includes(expected)) throw new Error(`content type "${res.type}", expected ${expected}`);
        if (res.body.length === 0) throw new Error('empty file');
        return `HTTP 200, ${kb(res.body)}`;
      }),
    );
  }

  checks.push(
    await check('data/crops/ecocrop.json', async () => {
      const res = await get(new URL('data/crops/ecocrop.json', base).href);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const catalogue = JSON.parse(res.body) as { count?: number; rows?: unknown[] };
      if (!Array.isArray(catalogue.rows) || catalogue.rows.length === 0) throw new Error('the catalogue has no rows');
      if (catalogue.count !== catalogue.rows.length) throw new Error(`count says ${catalogue.count}, the file holds ${catalogue.rows.length} rows`);
      return `${catalogue.rows.length} species, ${kb(res.body)}`;
    }),
  );
  return checks;
}

async function waitFor(url: string, seconds: number): Promise<void> {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(3000) });
      return;
    } catch {
      if (Date.now() > until) throw new Error(`${url} did not answer within ${seconds} s`);
      await sleep(500);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  const wait = Number(args.find((a) => a.startsWith('--wait='))?.slice(7) ?? 0);
  if (!url) {
    console.error('Usage: npx tsx scripts/ci/smoke.ts <base-url> [--wait=seconds]');
    process.exit(2);
  }
  if (wait > 0) await waitFor(url, wait);
  const checks = await smoke(url);
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}  ${c.detail}`);
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `\n${failed.length} of ${checks.length} checks failed for ${url}` : `\n${checks.length} checks passed for ${url}`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const rows = checks.map((c) => `| ${c.ok ? 'pass' : '**FAIL**'} | \`${c.name}\` | ${c.detail.replaceAll('|', '\\|')} |`);
    appendFileSync(summary, [`### Smoke test: ${url}`, '', '| Result | Check | Detail |', '|---|---|---|', ...rows, ''].join('\n'));
  }
  if (failed.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
