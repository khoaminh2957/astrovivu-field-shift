import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsvObjects } from './csv';
import { DEFAULT_NATIONAL_FILE, NATIONAL_SOURCES, nationalSourcesUsed, parseNational, readNational, resolveCropCountryRow, type CropCountryInput, type NationalRow } from './national';

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

    // crop_country.csv keeps only the name of the source of a national row: a row without one says nothing.
    const missingSourceWhenNoFigure = [
      'crop_id,iso3,area_ha,production_t,year,source,url,accessed,table,note',
      'durio-zibethinus,USA,,,2022,,https://www.nass.usda.gov,2026-11-15,Table 37,Not reported separately.',
    ].join('\n');
    expect(() => parseNational(missingSourceWhenNoFigure, crops, countries)).toThrow(/missing source/i);
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
    // The row is the FAOSTAT group row, cell for cell: the note stays in prevalence.csv.
    expect(withNoteOnly!.row).toEqual(['durio-zibethinus', 'USA', 'United States of America', '603', 'group', 'no', null, null, null, null, null, null, null, 'unknown', 'FAOSTAT QCL']);
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
    expect(resolved!.row).toHaveLength(15);
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
          // The reason is not a column of crop_country.csv: it is the note of the row in prevalence.csv.
          expect(nationalMap.get(`${c.crop_id}|${iso3}`)?.note.trim().length ?? 0, `no note for unknown row ${c.crop_id}|${iso3}`).toBeGreaterThan(0);
        }
      }
    }

    expect(byKey.get('durio-zibethinus|VNM')?.level).toBe('common');
    expect(byKey.get('durio-zibethinus|VNM')?.match).toBe('national');
    expect(byKey.get('musa-acuminata|VNM')?.level).toBe('common');
    expect(byKey.get('mangifera-indica|VNM')?.level).toBe('common');
    expect(byKey.get('medicago-sativa|USA')?.level).toBe('major');
    expect(byKey.get('allium-fistulosum|USA')?.level).toBe('minor');
    expect(byKey.get('sesamum-indicum|USA')?.level).toBe('minor');
  });

  it('gives no level to a crop whose source has a local figure or the figure of a group only', () => {
    const cropCountry = parseCsvObjects(fs.readFileSync(path.join(ATLAS, 'crop_country.csv'), 'utf8'));
    const byKey = new Map(cropCountry.map((r) => [`${r.crop_id}|${r.iso3}`, r]));
    const nationalMap = readNational(DEFAULT_NATIONAL_FILE);
    // One city, one demonstration plot, one commune: not the area of Viet Nam.
    // All dry edible beans, pumpkins and squash of every species, all Chinese cabbages, all vetches: not the species.
    const noNationalFigure = [
      'ipomoea-aquatica|VNM',
      'ocimum-basilicum|VNM',
      'basella-alba|VNM',
      'phaseolus-vulgaris|USA',
      'cucurbita-moschata|USA',
      'brassica-rapa-pak-choi|USA',
      'vicia-villosa-ssp-villosa|USA',
    ];
    for (const key of noNationalFigure) {
      const row = byKey.get(key);
      expect(row, key).toBeDefined();
      expect(row!.level, key).toBe('unknown');
      expect([row!.area_ha, row!.production_t, row!.share_of_country_harvested_area_pct, row!.rank_in_country], key).toEqual(['', '', '', '']);
      expect(nationalMap.get(key)?.note.trim().length ?? 0, key).toBeGreaterThan(0);
    }
    // A row with match = national has a level exactly when it has a quantity.
    for (const r of cropCountry) {
      if (r.match !== 'national') continue;
      const hasFigure = r.area_ha !== '' || r.production_t !== '';
      expect(r.level === 'unknown', `${r.crop_id}|${r.iso3}`).toBe(!hasFigure);
    }
  });

  it('counts the national rows with a figure apart from those without, and lists every national source', () => {
    const cropCountry = parseCsvObjects(fs.readFileSync(path.join(ATLAS, 'crop_country.csv'), 'utf8'));
    const summary = new Map(parseCsvObjects(fs.readFileSync(path.join(ATLAS, 'summary.csv'), 'utf8')).map((r) => [r.metric, Number(r.value)]));
    const national = cropCountry.filter((r) => r.match === 'national');
    expect(summary.get('crop_country_rows_national')).toBe(national.length);
    expect(summary.get('crop_country_rows_national_with_figure')).toBe(national.filter((r) => r.level !== 'unknown').length);
    expect(summary.get('crop_country_rows_national_without_figure')).toBe(national.filter((r) => r.level === 'unknown').length);
    expect(summary.get('crop_country_rows_national_with_figure')).toBe(17);

    const rows = readNational(DEFAULT_NATIONAL_FILE);
    expect(summary.get('national_rows_read')).toBe(rows.size);
    const used = nationalSourcesUsed(rows);
    expect(used.reduce((n, s) => n + s.rows, 0)).toBe(rows.size);
    expect(new Set(NATIONAL_SOURCES.map((s) => s.id)).size).toBe(NATIONAL_SOURCES.length);
    const sources = new Map(parseCsvObjects(fs.readFileSync(path.join(ATLAS, 'sources.csv'), 'utf8')).map((r) => [r.source, r]));
    for (const s of used) {
      expect(sources.get(s.id), s.id).toMatchObject({ title: s.title, publisher: s.publisher, url: s.url, licence: s.licence, accessed: s.accessed, file: 'data/crops/national/prevalence.csv' });
      expect(s.licence.length, s.id).toBeGreaterThan(0);
    }
    // A national row of the atlas names the statistic of its row in prevalence.csv, whose publication is in sources.csv.
    const urls = new Set([...sources.values()].map((s) => s.url));
    for (const r of national) {
      const key = `${r.crop_id}|${r.iso3}`;
      expect(r.source, key).toBe(rows.get(key)?.source);
      expect(r.source, key).not.toBe('FAOSTAT QCL');
      expect(urls.has(rows.get(key)!.url), key).toBe(true);
    }
  });

  it('keeps crop_country.csv to the 15 columns the market database mirrors, and changes no row outside VNM and USA', () => {
    const text = fs.readFileSync(path.join(ATLAS, 'crop_country.csv'), 'utf8');
    expect(text.slice(0, text.indexOf('\n')).split(',')).toEqual([
      'crop_id',
      'iso3',
      'country',
      'faostat_item_code',
      'match',
      'item_reported',
      'area_ha',
      'production_t',
      'yield_t_ha',
      'year_from',
      'year_to',
      'share_of_country_harvested_area_pct',
      'rank_in_country',
      'level',
      'source',
    ]);
    for (const r of parseCsvObjects(text)) {
      if (r.iso3 === 'VNM' || r.iso3 === 'USA') continue;
      if (r.match === 'national' || r.source !== 'FAOSTAT QCL') throw new Error(`${r.crop_id}|${r.iso3}: a national row outside VNM and USA`);
    }
  });

  it('refuses a national row whose url is not a registered source', () => {
    const rows = parseNational(
      ['crop_id,iso3,area_ha,production_t,year,source,url,accessed,table,note', 'durio-zibethinus,VNM,178800,1470000,2024,Somebody,https://example.org/unknown.pdf,2026-11-15,Table 1,note'].join('\n'),
      crops,
      countries,
    );
    expect(() => nationalSourcesUsed(rows)).toThrow(/not in NATIONAL_SOURCES/);
  });
});

describe('a national row beside what FAOSTAT says', () => {
  const VNM_TOTAL = 13_504_720;
  const row = (over: Partial<NationalRow>): NationalRow => ({
    cropId: 'x',
    iso3: 'VNM',
    areaHa: null,
    productionT: null,
    year: 2024,
    source: 'National statistics office',
    url: 'https://example.gov.vn/yearbook.pdf',
    accessed: '2026-11-15',
    table: 'Table 1',
    note: 'Counted inside a group; no figure of its own.',
    ...over,
  });
  const input = (over: Partial<CropCountryInput>): CropCountryInput => ({
    cropId: 'x',
    match: 'none',
    items: [],
    primary: null,
    iso3: 'VNM',
    countryName: 'Viet Nam',
    totalAreaHa: VNM_TOTAL,
    itemAreas: new Map([
      [27, 7_089_041],
      [56, 875_899],
    ]),
    faostat: null,
    groupItemReported: false,
    ...over,
  });
  // Column positions of crop_country.csv.
  const AREA = 6;
  const SHARE = 11;
  const RANK = 12;
  const LEVEL = 13;
  const SOURCE = 14;

  it('a row with a figure gets its level from the 5 % and 0.5 % thresholds of the country area', () => {
    const levelOf = (areaHa: number) => resolveCropCountryRow(input({ national: row({ areaHa }) }))!;
    // 5 % of 13,504,720 ha is 675,236 ha; 0.5 % is 67,523.6 ha.
    expect(levelOf(675_237).level).toBe('major');
    expect(levelOf(675_235).level).toBe('common');
    expect(levelOf(67_524).level).toBe('common');
    expect(levelOf(67_523).level).toBe('minor');
    expect(levelOf(1).level).toBe('minor');

    const durian = resolveCropCountryRow(input({ cropId: 'durio-zibethinus', match: 'group', items: [603], primary: 603, national: row({ areaHa: 178_800, productionT: 1_470_000 }) }))!;
    expect(durian).toMatchObject({ level: 'common', match: 'national', areaHa: 178_800, productionT: 1_470_000, inCountryCrops: true, inPossibleCrops: false });
    expect(durian.row[AREA]).toBe(178_800);
    expect(durian.row[SHARE]).toBe(1.324);
    // Smaller than rice and maize of the country: third.
    expect(durian.row[RANK]).toBe(3);
    expect(durian.row[SOURCE]).toBe('National statistics office');
    expect(durian.nationalIgnored).toBeUndefined();

    // Production without an area: no share can be computed, so the crop is present and no more.
    expect(resolveCropCountryRow(input({ national: row({ productionT: 500 }) }))).toMatchObject({ level: 'present', match: 'national', areaHa: null });
  });

  it('a row without a figure on an absent row makes it unknown, with the note', () => {
    const before = resolveCropCountryRow(input({ match: 'exact', items: [388], primary: 388 }))!;
    expect(before).toMatchObject({ level: 'absent', match: 'exact' });

    const after = resolveCropCountryRow(input({ match: 'exact', items: [388], primary: 388, national: row({}) }))!;
    expect(after).toMatchObject({ level: 'unknown', match: 'national', areaHa: null, productionT: null, inCountryCrops: false, inPossibleCrops: false });
    expect(after.row[AREA]).toBeNull();
    expect(after.row[SHARE]).toBeNull();
    expect(after.row[LEVEL]).toBe('unknown');
    expect(after.row[SOURCE]).toBe('National statistics office');
    expect(after.row).toHaveLength(15);
    expect(after.nationalIgnored).toBeUndefined();
  });

  it('a row without a figure leaves a present exact row as FAOSTAT has it, and says it was ignored', () => {
    // FAOSTAT reports production and no area: present.
    const faostat = { codes: [388], areaHa: null, productionT: 12_000, yieldTHa: null, yearFrom: 2022, yearTo: 2024 };
    const without = resolveCropCountryRow(input({ match: 'exact', items: [388], primary: 388, faostat }))!;
    const withNote = resolveCropCountryRow(input({ match: 'exact', items: [388], primary: 388, faostat, national: row({}) }))!;
    expect(without).toMatchObject({ level: 'present', match: 'exact', productionT: 12_000 });
    expect(without.nationalIgnored).toBeUndefined();
    expect(withNote.row).toEqual(without.row);
    expect(withNote).toMatchObject({ level: 'present', match: 'exact', productionT: 12_000, inCountryCrops: true, nationalIgnored: true });
    expect(withNote.row[SOURCE]).toBe('FAOSTAT QCL');

    // The same holds for a national row with a figure, and for an exact row that has an area.
    expect(resolveCropCountryRow(input({ match: 'exact', items: [388], primary: 388, faostat, national: row({ areaHa: 900 }) }))).toMatchObject({ level: 'present', match: 'exact', nationalIgnored: true });
    const minor = { ...faostat, areaHa: 50_916 };
    expect(resolveCropCountryRow(input({ match: 'exact', items: [388], primary: 388, faostat: minor, national: row({}) }))).toMatchObject({ level: 'minor', match: 'exact', areaHa: 50_916, nationalIgnored: true });
  });
});
