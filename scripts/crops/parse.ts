/**
 * FAO EcoCrop CSV -> cleaned rows. Every repair is recorded so the build can publish a cleaning
 * log: the catalogue never silently changes a published threshold.
 *
 * Defects handled (docs/DATA_SOURCES.md §5, docs/SCORING.md §2):
 *   - temperatures on the wrong scale (160, 2000) are rescaled when that restores the order;
 *   - quads whose absolute and optimal columns were swapped are swapped back;
 *   - quads that cannot be repaired by a swap are widened or, failing that, dropped;
 *   - latitudes above 90 are altitudes typed into the wrong field: dropped;
 *   - `cult_cycle = 0` means missing; thousands separators ("1,500") are not day counts;
 *   - rows that only repeat another row of the same species (same thresholds) are merged.
 */
import fs from 'node:fs';
import Papa from 'papaparse';
import type {
  AlToxicityClass,
  CropCategory,
  CropProfile,
  CropRequirements,
  DepthClass,
  DrainageClass,
  FertilityClass,
  Quad,
  SalinityClass,
  TextureClass,
} from '../../src/contracts';
import { slugify } from '../../src/core/crops/text';

export type Raw = Record<string, string>;

export interface CleaningEvent {
  ecocropId: number;
  name: string;
  field: string;
  action: string;
  before: string;
  after: string;
}

export interface CleanResult {
  /** Scorable species (temperature and rainfall windows present), keyed by EcoCrop id. */
  profiles: Map<number, CropProfile>;
  /** Common names kept for search (first few, deduplicated). */
  commonNames: Map<number, string[]>;
  families: Map<number, string>;
  events: CleaningEvent[];
  stats: Record<string, number>;
}

const MISSING = new Set(['', '-', '--', '---', 'no input', 'na', 'n/a']);

function num(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (MISSING.has(s.toLowerCase())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function readEcoCropCsv(file: string): Raw[] {
  const csv = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const parsed = Papa.parse<Raw>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`EcoCrop CSV: ${parsed.errors.length} parse errors, first: ${parsed.errors[0].message}`);
  return parsed.data;
}

// ------------------------------------------------------------------------------------------------
// Quads
// ------------------------------------------------------------------------------------------------

type Q4 = [number | null, number | null, number | null, number | null];
const ordered = (q: number[]) => q[0] <= q[1] && q[1] <= q[2] && q[2] <= q[3];

interface QuadSpec {
  field: string;
  /** Plausible physical range; values outside are scale defects. */
  lo: number;
  hi: number;
  /** Median distance between the optimal and the absolute bound, used only when one pair is missing. */
  marginLo: number;
  marginHi: number;
  digits: number;
}

/**
 * Returns the repaired quad in contract order [absMin, optMin, optMax, absMax] or null when the
 * factor has to be treated as missing. `note` receives one line per repair.
 */
export function repairQuad(raw: Q4, spec: QuadSpec, note: (action: string, after: string) => void): Quad | null {
  let [absMin, optMin, optMax, absMax] = raw;
  const round = (v: number) => Math.round(v * 10 ** spec.digits) / 10 ** spec.digits;
  const show = (q: (number | null)[]) => q.map((v) => (v == null ? '-' : String(v))).join('/');
  if (absMin == null && optMin == null && optMax == null && absMax == null) return null;

  // 1. Scale: a value far outside the physical range was typed without its decimal point.
  const rescale = (v: number | null): number | null => {
    if (v == null || (v >= spec.lo && v <= spec.hi)) return v;
    for (const d of [10, 100]) if (v / d >= spec.lo && v / d <= spec.hi) return v / d;
    return null;
  };
  const scaled: Q4 = [rescale(absMin), rescale(optMin), rescale(optMax), rescale(absMax)];
  if (show(scaled) !== show([absMin, optMin, optMax, absMax])) {
    [absMin, optMin, optMax, absMax] = scaled;
    note('rescaled (value outside the physical range)', show(scaled));
  }

  // 2. One pair missing: impute it from the catalogue-wide median margin, flagged.
  if (optMin != null && optMax != null && (absMin == null || absMax == null)) {
    absMin ??= round(Math.max(spec.lo, optMin - spec.marginLo));
    absMax ??= round(Math.min(spec.hi, optMax + spec.marginHi));
    note('absolute limits missing: imputed from the median margin of the catalogue', show([absMin, optMin, optMax, absMax]));
  } else if (absMin != null && absMax != null && (optMin == null || optMax == null)) {
    const span = absMax - absMin;
    optMin ??= round(absMin + span * 0.25);
    optMax ??= round(absMax - span * 0.25);
    note('optimal limits missing: set to the inner half of the absolute range', show([absMin, optMin, optMax, absMax]));
  }
  if (absMin == null || optMin == null || optMax == null || absMax == null) {
    note('incomplete window: dropped', '-');
    return null;
  }
  let q = [absMin, optMin, optMax, absMax];
  if (ordered(q)) return q as Quad;

  // 3. A single value ten times too large (typed with an extra zero): it dwarfs the limit that
  //    should be above it, and dividing it by 10 restores the order.
  for (let i = 0; i < 3; i++) {
    if (q[i] < 3 * q[i + 1]) continue;
    const t = [...q];
    t[i] = q[i] / 10;
    if (ordered(t)) {
      note('one value ten times too large: divided by 10', show(t));
      return t as Quad;
    }
  }
  // 4. Absolute and optimal typed into each other's column (either end, or both).
  const s = [...q];
  if (s[0] > s[1]) [s[0], s[1]] = [s[1], s[0]];
  if (s[3] < s[2]) [s[2], s[3]] = [s[3], s[2]];
  if (ordered(s)) {
    note('absolute and optimal limits were swapped: swapped back', show(s));
    return s as Quad;
  }
  // 5. Optimal limits reversed: put them in order, then make the absolute window contain them
  //    (the permissive reading; the crop is flagged so the scorer adds a caveat).
  if (q[1] > q[2]) [q[1], q[2]] = [q[2], q[1]];
  q = [Math.min(q[0], q[1]), q[1], q[2], Math.max(q[3], q[2])];
  if (ordered(q)) {
    note('inconsistent window: absolute limits widened to contain the optimal ones', show(q));
    return q as Quad;
  }
  note('window could not be repaired: dropped', '-');
  return null;
}

// ------------------------------------------------------------------------------------------------
// Text classes -> contract enums
// ------------------------------------------------------------------------------------------------

function textureList(s: string): TextureClass[] {
  const parts = s.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const out = new Set<TextureClass>();
  for (const p of parts) {
    if (p === 'wide') (['heavy', 'medium', 'light'] as const).forEach((t) => out.add(t));
    else if (p === 'heavy' || p === 'medium' || p === 'light' || p === 'organic') out.add(p);
  }
  return (['heavy', 'medium', 'light', 'organic'] as const).filter((t) => out.has(t));
}

function depthClass(s: string): DepthClass | null {
  const t = s.toLowerCase();
  if (t.startsWith('very shallow')) return 'very-shallow';
  if (t.startsWith('shallow')) return 'shallow';
  if (t.startsWith('medium')) return 'medium';
  if (t.startsWith('deep')) return 'deep';
  return null;
}

function drainageList(s: string): DrainageClass[] {
  const t = s.toLowerCase();
  const out: DrainageClass[] = [];
  if (t.includes('poorly')) out.push('poor');
  if (t.includes('well')) out.push('well');
  if (t.includes('excessive')) out.push('excessive');
  return out;
}

function salinityClass(s: string): SalinityClass | null {
  const t = s.toLowerCase();
  if (t.startsWith('none')) return 'none';
  if (t.startsWith('low')) return 'low';
  if (t.startsWith('medium')) return 'medium';
  if (t.startsWith('high')) return 'high';
  return null;
}

function fertilityClass(s: string): FertilityClass | null {
  const t = s.trim().toLowerCase();
  return t === 'low' || t === 'moderate' || t === 'high' ? t : null;
}

function alToxicityClass(s: string): AlToxicityClass | null {
  const t = s.trim().toLowerCase();
  if (t.startsWith('none')) return 'none';
  if (t.startsWith('low')) return 'low';
  if (t.startsWith('medium')) return 'medium';
  if (t.startsWith('high')) return 'high';
  return null;
}

/** `tropical wet & dry (Aw), steppe or semiarid (Bs)` -> ['Aw', 'Bs'] (Köppen-Trewartha codes). */
function zoneCodes(s: string): string[] {
  return [...s.matchAll(/\(([A-Z][a-z]?)\)/g)].map((m) => m[1]);
}

function photoperiodClasses(s: string): string[] {
  const t = s.toLowerCase();
  const out: string[] = [];
  if (t.includes('short day')) out.push('short');
  if (t.includes('neutral day')) out.push('neutral');
  if (t.includes('long day')) out.push('long');
  if (t.includes('not sensitive')) return ['short', 'neutral', 'long'];
  return out;
}

const CATEGORY_ORDER: [RegExp, CropCategory][] = [
  [/cereals/, 'cereal'],
  [/pulses/, 'pulse'],
  [/roots\/tubers/, 'root'],
  [/vegetables/, 'vegetable'],
  [/fruits & nuts/, 'fruit'],
  [/forage\/pasture/, 'forage'],
  [/cover crop/, 'cover'],
  [/materials/, 'industrial'],
  [/medicinals & aromatic/, 'herb'],
  [/ornamentals\/turf/, 'ornamental'],
];

function category(s: string): CropCategory {
  const t = s.toLowerCase();
  for (const [re, c] of CATEGORY_ORDER) if (re.test(t)) return c;
  return 'other';
}

function lifeSpan(span: string, form: string): CropProfile['lifeSpan'] {
  const t = span.toLowerCase();
  // "annual, perennial" is a perennial usually grown as an annual: the first class listed wins.
  for (const part of t.split(',').map((p) => p.trim())) if (part === 'annual' || part === 'biennial' || part === 'perennial') return part;
  return /tree|shrub/.test(form.toLowerCase()) ? 'perennial' : 'annual';
}

// ------------------------------------------------------------------------------------------------
// Rows -> profiles
// ------------------------------------------------------------------------------------------------

const TEMP: QuadSpec = { field: 'temperature', lo: -10, hi: 60, marginLo: 8, marginHi: 7, digits: 1 };
const RAIN: QuadSpec = { field: 'rainfall', lo: 0, hi: 12000, marginLo: 300, marginHi: 800, digits: 0 };
const PH: QuadSpec = { field: 'pH', lo: 2, hi: 11, marginLo: 0.7, marginHi: 1, digits: 1 };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export function cleanEcoCrop(rows: Raw[]): CleanResult {
  const events: CleaningEvent[] = [];
  const stats: Record<string, number> = { rows: rows.length };
  const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

  // Median opt-to-abs margins from the rows that are complete and ordered, so imputation is data-driven.
  const margins = (a: string, b: string, c: string, d: string) => {
    const lo: number[] = [];
    const hi: number[] = [];
    for (const r of rows) {
      const q = [num(r[a]), num(r[b]), num(r[c]), num(r[d])];
      if (q.every((v) => v != null) && ordered(q as number[])) {
        lo.push((q[1] as number) - (q[0] as number));
        hi.push((q[3] as number) - (q[2] as number));
      }
    }
    return { lo: median(lo), hi: median(hi) };
  };
  const mT = margins('eco_temperat_requir_abs_min', 'eco_temperat_requir_opt_min', 'eco_temperat_requir_opt_max', 'eco_temperat_requir_abs_max');
  const mR = margins('eco_rainfall_annual_abs_min', 'eco_rainfall_annual_opt_min', 'eco_rainfall_annual_opt_max', 'eco_rainfall_annual_abs_max');
  const mP = margins('eco_soil_ph_abs_min', 'eco_soil_ph_opt_min', 'eco_soil_ph_opt_max', 'eco_soil_ph_abs_max');
  const temp = { ...TEMP, marginLo: mT.lo, marginHi: mT.hi };
  const rain = { ...RAIN, marginLo: mR.lo, marginHi: mR.hi };
  const ph = { ...PH, marginLo: mP.lo, marginHi: mP.hi };
  stats.medianTempMarginLo = mT.lo;
  stats.medianTempMarginHi = mT.hi;

  // Median cycle of annual species, used only where a cycle is missing.
  const annualMin: number[] = [];
  const annualMax: number[] = [];
  for (const r of rows) {
    const a = num(r.cult_cycle_min);
    const b = num(r.cult_cycle_max);
    if (a && b && a > 0 && b >= a && b <= 366 && /^annual/.test(r.desc_life_span.trim().toLowerCase())) {
      annualMin.push(a);
      annualMax.push(b);
    }
  }
  const annualCycle: [number, number] = [median(annualMin), median(annualMax)];
  stats.medianAnnualCycleMin = annualCycle[0];
  stats.medianAnnualCycleMax = annualCycle[1];

  const profiles = new Map<number, CropProfile>();
  const commonNames = new Map<number, string[]>();
  const families = new Map<number, string>();
  const usedIds = new Set<string>();

  for (const r of rows) {
    const ecocropId = Number(r.ecocrop_id);
    const name = r.name.trim();
    const log = (field: string, before: string) => (action: string, after: string) => {
      events.push({ ecocropId, name, field, action, before, after });
      bump(`repaired:${field}`);
    };
    const flags: string[] = [];
    const q = (cols: [string, string, string, string], spec: QuadSpec): Quad | null => {
      const raw = cols.map((c) => num(r[c])) as Q4;
      const before = cols.map((c) => r[c] || '-').join('/');
      const n0 = events.length;
      const out = repairQuad(raw, spec, log(spec.field, before));
      if (events.length > n0) flags.push('quad-repaired');
      return out;
    };

    const tempC = q(['eco_temperat_requir_abs_min', 'eco_temperat_requir_opt_min', 'eco_temperat_requir_opt_max', 'eco_temperat_requir_abs_max'], temp);
    const rainMm = q(['eco_rainfall_annual_abs_min', 'eco_rainfall_annual_opt_min', 'eco_rainfall_annual_opt_max', 'eco_rainfall_annual_abs_max'], rain);
    const phQ = q(['eco_soil_ph_abs_min', 'eco_soil_ph_opt_min', 'eco_soil_ph_opt_max', 'eco_soil_ph_abs_max'], ph);
    if (!tempC || !rainMm) {
      bump('dropped:no-climate-window');
      continue;
    }
    if (!phQ) flags.push('ph-missing');

    const req: CropRequirements = {
      tempC,
      rainMm,
      // The contract requires a pH window; a flagged neutral one is never scored (see flags).
      ph: phQ ?? [3, 5, 7.5, 9.5],
    };

    const texOpt = textureList(r.eco_soil_texture_opt);
    const texAbs = textureList(r.eco_soil_texture_abs);
    if (texOpt.length || texAbs.length) {
      const opt = texOpt.length ? texOpt : texAbs;
      req.texture = { opt, abs: [...new Set([...texAbs, ...opt])] };
    }
    const dOpt = depthClass(r.eco_soil_depth_opt);
    const dAbs = depthClass(r.eco_soil_depth_abs);
    if (dOpt || dAbs) req.depth = { opt: (dOpt ?? dAbs)!, abs: (dAbs ?? dOpt)! };
    const drOpt = drainageList(r.eco_soil_drainage_opt);
    const drAbs = drainageList(r.eco_soil_drainage_abs);
    if (drOpt.length || drAbs.length) {
      const opt = drOpt.length ? drOpt : drAbs;
      req.drainage = { opt, abs: [...new Set([...drAbs, ...opt])] };
    }
    const sOpt = salinityClass(r.eco_soil_salinity_opt);
    const sAbs = salinityClass(r.eco_soil_salinity_abs);
    if (sOpt || sAbs) req.salinity = { opt: (sOpt ?? sAbs)!, abs: (sAbs ?? sOpt)! };
    const fOpt = fertilityClass(r.eco_soil_fertility_opt);
    const fAbs = fertilityClass(r.eco_soil_fertility_abs);
    if (fOpt || fAbs) req.fertility = { opt: (fOpt ?? fAbs)!, abs: (fAbs ?? fOpt)! };
    const alOpt = alToxicityClass(r.eco_soil_al_tox_opt);
    const alAbs = alToxicityClass(r.eco_soil_al_tox_abs);
    if (alOpt || alAbs) req.alToxicity = { opt: (alOpt ?? alAbs)!, abs: (alAbs ?? alOpt)! };

    const kill = num(r.clim_killing_temp_early_growth);
    const killRest = num(r.clim_killing_temp_during_rest);
    if (kill != null) req.killTempC = kill;
    if (killRest != null) req.killTempRestC = killRest;

    const altMax = num(r.eco_altitude_abs_max);
    if (altMax != null && altMax > 0) req.altitudeMaxM = altMax;

    // Latitude: [south, north]. Values above 90 are altitudes typed into the latitude columns.
    const latS = num(r.eco_latitude_abs_min);
    const latN = num(r.eco_latitude_abs_max);
    const latBefore = `${r.eco_latitude_abs_min || '-'}/${r.eco_latitude_abs_max || '-'}`;
    if ((latS != null && latS > 90) || (latN != null && latN > 90)) {
      log('latitude', latBefore)('latitude above 90 (an altitude typed into the latitude field): dropped', '-');
    } else if (latS != null || latN != null) {
      req.latitudeAbs = [(latS ?? latN)!, (latN ?? latS)!];
    }

    const photo = photoperiodClasses(r.clim_photoperiod);
    if (photo.length) req.photoperiod = photo;
    const zones = zoneCodes(r.clim_climate_zone);
    if (zones.length) req.climateZones = zones;

    // Cycle: 0 is "missing"; a thousands separator is not a day count.
    const span = lifeSpan(r.desc_life_span, r.desc_life_form);
    let cMin = num(r.cult_cycle_min);
    let cMax = num(r.cult_cycle_max);
    const cBefore = `${r.cult_cycle_min}-${r.cult_cycle_max}`;
    if (cMin != null && (cMin <= 0 || cMin > 366)) cMin = null;
    if (cMax != null && (cMax <= 0 || cMax > 366)) cMax = null;
    if (/,/.test(r.cult_cycle_min) || /,/.test(r.cult_cycle_max)) log('cycle', cBefore)('thousands separator in a day count: value ignored', `${cMin ?? '-'}-${cMax ?? '-'}`);
    let cycleDays: [number, number];
    if (cMin != null && cMax != null) cycleDays = cMin <= cMax ? [cMin, cMax] : [cMax, cMin];
    else if (cMin != null || cMax != null) cycleDays = [(cMin ?? cMax)!, (cMax ?? cMin)!];
    else {
      cycleDays = span === 'annual' ? annualCycle : [365, 365];
      flags.push('cycle-assumed');
      bump('cycle-assumed');
    }

    let id = slugify(name);
    if (usedIds.has(id)) id = `${id}-${ecocropId}`;
    usedIds.add(id);

    const names = r.common_names
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length <= 32);
    const firstAscii = names.find((n) => /^[A-Za-z][A-Za-z' -]+$/.test(n));
    const profile: CropProfile = {
      id,
      ecocropId,
      scientificName: name,
      names: { en: firstAscii ? firstAscii[0].toUpperCase() + firstAscii.slice(1) : name },
      category: category(r.desc_category),
      lifeSpan: span,
      req,
      cycleDays,
      curated: false,
    };
    if (flags.length) profile.flags = [...new Set(flags)];
    profiles.set(ecocropId, profile);
    commonNames.set(ecocropId, [...new Set(names)].slice(0, 8));
    const fam = r.family.split(':').pop()?.trim();
    if (fam) families.set(ecocropId, fam);
  }

  mergeVariants(profiles, commonNames, events, bump);
  stats.scorable = profiles.size;
  stats.events = events.length;
  return { profiles, commonNames, families, events, stats };
}

const binomial = (name: string) => name.split(/[\s,]+/).slice(0, 2).join(' ').toLowerCase();
const sameQuad = (a: Quad, b: Quad) => a.every((v, i) => v === b[i]);

/**
 * EcoCrop lists some species twice: a bare species row and a subspecies or variety row with the
 * same thresholds, one of them missing the text classes (Zea mays / Zea mays ssp. mays). Rows
 * with identical climate and pH windows are merged into the bare species row, which inherits any
 * class the duplicate has and it lacks. Varieties with different thresholds stay separate crops.
 */
function mergeVariants(
  profiles: Map<number, CropProfile>,
  commonNames: Map<number, string[]>,
  events: CleaningEvent[],
  bump: (k: string, n?: number) => void,
): void {
  const groups = new Map<string, CropProfile[]>();
  for (const p of profiles.values()) {
    const k = binomial(p.scientificName);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  for (const [k, group] of groups) {
    if (group.length < 2) continue;
    const base = group.find((p) => p.scientificName.toLowerCase() === k);
    if (!base) continue;
    for (const v of group) {
      if (v === base) continue;
      if (!sameQuad(v.req.tempC, base.req.tempC) || !sameQuad(v.req.rainMm, base.req.rainMm) || !sameQuad(v.req.ph, base.req.ph)) continue;
      const filled: string[] = [];
      for (const key of ['texture', 'depth', 'drainage', 'salinity', 'fertility', 'alToxicity', 'photoperiod', 'climateZones', 'latitudeAbs', 'altitudeMaxM', 'killTempC', 'killTempRestC'] as const) {
        if (base.req[key] == null && v.req[key] != null) {
          // Same key on both sides, so the value types line up; TypeScript cannot see that through the union.
          (base.req as unknown as Record<string, unknown>)[key] = v.req[key];
          filled.push(key);
        }
      }
      if (base.category === 'other' && v.category !== 'other') base.category = v.category;
      commonNames.set(base.ecocropId!, [...new Set([...(commonNames.get(base.ecocropId!) ?? []), ...(commonNames.get(v.ecocropId!) ?? [])])].slice(0, 8));
      events.push({
        ecocropId: v.ecocropId!,
        name: v.scientificName,
        field: 'row',
        action: `duplicate of "${base.scientificName}" (identical temperature, rainfall and pH windows): merged`,
        before: v.scientificName,
        after: filled.length ? `filled ${filled.join(', ')} on the species row` : 'nothing to fill',
      });
      profiles.delete(v.ecocropId!);
      commonNames.delete(v.ecocropId!);
      bump('merged-duplicates');
    }
  }
}
