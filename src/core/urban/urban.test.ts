import { describe, expect, it } from 'vitest';
import type { UrbanClimate, UrbanClimateMonth } from '@/contracts';
import { getCrop } from '@/core/crops';
import { jpegSize } from '../../../scripts/crops/crop-images';
import { climateScale, cropImage, ecocropPageUrl, ecocropPhotoUrl, nextSow, recommendUrban, recommendUrbanAhead, sowLevel, sowLevels, yearFrom, type CropImageManifest } from './index';

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
