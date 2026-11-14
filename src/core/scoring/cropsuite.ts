/**
 * CropSuite v1.0 (Zabel, Knüttel & Poschlod 2025, Geosci. Model Dev. 18, 1067-1087,
 * doi:10.5194/gmd-18-1067-2025) ported from a raster model to one parcel. Pure TypeScript.
 *
 * The method, in the paper's order:
 *   1. every requirement of a crop is a fuzzy membership function, 0 (not suitable) to 100;
 *   2. climate suitability is computed for every possible sowing day of the year from the mean
 *      temperature and the total precipitation over the growing cycle that starts on that day;
 *   3. climate variability enters as the recurrence rate of potential crop failure: the share of
 *      years in which the cycle's temperature or precipitation leaves the crop's tolerable band;
 *   4. lethal limits (permafrost, heat, killing temperature, day length, vernalization, dry
 *      spells, germination) set the suitability of a sowing day to 0;
 *   5. Liebig's law of the minimum combines the factors: climate = min(temperature,
 *      precipitation, variability), soil = min(soil and terrain factors), crop = min(climate, soil);
 *   6. the best sowing day, the number of suitable sowing days, the multiple-cropping potential
 *      and the most-limiting factor follow from the per-day climate suitability.
 *
 * What differs from the paper, and why, is listed in docs/SCORING.md section 9.
 */
import type { CropProfile, CropSuitabilityClass, DepthClass, DrainageClass, FertilityClass, Quad, SalinityClass, TextureClass } from '@/contracts';

export const DAYS_PER_YEAR = 365;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_START = MONTH_DAYS.reduce<number[]>((acc, d, i) => (acc.push(i ? acc[i - 1] + MONTH_DAYS[i - 1] : 0), acc), []);

/** Model settings; the paper's value or recommendation is quoted for each. */
export const CROPSUITE = {
  /** "Between harvest and reseeding, we assume a certain time period (21 d in this study)". */
  turnaroundDays: 21,
  /** "A maximum lethal temperature threshold of > 40 °C on average over the growing cycle is set for all crops". */
  maxCycleMeanTempC: 40,
  /** "We assume permafrost in areas with an average annual temperature below 0 °C". */
  permafrostMeanTempC: 0,
  /** Variability thresholds sit "between the higher and lower 5 % and 10 % of the suitability values": the middle of that band. */
  variabilityLevel: 7.5,
  /** Suitability reaches 0 "when the recurrence rate of potential crop failure is greater than once every 4 years (25 %)". */
  failureRateLimit: 0.25,
  /** Days below this count as dry ("precipitation values below 1 mm/d are considered dry days"). */
  dryDayMm: 1,
  /** "resulting in one, two, or three sowing dates per year". */
  maxHarvests: 3,
  /** Fewer analysed years than this give no recurrence rate (the factor is skipped, not scored as 0). */
  minYears: 5,
  /**
   * Suitability of a soil class the crop tolerates but does not prefer. EcoCrop gives classes, not
   * curves; 60 is the lower edge of "moderately suitable" (S2) in Sys et al. 1991, inside the
   * paper's 33-74 band (Table 3). A class outside the tolerated set scores 0.
   */
  toleratedClass: 60,
  /** A month whose mean daily minimum is below Tkill + 4 °C contains a killing night (Ramirez-Villegas et al. 2013). */
  killMarginC: 4,
  /** Supplemental irrigation closes a deficit of at most this share of the optimal season water (same rule as the v2 scorer). */
  supplementalShare: 0.3,
} as const;

// ------------------------------------------------------------------------------------------------
// 1. Membership functions
// ------------------------------------------------------------------------------------------------

/** Piecewise-linear membership function: nodes `x` ascending (equal neighbours make a step), `y` in 0..100. */
export interface MembershipFunction {
  x: readonly number[];
  y: readonly number[];
}

/** Value of a membership function at `v`: linear between nodes, flat beyond the first and last node. */
export function membership(fn: MembershipFunction, v: number): number {
  const { x, y } = fn;
  const n = x.length;
  if (!n || Number.isNaN(v)) return NaN;
  if (v < x[0]) return y[0];
  if (v > x[n - 1]) return y[n - 1];
  let atNode = -1;
  for (let i = 0; i < n; i++) if (x[i] === v) atNode = Math.max(atNode, y[i]); // a step keeps its upper value
  if (atNode >= 0) return atNode;
  for (let i = 0; i < n - 1; i++) if (v > x[i] && v < x[i + 1]) return y[i] + ((y[i + 1] - y[i]) * (v - x[i])) / (x[i + 1] - x[i]);
  return y[n - 1];
}

/** EcoCrop window as a membership function: 0 at the absolute limits, 100 across the optimum. */
export const quadMembership = (q: Quad): MembershipFunction => ({ x: [q[0], q[1], q[2], q[3]], y: [0, 100, 100, 0] });

/**
 * Lower and upper threshold of a membership function for the climate-variability test: where the
 * function crosses `level` on its rising and on its falling side. Where a side never comes down to
 * `level`, the threshold is the outermost node of that side (paper, section 2.2).
 */
export function variabilityThresholds(fn: MembershipFunction, level: number = CROPSUITE.variabilityLevel): [lower: number, upper: number] {
  const { x, y } = fn;
  const n = x.length;
  let lower = x[0];
  if (y[0] <= level)
    for (let i = 0; i < n - 1; i++)
      if (y[i] <= level && y[i + 1] > level) {
        lower = x[i + 1] === x[i] ? x[i] : x[i] + ((level - y[i]) * (x[i + 1] - x[i])) / (y[i + 1] - y[i]);
        break;
      }
  let upper = x[n - 1];
  if (y[n - 1] <= level)
    for (let i = n - 1; i > 0; i--)
      if (y[i] <= level && y[i - 1] > level) {
        upper = x[i] === x[i - 1] ? x[i] : x[i] - ((level - y[i]) * (x[i] - x[i - 1])) / (y[i - 1] - y[i]);
        break;
      }
  return [lower, upper];
}

const logistic = (ratePct: number): number => 1 / (1 + Math.exp(0.4 * (ratePct - 12.5)));
/**
 * Membership function for climate variability (paper, Fig. 5): a sigmoid of the recurrence rate
 * of potential crop failure that is 100 at 0 %, about 73 at 10 %, 27 at 15 % and 0 from 25 % on.
 */
export function variabilitySuitability(failureRate: number): number {
  if (!(failureRate < CROPSUITE.failureRateLimit)) return 0;
  const hi = logistic(0);
  const lo = logistic(100 * CROPSUITE.failureRateLimit);
  return (100 * (logistic(100 * Math.max(0, failureRate)) - lo)) / (hi - lo);
}

export type SuitabilityClass = CropSuitabilityClass;
/** Paper, Table 3: 0 unsuitable, 1-32 marginally, 33-74 moderately, 75-100 highly suitable. */
export const suitabilityClass = (s: number): SuitabilityClass => (s < 1 ? 'unsuitable' : s < 33 ? 'marginal' : s < 75 ? 'moderate' : 'high');

// ------------------------------------------------------------------------------------------------
// 2. Crop parameterisation from the EcoCrop-based catalogue
// ------------------------------------------------------------------------------------------------

export interface CropSuiteParams {
  /** Length of the growing cycle in days; 365 for perennials (paper, section 2.1). */
  cycleDays: number;
  perennial: boolean;
  /** On the mean temperature over the growing cycle, °C. */
  temperature: MembershipFunction;
  /** On the total precipitation over the growing cycle, mm. */
  precipitation: MembershipFunction;
  tempThresholds: [number, number];
  precipThresholds: [number, number];
  /** Killing temperature compared with the monthly mean daily minimum (margin included), or null. */
  lethalMinC: number | null;
  /** Allowed mean day length over the growing cycle, hours, or null when the crop is not sensitive. */
  dayLengthH: [number, number] | null;
  /** Winter crops: `days` days with a mean temperature inside [tMinC, tMaxC] are needed after `offsetDays`. */
  vernalization?: { tMinC: number; tMaxC: number; days: number; offsetDays?: number };
  /** Requirements of the first `days` days after sowing. */
  germination?: { days: number; minTempC?: number; minRainMm?: number };
  /** Longest tolerated run of dry days inside the growing cycle (rainfed only). */
  maxDryDays?: number;
  ph: MembershipFunction | null;
  /** On soil depth, cm. */
  depth: MembershipFunction | null;
  /** On electrical conductivity of the saturation extract, dS/m. */
  salinity: MembershipFunction | null;
  /** On the organic-carbon and CEC fertility index, 0..1. */
  fertility: MembershipFunction | null;
  /** On slope, degrees. */
  slope: MembershipFunction;
  texture: Partial<Record<TextureClass, number>> | null;
  drainage: Partial<Record<DrainageClass, number>> | null;
}

const DEPTH_FROM_CM: Record<DepthClass, number> = { 'very-shallow': 0, shallow: 20, medium: 50, deep: 150 };
const DEPTH_ORDER: DepthClass[] = ['very-shallow', 'shallow', 'medium', 'deep'];
/** Upper EC limit of each EcoCrop salinity class, dS/m (`low (<4)`, `medium (4-10)`, `high (>10)`; none = non-saline, FAO 0-2). */
const SALINITY_TO_DSM: Record<SalinityClass, number> = { none: 2, low: 4, medium: 10, high: 16 };
const SALINITY_ORDER: SalinityClass[] = ['none', 'low', 'medium', 'high'];
/** Fertility-index thresholds of the v2 scorer (`literature.ts`), so both methods read the classes alike. */
const FERTILITY_OPT: Record<FertilityClass, number> = { low: 0.3, moderate: 0.55, high: 0.78 };
const FERTILITY_ABS: Record<FertilityClass, number> = { low: 0.12, moderate: 0.28, high: 0.45 };
/** Day-length band of each EcoCrop photoperiod class, hours. */
const DAY_LENGTH: Record<string, [number, number]> = { short: [0, 12], neutral: [12, 14], long: [14, 24] };

const classScores = <T extends string>(need: { opt: readonly T[]; abs: readonly T[] } | undefined): Partial<Record<T, number>> | null => {
  if (!need) return null;
  const out: Partial<Record<T, number>> = {};
  for (const c of need.abs) out[c] = CROPSUITE.toleratedClass;
  for (const c of need.opt) out[c] = 100;
  return out;
};

/** Mean growing cycle of the crop in days, as the v2 scorer reads it. */
export const cropSuiteCycleDays = (crop: CropProfile): number =>
  crop.lifeSpan === 'perennial' ? DAYS_PER_YEAR : Math.min(DAYS_PER_YEAR, Math.max(20, Math.round((crop.cycleDays[0] + crop.cycleDays[1]) / 2)));

/**
 * Membership functions and limits of one crop, derived from its EcoCrop requirements. The paper
 * takes them from Sys et al. (1993) and, for crops that source lacks, from EcoCrop; this catalogue
 * is EcoCrop throughout. Vernalization, germination and dry-spell limits have no EcoCrop source
 * and stay unset unless `extra` supplies them.
 */
export function cropSuiteParams(crop: CropProfile, extra: Partial<Pick<CropSuiteParams, 'vernalization' | 'germination' | 'maxDryDays'>> = {}): CropSuiteParams {
  const req = crop.req;
  const perennial = crop.lifeSpan === 'perennial';
  const cycleDays = cropSuiteCycleDays(crop);
  // EcoCrop rainfall is an annual figure; a cycle shorter than four months needs proportionally less (same scaling as v2).
  const months = Math.min(12, Math.max(1, Math.round(cycleDays / 30.4)));
  const scale = Math.min(1, months / 4);
  const temperature = quadMembership(req.tempC);
  const precipitation = quadMembership(req.rainMm.map((v) => v * scale) as Quad);

  let depth: MembershipFunction | null = null;
  if (req.depth) {
    const opt = DEPTH_FROM_CM[req.depth.opt];
    const absIdx = Math.min(DEPTH_ORDER.indexOf(req.depth.abs), DEPTH_ORDER.indexOf(req.depth.opt));
    // Suitability rises from 0 at the shallow edge of the tolerated class to 100 at the edge of the optimal class.
    const from = absIdx < DEPTH_ORDER.indexOf(req.depth.opt) ? DEPTH_FROM_CM[DEPTH_ORDER[absIdx]] : DEPTH_FROM_CM[DEPTH_ORDER[Math.max(0, absIdx - 1)]];
    depth = opt <= 0 ? { x: [0], y: [100] } : { x: [Math.min(from, opt), opt], y: [0, 100] };
  }
  let salinity: MembershipFunction | null = null;
  if (req.salinity) {
    const opt = SALINITY_TO_DSM[req.salinity.opt];
    const absIdx = Math.max(SALINITY_ORDER.indexOf(req.salinity.abs), SALINITY_ORDER.indexOf(req.salinity.opt));
    // 0 at the upper edge of the tolerated class; a crop that tolerates no more than its optimal class reaches 0 halfway into the next one.
    const next = SALINITY_TO_DSM[SALINITY_ORDER[Math.min(3, absIdx + 1)]];
    const to = absIdx > SALINITY_ORDER.indexOf(req.salinity.opt) ? SALINITY_TO_DSM[SALINITY_ORDER[absIdx]] : opt + (next - opt) / 2;
    salinity = { x: [opt, Math.max(to, opt + 1)], y: [100, 0] };
  }
  let fertility: MembershipFunction | null = null;
  if (req.fertility) {
    const opt = FERTILITY_OPT[req.fertility.opt];
    fertility = { x: [Math.min(FERTILITY_ABS[req.fertility.abs], opt - 0.05), opt], y: [0, 100] };
  }
  const classes = req.photoperiod?.filter((c) => c in DAY_LENGTH) ?? [];
  const dayLengthH: [number, number] | null =
    classes.length && classes.length < 3 ? [Math.min(...classes.map((c) => DAY_LENGTH[c][0])), Math.max(...classes.map((c) => DAY_LENGTH[c][1]))] : null;
  const kill = perennial ? (req.killTempRestC ?? req.killTempC) : req.killTempC;

  return {
    cycleDays,
    perennial,
    temperature,
    precipitation,
    tempThresholds: variabilityThresholds(temperature),
    precipThresholds: variabilityThresholds(precipitation),
    lethalMinC: kill == null ? null : kill + CROPSUITE.killMarginC,
    dayLengthH: dayLengthH && (dayLengthH[0] > 0 || dayLengthH[1] < 24) ? dayLengthH : null,
    ph: crop.flags?.includes('ph-missing') ? null : quadMembership(req.ph),
    depth,
    salinity,
    fertility,
    // Terrain limits of GAEZ v4 as in the v2 scorer: 8 % / 30 % for annuals, 16 % / 45 % for perennials.
    slope: perennial ? { x: [9, 24], y: [100, 0] } : { x: [4.6, 16.7], y: [100, 0] },
    texture: classScores(req.texture),
    drainage: classScores(req.drainage),
    ...extra,
  };
}

// ------------------------------------------------------------------------------------------------
// 3. Climate: monthly history laid out as days
// ------------------------------------------------------------------------------------------------

/** Monthly climate history as flat sequences of length `years * 12` (January of the first year first); NaN where missing. */
export interface CropSuiteClimate {
  years: number;
  rain: ArrayLike<number>;
  tMean: ArrayLike<number>;
  tMin: ArrayLike<number>;
}

export interface PreparedClimate {
  years: number;
  /** Prefix sums over the day sequence of every year (length years * 365 + 1). */
  sumT: Float64Array;
  sumP: Float64Array;
  /** Prefix count of days whose month is missing. */
  sumGap: Float64Array;
  /** Prefix sums over two consecutive climatological years (length 731), so a cycle may run past December. */
  climT: Float64Array;
  climP: Float64Array;
  climDayLength: Float64Array;
  /** Climatological daily values for two years (length 730). */
  dayT: Float64Array;
  dayP: Float64Array;
  /** Climatological mean daily minimum of each month, °C. */
  monthTmin: number[];
  annualMeanT: number;
}

const prefix = (a: ArrayLike<number>): Float64Array => {
  const out = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) out[i + 1] = out[i] + a[i];
  return out;
};

function dayLengthHours(latDeg: number, doy: number): number {
  const phi = (latDeg * Math.PI) / 180;
  const decl = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const x = -Math.tan(phi) * Math.tan(decl);
  return (24 / Math.PI) * Math.acos(x < -1 ? -1 : x > 1 ? 1 : x);
}

/**
 * The paper drives the model with daily temperature and precipitation. The parcel history is
 * monthly, so each day takes its month's mean temperature and an equal share of its month's
 * rainfall: cycle means and totals are exact for whole months and interpolated inside a month.
 */
export function prepareCropSuiteClimate(c: CropSuiteClimate, latDeg: number): PreparedClimate | null {
  if (!c.years) return null;
  const n = c.years * DAYS_PER_YEAR;
  const t = new Float64Array(n);
  const p = new Float64Array(n);
  const gap = new Float64Array(n);
  const clim = { t: new Array<number>(12).fill(0), p: new Array<number>(12).fill(0), tn: new Array<number>(12).fill(0) };
  const count = { t: new Array<number>(12).fill(0), p: new Array<number>(12).fill(0), tn: new Array<number>(12).fill(0) };
  for (let i = 0; i < c.years * 12; i++) {
    const m = i % 12;
    if (!Number.isNaN(c.tMean[i])) (clim.t[m] += c.tMean[i]), count.t[m]++;
    if (!Number.isNaN(c.rain[i])) (clim.p[m] += c.rain[i]), count.p[m]++;
    if (!Number.isNaN(c.tMin[i])) (clim.tn[m] += c.tMin[i]), count.tn[m]++;
  }
  for (let m = 0; m < 12; m++) {
    if (!count.t[m] || !count.p[m]) return null; // a calendar month without any record: no climatology
    clim.t[m] /= count.t[m];
    clim.p[m] /= count.p[m];
    clim.tn[m] = count.tn[m] ? clim.tn[m] / count.tn[m] : NaN;
  }
  for (let y = 0; y < c.years; y++)
    for (let m = 0; m < 12; m++) {
      const i = y * 12 + m;
      const missing = Number.isNaN(c.tMean[i]) || Number.isNaN(c.rain[i]);
      for (let d = 0; d < MONTH_DAYS[m]; d++) {
        const k = y * DAYS_PER_YEAR + MONTH_START[m] + d;
        t[k] = missing ? clim.t[m] : c.tMean[i];
        p[k] = (missing ? clim.p[m] : c.rain[i]) / MONTH_DAYS[m];
        gap[k] = missing ? 1 : 0;
      }
    }
  const dayT = new Float64Array(2 * DAYS_PER_YEAR);
  const dayP = new Float64Array(2 * DAYS_PER_YEAR);
  const dayLen = new Float64Array(2 * DAYS_PER_YEAR);
  for (let k = 0; k < 2 * DAYS_PER_YEAR; k++) {
    const doy = k % DAYS_PER_YEAR;
    let m = 11;
    while (MONTH_START[m] > doy) m--;
    dayT[k] = clim.t[m];
    dayP[k] = clim.p[m] / MONTH_DAYS[m];
    dayLen[k] = dayLengthHours(latDeg, doy + 1);
  }
  return {
    years: c.years,
    sumT: prefix(t),
    sumP: prefix(p),
    sumGap: prefix(gap),
    climT: prefix(dayT),
    climP: prefix(dayP),
    climDayLength: prefix(dayLen),
    dayT,
    dayP,
    monthTmin: clim.tn,
    annualMeanT: clim.t.reduce((a, v, m) => a + v * MONTH_DAYS[m], 0) / DAYS_PER_YEAR,
  };
}

// ------------------------------------------------------------------------------------------------
// 4. Site, options and result
// ------------------------------------------------------------------------------------------------

export interface CropSuiteSite {
  ph: number | null;
  ecDsM: number | null;
  texture: TextureClass | null;
  drainage: DrainageClass | null;
  depthCm: number | null;
  /** Organic-carbon and CEC index of the v2 scorer (`oldfieldFertilityIndex`), 0..1. */
  fertilityIndex: number | null;
  slopeDeg: number | null;
}

export interface CropSuiteOptions {
  /** `full` is the paper's irrigated system: precipitation is no constraint, only its excess still counts as failure. */
  irrigation?: 'rainfed' | 'supplemental' | 'full';
  /** False reproduces the paper's comparison run without climate variability (its Fig. 7b). */
  variability?: boolean;
  /** False ignores the day-length limits. */
  photoperiod?: boolean;
}

export type CropSuiteFactorKey =
  | 'temperature'
  | 'water'
  | 'variability'
  | 'permafrost'
  | 'heat'
  | 'frost'
  | 'photoperiod'
  | 'vernalization'
  | 'germination'
  | 'drySpell'
  | 'ph'
  | 'depth'
  | 'salinity'
  | 'fertility'
  | 'slope'
  | 'texture'
  | 'drainage';

export interface CropSuiteFactor {
  key: CropSuiteFactorKey;
  group: 'climate' | 'soil';
  /** 0..100, or null when the information is missing or the factor does not apply (never scored as 0). */
  suitability: number | null;
  /** The value the membership function was read at. */
  value: number | string | null;
  /** True for a lethal limit, which is either 100 or 0. */
  limit?: boolean;
}

export interface CropSuiteRun {
  params: CropSuiteParams;
  options: Required<CropSuiteOptions>;
  /** Climate suitability of each sowing day of the year (index 0 = 1 January), 0..100. */
  climate: Float64Array;
  /** Recurrence rate of potential crop failure for each sowing day, 0..1; NaN when not computed. */
  failureRate: Float64Array;
  yearsAnalysed: Int16Array;
  /** Day of year (1-365) with the highest climate suitability; 1 for perennials. */
  optimalSowingDoy: number;
  /** Number of sowing days whose climate suitability is above 0. */
  suitableSowingDays: number;
  soilFactors: CropSuiteFactor[];
  /** Minimum of the soil and terrain factors, or null when the site has no soil or terrain value at all. */
  soilSuitability: number | null;
}

export interface CropSuiteEvaluation {
  sowingDoy: number;
  climateSuitability: number;
  soilSuitability: number | null;
  /** Liebig minimum of climate and soil suitability, 0..100. */
  cropSuitability: number;
  class: SuitabilityClass;
  /** Climate factors first, then soil and terrain factors. */
  factors: CropSuiteFactor[];
  /** Factor with the lowest suitability; null when every factor is at 100. */
  limiting: CropSuiteFactor | null;
  failureRate: number | null;
  yearsAnalysed: number;
  yearsFailed: number;
  /** Mean temperature (°C) and water supply (mm, with any supplemental irrigation) over the cycle, climatological. */
  cycleMeanTempC: number;
  cycleWaterMm: number;
  cycleRainMm: number;
}

const windowSum = (pre: Float64Array, start: number, length: number): number => pre[start + length] - pre[start];

type Irrigation = Required<CropSuiteOptions>['irrigation'];

function waterSupply(rainMm: number, params: CropSuiteParams, irrigation: Irrigation): number {
  const optMin = params.precipitation.x[1];
  if (irrigation !== 'supplemental' || rainMm >= optMin) return rainMm;
  return rainMm + Math.min(optMin - rainMm, CROPSUITE.supplementalShare * optMin);
}

/** Lethal limits of one sowing day: each entry is 100 (passed), 0 (lethal) or null (not applicable). */
function limits(params: CropSuiteParams, clim: PreparedClimate, d: number, opts: Required<CropSuiteOptions>): Record<'permafrost' | 'heat' | 'frost' | 'photoperiod' | 'vernalization' | 'germination' | 'drySpell', { s: number | null; v: number | null }> {
  const L = params.cycleDays;
  const meanT = windowSum(clim.climT, d, L) / L;
  const pass = (ok: boolean) => (ok ? 100 : 0);
  let frost: { s: number | null; v: number | null } = { s: null, v: null };
  if (params.lethalMinC != null) {
    let coldest = Infinity;
    for (let m = 0; m < 12; m++) {
      // Month m counts when at least one of its days lies inside the cycle [d, d + L).
      const start = MONTH_START[m];
      const inCycle = L >= DAYS_PER_YEAR || ((start - d + DAYS_PER_YEAR) % DAYS_PER_YEAR) < L || ((d - start + DAYS_PER_YEAR) % DAYS_PER_YEAR) < MONTH_DAYS[m];
      if (inCycle && !Number.isNaN(clim.monthTmin[m])) coldest = Math.min(coldest, clim.monthTmin[m]);
    }
    if (coldest < Infinity) frost = { s: pass(coldest >= params.lethalMinC), v: coldest };
  }
  let photo: { s: number | null; v: number | null } = { s: null, v: null };
  if (opts.photoperiod && params.dayLengthH) {
    const h = windowSum(clim.climDayLength, d, L) / L;
    photo = { s: pass(h >= params.dayLengthH[0] && h <= params.dayLengthH[1]), v: h };
  }
  let vern: { s: number | null; v: number | null } = { s: null, v: null };
  if (params.vernalization) {
    const { tMinC, tMaxC, days, offsetDays = 0 } = params.vernalization;
    let n = 0;
    for (let k = d + offsetDays; k < d + L; k++) if (clim.dayT[k % (2 * DAYS_PER_YEAR)] >= tMinC && clim.dayT[k % (2 * DAYS_PER_YEAR)] <= tMaxC) n++;
    vern = { s: pass(n >= days), v: n };
  }
  let germ: { s: number | null; v: number | null } = { s: null, v: null };
  if (params.germination) {
    const g = Math.min(L, params.germination.days);
    const t = windowSum(clim.climT, d, g) / g;
    const p = windowSum(clim.climP, d, g);
    const tOk = params.germination.minTempC == null || t >= params.germination.minTempC;
    const pOk = opts.irrigation === 'full' || params.germination.minRainMm == null || p >= params.germination.minRainMm;
    germ = { s: pass(tOk && pOk), v: t };
  }
  let dry: { s: number | null; v: number | null } = { s: null, v: null };
  if (params.maxDryDays != null && opts.irrigation !== 'full') {
    let run = 0;
    let longest = 0;
    for (let k = d; k < d + L; k++) {
      run = clim.dayP[k % (2 * DAYS_PER_YEAR)] < CROPSUITE.dryDayMm ? run + 1 : 0;
      if (run > longest) longest = run;
    }
    dry = { s: pass(longest <= params.maxDryDays), v: longest };
  }
  return {
    permafrost: { s: pass(clim.annualMeanT >= CROPSUITE.permafrostMeanTempC), v: clim.annualMeanT },
    heat: { s: pass(meanT <= CROPSUITE.maxCycleMeanTempC), v: meanT },
    frost,
    photoperiod: photo,
    vernalization: vern,
    germination: germ,
    drySpell: dry,
  };
}

/** Recurrence rate of potential crop failure for a cycle sown on day `d` (0-364): failed years / analysed years. */
function failures(params: CropSuiteParams, clim: PreparedClimate, d: number, irrigation: Irrigation): { failed: number; analysed: number; scores: number[] } {
  const L = params.cycleDays;
  let failed = 0;
  let analysed = 0;
  const scores: number[] = [];
  for (let y = 0; y < clim.years; y++) {
    const start = y * DAYS_PER_YEAR + d;
    if (start + L > clim.years * DAYS_PER_YEAR) break; // the cycle would run past the record
    if (windowSum(clim.sumGap, start, L) > 0) continue;
    const t = windowSum(clim.sumT, start, L) / L;
    const rain = windowSum(clim.sumP, start, L);
    const water = waterSupply(rain, params, irrigation);
    const tooCold = t < params.tempThresholds[0];
    const tooHot = t > params.tempThresholds[1];
    const tooDry = irrigation !== 'full' && water < params.precipThresholds[0];
    const tooWet = rain > params.precipThresholds[1];
    analysed++;
    if (tooCold || tooHot || tooDry || tooWet) failed++;
    scores.push(Math.min(membership(params.temperature, t), irrigation === 'full' && rain < params.precipitation.x[1] ? 100 : membership(params.precipitation, water)) / 100);
  }
  return { failed, analysed, scores };
}

const soilFactor = (key: CropSuiteFactorKey, suitability: number | null, value: number | string | null): CropSuiteFactor => ({ key, group: 'soil', suitability, value });

function soilFactors(params: CropSuiteParams, site: CropSuiteSite): CropSuiteFactor[] {
  const fn = (f: MembershipFunction | null, v: number | null) => (f && v != null ? membership(f, v) : null);
  const cls = <T extends string>(scores: Partial<Record<T, number>> | null, have: T | null) => (scores && have != null ? (scores[have] ?? 0) : null);
  return [
    soilFactor('ph', fn(params.ph, site.ph), site.ph),
    soilFactor('texture', cls(params.texture, site.texture), site.texture),
    soilFactor('drainage', cls(params.drainage, site.drainage), site.drainage),
    soilFactor('depth', fn(params.depth, site.depthCm), site.depthCm),
    soilFactor('salinity', fn(params.salinity, site.ecDsM), site.ecDsM),
    soilFactor('fertility', fn(params.fertility, site.fertilityIndex), site.fertilityIndex),
    soilFactor('slope', fn(params.slope, site.slopeDeg), site.slopeDeg),
  ];
}

const minOf = (xs: (number | null)[]): number | null => {
  let m: number | null = null;
  for (const x of xs) if (x != null && (m == null || x < m)) m = x;
  return m;
};

/** Climate factors of one sowing day (0-364), in the order temperature, water, variability, then the lethal limits. */
function climateFactors(params: CropSuiteParams, clim: PreparedClimate, d: number, opts: Required<CropSuiteOptions>, fail: { failed: number; analysed: number } | null): { factors: CropSuiteFactor[]; meanT: number; rain: number; water: number } {
  const L = params.cycleDays;
  const meanT = windowSum(clim.climT, d, L) / L;
  const rain = windowSum(clim.climP, d, L);
  const water = waterSupply(rain, params, opts.irrigation);
  const lim = limits(params, clim, d, opts);
  const rate = fail && fail.analysed >= CROPSUITE.minYears ? fail.failed / fail.analysed : null;
  const factors: CropSuiteFactor[] = [
    { key: 'temperature', group: 'climate', suitability: membership(params.temperature, meanT), value: meanT },
    // Irrigated: "precipitation is not considered a constraining factor"; its excess still limits through variability.
    { key: 'water', group: 'climate', suitability: opts.irrigation === 'full' ? null : membership(params.precipitation, water), value: water },
    { key: 'variability', group: 'climate', suitability: opts.variability && rate != null ? variabilitySuitability(rate) : null, value: rate },
    ...(Object.keys(lim) as (keyof typeof lim)[]).map((key): CropSuiteFactor => ({ key, group: 'climate', suitability: lim[key].s, value: lim[key].v, limit: true })),
  ];
  return { factors, meanT, rain, water };
}

/**
 * Sowing day with the highest climate suitability. The paper does not say which of several equal
 * days to take: here the one that is also best before climate variability, and of a run of such
 * days the middle one, which keeps the cycle away from the edges of the suitable window.
 */
function optimalDay(climate: Float64Array, base: Float64Array): number {
  const N = DAYS_PER_YEAR;
  let top = 0;
  for (let d = 0; d < N; d++) if (climate[d] > top) top = climate[d];
  let topBase = 0;
  for (let d = 0; d < N; d++) if (climate[d] >= top - 1e-9 && base[d] > topBase) topBase = base[d];
  const ok = (d: number) => climate[d % N] >= top - 1e-9 && base[d % N] >= topBase - 1e-9;
  let start = 0;
  while (start < N && ok(start)) start++;
  if (start === N) return 0; // every day is equally good
  let bestStart = -1;
  let bestLen = 0;
  for (let d = start; d < start + N; ) {
    if (!ok(d)) {
      d++;
      continue;
    }
    let e = d;
    while (ok(e + 1) && e + 1 < start + N) e++;
    if (e - d + 1 > bestLen) (bestLen = e - d + 1), (bestStart = d);
    d = e + 1;
  }
  return (bestStart + Math.floor((bestLen - 1) / 2)) % N;
}

/** Climate suitability for every sowing day, optimal sowing day, suitable sowing days and soil suitability. */
export function runCropSuite(params: CropSuiteParams, site: CropSuiteSite, clim: PreparedClimate, options: CropSuiteOptions = {}): CropSuiteRun {
  const opts: Required<CropSuiteOptions> = { irrigation: options.irrigation ?? 'rainfed', variability: options.variability ?? true, photoperiod: options.photoperiod ?? true };
  const climate = new Float64Array(DAYS_PER_YEAR);
  const failureRate = new Float64Array(DAYS_PER_YEAR).fill(NaN);
  const yearsAnalysed = new Int16Array(DAYS_PER_YEAR);
  // A perennial occupies the whole year: every "sowing day" sees the same 365 days, so day 1 stands for all.
  const days = params.perennial ? 1 : DAYS_PER_YEAR;
  // Suitability before climate variability: it separates sowing days that are all at 0 or all at the maximum.
  const base = new Float64Array(DAYS_PER_YEAR);
  let suitable = 0;
  for (let d = 0; d < days; d++) {
    const fail = opts.variability ? failures(params, clim, d, opts.irrigation) : null;
    if (fail) {
      yearsAnalysed[d] = fail.analysed;
      if (fail.analysed >= CROPSUITE.minYears) failureRate[d] = fail.failed / fail.analysed;
    }
    const factors = climateFactors(params, clim, d, opts, fail).factors;
    climate[d] = minOf(factors.map((f) => f.suitability)) ?? 0;
    base[d] = minOf(factors.filter((f) => f.key !== 'variability').map((f) => f.suitability)) ?? 0;
    if (climate[d] > 0) suitable++;
  }
  const best = params.perennial ? 0 : optimalDay(climate, base);
  if (params.perennial) {
    climate.fill(climate[0]);
    failureRate.fill(failureRate[0]);
    yearsAnalysed.fill(yearsAnalysed[0]);
    suitable = climate[0] > 0 ? DAYS_PER_YEAR : 0;
  }
  const soil = soilFactors(params, site);
  return { params, options: opts, climate, failureRate, yearsAnalysed, optimalSowingDoy: best + 1, suitableSowingDays: suitable, soilFactors: soil, soilSuitability: minOf(soil.map((f) => f.suitability)) };
}

/** All factors, the three suitabilities and the most-limiting factor for a sowing day (1-365). */
export function evaluateCropSuite(run: CropSuiteRun, clim: PreparedClimate, sowingDoy: number): CropSuiteEvaluation & { yearScores: number[] } {
  const opts = run.options;
  const d = run.params.perennial ? 0 : (((Math.round(sowingDoy) - 1) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const fail = failures(run.params, clim, d, opts.irrigation);
  const c = climateFactors(run.params, clim, d, opts, opts.variability ? fail : null);
  const factors = [...c.factors, ...run.soilFactors];
  const climateSuitability = minOf(c.factors.map((f) => f.suitability)) ?? 0;
  const cropSuitability = Math.min(climateSuitability, run.soilSuitability ?? 100);
  let limiting: CropSuiteFactor | null = null;
  for (const f of factors) if (f.suitability != null && f.suitability < 100 && (!limiting || f.suitability < limiting.suitability!)) limiting = f;
  const analysed = fail.analysed >= CROPSUITE.minYears;
  return {
    sowingDoy: d + 1,
    climateSuitability,
    soilSuitability: run.soilSuitability,
    cropSuitability,
    class: suitabilityClass(Math.round(cropSuitability)),
    factors,
    limiting,
    failureRate: analysed ? fail.failed / fail.analysed : null,
    yearsAnalysed: fail.analysed,
    yearsFailed: fail.failed,
    cycleMeanTempC: c.meanT,
    cycleWaterMm: c.water,
    cycleRainMm: c.rain,
    yearScores: fail.scores,
  };
}

// ------------------------------------------------------------------------------------------------
// 5. Multiple cropping
// ------------------------------------------------------------------------------------------------

export interface MultipleCropping {
  /** 0 when no sowing day is suitable. */
  harvests: number;
  /** Sowing days of year (1-365), in calendar order. */
  sowingDoys: number[];
  /** Sum of the climate suitabilities of the chosen sowing days. */
  total: number;
}

/**
 * Potential number of harvests of one crop in a year, without rotation (paper, section 2.1): the
 * combination of one, two or three sowing days that maximises the summed climate suitability,
 * with `turnaroundDays` between a harvest and the next sowing. Every chosen day must be suitable.
 */
export function multipleCropping(climate: ArrayLike<number>, cycleDays: number, turnaroundDays: number = CROPSUITE.turnaroundDays, maxHarvests: number = CROPSUITE.maxHarvests): MultipleCropping {
  const N = DAYS_PER_YEAR;
  const block = cycleDays + turnaroundDays;
  const at = (k: number) => climate[k % N];
  let best: MultipleCropping = { harvests: 0, sowingDoys: [], total: 0 };
  const consider = (days: number[]) => {
    const total = days.reduce((a, k) => a + at(k), 0);
    if (total > best.total + 1e-9) best = { harvests: days.length, sowingDoys: days.map((k) => (k % N) + 1).sort((a, b) => a - b), total };
  };
  for (let d = 0; d < N; d++) if (at(d) > 0) consider([d]);
  const kMax = Math.min(maxHarvests, Math.floor(N / block));
  if (kMax < 2 || best.harvests === 0) return best;
  for (let d1 = 0; d1 < N; d1++) {
    if (!(at(d1) > 0)) continue;
    const last = d1 + N - block; // latest start of the final cycle so that it ends, with its turnaround, before d1 comes round again
    // sufBest[k]: best suitable day in [k, last].
    const sufBest = new Int32Array(last + 2).fill(-1);
    for (let k = last; k >= d1 + block; k--) sufBest[k] = at(k) > 0 && (sufBest[k + 1] < 0 || at(k) >= at(sufBest[k + 1])) ? k : sufBest[k + 1];
    const d2 = d1 + block <= last ? sufBest[d1 + block] : -1;
    if (d2 >= 0) consider([d1, d2]);
    if (kMax >= 3)
      for (let k = d1 + block; k + block <= last; k++) {
        if (!(at(k) > 0)) continue;
        const d3 = sufBest[k + block];
        if (d3 >= 0) consider([d1, k, d3]);
      }
  }
  return best;
}
