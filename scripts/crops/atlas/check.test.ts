import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsvObjects } from './csv';

const CHECK_FILE = 'data/crops/review/atlas-check-vnm-usa.csv';
const VALID_VERDICTS = new Set(['dung', 'sai-muc', 'sai-absent', 'sai-cay', 'chung-hang', 'thieu', 'khong-co-nguon']);

describe('atlas national cross-check table (T1 #8)', () => {
  const rows = parseCsvObjects(readFileSync(CHECK_FILE, 'utf8'));

  it('has the expected 12 columns and covers top 15 items + 29 absent rows + 3 missing curated crops', () => {
    expect(rows.length).toBe(62);
    const cols = Object.keys(rows[0]);
    expect(cols).toEqual([
      'iso3',
      'crop_id',
      'faostat_item_code',
      'atlas_area_ha',
      'atlas_level',
      'national_area_ha',
      'national_year',
      'verdict',
      'source',
      'url',
      'accessed',
      'note',
    ]);
    const absentRows = rows.filter((r) => r.atlas_level === 'absent');
    expect(absentRows.filter((r) => r.iso3 === 'VNM').length).toBe(20);
    expect(absentRows.filter((r) => r.iso3 === 'USA').length).toBe(9);
  });

  it('assigns a valid verdict and complete provenance to every row with a national figure', () => {
    for (const r of rows) {
      expect(['VNM', 'USA']).toContain(r.iso3);
      expect(VALID_VERDICTS.has(r.verdict), `${r.iso3} ${r.crop_id}: invalid verdict ${r.verdict}`).toBe(true);
      expect(r.source.length).toBeGreaterThan(0);
      expect(r.url).toMatch(/^https?:\/\//);
      expect(r.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.national_year.length).toBeGreaterThan(0);
      if (r.national_area_ha !== '') {
        const area = Number(r.national_area_ha);
        expect(Number.isFinite(area) && area > 0, `${r.iso3} ${r.crop_id}`).toBe(true);
      }
    }
  });

  it('matches the verdict counts documented in docs/CROP_DATA.md section 9.1', () => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    expect(counts).toEqual({
      dung: 18,
      'sai-absent': 2,
      'sai-cay': 2,
      'chung-hang': 4,
      thieu: 8,
      'khong-co-nguon': 28,
    });
  });

  it('calls the atlas wrong only where a national source gives an area', () => {
    for (const r of rows.filter((x) => x.verdict === 'sai-absent')) expect(Number(r.national_area_ha), `${r.iso3} ${r.crop_id}`).toBeGreaterThan(0);
  });

  it('quotes the regional file as it is in docs/CROP_DATA.md section 9.1', () => {
    const doc = readFileSync('docs/CROP_DATA.md', 'utf8');
    const region = parseCsvObjects(readFileSync('data/crops/atlas/region_crops.csv', 'utf8'));
    const ha = (n: string) => Number(n).toLocaleString('en-US');
    // Can Tho city: every class the paragraph names, with its area and rank.
    const canTho = new Map(region.filter((r) => r.admin1_code === 'VM13').map((r) => [r.spam_crop, r]));
    for (const [code, rank] of [['rice', 1], ['rest', 2], ['vege', 3], ['rcof', 6], ['sugc', 7], ['trof', 8], ['coff', 15]] as const) {
      const row = canTho.get(code)!;
      expect(Number(row.rank_in_region), code).toBe(rank);
      expect(doc, `Can Tho ${code}`).toContain('`' + ha(row.harvested_area_ha) + ' ha`');
    }
    // 44 states of the United States, and none of them is Nevada.
    const states = new Set(region.filter((r) => r.iso3 === 'USA' && r.admin1).map((r) => r.admin1));
    expect(states.size).toBe(44);
    expect(states.has('Nevada')).toBe(false);
    expect(doc).toContain('covers 44 US states');
  });
});
