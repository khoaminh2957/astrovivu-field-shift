/**
 * Tier 3 public API: Astrovivu-AEZ v2 productivity scoring. Pure TypeScript; mathematical
 * derivations, peer-reviewed sources and empirical benchmarks in docs/SCORING_PAPER.md and
 * docs/SCORING.md.
 *
 *   compatibility  static crop-site fit: EcoCrop trapezoids on the growing window, Maas-Hoffman
 *                  continuous salinity, Oldfield Michaelis-Menten SOC/CEC fertility, Saaty AHP
 *                  eigenvector weights (CR = 0.0030) with Khiddir-GAEZ rank-damped edaphic
 *                  combination, plus non-compensatory bioclimatic gates
 *   condition(t)   FAO-56 daily root-zone water balance (Borg-Grimes dynamic root depth Zr(t),
 *                  climatic Kc adjustment eq. 62/65, Feddes/AquaCrop aeration stress Kaer) x
 *                  asymmetric reproductive heat/cold index x Monteith PAR light factor, fused
 *                  with multi-sensor satellite observations (NDVI, ESI, SM_root, LST)
 *   productivity   compatibility x condition
 */
import type {
  BranchId,
  CalibrationNote,
  CropPrevalence,
  CropProfile,
  CropSuiteSummary,
  FactorKind,
  FactorScore,
  FieldTelemetry,
  GroundTruth,
  GrowthStage,
  I18nText,
  ModelInput,
  PrevalenceLevel,
  Quad,
  ScoreSnapshot,
  ScoreTimeline,
  Series,
  SowingWindow,
  StageId,
  TextureClass,
  WhatIfResult,
} from '@/contracts';
import { tx } from '@/contracts';
import { getCrop, listCrops } from '@/core/crops';
import { findSeries } from '@/lib/series';
import { addDays, dayOfYear, diffDays } from '@/lib/time';
import {
  adjustKcClimate,
  aggregateSuitability,
  AHP_PAIRWISE_MATRIX,
  AHP_SOLUTION,
  assimilateSatelliteCondition,
  asymmetricHeatFactor,
  borgGrimesRootDepth,
  cropCanopyHeightM,
  drainagePercolationMmDay,
  estimateRhMin,
  feddesAerationFactor,
  isHydrophyticCrop,
  maasHoffmanSalinity,
  monteithRadiationFactor,
  oldfieldFertilityIndex,
  scoreFertilityContinuous,
  solveAhpMatrix,
  type AggregationItem,
  type AhpSolution,
  type ParametricMethod,
} from './literature';
import {
  cropSuiteParams,
  CROPSUITE,
  evaluateCropSuite,
  multipleCropping,
  prepareCropSuiteClimate,
  runCropSuite,
  suitabilityClass,
  type CropSuiteEvaluation,
  type CropSuiteFactor,
  type CropSuiteOptions,
  type CropSuiteParams,
  type CropSuiteRun,
  type PreparedClimate,
} from './cropsuite';
import { clamp, clamp01, quantile, round, trapezoid } from './math';

export { trapezoid } from './math';
export {
  cropSuiteParams,
  CROPSUITE,
  evaluateCropSuite,
  membership,
  multipleCropping,
  prepareCropSuiteClimate,
  quadMembership,
  runCropSuite,
  suitabilityClass,
  variabilitySuitability,
  variabilityThresholds,
  type CropSuiteParams,
  type MembershipFunction,
  type MultipleCropping,
  type SuitabilityClass,
} from './cropsuite';
export {
  adjustKcClimate,
  aggregateSuitability,
  AHP_PAIRWISE_MATRIX,
  AHP_SOLUTION,
  assimilateSatelliteCondition,
  asymmetricHeatFactor,
  borgGrimesRootDepth,
  cropCanopyHeightM,
  drainagePercolationMmDay,
  estimateRhMin,
  feddesAerationFactor,
  GRADED_FACTOR_KEYS,
  isHydrophyticCrop,
  maasHoffmanSalinity,
  monteithRadiationFactor,
  oldfieldFertilityIndex,
  scoreFertilityContinuous,
  solveAhpMatrix,
  type AggregationItem,
  type AhpSolution,
  type GradedFactorKey,
  type ParametricMethod,
} from './literature';

// ------------------------------------------------------------------------------------------------
// Constants (docs/SCORING.md & docs/SCORING_PAPER.md give the literature source of each)
// ------------------------------------------------------------------------------------------------

/**
 * How the static crop-site suitability is computed: one of the parametric operators of
 * `literature.ts` on the v2 factor scores, or the CropSuite fuzzy-logic model (`cropsuite.ts`).
 */
export type SuitabilityMethod = ParametricMethod | 'cropsuite';
/**
 * Method behind every score the app shows. Chosen on the benchmark of
 * `scripts/crops/evaluate-cropsuite.ts` (docs/SCORING.md section 9).
 */
export const DEFAULT_SUITABILITY_METHOD: SuitabilityMethod = 'astrovivu-v2';

/** Max-normalized Saaty AHP eigenvector exponents (CR = 0.0030 << 0.10); primary climate acts at 1.0. */
export const FACTOR_WEIGHTS = AHP_SOLUTION.exponents;
/** Sys, Van Ranst & Debaveye (1991) parametric ratings for categorical optimal / tolerated / unsuitable classes. */
const CLASS_SCORE = { opt: 1, abs: 0.7, out: 0.15 } as const;
const GATE = { zoneCurated: 0.5, zoneRaw: 0.7, photoperiodMin: 0.7, latitude: 0.7, altitude: 0.8 } as const;

/** The latitude gate: beyond `toleranceDeg` past the latitude limit EcoCrop gives for a crop, its compatibility is multiplied by `factor`. */
export interface LatitudeGate {
  toleranceDeg: number;
  factor: number;
}
/** The gate in use. Kept after the comparison of docs/SCORING.md, section 13. */
export const LATITUDE_GATE: LatitudeGate = { toleranceDeg: 3, factor: GATE.latitude };
/** Ramirez-Villegas et al. 2013: a month whose mean minimum is below Tkill + 4 °C contains a killing night. */
const KILL_MARGIN_C = 4;
/** A year counts as meeting the crop's needs when neither temperature nor water falls below this. */
export const RELIABILITY_THRESHOLD = 0.5;
/** Supplemental irrigation closes a deficit of at most this share of the crop's optimal season water. */
const SUPPLEMENTAL_SHARE = 0.3;
const FALLOW_KC = 0.4;
const OBSERVED_BLEND = 0.3;
/** Relative sensitivity of yield to water stress by FAO-56 stage (from FAO-33 per-period Ky, mid-season = 1). */
const STAGE_SENSITIVITY: Record<string, number> = { initial: 0.4, development: 0.7, 'mid-season': 1, 'late-season': 0.4 };
const AWC_BY_TEXTURE: Record<TextureClass, number> = { light: 0.1, medium: 0.16, heavy: 0.16, organic: 0.2 };
const CN_BY_TEXTURE: Record<TextureClass, number> = { light: 67, medium: 78, heavy: 85, organic: 78 };
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MID_DOY = [16, 45, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350];
const GENERIC_TEMP: Quad = [5, 15, 30, 40];

// ------------------------------------------------------------------------------------------------
// Astronomy and reference evapotranspiration (FAO-56 eq. 21-25, 34, 52)
// ------------------------------------------------------------------------------------------------

function sunsetAngle(latDeg: number, doy: number): { ws: number; decl: number; dr: number; phi: number } {
  const phi = (latDeg * Math.PI) / 180;
  const decl = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(decl), -1, 1));
  return { ws, decl, dr, phi };
}
export const dayLengthHours = (latDeg: number, doy: number): number => (24 / Math.PI) * sunsetAngle(latDeg, doy).ws;
/** Extraterrestrial radiation as evaporation equivalent, mm/day. */
function raMm(latDeg: number, doy: number): number {
  const { ws, decl, dr, phi } = sunsetAngle(latDeg, doy);
  const ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws));
  return 0.408 * ra;
}
/** Hargreaves ET0, mm/day: the FAO-56 fallback when only temperature is known. */
export const hargreaves = (tMean: number, tMax: number, tMin: number, latDeg: number, doy: number): number =>
  Math.max(0, 0.0023 * (tMean + 17.8) * Math.sqrt(Math.max(0, tMax - tMin)) * raMm(latDeg, doy));
/** USDA-SCS monthly effective rainfall as used by FAO CROPWAT. */
const effectiveRain = (p: number): number => (p <= 250 ? (p * (125 - 0.2 * p)) / 125 : 125 + 0.1 * p);

// ------------------------------------------------------------------------------------------------
// Site: soil and terrain facts, with ground truth on top
// ------------------------------------------------------------------------------------------------

interface Site {
  lat: number;
  elevationM: number | null;
  slopeDeg: number | null;
  ph: number | null;
  ecDsM: number | null;
  texture: TextureClass | null;
  drainage: 'poor' | 'well' | 'excessive' | null;
  depthCm: number | null;
  socGkg: number | null;
  cec: number | null;
  awc: number;
  groundKeys: Set<string>;
  calibration: CalibrationNote[];
}

function buildSite(input: ModelInput): Site {
  const { telemetry, groundTruth: gt, parcel } = input;
  const facts = [...(telemetry.branches.soil?.facts ?? []), ...(telemetry.branches.terrain?.facts ?? [])];
  const numFact = (key: string): number | null => {
    const v = facts.find((f) => f.key === key)?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const strFact = (key: string): string | null => {
    const v = facts.find((f) => f.key === key)?.value;
    return typeof v === 'string' && v ? v.toLowerCase() : null;
  };
  const groundKeys = new Set<string>();
  const calibration: CalibrationNote[] = [];
  const override = <T extends number | string>(key: string, label: I18nText, sat: T | null, ground: T | undefined): T | null => {
    if (ground == null) return sat;
    groundKeys.add(key);
    calibration.push({
      key,
      label,
      satellite: sat,
      ground,
      ...(typeof sat === 'number' && typeof ground === 'number' ? { delta: round(ground - sat, 2) } : {}),
      effect: tx(`The measured value replaces the estimate in every calculation.`, `Giá trị đo thay cho giá trị ước tính trong mọi phép tính.`),
    });
    return ground;
  };

  const clay = numFact('clay_pct');
  const sand = numFact('sand_pct');
  let soc = numFact('soc_gkg');
  const om = gt.organicMatterPct ?? numFact('om_pct');
  if (gt.organicMatterPct != null || soc == null) soc = om != null ? (om / 1.724) * 10 : soc;
  const texFact = strFact('texture_class');
  const texSat: TextureClass | null =
    texFact === 'heavy' || texFact === 'medium' || texFact === 'light' || texFact === 'organic'
      ? texFact
      : clay != null && sand != null
        ? clay >= 35
          ? 'heavy'
          : sand >= 52 && clay < 20
            ? 'light'
            : 'medium'
        : null;
  const dr = strFact('drainage_class');
  const drSat = dr == null ? null : dr.includes('poor') ? 'poor' : dr.includes('excess') ? 'excessive' : 'well';
  const drGround = gt.drainage ?? (gt.issues?.includes('waterlogging') ? 'poor' : undefined);
  const texture = override('texture', tx('Soil texture', 'Thành phần cơ giới'), texSat, gt.texture) as TextureClass | null;
  const awcFact = numFact('awc_cmcm');

  return {
    lat: parcel.centroid[1],
    elevationM: numFact('elevation_m') ?? parcel.elevationM ?? null,
    slopeDeg: numFact('slope_deg'),
    ph: override('ph', tx('Soil pH', 'pH đất'), numFact('ph'), gt.ph),
    ecDsM: override('salinity', tx('Salinity (EC)', 'Độ mặn (EC)'), numFact('ec_dsm'), gt.ecDsM ?? (gt.issues?.includes('salinity') ? 6 : undefined)),
    texture,
    drainage: override('drainage', tx('Drainage', 'Thoát nước'), drSat, drGround) as Site['drainage'],
    depthCm: override('depth', tx('Soil depth', 'Độ sâu tầng đất'), numFact('depth_cm'), gt.soilDepthCm),
    socGkg: soc,
    cec: numFact('cec_cmolkg'),
    awc: awcFact != null && awcFact > 0.02 && awcFact < 0.4 ? awcFact : texture ? AWC_BY_TEXTURE[texture] : 0.14,
    groundKeys,
    calibration,
  };
}

// ------------------------------------------------------------------------------------------------
// Climate: monthly history as one continuous sequence, climatology, Köppen-Trewartha zone
// ------------------------------------------------------------------------------------------------

interface Climate {
  years: number;
  /** Flat month sequences of length years * 12; NaN where missing. */
  rain: Float64Array;
  tMean: Float64Array;
  tMin: Float64Array;
  tMax: Float64Array;
  et0: Float64Array;
  /** 12-month means, used alone and to fill the months before the first year. */
  clim: { rain: number[]; tMean: number[]; tMin: number[]; tMax: number[]; et0: number[] };
  zones: string[];
}

interface Daily {
  n: number;
  start: string;
  doy: Int16Array;
  rain: Float64Array;
  et0: Float64Array;
  tMean: Float64Array;
  tMin: Float64Array;
  tMax: Float64Array;
  tMean7: Float64Array;
  tMax3: Float64Array;
  wind7: Float64Array;
  rhMin7: Float64Array;
  par7: Float64Array;
  ndviScore: Float64Array;
  esiScore: Float64Array;
  smRaw: Float64Array;
  smMean: Float64Array;
  smP10: Float64Array;
  smScore: Float64Array;
  lstScore: Float64Array;
  hasWater: boolean;
  hasTemp: boolean;
}

interface Prepared {
  climate: Climate | null;
  daily: Daily;
}
const prepared = new WeakMap<FieldTelemetry, Map<number, Prepared>>();

function buildClimate(t: FieldTelemetry, lat: number): Climate | null {
  const hist = t.climateHistory;
  if (!hist?.length) return null;
  const years = hist.length;
  const mk = () => new Float64Array(years * 12).fill(NaN);
  const c: Climate = { years, rain: mk(), tMean: mk(), tMin: mk(), tMax: mk(), et0: mk(), clim: { rain: [], tMean: [], tMin: [], tMax: [], et0: [] }, zones: [] };
  hist.forEach((y, yi) => {
    for (const m of y.months) {
      const i = yi * 12 + m.month - 1;
      if (m.month < 1 || m.month > 12) continue;
      c.rain[i] = m.rainMm ?? NaN;
      c.tMean[i] = m.tMean ?? (m.tMin != null && m.tMax != null ? (m.tMin + m.tMax) / 2 : NaN);
      c.tMin[i] = m.tMin ?? NaN;
      c.tMax[i] = m.tMax ?? NaN;
      const d = DAYS_IN_MONTH[m.month - 1];
      c.et0[i] = m.et0Mm ?? (m.tMean != null && m.tMin != null && m.tMax != null ? hargreaves(m.tMean, m.tMax, m.tMin, lat, MID_DOY[m.month - 1]) * d : NaN);
    }
  });
  const monthMean = (a: Float64Array, m: number) => {
    let s = 0;
    let n = 0;
    for (let y = 0; y < years; y++) {
      const v = a[y * 12 + m];
      if (!Number.isNaN(v)) (s += v), n++;
    }
    return n ? s / n : NaN;
  };
  for (let m = 0; m < 12; m++) {
    c.clim.rain.push(monthMean(c.rain, m));
    c.clim.tMean.push(monthMean(c.tMean, m));
    c.clim.tMin.push(monthMean(c.tMin, m));
    c.clim.tMax.push(monthMean(c.tMax, m));
    c.clim.et0.push(monthMean(c.et0, m));
  }
  c.zones = climateZones(c.clim.tMean, c.clim.rain, lat);
  return c;
}

/**
 * Köppen-Trewartha zone codes the site can be matched on (Belda et al. 2014, Table 1). A dry site
 * also returns its thermal zone, because dryness is already scored by the water factor.
 */
export function climateZones(tMean: number[], rain: number[], lat: number): string[] {
  if (tMean.some(Number.isNaN) || rain.some(Number.isNaN)) return [];
  const out: string[] = [];
  const annualP = rain.reduce((a, b) => a + b, 0);
  const annualT = tMean.reduce((a, b) => a + b, 0) / 12;
  const summer = lat >= 0 ? [3, 4, 5, 6, 7, 8] : [9, 10, 11, 0, 1, 2];
  const pSummer = summer.reduce((a, m) => a + rain[m], 0);
  const pWinter = annualP - pSummer;
  const dryness = 10 * (2.3 * annualT - 0.64 * (annualP > 0 ? (100 * pWinter) / annualP : 0) + 41); // mm
  if (annualP < dryness) out.push(annualP < dryness / 2 ? 'Bw' : 'Bs');
  const cold = Math.min(...tMean);
  const warmMonths = tMean.filter((t) => t > 10).length;
  const winterDry = pSummer >= 10 * pWinter;
  if (cold > 18) out.push(rain.filter((r) => r < 60).length > 2 ? 'Aw' : 'Ar');
  else if (warmMonths >= 8) {
    const driestSummer = Math.min(...summer.map((m) => rain[m]));
    out.push(pWinter >= 3 * pSummer && driestSummer < 30 && annualP < 890 ? 'Cs' : winterDry ? 'Cw' : 'Cf');
  } else if (warmMonths >= 4) out.push(cold > 0 ? 'Do' : 'Dc', winterDry ? 'Dw' : 'Df');
  else out.push(warmMonths >= 1 ? 'E' : 'F');
  return out;
}

function nearestBaseline(series: Series | undefined): { mean: Float64Array; p10: Float64Array; p90: Float64Array } | null {
  if (!series?.baseline?.length) return null;
  const mean = new Float64Array(367).fill(NaN);
  const p10 = new Float64Array(367).fill(NaN);
  const p90 = new Float64Array(367).fill(NaN);
  for (let d = 1; d <= 366; d++) {
    let best = series.baseline[0];
    for (const b of series.baseline) if (Math.abs(b.doy - d) < Math.abs(best.doy - d)) best = b;
    mean[d] = best.mean;
    p10[d] = best.p10;
    p90[d] = best.p90;
  }
  return { mean, p10, p90 };
}

function precomputeTrailing(src: Float64Array, windowLen: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const addV = src[i];
    if (!Number.isNaN(addV)) {
      sum += addV;
      cnt++;
    }
    const dropIdx = i - windowLen;
    if (dropIdx >= 0) {
      const remV = src[dropIdx];
      if (!Number.isNaN(remV)) {
        sum -= remV;
        cnt--;
      }
    }
    if (cnt > 0) out[i] = sum / cnt;
  }
  return out;
}

function buildDaily(t: FieldTelemetry, lat: number, climate: Climate | null): Daily {
  const start = t.window.start;
  const n = Math.max(1, diffDays(t.window.end, start) + 1);
  const arr = () => new Float64Array(n).fill(NaN);
  const d: Daily = {
    n,
    start,
    doy: new Int16Array(n),
    rain: arr(),
    et0: arr(),
    tMean: arr(),
    tMin: arr(),
    tMax: arr(),
    tMean7: arr(),
    tMax3: arr(),
    wind7: arr(),
    rhMin7: arr(),
    par7: arr(),
    ndviScore: arr(),
    esiScore: arr(),
    smRaw: arr(),
    smMean: arr(),
    smP10: arr(),
    smScore: arr(),
    lstScore: arr(),
    hasWater: false,
    hasTemp: false,
  };
  const doy0 = dayOfYear(start);
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  let doy = doy0;
  let year = Number(start.slice(0, 4));
  for (let i = 0; i < n; i++) {
    d.doy[i] = doy;
    if (++doy > (leap(year) ? 366 : 365)) (doy = 1), year++;
  }
  const put = (target: Float64Array, s: Series | undefined, hold: number, map: (v: number, i: number) => number = (v) => v) => {
    if (!s) return false;
    let any = false;
    for (const smp of s.samples) {
      if (smp.v == null || smp.t < start) continue;
      const i = diffDays(smp.t, start);
      if (i >= n) break;
      const startK = Math.max(0, i);
      for (let k = startK; k < Math.min(n, i + hold); k++) target[k] = map(smp.v, k);
      any = true;
    }
    return any;
  };
  const agromet = t.branches.agromet;
  const hasRain = put(d.rain, findSeries(t.branches.rainfall, 'rain'), 1);
  put(d.tMax, findSeries(agromet, 't2m_max'), 1);
  put(d.tMin, findSeries(agromet, 't2m_min'), 1);
  put(d.tMean, findSeries(agromet, 't2m'), 1);
  const hasEt0 = put(d.et0, findSeries(agromet, 'et0'), 1);
  const rhRaw = arr();
  const windRaw = arr();
  const parRaw = arr();
  put(rhRaw, findSeries(agromet, 'rh'), 1);
  put(windRaw, findSeries(agromet, 'wind'), 1);
  put(parRaw, findSeries(agromet, 'par'), 1);

  const month = (i: number) => {
    let m = 0;
    let rest = d.doy[i];
    while (m < 11 && rest > DAYS_IN_MONTH[m]) rest -= DAYS_IN_MONTH[m++];
    return m;
  };
  const rhMinDaily = arr();
  let tempDays = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(d.tMean[i]) && !Number.isNaN(d.tMax[i]) && !Number.isNaN(d.tMin[i])) d.tMean[i] = (d.tMax[i] + d.tMin[i]) / 2;
    if (!Number.isNaN(d.tMean[i])) tempDays++;
    // Missing days are filled, never zeroed: ET0 from Hargreaves, then both from the climatology.
    if (Number.isNaN(d.et0[i]) && !Number.isNaN(d.tMax[i]) && !Number.isNaN(d.tMin[i])) d.et0[i] = hargreaves(d.tMean[i], d.tMax[i], d.tMin[i], lat, d.doy[i]);
    const m = month(i);
    if (Number.isNaN(d.et0[i]) && climate) d.et0[i] = climate.clim.et0[m] / DAYS_IN_MONTH[m];
    if (Number.isNaN(d.rain[i]) && climate && hasRain) d.rain[i] = climate.clim.rain[m] / DAYS_IN_MONTH[m];
    if (!Number.isNaN(rhRaw[i])) rhMinDaily[i] = estimateRhMin(rhRaw[i], d.tMin[i], d.tMax[i]);
  }
  d.tMean7 = precomputeTrailing(d.tMean, 7);
  d.tMax3 = precomputeTrailing(d.tMax, 3);
  d.wind7 = precomputeTrailing(windRaw, 7);
  d.rhMin7 = precomputeTrailing(rhMinDaily, 7);
  d.par7 = precomputeTrailing(parRaw, 7);

  d.hasTemp = tempDays > n / 2;
  d.hasWater = hasRain && (hasEt0 || d.hasTemp || climate != null) && !d.et0.some(Number.isNaN) && !d.rain.some(Number.isNaN);

  // Vegetation, evaporative stress, root-zone soil moisture and canopy LST enter as departures
  // from each pixel's own DOY climatology (rule S3; Anderson et al. 2011; Ines et al. 2013).
  const ndvi = findSeries(t.branches.vegetation, 'ndvi');
  const ndviBase = nearestBaseline(ndvi);
  if (ndviBase)
    put(d.ndviScore, ndvi, 24, (v, i) => {
      const mean = ndviBase.mean[d.doy[i]];
      const p10 = ndviBase.p10[d.doy[i]];
      return v >= mean || !(mean > p10) ? 1 : clamp01(0.5 + (0.5 * (v - p10)) / (mean - p10));
    });
  put(d.esiScore, findSeries(t.branches.thermal, 'esi'), 10, (v) => clamp01((v + 3) / 2.5));

  const sm = findSeries(t.branches.soilMoisture, 'sm_root');
  const smBase = nearestBaseline(sm) ?? nearestBaseline(findSeries(t.branches.soilMoisture, 'sm_root_era5'));
  if (sm && smBase) {
    put(d.smRaw, sm, 3);
    for (let i = 0; i < n; i++) {
      const mean = smBase.mean[d.doy[i]];
      const p10 = smBase.p10[d.doy[i]];
      d.smMean[i] = mean;
      d.smP10[i] = p10;
      const v = d.smRaw[i];
      if (!Number.isNaN(v) && !Number.isNaN(mean)) {
        d.smScore[i] = v >= mean || !(mean > p10) ? 1 : clamp01(0.5 + (0.5 * (v - p10)) / (mean - p10));
      }
    }
  }

  const lst = findSeries(t.branches.thermal, 'lst_day');
  const lstBase = nearestBaseline(lst);
  if (lst && lstBase) {
    put(d.lstScore, lst, 12, (v, i) => {
      const mean = lstBase.mean[d.doy[i]];
      const p90 = lstBase.p90[d.doy[i]];
      if (Number.isNaN(mean) || v <= mean || !(p90 > mean)) return 1;
      return clamp01(1 - (0.5 * (v - mean)) / Math.max(1.5, p90 - mean));
    });
  }
  return d;
}

function prepare(input: ModelInput): Prepared {
  const lat = input.parcel.centroid[1];
  let byLat = prepared.get(input.telemetry);
  if (!byLat) prepared.set(input.telemetry, (byLat = new Map()));
  let p = byLat.get(lat);
  if (!p) {
    const climate = buildClimate(input.telemetry, lat);
    byLat.set(lat, (p = { climate, daily: buildDaily(input.telemetry, lat, climate) }));
  }
  return p;
}

// ------------------------------------------------------------------------------------------------
// Compatibility
// ------------------------------------------------------------------------------------------------

/** Months of the growing window: the mean cycle in months (Hijmans: average of GMIN and GMAX). */
export const windowMonths = (crop: CropProfile): number => clamp(Math.round((crop.cycleDays[0] + crop.cycleDays[1]) / 2 / 30.4), 1, 12);
const cycleLength = (crop: CropProfile): number => clamp(Math.round((crop.cycleDays[0] + crop.cycleDays[1]) / 2), 20, 365);

interface SeasonFit {
  temp: number | null;
  tempAt: number | null;
  water: number | null;
  rainMm: number | null;
  supplyMm: number | null;
  storedMm: number;
  kill: number | null;
  /** Survival of the months outside the window (perennials): null when not checked. */
  restKill: number | null;
  photo: number | null;
  quad: Quad;
  /** Seasonal thermal units (Growing Degree Days above T_absMin, °C·d). */
  gdd: number | null;
}

/**
 * EcoCrop fit of one season starting at sequence index `start` (0 = January of the first year;
 * negative or climatology indices wrap onto the 12-month means).
 */
function seasonFit(crop: CropProfile, c: Climate, start: number, useClim: boolean, site: Site, irrigation: GroundTruth['irrigation']): SeasonFit {
  const n = windowMonths(crop);
  const at = (a: Float64Array, cl: number[], i: number) => (useClim || i < 0 ? cl[((i % 12) + 12) % 12] : a[i]);
  const scale = Math.min(1, n / 4);
  const quad = crop.req.rainMm.map((v) => v * scale) as Quad;
  let temp: number | null = null;
  let tempAt: number | null = null;
  let rain = 0;
  let rainOk = true;
  let kill: number | null = null;
  let photoHits = 0;
  let gdd = 0;
  let gddOk = false;
  const classes = crop.req.photoperiod;
  for (let k = 0; k < n; k++) {
    const i = start + k;
    const mIdx = ((i % 12) + 12) % 12;
    const tm = at(c.tMean, c.clim.tMean, i);
    if (!Number.isNaN(tm)) {
      const s = trapezoid(tm, crop.req.tempC);
      if (temp == null || s < temp) (temp = s), (tempAt = tm);
      gdd += Math.max(0, tm - crop.req.tempC[0]) * DAYS_IN_MONTH[mIdx];
      gddOk = true;
    }
    const r = at(c.rain, c.clim.rain, i);
    if (Number.isNaN(r)) rainOk = false;
    else rain += r;
    const tn = at(c.tMin, c.clim.tMin, i);
    if (crop.req.killTempC != null && !Number.isNaN(tn)) kill = Math.min(kill ?? 1, tn < crop.req.killTempC + KILL_MARGIN_C ? 0 : 1);
    if (classes?.length) {
      const h = dayLengthHours(site.lat, MID_DOY[mIdx]);
      if (classes.includes(h < 12 ? 'short' : h <= 14 ? 'neutral' : 'long')) photoHits++;
    }
  }
  // A perennial also has to survive the months outside its growing window. Only the rest-period
  // killing temperature applies there: a dormant, hardened stand is not killed by a growing-season frost.
  let restKill: number | null = null;
  if (crop.lifeSpan === 'perennial') {
    const restT = crop.req.killTempRestC;
    if (restT != null)
      for (let k = n; k < 12; k++) {
        const tn = at(c.tMin, c.clim.tMin, start + k);
        if (!Number.isNaN(tn)) restKill = Math.min(restKill ?? 1, tn < restT + KILL_MARGIN_C ? 0 : 1);
      }
  }
  // Water supply = rain in the window + water a fallow soil stored before sowing (annuals only).
  let stored = 0;
  if (crop.lifeSpan !== 'perennial') {
    const taw = 1000 * site.awc * (crop.water?.rootDepthM ?? 0.9);
    for (let k = 6; k >= 1; k--) {
      const r = at(c.rain, c.clim.rain, start - k);
      const e = at(c.et0, c.clim.et0, start - k);
      if (Number.isNaN(r) || Number.isNaN(e)) continue;
      stored = clamp(stored + effectiveRain(r) - FALLOW_KC * e, 0, taw);
    }
  }
  let water: number | null = null;
  let supply: number | null = null;
  if (rainOk) {
    supply = rain + stored;
    if (irrigation === 'supplemental' && supply < quad[1]) supply += Math.min(quad[1] - supply, SUPPLEMENTAL_SHARE * quad[1]);
    // Irrigation removes a deficit, never an excess.
    water = irrigation === 'full' && supply < quad[1] ? 1 : trapezoid(supply, quad);
  }
  return {
    temp,
    tempAt,
    water,
    rainMm: rainOk ? rain : null,
    supplyMm: supply,
    storedMm: stored,
    kill,
    restKill,
    photo: classes?.length && classes.length < 3 ? GATE.photoperiodMin + (1 - GATE.photoperiodMin) * (photoHits / n) : null,
    quad,
    gdd: gddOk ? Math.round(gdd) : null,
  };
}

/**
 * Active season of a perennial: the months whose mean temperature is above the crop's absolute
 * minimum (growth possible). Null for annuals and for sites where every month is active (evergreen),
 * so those keep the plain window logic.
 */
export function activeSeason(crop: CropProfile, tMean: number[]): { active: boolean[]; months: number } | null {
  if (crop.lifeSpan !== 'perennial' || tMean.length !== 12 || tMean.some(Number.isNaN)) return null;
  const active = tMean.map((t) => t > crop.req.tempC[0]);
  const months = active.filter(Boolean).length;
  return months >= 12 ? null : { active, months };
}

const ORDER = { depth: ['very-shallow', 'shallow', 'medium', 'deep'] } as const;

interface Fit {
  score: number;
  factors: FactorScore[];
  limiting: FactorScore | null;
  season: SeasonFit | null;
  month: number;
  review: boolean;
}

function fmt(q: Quad, digits = 0): string {
  return `${round(q[1], digits)}-${round(q[2], digits)}`;
}

/** Static crop-site fit for a sowing month (1-12): graded factors, gates, parametric combination and limiting factor. */
function fitFor(
  crop: CropProfile,
  site: Site,
  climate: Climate | null,
  month: number,
  irrigation: GroundTruth['irrigation'],
  src: { soil?: string; climate?: string; terrain?: string },
  method: ParametricMethod = 'astrovivu-v2',
  latitudeGate: LatitudeGate | null = LATITUDE_GATE,
): Fit {
  const factors: FactorScore[] = [];
  const aggItems: AggregationItem[] = [];
  const add = (
    key: string,
    label: I18nText,
    score: number | null,
    weight: number,
    actual: number | string | null,
    ideal: string,
    kind: FactorKind,
    branch: BranchId,
    isGate: boolean,
    unit?: string,
    note?: I18nText,
  ) => {
    const ground = site.groundKeys.has(key);
    const rounded = score == null ? null : round(score, 3);
    factors.push({
      key,
      label,
      score: rounded,
      weight: round(weight, 3),
      actual,
      ideal,
      kind,
      branch,
      ...(unit ? { unit } : {}),
      sourceId: ground ? 'ground-truth' : branch === 'soil' ? src.soil : branch === 'terrain' ? src.terrain : src.climate,
      ...(note ? { note } : {}),
    });
    aggItems.push({ key, score: rounded, weight, isGate });
  };
  const w = FACTOR_WEIGHTS;
  const req = crop.req;
  const missing = tx('No data: skipped, not scored as zero.', 'Thiếu dữ liệu: bỏ qua, không tính là 0.');
  const season = climate ? seasonFit(crop, climate, month - 1, true, site, irrigation) : null;
  const n = windowMonths(crop);

  const dorm = climate ? activeSeason(crop, climate.clim.tMean) : null;
  add(
    'temperature',
    tx('Temperature in the growing window', 'Nhiệt độ trong vụ'),
    season?.temp ?? null,
    w.temperature,
    season?.tempAt != null ? round(season.tempAt, 1) : null,
    fmt(req.tempC),
    'fixed',
    'agromet',
    false,
    '°C',
    season?.temp == null
      ? missing
      : dorm
        ? tx(`Worst month of the ${n}-month growth window inside the active season; dormant months are judged on survival only.`, `Tháng bất lợi nhất trong ${n} tháng sinh trưởng của mùa hoạt động; tháng cây nghỉ chỉ xét khả năng sống sót.`)
        : tx(`Worst month of the ${n}-month window.`, `Tháng bất lợi nhất trong ${n} tháng của vụ.`),
  );
  const waterNote =
    season?.water == null
      ? missing
      : irrigation === 'full' && season.supplyMm != null && season.supplyMm < season.quad[1]
        ? tx(`Rain and stored soil water supply ${Math.round(season.supplyMm)} mm; irrigation covers the rest.`, `Mưa và ẩm trữ trong đất cung cấp ${Math.round(season.supplyMm)} mm; tưới bù phần còn lại.`)
        : tx(`Rain in the window ${Math.round(season.rainMm ?? 0)} mm + stored soil water ${Math.round(season.storedMm)} mm.`, `Mưa trong vụ ${Math.round(season.rainMm ?? 0)} mm + ẩm trữ trong đất ${Math.round(season.storedMm)} mm.`);
  add('water', tx('Water over the growing window', 'Nước trong vụ'), season?.water ?? null, w.water, season?.supplyMm != null ? Math.round(season.supplyMm) : null, fmt(season?.quad ?? req.rainMm), 'manageable', 'rainfall', false, 'mm', waterNote);

  const phMissing = crop.flags?.includes('ph-missing');
  add('ph', tx('Soil pH', 'pH đất'), site.ph != null && !phMissing ? trapezoid(site.ph, req.ph) : null, w.ph, site.ph, phMissing ? '?' : fmt(req.ph, 1), 'manageable', 'soil', false, undefined, site.ph == null || phMissing ? missing : undefined);
  const cls = <T extends string>(have: T | null, need: { opt: readonly T[]; abs: readonly T[] } | undefined) => (have == null || !need ? null : need.opt.includes(have) ? CLASS_SCORE.opt : need.abs.includes(have) ? CLASS_SCORE.abs : CLASS_SCORE.out);
  add('texture', tx('Soil texture', 'Thành phần cơ giới'), cls(site.texture, req.texture), w.texture, site.texture, req.texture?.opt.join(', ') ?? '?', 'fixed', 'soil', false, undefined, cls(site.texture, req.texture) == null ? missing : undefined);
  add('drainage', tx('Drainage', 'Thoát nước'), cls(site.drainage, req.drainage), w.drainage, site.drainage, req.drainage?.opt.join(', ') ?? '?', 'manageable', 'soil', false, undefined, cls(site.drainage, req.drainage) == null ? missing : undefined);

  const rank = <T extends string>(order: readonly T[], have: T | null, need: { opt: T; abs: T } | undefined, higherIsBetter: boolean) => {
    if (have == null || !need) return null;
    const [h, o, a] = [order.indexOf(have), order.indexOf(need.opt), order.indexOf(need.abs)];
    const ok = (x: number) => (higherIsBetter ? h >= x : h <= x);
    return ok(o) ? CLASS_SCORE.opt : ok(a) ? CLASS_SCORE.abs : CLASS_SCORE.out;
  };
  const depthClass = site.depthCm == null ? null : site.depthCm < 20 ? 'very-shallow' : site.depthCm < 50 ? 'shallow' : site.depthCm <= 150 ? 'medium' : 'deep';
  add('depth', tx('Soil depth', 'Độ sâu tầng đất'), rank(ORDER.depth, depthClass, req.depth, true), w.depth, site.depthCm, req.depth?.opt ?? '?', 'fixed', 'soil', false, 'cm', depthClass == null ? missing : undefined);

  // Continuous Maas-Hoffman (1977) threshold-slope salinity response (FAO-56 Table 23).
  const salScore = maasHoffmanSalinity(site.ecDsM, req.salinity);
  add('salinity', tx('Salinity', 'Độ mặn'), salScore, w.salinity, site.ecDsM, req.salinity?.opt ?? '?', 'manageable', 'soil', false, 'dS/m', salScore == null ? missing : undefined);

  // Continuous Oldfield et al. (2019) & Sanchez et al. (2003) Michaelis-Menten SOC/CEC fertility curve.
  const fertIdx = oldfieldFertilityIndex(site.socGkg, site.cec);
  const fertClass = fertIdx == null ? null : fertIdx < 0.35 ? 'low' : fertIdx < 0.68 ? 'moderate' : 'high';
  const fertScore = scoreFertilityContinuous(fertIdx, req.fertility);
  add('fertility', tx('Soil fertility (organic carbon, CEC)', 'Độ phì (carbon hữu cơ, CEC)'), fertScore, w.fertility, fertClass, req.fertility?.opt ?? '?', 'manageable', 'soil', false, undefined, fertScore == null ? missing : undefined);

  const flat = crop.lifeSpan === 'perennial' ? 9 : 4.6; // 16 % and 8 % slope (GAEZ v4 terrain classes)
  const steep = crop.lifeSpan === 'perennial' ? 24 : 16.7; // 45 % and 30 %
  add('slope', tx('Slope', 'Độ dốc'), site.slopeDeg == null ? null : site.slopeDeg <= flat ? 1 : Math.max(0.15, 1 - (0.85 * (site.slopeDeg - flat)) / (steep - flat)), w.slope, site.slopeDeg, `<= ${flat}`, 'fixed', 'terrain', false, '°', site.slopeDeg == null ? missing : undefined);

  // Non-compensatory bioclimatic & geographical gates outside the graded parametric product.
  const reviewNote = tx('Outside what the crop database records for this crop: needs local review.', 'Nằm ngoài phạm vi cơ sở dữ liệu ghi nhận cho cây này: cần chuyên gia địa phương xem xét.');
  const dormancy = climate ? activeSeason(crop, climate.clim.tMean) : null;
  if (!dormancy && season && season.restKill != null) season.kill = Math.min(season.kill ?? 1, season.restKill);
  if (dormancy) {
    const restT = req.killTempRestC;
    add(
      'winterSurvival',
      tx('Winter survival (dormant season)', 'Sống sót qua mùa nghỉ'),
      season?.restKill ?? null,
      1,
      null,
      restT != null ? `> ${restT + KILL_MARGIN_C} °C` : '?',
      'fixed',
      'agromet',
      true,
      undefined,
      restT == null
        ? tx('Winter survival not checked: the crop database records no killing temperature for the rest period.', 'Chưa kiểm tra khả năng sống qua mùa nghỉ: cơ sở dữ liệu không ghi nhiệt độ gây chết khi cây nghỉ.')
        : season?.restKill === 0
          ? tx('Winter nights are cold enough to kill the dormant stand.', 'Đêm mùa đông đủ lạnh để làm chết cây đang nghỉ.')
          : tx(`Dormant for ${12 - dormancy.months} months; winter nights stay above the rest-period killing temperature.`, `Nghỉ ${12 - dormancy.months} tháng; đêm mùa đông vẫn trên ngưỡng nhiệt gây chết khi cây nghỉ.`),
    );
    add(
      'activeSeason',
      tx('Length of the active season', 'Độ dài mùa sinh trưởng'),
      dormancy.months >= n ? 1 : dormancy.months / n,
      1,
      dormancy.months,
      `>= ${n}`,
      'fixed',
      'agromet',
      true,
      'months',
      tx(`${dormancy.months} months warm enough for growth (mean above ${req.tempC[0]} °C); the crop needs ${n}.`, `${dormancy.months} tháng đủ ấm để sinh trưởng (trung bình trên ${req.tempC[0]} °C); cây cần ${n}.`),
    );
  }
  if (season?.kill != null) add('frost', tx('Killing temperature', 'Nhiệt độ gây chết'), season.kill, 1, null, `> ${(req.killTempC ?? 0) + KILL_MARGIN_C} °C`, 'fixed', 'agromet', true, undefined, season.kill === 0 ? tx('A month of the season has nights cold enough to kill the crop.', 'Có tháng trong vụ đêm lạnh đến mức làm chết cây.') : undefined);
  if (climate?.zones.length && req.climateZones?.length) {
    const ok = climate.zones.some((z) => req.climateZones!.includes(z));
    add('climateZone', tx('Climate zone', 'Vùng khí hậu'), ok ? 1 : crop.curated ? GATE.zoneCurated : GATE.zoneRaw, 1, climate.zones.join('/'), req.climateZones.join(' '), 'fixed', 'agromet', true, undefined, ok ? undefined : reviewNote);
  }
  if (season?.photo != null) add('photoperiod', tx('Day length', 'Độ dài ngày'), season.photo, 1, null, req.photoperiod!.join(', '), 'choice', 'agromet', true, undefined, season.photo < 1 ? reviewNote : undefined);
  if (req.latitudeAbs) {
    const limit = site.lat >= 0 ? req.latitudeAbs[1] : req.latitudeAbs[0];
    if (latitudeGate && Math.abs(site.lat) > limit + latitudeGate.toleranceDeg) add('latitude', tx('Latitude', 'Vĩ độ'), latitudeGate.factor, 1, round(site.lat, 1), `<= ${limit}°`, 'fixed', 'terrain', true, '°', reviewNote);
  }
  if (req.altitudeMaxM != null && site.elevationM != null && site.elevationM > req.altitudeMaxM * 1.1) add('altitude', tx('Altitude', 'Độ cao'), GATE.altitude, 1, site.elevationM, `<= ${req.altitudeMaxM}`, 'fixed', 'terrain', true, 'm', reviewNote);

  const { score, limitingIndex } = aggregateSuitability(aggItems, method);
  const limiting = limitingIndex >= 0 ? factors[limitingIndex] : null;
  return { score, factors, limiting, season, month, review: !crop.curated || factors.some((f) => f.note === reviewNote) };
}

interface YearStats {
  yearsOk: number;
  yearsTotal: number;
  scores: number[];
}
/** Multi-year agro-climatic reliability & annual climate scores across the 20-year ERA5 history. */
function yearStats(crop: CropProfile, site: Site, c: Climate, month: number, irrigation: GroundTruth['irrigation']): YearStats {
  const n = windowMonths(crop);
  const scores: number[] = [];
  for (let y = 0; y < c.years; y++) {
    const start = y * 12 + month - 1;
    if (start + Math.max(n, crop.lifeSpan === 'perennial' ? 12 : n) > c.years * 12) break;
    const s = seasonFit(crop, c, start, false, site, irrigation);
    if (s.temp == null || s.water == null) continue;
    scores.push(Math.min(s.temp, s.water, s.kill ?? 1, s.restKill ?? 1));
  }
  return { yearsOk: scores.filter((s) => s >= RELIABILITY_THRESHOLD).length, yearsTotal: scores.length, scores };
}

// ------------------------------------------------------------------------------------------------
// CropSuite (Zabel et al. 2025): the same parcel and crop read through cropsuite.ts
// ------------------------------------------------------------------------------------------------

const cropSuiteClimates = new WeakMap<Climate, Map<number, PreparedClimate | null>>();
function cropSuiteClimate(climate: Climate, lat: number): PreparedClimate | null {
  let byLat = cropSuiteClimates.get(climate);
  if (!byLat) cropSuiteClimates.set(climate, (byLat = new Map()));
  if (!byLat.has(lat)) byLat.set(lat, prepareCropSuiteClimate({ years: climate.years, rain: climate.rain, tMean: climate.tMean, tMin: climate.tMin }, lat));
  return byLat.get(lat) ?? null;
}

const MONTH_FIRST_DOY = DAYS_IN_MONTH.reduce<number[]>((acc, d, i) => (acc.push(i ? acc[i - 1] + DAYS_IN_MONTH[i - 1] : 1), acc), []);
const monthOfDoy = (doy: number): number => {
  let m = 11;
  while (MONTH_FIRST_DOY[m] > doy) m--;
  return m + 1;
};

const CS_TEXT: Record<CropSuiteFactor['key'], { label: I18nText; kind: FactorKind; branch: BranchId; unit?: string }> = {
  temperature: { label: tx('Mean temperature over the growing cycle', 'Nhiệt độ trung bình cả vụ'), kind: 'fixed', branch: 'agromet', unit: '°C' },
  water: { label: tx('Precipitation over the growing cycle', 'Lượng mưa cả vụ'), kind: 'manageable', branch: 'rainfall', unit: 'mm' },
  variability: { label: tx('Climate variability: years with potential crop failure', 'Biến động khí hậu: số năm có nguy cơ mất mùa'), kind: 'fixed', branch: 'agromet', unit: '%' },
  permafrost: { label: tx('Permafrost', 'Băng vĩnh cửu'), kind: 'fixed', branch: 'agromet', unit: '°C' },
  heat: { label: tx('Lethal heat over the cycle', 'Nóng gây chết trong vụ'), kind: 'fixed', branch: 'agromet', unit: '°C' },
  frost: { label: tx('Killing temperature', 'Nhiệt độ gây chết'), kind: 'fixed', branch: 'agromet', unit: '°C' },
  photoperiod: { label: tx('Day length over the cycle', 'Độ dài ngày trong vụ'), kind: 'choice', branch: 'agromet', unit: 'h' },
  vernalization: { label: tx('Vernalization days', 'Số ngày xuân hoá'), kind: 'fixed', branch: 'agromet', unit: 'd' },
  germination: { label: tx('Germination conditions', 'Điều kiện nảy mầm'), kind: 'choice', branch: 'agromet', unit: '°C' },
  drySpell: { label: tx('Longest dry spell in the cycle', 'Đợt khô dài nhất trong vụ'), kind: 'manageable', branch: 'rainfall', unit: 'd' },
  ph: { label: tx('Soil pH', 'pH đất'), kind: 'manageable', branch: 'soil' },
  texture: { label: tx('Soil texture', 'Thành phần cơ giới'), kind: 'fixed', branch: 'soil' },
  drainage: { label: tx('Drainage', 'Thoát nước'), kind: 'manageable', branch: 'soil' },
  depth: { label: tx('Soil depth', 'Độ sâu tầng đất'), kind: 'fixed', branch: 'soil', unit: 'cm' },
  salinity: { label: tx('Salinity', 'Độ mặn'), kind: 'manageable', branch: 'soil', unit: 'dS/m' },
  fertility: { label: tx('Soil fertility (organic carbon, CEC)', 'Độ phì (carbon hữu cơ, CEC)'), kind: 'manageable', branch: 'soil' },
  slope: { label: tx('Slope', 'Độ dốc'), kind: 'fixed', branch: 'terrain', unit: '°' },
};

function cropSuiteIdeal(key: CropSuiteFactor['key'], crop: CropProfile, p: CropSuiteParams): string {
  const req = crop.req;
  switch (key) {
    case 'temperature':
      return fmt(req.tempC);
    case 'water':
      return `${Math.round(p.precipitation.x[1])}-${Math.round(p.precipitation.x[2])}`;
    case 'variability':
      return `< ${100 * CROPSUITE.failureRateLimit}`;
    case 'permafrost':
      return `>= ${CROPSUITE.permafrostMeanTempC}`;
    case 'heat':
      return `<= ${CROPSUITE.maxCycleMeanTempC}`;
    case 'frost':
      return `>= ${p.lethalMinC}`;
    case 'photoperiod':
      return p.dayLengthH ? `${p.dayLengthH[0]}-${p.dayLengthH[1]}` : '?';
    case 'vernalization':
      return p.vernalization ? `>= ${p.vernalization.days}` : '?';
    case 'germination':
      return p.germination?.minTempC != null ? `>= ${p.germination.minTempC}` : '?';
    case 'drySpell':
      return p.maxDryDays != null ? `<= ${p.maxDryDays}` : '?';
    case 'ph':
      return p.ph ? fmt(req.ph, 1) : '?';
    case 'texture':
      return req.texture?.opt.join(', ') ?? '?';
    case 'drainage':
      return req.drainage?.opt.join(', ') ?? '?';
    case 'depth':
      return req.depth?.opt ?? '?';
    case 'salinity':
      return req.salinity?.opt ?? '?';
    case 'fertility':
      return req.fertility?.opt ?? '?';
    case 'slope':
      return `<= ${p.slope.x[0]}`;
  }
}

/** CropSuite factors as the app's FactorScore rows. Lethal limits are listed only when they bite or carry information. */
function cropSuiteFactorScores(crop: CropProfile, site: Site, run: CropSuiteRun, ev: CropSuiteEvaluation, src: { soil?: string; climate?: string; terrain?: string }): FactorScore[] {
  const missing = tx('No data: skipped, not scored as zero.', 'Thiếu dữ liệu: bỏ qua, không tính là 0.');
  const out: FactorScore[] = [];
  for (const f of ev.factors) {
    if (f.limit && (f.suitability == null || ((f.key === 'permafrost' || f.key === 'heat') && f.suitability > 0))) continue;
    const t = CS_TEXT[f.key];
    const ground = site.groundKeys.has(f.key);
    let actual: number | string | null = typeof f.value === 'number' ? round(f.value, f.key === 'water' || f.key === 'depth' ? 0 : f.key === 'fertility' ? 2 : 1) : f.value;
    let note: I18nText | undefined;
    if (f.key === 'variability') {
      actual = f.value == null ? null : Math.round(100 * (f.value as number));
      note = ev.failureRate == null
        ? tx('Too few years of climate history for a recurrence rate.', 'Chuỗi khí hậu quá ngắn để tính tần suất.')
        : tx(`Temperature or precipitation left the crop's tolerable band in ${ev.yearsFailed} of ${ev.yearsAnalysed} years.`, `Nhiệt độ hoặc lượng mưa vượt khỏi dải chịu được của cây trong ${ev.yearsFailed}/${ev.yearsAnalysed} năm.`);
    } else if (f.key === 'water' && run.options.irrigation === 'full') {
      note = tx('Irrigated: precipitation is not a constraint; only its excess counts, through climate variability.', 'Có tưới: lượng mưa không phải yếu tố hạn chế; chỉ mưa quá nhiều mới tính, qua biến động khí hậu.');
    } else if (f.suitability == null) note = missing;
    out.push({
      key: f.key,
      label: t.label,
      score: f.suitability == null ? null : round(f.suitability / 100, 3),
      weight: 1,
      actual,
      ideal: cropSuiteIdeal(f.key, crop, run.params),
      kind: t.kind,
      branch: t.branch,
      ...(t.unit ? { unit: t.unit } : {}),
      sourceId: ground ? 'ground-truth' : t.branch === 'soil' ? src.soil : t.branch === 'terrain' ? src.terrain : src.climate,
      ...(note ? { note } : {}),
    });
  }
  return out;
}

/** The CropSuite model behind the `assess` contract: null when the parcel has no usable climate history. */
function assessWithCropSuite(crop: CropProfile, input: ModelInput, site: Site, climate: Climate | null, irrigation: NonNullable<GroundTruth['irrigation']>, opts: AssessOptions): (CropAssessment & { fits: Fit[]; stats: (YearStats | null)[] }) | null {
  const clim = climate ? cropSuiteClimate(climate, site.lat) : null;
  if (!clim) return null;
  const params = cropSuiteParams(crop);
  const csSite = { ph: site.ph, ecDsM: site.ecDsM, texture: site.texture, drainage: site.drainage, depthCm: site.depthCm, fertilityIndex: oldfieldFertilityIndex(site.socGkg, site.cec), slopeDeg: site.slopeDeg };
  const run = runCropSuite(params, csSite, clim, { irrigation, ...opts.cropSuite });
  const src = sources(input.telemetry);
  const review = !crop.curated;
  const fitAt = (doy: number, month: number): { fit: Fit; ev: ReturnType<typeof evaluateCropSuite> } => {
    const ev = evaluateCropSuite(run, clim, doy);
    const factors = cropSuiteFactorScores(crop, site, run, ev, src);
    return { fit: { score: round(ev.cropSuitability / 100, 3), factors, limiting: ev.limiting ? (factors.find((f) => f.key === ev.limiting!.key) ?? null) : null, season: null, month, review }, ev };
  };
  // One fit per calendar month, at that month's best sowing day (the sowing-window scan is monthly).
  const monthly = Array.from({ length: 12 }, (_, i) => {
    let doy = MONTH_FIRST_DOY[i];
    for (let d = doy; d < MONTH_FIRST_DOY[i] + DAYS_IN_MONTH[i]; d++) if (run.climate[d - 1] > run.climate[doy - 1]) doy = d;
    return fitAt(doy, i + 1);
  });
  const best = fitAt(run.optimalSowingDoy, monthOfDoy(run.optimalSowingDoy));
  const gtDate = input.groundTruth.sowingDate && !params.perennial ? input.groundTruth.sowingDate : undefined;
  const used = opts.sowingMonth != null ? monthly[opts.sowingMonth - 1] : gtDate ? fitAt(dayOfYear(gtDate), Number(gtDate.slice(5, 7))) : best;
  const mc = params.perennial || opts.multipleCropping === false ? null : multipleCropping(run.climate, params.cycleDays);
  const rel = (ev: CropSuiteEvaluation) => (ev.failureRate == null ? null : { yearsOk: ev.yearsAnalysed - ev.yearsFailed, yearsTotal: ev.yearsAnalysed });
  const ev = used.ev;
  const limitation: Record<string, number> = {};
  for (const f of ev.factors) if (f.suitability != null) limitation[f.key] = Math.round(100 - f.suitability);
  return {
    cropId: crop.id,
    compatibility: used.fit.score,
    sowingMonth: used.fit.month,
    sowingAssumed: opts.sowingMonth == null && gtDate == null,
    bestSowingMonth: best.fit.month,
    bestCompatibility: best.fit.score,
    windowMonths: windowMonths(crop),
    factors: used.fit.factors,
    limiting: used.fit.limiting,
    reliability: rel(ev),
    yearScores: ev.yearScores,
    waterSupplyMm: Math.round(ev.cycleWaterMm),
    waterNeedMm: Math.round(params.precipitation.x[1]),
    seasonalGdd: null,
    needsLocalReview: review,
    cropSuite: {
      climateSuitability: Math.round(ev.climateSuitability),
      soilSuitability: ev.soilSuitability == null ? null : Math.round(ev.soilSuitability),
      cropSuitability: Math.round(ev.cropSuitability),
      class: suitabilityClass(Math.round(ev.cropSuitability)),
      perennial: params.perennial,
      sowingDoy: ev.sowingDoy,
      optimalSowingDoy: run.optimalSowingDoy,
      suitableSowingDays: run.suitableSowingDays,
      failureRate: ev.failureRate == null ? null : round(ev.failureRate, 3),
      harvestsPerYear: mc ? mc.harvests : best.ev.climateSuitability > 0 ? 1 : 0,
      // One harvest: the optimal day, which sits mid-window; several: the combination with the highest summed suitability.
      sowingDoys: mc && mc.harvests > 1 ? mc.sowingDoys : best.ev.climateSuitability > 0 ? [run.optimalSowingDoy] : [],
      limiting: ev.limiting?.key ?? null,
      limitation,
    },
    fits: monthly.map((m) => m.fit),
    stats: monthly.map((m) => {
      const r = rel(m.ev);
      return r ? { ...r, scores: m.ev.yearScores } : null;
    }),
  };
}

/**
 * CropSuite assessment of any crop on the locked parcel, whatever the default method is: climate,
 * soil and crop suitability, optimal sowing day, multiple-cropping potential and limiting factor.
 */
export function assessCropSuite(input: ModelInput, cropId: string, opts: Omit<AssessOptions, 'method'> = {}): CropAssessment | null {
  return assessCrop(input, cropId, { ...opts, method: 'cropsuite' });
}

// ------------------------------------------------------------------------------------------------
// Crop assessment (climatological) and ranking
// ------------------------------------------------------------------------------------------------

export interface CropAssessment {
  cropId: string;
  /** 0..1 at the sowing month used. */
  compatibility: number;
  /** Month the assessment used: the farmer's sowing month, or the best window. */
  sowingMonth: number;
  sowingAssumed: boolean;
  bestSowingMonth: number;
  bestCompatibility: number;
  windowMonths: number;
  factors: FactorScore[];
  limiting: FactorScore | null;
  reliability: { yearsOk: number; yearsTotal: number } | null;
  /** Climate score of each analysed year (min of temperature and water), for yield ranges. */
  yearScores: number[];
  /** Rain plus stored soil water over the window, and the crop's optimal minimum, mm (null without climate). */
  waterSupplyMm: number | null;
  waterNeedMm: number;
  /** Seasonal thermal units (Growing Degree Days above T_absMin, °C·d) over the growing window. */
  seasonalGdd?: number | null;
  needsLocalReview: boolean;
  /** Present when the assessment was made with the CropSuite method. */
  cropSuite?: CropSuiteSummary;
}

export interface AssessOptions {
  /** 1-12; overrides the ground-truth sowing date and the best-window search. */
  sowingMonth?: number;
  irrigation?: GroundTruth['irrigation'];
  /** Suitability method (default `DEFAULT_SUITABILITY_METHOD`). */
  method?: SuitabilityMethod;
  /** CropSuite only: switch climate variability or the day-length limit off (benchmark ablations). */
  cropSuite?: Pick<CropSuiteOptions, 'variability' | 'photoperiod'>;
  /** CropSuite only: false skips the multiple-cropping search (used when ranking many crops). */
  multipleCropping?: boolean;
  /** Another latitude gate than `LATITUDE_GATE`, or null for none. For the comparison of gates only; the app never sets it. */
  latitudeGate?: LatitudeGate | null;
}

const sources = (t: FieldTelemetry) => ({ soil: t.branches.soil?.sources[0], terrain: t.branches.terrain?.sources[0], climate: t.climateSourceId });

function assess(crop: CropProfile, input: ModelInput, site: Site, climate: Climate | null, opts: AssessOptions = {}): CropAssessment & { fits: Fit[]; stats: (YearStats | null)[] } {
  const irrigation = opts.irrigation ?? input.groundTruth.irrigation ?? 'rainfed';
  const chosen = opts.method ?? DEFAULT_SUITABILITY_METHOD;
  if (chosen === 'cropsuite') {
    const viaCropSuite = assessWithCropSuite(crop, input, site, climate, irrigation, opts);
    if (viaCropSuite) return viaCropSuite;
  }
  // CropSuite needs the multi-year climate history; without it the v2 operator stands in.
  const method: ParametricMethod = chosen === 'cropsuite' ? 'astrovivu-v2' : chosen;
  const src = sources(input.telemetry);
  const fits: Fit[] = [];
  const stats: (YearStats | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    fits.push(fitFor(crop, site, climate, m, irrigation, src, method, opts.latitudeGate === undefined ? LATITUDE_GATE : opts.latitudeGate));
    stats.push(climate ? yearStats(crop, site, climate, m, irrigation) : null);
  }
  const rel = (i: number) => (stats[i]?.yearsTotal ? stats[i]!.yearsOk / stats[i]!.yearsTotal : 0);
  const dormancy = climate ? activeSeason(crop, climate.clim.tMean) : null;
  let best = 0;
  if (!dormancy) {
    for (let i = 1; i < 12; i++) if (fits[i].score > fits[best].score + 1e-9 || (Math.abs(fits[i].score - fits[best].score) <= 1e-9 && rel(i) > rel(best) + 1e-9)) best = i;
  } else {
    const n = Math.min(windowMonths(crop), dormancy.months);
    const pool = Array.from({ length: 12 }, (_, i) => i).filter((i) => Array.from({ length: n }, (_, k) => dormancy.active[(i + k) % 12]).every(Boolean));
    const temp = (i: number) => fits[i].season?.temp ?? 0;
    best = pool[0] ?? 0;
    for (const i of pool) if (temp(i) > temp(best) + 1e-9 || (Math.abs(temp(i) - temp(best)) <= 1e-9 && fits[i].score > fits[best].score + 1e-9)) best = i;
  }
  const gtMonth = input.groundTruth.sowingDate && !dormancy ? Number(input.groundTruth.sowingDate.slice(5, 7)) : undefined;
  const month = opts.sowingMonth ?? gtMonth ?? best + 1;
  const fit = fits[month - 1];
  const st = stats[month - 1];
  const factors = [...fit.factors];
  let limiting = fit.limiting;
  if (climate && fits[best].score > 0) {
    const ratio = clamp01(fit.score / fits[best].score);
    const sow: FactorScore = {
      key: 'sowing',
      label: tx('Sowing window', 'Thời vụ gieo trồng'),
      score: round(ratio, 3),
      weight: 0,
      actual: month,
      ideal: String(best + 1),
      unit: 'month',
      kind: 'choice',
      branch: 'agromet',
      note: tx("Share of the best window's score reached by this sowing month; already inside temperature and water.", 'Tỉ lệ điểm so với thời vụ tốt nhất; đã nằm trong điểm nhiệt độ và nước.'),
    };
    factors.push(sow);
    if (ratio < 0.98 && (!limiting || ratio < (limiting.score ?? 1) ** limiting.weight)) limiting = sow;
  }
  return {
    cropId: crop.id,
    compatibility: fit.score,
    sowingMonth: month,
    sowingAssumed: opts.sowingMonth == null && gtMonth == null,
    bestSowingMonth: best + 1,
    bestCompatibility: fits[best].score,
    windowMonths: windowMonths(crop),
    factors,
    limiting,
    reliability: st?.yearsTotal ? { yearsOk: st.yearsOk, yearsTotal: st.yearsTotal } : null,
    yearScores: st?.scores ?? [],
    waterSupplyMm: fit.season?.supplyMm ?? null,
    waterNeedMm: Math.round(fit.season?.quad[1] ?? crop.req.rainMm[1]),
    seasonalGdd: fit.season?.gdd ?? null,
    needsLocalReview: fit.review,
    fits,
    stats,
  };
}

/** Climatological fit of any crop on the locked parcel (used by the rotation planner and the economics). */
export function assessCrop(input: ModelInput, cropId: string, opts: AssessOptions = {}): CropAssessment | null {
  const crop = getCrop(cropId);
  if (!crop) return null;
  const { fits: _f, stats: _s, ...a } = assess(crop, input, buildSite(input), prepare(input).climate, opts);
  return a;
}

/** How the ranking reads the prevalence of a crop in the country of the parcel. */
export type PrevalenceStatus = 'grown' | 'unknown' | 'absent';

/**
 * Only a record tied to the crop itself can say "grown" or "absent". A record of a group item
 * ("Other vegetables") and no record at all say nothing about the crop: both read as unknown.
 */
export function prevalenceStatus(p: CropPrevalence | undefined): PrevalenceStatus {
  if (!p || p.match === 'group' || p.level === 'unknown') return 'unknown';
  return p.level === 'absent' ? 'absent' : 'grown';
}

/** Order among crops with the same rank score: what the country grows most first, what it does not grow last. */
const LEVEL_ORDER: Record<PrevalenceLevel, number> = { major: 0, common: 1, minor: 2, present: 3, unknown: 4, absent: 5 };

/** From this compatibility ("suitable" in the score classes) a crop the country does not grow is worth a trial. */
export const TRIAL_MIN_COMPATIBILITY = 0.6;

export interface CropRanking {
  cropId: string;
  compatibility: number;
  reliability: number | null;
  bestSowingMonth: number;
  limiting: string | null;
  /** compatibility x (0.5 + 0.5 reliability): the second stage that separates crops tied at 100. */
  rankScore: number;
  /**
   * How the country of the parcel grows the crop. Absent when the input carries no country table
   * (`ModelInput.country`): the ranking then rests on climate and soil alone.
   */
  prevalence?: { status: PrevalenceStatus; level: PrevalenceLevel; sharePct?: number; source?: string };
}

/**
 * Order of the ranking. Rank score first. Among equal scores: the crop the country grows more of
 * (level, then share of its harvested area), then the more reliable one over the analysed years,
 * and the crop id last, only so that the same input always gives the same list.
 */
function byRank(x: CropRanking, y: CropRanking): number {
  const level = (r: CropRanking) => LEVEL_ORDER[r.prevalence?.level ?? 'unknown'];
  return (
    y.rankScore - x.rankScore ||
    level(x) - level(y) ||
    (y.prevalence?.sharePct ?? -1) - (x.prevalence?.sharePct ?? -1) ||
    (y.reliability ?? -1) - (x.reliability ?? -1) ||
    x.cropId.localeCompare(y.cropId)
  );
}

export interface RankOptions {
  limit?: number;
  cropIds?: string[];
  irrigation?: GroundTruth['irrigation'];
  method?: SuitabilityMethod;
  /**
   * With a country table in the input, crops the country does not grow (`absent`) are left out
   * unless this is `'all'`. Without one, every crop is ranked, as before.
   */
  include?: 'main' | 'all';
}

function rankAll(input: ModelInput, opts: RankOptions): CropRanking[] {
  const site = buildSite(input);
  const climate = prepare(input).climate;
  const avoid = new Set(input.groundTruth.avoidCropIds ?? []);
  const crops = (opts.cropIds?.map((id) => getCrop(id)).filter((c): c is CropProfile => !!c) ?? listCrops()).filter((c) => !avoid.has(c.id));
  const country = input.country;
  const out = crops.map((crop): CropRanking => {
    const a = assess(crop, { ...input, groundTruth: { ...input.groundTruth, sowingDate: undefined } }, site, climate, { irrigation: opts.irrigation, method: opts.method, multipleCropping: false });
    const reliability = a.reliability ? a.reliability.yearsOk / a.reliability.yearsTotal : null;
    const ranking: CropRanking = { cropId: crop.id, compatibility: round(a.bestCompatibility, 3), reliability, bestSowingMonth: a.bestSowingMonth, limiting: a.limiting?.key ?? null, rankScore: round(a.bestCompatibility * (0.5 + 0.5 * (reliability ?? 1)), 4) };
    if (country) {
      const p = country.prevalence[crop.id];
      const status = prevalenceStatus(p);
      // A group record carries the level of the group, not of the crop: it is not passed on.
      ranking.prevalence = { status, level: status === 'unknown' ? 'unknown' : p!.level, ...(status === 'grown' && p!.sharePct != null ? { sharePct: p!.sharePct } : {}), ...(p ? { source: p.source } : {}) };
    }
    return ranking;
  });
  return out.sort(byRank);
}

/**
 * Second-stage ranking of the curated crops (or `cropIds`) at their best sowing window.
 * With `input.country`, the list holds the crops the country grows and those it has no figure
 * for; a crop the country does not grow is left to `rankCropLists(...).trial`.
 */
export function rankCrops(input: ModelInput, opts: RankOptions = {}): CropRanking[] {
  const all = rankAll(input, opts);
  const out = opts.include === 'all' ? all : all.filter((r) => r.prevalence?.status !== 'absent');
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export interface CropRankingLists {
  /** Crops the country grows, and crops it has no figure for (`prevalence.status === 'unknown'`), best first. */
  main: CropRanking[];
  /**
   * Crops the country's statistics do not report although climate and soil of the field suit them
   * (compatibility from `TRIAL_MIN_COMPATIBILITY`). New to the country, or grown there without
   * being reported: the note of each entry says so, and to try a new crop on a small area first.
   */
  trial: (CropRanking & { note: I18nText })[];
  /** Whether the country table was applied, and in words what that means for the two lists. */
  gate: { applied: boolean; iso3?: string; note: I18nText };
}

/** The ranking as two lists: what to choose from, and what would be new to the country. */
export function rankCropLists(input: ModelInput, opts: Omit<RankOptions, 'include'> = {}): CropRankingLists {
  const all = rankAll(input, opts);
  const country = input.country;
  if (!country) {
    return {
      main: opts.limit ? all.slice(0, opts.limit) : all,
      trial: [],
      gate: {
        applied: false,
        note: tx(
          'The country of this field is not known, or its crop table is not loaded: crops are ranked on climate and soil alone, whether or not they are grown locally.',
          'Chưa xác định được nước của thửa ruộng, hoặc chưa nạp bảng cây trồng của nước đó: cây được xếp hạng chỉ theo khí hậu và đất, không xét cây đó có được trồng tại chỗ hay không.',
        ),
      },
    };
  }
  const place = input.parcel.place?.country ?? country.iso3;
  const main = all.filter((r) => r.prevalence?.status !== 'absent');
  const trial = all
    .filter((r) => r.prevalence?.status === 'absent' && r.compatibility >= TRIAL_MIN_COMPATIBILITY)
    .map((r) => {
      const source = r.prevalence?.source ?? 'the crop statistics used';
      return {
        ...r,
        note: tx(
          `No production of this crop is reported for ${place} (${source}). It may be new there, or grown without being reported: ask locally, and if it is new, try it on a small area first.`,
          `Không có số liệu sản xuất của cây này ở ${place} (${source}). Có thể đây là cây mới ở đó, hoặc có trồng nhưng không được thống kê: hãy hỏi tại địa phương; nếu là cây mới thì nên trồng thử trên diện tích nhỏ trước.`,
        ),
      };
    });
  return {
    main: opts.limit ? main.slice(0, opts.limit) : main,
    trial: opts.limit ? trial.slice(0, opts.limit) : trial,
    gate: {
      applied: true,
      iso3: country.iso3,
      note: tx(
        `The main list holds crops reported as grown in ${place} and crops without a figure of their own (marked unknown). Crops with no reported production there are listed apart, as crops to check and to trial.`,
        `Danh sách chính gồm các cây được ghi nhận có trồng ở ${place} và các cây chưa có số liệu riêng (đánh dấu chưa rõ). Cây không có số liệu sản xuất ở đó được liệt kê riêng, là cây cần hỏi lại và trồng thử.`,
      ),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Growth stages and the daily water balance
// ------------------------------------------------------------------------------------------------

const STAGE_LABEL: Record<StageId, I18nText> = {
  fallow: tx('Off-season (fallow)', 'Ngoài vụ (đất nghỉ)'),
  'pre-sowing': tx('Off-season (before sowing)', 'Ngoài vụ (trước gieo)'),
  dormant: tx('Dormant (winter rest)', 'Ngủ nghỉ (nghỉ đông)'),
  initial: tx('Initial', 'Giai đoạn đầu'),
  development: tx('Development', 'Phát triển'),
  'mid-season': tx('Mid-season', 'Giữa vụ'),
  'late-season': tx('Late season', 'Cuối vụ'),
  harvest: tx('Harvest', 'Thu hoạch'),
};
const DEFAULT_STAGES: [number, number, number, number] = [0.15, 0.25, 0.4, 0.2];

/** Stage on a day counted from sowing (the calendar repeats every 365 days). */
export function stageAt(crop: CropProfile, dayInSeason: number): GrowthStage {
  const len = cycleLength(crop);
  const mk = (id: StageId, progress: number, dis: number | null): GrowthStage => ({ id, label: STAGE_LABEL[id], progress: round(clamp01(progress), 3), dayInSeason: dis });
  if (dayInSeason < len) {
    const f = dayInSeason / len;
    const [a, b, c] = crop.water?.stages ?? DEFAULT_STAGES;
    return mk(f < a ? 'initial' : f < a + b ? 'development' : f < a + b + c ? 'mid-season' : 'late-season', f, dayInSeason);
  }
  if (crop.lifeSpan !== 'perennial' && dayInSeason < len + 14) return mk('harvest', 1, dayInSeason);
  return mk(dayInSeason >= 365 - 21 ? 'pre-sowing' : 'fallow', 0, null);
}

/** FAO-56 single Kc curve with climatic adjustment of Kc,mid and Kc,end (eq. 62 & 65) when RH and wind exist. */
function kcAtClimatic(crop: CropProfile, stage: GrowthStage, u2Ms: number, rhMinPct: number, heightM: number): number {
  const w = crop.water;
  const kc = w?.kc ?? { ini: 0.5, mid: 1.05, end: 0.7 };
  const [a, b, c, d] = w?.stages ?? DEFAULT_STAGES;
  const kcMid = adjustKcClimate(kc.mid, u2Ms, rhMinPct, heightM);
  const kcEnd = adjustKcClimate(kc.end, u2Ms, rhMinPct, heightM);
  const f = stage.progress;
  switch (stage.id) {
    case 'initial':
      return kc.ini;
    case 'development':
      return kc.ini + ((kcMid - kc.ini) * (f - a)) / b;
    case 'mid-season':
      return kcMid;
    case 'late-season':
      return kcMid + ((kcEnd - kcMid) * (f - a - b - c)) / d;
    default:
      return crop.lifeSpan === 'perennial' ? kc.ini : FALLOW_KC;
  }
}

interface Balance {
  ks: Float64Array;
  kAer: Float64Array;
  /** Sums over in-season days. */
  eta: number;
  etc: number;
  /** Stage-sensitivity weighted seasonal relative evapotranspiration (Jensen 1968 / FAO-66). */
  etaWeightedRatio: number | null;
  irrigationMm: number;
  irrigation: Float64Array;
}

/**
 * FAO-56 daily root-zone water balance (eq. 82-86) extended with Borg & Grimes (1986) dynamic root
 * depth Zr(t), curve-number runoff and Feddes/AquaCrop anaerobiosis waterlogging factor Kaer; two
 * passes so the initial soil water state is independent of an arbitrary guess.
 */
function waterBalance(
  d: Daily,
  kc: Float64Array,
  zrDaily: Float64Array,
  stageSens: Float64Array,
  inSeason: Uint8Array,
  seasonStart: Uint8Array,
  awc: number,
  pTable: number,
  cn: number,
  percMaxMm: number,
  hydrophytic: boolean,
  irrigation: GroundTruth['irrigation'],
  budgetMm: number,
  rainFactor: number,
): Balance {
  const ks = new Float64Array(d.n).fill(1);
  const kAer = new Float64Array(d.n).fill(1);
  const irr = new Float64Array(d.n);
  const s = 25400 / cn - 254;
  let dr = (1000 * awc * zrDaily[0]) / 2;
  let surplus = 0;
  let eta = 0;
  let etc = 0;
  let etaW = 0;
  let etcW = 0;
  let total = 0;
  let budget = budgetMm;
  for (let pass = 0; pass < 2; pass++) {
    eta = etc = etaW = etcW = total = 0;
    for (let i = 0; i < d.n; i++) {
      if (seasonStart[i]) budget = budgetMm;
      const zr = zrDaily[i];
      const taw = Math.max(15, 1000 * awc * zr);
      dr = clamp(dr, 0, taw);
      const demand = kc[i] * d.et0[i];
      const raw = clamp(pTable + 0.04 * (5 - demand), 0.1, 0.8) * taw;
      let water = 0;
      if (irrigation !== 'rainfed' && inSeason[i] && dr > raw && budget > 0) {
        water = Math.min(dr, budget);
        budget -= water;
        dr -= water;
      }
      const k = dr > raw ? Math.max(0, (taw - dr) / (taw - raw)) : 1;
      const aer = feddesAerationFactor(surplus, zr, hydrophytic);
      const kEff = k * aer;
      const p = d.rain[i] * rainFactor;
      const runoff = p > 0.2 * s ? (p - 0.2 * s) ** 2 / (p + 0.8 * s) : 0;
      const effective = p < 0.2 * d.et0[i] ? 0 : p - runoff; // FAO-56: tiny showers evaporate
      const nextDr = dr - effective + kEff * demand;
      if (nextDr < 0) {
        const excess = -nextDr;
        const maxSurplus = Math.max(20, 1000 * 0.08 * zr);
        surplus = clamp(surplus + excess - percMaxMm, 0, maxSurplus);
        dr = 0;
      } else {
        surplus = Math.max(0, surplus - percMaxMm);
        dr = Math.min(taw, nextDr);
      }
      if (pass === 1) {
        ks[i] = k;
        kAer[i] = aer;
        irr[i] = water;
        if (inSeason[i]) {
          eta += kEff * demand;
          etc += demand;
          const sw = stageSens[i];
          etaW += sw * kEff * demand;
          etcW += sw * demand;
          total += water;
        }
      }
    }
  }
  return { ks, kAer, eta, etc, etaWeightedRatio: etcW > 0 ? etaW / etcW : null, irrigationMm: total, irrigation: irr };
}

// ------------------------------------------------------------------------------------------------
// Timeline
// ------------------------------------------------------------------------------------------------

export interface ScoreDetail {
  timeline: ScoreTimeline;
  assessment: CropAssessment | null;
  /** Season totals from the daily water balance of the telemetry year (null when rain or ET0 is missing). */
  water: { etcMm: number; etaMm: number; irrigationMm: number; events: { t: string; mm: number }[] } | null;
  /** Expected fraction of attainable yield in each analysed year, for low/high ranges. */
  yieldFractions: number[];
}

const branchConfidence = (t: FieldTelemetry, ids: BranchId[]): number => {
  const scores = ids.map((id) => t.branches[id]).filter((b) => b && b.status !== 'unavailable').map((b) => b.confidence.score);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / ids.length : 0;
};

function rainBias(input: ModelInput, d: Daily, calibration: CalibrationNote[]): number {
  const m = input.groundTruth.measuredRain;
  if (!m?.length) return 1;
  let sat = 0;
  let ground = 0;
  for (const s of m) {
    const i = diffDays(s.t, d.start);
    if (i >= 0 && i < d.n && !Number.isNaN(d.rain[i])) (sat += d.rain[i]), (ground += s.v);
  }
  if (!(sat > 0) || !(ground > 0)) return 1;
  const factor = clamp(ground / sat, 0.25, 4);
  calibration.push({ key: 'rain', label: tx('Rainfall', 'Lượng mưa'), satellite: round(sat, 1), ground: round(ground, 1), delta: round(ground - sat, 1), effect: tx(`Satellite rain is multiplied by ${round(factor, 2)} in the water balance.`, `Mưa vệ tinh được nhân ${round(factor, 2)} trong cân bằng nước.`) });
  return factor;
}

function soilMoistureBias(input: ModelInput, d: Daily, calibration: CalibrationNote[]): number {
  const m = input.groundTruth.measuredSoilMoisture;
  if (!m?.length) return 1;
  let sat = 0;
  let ground = 0;
  let count = 0;
  for (const s of m) {
    const i = diffDays(s.t, d.start);
    if (i >= 0 && i < d.n && !Number.isNaN(d.smRaw[i]) && d.smRaw[i] > 0 && s.v >= 0) {
      sat += d.smRaw[i];
      ground += s.v;
      count++;
    }
  }
  if (!count || !(sat > 0) || !(ground > 0)) return 1;
  const factor = clamp(ground / sat, 0.35, 3);
  calibration.push({
    key: 'soilMoisture',
    label: tx('Soil moisture', 'Độ ẩm đất'),
    satellite: round(sat / count, 3),
    ground: round(ground / count, 3),
    delta: round((ground - sat) / count, 3),
    effect: tx(`Satellite root-zone soil moisture is bias-scaled by ${round(factor, 2)}.`, `Độ ẩm vùng rễ vệ tinh được hiệu chỉnh hệ số ${round(factor, 2)}.`),
  });
  return factor;
}

/** Lower-cases only the first letter, so units and symbols inside a label survive ("Soil pH" -> "soil pH"). */
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** Ground-truth fields behind each calibration key: removing them re-scores the field without that override. */
const OVERRIDE_FIELDS: Record<string, (keyof GroundTruth)[]> = {
  texture: ['texture'],
  ph: ['ph'],
  drainage: ['drainage'],
  salinity: ['ecDsM'],
  depth: ['soilDepthCm'],
  irrigation: ['irrigation', 'waterSource', 'waterReliability'],
  sowing: ['sowingDate'],
  rain: ['measuredRain'],
  soilMoisture: ['measuredSoilMoisture'],
};

function withoutOverride(gt: GroundTruth, key: string): GroundTruth | null {
  const fields = OVERRIDE_FIELDS[key];
  if (!fields) return null;
  const next: GroundTruth = { ...gt };
  for (const k of fields) delete next[k];
  if (key === 'drainage' && next.issues) next.issues = next.issues.filter((i) => i !== 'waterlogging');
  if (key === 'salinity' && next.issues) next.issues = next.issues.filter((i) => i !== 'salinity');
  return next;
}

/** Fill each ledger line with the season score with and without that one override. */
function scoreLedger(input: ModelInput, notes: CalibrationNote[], withScore: number): CalibrationNote[] {
  return notes.map((c) => {
    const gt = withoutOverride(input.groundTruth, c.key);
    if (!gt) return c;
    const without = seasonScore({ ...input, groundTruth: gt }, false);
    const delta = withScore - without;
    const sign = delta > 0 ? '+' : '';
    return {
      ...c,
      scoreEffect: { with: withScore, without, delta },
      effect: tx(`${c.effect.en} Season score ${without} without it, ${withScore} with it (${sign}${delta}).`, `${c.effect.vi} Điểm vụ ${without} khi không có, ${withScore} khi có (${sign}${delta}).`),
    };
  });
}

export function computeScoreDetail(input: ModelInput, opts: { snapshots?: boolean; ledger?: boolean; method?: SuitabilityMethod } = {}): ScoreDetail {
  const { telemetry: t, groundTruth: gt } = input;
  const crop = getCrop(input.cropId);
  const site = buildSite(input);
  const { climate, daily: d } = prepare(input);
  const a = crop ? assess(crop, input, site, climate, { method: opts.method }) : null;
  const irrigation = gt.irrigation ?? 'rainfed';
  const calibration = [...site.calibration];
  if (gt.irrigation && gt.irrigation !== 'rainfed')
    calibration.push({
      key: 'irrigation',
      label: tx('Irrigation', 'Tưới'),
      satellite: 'rainfed',
      ground: gt.irrigation,
      effect: gt.irrigation === 'full' ? tx('Rainfall is no longer a limiting factor; the water balance irrigates on demand.', 'Mưa không còn là yếu tố giới hạn; cân bằng nước tưới theo nhu cầu.') : tx("Irrigation closes part of the deficit, up to 30 % of the crop's optimal season water.", 'Tưới bù một phần thiếu hụt, tối đa 30 % nhu cầu nước tối ưu của vụ.'),
    });
  if (crop && a && !a.sowingAssumed && gt.sowingDate) calibration.push({ key: 'sowing', label: tx('Sowing date', 'Ngày gieo'), satellite: `month ${a.bestSowingMonth} (best window)`, ground: gt.sowingDate, effect: tx('Growth stages are anchored on this date.', 'Các giai đoạn sinh trưởng được tính từ ngày này.') });
  const bias = rainBias(input, d, calibration);
  const smFactor = soilMoistureBias(input, d, calibration);

  const sowDoy = crop && a ? (gt.sowingDate ? dayOfYear(gt.sowingDate) : dayOfYear(`2025-${String(a.sowingMonth).padStart(2, '0')}-01`)) : 1;
  const stages: (GrowthStage | null)[] = new Array(d.n).fill(null);
  const kc = new Float64Array(d.n).fill(1);
  const zrMax = crop?.water?.rootDepthM ?? 1;
  const zrDaily = new Float64Array(d.n).fill(zrMax);
  const stageSens = new Float64Array(d.n).fill(1);
  const inSeason = new Uint8Array(d.n);
  const seasonStart = new Uint8Array(d.n);
  const dormancy = crop && climate ? activeSeason(crop, climate.clim.tMean) : null;
  const dormantStage: GrowthStage = { id: 'dormant', label: STAGE_LABEL.dormant, progress: 0, dayInSeason: null };
  const restStage: GrowthStage = { id: 'fallow', label: tx('Between cycles (tree rest)', 'Giữa hai chu kỳ (cây nghỉ)'), progress: 0, dayInSeason: null };
  const blocks = crop && crop.lifeSpan !== 'perennial' && !gt.sowingDate ? (gt.currentRotation ?? []).filter((b) => b.cropId === crop.id && b.startMonth >= 1 && b.startMonth <= 12) : [];
  const blockStartDoy = blocks.map((b) => dayOfYear(`2025-${String(b.startMonth).padStart(2, '0')}-01`));
  if (crop) {
    const cache = new Map<number, GrowthStage>();
    const len = cycleLength(crop);
    const [sIni, sDev] = crop.water?.stages ?? DEFAULT_STAGES;
    const rootDevDays = Math.max(15, Math.round((sIni + sDev) * len));
    const isPerennial = crop.lifeSpan === 'perennial';
    const heightM = cropCanopyHeightM(crop);
    for (let i = 0; i < d.n; i++) {
      const doy = Math.min(d.doy[i], 365);
      const dis = blocks.length ? Math.min(...blockStartDoy.map((b) => (doy - b + 365) % 365)) : (doy - sowDoy + 365) % 365;
      let st = cache.get(dis);
      if (!st) cache.set(dis, (st = stageAt(crop, dis)));
      if (st.dayInSeason == null && isPerennial) st = dormancy ? dormantStage : restStage;
      stages[i] = st;
      const activeDay = st.dayInSeason != null && st.id !== 'harvest';
      inSeason[i] = activeDay ? 1 : 0;
      seasonStart[i] = dis === 0 ? 1 : 0;
      kc[i] = kcAtClimatic(crop, st, d.wind7[i], d.rhMin7[i], heightM);
      zrDaily[i] = borgGrimesRootDepth(st.dayInSeason, rootDevDays, zrMax, isPerennial);
      stageSens[i] = activeDay ? (STAGE_SENSITIVITY[st.id] ?? 1) : 0.5;
    }
  } else inSeason.fill(1);

  const tempC = crop?.req.tempC ?? GENERIC_TEMP;
  const texture = site.texture ?? 'medium';
  const optWater = crop ? crop.req.rainMm[1] * Math.min(1, windowMonths(crop) / 4) : 0;
  const reliable = gt.waterReliability === 'often-short' ? SUPPLEMENTAL_SHARE : gt.waterReliability === 'dry-season-short' ? 2 * SUPPLEMENTAL_SHARE : Infinity;
  const budget = !crop ? Infinity : irrigation === 'supplemental' ? SUPPLEMENTAL_SHARE * optWater : reliable * optWater;
  const percMaxMm = drainagePercolationMmDay(site.drainage, texture);
  const hydrophytic = isHydrophyticCrop(crop);
  const bal = d.hasWater
    ? waterBalance(d, kc, zrDaily, stageSens, inSeason, seasonStart, site.awc, crop?.water?.depletionFraction ?? 0.5, CN_BY_TEXTURE[texture], percMaxMm, hydrophytic, crop ? irrigation : 'rainfed', budget, bias)
    : null;
  const ky = Math.min(1.5, crop?.water?.ky ?? 1);

  // Season outcome: non-water compatibility x the more limiting of seasonal rainfall adequacy and
  // stage-weighted FAO-33/FAO-66 water-aeration response (Jensen 1968; Steduto et al. 2012).
  const waterFactor = a?.factors.find((f) => f.key === 'water')?.score ?? null;
  const etRatio = bal && bal.etc > 0 ? 0.5 * (bal.eta / bal.etc) + 0.5 * (bal.etaWeightedRatio ?? bal.eta / bal.etc) : null;
  const f33 = etRatio != null ? clamp01(1 - ky * (1 - etRatio)) : null;
  const nonWater = a ? (waterFactor != null && waterFactor > 0 ? a.compatibility / waterFactor : waterFactor === 0 ? 0 : a.compatibility) : null;
  const expected = a && nonWater != null ? clamp01(nonWater * Math.min(waterFactor ?? 1, f33 ?? 1)) : null;
  const yieldFractions = a && nonWater != null ? a.yearScores.map((s) => clamp01(nonWater * Math.min(s, 1))) : [];

  const compat = a ? a.compatibility : null;
  const confStatic = a ? (climate ? 0.5 * branchConfidence(t, ['agromet', 'rainfall']) : 0) + 0.5 * (site.groundKeys.size ? Math.max(0.9, branchConfidence(t, ['soil'])) : branchConfidence(t, ['soil'])) : 0;
  const confDyn = (bal ? 0.45 * branchConfidence(t, ['rainfall', 'agromet']) : 0) + (d.hasTemp ? 0.25 * branchConfidence(t, ['agromet']) : 0) + 0.3 * branchConfidence(t, ['vegetation', 'thermal', 'soilMoisture']);
  const confidence = round(clamp01(a ? 0.5 * confStatic + 0.5 * confDyn : confDyn), 2);

  const snapshots: ScoreSnapshot[] = [];
  const staticFactors = a?.factors ?? [];
  let sum = 0;
  let count = 0;
  let nowScore = 0;
  let nowState: 'in-season' | 'off-season' | 'dormant' = 'in-season';
  const dyn = (key: string, label: I18nText, score: number, weight: number, actual: number | null, ideal: string, kind: FactorKind, branch: BranchId, unit?: string): FactorScore => ({ key, label, score: round(score, 3), weight, actual, ideal, kind, branch, ...(unit ? { unit } : {}) });
  for (let i = 0; i < d.n; i++) {
    const stage = stages[i];
    const active = !crop || inSeason[i] === 1;
    const t7 = d.tMean7[i];
    const heat = asymmetricHeatFactor(t7, d.tMax3[i], tempC, stage?.id, active);
    let cold = Number.isNaN(t7) ? null : t7 < tempC[1] ? clamp01((t7 - tempC[0]) / Math.max(1, tempC[1] - tempC[0])) : 1;
    if (cold != null && crop?.req.killTempC != null && active && !Number.isNaN(d.tMin[i]) && d.tMin[i] <= crop.req.killTempC) cold = Math.min(cold, 0.1);
    const ksNow = bal ? bal.ks[i] : null;
    const aerNow = bal ? bal.kAer[i] : 1;
    const sens = stageSens[i];
    const waterIdx = ksNow == null ? null : clamp01(1 - ky * sens * (1 - ksNow * aerNow));
    const radIdx = active ? monteithRadiationFactor(d.par7[i], crop) : null;
    const thermal = heat == null || cold == null ? null : Math.min(heat, cold);
    const radTerm = radIdx == null ? 1 : radIdx ** 0.35;
    const model = waterIdx == null && thermal == null ? null : (waterIdx ?? 1) * (thermal ?? 1) * radTerm;

    const ndvi = active && !Number.isNaN(d.ndviScore[i]) ? d.ndviScore[i] : null;
    const esi = !Number.isNaN(d.esiScore[i]) ? d.esiScore[i] : null;
    let smObs: number | null = null;
    if (!Number.isNaN(d.smScore[i])) {
      if (smFactor === 1) smObs = d.smScore[i];
      else {
        const vCal = d.smRaw[i] * smFactor;
        const m = d.smMean[i];
        const p10 = d.smP10[i];
        smObs = vCal >= m || !(m > p10) ? 1 : clamp01(0.5 + (0.5 * (vCal - p10)) / (m - p10));
      }
    }
    const lstObs = active && !Number.isNaN(d.lstScore[i]) ? d.lstScore[i] : null;
    const observed = assimilateSatelliteCondition({ ndvi, esi, smRoot: smObs, lstCanopy: lstObs });

    const k = model == null ? (observed ?? 1) : observed == null ? model : (1 - OBSERVED_BLEND) * model + OBSERVED_BLEND * observed;
    const condition = Math.round(100 * k);
    const offSeason = !!crop && stage != null && (stage.id === 'dormant' || (crop.lifeSpan !== 'perennial' && (stage.id === 'fallow' || stage.id === 'pre-sowing')));
    const productivity = compat == null ? condition : offSeason ? Math.round(100 * compat) : Math.round(100 * compat * k);
    if (active) (sum += productivity), count++;
    nowScore = productivity;
    nowState = !offSeason ? 'in-season' : stage!.id === 'dormant' ? 'dormant' : 'off-season';
    if (opts.snapshots === false) continue;

    const factors: FactorScore[] = [...staticFactors];
    if (ksNow != null) factors.push(dyn('rootWater', tx('Root-zone water (water balance)', 'Nước vùng rễ (cân bằng nước)'), waterIdx!, 1, round(ksNow * aerNow, 2), 'Ks = 1', 'manageable', 'rainfall'));
    if (aerNow < 0.99) factors.push(dyn('waterlogging', tx('Root-zone aeration (waterlogging)', 'Thông khí vùng rễ (ngập úng)'), aerNow, 0.7, round(aerNow, 2), 'Kaer = 1', 'manageable', 'soil'));
    if (heat != null) factors.push(dyn('heat', tx('Heat stress', 'Stress nóng'), heat, 1, round(t7, 1), `<= ${tempC[2]}`, 'fixed', 'agromet', '°C'));
    if (cold != null) factors.push(dyn('cold', tx('Cold stress', 'Stress lạnh'), cold, 1, round(t7, 1), `>= ${tempC[1]}`, 'fixed', 'agromet', '°C'));
    if (radIdx != null) factors.push(dyn('radiation', tx('Solar radiation (PAR)', 'Bức xạ quang hợp (PAR)'), radIdx, 0.35, round(d.par7[i], 1), 'PAR >= sat', 'fixed', 'agromet', 'MJ/m²/d'));
    if (ndvi != null) factors.push(dyn('vigor', tx('Vegetation vigour against its own normal', 'Sức sống thảm thực vật so với mức thường năm'), ndvi, round(OBSERVED_BLEND * 0.42, 3), null, 'NDVI >= normal', 'fixed', 'vegetation'));
    if (esi != null) factors.push(dyn('evapStress', tx('Evaporative stress', 'Stress bốc thoát hơi'), esi, round(OBSERVED_BLEND * 0.24, 3), null, 'ESI >= -0.5', 'fixed', 'thermal', 'σ'));
    if (smObs != null) factors.push(dyn('soilMoistureObs', tx('Observed root-zone moisture vs normal', 'Độ ẩm vùng rễ quan sát so với thường năm'), smObs, round(OBSERVED_BLEND * 0.2, 3), null, 'SM >= normal', 'manageable', 'soilMoisture'));
    if (lstObs != null && lstObs < 0.99) factors.push(dyn('canopyTemp', tx('Daytime canopy thermal anomaly', 'Dị thường nhiệt tán lá ban ngày'), lstObs, round(OBSERVED_BLEND * 0.14, 3), null, 'LST <= normal', 'fixed', 'thermal', '°C'));

    let limiting: FactorScore | null = null;
    let worst = 0.98;
    for (const f of factors) {
      if (f.score == null || f.weight === 0) continue;
      const c = f.score ** Math.min(1, f.weight);
      if (c < worst) (worst = c), (limiting = f);
    }
    if (offSeason) limiting = a?.limiting ? (factors.find((f) => f.key === a.limiting!.key) ?? null) : null;
    if (limiting) factors[factors.indexOf(limiting)] = { ...limiting, limiting: true };
    snapshots.push({ t: addDays(d.start, i), productivity, condition, compatibility: compat == null ? null : Math.round(100 * compat), stage, factors, limiting: limiting?.key ?? null, confidence, ...(offSeason ? { offSeason: true } : {}) });
  }

  const cropName = crop?.names;
  const pct = compat == null ? null : Math.round(100 * compat);
  const cls = (p: number) => (p >= 80 ? ['very suitable', 'rất thích hợp'] : p >= 60 ? ['suitable', 'thích hợp'] : p >= 40 ? ['moderately suitable', 'thích hợp vừa'] : p >= 20 ? ['marginally suitable', 'ít thích hợp'] : ['not suitable', 'không thích hợp']);
  const lim = a?.limiting;
  const rel = a?.reliability;
  const headline: I18nText =
    crop && pct != null
      ? tx(
          `${cropName!.en}: ${cls(pct)[0]} (${pct}/100)${lim ? `, limited by ${lowerFirst(lim.label.en)}` : ''}${rel ? `; the season met its needs in ${rel.yearsOk} of ${rel.yearsTotal} years` : ''}${a!.needsLocalReview ? '. Needs local review.' : '.'}`,
          `${cropName!.vi ?? cropName!.en}: ${cls(pct)[1]} (${pct}/100)${lim ? `, giới hạn bởi ${lowerFirst(lim.label.vi)}` : ''}${rel ? `; vụ đáp ứng nhu cầu của cây trong ${rel.yearsOk}/${rel.yearsTotal} năm` : ''}${a!.needsLocalReview ? '. Cần chuyên gia địa phương xem xét.' : '.'}`,
        )
      : tx('Growing conditions for a generic crop (choose a crop for a crop-specific score).', 'Điều kiện sinh trưởng cho cây trồng chung (chọn cây để có điểm riêng).');
  const headlineNow: I18nText =
    crop && pct != null && nowState !== 'in-season'
      ? nowState === 'dormant'
        ? tx(`${headline.en} Dormant now: the score is the outlook for the next growing season.`, `${headline.vi} Cây đang nghỉ: điểm là triển vọng cho mùa sinh trưởng tới.`)
        : tx(`${headline.en} Off-season now: the score is the outlook for the next season.`, `${headline.vi} Hiện ngoài vụ: điểm là triển vọng cho vụ tới.`)
      : headline;

  const { fits: _f, stats: _s, ...assessment } = a ?? ({} as NonNullable<typeof a>);
  return {
    timeline: {
      cropId: input.cropId,
      stepDays: 1,
      snapshots,
      summary: {
        productivityNow: nowScore,
        productivityMean: count ? Math.round(sum / count) : 0,
        compatibility: pct,
        limiting: lim ? { ...lim, limiting: true } : null,
        expectedYieldFraction: expected == null ? null : round(expected, 3),
        reliability: rel ?? null,
        calibration: opts.ledger === false || !calibration.length ? calibration : scoreLedger(input, calibration, expected == null ? (count ? Math.round(sum / count) : 0) : Math.round(100 * expected)),
        headline: headlineNow,
        seasonNow: nowState,
      },
    },
    assessment: a ? assessment : null,
    water: bal ? { etcMm: Math.round(bal.etc), etaMm: Math.round(bal.eta), irrigationMm: Math.round(bal.irrigationMm), events: [...bal.irrigation].map((mm, i) => ({ t: addDays(d.start, i), mm: Math.round(mm) })).filter((e) => e.mm > 0) } : null,
    yieldFractions,
  };
}

/** Score for every day of the telemetry window. Runs on every override and every branch arrival. */
export function computeScoreTimeline(input: ModelInput): ScoreTimeline {
  return computeScoreDetail(input).timeline;
}

/** Suitability of the selected crop for each sowing month, with the share of years that met its needs. */
export function scanSowingWindows(input: ModelInput, opts: Pick<AssessOptions, 'irrigation' | 'method' | 'cropSuite'> = {}): SowingWindow[] {
  const crop = getCrop(input.cropId);
  if (!crop) return [];
  const a = assess(crop, input, buildSite(input), prepare(input).climate, { ...opts, multipleCropping: false });
  return a.fits.map((f, i) => ({ month: i + 1, score: Math.round(100 * f.score), reliability: a.stats[i]?.yearsTotal ? round(a.stats[i]!.yearsOk / a.stats[i]!.yearsTotal, 2) : null, limiting: f.limiting?.key ?? null }));
}

const seasonScore = (input: ModelInput, ledger = false): number => {
  const s = computeScoreDetail(input, { snapshots: false, ledger }).timeline.summary;
  return s.expectedYieldFraction == null ? s.productivityMean : Math.round(100 * s.expectedYieldFraction);
};

/**
 * Re-score with one thing changed. The score compared is the season outcome (expected % of
 * attainable yield). With a `patch`, each key is applied on its own; without one, the standard
 * moves are tried: irrigation, pH correction, drainage, sowing shift, and the best other crop.
 */
export function whatIf(input: ModelInput, patch?: Partial<GroundTruth>): WhatIfResult[] {
  const crop = getCrop(input.cropId);
  if (!crop) return [];
  const before = seasonScore(input);
  const out: WhatIfResult[] = [];
  const tryIt = (changedFactor: string, label: I18nText, next: ModelInput) => {
    const after = seasonScore(next);
    // What the move changed, for a view that wants to run it as a trial.
    const groundTruth: Partial<GroundTruth> = {};
    for (const k of Object.keys(next.groundTruth) as (keyof GroundTruth)[]) if (next.groundTruth[k] !== input.groundTruth[k]) Object.assign(groundTruth, { [k]: next.groundTruth[k] });
    const apply = { ...(next.cropId !== input.cropId ? { cropId: next.cropId } : {}), ...(Object.keys(groundTruth).length ? { groundTruth } : {}) };
    out.push({ label, changedFactor, before, after, delta: after - before, apply });
  };
  const withGt = (g: Partial<GroundTruth>): ModelInput => ({ ...input, groundTruth: { ...input.groundTruth, ...g } });
  if (patch && Object.keys(patch).length) {
    for (const key of Object.keys(patch) as (keyof GroundTruth)[]) tryIt(key, tx(`Change ${key}`, `Đổi ${key}`), withGt({ [key]: patch[key] }));
    return out;
  }
  const gt = input.groundTruth;
  if ((gt.irrigation ?? 'rainfed') === 'rainfed') tryIt('irrigation', tx('Supplemental irrigation', 'Tưới bổ sung'), withGt({ irrigation: 'supplemental' }));
  if (gt.irrigation !== 'full') tryIt('irrigation', tx('Full irrigation', 'Tưới đủ'), withGt({ irrigation: 'full' }));
  const site = buildSite(input);
  if (site.ph != null && !crop.flags?.includes('ph-missing') && trapezoid(site.ph, crop.req.ph) < 1) {
    const target = round(site.ph < crop.req.ph[1] ? crop.req.ph[1] + 0.2 : crop.req.ph[2] - 0.2, 1);
    tryIt('ph', tx(`Correct soil pH to ${target}`, `Điều chỉnh pH đất về ${target}`), withGt({ ph: target }));
  }
  if (site.drainage === 'poor' && crop.req.drainage && !crop.req.drainage.opt.includes('poor')) tryIt('drainage', tx('Improve drainage', 'Cải thiện thoát nước'), withGt({ drainage: 'well', issues: gt.issues?.filter((i) => i !== 'waterlogging') }));
  const a = assess(crop, input, site, prepare(input).climate);
  if (a.bestSowingMonth !== a.sowingMonth) tryIt('sowing', tx(`Sow in month ${a.bestSowingMonth}`, `Gieo vào tháng ${a.bestSowingMonth}`), withGt({ sowingDate: `${input.today.slice(0, 4)}-${String(a.bestSowingMonth).padStart(2, '0')}-01` }));
  const alt = rankCrops(input, { limit: 4 }).find((r) => r.cropId !== crop.id);
  const other = alt ? getCrop(alt.cropId) : undefined;
  if (other) tryIt('crop', tx(`Switch to ${other.names.en}`, `Chuyển sang ${other.names.vi ?? other.names.en}`), { ...input, cropId: other.id, groundTruth: { ...gt, sowingDate: undefined } });
  return out;
}

/** p10 / p90 of the per-year yield fractions, for the economics' low and high cases. */
export function yieldRange(detail: ScoreDetail): { low: number; high: number } | null {
  if (detail.yieldFractions.length < 5) return null;
  return { low: quantile(detail.yieldFractions, 0.1), high: quantile(detail.yieldFractions, 0.9) };
}
