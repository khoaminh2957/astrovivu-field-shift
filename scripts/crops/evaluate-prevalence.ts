/**
 * Does the suitability score put the crops a country grows above the crops it does not? (K5)
 *
 * Labels: the crop atlas (data/crops/atlas/crop_country.csv), crops with an exact FAOSTAT match
 * only. In a country a crop is "grown" when its level is major or common, "not grown" when it is
 * absent. Minor and present crops are left out: grown a little is neither a clear yes nor a no.
 *
 * Sites: a score needs a place, and a country is not one. The sites are those of the MIRCA-OS
 * validation (data/crops/validation/mirca-os-2015-sites.json, docs/SCORING.md section 10): a
 * cropland pixel in a farmed administrative unit, with 2001-2020 climate and SoilGrids soil,
 * 153 sites in 35 countries. Viet Nam has none there, so the two Vietnamese demo fields of the
 * app stand in for it. Every site of a country is scored against the labels of that country;
 * the country's result is the mean over its sites.
 *
 *   npx tsx scripts/crops/evaluate-prevalence.ts
 *     -> data/crops/prevalence-eval-results.json, and the tables of docs/SCORING_PAPER.md section 6.7
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { CropPrevalence, ModelInput } from '@/contracts';
import { getCrop, loadFullCatalog } from '@/core/crops';
import { assessCrop, LATITUDE_GATE, type AssessOptions } from '@/core/scoring';
import { parseCsvObjects } from './atlas/csv';
import type { ValidationFile } from './build-mirca-validation';
import { countryCropsFromAtlas } from './country-crops';
import { parcelFor, rocAuc, telemetryFor } from './evaluate-mirca-validation';
import { inputFor } from './rank-baseline';

const SITES_FILE = 'data/crops/validation/mirca-os-2015-sites.json';
export const OUT_FILE = 'data/crops/prevalence-eval-results.json';
/** A site enters with at least this many grown and this many not-grown crops. */
export const MIN_PER_CLASS = 5;
const BOOTSTRAP_REPS = 2000;
const SEED = 20261115;

/** MIRCA-OS writes three countries differently from FAOSTAT, whose names the atlas uses. */
const FAOSTAT_NAME: Record<string, string> = { 'South Korea': 'Republic of Korea', México: 'Mexico', Russia: 'Russian Federation' };
/** Demo fields of the app that stand in for a country without a MIRCA-OS site. */
const DEMO_FIELDS: Record<string, string[]> = { VNM: ['daklak-coffee', 'cantho-rice'] };

export type WaterSystem = 'rainfed' | 'irrigated';

/** 1 grown, 0 not grown, null not usable as a label. */
export function labelOf(p: CropPrevalence | undefined): 0 | 1 | null {
  if (!p || p.match !== 'exact') return null;
  if (p.level === 'major' || p.level === 'common') return 1;
  return p.level === 'absent' ? 0 : null;
}

export interface Variant {
  id: string;
  label: string;
  opts: AssessOptions;
}
/** The score as it is, and the latitude gate changed one way at a time (K6; docs/SCORING.md section 13). */
export const VARIANTS: Variant[] = [
  { id: 'current', label: 'Astrovivu-AEZ v2 as it is (latitude gate: factor 0.7 beyond 3° past the limit)', opts: {} },
  { id: 'no-gate', label: 'No latitude gate', opts: { latitudeGate: null } },
  { id: 'tolerance-0', label: 'Factor 0.7 from the limit itself', opts: { latitudeGate: { toleranceDeg: 0, factor: 0.7 } } },
  { id: 'tolerance-10', label: 'Factor 0.7 beyond 10° past the limit', opts: { latitudeGate: { toleranceDeg: 10, factor: 0.7 } } },
  { id: 'factor-0.4', label: 'Factor 0.4 beyond 3° past the limit', opts: { latitudeGate: { toleranceDeg: 3, factor: 0.4 } } },
  { id: 'factor-0', label: 'Excluded beyond 3° past the limit', opts: { latitudeGate: { toleranceDeg: 3, factor: 0 } } },
];

interface Site {
  id: string;
  iso3: string;
  kind: 'mirca-unit' | 'demo-field';
  input: (cropId: string, irrigation: 'rainfed' | 'full') => ModelInput;
}

function sites(): Site[] {
  const file = JSON.parse(readFileSync(SITES_FILE, 'utf8')) as ValidationFile;
  const iso3Of = new Map(parseCsvObjects(readFileSync('data/crops/atlas/country_crops.csv', 'utf8')).map((r) => [r.country, r.iso3]));
  const out: Site[] = file.sites.map((s) => {
    const iso3 = iso3Of.get(FAOSTAT_NAME[s.country] ?? s.country);
    if (!iso3) throw new Error(`${s.country}: not a country of the crop atlas`);
    const telemetry = telemetryFor(s, file.years, 'rain');
    const parcel = parcelFor(s);
    return { id: s.unitCode, iso3, kind: 'mirca-unit', input: (cropId, irrigation) => ({ parcel, telemetry, cropId, groundTruth: { irrigation }, priorities: ['profit'], today: telemetry.window.today }) };
  });
  for (const [iso3, ids] of Object.entries(DEMO_FIELDS))
    for (const id of ids) {
      const base = inputFor(id);
      // Scored like every other site: on the remote-sensed field, without what the grower entered.
      out.push({ id, iso3, kind: 'demo-field', input: (cropId, irrigation) => ({ ...base, cropId, groundTruth: { irrigation } }) });
    }
  return out;
}

export interface SiteResult {
  site: string;
  iso3: string;
  grown: number;
  notGrown: number;
  /** ROC-AUC by variant id, for rainfed and irrigated scores. */
  auc: Record<string, Record<WaterSystem, number>>;
  /** Labelled crops the latitude gate in use applies to at this site. */
  gated: { grown: number; notGrown: number };
}

export interface Distribution {
  n: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
  /** Share of the countries where grown crops score higher than not-grown ones more often than not. */
  above50: number;
  /** 95 % interval of the mean, resampling countries. */
  ci95: [number, number];
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (at - lo);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function distribution(values: number[], seed = SEED): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < BOOTSTRAP_REPS; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return {
    n: values.length,
    mean: r3(mean(values)),
    median: r3(quantile(sorted, 0.5)),
    q1: r3(quantile(sorted, 0.25)),
    q3: r3(quantile(sorted, 0.75)),
    min: r3(sorted[0]),
    max: r3(sorted[sorted.length - 1]),
    above50: r3(values.filter((v) => v > 0.5).length / values.length),
    ci95: [r3(quantile(means, 0.025)), r3(quantile(means, 0.975))],
  };
}

/** Per country: ROC-AUC of a variant minus that of the score as it is. */
export function differences(results: SiteResult[], variant: string, system: WaterSystem): number[] {
  const base = new Map(byCountry(results, 'current', system).map((c) => [c.iso3, c.auc]));
  return byCountry(results, variant, system).map((c) => r3(c.auc - base.get(c.iso3)!));
}

/** Mean of the site results of each country. */
export function byCountry(results: SiteResult[], variant: string, system: WaterSystem): { iso3: string; sites: number; auc: number }[] {
  const groups = new Map<string, number[]>();
  for (const r of results) groups.set(r.iso3, [...(groups.get(r.iso3) ?? []), r.auc[variant][system]]);
  return [...groups].map(([iso3, v]) => ({ iso3, sites: v.length, auc: r3(mean(v)) })).sort((a, b) => a.iso3.localeCompare(b.iso3));
}

export interface Evaluation {
  crops: string[];
  results: SiteResult[];
}

/** Scores every site with every variant. `only` narrows the crops (a subset of the exact crops). */
export function evaluate(variants: Variant[], only?: (cropId: string) => boolean): Evaluation {
  const atlasCrops = parseCsvObjects(readFileSync('data/crops/atlas/crops.csv', 'utf8'));
  const crops = atlasCrops.filter((c) => c.match === 'exact' && getCrop(c.crop_id) && (!only || only(c.crop_id))).map((c) => c.crop_id);
  const tables = new Map<string, Record<string, CropPrevalence>>();
  const results: SiteResult[] = [];
  for (const site of sites()) {
    if (!tables.has(site.iso3)) tables.set(site.iso3, countryCropsFromAtlas(site.iso3).prevalence);
    const table = tables.get(site.iso3)!;
    const labelled = crops.map((id) => [id, labelOf(table[id])] as const).filter((x): x is [string, 0 | 1] => x[1] != null);
    const y = labelled.map(([, label]) => label);
    const grown = y.filter((v) => v === 1).length;
    if (grown < MIN_PER_CLASS || y.length - grown < MIN_PER_CLASS) continue;
    const auc: SiteResult['auc'] = {};
    for (const v of variants) {
      auc[v.id] = { rainfed: 0, irrigated: 0 };
      for (const system of ['rainfed', 'irrigated'] as const) {
        const irrigation = system === 'rainfed' ? 'rainfed' : 'full';
        const scores = labelled.map(([id]) => assessCrop(site.input(id, irrigation), id, { irrigation, ...v.opts })?.bestCompatibility ?? 0);
        auc[v.id][system] = r3(rocAuc(y, scores));
      }
    }
    // Same test as the scorer: the site lies more than the tolerance beyond the crop's latitude limit.
    const lat = site.input(labelled[0][0], 'rainfed').parcel.centroid[1];
    const gated = { grown: 0, notGrown: 0 };
    for (const [id, label] of labelled) {
      const limits = getCrop(id)?.req.latitudeAbs;
      if (limits && Math.abs(lat) > (lat >= 0 ? limits[1] : limits[0]) + LATITUDE_GATE.toleranceDeg) gated[label === 1 ? 'grown' : 'notGrown']++;
    }
    results.push({ site: site.id, iso3: site.iso3, grown, notGrown: y.length - grown, auc, gated });
  }
  return { crops, results };
}

const fmt = (d: Distribution): string => `${d.mean.toFixed(3)} | ${d.ci95[0].toFixed(3)} to ${d.ci95[1].toFixed(3)} | ${d.median.toFixed(3)} | ${d.q1.toFixed(3)} to ${d.q3.toFixed(3)} | ${d.min.toFixed(3)} to ${d.max.toFixed(3)} | ${Math.round(d.above50 * 100)} %`;

async function main() {
  await loadFullCatalog(async () => JSON.parse(readFileSync('public/data/crops/ecocrop.json', 'utf8')));
  const atlasCrops = parseCsvObjects(readFileSync('data/crops/atlas/crops.csv', 'utf8'));
  const alone = new Set(atlasCrops.filter((c) => c.match === 'exact' && c.item_shared_by_n_crops === '1').map((c) => c.crop_id));
  const curated = new Set(atlasCrops.filter((c) => c.curated === 'yes').map((c) => c.crop_id));
  const exactInAtlas = atlasCrops.filter((c) => c.match === 'exact').length;

  const t0 = Date.now();
  const all = evaluate(VARIANTS);
  const subsets = {
    'that are alone on their FAOSTAT item': evaluate([VARIANTS[0]], (id) => alone.has(id)),
    'of the curated list': evaluate([VARIANTS[0]], (id) => curated.has(id)),
  };
  const countries = (e: Evaluation, variant: string, system: WaterSystem) => byCountry(e.results, variant, system);
  const names = new Map(parseCsvObjects(readFileSync('data/crops/atlas/country_crops.csv', 'utf8')).map((r) => [r.iso3, r.country]));

  const summary = Object.fromEntries(
    VARIANTS.map((v) => [v.id, { label: v.label, rainfed: distribution(countries(all, v.id, 'rainfed').map((c) => c.auc)), irrigated: distribution(countries(all, v.id, 'irrigated').map((c) => c.auc)) }]),
  );
  const subsetSummary = Object.fromEntries(
    Object.entries(subsets).map(([name, e]) => [name, { crops: e.crops.length, rainfed: distribution(countries(e, 'current', 'rainfed').map((c) => c.auc)), irrigated: distribution(countries(e, 'current', 'irrigated').map((c) => c.auc)) }]),
  );
  const perCountry = countries(all, 'current', 'rainfed').map((c) => {
    const rs = all.results.filter((r) => r.iso3 === c.iso3);
    return { iso3: c.iso3, country: names.get(c.iso3) ?? c.iso3, sites: c.sites, grown: rs[0].grown, notGrown: rs[0].notGrown, rainfed: c.auc, irrigated: countries(all, 'current', 'irrigated').find((x) => x.iso3 === c.iso3)!.auc };
  });

  const gate = {
    inUse: LATITUDE_GATE,
    reach: {
      labelledPairs: all.results.reduce((a, r) => a + r.grown + r.notGrown, 0),
      gatedGrown: all.results.reduce((a, r) => a + r.gated.grown, 0),
      gatedNotGrown: all.results.reduce((a, r) => a + r.gated.notGrown, 0),
      grownPairs: all.results.reduce((a, r) => a + r.grown, 0),
      notGrownPairs: all.results.reduce((a, r) => a + r.notGrown, 0),
      sitesWithAGatedCrop: all.results.filter((r) => r.gated.grown + r.gated.notGrown > 0).length,
    },
    differenceFromCurrent: Object.fromEntries(
      VARIANTS.filter((v) => v.id !== 'current').map((v) => [v.id, { label: v.label, rainfed: distribution(differences(all.results, v.id, 'rainfed')), irrigated: distribution(differences(all.results, v.id, 'irrigated')) }]),
    ),
  };

  const out = {
    generatedBy: 'scripts/crops/evaluate-prevalence.ts',
    design: {
      labels: 'crop atlas, exact crops; grown = major or common, not grown = absent; minor and present left out',
      sites: `${SITES_FILE} (MIRCA-OS validation sites) and the demo fields ${Object.values(DEMO_FIELDS).flat().join(', ')}`,
      score: 'assessCrop(...).bestCompatibility, at the best sowing window, rainfed and with full irrigation',
      countryResult: 'mean ROC-AUC over the sites of the country',
      minPerClass: MIN_PER_CLASS,
      bootstrap: { reps: BOOTSTRAP_REPS, resampling: 'countries', seed: SEED },
    },
    crops: { exactInAtlas, scored: all.crops.length, notInCatalogue: exactInAtlas - all.crops.length },
    sites: all.results.length,
    countries: perCountry.length,
    summary,
    latitudeGate: gate,
    subsets: subsetSummary,
    perCountry,
    perSite: all.results,
    runtimeSeconds: Math.round((Date.now() - t0) / 100) / 10,
  };
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');

  const lines = [
    `${out.sites} sites in ${out.countries} countries; ${out.crops.scored} exact crops scored (${out.crops.notInCatalogue} of the ${exactInAtlas} are not in the scoring catalogue).`,
    '',
    '| Scored | Water | Mean country ROC-AUC | 95 % interval of the mean | Median | Middle half | Range | Countries above 0.5 |',
    '|---|---|---:|---|---:|---|---|---:|',
    ...VARIANTS.flatMap((v) => [`| ${v.label} | rainfed | ${fmt(summary[v.id].rainfed)} |`, `| ${v.label} | irrigated | ${fmt(summary[v.id].irrigated)} |`]),
    ...Object.entries(subsetSummary).flatMap(([name, s]) => [`| Only crops ${name} (${s.crops}) | rainfed | ${fmt(s.rainfed)} |`, `| Only crops ${name} (${s.crops}) | irrigated | ${fmt(s.irrigated)} |`]),
    '',
    '| Country | Sites | Grown | Not grown | ROC-AUC rainfed | irrigated |',
    '|---|---:|---:|---:|---:|---:|',
    ...[...perCountry].sort((a, b) => b.rainfed - a.rainfed).map((c) => `| ${c.country} | ${c.sites} | ${c.grown} | ${c.notGrown} | ${c.rainfed.toFixed(3)} | ${c.irrigated.toFixed(3)} |`),
  ];
  const g = gate.reach;
  const diff = (d: Distribution): string => `${d.mean >= 0 ? '+' : ''}${d.mean.toFixed(3)} | ${d.ci95[0].toFixed(3)} to ${d.ci95[1].toFixed(3)} | ${d.min.toFixed(3)} to ${d.max.toFixed(3)}`;
  lines.push(
    '',
    `Latitude gate in use: ${g.gatedGrown + g.gatedNotGrown} of ${g.labelledPairs} labelled crop-site pairs (${g.gatedGrown} of ${g.grownPairs} grown, ${g.gatedNotGrown} of ${g.notGrownPairs} not grown), at ${g.sitesWithAGatedCrop} of ${all.results.length} sites.`,
    '',
    '| Latitude gate | Water | Mean change of country ROC-AUC | 95 % interval | Range over countries |',
    '|---|---|---:|---|---|',
    ...Object.values(gate.differenceFromCurrent).flatMap((v) => [`| ${v.label} | rainfed | ${diff(v.rainfed)} |`, `| ${v.label} | irrigated | ${diff(v.irrigated)} |`]),
  );
  console.log(lines.join('\n'));
  console.error(`\nWrote ${OUT_FILE} in ${out.runtimeSeconds} s.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
