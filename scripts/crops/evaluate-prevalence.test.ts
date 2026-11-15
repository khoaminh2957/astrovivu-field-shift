import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CropPrevalence } from '@/contracts';
import { byCountry, differences, distribution, labelOf, MIN_PER_CLASS, OUT_FILE, VARIANTS, type Distribution, type SiteResult } from './evaluate-prevalence';

const row = (level: CropPrevalence['level'], match: CropPrevalence['match'] = 'exact'): CropPrevalence => ({ level, match, source: 'FAOSTAT QCL' });

describe('labels from prevalence', () => {
  it('calls a major or common crop grown and an absent crop not grown', () => {
    expect(labelOf(row('major'))).toBe(1);
    expect(labelOf(row('common'))).toBe(1);
    expect(labelOf(row('absent'))).toBe(0);
  });

  it('leaves out what is neither a clear yes nor a clear no', () => {
    expect(labelOf(row('minor'))).toBeNull();
    expect(labelOf(row('present'))).toBeNull();
    // A group record is about the group, and a missing record about nothing.
    expect(labelOf(row('absent', 'group'))).toBeNull();
    expect(labelOf(row('unknown', 'group'))).toBeNull();
    expect(labelOf(undefined)).toBeNull();
  });
});

describe('summary over countries', () => {
  const site = (iso3: string, rainfed: number, noGate = rainfed): SiteResult => ({
    site: `${iso3}-${rainfed}`,
    iso3,
    grown: 10,
    notGrown: 20,
    auc: { current: { rainfed, irrigated: rainfed }, 'no-gate': { rainfed: noGate, irrigated: noGate } },
    gated: { grown: 1, notGrown: 5 },
  });

  it('gives each country the mean of its sites, so that a country with many sites counts once', () => {
    expect(byCountry([site('USA', 0.6), site('USA', 0.8), site('VNM', 0.5)], 'current', 'rainfed')).toEqual([
      { iso3: 'USA', sites: 2, auc: 0.7 },
      { iso3: 'VNM', sites: 1, auc: 0.5 },
    ]);
  });

  it('compares a variant with the score as it is country by country', () => {
    expect(differences([site('USA', 0.6, 0.58), site('USA', 0.8, 0.8), site('VNM', 0.5, 0.52)], 'no-gate', 'rainfed')).toEqual([-0.01, 0.02]);
  });

  it('describes the spread, not only the mean', () => {
    const d = distribution([0.4, 0.6, 0.7, 0.8, 1]);
    expect(d).toMatchObject({ n: 5, mean: 0.7, median: 0.7, q1: 0.6, q3: 0.8, min: 0.4, max: 1, above50: 0.8 });
    expect(d.ci95[0]).toBeLessThan(0.7);
    expect(d.ci95[1]).toBeGreaterThan(0.7);
    // Seeded: the same values give the same interval.
    expect(distribution([0.4, 0.6, 0.7, 0.8, 1]).ci95).toEqual(d.ci95);
  });
});

describe('the committed results', () => {
  const file = JSON.parse(readFileSync(OUT_FILE, 'utf8')) as {
    countries: number;
    sites: number;
    summary: Record<string, { rainfed: Distribution; irrigated: Distribution }>;
    perCountry: { iso3: string; sites: number; grown: number; notGrown: number; rainfed: number; irrigated: number }[];
    perSite: SiteResult[];
    latitudeGate: { reach: { labelledPairs: number; gatedGrown: number; gatedNotGrown: number; grownPairs: number; notGrownPairs: number }; differenceFromCurrent: Record<string, { rainfed: Distribution; irrigated: Distribution }> };
  };

  it('hold one result per country, each from enough grown and not-grown crops', () => {
    expect(file.perCountry).toHaveLength(file.countries);
    expect(file.perSite).toHaveLength(file.sites);
    expect(new Set(file.perCountry.map((c) => c.iso3)).size).toBe(file.countries);
    for (const c of file.perCountry) {
      expect(c.grown, c.iso3).toBeGreaterThanOrEqual(MIN_PER_CLASS);
      expect(c.notGrown, c.iso3).toBeGreaterThanOrEqual(MIN_PER_CLASS);
      for (const auc of [c.rainfed, c.irrigated]) expect(auc >= 0 && auc <= 1, c.iso3).toBe(true);
    }
  });

  it('compare every other latitude gate with the one in use, and count what the gate touches', () => {
    expect(Object.keys(file.latitudeGate.differenceFromCurrent)).toEqual(VARIANTS.filter((v) => v.id !== 'current').map((v) => v.id));
    for (const d of Object.values(file.latitudeGate.differenceFromCurrent)) expect(d.rainfed.n).toBe(file.countries);
    const reach = file.latitudeGate.reach;
    expect(reach.grownPairs + reach.notGrownPairs).toBe(reach.labelledPairs);
    expect(reach.gatedGrown).toBeLessThanOrEqual(reach.grownPairs);
    expect(reach.gatedNotGrown).toBeLessThanOrEqual(reach.notGrownPairs);
  });

  it('summarise exactly those countries', () => {
    const mean = file.perCountry.reduce((a, c) => a + c.rainfed, 0) / file.perCountry.length;
    expect(file.summary.current.rainfed.n).toBe(file.countries);
    expect(file.summary.current.rainfed.mean).toBeCloseTo(mean, 2);
    expect(file.perCountry.some((c) => c.iso3 === 'VNM')).toBe(true);
  });
});
