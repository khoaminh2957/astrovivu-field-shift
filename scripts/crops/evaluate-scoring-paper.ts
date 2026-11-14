/**
 * Reproducible computational benchmark & sensitivity analysis suite for `docs/SCORING_PAPER.md`.
 *
 * Executes six deterministic experiments on the repository's real satellite/reanalysis caches
 * (`public/data/samples/*.json`) and cleaned FAO EcoCrop catalogue (`public/data/crops/ecocrop.json`),
 * writing machine-verified tables and metrics to `data/crops/scoring-paper-results.json`.
 *
 * Run: `npx tsx scripts/crops/evaluate-scoring-paper.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { CropProfile, FieldTelemetry, GroundTruth, ModelInput } from '../../src/contracts';
import { getCrop, loadFullCatalog } from '../../src/core/crops';
import {
  adjustKcClimate,
  aggregateSuitability,
  AHP_PAIRWISE_MATRIX,
  AHP_SOLUTION,
  assessCrop,
  borgGrimesRootDepth,
  computeScoreDetail,
  cropCanopyHeightM,
  estimateRhMin,
  FACTOR_WEIGHTS,
  maasHoffmanSalinity,
  oldfieldFertilityIndex,
  scoreFertilityContinuous,
  solveAhpMatrix,
  trapezoid,
  type AggregationItem,
  type ParametricMethod,
} from '../../src/core/scoring';
import { GRADED_FACTOR_KEYS, type GradedFactorKey } from '../../src/core/scoring/literature';
import { getSampleParcel } from '../../src/data/samples';

const round = (v: number, d = 4): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/** Deterministic Mulberry32 PRNG for reproducible Monte Carlo perturbations. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic radical-inverse Halton sequence in base `b` for Quasi-Monte Carlo Sobol sampling. */
function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

function loadSample(id: string): { telemetry: FieldTelemetry; makeInput: (cropId: string | null, gt?: GroundTruth) => ModelInput } {
  const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
  const parcel = getSampleParcel(id)!;
  return {
    telemetry,
    makeInput: (cropId: string | null, gt: GroundTruth = {}) => ({
      parcel,
      telemetry,
      cropId,
      groundTruth: gt,
      priorities: ['profit'],
      today: telemetry.window.today,
    }),
  };
}

// ================================================================================================
// Experiment 1: Saaty AHP Eigenvector Solution & Monte Carlo Reciprocal Perturbation Stability
// ================================================================================================
function runExperiment1() {
  const exact = AHP_SOLUTION;
  const domainShares = {
    climaticPrimary: round(exact.weights.temperature + exact.weights.water, 4),
    edaphicChemHydro: round(exact.weights.ph + exact.weights.salinity + exact.weights.drainage, 4),
    edaphicPhysical: round(exact.weights.texture + exact.weights.depth, 4),
    fertilityTopography: round(exact.weights.fertility + exact.weights.slope, 4),
  };

  const M = 1000;
  const rng = mulberry32(20261114);
  const n = AHP_PAIRWISE_MATRIX.length;
  const expSamples: Record<GradedFactorKey, number[]> = Object.fromEntries(GRADED_FACTOR_KEYS.map((k) => [k, []])) as unknown as Record<GradedFactorKey, number[]>;
  const crSamples: number[] = [];
  let tierOrderPreserved = 0;

  for (let m = 0; m < M; m++) {
    const mat: number[][] = Array.from({ length: n }, () => new Array(n).fill(1));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // +-25% log-uniform multiplicative judgement uncertainty on off-diagonal entries
        const u = (rng() * 2 - 1) * 0.25;
        const val = AHP_PAIRWISE_MATRIX[i][j] * Math.exp(u);
        mat[i][j] = val;
        mat[j][i] = 1 / val;
      }
    }
    const sol = solveAhpMatrix(mat);
    crSamples.push(sol.cr);
    for (const k of GRADED_FACTOR_KEYS) expSamples[k].push(sol.exponents[k]);
    const minT1 = Math.min(sol.weights.temperature, sol.weights.water);
    const maxT2 = Math.max(sol.weights.ph, sol.weights.salinity, sol.weights.drainage);
    const minT2 = Math.min(sol.weights.ph, sol.weights.salinity, sol.weights.drainage);
    const maxT3 = Math.max(sol.weights.texture, sol.weights.depth);
    if (minT1 > maxT2 && minT2 > maxT3) tierOrderPreserved++;
  }

  const quantileSorted = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
  const mcSummary: Record<string, { exactWeight: number; exactExponent: number; mcMeanExp: number; mcSdExp: number; ci95: [number, number] }> = {};
  for (const k of GRADED_FACTOR_KEYS) {
    const arr = [...expSamples[k]].sort((a, b) => a - b);
    const mean = arr.reduce((a, b) => a + b, 0) / M;
    const sd = Math.sqrt(arr.reduce((acc, x) => acc + (x - mean) ** 2, 0) / M);
    mcSummary[k] = {
      exactWeight: exact.weights[k],
      exactExponent: exact.exponents[k],
      mcMeanExp: round(mean, 4),
      mcSdExp: round(sd, 4),
      ci95: [round(quantileSorted(arr, 0.025), 4), round(quantileSorted(arr, 0.975), 4)],
    };
  }
  const crSorted = [...crSamples].sort((a, b) => a - b);
  return {
    exact,
    domainShares,
    monteCarlo: {
      runs: M,
      perturbationLogHalfWidth: 0.25,
      crMean: round(crSamples.reduce((a, b) => a + b, 0) / M, 5),
      crP95: round(quantileSorted(crSorted, 0.95), 5),
      crMax: round(crSorted[crSorted.length - 1], 5),
      shareCrBelow010: round(crSamples.filter((c) => c < 0.1).length / M, 4),
      tierOrderPreservedShare: round(tierOrderPreserved / M, 4),
      factors: mcSummary,
    },
  };
}

// ================================================================================================
// Experiment 2: Parametric Aggregation Operators on Canonical Profiles & 56-Case Real Benchmark
// ================================================================================================
interface BenchmarkCase {
  parcelId: 'daklak-coffee' | 'cantho-rice' | 'iowa-corn-soy' | 'nevada-alfalfa';
  cropId: string;
  irrigation: 'rainfed' | 'supplemental' | 'full';
  viable: 0 | 1;
  basis: string;
}

const BENCHMARK_56: BenchmarkCase[] = [
  // 1. Đắk Lắk basalt upland (14 cases: tropical wet-dry Aw, 4-month dry spell, pH ~5.5)
  { parcelId: 'daklak-coffee', cropId: 'coffea-canephora', irrigation: 'supplemental', viable: 1, basis: 'Dominant commercial perennial of Đắk Lắk (FAOSTAT/MARD)' },
  { parcelId: 'daklak-coffee', cropId: 'coffea-canephora', irrigation: 'rainfed', viable: 1, basis: 'Viable rainfed robusta with moderate dry-season deficit' },
  { parcelId: 'daklak-coffee', cropId: 'piper-nigrum', irrigation: 'full', viable: 1, basis: 'Major irrigated intercrop in Central Highlands' },
  { parcelId: 'daklak-coffee', cropId: 'piper-nigrum', irrigation: 'rainfed', viable: 0, basis: 'Fails rainfed: 4-month dry spell well below 2000 mm minimum' },
  { parcelId: 'daklak-coffee', cropId: 'oryza-sativa', irrigation: 'rainfed', viable: 0, basis: 'Upland basalt parcel lacks season rainfall for rainfed paddy' },
  { parcelId: 'daklak-coffee', cropId: 'zea-mays', irrigation: 'rainfed', viable: 1, basis: 'Standard wet-season hybrid maize in Central Highlands' },
  { parcelId: 'daklak-coffee', cropId: 'glycine-max', irrigation: 'rainfed', viable: 1, basis: 'Wet-season upland legume rotation in Đắk Lắk' },
  { parcelId: 'daklak-coffee', cropId: 'arachis-hypogaea', irrigation: 'rainfed', viable: 1, basis: 'Well-adapted rainfed legume on friable basalt soil' },
  { parcelId: 'daklak-coffee', cropId: 'manihot-esculenta', irrigation: 'rainfed', viable: 1, basis: 'Major rainfed root crop across Central Highlands' },
  { parcelId: 'daklak-coffee', cropId: 'anacardium-occidentale', irrigation: 'rainfed', viable: 1, basis: 'Drought-tolerant tree crop widely grown in region' },
  { parcelId: 'daklak-coffee', cropId: 'durio-zibethinus', irrigation: 'full', viable: 1, basis: 'High-value irrigated orchard crop in Đắk Lắk' },
  { parcelId: 'daklak-coffee', cropId: 'ipomoea-batatas', irrigation: 'rainfed', viable: 1, basis: 'Major wet-season tuber crop in Đắk Lắk' },
  { parcelId: 'daklak-coffee', cropId: 'triticum-aestivum', irrigation: 'rainfed', viable: 0, basis: 'Temperate cereal: tropical temperatures exceed 20 °C optimum' },
  { parcelId: 'daklak-coffee', cropId: 'avena-sativa', irrigation: 'rainfed', viable: 0, basis: 'Cool-temperate oat unsuitable in tropical Aw climate' },

  // 2. An Giang Mekong Delta alluvial paddy (14 cases: tropical Aw, heavy clay, poor drainage)
  { parcelId: 'cantho-rice', cropId: 'oryza-sativa', irrigation: 'full', viable: 1, basis: 'Triple-cropped irrigated Mekong Delta staple (MARD)' },
  { parcelId: 'cantho-rice', cropId: 'oryza-sativa', irrigation: 'rainfed', viable: 1, basis: 'Monsoon wet-season rainfed rice viable in An Giang' },
  { parcelId: 'cantho-rice', cropId: 'vigna-radiata', irrigation: 'supplemental', viable: 1, basis: 'Recommended short-cycle pulse replacing 3rd rice crop' },
  { parcelId: 'cantho-rice', cropId: 'sesamum-indicum', irrigation: 'supplemental', viable: 1, basis: 'Established spring-summer rotation crop in An Giang paddies' },
  { parcelId: 'cantho-rice', cropId: 'zea-mays', irrigation: 'supplemental', viable: 1, basis: 'Irrigated dry-season hybrid maize on Mekong alluvial dikes' },
  { parcelId: 'cantho-rice', cropId: 'ipomoea-aquatica', irrigation: 'full', viable: 1, basis: 'Semi-aquatic leafy vegetable thriving on wet delta soils' },
  { parcelId: 'cantho-rice', cropId: 'sesbania-rostrata', irrigation: 'rainfed', viable: 1, basis: 'Flood-tolerant N-fixing green manure native to Mekong floodplains' },
  { parcelId: 'cantho-rice', cropId: 'cocos-nucifera', irrigation: 'rainfed', viable: 1, basis: 'Widespread Mekong Delta perennial palm' },
  { parcelId: 'cantho-rice', cropId: 'musa-acuminata', irrigation: 'supplemental', viable: 1, basis: 'Common tropical fruit crop in Mekong Delta' },
  { parcelId: 'cantho-rice', cropId: 'cucurbita-moschata', irrigation: 'supplemental', viable: 1, basis: 'Dry-season vegetable rotated on bunded Mekong fields' },
  { parcelId: 'cantho-rice', cropId: 'triticum-aestivum', irrigation: 'full', viable: 0, basis: 'Tropical lowland heat prevents temperate wheat grain filling' },
  { parcelId: 'cantho-rice', cropId: 'pisum-sativum', irrigation: 'rainfed', viable: 0, basis: 'Cool-season pea fails in hot lowland Mekong climate' },
  { parcelId: 'cantho-rice', cropId: 'fragaria-x-ananassa', irrigation: 'full', viable: 0, basis: 'Temperate/highland berry fails at 27-29 °C lowland temperatures' },
  { parcelId: 'cantho-rice', cropId: 'avena-sativa', irrigation: 'full', viable: 0, basis: 'Cool-season oat fails in tropical Mekong temperatures' },

  // 3. Story County, Iowa prairie Mollisol (14 cases: humid continental Dc/Df, severe winter frost)
  { parcelId: 'iowa-corn-soy', cropId: 'zea-mays', irrigation: 'rainfed', viable: 1, basis: 'Verified on parcel by USDA CDL 2018, 2020, 2022, 2024' },
  { parcelId: 'iowa-corn-soy', cropId: 'glycine-max', irrigation: 'rainfed', viable: 1, basis: 'Verified on parcel by USDA CDL 2019, 2021, 2023, 2025' },
  { parcelId: 'iowa-corn-soy', cropId: 'avena-sativa', irrigation: 'rainfed', viable: 1, basis: 'Traditional Iowa spring small-grain nurse/rotation crop (ISU Extension)' },
  { parcelId: 'iowa-corn-soy', cropId: 'medicago-sativa', irrigation: 'rainfed', viable: 1, basis: 'Winter-hardy perennial forage in Iowa rotations' },
  { parcelId: 'iowa-corn-soy', cropId: 'trifolium-pratense', irrigation: 'rainfed', viable: 1, basis: 'Standard Corn Belt frost-seeded legume cover/forage' },
  { parcelId: 'iowa-corn-soy', cropId: 'secale-cereale', irrigation: 'rainfed', viable: 1, basis: 'Primary winter-hardy cover crop in Iowa corn-soy systems' },
  { parcelId: 'iowa-corn-soy', cropId: 'sorghum-bicolor', irrigation: 'rainfed', viable: 1, basis: 'Warm-season summer cereal viable in Midwest summers' },
  { parcelId: 'iowa-corn-soy', cropId: 'helianthus-annuus', irrigation: 'rainfed', viable: 1, basis: 'Warm-season oilseed viable in continental summer window' },
  { parcelId: 'iowa-corn-soy', cropId: 'coffea-canephora', irrigation: 'full', viable: 0, basis: 'Killed by sub-zero Iowa winters (-12 °C monthly mean min)' },
  { parcelId: 'iowa-corn-soy', cropId: 'musa-acuminata', irrigation: 'full', viable: 0, basis: 'Tropical perennial killed by continental winter freeze' },
  { parcelId: 'iowa-corn-soy', cropId: 'cocos-nucifera', irrigation: 'full', viable: 0, basis: 'Strictly tropical palm killed by frost' },
  { parcelId: 'iowa-corn-soy', cropId: 'hevea-brasiliensis', irrigation: 'full', viable: 0, basis: 'Equatorial tree crop killed by continental winter' },
  { parcelId: 'iowa-corn-soy', cropId: 'piper-nigrum', irrigation: 'full', viable: 0, basis: 'Tropical spice vine killed by frost and short summer' },
  { parcelId: 'iowa-corn-soy', cropId: 'durio-zibethinus', irrigation: 'full', viable: 0, basis: 'Ultratrops fruit tree killed by frost' },

  // 4. Diamond Valley, Nevada high-desert pivot (14 cases: cold semi-arid Bs, ~230 mm/yr rain, pH 8.8)
  { parcelId: 'nevada-alfalfa', cropId: 'medicago-sativa', irrigation: 'full', viable: 1, basis: 'Verified on pivot by USDA CDL every year 2019-2025' },
  { parcelId: 'nevada-alfalfa', cropId: 'medicago-sativa', irrigation: 'rainfed', viable: 0, basis: 'Fails rainfed: 230 mm/yr desert precipitation cannot sustain hay' },
  { parcelId: 'nevada-alfalfa', cropId: 'hordeum-vulgare', irrigation: 'full', viable: 1, basis: 'Alkaline/salt-tolerant spring cereal rotated on Nevada pivots' },
  { parcelId: 'nevada-alfalfa', cropId: 'hordeum-vulgare', irrigation: 'rainfed', viable: 0, basis: 'Insufficient growing-season rainfall without pivot irrigation' },
  { parcelId: 'nevada-alfalfa', cropId: 'triticum-aestivum', irrigation: 'full', viable: 1, basis: 'Irrigated spring/winter wheat grown in Great Basin valleys' },
  { parcelId: 'nevada-alfalfa', cropId: 'triticum-aestivum', irrigation: 'rainfed', viable: 0, basis: 'Desert rainfall below wheat absolute minimum' },
  { parcelId: 'nevada-alfalfa', cropId: 'zea-mays', irrigation: 'rainfed', viable: 0, basis: 'Rainfed maize impossible at ~230 mm/yr precipitation' },
  { parcelId: 'nevada-alfalfa', cropId: 'oryza-sativa', irrigation: 'rainfed', viable: 0, basis: 'Lethal desert aridity + alkaline soil prevent rainfed rice' },
  { parcelId: 'nevada-alfalfa', cropId: 'coffea-canephora', irrigation: 'full', viable: 0, basis: 'High-desert winter frost (-8 °C) kills coffee regardless of water' },
  { parcelId: 'nevada-alfalfa', cropId: 'musa-acuminata', irrigation: 'full', viable: 0, basis: 'Killed by Great Basin freezing winters' },
  { parcelId: 'nevada-alfalfa', cropId: 'piper-nigrum', irrigation: 'full', viable: 0, basis: 'Tropical vine killed by frost and pH 8.8' },
  { parcelId: 'nevada-alfalfa', cropId: 'camellia-sinensis', irrigation: 'full', viable: 0, basis: 'Calcifuge acid-loving tea (pH <= 6.0) fails on pH 8.8 desert soil' },
  { parcelId: 'nevada-alfalfa', cropId: 'durio-zibethinus', irrigation: 'full', viable: 0, basis: 'Killed by winter frost and alkaline desert soil' },
  { parcelId: 'nevada-alfalfa', cropId: 'hevea-brasiliensis', irrigation: 'full', viable: 0, basis: 'Killed by winter frost and alkaline desert soil' },
];

function computeBinaryMetrics(yTrue: number[], yScore: number[]) {
  const n = yTrue.length;
  let brier = 0;
  let tp50 = 0;
  let fn50 = 0;
  let tn50 = 0;
  let fp50 = 0;
  let fp60 = 0;
  let negCount = 0;
  let posCount = 0;
  for (let i = 0; i < n; i++) {
    brier += (yScore[i] - yTrue[i]) ** 2;
    if (yTrue[i] === 1) {
      posCount++;
      if (yScore[i] >= 0.45) tp50++;
      else fn50++;
    } else {
      negCount++;
      if (yScore[i] >= 0.45) fp50++;
      else tn50++;
      if (yScore[i] >= 0.6) fp60++;
    }
  }
  // Exact Mann-Whitney U / Wilcoxon ROC-AUC (ties = 0.5)
  let concordant = 0;
  for (let i = 0; i < n; i++) {
    if (yTrue[i] !== 1) continue;
    for (let j = 0; j < n; j++) {
      if (yTrue[j] !== 0) continue;
      if (yScore[i] > yScore[j] + 1e-9) concordant += 1;
      else if (Math.abs(yScore[i] - yScore[j]) <= 1e-9) concordant += 0.5;
    }
  }
  const auc = concordant / (posCount * negCount);
  const recall45 = tp50 / posCount;
  const spec45 = tn50 / negCount;
  return {
    n,
    positives: posCount,
    negatives: negCount,
    rocAuc: round(auc, 4),
    brierScore: round(brier / n, 4),
    fprAtS2_60: round(fp60 / negCount, 4),
    recallAt45: round(recall45, 4),
    specificityAt45: round(spec45, 4),
    youdenJAt45: round(recall45 + spec45 - 1, 4),
  };
}

function runExperiment2(samples: Record<string, ReturnType<typeof loadSample>>) {
  const methods: ParametricMethod[] = ['wlc', 'storie', 'khiddir', 'ecocrop-gaez', 'astrovivu-v2'];
  const mkItems = (scores: Partial<Record<GradedFactorKey, number>>): AggregationItem[] =>
    GRADED_FACTOR_KEYS.map((k) => ({ key: k, score: scores[k] ?? 1, weight: FACTOR_WEIGHTS[k] }));

  const canonicalProfiles = [
    { id: 'lethal-drought', name: 'Lethal drought (water = 0, others = 1)', items: mkItems({ water: 0 }) },
    { id: 'single-acid-ph', name: 'Single moderate acidity (pH = 0.60, others = 1)', items: mkItems({ ph: 0.6 }) },
    {
      id: 'compound-edaphic',
      name: 'Compound manageable soil limits (7 soil/slope = 0.70..0.80, climate = 1)',
      items: mkItems({ ph: 0.75, salinity: 0.8, drainage: 0.7, texture: 0.7, depth: 0.7, fertility: 0.7, slope: 0.8 }),
    },
    {
      id: 'daklak-archetype',
      name: 'Tropical highland dry-spell archetype (water = 0.72, pH = 0.92, fert = 0.85, slope = 0.88)',
      items: mkItems({ water: 0.72, ph: 0.92, fertility: 0.85, slope: 0.88 }),
    },
    {
      id: 'nevada-pivot-archetype',
      name: 'Arid alkaline irrigated basin (temp = 0.95, water = 1, pH = 0.60, sal = 0.82, fert = 0.65)',
      items: mkItems({ temperature: 0.95, water: 1, ph: 0.6, salinity: 0.82, fertility: 0.65 }),
    },
  ];

  const canonicalResults = canonicalProfiles.map((p) => ({
    id: p.id,
    name: p.name,
    scores: Object.fromEntries(methods.map((m) => [m, round(aggregateSuitability(p.items, m).score, 4)])),
  }));

  const benchmarkScoresByMethod: Record<ParametricMethod, number[]> = {
    wlc: [],
    storie: [],
    khiddir: [],
    'ecocrop-gaez': [],
    'astrovivu-v2': [],
  };
  const yTrue = BENCHMARK_56.map((c) => c.viable);
  const caseDetails: Array<Record<string, unknown>> = [];

  for (const c of BENCHMARK_56) {
    const smp = samples[c.parcelId];
    const input = smp.makeInput(c.cropId, { irrigation: c.irrigation });
    const rowScores: Record<string, number> = {};
    for (const m of methods) {
      const a = assessCrop(input, c.cropId, { irrigation: c.irrigation, method: m })!;
      // For pure diagnostic comparison of graded operators without zone-gate confounding on WLC false-positives,
      // assessCrop includes identical bioclimatic gates across all methods, testing real end-to-end suitability.
      benchmarkScoresByMethod[m].push(a.bestCompatibility);
      rowScores[m] = round(a.bestCompatibility, 4);
    }
    caseDetails.push({ ...c, scores: rowScores });
  }

  const methodMetrics = Object.fromEntries(methods.map((m) => [m, computeBinaryMetrics(yTrue, benchmarkScoresByMethod[m])]));
  return { canonicalResults, benchmarkCount: BENCHMARK_56.length, methodMetrics, sampleCases: caseDetails.slice(0, 16) };
}

// ================================================================================================
// Experiment 3: Physiological Process Ablation Across the 4 Real Parcels
// ================================================================================================
function runExperiment3(samples: Record<string, ReturnType<typeof loadSample>>) {
  // 3a. FAO-56 Eq. 62/65 Climatic Kc Adjustment across arid vs humid real parcels
  const kcConfigs = [
    { parcelId: 'nevada-alfalfa', cropId: 'medicago-sativa', irrigation: 'full' as const },
    { parcelId: 'daklak-coffee', cropId: 'coffea-canephora', irrigation: 'supplemental' as const },
    { parcelId: 'cantho-rice', cropId: 'oryza-sativa', irrigation: 'full' as const },
    { parcelId: 'iowa-corn-soy', cropId: 'zea-mays', irrigation: 'rainfed' as const },
  ];

  const kcAblation = kcConfigs.map(({ parcelId, cropId, irrigation }) => {
    const { telemetry, makeInput } = samples[parcelId];
    const crop = getCrop(cropId)!;
    const h = cropCanopyHeightM(crop);
    const kcTab = crop.water!.kc.mid;
    const agromet = telemetry.branches.agromet;
    const rhSeries = agromet?.series.find((s) => s.key === 'rh')?.samples ?? [];
    const windSeries = agromet?.series.find((s) => s.key === 'wind')?.samples ?? [];
    const tMinSeries = agromet?.series.find((s) => s.key === 't2m_min')?.samples ?? [];
    const tMaxSeries = agromet?.series.find((s) => s.key === 't2m_max')?.samples ?? [];
    const n = Math.min(rhSeries.length, windSeries.length, tMinSeries.length, tMaxSeries.length);
    let sumRhMin = 0;
    let sumWind = 0;
    let sumKcAdj = 0;
    let valid = 0;
    for (let i = 0; i < n; i++) {
      const rh = rhSeries[i]?.v;
      const u2 = windSeries[i]?.v;
      const tn = tMinSeries[i]?.v;
      const txMax = tMaxSeries[i]?.v;
      if (rh == null || u2 == null || tn == null || txMax == null) continue;
      const rhMin = estimateRhMin(rh, tn, txMax);
      const kcAdj = adjustKcClimate(kcTab, u2, rhMin, h);
      sumRhMin += rhMin;
      sumWind += u2;
      sumKcAdj += kcAdj;
      valid++;
    }
    const detail = computeScoreDetail(makeInput(cropId, { irrigation }));
    const meanKcAdj = valid ? sumKcAdj / valid : kcTab;
    return {
      parcelId,
      cropId,
      kcMidTabulated: kcTab,
      meanWindMs: round(sumWind / Math.max(1, valid), 2),
      meanRhMinPct: round(sumRhMin / Math.max(1, valid), 1),
      kcMidClimateAdjusted: round(meanKcAdj, 4),
      deltaKcMidPct: round(((meanKcAdj - kcTab) / kcTab) * 100, 2),
      seasonEtcMm: detail.water?.etcMm ?? null,
      seasonEtaMm: detail.water?.etaMm ?? null,
      seasonIrrigationMm: detail.water?.irrigationMm ?? null,
    };
  });

  // 3b. Borg & Grimes (1986) Dynamic Root Growth early-season TAW geometry
  const rootAblation = ['zea-mays', 'glycine-max', 'allium-cepa', 'coffea-canephora'].map((cropId) => {
    const crop = getCrop(cropId)!;
    const isPerennial = crop.lifeSpan === 'perennial';
    const zrMax = crop.water!.rootDepthM;
    const len = Math.round((crop.cycleDays[0] + crop.cycleDays[1]) / 2);
    const rootDevDays = Math.round((crop.water!.stages[0] + crop.water!.stages[1]) * len);
    const zrDay5 = borgGrimesRootDepth(5, rootDevDays, zrMax, isPerennial);
    const zrDay20 = borgGrimesRootDepth(20, rootDevDays, zrMax, isPerennial);
    const awc = 0.16; // medium loam reference
    return {
      cropId,
      isPerennial,
      zrMaxM: zrMax,
      rootDevDays,
      zrDay5M: round(zrDay5, 3),
      zrDay20M: round(zrDay20, 3),
      tawStaticMm: round(1000 * awc * zrMax, 1),
      tawDay5DynamicMm: round(1000 * awc * zrDay5, 1),
      earlyTawOverestimationRatioInV1: round(zrMax / zrDay5, 2),
    };
  });

  // 3c. Feddes / AquaCrop Waterlogging Aeration Stress on Mekong Monsoon Parcel (An Giang)
  const aerationAblation = ['oryza-sativa', 'glycine-max', 'zea-mays', 'arachis-hypogaea'].map((cropId) => {
    const poor = computeScoreDetail(samples['cantho-rice'].makeInput(cropId, { drainage: 'poor', sowingDate: '2026-06-01' }));
    const well = computeScoreDetail(samples['cantho-rice'].makeInput(cropId, { drainage: 'well', sowingDate: '2026-06-01' }));
    let minAerPoor = 1;
    let aerDays = 0;
    for (const snap of poor.timeline.snapshots) {
      const wl = snap.factors.find((f) => f.key === 'waterlogging');
      if (wl?.score != null) {
        minAerPoor = Math.min(minAerPoor, wl.score);
        aerDays++;
      }
    }
    return {
      cropId,
      poorDrainageCompatibility: poor.timeline.summary.compatibility,
      wellDrainageCompatibility: well.timeline.summary.compatibility,
      poorDrainageExpectedYieldPct: round((poor.timeline.summary.expectedYieldFraction ?? 0) * 100, 1),
      wellDrainageExpectedYieldPct: round((well.timeline.summary.expectedYieldFraction ?? 0) * 100, 1),
      deltaExpectedYieldPct: round(((well.timeline.summary.expectedYieldFraction ?? 0) - (poor.timeline.summary.expectedYieldFraction ?? 0)) * 100, 1),
      minAerationFactorPoor: round(minAerPoor, 3),
      waterloggedDaysCount: aerDays,
    };
  });

  // 3d. Multi-sensor EO satellite observation stream coverage across the 4 real parcels
  const eoCoverage = (['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const).map((parcelId) => {
    const smp = samples[parcelId];
    const defaultCrop = getSampleParcel(parcelId)!.defaultCropId!;
    const detail = computeScoreDetail(smp.makeInput(defaultCrop, getSampleParcel(parcelId)!.defaultGroundTruth));
    let ndviDays = 0;
    let esiDays = 0;
    let smDays = 0;
    let lstHotDays = 0;
    for (const s of detail.timeline.snapshots) {
      if (s.factors.some((f) => f.key === 'vigor')) ndviDays++;
      if (s.factors.some((f) => f.key === 'evapStress')) esiDays++;
      if (s.factors.some((f) => f.key === 'soilMoistureObs')) smDays++;
      if (s.factors.some((f) => f.key === 'canopyTemp')) lstHotDays++;
    }
    return {
      parcelId,
      cropId: defaultCrop,
      totalDays: detail.timeline.snapshots.length,
      activeNdviDays: ndviDays,
      esiDays,
      smRootDays: smDays,
      lstCanopyStressDays: lstHotDays,
      confidence: detail.timeline.snapshots[0]?.confidence ?? 0,
    };
  });

  return { kcAblation, rootAblation, aerationAblation, eoCoverage };
}

// ================================================================================================
// Experiment 4: Maas & Hoffman (1977) Continuous Salinity vs v1 Step Classes against FAO-56 Table 23
// ================================================================================================
function v1DiscreteSalinity(ecDsM: number, need: { opt: 'none' | 'low' | 'medium' | 'high'; abs: 'none' | 'low' | 'medium' | 'high' }): number {
  const order = ['none', 'low', 'medium', 'high'] as const;
  const have = ecDsM < 2 ? 'none' : ecDsM < 4 ? 'low' : ecDsM <= 10 ? 'medium' : 'high';
  const h = order.indexOf(have);
  const o = order.indexOf(need.opt);
  const a = order.indexOf(need.abs);
  return h <= o ? 1 : h <= a ? 0.7 : 0.15;
}

function runExperiment4() {
  // Published FAO-56 Table 23 (Allen et al. 1998, from Maas & Hoffman 1977) reference parameters (a in dS/m, b per dS/m)
  const referenceCrops = [
    { cropId: 'phaseolus-vulgaris', name: 'Common bean', faoA: 1.0, faoB: 0.19 },
    { cropId: 'allium-cepa', name: 'Onion', faoA: 1.2, faoB: 0.16 },
    { cropId: 'zea-mays', name: 'Maize', faoA: 1.7, faoB: 0.12 },
    { cropId: 'oryza-sativa', name: 'Rice', faoA: 3.0, faoB: 0.12 },
    { cropId: 'glycine-max', name: 'Soybean', faoA: 5.0, faoB: 0.2 },
    { cropId: 'hordeum-vulgare', name: 'Barley', faoA: 8.0, faoB: 0.05 },
  ];
  const ecGrid = [0, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 12.0];

  let sqErrV1 = 0;
  let sqErrV2 = 0;
  let absErrV1 = 0;
  let absErrV2 = 0;
  let totalPoints = 0;

  const perCrop = referenceCrops.map((rc) => {
    const crop = getCrop(rc.cropId)!;
    const need = crop.req.salinity!;
    let cSqV1 = 0;
    let cSqV2 = 0;
    for (const ec of ecGrid) {
      const ref = ec <= rc.faoA ? 1 : Math.max(0.1, 1 - rc.faoB * (ec - rc.faoA));
      const sV1 = v1DiscreteSalinity(ec, need);
      const sV2 = maasHoffmanSalinity(ec, need)!;
      cSqV1 += (sV1 - ref) ** 2;
      cSqV2 += (sV2 - ref) ** 2;
      sqErrV1 += (sV1 - ref) ** 2;
      sqErrV2 += (sV2 - ref) ** 2;
      absErrV1 += Math.abs(sV1 - ref);
      absErrV2 += Math.abs(sV2 - ref);
      totalPoints++;
    }
    return {
      cropId: rc.cropId,
      name: rc.name,
      ecocropClasses: need,
      faoThresholdDsM: rc.faoA,
      faoSlopePerDsM: rc.faoB,
      rmseV1Step: round(Math.sqrt(cSqV1 / ecGrid.length), 4),
      rmseV2MaasHoffman: round(Math.sqrt(cSqV2 / ecGrid.length), 4),
    };
  });

  return {
    ecGridDsM: ecGrid,
    totalPoints,
    overallRmseV1Step: round(Math.sqrt(sqErrV1 / totalPoints), 4),
    overallRmseV2MaasHoffman: round(Math.sqrt(sqErrV2 / totalPoints), 4),
    overallMaeV1Step: round(absErrV1 / totalPoints, 4),
    overallMaeV2MaasHoffman: round(absErrV2 / totalPoints, 4),
    rmseReductionPct: round((1 - Math.sqrt(sqErrV2 / totalPoints) / Math.sqrt(sqErrV1 / totalPoints)) * 100, 2),
    perCrop,
  };
}

// ================================================================================================
// Experiment 5: Global Sensitivity Analysis (Saltelli-Jansen Sobol Indices & Morris Elementary Effects)
// ================================================================================================
const PRIMES_18 = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61];
const PARAM_BOUNDS: readonly { key: GradedFactorKey; min: number; max: number }[] = [
  { key: 'temperature', min: 10, max: 36 }, // Growing-window mean T (°C)
  { key: 'water', min: 250, max: 2400 }, // Growing-window water supply (mm)
  { key: 'ph', min: 4.2, max: 8.6 }, // Soil pH
  { key: 'salinity', min: 0, max: 8.0 }, // Soil ECe (dS/m)
  { key: 'drainage', min: 0, max: 1 }, // Categorical index -> poor / well / excessive
  { key: 'texture', min: 0, max: 1 }, // Categorical index -> light / medium / heavy / organic
  { key: 'depth', min: 15, max: 180 }, // Soil depth (cm)
  { key: 'fertility', min: 3, max: 32 }, // SOC (g/kg) with co-varying CEC
  { key: 'slope', min: 0, max: 25 }, // Terrain slope (°)
];

function evaluateParametricPoint(crop: CropProfile, u: Float64Array): number {
  const x = PARAM_BOUNDS.map((b, j) => b.min + u[j] * (b.max - b.min));
  const [tMean, waterMm, ph, ecDsM, drU, texU, depthCm, socGkg, slopeDeg] = x;
  const nMonths = Math.max(1, Math.min(12, Math.round((crop.cycleDays[0] + crop.cycleDays[1]) / 2 / 30.4)));
  const scale = Math.min(1, nMonths / 4);
  const rainQuad = crop.req.rainMm.map((v) => v * scale) as [number, number, number, number];

  const sTemp = trapezoid(tMean, crop.req.tempC);
  const sWater = trapezoid(waterMm, rainQuad);
  const sPh = crop.flags?.includes('ph-missing') ? null : trapezoid(ph, crop.req.ph);
  const sSal = maasHoffmanSalinity(ecDsM, crop.req.salinity);

  const drainage = drU < 0.333 ? 'poor' : drU < 0.8 ? 'well' : 'excessive';
  const sDrain = !crop.req.drainage ? null : crop.req.drainage.opt.includes(drainage) ? 1 : crop.req.drainage.abs.includes(drainage) ? 0.7 : 0.15;

  const texture = texU < 0.25 ? 'light' : texU < 0.65 ? 'medium' : texU < 0.9 ? 'heavy' : 'organic';
  const sTex = !crop.req.texture ? null : crop.req.texture.opt.includes(texture) ? 1 : crop.req.texture.abs.includes(texture) ? 0.7 : 0.15;

  const depthOrder = ['very-shallow', 'shallow', 'medium', 'deep'] as const;
  const depthCls = depthCm < 20 ? 'very-shallow' : depthCm < 50 ? 'shallow' : depthCm <= 150 ? 'medium' : 'deep';
  const sDepth = !crop.req.depth
    ? null
    : depthOrder.indexOf(depthCls) >= depthOrder.indexOf(crop.req.depth.opt)
      ? 1
      : depthOrder.indexOf(depthCls) >= depthOrder.indexOf(crop.req.depth.abs)
        ? 0.7
        : 0.15;

  const fertIdx = oldfieldFertilityIndex(socGkg, socGkg * 0.75);
  const sFert = scoreFertilityContinuous(fertIdx, crop.req.fertility);

  const flat = crop.lifeSpan === 'perennial' ? 9 : 4.6;
  const steep = crop.lifeSpan === 'perennial' ? 24 : 16.7;
  const sSlope = slopeDeg <= flat ? 1 : Math.max(0.15, 1 - (0.85 * (slopeDeg - flat)) / (steep - flat));

  const w = FACTOR_WEIGHTS;
  const items: AggregationItem[] = [
    { key: 'temperature', score: sTemp, weight: w.temperature },
    { key: 'water', score: sWater, weight: w.water },
    { key: 'ph', score: sPh, weight: w.ph },
    { key: 'salinity', score: sSal, weight: w.salinity },
    { key: 'drainage', score: sDrain, weight: w.drainage },
    { key: 'texture', score: sTex, weight: w.texture },
    { key: 'depth', score: sDepth, weight: w.depth },
    { key: 'fertility', score: sFert, weight: w.fertility },
    { key: 'slope', score: sSlope, weight: w.slope },
  ];
  return aggregateSuitability(items, 'astrovivu-v2').score;
}

function runExperiment5() {
  const N = 1024;
  const k = PARAM_BOUNDS.length; // 9
  const A: Float64Array[] = [];
  const B: Float64Array[] = [];
  for (let i = 0; i < N; i++) {
    const rowA = new Float64Array(k);
    const rowB = new Float64Array(k);
    for (let j = 0; j < k; j++) {
      rowA[j] = halton(i + 1, PRIMES_18[j]);
      rowB[j] = halton(i + 1, PRIMES_18[j + k]);
    }
    A.push(rowA);
    B.push(rowB);
  }

  const targetCrops = ['zea-mays', 'oryza-sativa', 'coffea-canephora', 'glycine-max'];
  const sobolByCrop: Record<string, unknown> = {};

  for (const cropId of targetCrops) {
    const crop = getCrop(cropId)!;
    const fA = new Float64Array(N);
    const fB = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      fA[i] = evaluateParametricPoint(crop, A[i]);
      fB[i] = evaluateParametricPoint(crop, B[i]);
    }
    // Pooled mean & variance across [fA, fB]
    let sum = 0;
    for (let i = 0; i < N; i++) sum += fA[i] + fB[i];
    const mean = sum / (2 * N);
    let varSum = 0;
    for (let i = 0; i < N; i++) varSum += (fA[i] - mean) ** 2 + (fB[i] - mean) ** 2;
    const totalVar = varSum / (2 * N - 1);

    const indices: Record<string, { firstOrderSi: number; totalEffectSTi: number; interactionShare: number; morrisMuStar: number; morrisSigma: number }> = {};
    let sumSi = 0;
    let sumSTi = 0;
    const deltaStep = 0.1;

    for (let j = 0; j < k; j++) {
      let numFirst = 0;
      let numTotal = 0;
      const ee: number[] = [];
      const ab = new Float64Array(k);
      const morrisPt = new Float64Array(k);
      for (let i = 0; i < N; i++) {
        ab.set(A[i]);
        ab[j] = B[i][j];
        const fAbj = evaluateParametricPoint(crop, ab);
        // Saltelli et al. (2010, 2019) first-order & Jansen (1999) non-negative total-effect estimator
        numFirst += fB[i] * (fAbj - fA[i]);
        numTotal += (fA[i] - fAbj) ** 2;

        if (i < 256) {
          morrisPt.set(A[i]);
          const step = morrisPt[j] + deltaStep <= 1 ? deltaStep : -deltaStep;
          morrisPt[j] = morrisPt[j] + step;
          const fStep = evaluateParametricPoint(crop, morrisPt);
          ee.push((fStep - fA[i]) / step);
        }
      }
      const si = Math.max(0, numFirst / N / totalVar);
      const sti = Math.max(si, numTotal / (2 * N) / totalVar);
      sumSi += si;
      sumSTi += sti;

      const muStar = ee.reduce((acc, v) => acc + Math.abs(v), 0) / ee.length;
      const muSigned = ee.reduce((acc, v) => acc + v, 0) / ee.length;
      const sigma = Math.sqrt(ee.reduce((acc, v) => acc + (v - muSigned) ** 2, 0) / ee.length);

      indices[PARAM_BOUNDS[j].key] = {
        firstOrderSi: round(si, 4),
        totalEffectSTi: round(sti, 4),
        interactionShare: round(Math.max(0, sti - si), 4),
        morrisMuStar: round(muStar, 4),
        morrisSigma: round(sigma, 4),
      };
    }

    sobolByCrop[cropId] = {
      sampleSizeN: N,
      totalEvaluations: N * (k + 2),
      outputMean: round(mean, 4),
      outputVariance: round(totalVar, 5),
      sumFirstOrderSi: round(sumSi, 4),
      sumTotalEffectSTi: round(sumSTi, 4),
      nonAdditiveInteractionFraction: round(Math.max(0, 1 - Math.min(1, sumSi)), 4),
      factors: indices,
    };
  }

  return {
    quasiMonteCarloSequence: 'Halton radical-inverse (first 18 primes)',
    parameterBounds: PARAM_BOUNDS,
    crops: sobolByCrop,
  };
}

// ================================================================================================
// Experiment 6: Full-Scale Catalogue Evaluation (2,062 FAO EcoCrop Species x 4 Real Biomes)
// ================================================================================================
async function runExperiment6(samples: Record<string, ReturnType<typeof loadSample>>) {
  const ecocropJson = JSON.parse(readFileSync('public/data/crops/ecocrop.json', 'utf8'));
  const allCrops = await loadFullCatalog(async () => ecocropJson);

  const parcelConfigs = [
    { parcelId: 'daklak-coffee', irrigation: 'rainfed' as const },
    { parcelId: 'cantho-rice', irrigation: 'full' as const },
    { parcelId: 'iowa-corn-soy', irrigation: 'rainfed' as const },
    { parcelId: 'nevada-alfalfa', irrigation: 'full' as const },
  ];

  const t0 = performance.now();
  const biomeSummaries: Record<string, unknown> = {};
  let totalPairs = 0;

  for (const { parcelId, irrigation } of parcelConfigs) {
    const input = samples[parcelId].makeInput(null, { irrigation });
    const classes = { S1_80_100: 0, S2_60_79: 0, S3_40_59: 0, N1_20_39: 0, N2_0_19: 0 };
    const limitingCounts: Record<string, number> = {};

    for (const crop of allCrops) {
      const a = assessCrop(input, crop.id, { irrigation })!;
      totalPairs++;
      const pct = Math.round(a.bestCompatibility * 100);
      if (pct >= 80) classes.S1_80_100++;
      else if (pct >= 60) classes.S2_60_79++;
      else if (pct >= 40) classes.S3_40_59++;
      else if (pct >= 20) classes.N1_20_39++;
      else classes.N2_0_19++;

      const limKey = a.limiting?.key ?? 'none';
      limitingCounts[limKey] = (limitingCounts[limKey] ?? 0) + 1;
    }

    const topLimiting = Object.entries(limitingCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([factor, count]) => ({ factor, count, sharePct: round((100 * count) / allCrops.length, 1) }));

    biomeSummaries[parcelId] = {
      irrigationRegime: irrigation,
      speciesEvaluated: allCrops.length,
      suitabilityClasses: classes,
      viableS1S2Count: classes.S1_80_100 + classes.S2_60_79,
      viableS1S2SharePct: round(((classes.S1_80_100 + classes.S2_60_79) / allCrops.length) * 100, 2),
      topLimitingFactors: topLimiting,
    };
  }

  const elapsedMs = performance.now() - t0;
  return {
    totalSpecies: allCrops.length,
    curatedSpecies: allCrops.filter((c) => c.curated).length,
    totalCropSitePairs: totalPairs,
    totalMonthlyWindowsEvaluated: totalPairs * 12,
    wallClockMs: round(elapsedMs, 1),
    microsecondsPerPair: round((elapsedMs * 1000) / totalPairs, 1),
    biomes: biomeSummaries,
  };
}

async function main() {
  const samples = {
    'daklak-coffee': loadSample('daklak-coffee'),
    'cantho-rice': loadSample('cantho-rice'),
    'iowa-corn-soy': loadSample('iowa-corn-soy'),
    'nevada-alfalfa': loadSample('nevada-alfalfa'),
  };

  const exp1 = runExperiment1();
  const exp2 = runExperiment2(samples);
  const exp3 = runExperiment3(samples);
  const exp4 = runExperiment4();
  const exp5 = runExperiment5();
  const exp6 = await runExperiment6(samples);

  const output = {
    generatedAt: '2026-11-14T00:00:00Z',
    engineVersion: 'Astrovivu-AEZ v2.0',
    experiment1_ahp: exp1,
    experiment2_parametricOperators: exp2,
    experiment3_physiologicalAblation: exp3,
    experiment4_salinityMaasHoffman: exp4,
    experiment5_globalSensitivitySobolMorris: exp5,
    experiment6_fullEcoCropCatalogue: exp6,
  };

  writeFileSync('data/crops/scoring-paper-results.json', JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log('Successfully generated data/crops/scoring-paper-results.json');
  console.log(
    JSON.stringify(
      {
        ahpCR: exp1.exact.cr,
        ahpDomainShares: exp1.domainShares,
        operatorMetrics: exp2.methodMetrics,
        salinityRmseV1: exp4.overallRmseV1Step,
        salinityRmseV2: exp4.overallRmseV2MaasHoffman,
        salinityRmseReductionPct: exp4.rmseReductionPct,
        fullCatalogThroughput: {
          pairs: exp6.totalCropSitePairs,
          windows: exp6.totalMonthlyWindowsEvaluated,
          ms: exp6.wallClockMs,
          usPerPair: exp6.microsecondsPerPair,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
