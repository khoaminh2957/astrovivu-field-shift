import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsvObjects } from './csv';
import { DEFAULT_NATIONAL_FILE, parseNational, readNational, resolveCropCountryRow } from './national';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ATLAS = path.join(ROOT, 'data/crops/atlas');

describe('national prevalence', () => {
  const crops = new Set(['durio-zibethinus', 'oryza-sativa', 'medicago-sativa', 'lycopersicon-esculentum']);
  const countries = new Set(['VNM', 'USA']);

  it('a national row without a source stops the build', () => {
    const missingSource = [
      'crop_id,iso3,area_ha,production_t,year,source,url,accessed,table,note',
      'durio-zibethinus,VNM,178800,1470000,2024,,https://example.gov.vn,2026-11-15,Table 1,note',
    ].join('\n');
    expect(() => parseNational(missingSource, crops, countries)).toThrow(/missing source/i);

    const missingUrl = [
      'crop_id,iso3,area_ha,production_t,year,source,url,accessed,table,note',
      'durio-zibethinus,VNM,178800,1470000,2024,MARD,,2026-11-15,Table 1,note',
    ].join('\n');
    expect(() => parseNational(missingUrl, crops, countries)).toThrow(/missing url/i);

    const missingAccessed = [
      'crop_id,iso3,area_ha,production_t,year,source,url,accessed,table,note',
      'durio-zibethinus,VNM,178800,1470000,2024,MARD,https://example.gov.vn,,Table 1,note',
    ].join('\n');
    expect(() => parseNational(missingAccessed, crops, countries)).toThrow(/missing accessed/i);

    const missingYear = [
      'crop_id,iso3,area_ha,production_t,year,source,url,accessed,table,note',
      'durio-zibethinus,VNM,178800,1470000,,MARD,https://example.gov.vn,2026-11-15,Table 1,note',
    ].join('\n');
    expect(() => parseNational(missingYear, crops, countries)).toThrow(/missing year/i);

    const unknownCrop = [
      'crop_id,iso3,area_ha,production_t,year,source,url,accessed,table,note',
      'not-a-crop,VNM,100,200,2024,MARD,https://example.gov.vn,2026-11-15,Table 1,note',
    ].join('\n');
    expect(() => parseNational(unknownCrop, crops, countries)).toThrow(/crop_id/i);

    const unknownIso = [
      'crop_id,iso3,area_ha,production_t,year,source,url,accessed,table,note',
      'durio-zibethinus,XYZ,100,200,2024,MARD,https://example.gov.vn,2026-11-15,Table 1,note',
    ].join('\n');
    expect(() => parseNational(unknownIso, crops, countries)).toThrow(/iso3/i);

    const missingNoteWhenNoFigure = [
      'crop_id,iso3,area_ha,production_t,year,source,url,accessed,table,note',
      'durio-zibethinus,USA,,,2022,USDA NASS,https://www.nass.usda.gov,2026-11-15,Table 37,',
    ].join('\n');
    expect(() => parseNational(missingNoteWhenNoFigure, crops, countries)).toThrow(/missing note/i);
  });

  it('a group crop without a national row stays unknown', () => {
    const withoutRow = resolveCropCountryRow({
      cropId: 'durio-zibethinus',
      match: 'group',
      items: [603],
      primary: 603,
      iso3: 'VNM',
      countryName: 'Viet Nam',
      totalAreaHa: 13_504_720,
      itemAreas: new Map([[27, 7_089_041]]),
      faostat: null,
      groupItemReported: true,
      national: undefined,
    });
    expect(withoutRow).not.toBeNull();
    expect(withoutRow!.level).toBe('unknown');
    expect(withoutRow!.match).toBe('group');
    expect(withoutRow!.areaHa).toBeNull();
    expect(withoutRow!.inCountryCrops).toBe(false);
    expect(withoutRow!.inPossibleCrops).toBe(true);

    const withNoteOnly = resolveCropCountryRow({
      cropId: 'durio-zibethinus',
      match: 'group',
      items: [603],
      primary: 603,
      iso3: 'USA',
      countryName: 'United States of America',
      totalAreaHa: 98_830_011,
      itemAreas: new Map([[236, 34_330_527]]),
      faostat: null,
      groupItemReported: false,
      national: {
        cropId: 'durio-zibethinus',
        iso3: 'USA',
        areaHa: null,
        productionT: null,
        year: 2022,
        source: 'USDA NASS 2022 Census of Agriculture',
        url: 'https://www.nass.usda.gov',
        accessed: '2026-11-15',
        table: 'Table 37',
        note: 'Not reported separately in Table 37.',
      },
    });
    expect(withNoteOnly).not.toBeNull();
    expect(withNoteOnly!.level).toBe('unknown');
    expect(withNoteOnly!.match).toBe('group');
    expect(withNoteOnly!.row[17]).toBe('Not reported separately in Table 37.');
  });

  it('a national row never overrides an exact row that has an area', () => {
    const resolved = resolveCropCountryRow({
      cropId: 'oryza-sativa',
      match: 'exact',
      items: [27],
      primary: 27,
      iso3: 'VNM',
      countryName: 'Viet Nam',
      totalAreaHa: 13_504_720,
      itemAreas: new Map([
        [27, 7_089_041],
        [56, 875_899],
      ]),
      faostat: {
        codes: [27],
        areaHa: 7_089_041,
        productionT: 43_196_000,
        yieldTHa: 6.093,
        yearFrom: 2022,
        yearTo: 2024,
      },
      groupItemReported: false,
      national: {
        cropId: 'oryza-sativa',
        iso3: 'VNM',
        areaHa: 100,
        productionT: 500,
        year: 2024,
        source: 'National Override Attempt',
        url: 'https://example.gov.vn',
        accessed: '2026-11-15',
        table: 'Table 1',
        note: 'Should be ignored because exact row already has an area',
      },
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.match).toBe('exact');
    expect(resolved!.level).toBe('major');
    expect(resolved!.areaHa).toBe(7_089_041);
    expect(resolved!.row[6]).toBe(7_089_041);
    expect(resolved!.row[14]).toBe('FAOSTAT QCL');
    expect(resolved!.row[17]).toBe('');
  });

  it('covers all 32 group+none curated crops in VNM and USA plus T1 forwarded rows, and gives all 73 curated crops rows in crop_country.csv', () => {
    const nationalMap = readNational(DEFAULT_NATIONAL_FILE);
    const cropsRows = parseCsvObjects(fs.readFileSync(path.join(ATLAS, 'crops.csv'), 'utf8'));
    const curated = cropsRows.filter((r) => r.curated === 'yes');
    expect(curated.length).toBe(73);

    const groupAndNone = curated.filter((r) => r.match === 'group' || r.match === 'none');
    expect(groupAndNone.length).toBe(32);
    for (const c of groupAndNone) {
      expect(nationalMap.has(`${c.crop_id}|VNM`), `missing ${c.crop_id}|VNM in prevalence.csv`).toBe(true);
      expect(nationalMap.has(`${c.crop_id}|USA`), `missing ${c.crop_id}|USA in prevalence.csv`).toBe(true);
    }

    const cropCountry = parseCsvObjects(fs.readFileSync(path.join(ATLAS, 'crop_country.csv'), 'utf8'));
    const byKey = new Map(cropCountry.map((r) => [`${r.crop_id}|${r.iso3}`, r]));
    for (const c of curated) {
      for (const iso3 of ['VNM', 'USA']) {
        const row = byKey.get(`${c.crop_id}|${iso3}`);
        expect(row, `missing ${c.crop_id}|${iso3} in crop_country.csv`).toBeDefined();
        if (row!.level === 'unknown') {
          expect(row!.note.trim().length, `empty note on unknown row ${c.crop_id}|${iso3}`).toBeGreaterThan(0);
        }
      }
    }

    expect(byKey.get('durio-zibethinus|VNM')?.level).toBe('common');
    expect(byKey.get('durio-zibethinus|VNM')?.match).toBe('national');
    expect(byKey.get('musa-acuminata|VNM')?.level).toBe('common');
    expect(byKey.get('mangifera-indica|VNM')?.level).toBe('common');
    expect(byKey.get('ipomoea-aquatica|VNM')?.level).toBe('minor');
    expect(byKey.get('basella-alba|VNM')?.level).toBe('minor');
    expect(byKey.get('ocimum-basilicum|VNM')?.level).toBe('minor');
    expect(byKey.get('medicago-sativa|USA')?.level).toBe('major');
    expect(byKey.get('phaseolus-vulgaris|USA')?.level).toBe('common');
    expect(byKey.get('allium-fistulosum|USA')?.level).toBe('minor');
    expect(byKey.get('sesamum-indicum|USA')?.level).toBe('minor');
  });
});
