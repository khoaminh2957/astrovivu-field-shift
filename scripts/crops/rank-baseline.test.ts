import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CropRanking } from '@/core/scoring';
import { BASELINE_FILE, FIELDS, TOP, fieldBaseline, markdown, prevalence, type Atlas, type FieldBaseline } from './rank-baseline';

const atlas: Atlas = {
  match: new Map([
    ['oryza-sativa', 'exact'],
    ['cicer-arietinum', 'exact'],
    ['coriandrum-sativum', 'group'],
    ['medicago-sativa', 'none'],
  ]),
  country: new Map([
    ['oryza-sativa|VNM', { level: 'major', sharePct: 52.5 }],
    ['cicer-arietinum|VNM', { level: 'absent', sharePct: null }],
    ['coriandrum-sativum|VNM', { level: 'unknown', sharePct: null }],
  ]),
};

const ranked = (cropId: string, compatibility: number, reliability: number | null = 1): CropRanking => ({
  cropId,
  compatibility,
  reliability,
  bestSowingMonth: 1,
  limiting: compatibility < 1 ? 'ph' : null,
  rankScore: compatibility * (0.5 + 0.5 * (reliability ?? 1)),
});

describe('prevalence of a ranked crop', () => {
  it('is the atlas level of the crop in the country', () => {
    expect(prevalence(atlas, 'oryza-sativa', 'VNM')).toEqual({ prevalence: 'major', sharePct: 52.5 });
    expect(prevalence(atlas, 'cicer-arietinum', 'VNM')).toEqual({ prevalence: 'absent', sharePct: null });
    expect(prevalence(atlas, 'coriandrum-sativum', 'VNM')).toEqual({ prevalence: 'unknown', sharePct: null });
  });

  it('says why there is no level instead of guessing one', () => {
    // No FAOSTAT item names the crop: the atlas cannot say where it is grown.
    expect(prevalence(atlas, 'medicago-sativa', 'VNM').prevalence).toBe('no-item');
    // The crop is not kept by the atlas, or the country is not in it.
    expect(prevalence(atlas, 'tagetes-patula', 'VNM').prevalence).toBe('not-in-atlas');
    expect(prevalence(atlas, 'oryza-sativa', 'XTA').prevalence).toBe('not-in-atlas');
  });
});

describe('baseline of one field', () => {
  const ranking = [ranked('cicer-arietinum', 1), ranked('coriandrum-sativum', 1), ranked('oryza-sativa', 1), ranked('medicago-sativa', 0.5)];
  const b = fieldBaseline('test-field', 'Test field', 'VNM', 'oryza-sativa', ranking, atlas, 3);

  it('keeps the order of the ranking and cuts it at the top', () => {
    expect(b.top.map((r) => [r.rank, r.cropId, r.compatibility, r.rankScore, r.prevalence])).toEqual([
      [1, 'cicer-arietinum', 100, 100, 'absent'],
      [2, 'coriandrum-sativum', 100, 100, 'unknown'],
      [3, 'oryza-sativa', 100, 100, 'major'],
    ]);
  });

  it('counts ties and where the crop of the field stands', () => {
    expect(b).toMatchObject({ ranked: 4, compatibility100: 3, tiedForFirst: 3, grownCropRank: 3 });
    expect(b.counts).toMatchObject({ major: 1, absent: 1, unknown: 1, 'no-item': 0 });
    expect(fieldBaseline('f', 'F', 'VNM', 'zea-mays', ranking, atlas).grownCropRank).toBeNull();
  });

  it('prints one summary line and one table per field', () => {
    const text = markdown([b]);
    expect(text).toContain('| Test field | VNM | 4 | 3 | 3 |');
    expect(text).toContain('| 1 | Chickpea (`cicer-arietinum`) | 100 | 100 | 100 | Jan | none | exact | absent |  |');
  });
});

describe('the committed baseline', () => {
  const file = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as { today: string; commit: string | null; fields: FieldBaseline[] };

  it('covers the four demo fields with their 15 first crops', () => {
    expect(file.fields.map((f) => f.field)).toEqual([...FIELDS]);
    expect(file.fields.map((f) => f.iso3)).toEqual(['VNM', 'VNM', 'USA', 'USA']);
    for (const f of file.fields) {
      expect(f.top.map((r) => r.rank)).toEqual(Array.from({ length: TOP }, (_, i) => i + 1));
      for (let i = 1; i < f.top.length; i++) expect(f.top[i].rankScore, `${f.field} row ${i + 1}`).toBeLessThanOrEqual(f.top[i - 1].rankScore);
      expect(Object.values(f.counts).reduce((a, n) => a + n, 0)).toBe(TOP);
    }
  });

  it('records when and on which commit it was taken', () => {
    expect(file.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(file.commit).toMatch(/^[0-9a-f]{7,}$/);
  });
});
