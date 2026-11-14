/**
 * Builds an independent validation set for the suitability scorers from MIRCA-OS (Kebede et al.
 * 2025, Sci. Data 12, 208, doi:10.1038/s41597-024-04313-w; data doi:10.4211/hs.60a890eb841c460192c03bb590687145,
 * CC BY 4.0): harvested area in 2015 per administrative unit and crop, rainfed and irrigated
 * separately, with planting and maturity months. The labels are agricultural statistics, not the
 * output of a suitability model.
 *
 * For a seeded sample of subnational units the script finds one cropland site and reads what the
 * scorers need there:
 *   unit outline     Nominatim (OpenStreetMap); units wider than 200 km are skipped
 *   site             MODIS MCD12Q1 2015 cropland pixel nearest the unit centre (ORNL DAAC)
 *   elevation        Open-Meteo elevation (Copernicus GLO-90)
 *   temperature      NASA POWER daily T2M / T2M_MAX / T2M_MIN 2001-2020, lapse-adjusted to the site
 *   rainfall         GPCC Full Data Monthly v2025, 0.5° (NOAA PSL); NASA POWER PRECTOTCORR is kept
 *                    as a second rainfall series for a sensitivity run
 *   soil             SoilGrids 2.0, 0-30 cm
 *
 * Run: `npx tsx scripts/crops/build-mirca-validation.ts` -> `data/crops/validation/mirca-os-2015-sites.json`
 *   --limit=N     only the first N sampled units (smoke run; the output is not written)
 * Every response is cached under `.cache/`, so an interrupted run resumes where it stopped.
 * Evaluation: `scripts/crops/evaluate-mirca-validation.ts`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Papa from 'papaparse';
import { elevation } from '@/data/adapters/openmeteo';
import { powerDaily } from '@/data/adapters/power';
import { soilGrids } from '@/data/adapters/soilgrids';
import { cached, TTL } from '@/data/cache';
import { errText } from '@/data/build';
import { lapseAdjust } from '@/data/harmonize/units';
import { fromSinusoidal, toSinusoidal } from '@/data/harmonize/zonal';
import { getBytes, getJson, getText, mapLimit, sleep } from '@/data/http';

// ------------------------------------------------------------------------------------------------
// Configuration (changing any of it changes the sample: keep it with the results)
// ------------------------------------------------------------------------------------------------

export const MIRCA = {
  base: 'https://www.hydroshare.org/resource/60a890eb841c460192c03bb590687145/data/contents/Crop%20Calendar',
  files: { rf: 'MIRCA-OS_2015_rf.csv', ir: 'MIRCA-OS_2015_ir.csv' },
  year: 2015,
} as const;
const SEED = 20261115;
/** A unit must harvest at least this much (all crops, rainfed + irrigated) to be sampled. */
const MIN_UNIT_HA = 10_000;
/** A unit wider than this in either direction is too large for one site to stand for it. */
const MAX_SPAN_KM = 200;
const FIRST_YEAR = 2001;
const LAST_YEAR = 2020;
/** Sampled units per country. Countries not listed: ceil(units / 8), between 1 and 4. */
const CAPS: Record<string, number> = {
  'United States of America': 28,
  India: 28,
  Ethiopia: 10,
  Nigeria: 10,
  Russia: 8,
  México: 8,
  Bangladesh: 6,
  China: 6,
  Brazil: 6,
  Türkiye: 6,
  Algeria: 5,
  Argentina: 5,
  Angola: 5,
};
/** MIRCA-OS country names the geocoder does not know under that spelling. */
const COUNTRY_ALIAS: Record<string, string> = {
  'United States of America': 'United States',
  México: 'Mexico',
  Crotia: 'Croatia',
  'Netherlands (Kingdom of the)': 'Netherlands',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'Bolivia (Plurinational State of)': 'Bolivia',
};

const CACHE_DIR = path.join(process.cwd(), '.cache', 'validation');
const OUT_FILE = path.join(process.cwd(), 'data', 'crops', 'validation', 'mirca-os-2015-sites.json');

// ------------------------------------------------------------------------------------------------
// MIRCA-OS tables
// ------------------------------------------------------------------------------------------------

/** One cropping season of a crop class in a unit. */
export type Season = [plantingMonth: number, maturityMonth: number, ha: number];
export interface ClassStat {
  rfHa: number;
  irHa: number;
  rf: Season[];
  ir: Season[];
}
interface Unit {
  code: string;
  country: string;
  province: string;
  district: string;
  level: 'country' | 'province' | 'district';
  totalHa: number;
  irrigatedHa: number;
  classes: Record<string, ClassStat>;
}

/** "Rice2" -> "Rice", "Others annual3" -> "Others annual", "Others perennial  " -> "Others perennial". */
export const cropClass = (name: string): string => name.trim().replace(/\s*\d+$/, '');

async function mircaTable(system: 'rf' | 'ir'): Promise<Record<string, string>[]> {
  const file = path.join(CACHE_DIR, 'mirca-os', MIRCA.files[system]);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(file);
  } catch {
    console.log(`Downloading ${MIRCA.files[system]} ...`);
    bytes = await getBytes(`${MIRCA.base}/${MIRCA.files[system]}`, { timeoutMs: 300_000, retries: 2 });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  // The files are Windows-1252 (accented unit names), not UTF-8.
  const text = new TextDecoder('windows-1252').decode(bytes);
  return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data;
}

async function loadUnits(): Promise<Unit[]> {
  const units = new Map<string, Unit>();
  for (const system of ['rf', 'ir'] as const) {
    for (const r of await mircaTable(system)) {
      const code = r.unit_code?.trim();
      if (!code) continue;
      let u = units.get(code);
      if (!u) {
        const province = (r.Province ?? '').trim();
        const district = (r.Distrct ?? r.District ?? '').trim();
        u = { code, country: r.Country.trim(), province, district, level: district ? 'district' : province ? 'province' : 'country', totalHa: 0, irrigatedHa: 0, classes: {} };
        units.set(code, u);
      }
      const ha = Number(r.Growing_area) || 0;
      const cls = (u.classes[cropClass(r.Crop)] ??= { rfHa: 0, irHa: 0, rf: [], ir: [] });
      u.totalHa += ha;
      if (system === 'ir') u.irrigatedHa += ha;
      if (system === 'rf') cls.rfHa += ha;
      else cls.irHa += ha;
      if (ha > 0) cls[system].push([Number(r.Planting_Month), Number(r.Maturity_Month), Math.round(ha)]);
    }
  }
  // A country given as one unit is a national total, whatever its Province column says.
  const perCountry = new Map<string, number>();
  for (const u of units.values()) perCountry.set(u.country, (perCountry.get(u.country) ?? 0) + 1);
  for (const u of units.values()) if (perCountry.get(u.country) === 1 || (!u.district && u.province.toLowerCase() === u.country.toLowerCase())) u.level = 'country';
  return [...units.values()];
}

// ------------------------------------------------------------------------------------------------
// Sampling
// ------------------------------------------------------------------------------------------------

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

/** Per country: its eligible subnational units in a seeded random order, and how many to keep. */
function candidates(units: Unit[]): { country: string; cap: number; order: Unit[] }[] {
  const byCountry = new Map<string, Unit[]>();
  for (const u of units) {
    if (u.level === 'country' || u.totalHa < MIN_UNIT_HA) continue;
    (byCountry.get(u.country) ?? byCountry.set(u.country, []).get(u.country)!).push(u);
  }
  const rand = mulberry32(SEED);
  return [...byCountry.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([country, list]) => {
      const order = [...list].sort((a, b) => (a.code < b.code ? -1 : 1));
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const all = units.filter((u) => u.country === country && u.level !== 'country').length;
      return { country, cap: CAPS[country] ?? Math.max(1, Math.min(4, Math.ceil(all / 8))), order };
    });
}

// ------------------------------------------------------------------------------------------------
// Unit outline (geocoder)
// ------------------------------------------------------------------------------------------------

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  category?: string;
  type?: string;
  place_rank?: number;
  boundingbox?: [string, string, string, string];
}
interface Outline {
  name: string;
  centre: [number, number];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  spanKm: [number, number];
}

async function outline(u: Unit): Promise<Outline | null> {
  const q = [u.district, u.province, COUNTRY_ALIAS[u.country] ?? u.country].filter(Boolean).join(', ');
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=8&accept-language=en`;
  const hits = await cached(`valgeo:${q.toLowerCase()}`, TTL.year, async () => {
    const r = await getJson<NominatimHit[]>(url, { timeoutMs: 20_000, retries: 2, headers: { 'User-Agent': 'astrovivu-field-shift/0.1' } });
    await sleep(1100); // Nominatim usage policy: at most one request per second
    return r;
  });
  const admin = hits.filter((h) => h.category === 'boundary' && h.type === 'administrative' && h.boundingbox && h.place_rank != null);
  // OSM place ranks: 8 state/province, 10 district, 12 county. Of the fitting level, the largest unit.
  const [lo, hi] = u.level === 'district' ? [9, 13] : [5, 9];
  const fits = admin.filter((h) => h.place_rank! >= lo && h.place_rank! <= hi).sort((a, b) => a.place_rank! - b.place_rank!);
  const hit = fits[0] ?? (u.level === 'province' ? admin.filter((h) => h.place_rank! <= 12).sort((a, b) => a.place_rank! - b.place_rank!)[0] : undefined);
  if (!hit) return null;
  const [s, n, w, e] = hit.boundingbox!.map(Number);
  if (e < w) return null; // crosses the antimeridian
  const midLat = (s + n) / 2;
  const spanKm: [number, number] = [(e - w) * 111.32 * Math.cos((midLat * Math.PI) / 180), (n - s) * 110.57];
  return { name: hit.display_name, centre: [Number(hit.lon), Number(hit.lat)], bbox: [w, s, e, n], spanKm };
}

// ------------------------------------------------------------------------------------------------
// Site: the cropland pixel nearest the unit centre (MODIS land cover, IGBP classes 12 and 14)
// ------------------------------------------------------------------------------------------------

interface LcSubset {
  xllcorner: string;
  yllcorner: string;
  cellsize: number;
  nrows: number;
  ncols: number;
  subset: { data: number[] }[];
}
type SiteKind = 'cropland' | 'cropland-mosaic' | 'centre';

async function croplandSite(code: string, o: Outline): Promise<{ at: [number, number]; kind: SiteKind; croplandShare: number | null }> {
  const [lon, lat] = o.centre;
  const halfKm = Math.max(8, Math.min(40, Math.round(Math.min(...o.spanKm) / 2)));
  const url =
    `https://modis.ornl.gov/rst/api/v1/MCD12Q1/subset?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}` +
    `&startDate=A${MIRCA.year}001&endDate=A${MIRCA.year}001&kmAboveBelow=${halfKm}&kmLeftRight=${halfKm}&band=LC_Type1`;
  let j: LcSubset;
  try {
    j = await cached(`vallc:${code}:${halfKm}`, TTL.year, () => getJson<LcSubset>(url, { timeoutMs: 150_000, retries: 3 }));
  } catch {
    return { at: o.centre, kind: 'centre', croplandShare: null };
  }
  const data = j.subset?.[0]?.data;
  if (!Array.isArray(data) || data.length !== j.nrows * j.ncols) return { at: o.centre, kind: 'centre', croplandShare: null };
  const xll = Number(j.xllcorner);
  const yll = Number(j.yllcorner);
  const [cx, cy] = toSinusoidal(o.centre);
  const [w, s, e, n] = o.bbox;
  const at = (r: number, c: number) => (r < 0 || c < 0 || r >= j.nrows || c >= j.ncols ? -1 : data[r * j.ncols + c]);
  let crop = 0;
  const pick = (classes: number[]): [number, number] | null => {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let r = 0; r < j.nrows; r++)
      for (let c = 0; c < j.ncols; c++) {
        if (!classes.includes(data[r * j.ncols + c])) continue;
        // A lone pixel is as likely a classification error as a field: ask for cropland around it.
        let same = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (classes.includes(at(r + dr, c + dc))) same++;
        if (same < 5) continue;
        const x = xll + (c + 0.5) * j.cellsize;
        const y = yll + (j.nrows - r - 0.5) * j.cellsize;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d >= bestD) continue;
        const p = fromSinusoidal(x, y);
        if (p[0] < w || p[0] > e || p[1] < s || p[1] > n) continue;
        bestD = d;
        best = [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
      }
    return best;
  };
  for (const v of data) if (v === 12) crop++;
  const share = Math.round((1000 * crop) / data.length) / 1000;
  const a = pick([12]);
  if (a) return { at: a, kind: 'cropland', croplandShare: share };
  const b = pick([12, 14]);
  if (b) return { at: b, kind: 'cropland-mosaic', croplandShare: share };
  return { at: o.centre, kind: 'centre', croplandShare: share };
}

// ------------------------------------------------------------------------------------------------
// Climate and soil at the site
// ------------------------------------------------------------------------------------------------

/** Starts calls to one service at least `gapMs` apart (SoilGrids asks for at most 5 calls a minute). */
function spaced(gapMs: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let slot: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>) => {
    const start = slot;
    slot = slot.then(() => sleep(gapMs));
    return start.then(fn);
  };
}
const soilQueue = spaced(12_500);

const r1 = (v: number | null): number | null => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null): number | null => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

async function gpccMonthly(at: [number, number]): Promise<(number | null)[]> {
  const [lon, lat] = at;
  const url =
    'https://psl.noaa.gov/thredds/ncss/grid/Datasets/gpcc/full_v2025/precip.mon.total.0.50x0.50.v2025.nc' +
    `?var=precip&latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&time_start=${FIRST_YEAR}-01-01T00:00:00Z&time_end=${LAST_YEAR}-12-31T00:00:00Z&accept=csv`;
  // The grid is 0.5°: every site in the same cell shares one answer.
  const key = `valgpcc:${(Math.floor(lon * 2) / 2).toFixed(1)},${(Math.floor(lat * 2) / 2).toFixed(1)}:${FIRST_YEAR}-${LAST_YEAR}`;
  const text = await cached(key, TTL.year, async () => {
    const t = await getText(url, { timeoutMs: 240_000, retries: 3 });
    if (!t.startsWith('time,')) throw new Error(`Unexpected GPCC answer: ${t.slice(0, 80)}`);
    return t;
  });
  const byMonth = new Map<string, number>();
  for (const line of text.split('\n').slice(1)) {
    const f = line.split(',');
    const v = Number(f[f.length - 1]);
    if (f[0]?.length >= 7 && Number.isFinite(v) && v >= 0 && v < 5000) byMonth.set(f[0].slice(0, 7), v);
  }
  const out: (number | null)[] = [];
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) for (let m = 1; m <= 12; m++) out.push(r1(byMonth.get(`${y}-${String(m).padStart(2, '0')}`) ?? null));
  return out;
}

interface SiteClimate {
  /** Month sequences from January of the first year; null where the source has no value. */
  rain: (number | null)[];
  rainPower: (number | null)[];
  tMean: (number | null)[];
  tMin: (number | null)[];
  tMax: (number | null)[];
  rainSource: 'gpcc' | 'power';
}

async function siteClimate(at: [number, number], elevM: number | null): Promise<{ climate: SiteClimate; powerCellElevationM: number | null }> {
  const [power, gpcc] = await Promise.all([
    powerDaily(at, `${FIRST_YEAR}-01-01`, `${LAST_YEAR}-12-31`, ['T2M', 'T2M_MAX', 'T2M_MIN', 'PRECTOTCORR']),
    gpccMonthly(at).catch((e: unknown) => {
      console.warn(`  GPCC failed at ${at.join(',')}: ${errText(e)}`);
      return null;
    }),
  ]);
  const n = (LAST_YEAR - FIRST_YEAR + 1) * 12;
  const sum = (key: string) => {
    const s = new Float64Array(n);
    const c = new Int32Array(n);
    for (const d of power.series[key] ?? []) {
      if (d.v == null) continue;
      const i = (Number(d.t.slice(0, 4)) - FIRST_YEAR) * 12 + Number(d.t.slice(5, 7)) - 1;
      if (i < 0 || i >= n) continue;
      s[i] += d.v;
      c[i]++;
    }
    return { s, c };
  };
  // A month counts when at least 25 of its days are present.
  const mean = (key: string) => {
    const { s, c } = sum(key);
    return Array.from(s, (v, i) => (c[i] >= 25 ? r2(lapseAdjust(v / c[i], power.cellElevationM, elevM)) : null));
  };
  const rainP = sum('PRECTOTCORR');
  const rainPower = Array.from(rainP.s, (v, i) => (rainP.c[i] >= 25 ? r1(v) : null));
  const gpccOk = gpcc != null && gpcc.filter((v) => v != null).length >= n * 0.9;
  return {
    climate: { rain: gpccOk ? gpcc : rainPower, rainPower, tMean: mean('T2M'), tMin: mean('T2M_MIN'), tMax: mean('T2M_MAX'), rainSource: gpccOk ? 'gpcc' : 'power' },
    powerCellElevationM: r1(power.cellElevationM),
  };
}

interface SiteSoil {
  ph: number | null;
  socGkg: number | null;
  clayPct: number | null;
  sandPct: number | null;
  cecCmolKg: number | null;
}

async function siteSoil(at: [number, number]): Promise<SiteSoil | null> {
  // SoilGrids masks built-up and water pixels: step to a neighbour 2 km away before giving up.
  const tries: [number, number][] = [at, [at[0] + 0.02, at[1]], [at[0], at[1] + 0.02], [at[0] - 0.02, at[1]], [at[0], at[1] - 0.02]];
  for (const p of tries) {
    const v = await soilQueue(() => soilGrids(p)).catch((e: unknown) => {
      console.warn(`  SoilGrids failed at ${p.join(',')}: ${errText(e)}`);
      return null;
    });
    if (v?.phh2o.mean != null) return { ph: r1(v.phh2o.mean), socGkg: r1(v.soc.mean), clayPct: r1(v.clay.mean), sandPct: r1(v.sand.mean), cecCmolKg: r1(v.cec.mean) };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// Assembly
// ------------------------------------------------------------------------------------------------

export interface ValidationSite {
  unitCode: string;
  country: string;
  province: string;
  district: string;
  level: 'province' | 'district';
  /** Name of the outline the geocoder matched, for audit. */
  matched: string;
  spanKm: [number, number];
  site: [lon: number, lat: number];
  siteKind: SiteKind;
  /** Share of MODIS cropland in the window searched around the unit centre. */
  croplandShare: number | null;
  elevationM: number | null;
  powerCellElevationM: number | null;
  /** Harvested area of the unit in 2015, all crops (ha), and the irrigated part of it. */
  totalHa: number;
  irrigatedHa: number;
  climate: SiteClimate;
  soil: SiteSoil | null;
  crops: Record<string, ClassStat>;
}
export interface ValidationFile {
  generatedBy: string;
  labels: { dataset: string; citation: string; doi: string; licence: string; year: number; files: string[] };
  inputs: Record<string, string>;
  sampling: { seed: number; minUnitHa: number; maxSpanKm: number; caps: Record<string, number>; defaultCap: string; unitsInDataset: number; eligibleUnits: number };
  years: [number, number];
  sites: ValidationSite[];
}

async function buildSite(u: Unit, o: Outline): Promise<ValidationSite> {
  const file = path.join(CACHE_DIR, 'sites', `${u.code}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as ValidationSite;
  } catch {
    // not built yet
  }
  const where = await croplandSite(u.code, o);
  const elevM = await elevation(where.at).catch(() => null);
  const [{ climate, powerCellElevationM }, soil] = await Promise.all([siteClimate(where.at, elevM), siteSoil(where.at)]);
  const site: ValidationSite = {
    unitCode: u.code,
    country: u.country,
    province: u.province,
    district: u.district,
    level: u.level as 'province' | 'district',
    matched: o.name,
    spanKm: [Math.round(o.spanKm[0]), Math.round(o.spanKm[1])],
    site: where.at,
    siteKind: where.kind,
    croplandShare: where.croplandShare,
    elevationM: r1(elevM),
    powerCellElevationM,
    totalHa: Math.round(u.totalHa),
    irrigatedHa: Math.round(u.irrigatedHa),
    climate,
    soil,
    crops: Object.fromEntries(Object.entries(u.classes).map(([k, c]) => [k, { rfHa: Math.round(c.rfHa), irHa: Math.round(c.irHa), rf: c.rf, ir: c.ir }])),
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(site));
  return site;
}

async function main() {
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8)) || Infinity;
  const units = await loadUnits();
  const plan = candidates(units);
  const eligible = plan.reduce((a, p) => a + p.order.length, 0);
  console.log(`MIRCA-OS ${MIRCA.year}: ${units.length} units, ${eligible} eligible subnational units in ${plan.length} countries`);

  // 1. Outlines, one request a second: walk each country's random order until its cap is met.
  const chosen: { u: Unit; o: Outline }[] = [];
  const skipped = { notFound: 0, tooWide: 0 };
  for (const p of plan) {
    let kept = 0;
    for (const u of p.order) {
      if (kept >= p.cap || chosen.length >= limit) break;
      const o = await outline(u).catch((e: unknown) => {
        console.warn(`  geocoder failed for ${u.code}: ${errText(e)}`);
        return null;
      });
      if (!o) {
        skipped.notFound++;
        continue;
      }
      if (Math.max(...o.spanKm) > MAX_SPAN_KM) {
        skipped.tooWide++;
        continue;
      }
      chosen.push({ u, o });
      kept++;
    }
    if (kept > 0) console.log(`  ${p.country}: ${kept} of ${p.order.length} eligible (cap ${p.cap})`);
  }
  console.log(`Sampled ${chosen.length} units (${skipped.notFound} not found by the geocoder, ${skipped.tooWide} wider than ${MAX_SPAN_KM} km)`);

  // 2. Site, climate and soil. The slow services set the pace; their own limits are in http.ts.
  let done = 0;
  const failures: string[] = [];
  const built = await mapLimit(chosen, 6, async ({ u, o }) => {
    try {
      const s = await buildSite(u, o);
      console.log(`  [${++done}/${chosen.length}] ${u.code} ${[u.district, u.province, u.country].filter(Boolean).join(', ')}: ${s.siteKind}, ${s.climate.rainSource} rain, soil ${s.soil ? 'ok' : 'missing'}`);
      return s;
    } catch (e) {
      failures.push(`${u.code}: ${errText(e)}`);
      console.warn(`  [${++done}/${chosen.length}] ${u.code} FAILED: ${errText(e)}`);
      return null;
    }
  });
  const sites = built.filter((s): s is ValidationSite => s != null).sort((a, b) => (a.unitCode < b.unitCode ? -1 : 1));
  console.log(`Built ${sites.length} sites, ${failures.length} failed`);
  for (const f of failures) console.log(`  ${f}`);
  if (Number.isFinite(limit)) {
    console.log('Smoke run (--limit): output file not written.');
    return;
  }

  const out: ValidationFile = {
    generatedBy: 'scripts/crops/build-mirca-validation.ts',
    labels: {
      dataset: 'MIRCA-OS crop calendars (harvested area per unit, crop and water system)',
      citation: 'Kebede, E. A. et al. (2025). A global open-source dataset of monthly irrigated and rainfed cropped areas (MIRCA-OS) for the 21st century. Scientific Data 12, 208.',
      doi: '10.4211/hs.60a890eb841c460192c03bb590687145',
      licence: 'CC BY 4.0',
      year: MIRCA.year,
      files: Object.values(MIRCA.files),
    },
    inputs: {
      outline: 'OpenStreetMap Nominatim (ODbL)',
      site: `MODIS MCD12Q1 v061 LC_Type1 ${MIRCA.year}, cropland pixel nearest the unit centre (ORNL DAAC subset API)`,
      elevation: 'Open-Meteo elevation API (Copernicus DEM GLO-90)',
      temperature: `NASA POWER daily T2M, T2M_MAX, T2M_MIN (MERRA-2), ${FIRST_YEAR}-${LAST_YEAR}, monthly means, lapse-adjusted from the cell to the site elevation`,
      rain: `GPCC Full Data Monthly v2025, 0.5° (NOAA PSL THREDDS), ${FIRST_YEAR}-${LAST_YEAR}; NASA POWER PRECTOTCORR where GPCC has no value`,
      rainPower: 'NASA POWER PRECTOTCORR (MERRA-2, bias-corrected), monthly totals: second rainfall series for the sensitivity run',
      soil: 'ISRIC SoilGrids 2.0, 0-30 cm depth-weighted means (pH, organic carbon, clay, sand, CEC)',
    },
    sampling: { seed: SEED, minUnitHa: MIN_UNIT_HA, maxSpanKm: MAX_SPAN_KM, caps: CAPS, defaultCap: 'ceil(units / 8), between 1 and 4', unitsInDataset: units.length, eligibleUnits: eligible },
    years: [FIRST_YEAR, LAST_YEAR],
    sites,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out));
  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}`);
}

// Only when run as a script: the evaluation imports the types above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
