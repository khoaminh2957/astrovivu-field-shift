/**
 * CropSuite (Zabel, Knüttel & Poschlod 2025) against the Astrovivu-AEZ v2 scorer, on the same
 * parcels, the same crop catalogue and the same 56-case viability benchmark as
 * `evaluate-scoring-paper.ts`. The method with the better ranking skill becomes
 * `DEFAULT_SUITABILITY_METHOD`; `cropsuite.test.ts` checks that the code and this result agree.
 *
 * Run: `npx tsx scripts/crops/evaluate-cropsuite.ts` -> `data/crops/cropsuite-comparison.json`
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { listCrops } from '@/core/crops';
import { assessCrop, type AssessOptions, type CropAssessment } from '@/core/scoring';
import { BENCHMARK_56, computeBinaryMetrics, loadSample } from './evaluate-scoring-paper';

const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;
const PARCELS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;

interface Variant {
  id: string;
  label: string;
  opts: AssessOptions;
  /** Score from which the method itself calls a crop suitable. */
  nativeThreshold: number;
}
const VARIANTS: Variant[] = [
  { id: 'astrovivu-v2', label: 'Astrovivu-AEZ v2 (current default)', opts: { method: 'astrovivu-v2' }, nativeThreshold: 0.45 },
  { id: 'cropsuite', label: 'CropSuite, as published', opts: { method: 'cropsuite' }, nativeThreshold: 0.33 },
  { id: 'cropsuite-no-variability', label: 'CropSuite without climate variability', opts: { method: 'cropsuite', cropSuite: { variability: false } }, nativeThreshold: 0.33 },
  { id: 'cropsuite-no-photoperiod', label: 'CropSuite without the day-length limit', opts: { method: 'cropsuite', cropSuite: { photoperiod: false } }, nativeThreshold: 0.33 },
];

/** Sensitivity, specificity and Youden's J at one threshold, and the best J over all thresholds. */
function atThreshold(yTrue: number[], score: number[], thr: number) {
  let tp = 0;
  let fn = 0;
  let tn = 0;
  let fp = 0;
  yTrue.forEach((y, i) => {
    const pos = score[i] >= thr - 1e-9;
    if (y === 1) pos ? tp++ : fn++;
    else pos ? fp++ : tn++;
  });
  const sensitivity = tp / (tp + fn);
  const specificity = tn / (tn + fp);
  return { threshold: thr, sensitivity: round(sensitivity), specificity: round(specificity), youdenJ: round(sensitivity + specificity - 1), falseNegatives: fn, falsePositives: fp };
}
function bestThreshold(yTrue: number[], score: number[]) {
  const candidates = [...new Set(score.map((s) => round(s, 3)))].filter((s) => s > 0).sort((a, b) => a - b);
  return candidates.map((t) => atThreshold(yTrue, score, t)).reduce((a, b) => (b.youdenJ > a.youdenJ + 1e-9 ? b : a));
}

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}
function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

function main() {
  const samples = Object.fromEntries(PARCELS.map((id) => [id, loadSample(id)]));
  const yTrue = BENCHMARK_56.map((c) => c.viable);
  const run = (c: (typeof BENCHMARK_56)[number], v: Variant): CropAssessment => assessCrop(samples[c.parcelId].makeInput(c.cropId, { irrigation: c.irrigation }), c.cropId, { irrigation: c.irrigation, ...v.opts })!;

  // ---- 1. The 56-case viability benchmark ------------------------------------------------------
  const assessments = Object.fromEntries(VARIANTS.map((v) => [v.id, BENCHMARK_56.map((c) => run(c, v))]));
  const scores = Object.fromEntries(VARIANTS.map((v) => [v.id, assessments[v.id].map((a) => a.bestCompatibility)]));
  const benchmark = Object.fromEntries(
    VARIANTS.map((v) => [
      v.id,
      {
        label: v.label,
        ...computeBinaryMetrics(yTrue, scores[v.id]),
        atNativeThreshold: atThreshold(yTrue, scores[v.id], v.nativeThreshold),
        bestThreshold: bestThreshold(yTrue, scores[v.id]),
      },
    ]),
  );
  const byParcel = Object.fromEntries(
    PARCELS.map((p) => {
      const idx = BENCHMARK_56.map((c, i) => (c.parcelId === p ? i : -1)).filter((i) => i >= 0);
      const y = idx.map((i) => yTrue[i]);
      return [p, Object.fromEntries(['astrovivu-v2', 'cropsuite'].map((id) => [id, { rocAuc: computeBinaryMetrics(y, idx.map((i) => scores[id][i])).rocAuc, ...atThreshold(y, idx.map((i) => scores[id][i]), VARIANTS.find((v) => v.id === id)!.nativeThreshold) }]))];
    }),
  );
  const cases = BENCHMARK_56.map((c, i) => {
    const cs = assessments.cropsuite[i].cropSuite!;
    return {
      parcelId: c.parcelId,
      cropId: c.cropId,
      irrigation: c.irrigation,
      viable: c.viable,
      basis: c.basis,
      v2: round(scores['astrovivu-v2'][i], 3),
      v2Limiting: assessments['astrovivu-v2'][i].limiting?.key ?? null,
      cropSuite: round(scores.cropsuite[i], 3),
      cropSuiteClimate: cs.climateSuitability,
      cropSuiteSoil: cs.soilSuitability,
      cropSuiteClass: cs.class,
      cropSuiteLimiting: cs.limiting,
      failureRate: cs.failureRate,
      optimalSowingDoy: cs.optimalSowingDoy,
      harvestsPerYear: cs.harvestsPerYear,
    };
  });
  const wrong = (id: string, thr: number) => cases.filter((c, i) => (scores[id][i] >= thr - 1e-9 ? 1 : 0) !== c.viable).map((c) => ({ parcelId: c.parcelId, cropId: c.cropId, irrigation: c.irrigation, viable: c.viable, score: id === 'cropsuite' ? c.cropSuite : c.v2, limiting: id === 'cropsuite' ? c.cropSuiteLimiting : c.v2Limiting }));
  const missedByCropSuite = wrong('cropsuite', 0.33).filter((c) => c.viable === 1);
  const causes: Record<string, number> = {};
  for (const c of missedByCropSuite) causes[c.limiting ?? 'none'] = (causes[c.limiting ?? 'none'] ?? 0) + 1;

  // ---- 2. Agreement over the curated catalogue --------------------------------------------------
  const crops = listCrops();
  const agreement = Object.fromEntries(
    PARCELS.map((p) => {
      const a: number[] = [];
      const b: number[] = [];
      for (const crop of crops) {
        const input = samples[p].makeInput(crop.id, { irrigation: 'rainfed' });
        a.push(assessCrop(input, crop.id, { irrigation: 'rainfed', method: 'astrovivu-v2' })!.bestCompatibility);
        b.push(assessCrop(input, crop.id, { irrigation: 'rainfed', method: 'cropsuite', multipleCropping: false })!.bestCompatibility);
      }
      const both = a.filter((v, i) => v >= 0.45 && b[i] >= 0.33).length;
      const neither = a.filter((v, i) => v < 0.45 && b[i] < 0.33).length;
      return [p, { crops: crops.length, spearman: round(spearman(a, b), 3), suitableInBoth: both, unsuitableInBoth: neither, onlyV2: a.filter((v, i) => v >= 0.45 && b[i] < 0.33).length, onlyCropSuite: a.filter((v, i) => v < 0.45 && b[i] >= 0.33).length, meanV2: round(a.reduce((s, v) => s + v, 0) / a.length, 3), meanCropSuite: round(b.reduce((s, v) => s + v, 0) / b.length, 3) }];
    }),
  );

  // ---- 3. What only CropSuite reports: sowing day, harvests per year, failure recurrence --------
  const systems: [parcel: (typeof PARCELS)[number], cropId: string, irrigation: 'rainfed' | 'supplemental' | 'full'][] = [
    ['daklak-coffee', 'zea-mays', 'rainfed'],
    ['daklak-coffee', 'coffea-canephora', 'rainfed'],
    ['cantho-rice', 'oryza-sativa', 'full'],
    ['cantho-rice', 'vigna-radiata', 'supplemental'],
    ['iowa-corn-soy', 'zea-mays', 'rainfed'],
    ['iowa-corn-soy', 'zea-mays', 'full'],
    ['iowa-corn-soy', 'avena-sativa', 'rainfed'],
    ['nevada-alfalfa', 'medicago-sativa', 'full'],
  ];
  const calendar = systems.map(([p, cropId, irrigation]) => {
    const input = samples[p].makeInput(cropId, { irrigation });
    const v2 = assessCrop(input, cropId, { irrigation, method: 'astrovivu-v2' })!;
    const cs = assessCrop(input, cropId, { irrigation, method: 'cropsuite' })!;
    return { parcelId: p, cropId, irrigation, v2BestSowingMonth: v2.bestSowingMonth, v2Compatibility: round(v2.bestCompatibility, 3), v2Reliability: v2.reliability, ...cs.cropSuite! };
  });

  // ---- 4. Cost ----------------------------------------------------------------------------------
  const time = (method: 'astrovivu-v2' | 'cropsuite') => {
    const t0 = performance.now();
    let n = 0;
    for (const p of PARCELS) for (const crop of crops) (assessCrop(samples[p].makeInput(crop.id), crop.id, { method, multipleCropping: false }), n++);
    return round((performance.now() - t0) / n, 3);
  };
  const runtimeMsPerCropSite = { 'astrovivu-v2': time('astrovivu-v2'), cropsuite: time('cropsuite') };

  // ---- Decision: ranking skill first, calibration second ----------------------------------------
  const v2 = benchmark['astrovivu-v2'];
  const cs = benchmark.cropsuite;
  const selectedMethod = cs.rocAuc > v2.rocAuc + 1e-9 || (Math.abs(cs.rocAuc - v2.rocAuc) <= 1e-9 && cs.brierScore < v2.brierScore) ? 'cropsuite' : 'astrovivu-v2';

  const output = {
    generatedBy: 'scripts/crops/evaluate-cropsuite.ts',
    reference: 'Zabel, Knüttel & Poschlod (2025), CropSuite v1.0, Geosci. Model Dev. 18, 1067-1087, doi:10.5194/gmd-18-1067-2025',
    selectedMethod,
    selectionRule: 'higher ROC-AUC on the 56-case benchmark; on a tie, the lower Brier score',
    benchmark,
    byParcel,
    viableCasesCropSuiteRejects: { count: missedByCropSuite.length, byLimitingFactor: causes, cases: missedByCropSuite },
    errorsAtNativeThreshold: { 'astrovivu-v2': wrong('astrovivu-v2', 0.45), cropsuite: wrong('cropsuite', 0.33) },
    catalogueAgreement: agreement,
    calendar,
    runtimeMsPerCropSite,
    cases,
  };
  writeFileSync('data/crops/cropsuite-comparison.json', JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`selected: ${selectedMethod}`);
  for (const v of VARIANTS) {
    const m = benchmark[v.id];
    console.log(`${v.id.padEnd(26)} AUC ${m.rocAuc}  Brier ${m.brierScore}  native thr ${v.nativeThreshold}: sens ${m.atNativeThreshold.sensitivity} spec ${m.atNativeThreshold.specificity} J ${m.atNativeThreshold.youdenJ}  best J ${m.bestThreshold.youdenJ} @ ${m.bestThreshold.threshold}`);
  }
  console.log('viable cases CropSuite rejects, by limiting factor:', causes);
  console.log('catalogue agreement:', JSON.stringify(agreement));
  console.log('runtime ms per crop-site:', runtimeMsPerCropSite);
}

main();
