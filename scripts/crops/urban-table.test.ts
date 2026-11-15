import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UrbanClimate, UrbanClimateMonth } from '../../src/contracts';
import { getCrop, listCrops, listUrbanCrops } from '../../src/core/crops';
import { recommendUrban } from '../../src/core/urban';
import { URBAN_COLUMNS } from './atlas/columns';
import { parseCsvObjects } from './atlas/csv';
import { lightFromSunHours, mergeUrbanTraits, qualifiesForUrbanCatalog, readUrbanTable } from './urban-table';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CROPS_CSV = path.join(ROOT, 'data/crops/atlas/crops.csv');
const URBAN_CSV = path.join(ROOT, 'data/crops/atlas/urban.csv');

const validIds = new Set(parseCsvObjects(readFileSync(CROPS_CSV, 'utf8')).map((r) => r.crop_id));
const rawUrbanCsv = readFileSync(URBAN_CSV, 'utf8');

describe('data/crops/atlas/urban.csv and readUrbanTable (D2 #15)', () => {
  it('matches URBAN_COLUMNS in columns.ts and validates every row against crops.csv with source, url and accessed', () => {
    const header = rawUrbanCsv.split(/\r?\n/)[0]?.split(',') ?? [];
    expect(header).toEqual(URBAN_COLUMNS);

    const parsed = readUrbanTable(rawUrbanCsv, validIds);
    expect(parsed.rowsRead).toBe(454);
    expect(parsed.byCrop.size).toBe(50);

    const rawRows = parseCsvObjects(rawUrbanCsv);
    for (const r of rawRows) {
      expect(validIds.has(r.crop_id)).toBe(true);
      expect(r.source.trim().length).toBeGreaterThan(5);
      expect(r.url).toMatch(/^https?:\/\/\S+$/);
      expect(r.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (r.attribute === 'difficulty') {
        expect(r.note.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('covers all 32 existing curated urban crops with sourced container attributes and no unsourced numbers', () => {
    const parsed = readUrbanTable(rawUrbanCsv, validIds);
    const curatedUrban = listCrops().filter((c) => c.urban?.suitable);
    expect(curatedUrban).toHaveLength(32);

    const noVolumeIds = new Set(['fagopyrum-esculentum', 'arachis-pintoi', 'tagetes-erecta', 'catharanthus-roseus']);
    for (const c of curatedUrban) {
      const entry = parsed.byCrop.get(c.id);
      expect(entry, `missing urban.csv entry for ${c.id}`).toBeDefined();
      expect(entry!.potDepthCm).toBeGreaterThanOrEqual(15);
      expect(entry!.spacingCm).toBeGreaterThanOrEqual(8);
      expect(entry!.sunHoursMin).toBeGreaterThanOrEqual(2);
      expect(entry!.firstHarvestDays).toBeDefined();
      expect(entry!.harvestType).toMatch(/^(cut-and-come-again|once|repeated-fruit)$/);
      expect(typeof entry!.needsTrellis).toBe('boolean');
      expect(entry!.difficulty).toBeGreaterThanOrEqual(1);
      if (noVolumeIds.has(c.id)) {
        expect(entry!.potVolumeL).toBeUndefined();
      } else {
        expect(entry!.potVolumeL).toBeGreaterThan(0);
      }
      expect(c.urban?.potDepthCm).toBe(entry!.potDepthCm);
      expect(c.urban?.sources?.length).toBeGreaterThan(0);
    }
  });

  it('resolves multi-source discrepancies conservatively and records the resolution', () => {
    const parsed = readUrbanTable(rawUrbanCsv, validIds);
    expect(parsed.resolutions.length).toBe(10);

    const tomato = parsed.byCrop.get('lycopersicon-esculentum')!;
    expect(tomato.potDepthCm).toBe(30); // max(25 cm TAMU, 30 cm UC ANR)
    expect(tomato.sunHoursMin).toBe(8); // max(6 h TAMU, 8 h UC ANR)

    const pepper = parsed.byCrop.get('capsicum-annuum')!;
    expect(pepper.potDepthCm).toBe(25); // max(20 cm TAMU, 25 cm UC ANR)
    expect(pepper.potVolumeL).toBe(11.4); // max(7.6 L TAMU, 11.4 L UME)
  });

  it('admits new urban_candidate crops only when sun_hours_min, pot_depth_min and difficulty are all present', () => {
    const parsed = readUrbanTable(rawUrbanCsv, validIds);
    const allUrban = listUrbanCrops();
    expect(allUrban.length).toBe(48); // 32 curated + 16 qualified atlas candidates

    const kale = getCrop('brassica-oleracea-var-acephala');
    expect(kale).toBeDefined();
    expect(kale?.urban?.suitable).toBe(true);
    expect(kale?.urban?.potDepthCm).toBe(20);
    expect(kale?.urban?.spacingCm).toBe(25);
    expect(kale?.urban?.sources?.length).toBeGreaterThan(0);

    // Partial candidates in urban.csv without difficulty do not qualify
    expect(qualifiesForUrbanCatalog(parsed.byCrop.get('foeniculum-vulgare'))).toBe(false);
    expect(qualifiesForUrbanCatalog(parsed.byCrop.get('nasturtium-officinale'))).toBe(false);
    expect(allUrban.some((c) => c.id === 'foeniculum-vulgare')).toBe(false);
    expect(allUrban.some((c) => c.id === 'nasturtium-officinale')).toBe(false);

    for (const c of allUrban) {
      expect(c.urban?.potDepthCm).toBeDefined();
      expect(c.urban?.sources?.length).toBeGreaterThan(0);
    }
  });

  it('reports 1-based CSV line numbers when validating invalid rows', () => {
    const hdr = 'crop_id,attribute,value,unit,source,url,accessed,note\n';
    expect(() =>
      readUrbanTable(`${hdr}not-a-crop,pot_depth_min,20,cm,Src,https://example.org,2026-11-15,\n`, validIds),
    ).toThrow(/line 2.*unknown crop_id "not-a-crop"/);

    expect(() =>
      readUrbanTable(`${hdr}lycopersicon-esculentum,bad_attr,20,cm,Src,https://example.org,2026-11-15,\n`, validIds),
    ).toThrow(/line 2.*invalid attribute "bad_attr"/);

    expect(() =>
      readUrbanTable(`${hdr}lycopersicon-esculentum,pot_depth_min,5,cm,Src,https://example.org,2026-11-15,\n`, validIds),
    ).toThrow(/line 2.*outside valid range/);

    expect(() =>
      readUrbanTable(`${hdr}lycopersicon-esculentum,pot_depth_min,20,in,Src,https://example.org,2026-11-15,\n`, validIds),
    ).toThrow(/line 2.*unit "in" does not match expected "cm"/);

    expect(() =>
      readUrbanTable(`${hdr}lycopersicon-esculentum,pot_depth_min,20,cm,,https://example.org,2026-11-15,\n`, validIds),
    ).toThrow(/line 2.*missing source/);

    expect(() =>
      readUrbanTable(`${hdr}lycopersicon-esculentum,difficulty,1,,Src,https://example.org,2026-11-15,\n`, validIds),
    ).toThrow(/line 2.*note is required/);
  });

  it('maps sun_hours_min to light classes and logs overrides in mergeUrbanTraits', () => {
    expect(lightFromSunHours(6)).toBe('full');
    expect(lightFromSunHours(4)).toBe('partial');
    expect(lightFromSunHours(2)).toBe('shade');

    const baseCrop = getCrop('lycopersicon-esculentum')!;
    const merged = mergeUrbanTraits(
      baseCrop,
      { suitable: true, light: 'partial', container: true, difficulty: 1, tags: ['vegetables'] },
      {
        cropId: 'lycopersicon-esculentum',
        potDepthCm: 30,
        sunHoursMin: 8,
        difficulty: 2,
        sources: ['UC ANR'],
        notes: [],
      },
    );
    expect(merged.urban?.light).toBe('full');
    expect(merged.urban?.difficulty).toBe(2);
    expect(merged.notes.some((n) => n.includes('urban.light overridden by urban.csv: partial -> full'))).toBe(true);
    expect(merged.notes.some((n) => n.includes('urban.difficulty overridden by urban.csv: 1 -> 2'))).toBe(true);
  });

  it('surfaces crop-specific potDepthCm in recommendUrban care.tips', () => {
    const m = (idx: number, tMean: number): UrbanClimateMonth => ({
      month: idx,
      tMean,
      tMin: tMean - 4,
      tMax: tMean + 4,
      rainMm: 100,
      par: 9,
      rh: 75,
    });
    const climate: UrbanClimate = {
      location: [106.7, 10.78],
      months: Array.from({ length: 12 }, (_, i) => m(i + 1, 26)),
      sourceIds: ['test'],
    };
    const recs = recommendUrban({ location: climate.location, light: 'full', space: 'balcony' }, climate, ['vegetables'], 1);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      const crop = getCrop(r.cropId)!;
      const depth = crop.urban?.potDepthCm;
      expect(depth).toBeDefined();
      const tipTextEn = r.care.tips.map((t) => t.en).join(' ');
      const tipTextVi = r.care.tips.map((t) => t.vi).join(' ');
      expect(tipTextEn).toContain(`${depth} cm deep`);
      expect(tipTextVi).toContain(`${depth} cm`);
    }
  });
});
