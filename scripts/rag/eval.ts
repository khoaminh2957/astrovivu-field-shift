/**
 * Evaluation over data/rag/eval.json: recall@5 and MRR of several retrieval variants on the
 * questions that have something to retrieve, and routing (intent, kind of field question, focus,
 * reason for declining) on the questions that state what they expect.
 * `npx tsx scripts/rag/eval.ts` prints the tables used in docs/RAG.md; eval.test.ts guards them.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FieldContext, KnowledgeChunk, Lang } from '../../src/contracts';
import { lookupFieldFacts } from '../../src/rag/fieldFacts';
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
  /** For `field-fact`: value, month-extreme or forecast. */
  ask?: string;
  /** Focuses the router must find; it may find more. An empty list means it must find none. */
  focus?: string[];
  /** Focuses the router must not find ("năng suất" is not "nắng"). */
  notFocus?: string[];
  /**
   * For a question about a reading of the field: the readings the answer must be made of, as keys
   * of the fixture's facts, and no others; and the readings it must name as missing.
   */
  facts?: string[];
  missing?: string[];
  /** For `off-topic`: the reason the question is declined. */
  outOfScope?: string;
  /** Row of the scope table in docs/RAG.md. */
  group?: string;
}

/** Questions with something to retrieve. The others are answered from the field's own readings. */
export const hasTarget = (q: EvalQuestion): boolean => Boolean(q.docs?.length || q.crops?.length);

/** What the router got wrong for a question, as short notes; empty when all it states is met. */
export function routingErrors(store: KnowledgeStore, q: EvalQuestion): string[] {
  const ctx = q.field ? FIXTURE_CONTEXT : undefined;
  const a = analyze(store, q.q, q.lang, Boolean(ctx), ctx?.cropId);
  const out: string[] = [];
  if (q.intent && a.intent !== q.intent) out.push(`intent=${a.intent}`);
  if (q.ask && a.ask !== q.ask) out.push(`ask=${a.ask ?? 'none'}`);
  if (q.outOfScope && a.outOfScope !== q.outOfScope) out.push(`declined=${a.outOfScope ?? 'none'}`);
  if (q.focus && (q.focus.length ? !q.focus.every((f) => (a.focus as string[]).includes(f)) : a.focus.length > 0)) out.push(`focus=${a.focus.join('+') || 'none'}`);
  if (q.notFocus?.some((f) => (a.focus as string[]).includes(f))) out.push(`focus=${a.focus.join('+')} holds one of ${q.notFocus.join('+')}`);
  return out;
}

/**
 * What the content of an answer about a reading gets wrong: the readings it would be made of
 * against the ones the question states, and the same for the readings named as missing. Routing
 * to the right intent is not enough: "how far can I trust the soil moisture of my field" must
 * come back with the soil moisture and with nothing else.
 */
export function readingErrors(store: KnowledgeStore, q: EvalQuestion): string[] {
  if (!q.facts && !q.missing) return [];
  const a = analyze(store, q.q, q.lang, true, FIXTURE_CONTEXT.cropId);
  const { readings, missing } = lookupFieldFacts(FIXTURE_CONTEXT, a.focus, a.termIds, q.lang);
  const same = (got: string[], want: string[]) => got.length === want.length && want.every((k) => got.includes(k));
  const out: string[] = [];
  const got = readings.map((r) => r.key);
  const gone = missing.map((m) => m.key);
  if (!same(got, q.facts ?? [])) out.push(`readings=${got.join('+') || 'none'}, expected ${(q.facts ?? []).join('+') || 'none'}`);
  if (!same(gone, q.missing ?? [])) out.push(`missing=${gone.join('+') || 'none'}, expected ${(q.missing ?? []).join('+') || 'none'}`);
  return out;
}

export function loadEval(): EvalQuestion[] {
  return (JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rag/eval.json'), 'utf8')) as { questions: EvalQuestion[] }).questions;
}

/**
 * Test fixture, NOT real telemetry: values shaped like the Đắk Lắk demo point in
 * docs/DATA_SOURCES.md (SoilGrids pH 5.6, clay 339 g/kg) so field questions can be evaluated.
 * It has no salinity, drainage survey or soil depth on purpose, as a field outside the United
 * States has none: questions about them must come back as "no value for this field".
 * `sampleContext` (sample-context.ts) gives the context of a real demo field.
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
    slope_deg: '7.7 ° (SRTM, 30 m pixel)',
    relief_m: '14 m (SRTM, 30 m pixel)',
    soc_gkg: '19.4 g/kg (SoilGrids v2.0, 250 m pixel, modelled; 5-95%: 3.9-44.1)',
    forecast_tmin: '18.5 °C lowest forecast minimum, on 2026-11-24 (16-day weather forecast (Open-Meteo), 11 km pixel, forecast, 2026-11-10 to 2026-11-25)',
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
  const all = loadEval();
  const qs = all.filter(hasTarget);
  const langs: [string, EvalQuestion[]][] = [['all', qs], ['en', qs.filter((q) => q.lang === 'en')], ['vi', qs.filter((q) => q.lang === 'vi')]];
  console.log(`${all.length} questions, ${qs.length} with something to retrieve.\n`);
  console.log(`| Variant | recall@5 (all / en / vi) | MRR (all / en / vi) |`);
  console.log(`|---|---|---|`);
  for (const v of VARIANTS) {
    const r = langs.map(([, sub]) => runVariant(store, sub, v));
    console.log(`| ${v.name} | ${r.map((x) => x.recall5.toFixed(2)).join(' / ')} | ${r.map((x) => x.mrr.toFixed(2)).join(' / ')} |`);
    if (r[0].misses.length) console.log(`|   misses: ${r[0].misses.join(', ')} | | |`);
  }
  // Routing on the questions that state what they expect, by group of the scope table.
  const stated = all.filter((q) => q.intent);
  const groups = [...new Set(stated.map((q) => q.group ?? 'crops and terms'))];
  console.log('\n| Group | Questions (en / vi) | Routed as expected |');
  console.log('|---|---|---|');
  const wrong: string[] = [];
  for (const g of groups) {
    const sub = stated.filter((q) => (q.group ?? 'crops and terms') === g);
    const bad = sub.filter((q) => routingErrors(store, q).length > 0);
    wrong.push(...bad.map((q) => `${q.id}: ${routingErrors(store, q).join(', ')}`));
    console.log(`| ${g} | ${sub.length} (${sub.filter((q) => q.lang === 'en').length} / ${sub.filter((q) => q.lang === 'vi').length}) | ${sub.length - bad.length} |`);
  }
  console.log(`\nRouting: ${stated.length - wrong.length}/${stated.length} as expected${wrong.length ? `; wrong: ${wrong.join('; ')}` : ''}`);
  // Content of the answers about a reading: the readings the answer is made of.
  const withContent = all.filter((q) => q.facts || q.missing);
  const off = withContent.flatMap((q) => readingErrors(store, q).map((e) => `${q.id}: ${e}`));
  console.log(`Readings: ${withContent.length - new Set(off.map((e) => e.split(':')[0])).size}/${withContent.length} answers made of the stated readings and no others${off.length ? `; wrong: ${off.join('; ')}` : ''}`);
}
