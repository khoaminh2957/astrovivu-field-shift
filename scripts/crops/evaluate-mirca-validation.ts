/**
 * Both suitability methods (Astrovivu-AEZ v2 and CropSuite) against agricultural statistics they
 * were not built on: MIRCA-OS 2015 harvested area per administrative unit, crop and water system,
 * with planting months (see `build-mirca-validation.ts` for the sample and its inputs).
 *
 * Three questions:
 *   1. Suitability: does a method score the crops a unit grows above the crops it does not grow?
 *   2. Calendar: does the method rate the month farmers plant in as suitable, and is its best month near it?
 *   3. Multiple cropping (CropSuite only): does it find two harvests where rice is grown twice a year?
 *
 * Run: `npx tsx scripts/crops/evaluate-mirca-validation.ts` -> `data/crops/mirca-validation-results.json`
 *   --partial   read the sites built so far from `.cache/validation/sites/` (while the builder runs; nothing is written)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BranchTelemetry, FieldTelemetry, ModelInput, Parcel, StaticFact, YearClimate } from '@/contracts';
import { BRANCHES, tx } from '@/contracts';
import { getCrop, loadFullCatalog } from '@/core/crops';
import { assessCrop, climateZones, scanSowingWindows, type AssessOptions } from '@/core/scoring';
import { makeFact } from '@/data/build';
import type { ClassStat, ValidationFile, ValidationSite } from './build-mirca-validation';

const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;
const SITES_FILE = 'data/crops/validation/mirca-os-2015-sites.json';
const OUT_FILE = 'data/crops/mirca-validation-results.json';

// ------------------------------------------------------------------------------------------------
// Design choices
// ------------------------------------------------------------------------------------------------

/** MIRCA-OS crop class -> catalogue crops. A class with several species takes the best-scoring one. */
export const CROP_CLASSES: Record<string, { ids: string[]; curated: boolean; perennial?: boolean }> = {
  Barley: { ids: ['hordeum-vulgare'], curated: true },
  Cassava: { ids: ['manihot-esculenta'], curated: true },
  Coffee: { ids: ['coffea-arabica', 'coffea-canephora'], curated: true, perennial: true },
  Groundnuts: { ids: ['arachis-hypogaea'], curated: true },
  Maize: { ids: ['zea-mays'], curated: true },
  Potatoes: { ids: ['solanum-tuberosum'], curated: true },
  Rapeseed: { ids: ['brassica-napus'], curated: true },
  Rice: { ids: ['oryza-sativa'], curated: true },
  Rye: { ids: ['secale-cereale'], curated: true },
  Sorghum: { ids: ['sorghum-bicolor'], curated: true },
  Soybeans: { ids: ['glycine-max'], curated: true },
  'Sugar cane': { ids: ['saccharum-officinarum'], curated: true, perennial: true },
  Sunflower: { ids: ['helianthus-annuus'], curated: true },
  Wheat: { ids: ['triticum-aestivum'], curated: true },
  // Species outside the 73 curated crops: scored from raw EcoCrop values, reported separately.
  Cocoa: { ids: ['theobroma-cacao'], curated: false, perennial: true },
  Cotton: { ids: ['gossypium-hirsutum'], curated: false },
  Millet: { ids: ['pennisetum-glaucum', 'eleusine-coracana-ssp-coracana', 'setaria-italica', 'panicum-miliaceum'], curated: false },
  'Oil palm': { ids: ['elaeis-guineensis'], curated: false, perennial: true },
  'Sugar beet': { ids: ['beta-vulgaris-var-saccharifera'], curated: false },
};

/** A crop counts as grown from this share of the unit's harvested area (and at least 100 ha). */
const PRESENT_SHARE = 0.01;
const PRESENT_MIN_HA = 100;
/** "Not grown under irrigation" is only a statement where the unit irrigates at all. */
const IRRIGATING_SHARE = 0.05;
const IRRIGATING_MIN_HA = 1000;
/** A cropping season enters the calendar test from this share of the crop's area in the unit. */
const SEASON_SHARE = 0.2;

type System = 'rainfed' | 'irrigated';
interface MethodDef {
  id: string;
  label: string;
  opts: AssessOptions;
  /** Score from which the method itself calls a crop suitable. */
  threshold: number;
}
const METHODS: MethodDef[] = [
  { id: 'astrovivu-v2', label: 'Astrovivu-AEZ v2', opts: { method: 'astrovivu-v2' }, threshold: 0.45 },
  { id: 'cropsuite', label: 'CropSuite, as published', opts: { method: 'cropsuite', multipleCropping: false }, threshold: 0.33 },
  { id: 'cropsuite-no-variability', label: 'CropSuite without climate variability', opts: { method: 'cropsuite', cropSuite: { variability: false }, multipleCropping: false }, threshold: 0.33 },
];

// ------------------------------------------------------------------------------------------------
// Model input for a validation site
// ------------------------------------------------------------------------------------------------

type RainSeries = 'rain' | 'rainPower';

function telemetryFor(s: ValidationSite, years: [number, number], rainKey: RainSeries): FieldTelemetry {
  const c = s.climate;
  const history: YearClimate[] = [];
  for (let y = years[0]; y <= years[1]; y++) {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const i = (y - years[0]) * 12 + m - 1;
      months.push({ month: m, rainMm: c[rainKey][i] ?? null, tMean: c.tMean[i] ?? null, tMin: c.tMin[i] ?? null, tMax: c.tMax[i] ?? null });
    }
    history.push({ year: y, months });
  }
  const soil: StaticFact[] = s.soil
    ? [
        makeFact('ph', 'soil', 'soilgrids', s.soil.ph),
        makeFact('soc_gkg', 'soil', 'soilgrids', s.soil.socGkg, 'g/kg'),
        makeFact('clay_pct', 'soil', 'soilgrids', s.soil.clayPct, '%'),
        makeFact('sand_pct', 'soil', 'soilgrids', s.soil.sandPct, '%'),
        makeFact('cec_cmolkg', 'soil', 'soilgrids', s.soil.cecCmolKg, 'cmol(+)/kg'),
      ]
    : [];
  // No slope: one pixel's slope says nothing about a unit tens of kilometres wide, so neither method scores it.
  const terrain: StaticFact[] = s.elevationM != null ? [makeFact('elevation_m', 'terrain', 'copernicus-dem', s.elevationM, 'm')] : [];
  const branch = (id: (typeof BRANCHES)[number], facts: StaticFact[]): BranchTelemetry => ({
    id,
    title: tx(id, id),
    series: [],
    facts,
    sources: facts.length ? [facts[0].sourceId] : [],
    status: facts.length ? 'partial' : 'unavailable',
    confidence: { level: 'low', score: 0, reasons: [] },
  });
  const end = `${years[1]}-12-31`;
  return {
    parcelId: `mirca-${s.unitCode}`,
    generatedAt: `${end}T00:00:00Z`,
    window: { start: `${years[1]}-01-01`, end, today: end },
    branches: Object.fromEntries(BRANCHES.map((b) => [b, branch(b, b === 'soil' ? soil : b === 'terrain' ? terrain : [])])) as FieldTelemetry['branches'],
    sources: {},
    mode: 'cached',
    climateHistory: history,
    climateSourceId: rainKey === 'rain' ? 'gpcc+nasa-power' : 'nasa-power',
  };
}

function parcelFor(s: ValidationSite): Parcel {
  const [lon, lat] = s.site;
  const d = 0.0005;
  return {
    id: `mirca-${s.unitCode}`,
    name: [s.district, s.province, s.country].filter(Boolean).join(', '),
    polygon: { type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] },
    centroid: [lon, lat],
    bbox: [lon - d, lat - d, lon + d, lat + d],
    areaHa: 1,
    source: 'sample',
    isUS: false,
    ...(s.elevationM != null ? { elevationM: s.elevationM } : {}),
  };
}

// ------------------------------------------------------------------------------------------------
// Labels
// ------------------------------------------------------------------------------------------------

type NegativeKind = 'absent' | 'irrigated-only';
interface Label {
  viable: 0 | 1;
  /** For a 0: the crop is not grown in the unit at all, or only with irrigation. */
  kind?: NegativeKind;
}

/** null = no statement (a trace area, or a unit without irrigation asked about irrigated crops). */
export function labelOf(c: ClassStat | undefined, system: System, totalHa: number, irrigatedHa: number, presentShare = PRESENT_SHARE): Label | null {
  const rf = c?.rfHa ?? 0;
  const ir = c?.irHa ?? 0;
  const present = Math.max(PRESENT_MIN_HA, presentShare * totalHa);
  if (system === 'rainfed') {
    if (rf >= present) return { viable: 1 };
    if (rf === 0) return { viable: 0, kind: ir >= present ? 'irrigated-only' : 'absent' };
    return null;
  }
  if (ir >= present) return { viable: 1 };
  if (rf === 0 && ir === 0 && irrigatedHa >= Math.max(IRRIGATING_MIN_HA, IRRIGATING_SHARE * totalHa)) return { viable: 0, kind: 'absent' };
  return null;
}

// ------------------------------------------------------------------------------------------------
// Metrics
// ------------------------------------------------------------------------------------------------

/** ROC-AUC by ranks (ties share their mean rank). NaN when one class is missing. */
export function rocAuc(y: ArrayLike<number>, s: ArrayLike<number>, idx?: ArrayLike<number>): number {
  const n = idx ? idx.length : y.length;
  const at = (i: number) => (idx ? idx[i] : i);
  const order = Array.from({ length: n }, (_, i) => at(i)).sort((a, b) => s[a] - s[b]);
  let pos = 0;
  let rankSum = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && s[order[j + 1]] - s[order[i]] <= 1e-9) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++)
      if (y[order[k]] === 1) {
        pos++;
        rankSum += rank;
      }
    i = j + 1;
  }
  const neg = n - pos;
  return pos === 0 || neg === 0 ? NaN : (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

function binary(y: number[], s: number[], threshold: number) {
  let tp = 0;
  let fn = 0;
  let tn = 0;
  let fp = 0;
  let brier = 0;
  for (let i = 0; i < y.length; i++) {
    brier += (s[i] - y[i]) ** 2;
    const yes = s[i] >= threshold - 1e-9;
    if (y[i] === 1) yes ? tp++ : fn++;
    else yes ? fp++ : tn++;
  }
  const sens = tp + fn ? tp / (tp + fn) : NaN;
  const spec = tn + fp ? tn / (tn + fp) : NaN;
  return {
    n: y.length,
    positives: tp + fn,
    negatives: tn + fp,
    rocAuc: round(rocAuc(y, s)),
    brierScore: round(brier / Math.max(1, y.length)),
    threshold,
    sensitivity: round(sens),
    specificity: round(spec),
    youdenJ: round(sens + spec - 1),
    accuracy: round((tp + tn) / Math.max(1, y.length)),
    falseNegatives: fn,
    falsePositives: fp,
  };
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

/** 95 % interval of AUC(a) - AUC(b), resampling whole units (cases of one unit are not independent). */
function bootstrapAucDifference(y: number[], a: number[], b: number[], unit: number[], units: number, reps = 2000) {
  const byUnit: number[][] = Array.from({ length: units }, () => []);
  unit.forEach((u, i) => byUnit[u].push(i));
  const rand = mulberry32(7);
  const diffs: number[] = [];
  for (let r = 0; r < reps; r++) {
    const idx: number[] = [];
    for (let k = 0; k < units; k++) for (const i of byUnit[Math.floor(rand() * units)]) idx.push(i);
    const d = rocAuc(y, a, idx) - rocAuc(y, b, idx);
    if (Number.isFinite(d)) diffs.push(d);
  }
  diffs.sort((p, q) => p - q);
  const q = (p: number) => diffs[Math.min(diffs.length - 1, Math.max(0, Math.round(p * (diffs.length - 1))))];
  return { difference: round(rocAuc(y, a) - rocAuc(y, b)), ci95: [round(q(0.025)), round(q(0.975))] as [number, number], shareAbove0: round(diffs.filter((d) => d > 0).length / diffs.length, 3), replicates: diffs.length };
}

const mean = (a: number[]): number => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN);

// ------------------------------------------------------------------------------------------------
// Evaluation
// ------------------------------------------------------------------------------------------------

interface Case {
  site: number;
  unitCode: string;
  cropClass: string;
  curated: boolean;
  system: System;
  viable: 0 | 1;
  kind?: NegativeKind;
  /** Best-month score per method, 0..1. */
  scores: Record<string, number>;
}
/** A unit, crop class and water system with its scores, labelled or not. */
interface Scored {
  site: number;
  cropClass: string;
  curated: boolean;
  system: System;
  scores: Record<string, number>;
}

const REGIONS: Record<string, string> = {
  'United States of America': 'North America',
  Canada: 'North America',
  México: 'Latin America',
  Brazil: 'Latin America',
  Argentina: 'Latin America',
  Chile: 'Latin America',
  'Bolivia (Plurinational State of)': 'Latin America',
  India: 'South Asia',
  Bangladesh: 'South Asia',
  Pakistan: 'South Asia',
  Bhutan: 'South Asia',
  China: 'East Asia',
  'South Korea': 'East Asia',
  Ethiopia: 'Africa',
  Nigeria: 'Africa',
  Algeria: 'Africa',
  Angola: 'Africa',
  Benin: 'Africa',
  Türkiye: 'West and Central Asia',
  Azerbaijan: 'West and Central Asia',
  Armenia: 'West and Central Asia',
  Georgia: 'West and Central Asia',
  Jordan: 'West and Central Asia',
  Australia: 'Oceania',
};
const regionOf = (country: string): string => REGIONS[country] ?? 'Europe';

/** Thermal belt of the site from its own 20-year climate (Köppen-Trewartha first letter; dry sites keep their thermal belt). */
function climateGroup(s: ValidationSite): string {
  const m = (a: (number | null)[]) =>
    Array.from({ length: 12 }, (_, k) => {
      const v = a.filter((x, i) => i % 12 === k && x != null) as number[];
      return v.length ? mean(v) : NaN;
    });
  const zones = climateZones(m(s.climate.tMean), m(s.climate.rain), s.site[1]);
  const dry = zones.some((z) => z.startsWith('B'));
  const thermal = zones.find((z) => !z.startsWith('B'))?.[0] ?? zones[0]?.[0] ?? '?';
  const name: Record<string, string> = { A: 'tropical', C: 'subtropical', D: 'temperate', E: 'boreal', F: 'polar' };
  return `${name[thermal] ?? thermal}${dry ? ', dry' : ''}`;
}

const circ = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
};

function evaluate(file: ValidationFile, rainKey: RainSeries, withCalendar: boolean) {
  const cases: Case[] = [];
  const scored: Scored[] = [];
  const calendar: Record<string, { cases: number; ratedSuitable: number; observedMonthSuitable: number; bestWithin1: number; chanceWithin1: number; suitableMonths: number }> = {};
  for (const m of METHODS) calendar[m.id] = { cases: 0, ratedSuitable: 0, observedMonthSuitable: 0, bestWithin1: 0, chanceWithin1: 0, suitableMonths: 0 };
  const rice = { doubleUnits: 0, doubleFound: 0, singleUnits: 0, singleAsOne: 0 };

  file.sites.forEach((s, si) => {
    const telemetry = telemetryFor(s, file.years, rainKey);
    const parcel = parcelFor(s);
    const input = (cropId: string, irrigation: 'rainfed' | 'full'): ModelInput => ({ parcel, telemetry, cropId, groundTruth: { irrigation }, priorities: ['profit'], today: telemetry.window.today });

    for (const [cls, def] of Object.entries(CROP_CLASSES)) {
      for (const system of ['rainfed', 'irrigated'] as const) {
        const label = labelOf(s.crops[cls], system, s.totalHa, s.irrigatedHa);
        const irrigation = system === 'rainfed' ? 'rainfed' : 'full';
        const scores: Record<string, number> = {};
        const bestId: Record<string, string> = {};
        for (const m of METHODS) {
          let best = -1;
          for (const id of def.ids) {
            const a = assessCrop(input(id, irrigation), id, { irrigation, ...m.opts });
            if (a && a.bestCompatibility > best) {
              best = a.bestCompatibility;
              bestId[m.id] = id;
            }
          }
          if (best < 0) throw new Error(`No catalogue crop for ${cls}`);
          scores[m.id] = round(best, 3);
        }
        scored.push({ site: si, cropClass: cls, curated: def.curated, system, scores });
        if (!label) continue;
        cases.push({ site: si, unitCode: s.unitCode, cropClass: cls, curated: def.curated, system, viable: label.viable, ...(label.kind ? { kind: label.kind } : {}), scores });

        // Calendar: annual crops the unit grows, against the months farmers plant them in.
        if (!withCalendar || label.viable !== 1 || def.perennial) continue;
        const stat = s.crops[cls];
        const seasons = (system === 'rainfed' ? stat.rf : stat.ir).filter(([, , ha]) => ha >= SEASON_SHARE * (system === 'rainfed' ? stat.rfHa : stat.irHa));
        const planted = [...new Set(seasons.map(([p]) => p))].filter((p) => p >= 1 && p <= 12);
        if (planted.length === 0) continue;
        const near = new Set<number>();
        for (const p of planted) for (const d of [-1, 0, 1]) near.add(((p - 1 + d + 12) % 12) + 1);
        for (const m of METHODS) {
          const id = bestId[m.id];
          const windows = scanSowingWindows(input(id, irrigation), { irrigation, method: m.opts.method, cropSuite: m.opts.cropSuite });
          const ok = windows.filter((w) => w.score >= 100 * m.threshold - 1e-6).map((w) => w.month);
          const cal = calendar[m.id];
          cal.cases++;
          if (ok.length === 0) continue;
          const top = Math.max(...windows.map((w) => w.score));
          const bestMonths = windows.filter((w) => w.score >= top - 1e-6).map((w) => w.month);
          cal.ratedSuitable++;
          cal.suitableMonths += ok.length;
          cal.observedMonthSuitable += planted.filter((p) => ok.includes(p)).length / planted.length;
          // A plateau of equal best months counts by the share of it that lies near a planting month.
          cal.bestWithin1 += bestMonths.filter((b) => planted.some((p) => circ(b, p) <= 1)).length / bestMonths.length;
          cal.chanceWithin1 += near.size / 12;
        }

        // Multiple cropping: rice with two or more seasons a year, CropSuite only.
        if (cls === 'Rice') {
          const cs = assessCrop(input('oryza-sativa', irrigation), 'oryza-sativa', { irrigation, method: 'cropsuite' })?.cropSuite;
          if (cs && cs.cropSuitability >= 33) {
            if (seasons.length >= 2) {
              rice.doubleUnits++;
              if (cs.harvestsPerYear >= 2) rice.doubleFound++;
            } else {
              rice.singleUnits++;
              if (cs.harvestsPerYear === 1) rice.singleAsOne++;
            }
          }
        }
      }
    }
  });
  return { cases, scored, calendar, rice };
}

function summarise(cases: Case[], sites: number) {
  const pick = (f: (c: Case) => boolean) => cases.filter(f);
  const table = (subset: Case[]) => Object.fromEntries(METHODS.map((m) => [m.id, binary(subset.map((c) => c.viable), subset.map((c) => c.scores[m.id]), m.threshold)]));
  const curated = pick((c) => c.curated);
  const vs = (subset: Case[], b = 'cropsuite') =>
    bootstrapAucDifference(subset.map((c) => c.viable), subset.map((c) => c.scores['astrovivu-v2']), subset.map((c) => c.scores[b]), subset.map((c) => c.site), sites);

  // Per unit: can a method rank the crops a unit grows above those it does not? (the app's own use)
  const perUnit = (subset: Case[]) => {
    const out: Record<string, number[]> = Object.fromEntries(METHODS.map((m) => [m.id, []]));
    for (let u = 0; u < sites; u++) {
      const cs = subset.filter((c) => c.site === u);
      if (cs.filter((c) => c.viable === 1).length < 2 || cs.filter((c) => c.viable === 0).length < 2) continue;
      for (const m of METHODS) out[m.id].push(rocAuc(cs.map((c) => c.viable), cs.map((c) => c.scores[m.id])));
    }
    const wins = out['astrovivu-v2'].reduce((a, v, i) => a + (v > out.cropsuite[i] + 1e-9 ? 1 : 0), 0);
    const losses = out['astrovivu-v2'].reduce((a, v, i) => a + (v < out.cropsuite[i] - 1e-9 ? 1 : 0), 0);
    return { units: out['astrovivu-v2'].length, meanRocAuc: Object.fromEntries(METHODS.map((m) => [m.id, round(mean(out[m.id]))])), v2Better: wins, cropSuiteBetter: losses, equal: out['astrovivu-v2'].length - wins - losses };
  };

  const group = (subset: Case[], key: (c: Case) => string, minEach = 5) => {
    const keys = [...new Set(subset.map(key))].sort();
    return Object.fromEntries(
      keys
        .map((k) => {
          const g = subset.filter((c) => key(c) === k);
          const pos = g.filter((c) => c.viable === 1).length;
          return [k, pos >= minEach && g.length - pos >= minEach ? table(g) : { n: g.length, positives: pos, negatives: g.length - pos, note: `fewer than ${minEach} cases in one class` }] as const;
        })
        .filter(Boolean),
    );
  };
  return { pick, table, curated, vs, perUnit, group };
}

function main() {
  const partial = process.argv.includes('--partial');
  let file: ValidationFile;
  if (partial) {
    const dir = '.cache/validation/sites';
    const sites = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as ValidationSite);
    file = { generatedBy: 'partial', labels: { dataset: '', citation: '', doi: '', licence: '', year: 2015, files: [] }, inputs: {}, sampling: { seed: 0, minUnitHa: 0, maxSpanKm: 0, caps: {}, defaultCap: '', unitsInDataset: 0, eligibleUnits: 0 }, years: [2001, 2020], sites };
  } else {
    file = JSON.parse(readFileSync(SITES_FILE, 'utf8')) as ValidationFile;
  }
  const nSites = file.sites.length;
  const t0 = Date.now();
  const main = evaluate(file, 'rain', true);
  const S = summarise(main.cases, nSites);
  const cur = S.curated;

  const regions = file.sites.map((s) => regionOf(s.country));
  const climates = file.sites.map(climateGroup);
  const count = (a: string[]) => Object.fromEntries([...new Set(a)].sort().map((k) => [k, a.filter((x) => x === k).length]));

  const headline = S.table(cur);
  const selected = headline['astrovivu-v2'].rocAuc >= headline.cropsuite.rocAuc ? 'astrovivu-v2' : 'cropsuite';
  const cal = Object.fromEntries(
    METHODS.map((m) => {
      const c = main.calendar[m.id];
      return [
        m.id,
        {
          cases: c.cases,
          ratedSuitable: c.ratedSuitable,
          observedPlantingMonthRatedSuitable: round(c.observedMonthSuitable / Math.max(1, c.ratedSuitable), 3),
          bestMonthWithin1OfPlanting: round(c.bestWithin1 / Math.max(1, c.ratedSuitable), 3),
          chanceWithin1: round(c.chanceWithin1 / Math.max(1, c.ratedSuitable), 3),
          meanSuitableMonths: round(c.suitableMonths / Math.max(1, c.ratedSuitable), 2),
        },
      ];
    }),
  );

  // Do the conclusions depend on the choices made here? Presence threshold, unit size, kind of site.
  const relabelled = (share: number) => {
    const y: number[] = [];
    const sc: Record<string, number[]> = Object.fromEntries(METHODS.map((m) => [m.id, []]));
    for (const c of main.scored) {
      if (!c.curated) continue;
      const st = file.sites[c.site];
      const l = labelOf(st.crops[c.cropClass], c.system, st.totalHa, st.irrigatedHa, share);
      if (!l) continue;
      y.push(l.viable);
      for (const m of METHODS) sc[m.id].push(c.scores[m.id]);
    }
    return Object.fromEntries(METHODS.map((m) => [m.id, binary(y, sc[m.id], m.threshold)]));
  };
  const robustness = {
    presenceThreshold: { '0.5 %': relabelled(0.005), '1 % (main)': relabelled(PRESENT_SHARE), '5 %': relabelled(0.05), '10 %': relabelled(0.1) },
    unitWidth: S.group(cur, (c) => (Math.max(...file.sites[c.site].spanKm) <= 100 ? 'up to 100 km' : '100 to 200 km')),
    siteKind: S.group(cur, (c) => file.sites[c.site].siteKind),
  };

  // Same cases with the second rainfall series: does the result depend on where the rain comes from?
  const alt = evaluate(file, 'rainPower', false);
  const altCur = alt.cases.filter((c) => c.curated);
  const altTable = Object.fromEntries(METHODS.map((m) => [m.id, binary(altCur.map((c) => c.viable), altCur.map((c) => c.scores[m.id]), m.threshold)]));

  const out = {
    generatedBy: 'scripts/crops/evaluate-mirca-validation.ts',
    validationSet: { file: SITES_FILE, labels: file.labels, inputs: file.inputs, sampling: file.sampling, years: file.years },
    design: {
      present: `harvested area in the water system >= ${100 * PRESENT_SHARE} % of the unit's harvested area and >= ${PRESENT_MIN_HA} ha`,
      rainfedNegative: 'no rainfed area of the crop in the unit: "absent" (not grown at all) or "irrigated-only" (grown, but only with irrigation)',
      irrigatedNegative: `crop not grown at all in a unit that irrigates >= ${100 * IRRIGATING_SHARE} % of its harvested area and >= ${IRRIGATING_MIN_HA} ha`,
      excluded: 'trace areas between zero and the presence threshold; irrigated questions in units without irrigation',
      score: 'best sowing month, rainfed or full irrigation; slope is not scored (no single slope for a unit)',
      nativeThresholds: Object.fromEntries(METHODS.map((m) => [m.id, m.threshold])),
      cropClasses: CROP_CLASSES,
      selectionRule: 'higher ROC-AUC on the curated crop classes, both water systems pooled',
    },
    sites: { n: nSites, byRegion: count(regions), byClimate: count(climates), siteKind: count(file.sites.map((s) => s.siteKind)), rainSource: count(file.sites.map((s) => s.climate.rainSource)), withoutSoil: file.sites.filter((s) => !s.soil).length },
    selectedMethod: selected,
    suitability: {
      curated: {
        pooled: headline,
        v2MinusCropSuite: S.vs(cur),
        v2MinusCropSuiteNoVariability: S.vs(cur, 'cropsuite-no-variability'),
        rainfed: S.table(cur.filter((c) => c.system === 'rainfed')),
        irrigated: S.table(cur.filter((c) => c.system === 'irrigated')),
        rainfedByNegativeKind: {
          absent: S.table(cur.filter((c) => c.system === 'rainfed' && (c.viable === 1 || c.kind === 'absent'))),
          irrigatedOnly: S.table(cur.filter((c) => c.system === 'rainfed' && (c.viable === 1 || c.kind === 'irrigated-only'))),
        },
        perUnitRanking: { rainfed: S.perUnit(cur.filter((c) => c.system === 'rainfed')), irrigated: S.perUnit(cur.filter((c) => c.system === 'irrigated')) },
        byCropClass: S.group(cur, (c) => c.cropClass),
        byRegion: S.group(cur, (c) => regions[c.site]),
        byClimate: S.group(cur, (c) => climates[c.site]),
      },
      rawCatalogue: { pooled: S.table(S.pick((c) => !c.curated)), byCropClass: S.group(S.pick((c) => !c.curated), (c) => c.cropClass) },
      allClasses: { pooled: S.table(main.cases), v2MinusCropSuite: S.vs(main.cases) },
      rainFromNasaPower: { pooled: altTable, note: 'curated classes, rainfall from NASA POWER (MERRA-2) instead of GPCC' },
      robustness,
    },
    calendar: { note: `annual curated and raw crops a unit grows; seasons with >= ${100 * SEASON_SHARE} % of the crop's area; rates are over the cases the method itself rates suitable`, ...cal },
    multipleCropping: {
      note: 'rice, CropSuite only, units where CropSuite rates rice at least moderately suitable',
      unitsWithTwoOrMoreRiceSeasons: main.rice.doubleUnits,
      ofWhichCropSuiteFindsTwoOrMoreHarvests: main.rice.doubleFound,
      unitsWithOneRiceSeason: main.rice.singleUnits,
      ofWhichCropSuiteFindsExactlyOne: main.rice.singleAsOne,
    },
    runtimeSeconds: round((Date.now() - t0) / 1000, 1),
    cases: main.cases.map((c) => [c.unitCode, c.cropClass, c.system, c.viable, c.kind ?? '', c.scores['astrovivu-v2'], c.scores.cropsuite, c.scores['cropsuite-no-variability']]),
    caseColumns: ['unitCode', 'cropClass', 'system', 'viable', 'negativeKind', 'astrovivu-v2', 'cropsuite', 'cropsuite-no-variability'],
  };

  const line = (name: string, t: Record<string, ReturnType<typeof binary>>) =>
    console.log(`${name.padEnd(34)} n=${String(t['astrovivu-v2'].n).padStart(5)} (+${t['astrovivu-v2'].positives}/-${t['astrovivu-v2'].negatives})  ` + METHODS.map((m) => `${m.id}: AUC ${t[m.id].rocAuc.toFixed(3)} sens ${t[m.id].sensitivity.toFixed(2)} spec ${t[m.id].specificity.toFixed(2)}`).join(' | '));
  console.log(`${nSites} sites, ${main.cases.length} labelled cases (${cur.length} on curated crops)`);
  line('curated, pooled', out.suitability.curated.pooled);
  line('curated, rainfed', out.suitability.curated.rainfed);
  line('curated, irrigated', out.suitability.curated.irrigated);
  line('raw catalogue, pooled', out.suitability.rawCatalogue.pooled);
  line('curated, rain from NASA POWER', altTable);
  for (const [k, t] of Object.entries(robustness.presenceThreshold)) line(`curated, present from ${k}`, t);
  console.log('v2 - CropSuite AUC:', JSON.stringify(out.suitability.curated.v2MinusCropSuite));
  console.log('per unit:', JSON.stringify(out.suitability.curated.perUnitRanking));
  console.log('calendar:', JSON.stringify(cal));
  console.log('rice:', JSON.stringify(out.multipleCropping));
  if (partial) {
    console.log('Partial run: nothing written.');
    return;
  }
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
  console.log(`Wrote ${OUT_FILE} (selected: ${selected})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Five crop classes are scored from the full EcoCrop catalogue, which the app loads on demand.
  await loadFullCatalog(async () => JSON.parse(readFileSync('public/data/crops/ecocrop.json', 'utf8')));
  for (const def of Object.values(CROP_CLASSES)) for (const id of def.ids) if (!getCrop(id)) throw new Error(`Unknown crop id ${id}`);
  main();
}
