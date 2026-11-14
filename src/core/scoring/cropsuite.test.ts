import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, GroundTruth, ModelInput } from '@/contracts';
import { getCrop } from '@/core/crops';
import { getSampleParcel } from '@/data/samples';
import { DAKLAK_MONTHLY } from './__fixtures__/daklak';
import {
  CROPSUITE,
  cropSuiteParams,
  evaluateCropSuite,
  membership,
  multipleCropping,
  prepareCropSuiteClimate,
  quadMembership,
  runCropSuite,
  suitabilityClass,
  variabilitySuitability,
  variabilityThresholds,
  type CropSuiteSite,
} from './cropsuite';
import { assessCrop, assessCropSuite, DEFAULT_SUITABILITY_METHOD } from './index';

/** ERA5 2005-2024 at the Đắk Lắk test point as the flat monthly sequences the model takes. */
function daklakClimate(lat = 12.8) {
  const years = DAKLAK_MONTHLY.length;
  const rain = new Float64Array(years * 12);
  const tMean = new Float64Array(years * 12);
  const tMin = new Float64Array(years * 12);
  DAKLAK_MONTHLY.forEach(([, ...months], y) =>
    months.forEach(([r, t, tn], m) => {
      rain[y * 12 + m] = r;
      tMean[y * 12 + m] = t;
      tMin[y * 12 + m] = tn;
    }),
  );
  return prepareCropSuiteClimate({ years, rain, tMean, tMin }, lat)!;
}
const GOOD_SOIL: CropSuiteSite = { ph: 6.2, ecDsM: 0.5, texture: 'medium', drainage: 'well', depthCm: 200, fertilityIndex: 0.9, slopeDeg: 1 };
const crop = (id: string) => getCrop(id)!;

function sampleInput(id: string, cropId: string, groundTruth: GroundTruth = {}): ModelInput {
  const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
  return { parcel: getSampleParcel(id)!, telemetry, cropId, groundTruth, priorities: ['profit'], today: telemetry.window.today };
}

describe('membership functions', () => {
  const fn = quadMembership([10, 20, 30, 40]);
  it('is 0 at the absolute limits, 100 across the optimum and linear between', () => {
    expect(membership(fn, 5)).toBe(0);
    expect(membership(fn, 10)).toBe(0);
    expect(membership(fn, 15)).toBeCloseTo(50);
    expect(membership(fn, 20)).toBe(100);
    expect(membership(fn, 30)).toBe(100);
    expect(membership(fn, 37.5)).toBeCloseTo(25);
    expect(membership(fn, 99)).toBe(0);
  });
  it('keeps the upper value on a step and stays flat beyond the last node', () => {
    const step = quadMembership([10, 10, 30, 30]);
    expect(membership(step, 9.9)).toBe(0);
    expect(membership(step, 10)).toBe(100);
    expect(membership(step, 30)).toBe(100);
    expect(membership({ x: [0, 2], y: [0, 100] }, 5)).toBe(100);
  });
  it('puts the variability thresholds where the function crosses the level', () => {
    const [lo, hi] = variabilityThresholds(fn, 7.5);
    expect(lo).toBeCloseTo(10.75);
    expect(hi).toBeCloseTo(39.25);
    // A side that never comes down takes its outermost node (paper, section 2.2).
    expect(variabilityThresholds({ x: [0, 500, 2000], y: [0, 100, 30] }, 7.5)[1]).toBe(2000);
  });
});

describe('climate variability', () => {
  it('follows the sigmoid of the paper: 100 at 0 %, about 73 at 10 %, 0 from 25 %', () => {
    expect(variabilitySuitability(0)).toBeCloseTo(100);
    expect(variabilitySuitability(0.1)).toBeGreaterThan(70);
    expect(variabilitySuitability(0.1)).toBeLessThan(76);
    expect(variabilitySuitability(0.15)).toBeGreaterThan(24);
    expect(variabilitySuitability(0.15)).toBeLessThan(30);
    expect(variabilitySuitability(0.25)).toBe(0);
    expect(variabilitySuitability(0.6)).toBe(0);
  });
  it('never rises with the failure rate', () => {
    for (let r = 0; r < 0.3; r += 0.01) expect(variabilitySuitability(r + 0.01)).toBeLessThanOrEqual(variabilitySuitability(r));
  });
  it('lowers or keeps a suitability, never raises it', () => {
    const clim = daklakClimate();
    for (const id of ['zea-mays', 'oryza-sativa', 'coffea-canephora', 'triticum-aestivum']) {
      const p = cropSuiteParams(crop(id));
      const withVar = runCropSuite(p, GOOD_SOIL, clim);
      const without = runCropSuite(p, GOOD_SOIL, clim, { variability: false });
      for (let d = 0; d < 365; d += 7) expect(withVar.climate[d]).toBeLessThanOrEqual(without.climate[d] + 1e-9);
    }
  });
});

describe('suitability classes (paper, Table 3)', () => {
  it('splits 0-100 at 1, 33 and 75', () => {
    expect([0, 1, 32, 33, 74, 75, 100].map(suitabilityClass)).toEqual(['unsuitable', 'marginal', 'marginal', 'moderate', 'moderate', 'high', 'high']);
  });
});

describe('crop parameterisation', () => {
  it('gives a perennial a 365-day cycle and an annual its mean cycle', () => {
    expect(cropSuiteParams(crop('coffea-canephora')).cycleDays).toBe(365);
    const maize = crop('zea-mays');
    expect(cropSuiteParams(maize).cycleDays).toBe(Math.round((maize.cycleDays[0] + maize.cycleDays[1]) / 2));
  });
  it('turns soil classes into membership values: optimal 100, tolerated 60, outside 0', () => {
    const p = cropSuiteParams(crop('zea-mays'));
    const maize = crop('zea-mays').req;
    for (const c of maize.texture!.opt) expect(p.texture![c]).toBe(100);
    for (const c of maize.texture!.abs.filter((x) => !maize.texture!.opt.includes(x))) expect(p.texture![c]).toBe(CROPSUITE.toleratedClass);
    const clim = daklakClimate();
    const organicOnly = runCropSuite({ ...p, texture: { organic: 100 } }, GOOD_SOIL, clim);
    expect(organicOnly.soilSuitability).toBe(0);
  });
});

describe('Liebig minimum', () => {
  const clim = daklakClimate();
  it('takes the lowest factor: crop = min(climate, soil), with the limiting factor named', () => {
    const p = cropSuiteParams(crop('zea-mays'));
    const run = runCropSuite(p, { ...GOOD_SOIL, ph: 4.9 }, clim);
    const ev = evaluateCropSuite(run, clim, run.optimalSowingDoy);
    const lowest = Math.min(...ev.factors.filter((f) => f.suitability != null).map((f) => f.suitability!));
    expect(ev.cropSuitability).toBeCloseTo(lowest);
    expect(ev.cropSuitability).toBeCloseTo(Math.min(ev.climateSuitability, ev.soilSuitability!));
    expect(ev.limiting!.suitability).toBeCloseTo(lowest);
    expect(ev.limiting!.key).toBe('ph');
  });
  it('skips a missing soil value instead of scoring it as 0', () => {
    const p = cropSuiteParams(crop('zea-mays'));
    const noSoil = runCropSuite(p, { ph: null, ecDsM: null, texture: null, drainage: null, depthCm: null, fertilityIndex: null, slopeDeg: null }, clim);
    expect(noSoil.soilSuitability).toBeNull();
    const ev = evaluateCropSuite(noSoil, clim, noSoil.optimalSowingDoy);
    expect(ev.cropSuitability).toBeCloseTo(ev.climateSuitability);
  });
});

describe('rainfed and irrigated systems', () => {
  const clim = daklakClimate();
  it('rejects rainfed black pepper at Đắk Lắk on water and accepts it irrigated', () => {
    const p = cropSuiteParams(crop('piper-nigrum'));
    const rainfed = evaluateCropSuite(runCropSuite(p, GOOD_SOIL, clim), clim, 1);
    expect(rainfed.climateSuitability).toBe(0);
    expect(rainfed.limiting!.key).toBe('water');
    const irrigated = evaluateCropSuite(runCropSuite(p, GOOD_SOIL, clim, { irrigation: 'full' }), clim, 1);
    expect(irrigated.factors.find((f) => f.key === 'water')!.suitability).toBeNull();
    expect(irrigated.climateSuitability).toBeGreaterThan(75);
  });
});

describe('lethal limits', () => {
  const clim = daklakClimate();
  const maize = cropSuiteParams(crop('zea-mays'));
  const at = (params: typeof maize) => {
    const run = runCropSuite(params, GOOD_SOIL, clim);
    return evaluateCropSuite(run, clim, run.optimalSowingDoy);
  };
  it('sets the suitability to 0 when a vernalization requirement cannot be met in the tropics', () => {
    const good = at(maize);
    expect(good.climateSuitability).toBeGreaterThan(0);
    // Same sowing day, now as a winter crop that needs 30 days between 0 and 10 °C.
    const winterRun = runCropSuite({ ...maize, vernalization: { tMinC: 0, tMaxC: 10, days: 30 } }, GOOD_SOIL, clim);
    const winter = evaluateCropSuite(winterRun, clim, good.sowingDoy);
    expect(winterRun.suitableSowingDays).toBe(0);
    expect(winter.climateSuitability).toBe(0);
    expect(winter.limiting!.key).toBe('vernalization');
  });
  it('applies germination and dry-spell limits when a crop sets them', () => {
    expect(at({ ...maize, germination: { days: 10, minTempC: 35 } }).climateSuitability).toBe(0);
    expect(at({ ...maize, germination: { days: 10, minTempC: 10 } }).climateSuitability).toBeGreaterThan(0);
    // Sown in January, in the dry season: more than 30 dry days in a row.
    const run = runCropSuite({ ...maize, maxDryDays: 30 }, GOOD_SOIL, clim);
    expect(evaluateCropSuite(run, clim, 5).factors.find((f) => f.key === 'drySpell')!.suitability).toBe(0);
  });
  it('kills a tropical perennial where winter nights fall below its killing temperature', () => {
    const cold = prepareCropSuiteClimate({ years: 6, rain: new Float64Array(72).fill(80), tMean: new Float64Array(72).map((_, i) => (i % 12 < 2 || i % 12 > 9 ? -2 : 18)), tMin: new Float64Array(72).map((_, i) => (i % 12 < 2 || i % 12 > 9 ? -9 : 12)) }, 42)!;
    const coffee = runCropSuite(cropSuiteParams(crop('coffea-canephora')), GOOD_SOIL, cold, { irrigation: 'full' });
    expect(evaluateCropSuite(coffee, cold, 1).factors.find((f) => f.key === 'frost')!.suitability).toBe(0);
  });
});

describe('multiple cropping', () => {
  const flat = new Float64Array(365).fill(80);
  it('fits as many cycles plus 21-day turnarounds as the year holds, up to three', () => {
    expect(multipleCropping(flat, 100).harvests).toBe(3);
    expect(multipleCropping(flat, 150).harvests).toBe(2);
    expect(multipleCropping(flat, 200).harvests).toBe(1);
    expect(multipleCropping(flat, 60).harvests).toBe(3);
  });
  it('keeps the sowing days a cycle and a turnaround apart', () => {
    const { sowingDoys } = multipleCropping(flat, 100);
    const gaps = sowingDoys.map((d, i) => (sowingDoys[(i + 1) % sowingDoys.length] - d + 365) % 365);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(121);
  });
  it('only sows on suitable days and reports no harvest when none is', () => {
    expect(multipleCropping(new Float64Array(365), 90)).toEqual({ harvests: 0, sowingDoys: [], total: 0 });
    const oneWindow = new Float64Array(365);
    oneWindow.fill(90, 120, 150);
    const r = multipleCropping(oneWindow, 90);
    expect(r.harvests).toBe(1);
    expect(r.sowingDoys[0]).toBeGreaterThan(120);
    expect(r.sowingDoys[0]).toBeLessThanOrEqual(150);
  });
});

describe('CropSuite through the scoring API', () => {
  it('returns the paper outputs for the Đắk Lắk robusta parcel', () => {
    const a = assessCropSuite(sampleInput('daklak-coffee', 'coffea-canephora'), 'coffea-canephora')!;
    const cs = a.cropSuite!;
    expect(cs.perennial).toBe(true);
    expect(cs.optimalSowingDoy).toBe(1);
    expect(cs.cropSuitability).toBe(Math.min(cs.climateSuitability, cs.soilSuitability ?? 100));
    expect(a.compatibility).toBeCloseTo(cs.cropSuitability / 100, 2);
    expect(cs.limiting).toBe('water');
    expect(a.limiting!.key).toBe('water');
    expect(a.reliability!.yearsTotal).toBeGreaterThanOrEqual(15);
  });
  it('lifts the water limit with irrigation, as v2 does', () => {
    const input = sampleInput('daklak-coffee', 'coffea-canephora', { irrigation: 'full' });
    expect(assessCropSuite(input, 'coffea-canephora')!.cropSuite!.climateSuitability).toBe(100);
  });
  it('finds a sowing day and several harvests for an annual in the Mekong delta', () => {
    const cs = assessCropSuite(sampleInput('cantho-rice', 'vigna-radiata', { irrigation: 'supplemental' }), 'vigna-radiata')!.cropSuite!;
    expect(cs.perennial).toBe(false);
    expect(cs.suitableSowingDays).toBeGreaterThan(100);
    expect(cs.harvestsPerYear).toBeGreaterThanOrEqual(2);
    expect(cs.sowingDoys).toHaveLength(cs.harvestsPerYear);
  });
  it('uses the sowing date the farmer gives', () => {
    const cs = assessCropSuite(sampleInput('daklak-coffee', 'zea-mays', { sowingDate: '2026-01-10' }), 'zea-mays')!.cropSuite!;
    expect(cs.sowingDoy).toBe(10);
    expect(cs.cropSuitability).toBe(0); // dry season
  });
  it('leaves the v2 result untouched when the method is not asked for', () => {
    const input = sampleInput('daklak-coffee', 'coffea-canephora');
    expect(assessCrop(input, 'coffea-canephora', { method: 'astrovivu-v2' })!.cropSuite).toBeUndefined();
  });
});

describe('default method', () => {
  it('is the method the benchmark selected (scripts/crops/evaluate-cropsuite.ts)', () => {
    const result = JSON.parse(readFileSync('data/crops/cropsuite-comparison.json', 'utf8')) as { selectedMethod: string };
    expect(DEFAULT_SUITABILITY_METHOD).toBe(result.selectedMethod);
  });
});
