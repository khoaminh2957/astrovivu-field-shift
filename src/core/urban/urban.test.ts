import { describe, expect, it } from 'vitest';
import type { UrbanClimate, UrbanClimateMonth } from '@/contracts';
import { getCrop, listUrbanCrops } from '@/core/crops';
import { jpegSize } from '../../../scripts/crops/crop-images';
import {
  FAMILIARITY_FACTOR,
  climateScale,
  cropImage,
  ecocropPageUrl,
  ecocropPhotoUrl,
  familiarityFactor,
  nextSow,
  recommendUrban,
  recommendUrbanAhead,
  selectFamiliarity,
  sowLevel,
  sowLevels,
  yearFrom,
  type CropImageManifest,
  type UrbanFamiliarity,
} from './index';

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

describe('local familiarity (D3)', () => {
  const site = {
    location: TROPICAL.location,
    light: 'full',
    space: 'rooftop',
    place: { label: 'Ho Chi Minh City', countryCode: 'VN', admin1: 'Ho Chi Minh City' },
  } as const;

  it('keeps order and scores identical when familiarity is omitted', () => {
    const without = recommendUrban(site, TROPICAL, ['vegetables', 'herbs'], 11);
    const withNull = recommendUrban(site, TROPICAL, ['vegetables', 'herbs'], 11, () => null);
    expect(withNull.map((r) => [r.cropId, r.score])).toEqual(without.map((r) => [r.cropId, r.score]));
  });

  it('gives unknown, absent and shared=true crops the exact same score as missing data', () => {
    expect(familiarityFactor(null)).toBe(1);
    expect(familiarityFactor(undefined)).toBe(1);
    expect(familiarityFactor({ level: 'unknown', scope: 'country', shared: false, source: 'GSO 2024' })).toBe(1);
    expect(familiarityFactor({ level: 'absent', scope: 'country', shared: false, source: 'FAOSTAT QCL 2022–2024' })).toBe(1);
    expect(familiarityFactor({ level: 'major', scope: 'country', shared: true, source: 'FAOSTAT item 358' })).toBe(1);
    expect(familiarityFactor({ level: 'common', scope: 'country', shared: false, source: 'GSO 2024' })).toBe(FAMILIARITY_FACTOR.common);

    const base = recommendUrban(site, TROPICAL, [], 11);
    const neutral = recommendUrban(site, TROPICAL, [], 11, (id) => {
      if (id === 'ipomoea-aquatica') return { level: 'unknown', scope: 'country', shared: false, source: 'GSO 2024' };
      if (id === 'basella-alba') return { level: 'absent', scope: 'country', shared: false, source: 'FAOSTAT QCL 2022–2024' };
      if (id === 'brassica-oleracea-var-acephala') return { level: 'major', scope: 'country', shared: true, source: 'FAOSTAT item 358' };
      return null;
    });
    expect(neutral.map((r) => [r.cropId, r.score, r.why.length])).toEqual(base.map((r) => [r.cropId, r.score, r.why.length]));
  });

  it('ranks ipomoea-aquatica, basella-alba and ocimum-basilicum above brassica-oleracea-var-acephala in Ho Chi Minh City and adds bilingual why lines with country and source', () => {
    const vnFamiliarity = (cropId: string): UrbanFamiliarity | null => {
      if (cropId === 'ipomoea-aquatica' || cropId === 'basella-alba' || cropId === 'ocimum-basilicum') {
        return {
          level: 'common',
          scope: 'country',
          shared: false,
          source: 'FAVRI / GSO Niên giám Thống kê 2024 (CC BY 4.0)',
        };
      }
      if (cropId === 'brassica-oleracea-var-acephala') {
        // FAOSTAT item 358 "Cabbages" is shared by 6 crops -> shared = true -> neutral
        return {
          level: 'minor',
          scope: 'country',
          shared: true,
          source: 'FAOSTAT QCL 2022–2024 (item 358 shared by 6 crops)',
        };
      }
      return { level: 'unknown', scope: 'country', shared: false, source: 'data/crops/national/prevalence.csv' };
    };

    const picks = recommendUrban(site, TROPICAL, [], 11, vnFamiliarity);
    const ids = picks.map((p) => p.cropId);
    expect(ids.slice(0, 3)).toEqual(['ipomoea-aquatica', 'basella-alba', 'ocimum-basilicum']);
    expect(ids.indexOf('brassica-oleracea-var-acephala')).toBe(-1);

    for (const id of ['ipomoea-aquatica', 'basella-alba', 'ocimum-basilicum']) {
      const rec = picks.find((p) => p.cropId === id)!;
      expect(rec.score).toBeGreaterThan(80);
      const famWhy = rec.why.find((w) => w.en.includes('Vietnam') && w.vi.includes('Việt Nam'));
      expect(famWhy).toBeDefined();
      expect(famWhy!.en).toContain('FAVRI / GSO Niên giám Thống kê 2024');
      expect(famWhy!.vi).toContain('Trồng phổ biến ở Việt Nam');
      expect(famWhy!.vi).toContain('FAVRI / GSO Niên giám Thống kê 2024');
    }

    // Even in a milder tropical highland climate (21 °C) where kale (brassica-oleracea-var-acephala) can be sown year-round,
    // the 3 familiar Vietnamese crops outrank kale because item 358 is shared=true.
    const mild: UrbanClimate = {
      location: TROPICAL.location,
      months: Array.from({ length: 12 }, (_, i) => month(i + 1, 24, 100, 8)),
      sourceIds: ['test'],
    };
    const mildPicks = recommendUrban(site, mild, [], 11, vnFamiliarity);
    const mildIds = mildPicks.map((p) => p.cropId);
    for (const vnCrop of ['ipomoea-aquatica', 'basella-alba', 'ocimum-basilicum']) {
      expect(mildIds.indexOf(vnCrop)).toBeGreaterThanOrEqual(0);
      const kaleIdx = mildIds.indexOf('brassica-oleracea-var-acephala');
      if (kaleIdx !== -1) {
        expect(mildIds.indexOf(vnCrop)).toBeLessThan(kaleIdx);
      }
    }
    expect(listUrbanCrops().some((c) => c.id === 'brassica-oleracea-var-acephala')).toBe(true);
  });

  it('uses region level only when MapSPAM class is individual and region name matches exactly', () => {
    const country: UrbanFamiliarity = {
      level: 'minor',
      scope: 'country',
      shared: false,
      source: 'FAOSTAT QCL 2022–2024',
    };
    expect(
      selectFamiliarity(
        country,
        { admin1Name: 'Ho Chi Minh City', spamGroup: 'individual', level: 'common', source: 'MapSPAM 2020 V2r2' },
        'Ho Chi Minh City',
      ),
    ).toEqual({
      level: 'common',
      scope: 'region',
      shared: false,
      source: 'MapSPAM 2020 V2r2',
    });
    // Group class ('vege') falls back to country level
    expect(
      selectFamiliarity(
        country,
        { admin1Name: 'Ho Chi Minh City', spamGroup: 'group', level: 'major', source: 'MapSPAM 2020 V2r2' },
        'Ho Chi Minh City',
      ),
    ).toBe(country);
    // Mismatched region name falls back to country level
    expect(
      selectFamiliarity(
        country,
        { admin1Name: 'Dak Lak', spamGroup: 'individual', level: 'major', source: 'MapSPAM 2020 V2r2' },
        'Ho Chi Minh City',
      ),
    ).toBe(country);
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
