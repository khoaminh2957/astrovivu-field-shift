/**
 * Peer-reviewed mathematical foundations for Astrovivu-AEZ v2 crop suitability and dynamic yield
 * scoring. Pure, deterministic TypeScript; every constant and equation is traced to its primary
 * publication (full derivations and references in docs/SCORING_PAPER.md and docs/SCORING.md).
 *
 * Key references implemented here:
 *  - Saaty (1980, 1987) Analytic Hierarchy Process eigenvector weights & Consistency Ratio (CR)
 *  - Akinci et al. (2013), Herzberg et al. (2019), Pilevar et al. (2020), Tashayo et al. (2020)
 *    AHP hierarchy for agro-climatic, chemical-hydrologic edaphic, physical edaphic & slope tiers
 *  - Khiddir (1986) & Sys, Van Ranst & Debaveye (1991) Square-Root Parametric land index
 *  - Storie (1933, 1978) multiplicative index & Fischer et al. (2021) FAO/IIASA GAEZ v4 damping
 *  - Maas & Hoffman (1977, DOI:10.1061/JRCEA4.0001137) continuous threshold-slope salinity response
 *  - Oldfield, Bradford & Wood (2019, SOIL, DOI:10.5194/soil-5-15-2019) & Sanchez et al. (2003)
 *    Michaelis-Menten saturating soil organic carbon & CEC fertility response
 *  - Borg & Grimes (1986, Trans. ASAE, DOI:10.13031/2013.30125) sigmoidal root depth growth Zr(t)
 *  - Allen et al. (1998, FAO-56 eq. 11, 14, 62, 65, 70) climatic adjustment of Kc,mid and Kc,end
 *  - Feddes et al. (1978) & Raes et al. (2009, AquaCrop, DOI:10.2134/agronj2008.0140s) anaerobiosis
 *    waterlogging stress factor Kaer under poor drainage
 *  - Schlenker & Roberts (2009, PNAS, DOI:10.1073/pnas.0906865106) & Sánchez et al. (2014, GCB,
 *    DOI:10.1111/gcb.12389) asymmetric daytime Tmax reproductive heat shock
 *  - Monteith (1977, Phil. Trans. R. Soc. B, DOI:10.1098/rstb.1977.0140) PAR light saturation
 *  - Anderson et al. (2011), Reichle et al. (2019), Ines et al. (2013) multi-sensor EO assimilation
 */
import type { CropProfile, FertilityClass, Quad, SalinityClass, StageId } from '@/contracts';
import { clamp, clamp01, round } from './math';

// ------------------------------------------------------------------------------------------------
// 1. Saaty (1980) Analytic Hierarchy Process (AHP) Pairwise Matrix & Eigenvector Solver
// ------------------------------------------------------------------------------------------------

export const GRADED_FACTOR_KEYS = [
  'temperature',
  'water',
  'ph',
  'salinity',
  'drainage',
  'texture',
  'depth',
  'fertility',
  'slope',
] as const;

export type GradedFactorKey = (typeof GRADED_FACTOR_KEYS)[number];

/** Saaty (1980) average Random Consistency Index RI_n for n = 1..12. */
export const SAATY_RI: readonly number[] = [0, 0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49, 1.51, 1.48];

/**
 * Reciprocal 9x9 Saaty pairwise comparison matrix across the nine graded biophysical factors,
 * structured into four agro-ecological criticality tiers synthesized from Akinci et al. (2013),
 * Herzberg et al. (2019, Central Vietnam), Pilevar et al. (2020) and Tashayo et al. (2020):
 *   Tier 1 (Agro-climatic primary):           temperature, water
 *   Tier 2 (Manageable chemical/hydrologic):  ph, salinity, drainage  (1/2 vs T1)
 *   Tier 3 (Intrinsic physical edaphic):      texture, depth          (1/4 vs T1, 1/2 vs T2)
 *   Tier 4 (Fertility proxy & topography):    fertility, slope        (1/5 vs T1, 1/3 vs T2, 1 vs T3)
 * Every entry uses standard integer Saaty judgements {1, 2, 3, 4, 5} and exact reciprocals.
 */
export const AHP_PAIRWISE_MATRIX: readonly (readonly number[])[] = [
  // temp  water  ph     sal    drain  tex    depth  fert   slope
  [1, 1, 2, 2, 2, 4, 4, 5, 5], // temperature
  [1, 1, 2, 2, 2, 4, 4, 5, 5], // water
  [1 / 2, 1 / 2, 1, 1, 1, 2, 2, 3, 3], // ph
  [1 / 2, 1 / 2, 1, 1, 1, 2, 2, 3, 3], // salinity
  [1 / 2, 1 / 2, 1, 1, 1, 2, 2, 3, 3], // drainage
  [1 / 4, 1 / 4, 1 / 2, 1 / 2, 1 / 2, 1, 1, 1, 1], // texture
  [1 / 4, 1 / 4, 1 / 2, 1 / 2, 1 / 2, 1, 1, 1, 1], // depth
  [1 / 5, 1 / 5, 1 / 3, 1 / 3, 1 / 3, 1, 1, 1, 1], // fertility
  [1 / 5, 1 / 5, 1 / 3, 1 / 3, 1 / 3, 1, 1, 1, 1], // slope
];

export interface AhpSolution {
  /** Normalized principal right eigenvector (sum = 1). */
  weights: Record<GradedFactorKey, number>;
  /** Max-normalized exponents alpha_i = w_i / max_j(w_j) so primary climate factors act at 1.0. */
  exponents: Record<GradedFactorKey, number>;
  /** Principal eigenvalue lambda_max (power iteration, tol 1e-12). */
  lambdaMax: number;
  /** Consistency Index CI = (lambda_max - n) / (n - 1). */
  ci: number;
  /** Consistency Ratio CR = CI / RI_n; Saaty requires CR < 0.10. */
  cr: number;
}

/** Exact principal right eigenvector of a positive reciprocal matrix via power iteration. */
export function solveAhpMatrix(matrix: readonly (readonly number[])[]): AhpSolution {
  const n = matrix.length;
  let v = new Float64Array(n).fill(1 / n);
  const next = new Float64Array(n);
  for (let iter = 0; iter < 120; iter++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const row = matrix[i];
      for (let j = 0; j < n; j++) s += row[j] * v[j];
      next[i] = s;
      sum += s;
    }
    let diff = 0;
    for (let i = 0; i < n; i++) {
      const nv = next[i] / sum;
      diff = Math.max(diff, Math.abs(nv - v[i]));
      v[i] = nv;
    }
    if (diff < 1e-13) break;
  }
  let lambdaMax = 0;
  for (let i = 0; i < n; i++) {
    let av = 0;
    for (let j = 0; j < n; j++) av += matrix[i][j] * v[j];
    lambdaMax += av / v[i];
  }
  lambdaMax /= n;
  const ci = n > 1 ? Math.max(0, (lambdaMax - n) / (n - 1)) : 0;
  const ri = SAATY_RI[n] ?? 1.49;
  const cr = ri > 0 ? ci / ri : 0;
  const maxW = Math.max(...v);
  const weights = {} as Record<GradedFactorKey, number>;
  const exponents = {} as Record<GradedFactorKey, number>;
  GRADED_FACTOR_KEYS.forEach((k, i) => {
    weights[k] = round(v[i], 6);
    exponents[k] = round(v[i] / maxW, 4);
  });
  return { weights, exponents, lambdaMax: round(lambdaMax, 6), ci: round(ci, 6), cr: round(cr, 6) };
}

export const AHP_SOLUTION: AhpSolution = solveAhpMatrix(AHP_PAIRWISE_MATRIX);

// ------------------------------------------------------------------------------------------------
// 2. Parametric Aggregation Models (WLC, Storie, Khiddir SQRI, Pure Geometric, Astrovivu-AEZ v2)
// ------------------------------------------------------------------------------------------------

export type ParametricMethod = 'wlc' | 'storie' | 'khiddir' | 'ecocrop-gaez' | 'astrovivu-v2';

export interface AggregationItem {
  key: string;
  /** Factor score in [0, 1], or null when missing (never scored as zero). */
  score: number | null;
  /** Max-normalized AHP exponent alpha_i (1.0 for gates and primary climate). */
  weight: number;
  /** True for non-compensatory bioclimatic/geographical gates outside the graded 9 factors. */
  isGate?: boolean;
}

const CLIMATIC_KEYS = new Set(['temperature', 'water']);

/**
 * Combines graded factor scores and gates under one of five literature aggregation methods.
 * `astrovivu-v2` applies full Liebig-Ramirez-Villegas multiplication on primary climate factors
 * and Khiddir-GAEZ harmonic-root rank damping (1 / sqrt(rank)) on secondary edaphic/terrain
 * limitations, preserving exact single-factor exponents, continuity at ties, strict monotonicity
 * and zero-veto while preventing Storie's multi-factor compounding collapse.
 */
export function aggregateSuitability(items: readonly AggregationItem[], method: ParametricMethod = 'astrovivu-v2'): { score: number; limitingIndex: number } {
  let gateProduct = 1;
  let limitingIndex = -1;
  let worstContribution = 1;
  const graded: { idx: number; key: string; s: number; w: number }[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.score == null || it.weight <= 0) continue;
    const s = clamp01(it.score);
    if (it.isGate) {
      gateProduct *= s ** it.weight;
      if (s ** it.weight < worstContribution - 1e-9) {
        worstContribution = s ** it.weight;
        limitingIndex = i;
      }
    } else {
      graded.push({ idx: i, key: it.key, s, w: it.weight });
    }
  }
  if (!graded.length) return { score: gateProduct, limitingIndex };

  let gradedScore = 1;
  switch (method) {
    case 'wlc': {
      let wSum = 0;
      let acc = 0;
      for (const g of graded) {
        acc += g.w * g.s;
        wSum += g.w;
        const c = g.s ** Math.min(1, g.w);
        if (c < worstContribution - 1e-9) (worstContribution = c), (limitingIndex = g.idx);
      }
      gradedScore = wSum > 0 ? acc / wSum : 1;
      break;
    }
    case 'storie': {
      for (const g of graded) {
        gradedScore *= g.s;
        if (g.s < worstContribution - 1e-9) (worstContribution = g.s), (limitingIndex = g.idx);
      }
      break;
    }
    case 'khiddir': {
      let minPos = 0;
      for (let k = 1; k < graded.length; k++) if (graded[k].s < graded[minPos].s) minPos = k;
      let rest = 1;
      for (let k = 0; k < graded.length; k++) {
        if (k !== minPos) rest *= graded[k].s;
        if (graded[k].s < worstContribution - 1e-9) (worstContribution = graded[k].s), (limitingIndex = graded[k].idx);
      }
      gradedScore = graded[minPos].s * Math.sqrt(rest);
      break;
    }
    case 'ecocrop-gaez': {
      for (const g of graded) {
        const c = g.s ** g.w;
        gradedScore *= c;
        if (c < worstContribution - 1e-9) (worstContribution = c), (limitingIndex = g.idx);
      }
      break;
    }
    case 'astrovivu-v2': {
      const edaphic: { idx: number; c: number }[] = [];
      for (const g of graded) {
        const c = g.s ** g.w;
        if (c < worstContribution - 1e-9) (worstContribution = c), (limitingIndex = g.idx);
        if (CLIMATIC_KEYS.has(g.key)) gradedScore *= c;
        else edaphic.push({ idx: g.idx, c });
      }
      // Sort edaphic/terrain contributions most-limiting first; rank 1 acts at full AHP exponent,
      // rank r >= 2 is damped by 1/sqrt(r) (Khiddir 1986; Sys et al. 1991; GAEZ v4).
      edaphic.sort((a, b) => a.c - b.c);
      for (let r = 0; r < edaphic.length; r++) {
        const c = edaphic[r].c;
        if (c <= 0) {
          gradedScore = 0;
          break;
        }
        gradedScore *= r === 0 ? c : c ** (1 / Math.sqrt(r + 1));
      }
      break;
    }
  }
  return { score: clamp01(gradedScore * gateProduct), limitingIndex };
}

// ------------------------------------------------------------------------------------------------
// 3. Continuous Edaphic Responses: Maas-Hoffman (1977) Salinity & Oldfield et al. (2019) Fertility
// ------------------------------------------------------------------------------------------------

/**
 * Maas & Hoffman (1977, eq. 1) & FAO-56 Table 23 representative threshold `a` (dS/m) and linear
 * yield-decline slope `b` (fraction per dS/m above `a`) for the four EcoCrop salinity classes.
 */
export const MAAS_HOFFMAN_PARAMS: Record<SalinityClass, { thresholdDsM: number; slopePerDsM: number }> = {
  none: { thresholdDsM: 1.3, slopePerDsM: 0.14 }, // sensitive (beans, onion, coffee, strawberry)
  low: { thresholdDsM: 2.0, slopePerDsM: 0.095 }, // moderately sensitive (maize, rice, alfalfa, groundnut)
  medium: { thresholdDsM: 4.5, slopePerDsM: 0.065 }, // moderately tolerant (soybean, wheat, sorghum)
  high: { thresholdDsM: 8.0, slopePerDsM: 0.045 }, // tolerant (barley, canola, coconut)
};

/** Continuous Maas-Hoffman relative yield suitability for electrical conductivity `ecDsM`. */
export function maasHoffmanSalinity(ecDsM: number | null, need: { opt: SalinityClass; abs: SalinityClass } | undefined): number | null {
  if (ecDsM == null || !need) return null;
  if (ecDsM <= 0) return 1;
  // Anchor the zero-loss threshold on the optimal tolerance class and the slope on the tolerated limit.
  const optP = MAAS_HOFFMAN_PARAMS[need.opt];
  const absP = MAAS_HOFFMAN_PARAMS[need.abs];
  const a = optP.thresholdDsM;
  const b = Math.min(optP.slopePerDsM, absP.slopePerDsM);
  if (ecDsM <= a) return 1;
  return clamp(1 - b * (ecDsM - a), 0.1, 1);
}

/**
 * Continuous soil fertility index grounded in Oldfield, Bradford & Wood (2019, SOIL 5:15-32) global
 * meta-analysis (yield plateau at ~20 g SOC/kg = 2% SOC, Michaelis-Menten half-saturation ~8 g/kg)
 * and Sanchez et al. (2003, Geoderma) tropical CEC capacity (plateau at 20 cmol(+)/kg).
 */
export function oldfieldFertilityIndex(socGkg: number | null, cecCmolKg: number | null): number | null {
  const parts: number[] = [];
  if (socGkg != null && socGkg >= 0) {
    const km = 8;
    parts.push(socGkg >= 20 ? 1 : clamp01((socGkg / 20) * ((20 + km) / (socGkg + km))));
  }
  if (cecCmolKg != null && cecCmolKg >= 0) {
    const km = 8;
    parts.push(cecCmolKg >= 20 ? 1 : clamp01((cecCmolKg / 20) * ((20 + km) / (cecCmolKg + km))));
  }
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

const FERTILITY_OPT_THRESHOLD: Record<FertilityClass, number> = { low: 0.3, moderate: 0.55, high: 0.78 };
const FERTILITY_ABS_THRESHOLD: Record<FertilityClass, number> = { low: 0.12, moderate: 0.28, high: 0.45 };

/** Continuous fertility factor score in [0.20, 1.0] (manageable via fertilization, never zero). */
export function scoreFertilityContinuous(fertIndex: number | null, need: { opt: FertilityClass; abs: FertilityClass } | undefined): number | null {
  if (fertIndex == null || !need) return null;
  const tOpt = FERTILITY_OPT_THRESHOLD[need.opt];
  const tAbs = Math.min(tOpt - 0.05, FERTILITY_ABS_THRESHOLD[need.abs]);
  if (fertIndex >= tOpt) return 1;
  if (fertIndex >= tAbs) return 0.7 + (0.3 * (fertIndex - tAbs)) / Math.max(0.05, tOpt - tAbs);
  return 0.2 + (0.5 * Math.max(0, fertIndex)) / Math.max(0.05, tAbs);
}

// ------------------------------------------------------------------------------------------------
// 4. Borg & Grimes (1986) Dynamic Root Growth & FAO-56 Eq. 62/65 Climatic Kc Adjustment
// ------------------------------------------------------------------------------------------------

/**
 * Borg & Grimes (1986, Trans. ASAE 29:194-197, eq. 3) sigmoidal root-zone expansion from planting
 * depth Zr,min (0.15 m) to Zr,max at the end of vegetative development. Established perennials
 * maintain their full effective root zone Zr,max year-round.
 */
export function borgGrimesRootDepth(dayInSeason: number | null, rootDevDays: number, zrMax: number, isPerennial: boolean): number {
  if (isPerennial || dayInSeason == null) return zrMax;
  const zrMin = Math.min(0.15, zrMax);
  if (zrMax <= zrMin || rootDevDays <= 0) return zrMax;
  if (dayInSeason >= rootDevDays) return zrMax;
  const ratio = clamp01(dayInSeason / rootDevDays);
  const f = clamp01(0.5 + 0.5 * Math.sin(3.03 * ratio - 1.47));
  return zrMin + (zrMax - zrMin) * f;
}

/** Representative FAO-56 Table 12 maximum plant height h (m) for climatic Kc scaling (h/3)^0.3. */
export function cropCanopyHeightM(crop: CropProfile): number {
  if (crop.id === 'saccharum-officinarum') return 3.0;
  if (crop.id === 'zea-mays') return 2.0;
  if (crop.id === 'sorghum-bicolor' || crop.id === 'manihot-esculenta') return 1.6;
  if (crop.id === 'coffea-canephora' || crop.id === 'coffea-arabica') return 2.5;
  if (crop.lifeSpan === 'perennial') {
    if (crop.category === 'fruit' || crop.id === 'hevea-brasiliensis') return 3.5;
    if (crop.category === 'forage' || crop.category === 'cover' || crop.category === 'herb') return 0.6;
    return 1.5;
  }
  switch (crop.category) {
    case 'cereal':
      return 1.0;
    case 'oilseed':
      return 1.0;
    case 'pulse':
      return 0.6;
    case 'forage':
    case 'cover':
      return 0.8;
    default:
      return 0.45;
  }
}

/** FAO-56 eq. 11 saturation vapour pressure e°(T) in kPa. */
const satVapourPressure = (tC: number): number => 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3));

/**
 * Estimates daily minimum relative humidity RH_min (%) from mean daily RH (%) and diurnal T_min /
 * T_max via FAO-56 eq. 11 & eq. 19: actual vapour pressure e_a = (RH_mean/100) * (e°(Tmax)+e°(Tmin))/2,
 * then RH_min = 100 * e_a / e°(Tmax). Falls back to RH_mean when temperatures are missing.
 */
export function estimateRhMin(rhMeanPct: number, tMinC: number, tMaxC: number): number {
  if (Number.isNaN(rhMeanPct)) return NaN;
  if (Number.isNaN(tMinC) || Number.isNaN(tMaxC) || tMaxC <= tMinC) return clamp(rhMeanPct, 20, 80);
  const eoMax = satVapourPressure(tMaxC);
  const eoMin = satVapourPressure(tMinC);
  const ea = (clamp(rhMeanPct, 5, 100) / 100) * ((eoMax + eoMin) / 2);
  return clamp((100 * ea) / eoMax, 20, 80);
}

/**
 * FAO-56 eq. 62 & eq. 65 climatic adjustment of tabulated Kc,mid or Kc,end when local wind speed u2
 * (m/s at 2 m) and RH_min (%) depart from the standard sub-humid baseline (u2 = 2 m/s, RH_min = 45%).
 * Applied only when Kc_tab >= 0.45 as specified by Allen et al. (1998).
 */
export function adjustKcClimate(kcTab: number, u2Ms: number, rhMinPct: number, heightM: number): number {
  if (kcTab < 0.45 || Number.isNaN(u2Ms) || Number.isNaN(rhMinPct)) return kcTab;
  const u2 = clamp(u2Ms, 1, 6);
  const rh = clamp(rhMinPct, 20, 80);
  const h = clamp(heightM, 0.1, 10);
  const delta = (0.04 * (u2 - 2) - 0.004 * (rh - 45)) * (h / 3) ** 0.3;
  return clamp(kcTab + delta, 0.25, 1.45);
}

// ------------------------------------------------------------------------------------------------
// 5. Feddes (1978) / AquaCrop (Raes et al. 2009) Waterlogging & Aeration Stress
// ------------------------------------------------------------------------------------------------

/** True for paddy/aquatic crops adapted to saturated or flooded root zones (aerenchyma). */
export function isHydrophyticCrop(crop: CropProfile | undefined): boolean {
  if (!crop) return false;
  if (crop.id === 'oryza-sativa' || crop.id === 'ipomoea-aquatica' || crop.id === 'sesbania-rostrata') return true;
  return crop.req.drainage?.opt.includes('poor') ?? false;
}

/** Daily gravitational percolation capacity (mm/day) draining saturation excess above field capacity. */
export function drainagePercolationMmDay(drainage: 'poor' | 'well' | 'excessive' | null, texture: 'light' | 'medium' | 'heavy' | 'organic'): number {
  if (drainage === 'poor') return texture === 'heavy' ? 3.5 : 5.5;
  if (drainage === 'excessive') return 35;
  if (drainage === 'well') return texture === 'heavy' ? 14 : texture === 'light' ? 28 : 20;
  // Unknown drainage class: infer conservatively from texture so moderately rained fields do not spuriously flood.
  return texture === 'heavy' ? 12 : texture === 'light' ? 26 : 18;
}

/**
 * Feddes et al. (1978) & Raes et al. (2009, AquaCrop) root-zone anaerobiosis factor Kaer in [0.30, 1].
 * Hydrophytic crops (rice, water spinach, sesbania) return 1.0. Upland crops begin losing root
 * respiration once saturation excess exceeds 25 % of drainable macro-porosity (~0.08 * Zr).
 */
export function feddesAerationFactor(surplusMm: number, zrM: number, hydrophytic: boolean): number {
  if (hydrophytic || surplusMm <= 0) return 1;
  const macroPorosityMm = Math.max(20, 1000 * 0.08 * zrM);
  const anaerobiosisPoint = 0.25 * macroPorosityMm;
  if (surplusMm <= anaerobiosisPoint) return 1;
  return clamp(1 - (0.7 * (surplusMm - anaerobiosisPoint)) / (macroPorosityMm - anaerobiosisPoint), 0.3, 1);
}

// ------------------------------------------------------------------------------------------------
// 6. Asymmetric Reproductive Heat Stress (Schlenker & Roberts 2009; Sánchez et al. 2014) & PAR Light
// ------------------------------------------------------------------------------------------------

/**
 * Combines 7-day mean thermal exceedance with 3-day daytime canopy Tmax heat shock above optimal
 * temperature plus typical diurnal half-amplitude (+5 °C), amplified at reproductive mid-season
 * anthesis/flowering (Sánchez et al. 2014; Schlenker & Roberts 2009).
 */
export function asymmetricHeatFactor(t7Mean: number, tMax3d: number, tempQuad: Quad, stageId: StageId | undefined, active: boolean): number | null {
  if (Number.isNaN(t7Mean)) return null;
  const meanHeat = t7Mean > tempQuad[2] ? clamp01((tempQuad[3] - t7Mean) / Math.max(1, tempQuad[3] - tempQuad[2])) : 1;
  if (!active || Number.isNaN(tMax3d)) return meanHeat;
  // Diurnal canopy Tmax threshold: optMax + 5 °C, lethal ceiling absMax + 4 °C (Sánchez et al. 2014).
  const tCrit = tempQuad[2] + 5;
  const tCeil = Math.max(tCrit + 3, tempQuad[3] + 4);
  if (tMax3d <= tCrit) return meanHeat;
  const stageAmp = stageId === 'mid-season' ? 1.0 : stageId === 'development' ? 0.7 : 0.45;
  const shock = clamp01(1 - stageAmp * ((tMax3d - tCrit) / (tCeil - tCrit)));
  return Math.min(meanHeat, shock);
}

/**
 * Monteith (1977) photosynthetically active radiation (PAR, MJ/m²/day) light-sufficiency factor on
 * trailing 7-day mean PAR. Normal clear/partly-cloudy skies (>= 6.5 MJ/m²/day for C3, >= 8.0 for
 * high-light C4 cereals/industrial crops) score 1.0; deep persistent monsoon overcast reduces RUE.
 */
export function monteithRadiationFactor(par7dMjM2: number, crop: CropProfile | undefined): number | null {
  if (Number.isNaN(par7dMjM2) || par7dMjM2 < 0) return null;
  const c4HighLight = crop?.id === 'zea-mays' || crop?.id === 'sorghum-bicolor' || crop?.id === 'saccharum-officinarum' || crop?.id === 'sorghum-x-drummondii';
  const satPar = c4HighLight ? 8.0 : 6.2;
  if (par7dMjM2 >= satPar) return 1;
  // Michaelis-Menten light curve normalized to 1 at satPar, floor 0.55 under heavy cloud cover.
  const km = 2.5;
  const raw = (par7dMjM2 / (par7dMjM2 + km)) / (satPar / (satPar + km));
  return clamp(raw, 0.55, 1);
}

// ------------------------------------------------------------------------------------------------
// 7. Precision-Weighted Multi-Sensor Satellite Data Assimilation (Ines et al. 2013; Anderson 2011)
// ------------------------------------------------------------------------------------------------

export interface SatelliteObservationSignals {
  /** MODIS/VIIRS NDVI departure vs pixel 5-year DOY baseline, mapped to [0, 1], or null. */
  ndvi: number | null;
  /** ClimateSERV Evaporative Stress Index mapped to [0, 1], or null. */
  esi: number | null;
  /** SMAP L4 / ERA5-Land root-zone soil moisture departure vs DOY baseline, mapped to [0, 1], or null. */
  smRoot: number | null;
  /** MODIS daytime LST canopy thermal anomaly above 5-year DOY p90, mapped to [0, 1], or null. */
  lstCanopy: number | null;
}

/**
 * Fuses available orthogonal EO stress indicators with weights reflecting parcel-scale biophysical
 * coupling (Ines et al. 2013; Anderson et al. 2011; Reichle et al. 2019):
 *   NDVI canopy vigour 0.42 | ESI evaporative stress 0.24 | SM_root moisture 0.20 | LST canopy 0.14.
 * Missing streams are excluded from both numerator and denominator (never scored as zero).
 */
export function assimilateSatelliteCondition(obs: SatelliteObservationSignals): number | null {
  let num = 0;
  let den = 0;
  const add = (val: number | null, w: number) => {
    if (val != null && !Number.isNaN(val)) {
      num += clamp01(val) * w;
      den += w;
    }
  };
  add(obs.ndvi, 0.42);
  add(obs.esi, 0.24);
  add(obs.smRoot, 0.2);
  add(obs.lstCanopy, 0.14);
  return den > 0 ? num / den : null;
}
