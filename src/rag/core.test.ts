import { describe, expect, it } from 'vitest';
import { detectCrops, type AliasTable } from './aliases';
import { parseFact, parseMonthly } from './fieldContext';
import { detectTerms, parseMonths, routeIntent } from './intent';
import { assess } from './suitability';
import { fold, sentences, slugify, terms } from './text';
import type { CropFacts } from './types';

describe('text', () => {
  it('folds Vietnamese diacritics and đ', () => {
    expect(fold('Đất chua của Đắk Lắk')).toBe('dat chua cua dak lak');
    expect(slugify('Vicia villosa ssp. villosa')).toBe('vicia-villosa-ssp-villosa');
  });
  it('keeps decimals inside one sentence', () => {
    expect(sentences('In acid soils (below about 5.5) aluminium is toxic. Lime helps.')).toEqual(['In acid soils (below about 5.5) aluminium is toxic.', 'Lime helps.']);
    expect(sentences('Grows in e.g. Brazil. Next.')).toHaveLength(2);
  });
  it('drops stopwords in both languages but keeps "chua" (acid)', () => {
    expect(terms('Đất của tôi có quá chua không?')).toEqual(['dat', 'chua']);
  });
});

const TABLE: AliasTable = {
  map: { 'dau nanh': ['glycine-max'], dieu: ['anacardium-occidentale'], lua: ['oryza-sativa'], soybean: ['glycine-max'], lac: ['arachis-hypogaea'] },
  exact: { dieu: ['điều'], lua: ['lúa'], lac: ['lạc'] },
};

describe('crop detection', () => {
  it('matches with and without diacritics', () => {
    expect(detectCrops('Điều kiện cho đậu nành', TABLE).map((m) => m.cropIds[0])).toEqual(['glycine-max']);
    expect(detectCrops('dau nanh can gi', TABLE)[0].cropIds).toEqual(['glycine-max']);
  });
  it('does not read "lựa chọn" as rice or "điều kiện" as cashew', () => {
    expect(detectCrops('Lựa chọn cây cho điều kiện khô', TABLE)).toEqual([]);
    expect(detectCrops('Điều kiện trồng điều', TABLE).map((m) => m.cropIds[0])).toEqual(['anacardium-occidentale']);
  });
  it('requires the exact spelling for short names when the query has diacritics', () => {
    expect(detectCrops('lạc cần gì', TABLE)).toHaveLength(1);
    expect(detectCrops('lác đác vài cây', TABLE)).toHaveLength(0);
  });
});

describe('intent routing', () => {
  const r = (q: string, cropCount: number, hasContext = false) => routeIntent(q, { cropCount, hasContext, termHit: detectTerms(q).length > 0 }).intent;
  it('routes the main question types', () => {
    expect(r('What are the ideal conditions for soybean?', 1)).toBe('ideal');
    expect(r('Is my soil too acid for soybean?', 1, true)).toBe('field');
    expect(r('Why did the score drop in March?', 0, true)).toBe('score-change');
    expect(r('What is NDVI?', 0)).toBe('term');
    expect(r('So sánh ngô và cao lương', 2)).toBe('compare');
    expect(r('Nên luân canh gì sau ngô?', 1)).toBe('rotation');
    expect(r('Khi nào thu hoạch đậu phộng?', 1)).toBe('care');
    expect(r('What is the bitcoin price?', 0)).toBe('off-topic');
  });
  it('parses months in both languages', () => {
    expect(parseMonths('why did it drop in March')).toEqual([3]);
    expect(parseMonths('vào tháng 3')).toEqual([3]);
    expect(parseMonths('tháng mười một')).toEqual([11]);
  });
});

const SOY: CropFacts = {
  id: 'glycine-max',
  sci: 'Glycine max',
  ecocropId: 1150,
  en: 'Soybean',
  names: [],
  curated: true,
  ph: [4.5, 5.5, 6.5, 8.4],
  temp: [10, 20, 33, 38],
  rain: [450, 600, 1500, 1800],
  texture: { opt: 'medium, organic', abs: 'heavy, medium, light' },
};

describe('suitability', () => {
  const ctx = (facts: Record<string, string>) => ({ parcelName: 'p', location: [0, 0] as [number, number], areaHa: 1, cropId: null, date: '2026-11-14', facts });
  it('compares pH deterministically against the EcoCrop window', () => {
    expect(assess(SOY, ctx({ ph: '5.6 (SoilGrids, 250 m pixel)' })).checks[0].status).toBe('optimal');
    expect(assess(SOY, ctx({ ph: '5.0 (measured by the farmer)' })).checks[0].status).toBe('tolerated-low');
    expect(assess(SOY, ctx({ ph: '4.2 (SoilGrids)' })).checks[0].status).toBe('outside-low');
  });
  it('lists what is missing instead of guessing', () => {
    const a = assess(SOY, ctx({}));
    expect(a.checks).toEqual([]);
    expect(a.missing).toEqual(expect.arrayContaining(['ph', 'temp', 'rain', 'texture']));
  });
  it('finds the months inside the temperature optimum', () => {
    const a = assess(SOY, ctx({ climate_t_mean: '18 °C (ERA5)', climate_monthly_t: 'Jan 12, Feb 13, Mar 16, Apr 19, May 21, Jun 24, Jul 25, Aug 24, Sep 21, Oct 18, Nov 15, Dec 13 °C' }));
    const t = a.checks.find((c) => c.key === 'temp')!;
    expect(t.status).toBe('tolerated-low');
    expect(t.goodMonths).toEqual([5, 6, 7, 8, 9]);
  });
  it('reads leading numbers back from fact strings', () => {
    expect(parseFact('0.21 m³/m³ (SMAP L4)')).toBe(0.21);
    expect(parseFact('clay loam (SoilGrids)')).toBeNull();
    expect(parseMonthly('Jan 8, Feb 5, Dec 35 mm')?.slice(0, 2)).toEqual([8, 5]);
  });
});
