import { describe, expect, it } from 'vitest';
import type { UrbanClimate, UrbanClimateMonth } from '@/contracts';
import { getCrop, listCrops } from '@/core/crops';
import { jpegSize } from '../../../scripts/crops/crop-images';
import { BERLIN, HO_CHI_MINH_CITY, PHOENIX } from './__fixtures__/cities';
import { SOW_FIT, climateScale, cropImage, ecocropPageUrl, ecocropPhotoUrl, nextSow, recommendUrban, recommendUrbanAhead, sowLevel, sowLevels, windowFit, yearFrom, type CropImageManifest } from './index';

const month = (m: number, tMean: number, rainMm: number, par: number | null = null): UrbanClimateMonth => ({ month: m, tMean, tMin: tMean - 4, tMax: tMean + 5, rainMm, par, rh: null });

/** A warm, wet, invented climate: enough for the recommender to return picks. Not an observation. */
const TROPICAL: UrbanClimate = {
  location: [106.7, 10.78],
  months: [26, 27, 28, 29, 29, 28, 28, 28, 27, 27, 27, 26].map((t, i) => month(i + 1, t, i > 3 && i < 10 ? 250 : 20, 8 + (i % 3))),
  sourceIds: ['test'],
};

describe('sowing calendar', () => {
  it('finds the next sowing month, wrapping over the new year', () => {
    expect(nextSow([3, 4], 11)).toEqual({ month: 3, wait: 4 });
    expect(nextSow([3, 11], 11)).toEqual({ month: 11, wait: 0 });
    expect(nextSow([1], 12)).toEqual({ month: 1, wait: 1 });
    expect(nextSow([], 5)).toBeNull();
  });

  it('grades a month by its fit and never invents marginal months without fits', () => {
    expect([0.6, 0.59, 0.3, 0.29].map(sowLevel)).toEqual(['good', 'marginal', 'marginal', 'no']);
    expect(sowLevels([2], undefined).filter((l) => l !== 'no')).toEqual(['good']);
    const fit = [0.1, 0.9, 0.45, 0, 0, 0, 0, 0, 0, 0, 0, 0.31];
    const levels = sowLevels([2], fit);
    expect(levels[1]).toBe('good');
    expect(levels[2]).toBe('marginal');
    expect(levels[11]).toBe('marginal');
    expect(levels[0]).toBe('no');
  });

  it('orders a year from the current month', () => {
    const cal = Array.from({ length: 12 }, (_, i) => ({ month: i + 1 }));
    expect(yearFrom(cal, 11).map((c) => c.month)).toEqual([11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(yearFrom(cal, 1).map((c) => c.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('climate strip scale', () => {
  it('rounds the axes outwards and keeps missing light missing', () => {
    expect(climateScale([])).toBeNull();
    const s = climateScale([month(1, 3, 12), month(7, 24, 181)])!;
    expect(s).toEqual({ tLo: -5, tHi: 30, rainMax: 200, parMax: null });
    expect(climateScale([month(1, 20, 0, 6.2), month(2, 20, 0, null)])!).toMatchObject({ rainMax: 50, parMax: 7 });
  });
});

describe('recommendUrban', () => {
  it('returns the per-month sowing fit that the sowing months are cut from', () => {
    const recs = recommendUrban({ location: TROPICAL.location, light: 'full', space: 'rooftop' }, TROPICAL, ['vegetables'], 11);
    expect(recs.length).toBeGreaterThan(2);
    for (const r of recs) {
      expect(r.care.sowFit).toHaveLength(12);
      expect(r.care.sowFit!.every((f) => f >= 0 && f <= 1)).toBe(true);
      // Compared through the levels: the stored fits are rounded to two decimals.
      expect(sowLevels(r.care.sowMonths, r.care.sowFit).map((l, i) => (l === 'good' ? i + 1 : 0)).filter(Boolean)).toEqual(r.care.sowMonths);
      expect(getCrop(r.cropId)).toBeDefined();
    }
  });
});

/** A cold-winter, invented climate (not an observation): nothing can be sown in November. */
const TEMPERATE: UrbanClimate = {
  location: [13.4, 52.5],
  months: [1, 2, 5, 10, 15, 18, 20, 20, 15, 10, 5, 2].map((t, i) => month(i + 1, t, 50, 1 + (i % 6))),
  sourceIds: ['test'],
};

describe('recommendUrbanAhead', () => {
  const site = { location: TEMPERATE.location, light: 'full', space: 'rooftop' } as const;

  it('finds the month sowing opens when this month has no picks', () => {
    expect(recommendUrban(site, TEMPERATE, ['vegetables'], 11)).toHaveLength(0);
    const ahead = recommendUrbanAhead(site, TEMPERATE, ['vegetables'], 11)!;
    expect(ahead).not.toBeNull();
    expect(ahead.month).toBeLessThan(11);
    expect(ahead.picks.length).toBeGreaterThan(0);
    expect(ahead.picks.some((p) => p.care.sowMonths.includes(ahead.month))).toBe(true);
    // Same engine, same month: only the wording of the first reason differs.
    const direct = recommendUrban(site, TEMPERATE, ['vegetables'], ahead.month);
    expect(ahead.picks.map((p) => [p.cropId, p.score])).toEqual(direct.map((p) => [p.cropId, p.score]));
    expect(ahead.picks.every((p) => !p.why[0].en.includes('now'))).toBe(true);
  });

  it('returns null when no month of the year has a pick', () => {
    const frozen: UrbanClimate = { ...TEMPERATE, months: TEMPERATE.months.map((m) => ({ ...m, tMean: -20, tMin: -25, tMax: -15 })) };
    expect(recommendUrbanAhead(site, frozen, ['vegetables'], 11)).toBeNull();
  });
});

describe('climateFit (D4)', () => {
  it('verifies three reference cities (Ho Chi Minh City, Berlin, Phoenix) from real ERA5 + NASA POWER fixtures', () => {
    const urbanCrops = listCrops().filter((c) => c.urban?.suitable);
    expect(urbanCrops).toHaveLength(32);

    // 1. Berlin (52.52° N): no crop with killTempC >= 0 can be sown in winter months (Dec=12, Jan=1, Feb=2)
    // because Berlin winter tMin (-0.8, -0.4, 0.8 °C) is well inside the 4 °C frost margin.
    const frostTender = urbanCrops.filter((c) => (c.req.killTempC ?? -99) >= 0);
    expect(frostTender.length).toBeGreaterThan(10);
    for (const c of frostTender) {
      for (const winterMonth of [12, 1, 2]) {
        const d = windowFit(c, BERLIN, winterMonth);
        expect(d.cold).toBeLessThan(SOW_FIT);
        expect(d.fit).toBeLessThan(SOW_FIT);
      }
    }

    // 2. Ho Chi Minh City (10.78° N): water spinach (ipomoea-aquatica, tempC 10/15/35/40) is suitable in November
    // (tMean 26.8 °C, tMin 24.0 °C, tMax 30.7 °C), whereas cool-season head lettuce (lactuca-sativa-var-capitata)
    // is heat-limited in March/April (tMax 34.6 / 34.3 °C).
    const waterSpinach = getCrop('ipomoea-aquatica')!;
    const hcmcNov = windowFit(waterSpinach, HO_CHI_MINH_CITY, 11);
    expect(hcmcNov.mean).toBe(1);
    expect(hcmcNov.cold).toBe(1);
    expect(hcmcNov.heat).toBe(1);
    expect(hcmcNov.fit).toBeGreaterThanOrEqual(SOW_FIT);

    // 3. Phoenix (33.45° N): head lettuce (lactuca-sativa-var-capitata, tempC 7/15/24/30) is sowable in autumn/winter
    // (November tMean 18.1 °C, tMax 25.3 °C <= 30 °C) but blocked by extreme heat in July (tMax 41.8 °C > 30 °C).
    const lettuce = getCrop('lactuca-sativa-var-capitata')!;
    const phxNov = windowFit(lettuce, PHOENIX, 11);
    expect(phxNov.fit).toBeGreaterThanOrEqual(SOW_FIT);
    const phxJul = windowFit(lettuce, PHOENIX, 7);
    expect(phxJul.heat).toBeLessThan(SOW_FIT);
    expect(phxJul.fit).toBeLessThan(SOW_FIT);
    expect(phxJul.limiting).toBe('heat');
  });

  it('scores photoperiod softly for short-day okra (abelmoschus-esculentus) at 52.5° N June vs 10.78° N December', () => {
    const okra = getCrop('abelmoschus-esculentus')!;
    expect(okra.req.photoperiod).toEqual(['short']);

    const berlinJune = windowFit(okra, BERLIN, 6);
    expect(berlinJune.photo).toBeLessThan(1);
    expect(berlinJune.photo).toBeCloseTo(0.7, 2);

    const hcmcDec = windowFit(okra, HO_CHI_MINH_CITY, 12);
    expect(hcmcDec.photo).toBe(1);
  });

  it('reduces fit when tMax exceeds tempC[3] while tMean is held constant', () => {
    const lettuce = getCrop('lactuca-sativa-var-capitata')!;
    const absMax = lettuce.req.tempC[3]; // 30 °C
    const baseClim: UrbanClimate = {
      location: [106.7, 10.78],
      months: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        tMean: 20,
        tMin: 15,
        tMax: absMax - 2,
        rainMm: 50,
        par: 8,
        rh: 60,
      })),
      sourceIds: ['test'],
    };
    const hotClim: UrbanClimate = {
      ...baseClim,
      months: baseClim.months.map((m) => ({ ...m, tMax: absMax + 4 })),
    };

    const fitMild = windowFit(lettuce, baseClim, 1);
    const fitHot = windowFit(lettuce, hotClim, 1);
    expect(fitMild.heat).toBe(1);
    expect(fitHot.heat).toBeLessThan(fitMild.heat);
    expect(fitHot.fit).toBeLessThan(fitMild.fit);
    expect(fitHot.limiting).toBe('heat');
  });
});

describe('EcoCrop photographs', () => {
  it('builds the page and photo addresses from the EcoCrop code', () => {
    expect(ecocropPageUrl(289)).toBe('https://ecocrop.apps.fao.org/ecocrop/srv/en/cropView?id=289');
    expect(ecocropPhotoUrl(289)).toBe('https://ecocrop.apps.fao.org/ecocrop/ec_images/289.jpg');
  });

  it('reads a crop from the manifest only when it is listed', () => {
    const manifest: CropImageManifest = { generatedAt: '2026-11-14', source: '', terms: '', images: { '289': { w: 138, h: 200 }, '504': true } };
    expect(cropImage(manifest, 289)).toEqual({ w: 138, h: 200 });
    expect(cropImage(manifest, 504)).toBe(true);
    expect(cropImage(manifest, 1264)).toBeNull();
    expect(cropImage(manifest, undefined)).toBeNull();
    expect(cropImage(null, 289)).toBeNull();
  });

  it('reads width and height from a JPEG frame header', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0)];
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x00, 0x8a, 0x03, ...new Array<number>(9).fill(0)];
    expect(jpegSize(Uint8Array.from([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]))).toEqual({ w: 138, h: 200 });
    expect(jpegSize(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]))).toBeNull();
    expect(jpegSize(Uint8Array.from([0xff, 0xd8, ...app0, 0xff, 0xd9]))).toBeNull();
  });
});
