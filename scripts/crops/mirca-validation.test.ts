import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCrop } from '@/core/crops';
import { DEFAULT_SUITABILITY_METHOD } from '@/core/scoring';
import { cropClass, type ValidationFile } from './build-mirca-validation';
import { CROP_CLASSES, labelOf, rocAuc } from './evaluate-mirca-validation';

describe('MIRCA-OS validation: labels', () => {
  it('folds cropping seasons into their crop class', () => {
    expect(cropClass('Rice2')).toBe('Rice');
    expect(cropClass('Wheat1')).toBe('Wheat');
    expect(cropClass('Others annual3')).toBe('Others annual');
    expect(cropClass('Others perennial  ')).toBe('Others perennial');
    expect(cropClass('Sugar cane')).toBe('Sugar cane');
  });

  const stat = (rfHa: number, irHa: number) => ({ rfHa, irHa, rf: [], ir: [] });

  it('calls a crop grown from 1 % of the unit area and at least 100 ha', () => {
    expect(labelOf(stat(1000, 0), 'rainfed', 100_000, 0)).toEqual({ viable: 1 });
    expect(labelOf(stat(999, 0), 'rainfed', 100_000, 0)).toBeNull(); // a trace: no statement
    expect(labelOf(stat(99, 0), 'rainfed', 5000, 0)).toBeNull(); // 2 % of the unit but under 100 ha
    expect(labelOf(stat(0, 2000), 'irrigated', 100_000, 30_000)).toEqual({ viable: 1 });
  });

  it('separates a crop that is absent from one grown only with irrigation', () => {
    expect(labelOf(stat(0, 0), 'rainfed', 100_000, 0)).toEqual({ viable: 0, kind: 'absent' });
    expect(labelOf(undefined, 'rainfed', 100_000, 0)).toEqual({ viable: 0, kind: 'absent' });
    expect(labelOf(stat(0, 5000), 'rainfed', 100_000, 30_000)).toEqual({ viable: 0, kind: 'irrigated-only' });
  });

  it('asks about irrigated crops only where the unit irrigates', () => {
    expect(labelOf(stat(0, 0), 'irrigated', 100_000, 30_000)).toEqual({ viable: 0, kind: 'absent' });
    expect(labelOf(stat(0, 0), 'irrigated', 100_000, 2000)).toBeNull(); // 2 % irrigated: no statement
    expect(labelOf(stat(5000, 0), 'irrigated', 100_000, 30_000)).toBeNull(); // grown rainfed: irrigation would not hurt it
  });

  it('maps the curated crop classes onto catalogue crops', () => {
    for (const def of Object.values(CROP_CLASSES)) if (def.curated) for (const id of def.ids) expect(getCrop(id), id).toBeDefined();
  });
});

describe('MIRCA-OS validation: ROC-AUC', () => {
  it('is 1 for a perfect ranking, 0 for the reverse and 0.5 for ties', () => {
    expect(rocAuc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9])).toBe(1);
    expect(rocAuc([1, 1, 0, 0], [0.1, 0.2, 0.8, 0.9])).toBe(0);
    expect(rocAuc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5])).toBe(0.5);
    expect(rocAuc([1, 1], [0.2, 0.4])).toBeNaN();
  });

  it('equals the pairwise definition', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const y = Array.from({ length: 200 }, () => (rand() < 0.4 ? 1 : 0));
    const s = y.map((v) => Math.round((0.3 * v + rand()) * 10) / 10); // rounded: many ties
    let c = 0;
    let pairs = 0;
    for (let i = 0; i < y.length; i++)
      for (let j = 0; j < y.length; j++) {
        if (y[i] !== 1 || y[j] !== 0) continue;
        pairs++;
        c += s[i] > s[j] ? 1 : s[i] === s[j] ? 0.5 : 0;
      }
    expect(rocAuc(y, s)).toBeCloseTo(c / pairs, 10);
    // Restricting to an index list gives the AUC of that subset.
    const idx = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(rocAuc(y, s, idx)).toBeCloseTo(rocAuc(idx.map((i) => y[i]), idx.map((i) => s[i])), 10);
  });
});

const SITES = 'data/crops/validation/mirca-os-2015-sites.json';
const RESULTS = 'data/crops/mirca-validation-results.json';

// The bodies of skipped suites still run when tests are collected, so the files are read lazily.
describe.runIf(existsSync(SITES))('MIRCA-OS validation: the site file', () => {
  const load = () => JSON.parse(readFileSync(SITES, 'utf8')) as ValidationFile;

  it('has a climate record of whole years and a crop table for every site', () => {
    const file = load();
    const months = (file.years[1] - file.years[0] + 1) * 12;
    expect(file.sites.length).toBeGreaterThan(100);
    for (const s of file.sites) {
      expect(s.climate.rain.length, s.unitCode).toBe(months);
      expect(s.climate.tMean.length, s.unitCode).toBe(months);
      expect(s.climate.tMin.length, s.unitCode).toBe(months);
      expect(Math.abs(s.site[1]), s.unitCode).toBeLessThanOrEqual(90);
      expect(Math.abs(s.site[0]), s.unitCode).toBeLessThanOrEqual(180);
      expect(Math.max(...s.spanKm), s.unitCode).toBeLessThanOrEqual(file.sampling.maxSpanKm);
      expect(s.totalHa, s.unitCode).toBeGreaterThanOrEqual(file.sampling.minUnitHa);
      expect(Object.keys(s.crops).length, s.unitCode).toBeGreaterThan(10);
    }
  });

  it('has one site per unit', () => {
    const file = load();
    expect(new Set(file.sites.map((s) => s.unitCode)).size).toBe(file.sites.length);
  });
});

interface Results {
  selectedMethod: string;
  sites: { n: number };
  suitability: { curated: { pooled: Record<string, { rocAuc: number; n: number }> } };
}

describe.runIf(existsSync(RESULTS))('MIRCA-OS validation: the results', () => {
  const load = () => JSON.parse(readFileSync(RESULTS, 'utf8')) as Results;

  it('names the method with the higher ROC-AUC on the curated crops', () => {
    const r = load();
    const p = r.suitability.curated.pooled;
    expect(p['astrovivu-v2'].n).toBeGreaterThan(1000);
    expect(r.selectedMethod).toBe(p['astrovivu-v2'].rocAuc >= p.cropsuite.rocAuc ? 'astrovivu-v2' : 'cropsuite');
  });

  it('agrees with the default method of the app', () => {
    expect(DEFAULT_SUITABILITY_METHOD).toBe(load().selectedMethod);
  });
});
