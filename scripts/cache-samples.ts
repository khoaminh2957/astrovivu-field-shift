/**
 * Builds the demo caches `public/data/samples/<id>.json` for the parcels in src/data/samples.ts.
 *
 *   npm run data:samples                      # all four
 *   npm run data:samples -- iowa-corn-soy     # one or more ids
 *   npm run data:samples -- --today=2026-11-14
 *
 * Uses the same live adapters as the app plus the slower Node-only sources (`full`): 5-year MODIS
 * baselines, night LST and MOD16 ET, OpenTopoData SRTM, Cropland Data Layer, and SMAP L4 via
 * AppEEARS when EARTHDATA_TOKEN is set. Responses are cached under .cache/, so a re-run after the
 * globe agent moves polygon vertices only refetches what depends on the new geometry.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FieldTelemetry } from '../src/contracts';
import { BRANCHES, pick } from '../src/contracts';
import { loadTelemetry, SAMPLE_PARCELS } from '../src/data';
import { todayISO } from '../src/lib/time';

async function loadDotEnv(): Promise<void> {
  try {
    const text = await readFile(path.join(process.cwd(), '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env: token-protected sources are skipped
  }
}

const args = process.argv.slice(2);
const today = args.find((a) => a.startsWith('--today='))?.slice(8) ?? todayISO();
const ids = args.filter((a) => !a.startsWith('--'));
const parcels = SAMPLE_PARCELS.filter((p) => ids.length === 0 || ids.includes(p.id));
if (parcels.length === 0) {
  console.error(`No sample parcel matches ${ids.join(', ')}. Known: ${SAMPLE_PARCELS.map((p) => p.id).join(', ')}`);
  process.exit(1);
}

await loadDotEnv();
const outDir = path.join(process.cwd(), 'public', 'data', 'samples');
await mkdir(outDir, { recursive: true });
console.log(`Caching ${parcels.length} sample(s) for the window ending ${today}${process.env.EARTHDATA_TOKEN ? ' (Earthdata token present)' : ''}`);

const summarise = (t: FieldTelemetry) =>
  BRANCHES.map((b) => `${b}:${t.branches[b].status}(${t.branches[b].sources.join('+') || '-'})`).join(' ');

let failed = 0;
await Promise.all(
  parcels.map(async (p) => {
    const t0 = Date.now();
    try {
      // Copy: the loader writes elevationM onto the parcel object.
      const t = await loadTelemetry({ ...p }, { mode: 'live', full: true, today });
      const ok = BRANCHES.filter((b) => t.branches[b].status !== 'unavailable').length;
      if (t.mode === 'mock' || ok < 4) throw new Error(`only ${ok}/8 branches have data (${summarise(t)})`);
      t.mode = 'cached';
      await writeFile(path.join(outDir, `${p.id}.json`), JSON.stringify(t));
      console.log(`\n✓ ${p.id} in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${summarise(t)}`);
      console.log(`  climateHistory ${t.climateHistory?.length ?? 0} y, cropHistory ${t.cropHistory?.map((c) => `${c.year}:${c.crop}`).join(' ') ?? '-'}`);
      for (const b of BRANCHES) for (const n of t.branches[b].notes ?? []) console.log(`  [${b}] ${pick(n, 'en')}`);
    } catch (e) {
      failed++;
      console.error(`\n✗ ${p.id}: ${e instanceof Error ? e.message : String(e)} (existing cache, if any, left untouched)`);
    }
  }),
);
process.exit(failed ? 1 : 0);
