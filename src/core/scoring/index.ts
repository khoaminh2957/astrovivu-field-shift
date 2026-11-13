/**
 * Tier 3 public API: productivity scoring. Pure TypeScript; formulas and sources in docs/SCORING.md.
 *
 *   compatibility  static crop-site fit: EcoCrop trapezoids on the growing window (worst month for
 *                  temperature, season total for water), soil factors damped by their weight, gates
 *   condition(t)   FAO-56 root-zone water balance x thermal index, blended with what satellites
 *                  see against their own baseline
 *   productivity   compatibility x condition
 */
import type {
  BranchId,
  CalibrationNote,
  CropProfile,
  FactorKind,
  FactorScore,
  FieldTelemetry,
  GroundTruth,
  GrowthStage,
  I18nText,
  ModelInput,
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
import { clamp, clamp01, quantile, round, trapezoid } from './math';

export { trapezoid } from './math';

// ------------------------------------------------------------------------------------------------
// Constants (docs/SCORING.md gives the source of each)
// ------------------------------------------------------------------------------------------------

/** Importance of each graded factor; the exponent is weight / largest weight, so temperature and water act at full strength. */
export const FACTOR_WEIGHTS = { temperature: 1, water: 1, ph: 0.5, salinity: 0.5, drainage: 0.5, texture: 0.25, depth: 0.25, fertility: 0.2, slope: 0.2 } as const;
/** Class scores for categorical soil factors: optimal, tolerated, outside the tolerated classes. */
const CLASS_SCORE = { opt: 1, abs: 0.7, out: 0.15 } as const;
const GATE = { zoneCurated: 0.5, zoneRaw: 0.7, photoperiodMin: 0.7, latitude: 0.7, altitude: 0.8 } as const;
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
  et0: Float64Array;
  /** 12-month means, used alone and to fill the months before the first year. */
  clim: { rain: number[]; tMean: number[]; tMin: number[]; et0: number[] };
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
  ndviScore: Float64Array;
  esiScore: Float64Array;
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
  const c: Climate = { years, rain: mk(), tMean: mk(), tMin: mk(), et0: mk(), clim: { rain: [], tMean: [], tMin: [], et0: [] }, zones: [] };
  hist.forEach((y, yi) => {
    for (const m of y.months) {
      const i = yi * 12 + m.month - 1;
      if (m.month < 1 || m.month > 12) continue;
      c.rain[i] = m.rainMm ?? NaN;
      c.tMean[i] = m.tMean ?? (m.tMin != null && m.tMax != null ? (m.tMin + m.tMax) / 2 : NaN);
      c.tMin[i] = m.tMin ?? NaN;
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

function nearestBaseline(series: Series | undefined): { mean: Float64Array; p10: Float64Array } | null {
  if (!series?.baseline?.length) return null;
  const mean = new Float64Array(367).fill(NaN);
  const p10 = new Float64Array(367).fill(NaN);
  for (let d = 1; d <= 366; d++) {
    let best = series.baseline[0];
    for (const b of series.baseline) if (Math.abs(b.doy - d) < Math.abs(best.doy - d)) best = b;
    mean[d] = best.mean;
    p10[d] = best.p10;
  }
  return { mean, p10 };
}

function buildDaily(t: FieldTelemetry, lat: number, climate: Climate | null): Daily {
  const start = t.window.start;
  const n = Math.max(1, diffDays(t.window.end, start) + 1);
  const arr = () => new Float64Array(n).fill(NaN);
  const d: Daily = { n, start, doy: new Int16Array(n), rain: arr(), et0: arr(), tMean: arr(), tMin: arr(), tMax: arr(), ndviScore: arr(), esiScore: arr(), hasWater: false, hasTemp: false };
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
      for (let k = i; k < Math.min(n, i + hold); k++) target[k] = map(smp.v, k);
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
  const month = (i: number) => {
    let m = 0;
    let rest = d.doy[i];
    while (m < 11 && rest > DAYS_IN_MONTH[m]) rest -= DAYS_IN_MONTH[m++];
    return m;
  };
  let tempDays = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(d.tMean[i]) && !Number.isNaN(d.tMax[i]) && !Number.isNaN(d.tMin[i])) d.tMean[i] = (d.tMax[i] + d.tMin[i]) / 2;
    if (!Number.isNaN(d.tMean[i])) tempDays++;
    // Missing days are filled, never zeroed: ET0 from Hargreaves, then both from the climatology.
    if (Number.isNaN(d.et0[i]) && !Number.isNaN(d.tMax[i]) && !Number.isNaN(d.tMin[i])) d.et0[i] = hargreaves(d.tMean[i], d.tMax[i], d.tMin[i], lat, d.doy[i]);
    const m = month(i);
    if (Number.isNaN(d.et0[i]) && climate) d.et0[i] = climate.clim.et0[m] / DAYS_IN_MONTH[m];
    if (Number.isNaN(d.rain[i]) && climate && hasRain) d.rain[i] = climate.clim.rain[m] / DAYS_IN_MONTH[m];
  }
  d.hasTemp = tempDays > n / 2;
  d.hasWater = hasRain && (hasEt0 || d.hasTemp || climate != null) && !d.et0.some(Number.isNaN) && !d.rain.some(Number.isNaN);

  // Vegetation and evaporative stress enter as departures from the pixel's own normal (rule S3).
  const ndvi = findSeries(t.branches.vegetation, 'ndvi');
  const base = nearestBaseline(ndvi);
  if (base)
    put(d.ndviScore, ndvi, 24, (v, i) => {
      const mean = base.mean[d.doy[i]];
      const p10 = base.p10[d.doy[i]];
      return v >= mean || !(mean > p10) ? 1 : clamp01(0.5 + (0.5 * (v - p10)) / (mean - p10));
    });
  put(d.esiScore, findSeries(t.branches.thermal, 'esi'), 10, (v) => clamp01((v + 3) / 2.5));
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
  photo: number | null;
  quad: Quad;
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
  const classes = crop.req.photoperiod;
  for (let k = 0; k < n; k++) {
    const i = start + k;
    const tm = at(c.tMean, c.clim.tMean, i);
    if (!Number.isNaN(tm)) {
      const s = trapezoid(tm, crop.req.tempC);
      if (temp == null || s < temp) (temp = s), (tempAt = tm);
    }
    const r = at(c.rain, c.clim.rain, i);
    if (Number.isNaN(r)) rainOk = false;
    else rain += r;
    const tn = at(c.tMin, c.clim.tMin, i);
    if (crop.req.killTempC != null && !Number.isNaN(tn)) kill = Math.min(kill ?? 1, tn < crop.req.killTempC + KILL_MARGIN_C ? 0 : 1);
    if (classes?.length) {
      const h = dayLengthHours(site.lat, MID_DOY[((i % 12) + 12) % 12]);
      if (classes.includes(h < 12 ? 'short' : h <= 14 ? 'neutral' : 'long')) photoHits++;
    }
  }
  // A perennial also has to survive the months outside its growing window.
  if (crop.lifeSpan === 'perennial') {
    const restKill = crop.req.killTempRestC ?? crop.req.killTempC;
    if (restKill != null)
      for (let k = n; k < 12; k++) {
        const tn = at(c.tMin, c.clim.tMin, start + k);
        if (!Number.isNaN(tn)) kill = Math.min(kill ?? 1, tn < restKill + KILL_MARGIN_C ? 0 : 1);
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
    photo: classes?.length && classes.length < 3 ? GATE.photoperiodMin + (1 - GATE.photoperiodMin) * (photoHits / n) : null,
    quad,
  };
}

const ORDER = { depth: ['very-shallow', 'shallow', 'medium', 'deep'], salinity: ['none', 'low', 'medium', 'high'], fertility: ['low', 'moderate', 'high'] } as const;

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

/** Static crop-site fit for a sowing month (1-12): graded factors, gates, the product and the limiting factor. */
function fitFor(crop: CropProfile, site: Site, climate: Climate | null, month: number, irrigation: GroundTruth['irrigation'], src: { soil?: string; climate?: string; terrain?: string }): Fit {
  const factors: FactorScore[] = [];
  const add = (key: string, label: I18nText, score: number | null, weight: number, actual: number | string | null, ideal: string, kind: FactorKind, branch: BranchId, unit?: string, note?: I18nText) => {
    const ground = site.groundKeys.has(key);
    factors.push({ key, label, score: score == null ? null : round(score, 3), weight, actual, ideal, kind, branch, ...(unit ? { unit } : {}), sourceId: ground ? 'ground-truth' : branch === 'soil' ? src.soil : branch === 'terrain' ? src.terrain : src.climate, ...(note ? { note } : {}) });
  };
  const w = FACTOR_WEIGHTS;
  const req = crop.req;
  const missing = tx('No data: skipped, not scored as zero.', 'Thiếu dữ liệu: bỏ qua, không tính là 0.');
  const season = climate ? seasonFit(crop, climate, month - 1, true, site, irrigation) : null;
  const n = windowMonths(crop);

  add('temperature', tx('Temperature in the growing window', 'Nhiệt độ trong vụ'), season?.temp ?? null, w.temperature, season?.tempAt != null ? round(season.tempAt, 1) : null, fmt(req.tempC), 'fixed', 'agromet', '°C', season?.temp == null ? missing : tx(`Worst month of the ${n}-month window.`, `Tháng bất lợi nhất trong ${n} tháng của vụ.`));
  const waterNote =
    season?.water == null
      ? missing
      : irrigation === 'full' && season.supplyMm != null && season.supplyMm < season.quad[1]
        ? tx(`Rain and stored soil water supply ${Math.round(season.supplyMm)} mm; irrigation covers the rest.`, `Mưa và ẩm trữ trong đất cung cấp ${Math.round(season.supplyMm)} mm; tưới bù phần còn lại.`)
        : tx(`Rain in the window ${Math.round(season.rainMm ?? 0)} mm + stored soil water ${Math.round(season.storedMm)} mm.`, `Mưa trong vụ ${Math.round(season.rainMm ?? 0)} mm + ẩm trữ trong đất ${Math.round(season.storedMm)} mm.`);
  add('water', tx('Water over the growing window', 'Nước trong vụ'), season?.water ?? null, w.water, season?.supplyMm != null ? Math.round(season.supplyMm) : null, fmt(season?.quad ?? req.rainMm), 'manageable', 'rainfall', 'mm', waterNote);

  const phMissing = crop.flags?.includes('ph-missing');
  add('ph', tx('Soil pH', 'pH đất'), site.ph != null && !phMissing ? trapezoid(site.ph, req.ph) : null, w.ph, site.ph, phMissing ? '?' : fmt(req.ph, 1), 'manageable', 'soil', undefined, site.ph == null || phMissing ? missing : undefined);
  const cls = <T extends string>(have: T | null, need: { opt: readonly T[]; abs: readonly T[] } | undefined) => (have == null || !need ? null : need.opt.includes(have) ? CLASS_SCORE.opt : need.abs.includes(have) ? CLASS_SCORE.abs : CLASS_SCORE.out);
  add('texture', tx('Soil texture', 'Thành phần cơ giới'), cls(site.texture, req.texture), w.texture, site.texture, req.texture?.opt.join(', ') ?? '?', 'fixed', 'soil', undefined, cls(site.texture, req.texture) == null ? missing : undefined);
  add('drainage', tx('Drainage', 'Thoát nước'), cls(site.drainage, req.drainage), w.drainage, site.drainage, req.drainage?.opt.join(', ') ?? '?', 'manageable', 'soil', undefined, cls(site.drainage, req.drainage) == null ? missing : undefined);
  // Ordered classes: at least the optimal class = 1, at least the tolerated class = 0.7, below = 0.15.
  const rank = <T extends string>(order: readonly T[], have: T | null, need: { opt: T; abs: T } | undefined, higherIsBetter: boolean) => {
    if (have == null || !need) return null;
    const [h, o, a] = [order.indexOf(have), order.indexOf(need.opt), order.indexOf(need.abs)];
    const ok = (x: number) => (higherIsBetter ? h >= x : h <= x);
    return ok(o) ? CLASS_SCORE.opt : ok(a) ? CLASS_SCORE.abs : CLASS_SCORE.out;
  };
  const depthClass = site.depthCm == null ? null : site.depthCm < 20 ? 'very-shallow' : site.depthCm < 50 ? 'shallow' : site.depthCm <= 150 ? 'medium' : 'deep';
  add('depth', tx('Soil depth', 'Độ sâu tầng đất'), rank(ORDER.depth, depthClass, req.depth, true), w.depth, site.depthCm, req.depth?.opt ?? '?', 'fixed', 'soil', 'cm', depthClass == null ? missing : undefined);
  const salClass = site.ecDsM == null ? null : site.ecDsM < 2 ? 'none' : site.ecDsM < 4 ? 'low' : site.ecDsM <= 10 ? 'medium' : 'high';
  add('salinity', tx('Salinity', 'Độ mặn'), rank(ORDER.salinity, salClass, req.salinity, false), w.salinity, site.ecDsM, req.salinity?.opt ?? '?', 'manageable', 'soil', 'dS/m', salClass == null ? missing : undefined);
  // Fertility proxy: organic carbon (0 at 4 g/kg, 1 at 20) and CEC (0 at 4 cmol/kg, 1 at 20), averaged.
  const parts = [site.socGkg != null ? clamp01((site.socGkg - 4) / 16) : null, site.cec != null ? clamp01((site.cec - 4) / 16) : null].filter((v): v is number => v != null);
  const fert = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  const fertClass = fert == null ? null : fert < 1 / 3 ? 'low' : fert < 2 / 3 ? 'moderate' : 'high';
  add('fertility', tx('Soil fertility (organic carbon, CEC)', 'Độ phì (carbon hữu cơ, CEC)'), rank(ORDER.fertility, fertClass, req.fertility, true), w.fertility, fertClass, req.fertility?.opt ?? '?', 'manageable', 'soil', undefined, fertClass == null ? missing : undefined);
  const flat = crop.lifeSpan === 'perennial' ? 9 : 4.6; // 16 % and 8 % slope (GAEZ v4 terrain classes)
  const steep = crop.lifeSpan === 'perennial' ? 24 : 16.7; // 45 % and 30 %
  add('slope', tx('Slope', 'Độ dốc'), site.slopeDeg == null ? null : site.slopeDeg <= flat ? 1 : Math.max(0.15, 1 - (0.85 * (site.slopeDeg - flat)) / (steep - flat)), w.slope, site.slopeDeg, `<= ${flat}`, 'fixed', 'terrain', '°', site.slopeDeg == null ? missing : undefined);

  // Gates: multipliers outside the weighted product. Each one asks for local review.
  const reviewNote = tx('Outside what the crop database records for this crop: needs local review.', 'Nằm ngoài phạm vi cơ sở dữ liệu ghi nhận cho cây này: cần chuyên gia địa phương xem xét.');
  if (season?.kill != null) add('frost', tx('Killing temperature', 'Nhiệt độ gây chết'), season.kill, 1, null, `> ${(req.killTempC ?? 0) + KILL_MARGIN_C} °C`, 'fixed', 'agromet', undefined, season.kill === 0 ? tx('A month of the season has nights cold enough to kill the crop.', 'Có tháng trong vụ đêm lạnh đến mức làm chết cây.') : undefined);
  if (climate?.zones.length && req.climateZones?.length) {
    const ok = climate.zones.some((z) => req.climateZones!.includes(z));
    add('climateZone', tx('Climate zone', 'Vùng khí hậu'), ok ? 1 : crop.curated ? GATE.zoneCurated : GATE.zoneRaw, 1, climate.zones.join('/'), req.climateZones.join(' '), 'fixed', 'agromet', undefined, ok ? undefined : reviewNote);
  }
  if (season?.photo != null) add('photoperiod', tx('Day length', 'Độ dài ngày'), season.photo, 1, null, req.photoperiod!.join(', '), 'choice', 'agromet', undefined, season.photo < 1 ? reviewNote : undefined);
  if (req.latitudeAbs) {
    const limit = site.lat >= 0 ? req.latitudeAbs[1] : req.latitudeAbs[0];
    if (Math.abs(site.lat) > limit + 3) add('latitude', tx('Latitude', 'Vĩ độ'), GATE.latitude, 1, round(site.lat, 1), `<= ${limit}°`, 'fixed', 'terrain', '°', reviewNote);
  }
  if (req.altitudeMaxM != null && site.elevationM != null && site.elevationM > req.altitudeMaxM * 1.1) add('altitude', tx('Altitude', 'Độ cao'), GATE.altitude, 1, site.elevationM, `<= ${req.altitudeMaxM}`, 'fixed', 'terrain', 'm', reviewNote);

  let score = 1;
  let limiting: FactorScore | null = null;
  let worst = 1;
  for (const f of factors) {
    if (f.score == null) continue;
    const contribution = f.score ** f.weight;
    score *= contribution;
    if (contribution < worst - 1e-9) (worst = contribution), (limiting = f);
  }
  return { score, factors, limiting, season, month, review: !crop.curated || factors.some((f) => f.note === reviewNote) };
}

interface YearStats {
  yearsOk: number;
  yearsTotal: number;
  scores: number[];
}
/** EcoCrop climate score (min of temperature, water and the kill gate) of every year for one sowing month. */
function yearStats(crop: CropProfile, site: Site, c: Climate, month: number, irrigation: GroundTruth['irrigation']): YearStats {
  const n = windowMonths(crop);
  const scores: number[] = [];
  for (let y = 0; y < c.years; y++) {
    const start = y * 12 + month - 1;
    if (start + Math.max(n, crop.lifeSpan === 'perennial' ? 12 : n) > c.years * 12) break;
    const s = seasonFit(crop, c, start, false, site, irrigation);
    if (s.temp == null || s.water == null) continue;
    scores.push(Math.min(s.temp, s.water, s.kill ?? 1));
  }
  return { yearsOk: scores.filter((s) => s >= RELIABILITY_THRESHOLD).length, yearsTotal: scores.length, scores };
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
  needsLocalReview: boolean;
}

export interface AssessOptions {
  /** 1-12; overrides the ground-truth sowing date and the best-window search. */
  sowingMonth?: number;
  irrigation?: GroundTruth['irrigation'];
}

const sources = (t: FieldTelemetry) => ({ soil: t.branches.soil?.sources[0], terrain: t.branches.terrain?.sources[0], climate: t.climateSourceId });

function assess(crop: CropProfile, input: ModelInput, site: Site, climate: Climate | null, opts: AssessOptions = {}): CropAssessment & { fits: Fit[]; stats: (YearStats | null)[] } {
  const irrigation = opts.irrigation ?? input.groundTruth.irrigation ?? 'rainfed';
  const src = sources(input.telemetry);
  const fits: Fit[] = [];
  const stats: (YearStats | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    fits.push(fitFor(crop, site, climate, m, irrigation, src));
    stats.push(climate ? yearStats(crop, site, climate, m, irrigation) : null);
  }
  const rel = (i: number) => (stats[i]?.yearsTotal ? stats[i]!.yearsOk / stats[i]!.yearsTotal : 0);
  let best = 0;
  for (let i = 1; i < 12; i++) if (fits[i].score > fits[best].score + 1e-9 || (Math.abs(fits[i].score - fits[best].score) <= 1e-9 && rel(i) > rel(best) + 1e-9)) best = i;
  const gtMonth = input.groundTruth.sowingDate ? Number(input.groundTruth.sowingDate.slice(5, 7)) : undefined;
  const month = opts.sowingMonth ?? gtMonth ?? best + 1;
  const fit = fits[month - 1];
  const st = stats[month - 1];
  const factors = [...fit.factors];
  let limiting = fit.limiting;
  // The sowing date is a free choice: show what the chosen month costs against the best one.
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
      note: tx('Share of the best window\'s score reached by this sowing month; already inside temperature and water.', 'Tỉ lệ điểm so với thời vụ tốt nhất; đã nằm trong điểm nhiệt độ và nước.'),
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

export interface CropRanking {
  cropId: string;
  compatibility: number;
  reliability: number | null;
  bestSowingMonth: number;
  limiting: string | null;
  /** compatibility x (0.5 + 0.5 reliability): the second stage that separates crops tied at 100. */
  rankScore: number;
}

/** Second-stage ranking of the curated crops (or `cropIds`) at their best sowing window. */
export function rankCrops(input: ModelInput, opts: { limit?: number; cropIds?: string[]; irrigation?: GroundTruth['irrigation'] } = {}): CropRanking[] {
  const site = buildSite(input);
  const climate = prepare(input).climate;
  const avoid = new Set(input.groundTruth.avoidCropIds ?? []);
  const crops = (opts.cropIds?.map((id) => getCrop(id)).filter((c): c is CropProfile => !!c) ?? listCrops()).filter((c) => !avoid.has(c.id));
  const out = crops.map((crop) => {
    const a = assess(crop, { ...input, groundTruth: { ...input.groundTruth, sowingDate: undefined } }, site, climate, { irrigation: opts.irrigation });
    const reliability = a.reliability ? a.reliability.yearsOk / a.reliability.yearsTotal : null;
    return { cropId: crop.id, compatibility: round(a.bestCompatibility, 3), reliability, bestSowingMonth: a.bestSowingMonth, limiting: a.limiting?.key ?? null, rankScore: round(a.bestCompatibility * (0.5 + 0.5 * (reliability ?? 0.5)), 4) };
  });
  out.sort((x, y) => y.rankScore - x.rankScore || x.cropId.localeCompare(y.cropId));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

// ------------------------------------------------------------------------------------------------
// Growth stages and the daily water balance
// ------------------------------------------------------------------------------------------------

const STAGE_LABEL: Record<StageId, I18nText> = {
  fallow: tx('Fallow / rest', 'Đất nghỉ / cây nghỉ'),
  'pre-sowing': tx('Before sowing', 'Trước gieo'),
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

function kcAt(crop: CropProfile, stage: GrowthStage): number {
  const w = crop.water;
  const kc = w?.kc ?? { ini: 0.5, mid: 1.05, end: 0.7 };
  const [a, b, c, d] = w?.stages ?? DEFAULT_STAGES;
  const f = stage.progress;
  switch (stage.id) {
    case 'initial':
      return kc.ini;
    case 'development':
      return kc.ini + ((kc.mid - kc.ini) * (f - a)) / b;
    case 'mid-season':
      return kc.mid;
    case 'late-season':
      return kc.mid + ((kc.end - kc.mid) * (f - a - b - c)) / d;
    default:
      return crop.lifeSpan === 'perennial' ? kc.ini : FALLOW_KC;
  }
}

interface Balance {
  ks: Float64Array;
  /** Sums over in-season days. */
  eta: number;
  etc: number;
  irrigationMm: number;
  irrigation: Float64Array;
}

/** FAO-56 daily root-zone water balance (eq. 82-86) with curve-number runoff; two passes so the start is not arbitrary. */
function waterBalance(d: Daily, kc: Float64Array, inSeason: Uint8Array, seasonStart: Uint8Array, taw: number, pTable: number, cn: number, irrigation: GroundTruth['irrigation'], budgetMm: number, rainFactor: number): Balance {
  const ks = new Float64Array(d.n).fill(1);
  const irr = new Float64Array(d.n);
  const s = 25400 / cn - 254;
  let dr = taw / 2;
  let eta = 0;
  let etc = 0;
  let total = 0;
  let budget = budgetMm;
  for (let pass = 0; pass < 2; pass++) {
    eta = etc = total = 0;
    for (let i = 0; i < d.n; i++) {
      if (seasonStart[i]) budget = budgetMm;
      const demand = kc[i] * d.et0[i];
      const raw = clamp(pTable + 0.04 * (5 - demand), 0.1, 0.8) * taw;
      let water = 0;
      if (irrigation !== 'rainfed' && inSeason[i] && dr > raw && budget > 0) {
        water = Math.min(dr, budget);
        budget -= water;
        dr -= water;
      }
      const k = dr > raw ? Math.max(0, (taw - dr) / (taw - raw)) : 1;
      const p = d.rain[i] * rainFactor;
      const runoff = p > 0.2 * s ? (p - 0.2 * s) ** 2 / (p + 0.8 * s) : 0;
      const effective = p < 0.2 * d.et0[i] ? 0 : p - runoff; // FAO-56: tiny showers evaporate
      dr = clamp(dr - effective + k * demand, 0, taw);
      if (pass === 1) {
        ks[i] = k;
        irr[i] = water;
        if (inSeason[i]) (eta += k * demand), (etc += demand), (total += water);
      }
    }
  }
  return { ks, eta, etc, irrigationMm: total, irrigation: irr };
}

function trailingMean(a: Float64Array, i: number, n: number): number {
  let s = 0;
  let c = 0;
  for (let k = Math.max(0, i - n + 1); k <= i; k++) if (!Number.isNaN(a[k])) (s += a[k]), c++;
  return c ? s / c : NaN;
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

export function computeScoreDetail(input: ModelInput, opts: { snapshots?: boolean } = {}): ScoreDetail {
  const { telemetry: t, groundTruth: gt } = input;
  const crop = getCrop(input.cropId);
  const site = buildSite(input);
  const { climate, daily: d } = prepare(input);
  const a = crop ? assess(crop, input, site, climate) : null;
  const irrigation = gt.irrigation ?? 'rainfed';
  const calibration = [...site.calibration];
  if (gt.irrigation && gt.irrigation !== 'rainfed') calibration.push({ key: 'irrigation', label: tx('Irrigation', 'Tưới'), satellite: 'rainfed', ground: gt.irrigation, effect: gt.irrigation === 'full' ? tx('Rainfall is no longer a limiting factor; the water balance irrigates on demand.', 'Mưa không còn là yếu tố giới hạn; cân bằng nước tưới theo nhu cầu.') : tx('Irrigation closes part of the deficit, up to 30 % of the crop\'s optimal season water.', 'Tưới bù một phần thiếu hụt, tối đa 30 % nhu cầu nước tối ưu của vụ.') });
  if (crop && a && !a.sowingAssumed && gt.sowingDate) calibration.push({ key: 'sowing', label: tx('Sowing date', 'Ngày gieo'), satellite: `month ${a.bestSowingMonth} (best window)`, ground: gt.sowingDate, effect: tx('Growth stages are anchored on this date.', 'Các giai đoạn sinh trưởng được tính từ ngày này.') });
  const bias = rainBias(input, d, calibration);

  // Stage calendar: the farmer's sowing date, else day 1 of the best month, repeated every year.
  const sowDoy = crop && a ? (gt.sowingDate ? dayOfYear(gt.sowingDate) : dayOfYear(`2025-${String(a.sowingMonth).padStart(2, '0')}-01`)) : 1;
  const stages: (GrowthStage | null)[] = new Array(d.n).fill(null);
  const kc = new Float64Array(d.n).fill(1);
  const inSeason = new Uint8Array(d.n);
  const seasonStart = new Uint8Array(d.n);
  if (crop) {
    const cache = new Map<number, GrowthStage>();
    for (let i = 0; i < d.n; i++) {
      const dis = (Math.min(d.doy[i], 365) - sowDoy + 365) % 365;
      let st = cache.get(dis);
      if (!st) cache.set(dis, (st = stageAt(crop, dis)));
      stages[i] = st;
      kc[i] = kcAt(crop, st);
      inSeason[i] = st.dayInSeason != null && st.id !== 'harvest' ? 1 : 0;
      seasonStart[i] = dis === 0 ? 1 : 0;
    }
  } else inSeason.fill(1);

  const tempC = crop?.req.tempC ?? GENERIC_TEMP;
  const texture = site.texture ?? 'medium';
  const zr = crop?.water?.rootDepthM ?? 1;
  const optWater = crop ? crop.req.rainMm[1] * Math.min(1, windowMonths(crop) / 4) : 0;
  const reliable = gt.waterReliability === 'often-short' ? SUPPLEMENTAL_SHARE : gt.waterReliability === 'dry-season-short' ? 2 * SUPPLEMENTAL_SHARE : Infinity;
  const budget = !crop ? Infinity : irrigation === 'supplemental' ? SUPPLEMENTAL_SHARE * optWater : reliable * optWater;
  const bal = d.hasWater ? waterBalance(d, kc, inSeason, seasonStart, 1000 * site.awc * zr, crop?.water?.depletionFraction ?? 0.5, CN_BY_TEXTURE[texture], crop ? irrigation : 'rainfed', budget, bias) : null;
  const ky = Math.min(1.5, crop?.water?.ky ?? 1);

  // Season outcome: soil and temperature fit x the more limiting of rainfall adequacy and the FAO-33 response.
  const waterFactor = a?.factors.find((f) => f.key === 'water')?.score ?? null;
  const f33 = bal && bal.etc > 0 ? clamp01(1 - ky * (1 - bal.eta / bal.etc)) : null;
  const nonWater = a ? (waterFactor != null && waterFactor > 0 ? a.compatibility / waterFactor : waterFactor === 0 ? 0 : a.compatibility) : null;
  const expected = a && nonWater != null ? clamp01(nonWater * Math.min(waterFactor ?? 1, f33 ?? 1)) : null;
  const yieldFractions = a && nonWater != null ? a.yearScores.map((s) => clamp01(nonWater * Math.min(s, 1) * (a.factors.find((f) => f.key === 'temperature')?.score ? 1 : 1))) : [];

  const compat = a ? a.compatibility : null;
  const confStatic = a ? (climate ? 0.5 * branchConfidence(t, ['agromet', 'rainfall']) : 0) + 0.5 * (site.groundKeys.size ? Math.max(0.9, branchConfidence(t, ['soil'])) : branchConfidence(t, ['soil'])) : 0;
  const confDyn = (bal ? 0.5 * branchConfidence(t, ['rainfall', 'agromet']) : 0) + (d.hasTemp ? 0.3 * branchConfidence(t, ['agromet']) : 0) + 0.2 * branchConfidence(t, ['vegetation']);
  const confidence = round(clamp01(a ? 0.5 * confStatic + 0.5 * confDyn : confDyn), 2);

  const snapshots: ScoreSnapshot[] = [];
  const staticFactors = a?.factors ?? [];
  let sum = 0;
  let count = 0;
  let nowScore = 0;
  const dyn = (key: string, label: I18nText, score: number, weight: number, actual: number | null, ideal: string, kind: FactorKind, branch: BranchId, unit?: string): FactorScore => ({ key, label, score: round(score, 3), weight, actual, ideal, kind, branch, ...(unit ? { unit } : {}) });
  for (let i = 0; i < d.n; i++) {
    const stage = stages[i];
    const active = !crop || inSeason[i] === 1;
    const t7 = trailingMean(d.tMean, i, 7);
    const heat = Number.isNaN(t7) ? null : t7 > tempC[2] ? clamp01((tempC[3] - t7) / (tempC[3] - tempC[2])) : 1;
    let cold = Number.isNaN(t7) ? null : t7 < tempC[1] ? clamp01((t7 - tempC[0]) / (tempC[1] - tempC[0])) : 1;
    if (cold != null && crop?.req.killTempC != null && active && !Number.isNaN(d.tMin[i]) && d.tMin[i] <= crop.req.killTempC) cold = Math.min(cold, 0.1);
    const ksNow = bal ? bal.ks[i] : null;
    const sens = active && stage ? (STAGE_SENSITIVITY[stage.id] ?? 1) : 0.5;
    const waterIdx = ksNow == null ? null : clamp01(1 - ky * sens * (1 - ksNow));
    const thermal = heat == null || cold == null ? null : Math.min(heat, cold);
    const model = waterIdx == null && thermal == null ? null : (waterIdx ?? 1) * (thermal ?? 1);
    const ndvi = active && !Number.isNaN(d.ndviScore[i]) ? d.ndviScore[i] : null;
    const esi = !Number.isNaN(d.esiScore[i]) ? d.esiScore[i] : null;
    const observed = ndvi == null && esi == null ? null : ((ndvi ?? 0) * (ndvi == null ? 0 : 0.65) + (esi ?? 0) * (esi == null ? 0 : 0.35)) / ((ndvi == null ? 0 : 0.65) + (esi == null ? 0 : 0.35));
    // No dynamic data at all is "no stress detected", shown with zero dynamic confidence.
    const k = model == null ? (observed ?? 1) : observed == null ? model : (1 - OBSERVED_BLEND) * model + OBSERVED_BLEND * observed;
    const condition = Math.round(100 * k);
    const productivity = compat == null ? condition : Math.round(100 * compat * k);
    if (active) (sum += productivity), count++;
    nowScore = productivity;
    if (opts.snapshots === false) continue;

    const factors: FactorScore[] = [...staticFactors];
    if (ksNow != null) factors.push(dyn('rootWater', tx('Root-zone water (water balance)', 'Nước vùng rễ (cân bằng nước)'), waterIdx!, 1, round(ksNow, 2), 'Ks = 1', 'manageable', 'rainfall'));
    if (heat != null) factors.push(dyn('heat', tx('Heat stress', 'Stress nóng'), heat, 1, round(t7, 1), `<= ${tempC[2]}`, 'fixed', 'agromet', '°C'));
    if (cold != null) factors.push(dyn('cold', tx('Cold stress', 'Stress lạnh'), cold, 1, round(t7, 1), `>= ${tempC[1]}`, 'fixed', 'agromet', '°C'));
    if (ndvi != null) factors.push(dyn('vigor', tx('Vegetation vigour against its own normal', 'Sức sống thảm thực vật so với mức thường năm'), ndvi, OBSERVED_BLEND * 0.65, null, 'NDVI >= normal', 'fixed', 'vegetation'));
    if (esi != null) factors.push(dyn('evapStress', tx('Evaporative stress', 'Stress bốc thoát hơi'), esi, OBSERVED_BLEND * 0.35, null, 'ESI >= -0.5', 'fixed', 'thermal', 'σ'));
    let limiting: FactorScore | null = null;
    let worst = 0.98;
    for (const f of factors) {
      if (f.score == null || f.weight === 0) continue;
      const c = f.score ** Math.min(1, f.weight);
      if (c < worst) (worst = c), (limiting = f);
    }
    if (limiting) factors[factors.indexOf(limiting)] = { ...limiting, limiting: true };
    snapshots.push({ t: addDays(d.start, i), productivity, condition, compatibility: compat == null ? null : Math.round(100 * compat), stage, factors, limiting: limiting?.key ?? null, confidence });
  }

  const cropName = crop?.names;
  const pct = compat == null ? null : Math.round(100 * compat);
  const cls = (p: number) => (p >= 80 ? ['very suitable', 'rất thích hợp'] : p >= 60 ? ['suitable', 'thích hợp'] : p >= 40 ? ['moderately suitable', 'thích hợp vừa'] : p >= 20 ? ['marginally suitable', 'ít thích hợp'] : ['not suitable', 'không thích hợp']);
  const lim = a?.limiting;
  const rel = a?.reliability;
  const headline: I18nText =
    crop && pct != null
      ? tx(
          `${cropName!.en}: ${cls(pct)[0]} (${pct}/100)${lim ? `, limited by ${lim.label.en.toLowerCase()}` : ''}${rel ? `; the season met its needs in ${rel.yearsOk} of ${rel.yearsTotal} years` : ''}${a!.needsLocalReview ? '. Needs local review.' : '.'}`,
          `${cropName!.vi ?? cropName!.en}: ${cls(pct)[1]} (${pct}/100)${lim ? `, giới hạn bởi ${lim.label.vi.toLowerCase()}` : ''}${rel ? `; vụ đáp ứng nhu cầu của cây trong ${rel.yearsOk}/${rel.yearsTotal} năm` : ''}${a!.needsLocalReview ? '. Cần chuyên gia địa phương xem xét.' : '.'}`,
        )
      : tx('Growing conditions for a generic crop (choose a crop for a crop-specific score).', 'Điều kiện sinh trưởng cho cây trồng chung (chọn cây để có điểm riêng).');

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
        calibration,
        headline,
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
export function scanSowingWindows(input: ModelInput): SowingWindow[] {
  const crop = getCrop(input.cropId);
  if (!crop) return [];
  const a = assess(crop, input, buildSite(input), prepare(input).climate);
  return a.fits.map((f, i) => ({ month: i + 1, score: Math.round(100 * f.score), reliability: a.stats[i]?.yearsTotal ? round(a.stats[i]!.yearsOk / a.stats[i]!.yearsTotal, 2) : null, limiting: f.limiting?.key ?? null }));
}

const seasonScore = (input: ModelInput): number => {
  const s = computeScoreDetail(input, { snapshots: false }).timeline.summary;
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
    out.push({ label, changedFactor, before, after, delta: after - before });
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
