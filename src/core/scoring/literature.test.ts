import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, GroundTruth, ModelInput } from '@/contracts';
import { getCrop } from '@/core/crops';
import { getSampleParcel } from '@/data/samples';
import {
  adjustKcClimate,
  aggregateSuitability,
  AHP_PAIRWISE_MATRIX,
  AHP_SOLUTION,
  assessCrop,
  assimilateSatelliteCondition,
  asymmetricHeatFactor,
  borgGrimesRootDepth,
  computeScoreDetail,
  drainagePercolationMmDay,
  estimateRhMin,
  FACTOR_WEIGHTS,
  feddesAerationFactor,
  isHydrophyticCrop,
  maasHoffmanSalinity,
  monteithRadiationFactor,
  oldfieldFertilityIndex,
  scoreFertilityContinuous,
  solveAhpMatrix,
  whatIf,
  type AggregationItem,
} from './index';
import { GRADED_FACTOR_KEYS } from './literature';

const sampleInput = (id: string, cropId: string | null, groundTruth: GroundTruth = {}): ModelInput => {
  const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
  return {
    parcel: getSampleParcel(id)!,
    telemetry,
    cropId,
    groundTruth,
    priorities: ['profit'],
    today: telemetry.window.today,
  };
};

describe('Saaty (1980) AHP pairwise matrix & eigenvector solver', () => {
  it('satisfies exact reciprocity, eigenvalue identity Aw = lambda_max * w, and CR < 0.01', () => {
    const n = AHP_PAIRWISE_MATRIX.length;
    expect(n).toBe(9);
    for (let i = 0; i < n; i++) {
      expect(AHP_PAIRWISE_MATRIX[i][i]).toBe(1);
      for (let j = 0; j < n; j++) {
        expect(AHP_PAIRWISE_MATRIX[i][j] * AHP_PAIRWISE_MATRIX[j][i]).toBeCloseTo(1, 12);
      }
    }
    const sol = solveAhpMatrix(AHP_PAIRWISE_MATRIX);
    const wVec = GRADED_FACTOR_KEYS.map((k) => sol.weights[k]);
    expect(wVec.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    for (let i = 0; i < n; i++) {
      let aw = 0;
      for (let j = 0; j < n; j++) aw += AHP_PAIRWISE_MATRIX[i][j] * wVec[j];
      expect(aw / wVec[i]).toBeCloseTo(sol.lambdaMax, 3);
    }
    expect(sol.cr).toBeLessThan(0.01);
    expect(sol.cr).toBeCloseTo(0.002957, 5);
  });

  it('preserves the four agro-ecological criticality tiers and normalizes primary climate to 1.0', () => {
    const e = FACTOR_WEIGHTS;
    expect(e.temperature).toBe(1);
    expect(e.water).toBe(1);
    expect(e.ph).toBe(e.salinity);
    expect(e.salinity).toBe(e.drainage);
    expect(e.texture).toBe(e.depth);
    expect(e.fertility).toBe(e.slope);
    expect(e.temperature).toBeGreaterThan(e.ph);
    expect(e.ph).toBeGreaterThan(e.texture);
    expect(e.texture).toBeGreaterThan(e.fertility);

    const w = AHP_SOLUTION.weights;
    const climateShare = w.temperature + w.water;
    const chemHydroShare = w.ph + w.salinity + w.drainage;
    const physShare = w.texture + w.depth;
    const fertTopoShare = w.fertility + w.slope;
    expect(climateShare).toBeGreaterThan(0.44);
    expect(chemHydroShare).toBeGreaterThan(0.34);
    expect(physShare).toBeGreaterThan(0.1);
    expect(fertTopoShare).toBeGreaterThan(0.08);
  });
});

describe('Parametric suitability aggregation theorems (WLC, Storie, Khiddir, Pure Geometric, Astrovivu-AEZ v2)', () => {
  const mkItems = (scores: Partial<Record<string, number | null>>, gate?: number): AggregationItem[] => {
    const items: AggregationItem[] = GRADED_FACTOR_KEYS.map((k) => ({
      key: k,
      score: k in scores ? (scores[k] ?? null) : 1,
      weight: FACTOR_WEIGHTS[k],
    }));
    if (gate != null) items.push({ key: 'frost', score: gate, weight: 1, isGate: true });
    return items;
  };

  it('Theorem 1 (Zero-Veto): any lethal climatic, edaphic or gate zero yields 0 in astrovivu-v2, while WLC falsely passes', () => {
    const zeroWater = mkItems({ water: 0 });
    expect(aggregateSuitability(zeroWater, 'astrovivu-v2').score).toBe(0);
    expect(aggregateSuitability(zeroWater, 'astrovivu-v2').limitingIndex).toBe(1);
    expect(aggregateSuitability(zeroWater, 'wlc').score).toBeGreaterThan(0.75);

    const zeroPh = mkItems({ ph: 0 });
    expect(aggregateSuitability(zeroPh, 'astrovivu-v2').score).toBe(0);

    const zeroFrost = mkItems({}, 0);
    expect(aggregateSuitability(zeroFrost, 'astrovivu-v2').score).toBe(0);
  });

  it('Theorem 2 (Single-Limitation Equivalence): equals exact AHP power s_k^alpha_k when a single factor is sub-optimal', () => {
    for (const key of GRADED_FACTOR_KEYS) {
      for (const s of [0.25, 0.5, 0.75, 0.9]) {
        const items = mkItems({ [key]: s });
        const v2 = aggregateSuitability(items, 'astrovivu-v2').score;
        const v1 = aggregateSuitability(items, 'ecocrop-gaez').score;
        expect(v2).toBeCloseTo(s ** FACTOR_WEIGHTS[key], 10);
        expect(v2).toBeCloseTo(v1, 10);
      }
    }
  });

  it('Theorem 3 (Continuity Across Rank Ties): has zero jump discontinuity when two edaphic factors swap rank order', () => {
    const eps = 1e-6;
    const left = aggregateSuitability(mkItems({ ph: 0.7 - eps, salinity: 0.7 + eps }), 'astrovivu-v2').score;
    const tie = aggregateSuitability(mkItems({ ph: 0.7, salinity: 0.7 }), 'astrovivu-v2').score;
    const right = aggregateSuitability(mkItems({ ph: 0.7 + eps, salinity: 0.7 - eps }), 'astrovivu-v2').score;
    expect(Math.abs(left - tie)).toBeLessThan(1e-5);
    expect(Math.abs(right - tie)).toBeLessThan(1e-5);
    expect(left).toBeCloseTo(right, 10);
  });

  it('Theorem 4 (Strict Monotonicity & Bounded Multi-Factor Attenuation): avoids Storie collapse under compound moderate soil limits', () => {
    const compound = mkItems({ ph: 0.75, salinity: 0.75, drainage: 0.75, texture: 0.75, depth: 0.75, fertility: 0.75, slope: 0.75 });
    const storie = aggregateSuitability(compound, 'storie').score;
    const gaez = aggregateSuitability(compound, 'ecocrop-gaez').score;
    const v2 = aggregateSuitability(compound, 'astrovivu-v2').score;
    const single = aggregateSuitability(mkItems({ ph: 0.75 }), 'astrovivu-v2').score;

    expect(storie).toBeCloseTo(0.75 ** 7, 6);
    expect(storie).toBeLessThan(0.15); // Severe Storie multiplicative collapse
    expect(v2).toBeGreaterThan(gaez + 0.08); // Rank damping prevents artificial collapse
    expect(v2).toBeLessThan(single); // Still strictly penalizes secondary constraints

    // Strict monotonicity check across perturbations
    for (const key of GRADED_FACTOR_KEYS) {
      const low = aggregateSuitability(mkItems({ ph: 0.7, drainage: 0.7, [key]: 0.55 }), 'astrovivu-v2').score;
      const high = aggregateSuitability(mkItems({ ph: 0.7, drainage: 0.7, [key]: 0.65 }), 'astrovivu-v2').score;
      expect(high).toBeGreaterThan(low);
    }
  });
});

describe('Continuous edaphic functions: Maas-Hoffman (1977) salinity & Oldfield et al. (2019) fertility', () => {
  it('models continuous Maas-Hoffman salinity response with class-ordered tolerance', () => {
    const sensitive = { opt: 'none' as const, abs: 'low' as const };
    const medium = { opt: 'low' as const, abs: 'medium' as const };
    const tolerant = { opt: 'medium' as const, abs: 'high' as const };

    expect(maasHoffmanSalinity(null, sensitive)).toBeNull();
    expect(maasHoffmanSalinity(0.8, sensitive)).toBe(1);
    expect(maasHoffmanSalinity(1.3, sensitive)).toBe(1);
    // Continuous decline between 2.0 and 6.0 dS/m (no cliff step)
    const s2 = maasHoffmanSalinity(2.0, sensitive)!;
    const s4 = maasHoffmanSalinity(4.0, sensitive)!;
    const s6 = maasHoffmanSalinity(6.0, sensitive)!;
    expect(s2).toBeGreaterThan(s4);
    expect(s4).toBeGreaterThan(s6);
    expect(s6).toBeGreaterThanOrEqual(0.1);

    // At 5 dS/m: tolerant > medium > sensitive
    expect(maasHoffmanSalinity(5, tolerant)!).toBeGreaterThan(maasHoffmanSalinity(5, medium)!);
    expect(maasHoffmanSalinity(5, medium)!).toBeGreaterThan(maasHoffmanSalinity(5, sensitive)!);
  });

  it('models Oldfield et al. (2019) saturating Michaelis-Menten SOC/CEC response plateauing at 20 g/kg', () => {
    expect(oldfieldFertilityIndex(null, null)).toBeNull();
    expect(oldfieldFertilityIndex(0, null)).toBe(0);
    expect(oldfieldFertilityIndex(20, null)).toBe(1);
    expect(oldfieldFertilityIndex(35, 25)).toBe(1);

    // Concave diminishing returns: gain from 0 -> 8 g/kg exceeds gain from 8 -> 16 g/kg
    const f0 = oldfieldFertilityIndex(0, null)!;
    const f8 = oldfieldFertilityIndex(8, null)!;
    const f16 = oldfieldFertilityIndex(16, null)!;
    expect(f8 - f0).toBeGreaterThan(f16 - f8);
    expect(f8).toBeGreaterThan(0.5); // Half-saturation around 8 g/kg

    const highNeed = { opt: 'high' as const, abs: 'moderate' as const };
    expect(scoreFertilityContinuous(0.85, highNeed)).toBe(1);
    expect(scoreFertilityContinuous(0.1, highNeed)!).toBeGreaterThanOrEqual(0.2);
  });
});

describe('Physiological water, root, aeration, thermal, radiation & EO assimilation functions', () => {
  it('grows roots sigmoidally from 0.15 m to Zr,max for annuals and keeps perennials at Zr,max (Borg & Grimes 1986)', () => {
    expect(borgGrimesRootDepth(0, 50, 1.2, true)).toBe(1.2);
    const d0 = borgGrimesRootDepth(0, 50, 1.2, false);
    const d15 = borgGrimesRootDepth(15, 50, 1.2, false);
    const d35 = borgGrimesRootDepth(35, 50, 1.2, false);
    const d50 = borgGrimesRootDepth(50, 50, 1.2, false);
    const d90 = borgGrimesRootDepth(90, 50, 1.2, false);

    expect(d0).toBeGreaterThanOrEqual(0.15);
    expect(d0).toBeLessThan(0.22);
    expect(d15).toBeGreaterThan(d0);
    expect(d35).toBeGreaterThan(d15);
    expect(d50).toBeCloseTo(1.2, 2);
    expect(d90).toBe(1.2);
  });

  it('adjusts Kc,mid upward in arid windy climates and downward in humid calm climates (FAO-56 eq. 62)', () => {
    const rhArid = estimateRhMin(28, 14, 34);
    const rhHumid = estimateRhMin(88, 24, 31);
    expect(rhArid).toBeLessThan(25);
    expect(rhHumid).toBeGreaterThan(65);

    const kcStandard = adjustKcClimate(1.2, 2.0, 45, 2.0);
    const kcAridWindy = adjustKcClimate(1.2, 4.2, rhArid, 2.0);
    const kcHumidCalm = adjustKcClimate(1.2, 1.2, rhHumid, 2.0);

    expect(kcStandard).toBeCloseTo(1.2, 5);
    expect(kcAridWindy).toBeGreaterThan(1.28);
    expect(kcHumidCalm).toBeLessThan(1.15);
    // FAO-56 rule: do not adjust Kc < 0.45
    expect(adjustKcClimate(0.35, 5.0, 20, 2.0)).toBe(0.35);
  });

  it('penalizes upland crops under poor-drainage saturation excess while exempting hydrophytic rice (Feddes/AquaCrop)', () => {
    const rice = getCrop('oryza-sativa')!;
    const soy = getCrop('glycine-max')!;
    expect(isHydrophyticCrop(rice)).toBe(true);
    expect(isHydrophyticCrop(soy)).toBe(false);
    expect(drainagePercolationMmDay('poor', 'heavy')).toBeLessThan(drainagePercolationMmDay('well', 'medium'));

    expect(feddesAerationFactor(60, 0.8, true)).toBe(1);
    expect(feddesAerationFactor(5, 0.8, false)).toBe(1); // Below anaerobiosis threshold
    expect(feddesAerationFactor(55, 0.8, false)).toBeLessThan(0.55);

    // End-to-end check on monsoon Mekong Delta parcel: improving poor drainage lifts soybean season score
    const soyPoor = sampleInput('cantho-rice', 'glycine-max', { drainage: 'poor', sowingDate: '2026-06-01' });
    const moves = whatIf(soyPoor, { drainage: 'well' });
    expect(moves[0].delta).toBeGreaterThan(0);
  });

  it('captures reproductive daytime Tmax shock, Monteith PAR cloudiness, and multi-sensor EO assimilation', () => {
    const maize = getCrop('zea-mays')!;
    const vegShock = asymmetricHeatFactor(28, 39, maize.req.tempC, 'initial', true)!;
    const midShock = asymmetricHeatFactor(28, 39, maize.req.tempC, 'mid-season', true)!;
    expect(midShock).toBeLessThan(vegShock);
    expect(asymmetricHeatFactor(26, 31, maize.req.tempC, 'mid-season', true)).toBe(1);

    expect(monteithRadiationFactor(9.5, maize)).toBe(1);
    expect(monteithRadiationFactor(3.2, maize)!).toBeLessThan(0.85);

    expect(assimilateSatelliteCondition({ ndvi: null, esi: null, smRoot: null, lstCanopy: null })).toBeNull();
    expect(assimilateSatelliteCondition({ ndvi: 0.8, esi: null, smRoot: null, lstCanopy: null })).toBeCloseTo(0.8, 6);
    const fullFusion = assimilateSatelliteCondition({ ndvi: 0.9, esi: 0.8, smRoot: 0.7, lstCanopy: 0.6 })!;
    expect(fullFusion).toBeCloseTo(0.9 * 0.42 + 0.8 * 0.24 + 0.7 * 0.2 + 0.6 * 0.14, 6);
  });

  it('computes seasonal GDD and calibrates satellite root-zone soil moisture with ground-truth probes', () => {
    const iaMaize = assessCrop(sampleInput('iowa-corn-soy', 'zea-mays'), 'zea-mays')!;
    expect(iaMaize.seasonalGdd).toBeGreaterThan(1200);

    const baseInput = sampleInput('daklak-coffee', 'coffea-canephora');
    const smSeries = baseInput.telemetry.branches.soilMoisture?.series.find((s) => s.key === 'sm_root');
    expect(smSeries?.samples.length).toBeGreaterThan(10);
    const sampleDate = smSeries!.samples[5].t;
    const calibrated = computeScoreDetail({
      ...baseInput,
      groundTruth: { measuredSoilMoisture: [{ t: sampleDate, v: 0.12 }] },
    });
    const note = calibrated.timeline.summary.calibration.find((c) => c.key === 'soilMoisture');
    expect(note).toBeTruthy();
    expect(note?.scoreEffect).toBeTruthy();
  });
});
