import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { listCrops, loadFullCatalog } from '@/core/crops';
import { prevalenceStatus, rankCropLists } from '@/core/scoring';
import { countryCropsFromAtlas } from './country-crops';
import { BASELINE_FILE, FIELDS, inputFor, TOP } from './rank-baseline';
import { PREVALENCE_FILE, type FieldRanking } from './rank-prevalence';

describe('the crop table of a country, from the atlas', () => {
  const vnm = countryCropsFromAtlas('VNM');

  it('carries level, match and share of the reported crops', () => {
    expect(vnm.iso3).toBe('VNM');
    expect(vnm.prevalence['oryza-sativa']).toMatchObject({ level: 'major', match: 'exact', itemReported: true, source: 'FAOSTAT QCL' });
    expect(vnm.prevalence['oryza-sativa'].sharePct).toBeGreaterThan(50);
    expect(vnm.prevalence['oryza-sativa'].years?.[1]).toBeGreaterThanOrEqual(2022);
  });

  it('leaves quantities out where the atlas has none', () => {
    expect(vnm.prevalence['durio-zibethinus']).toMatchObject({ level: 'unknown', match: 'group' });
    expect(vnm.prevalence['durio-zibethinus'].sharePct).toBeUndefined();
    // No FAOSTAT item names the crop: the atlas has no row, so the table has no record.
    expect(vnm.prevalence['basella-alba']).toBeUndefined();
    expect(prevalenceStatus(vnm.prevalence['basella-alba'])).toBe('unknown');
  });

  it('refuses a code that is not an atlas country', () => {
    expect(() => countryCropsFromAtlas('XTA')).toThrow(/not a country of the crop atlas/);
  });
});

describe('the ranking with the atlas table of the country', () => {
  beforeAll(async () => {
    await loadFullCatalog(async () => JSON.parse(readFileSync('public/data/crops/ecocrop.json', 'utf8')));
  });

  it('keeps durian in the main list in Đắk Lắk: a crop of a group item is unknown, not absent', () => {
    const lists = rankCropLists({ ...inputFor('daklak-coffee'), country: countryCropsFromAtlas('VNM') });
    const durian = lists.main.find((r) => r.cropId === 'durio-zibethinus');
    expect(durian?.prevalence?.status).toBe('unknown');
    expect(durian?.compatibility).toBeGreaterThan(0.6);
  });

  it('does not put aibika first in Iowa: a crop the atlas does not keep has no figure and no advantage', () => {
    const cropIds = [...listCrops().map((c) => c.id), 'abelmoschus-manihot'];
    const lists = rankCropLists({ ...inputFor('iowa-corn-soy'), country: countryCropsFromAtlas('USA') }, { cropIds });
    const aibika = lists.main.findIndex((r) => r.cropId === 'abelmoschus-manihot');
    expect(aibika).toBeGreaterThan(0);
    expect(lists.main[aibika].prevalence?.status).toBe('unknown');
    expect(lists.main[0].prevalence?.status).toBe('grown');
  });
});

describe('the committed rankings', () => {
  const now = (JSON.parse(readFileSync(PREVALENCE_FILE, 'utf8')) as { fields: FieldRanking[] }).fields;
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as { commit: string };

  it('hold the four demo fields, with no unreported crop in a main list', () => {
    expect(now.map((f) => f.field)).toEqual([...FIELDS]);
    for (const f of now) {
      expect(f.main.length).toBe(TOP);
      expect(f.main.some((r) => r.status === 'absent'), f.field).toBe(false);
      for (const r of f.trial) {
        expect(r.status).toBe('absent');
        expect(r.compatibility).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('put rice first on the Mekong Delta paddy field, where the baseline had it seventh', () => {
    const paddy = now.find((f) => f.field === 'cantho-rice')!;
    expect(paddy.main[0].cropId).toBe('oryza-sativa');
    expect(paddy.grownCropBaselineRank).toBe(7);
    expect(paddy.grownCropRank).toBe(1);
  });

  it('leave the baseline as it was taken', () => {
    expect(baseline.commit).toBe('c11874c');
  });
});
