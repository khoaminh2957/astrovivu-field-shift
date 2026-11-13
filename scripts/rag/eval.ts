/**
 * Retrieval evaluation: recall@5 and MRR over data/rag/eval.json for several retrieval variants.
 * `npx tsx scripts/rag/eval.ts` prints the table used in docs/RAG.md; eval.test.ts guards it.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FieldContext, KnowledgeChunk, Lang } from '../../src/contracts';
import { analyze, search, type SearchOptions } from '../../src/rag/retrieve';
import { KnowledgeStore } from '../../src/rag/store';
import { fileLoader } from '../../server/loader';

const ROOT = path.resolve(import.meta.dirname, '../..');

export interface EvalQuestion {
  id: string;
  lang: Lang;
  q: string;
  field?: boolean;
  docs?: string[];
  crops?: string[];
  intent?: string;
}

export function loadEval(): EvalQuestion[] {
  return (JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rag/eval.json'), 'utf8')) as { questions: EvalQuestion[] }).questions;
}

/**
 * Test fixture, NOT real telemetry: values shaped like the Đắk Lắk demo point in
 * docs/DATA_SOURCES.md (SoilGrids pH 5.6, clay 339 g/kg) so field questions can be evaluated.
 */
export const FIXTURE_CONTEXT: FieldContext = {
  parcelName: 'Eval fixture (not real telemetry)',
  place: 'Đắk Lắk, Vietnam',
  location: [108.2, 12.8],
  areaHa: 2,
  cropId: 'coffea-canephora',
  date: '2026-11-10',
  facts: {
    ph: '5.6 (SoilGrids v2.0, 250 m pixel, modelled; 5-95%: 4.9-6.3)',
    clay_pct: '33.9 % (SoilGrids v2.0, 250 m pixel, modelled)',
    texture_class: 'clay loam (SoilGrids v2.0, 250 m pixel, modelled)',
    drainage_class: 'well (derived from SRTM slope)',
    elevation_m: '602 m (SRTM, 30 m pixel)',
    sm_root: '0.21 m³/m³ (SMAP L4, 9 km pixel, modelled, 2026-11-08; 9% below normal (within the normal band, normal 0.23))',
    ndvi: '0.71 (MODIS MOD13Q1, 250 m pixel, 2026-10-16)',
    t2m_min: '18.2 °C (NASA POWER, 50 km pixel, modelled, 2026-11-09)',
    climate_t_mean: '23.4 °C mean annual air temperature (ERA5, 9 km pixel, modelled, 2005-2024)',
    climate_monthly_t: 'Jan 21.1, Feb 22.6, Mar 24.4, Apr 25.6, May 25.4, Jun 24.6, Jul 24.1, Aug 24, Sep 23.6, Oct 23, Nov 22.3, Dec 21.2 °C (monthly means, ERA5, 2005-2024)',
    climate_rain_annual: '1620 mm mean annual rainfall (ERA5, 9 km pixel, modelled, 2005-2024)',
    climate_monthly_rain: 'Jan 8, Feb 5, Mar 22, Apr 75, May 190, Jun 210, Jul 230, Aug 260, Sep 280, Oct 210, Nov 95, Dec 35 mm (monthly means, ERA5, 2005-2024)',
    rain_30d: '96 mm over the 30 days to 2026-11-10 (GPM IMERG, 10 km pixel)',
    score_now: '71/100 productivity on 2026-11-10 (condition 74, compatibility 88; score confidence 0.62)',
    'score_2026-01': '78/100; limiting Temperature 0.86',
    'score_2026-02': '74/100; limiting Water 0.7',
    'score_2026-03': '52/100; limiting Water 0.41',
    'score_2026-04': '58/100; limiting Water 0.49',
    'score_2026-05': '80/100; limiting Radiation 0.84',
  },
  limitingFactor: 'Water (score 0.6)',
  productivity: 71,
};

export interface VariantResult {
  name: string;
  recall5: number;
  mrr: number;
  misses: string[];
}

const isRelevant = (q: EvalQuestion, c: KnowledgeChunk) => (q.docs ?? []).includes(c.docId) || (c.cropIds ?? []).some((id) => (q.crops ?? []).includes(id));

export const VARIANTS: { name: string; opts: SearchOptions | 'plain' }[] = [
  { name: 'BM25 only (fields + boosts, no query analysis)', opts: 'plain' },
  { name: '+ Vietnamese→English expansion', opts: { cropBoost: false, pin: false, kindBoost: false, langBoost: false, expansion: true } },
  { name: '+ crop linking (alias boost, fact sheet pinned)', opts: { cropBoost: true, pin: true, kindBoost: false, langBoost: false, expansion: true } },
  { name: 'Full pipeline (+ intent kind boost, language boost)', opts: {} },
];

export async function loadStore(): Promise<KnowledgeStore> {
  const store = new KnowledgeStore(fileLoader(path.join(ROOT, 'public/rag')));
  await store.ensureFull();
  return store;
}

export function runVariant(store: KnowledgeStore, qs: EvalQuestion[], v: (typeof VARIANTS)[number], k = 5): VariantResult {
  let hit = 0;
  let rr = 0;
  const misses: string[] = [];
  for (const q of qs) {
    const ctx = q.field ? FIXTURE_CONTEXT : undefined;
    let ranked: KnowledgeChunk[];
    if (v.opts === 'plain') {
      ranked = (store.index?.search(q.q) ?? []).slice(0, 20).map((r) => store.chunks.get(String(r.id))!).filter(Boolean);
    } else {
      const a = analyze(store, q.q, q.lang, Boolean(ctx), ctx?.cropId);
      ranked = search(store, a, 10, 2, v.opts).map((h) => h.chunk);
    }
    const rank = ranked.findIndex((c) => isRelevant(q, c));
    if (rank >= 0 && rank < k) hit++;
    else misses.push(q.id);
    if (rank >= 0) rr += 1 / (rank + 1);
  }
  return { name: v.name, recall5: hit / qs.length, mrr: rr / qs.length, misses };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const store = await loadStore();
  const qs = loadEval();
  const langs: [string, EvalQuestion[]][] = [['all', qs], ['en', qs.filter((q) => q.lang === 'en')], ['vi', qs.filter((q) => q.lang === 'vi')]];
  console.log(`| Variant | recall@5 (all / en / vi) | MRR (all / en / vi) |`);
  console.log(`|---|---|---|`);
  for (const v of VARIANTS) {
    const r = langs.map(([, sub]) => runVariant(store, sub, v));
    console.log(`| ${v.name} | ${r.map((x) => x.recall5.toFixed(2)).join(' / ')} | ${r.map((x) => x.mrr.toFixed(2)).join(' / ')} |`);
    if (r[0].misses.length) console.log(`|   misses: ${r[0].misses.join(', ')} | | |`);
  }
  // Intent routing accuracy on questions that state an expected intent.
  const withIntent = qs.filter((q) => q.intent);
  const wrong = withIntent.filter((q) => {
    const ctx = q.field ? FIXTURE_CONTEXT : undefined;
    return analyze(store, q.q, q.lang, Boolean(ctx), ctx?.cropId).intent !== q.intent;
  });
  console.log(`\nIntent routing: ${withIntent.length - wrong.length}/${withIntent.length} correct${wrong.length ? `; wrong: ${wrong.map((q) => `${q.id}=${analyze(store, q.q, q.lang, Boolean(q.field), FIXTURE_CONTEXT.cropId).intent}`).join(', ')}` : ''}`);
}
