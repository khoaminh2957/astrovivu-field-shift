import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCsvObjects } from '../crops/atlas/csv';
import { buildZip } from '../crops/atlas/zip';
import { AREAS_FILE } from './areas';
import { ATLAS_DIR, columnsOf, countryCodes, cropItems, kindOf, readAtlas, readTable, TABLES, type AtlasTable } from './atlas';
import { bareCode, faostatRows } from './faostat';
import { assemble, atlasSources, monthOf, readAreas } from './load';

// ------------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------------

const scratch = mkdtempSync(path.join(tmpdir(), 'astrovivu-market-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const BOM = String.fromCharCode(0xfeff);
const atlas = readAtlas();
/** The counts the atlas build wrote about itself. */
const summary = new Map(parseCsvObjects(readFileSync(`${ATLAS_DIR}/summary.csv`, 'utf8')).map((r) => [r.metric, r.value]));

async function* rowsOf(rows: Record<string, string>[]): AsyncGenerator<Record<string, string>> {
  yield* rows;
}

/** One FAOSTAT price line: annual USD price of rice (item 27) in Viet Nam (area 237) unless overridden. */
const priceLine = (over: Record<string, string> = {}): Record<string, string> => ({
  'Area Code': '237',
  'Area Code (M49)': "'704",
  Area: 'Viet Nam',
  'Item Code': '27',
  Item: 'Rice',
  'Element Code': '5532',
  Year: '2024',
  'Months Code': '7021',
  Value: '356',
  Flag: 'A',
  ...over,
});

/** A folder holding one atlas table with the given text. */
function atlasDirWith(table: AtlasTable, csv: string): string {
  const dir = mkdtempSync(path.join(scratch, 'atlas-'));
  writeFileSync(path.join(dir, TABLES[table].file), csv);
  return dir;
}

// ------------------------------------------------------------------------------------------------
// Reading FAOSTAT bulk files
// ------------------------------------------------------------------------------------------------

describe('faostat rows', () => {
  it('keys each line of the All_Data table by its header, without the byte-order mark', async () => {
    const csv = `${BOM}"Area Code","Area","Item Code","Item","Value"\n"237","Viet Nam","27","Rice, paddy (rice milled equivalent)","356"\n\n"231","United States of America","56","Maize (corn)","185.4"\n`;
    const zip = path.join(scratch, 'prices.zip');
    writeFileSync(zip, buildZip([
      { name: 'Prices_E_Flags.csv', data: Buffer.from('Flag,Description\n') },
      { name: 'Prices_E_All_Data_(Normalized).csv', data: Buffer.from(csv) },
    ]));
    const rows: Record<string, string>[] = [];
    for await (const r of faostatRows(zip)) rows.push(r);
    expect(rows).toEqual([
      { 'Area Code': '237', Area: 'Viet Nam', 'Item Code': '27', Item: 'Rice, paddy (rice milled equivalent)', Value: '356' },
      { 'Area Code': '231', Area: 'United States of America', 'Item Code': '56', Item: 'Maize (corn)', Value: '185.4' },
    ]);
  });

  it('refuses an archive without the data table', async () => {
    const zip = path.join(scratch, 'other.zip');
    writeFileSync(zip, buildZip([{ name: 'Readme.txt', data: Buffer.from('x') }]));
    await expect(faostatRows(zip).next()).rejects.toThrow(/without an All_Data table/);
  });

  it('strips the apostrophe FAOSTAT puts before codes', () => {
    expect(bareCode("'704")).toBe('704');
    expect(bareCode('01239.01')).toBe('01239.01');
  });
});

// ------------------------------------------------------------------------------------------------
// The atlas tables
// ------------------------------------------------------------------------------------------------

describe('column types', () => {
  it('reads the type of a column from its name', () => {
    expect(kindOf('crops', 'temp_opt_min_c')).toBe('numeric');
    expect(kindOf('crops', 'ph_abs_max')).toBe('numeric');
    expect(kindOf('crops', 'world_production_t')).toBe('numeric');
    expect(kindOf('crop_country', 'share_of_country_harvested_area_pct')).toBe('numeric');
    expect(kindOf('crops', 'cycle_min_days')).toBe('integer');
    expect(kindOf('crops', 'curated')).toBe('boolean');
    expect(kindOf('crop_country', 'item_reported')).toBe('boolean');
    // Names that end like a unit without being one, and codes that look like numbers.
    for (const column of ['soil_depth_opt', 'habit', 'spam_crop', 'cpc_code', 'data_years', 'match']) expect(kindOf('crops', column), column).toBe('text');
  });

  it('treats one item code as a number and a list of them as text', () => {
    expect(kindOf('crops', 'faostat_item_code')).toBe('integer');
    expect(kindOf('items', 'faostat_item_code')).toBe('integer');
    expect(kindOf('crop_country', 'faostat_item_code')).toBe('text');
  });
});

describe('atlas rows', () => {
  it('holds as many rows as the atlas build counted', () => {
    expect(atlas.crops).toHaveLength(Number(summary.get('kept_crops')));
    expect(atlas.items).toHaveLength(Number(summary.get('faostat_crop_items')));
    expect(atlas.cropCountry).toHaveLength(Number(summary.get('crop_country_rows')));
  });

  it('types the values and turns an empty cell into null', () => {
    const rice = atlas.crops.find((c) => c.crop_id === 'oryza-sativa');
    expect(rice).toMatchObject({ scientific_name: 'Oryza sativa', match: 'exact', faostat_item_code: 27, curated: true, temp_opt_min_c: 20, ph_opt_min: 5.5 });
    // No value in the atlas is an empty string: an unknown is null.
    for (const table of [atlas.crops, atlas.items, atlas.cropCountry]) for (const row of table) for (const v of Object.values(row)) expect(v).not.toBe('');
    const viet = atlas.cropCountry.find((r) => r.crop_id === 'oryza-sativa' && r.iso3 === 'VNM');
    expect(viet).toMatchObject({ country: 'Viet Nam', match: 'exact', item_reported: true, level: 'major' });
    expect(typeof viet?.area_ha).toBe('number');
  });

  it('keeps the vocabulary the database checks', () => {
    expect(new Set(atlas.crops.map((c) => c.match))).toEqual(new Set(['exact', 'group', 'none']));
    expect(new Set(atlas.items.map((i) => i.item_class))).toEqual(new Set(['single', 'group']));
    for (const row of atlas.cropCountry) expect(['major', 'common', 'minor', 'present', 'absent', 'unknown']).toContain(row.level);
    for (const c of atlas.crops) expect(c.crop_id, String(c.scientific_name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('stops at a value that does not fit its column, naming the place', () => {
    expect(() => readTable('crops', atlasDirWith('crops', 'crop_id,cycle_min_days\nrice,90\nmaize,ninety\n'))).toThrow(/crops\.csv, row 3, cycle_min_days: "ninety" is not a whole number/);
    expect(() => readTable('crops', atlasDirWith('crops', 'crop_id,curated\nrice,maybe\n'))).toThrow(/neither yes nor no/);
    expect(() => readTable('crop_country', atlasDirWith('crop_country', 'crop_id,iso3,level\nrice,VNM,major\nrice,VNM,minor\n'))).toThrow(/two rows for rice \/ VNM/);
  });
});

describe('crop to item link', () => {
  const links = atlas.cropItems;

  it('has the crop\'s own item first and its other items after it', () => {
    expect(cropItems([{ crop_id: 'zea-mays', faostat_item_code: 56, faostat_other_item_codes: '446' }, { crop_id: 'basella-alba', faostat_item_code: null, faostat_other_item_codes: null }])).toEqual([
      { crop_id: 'zea-mays', faostat_item_code: 56, is_primary: true },
      { crop_id: 'zea-mays', faostat_item_code: 446, is_primary: false },
    ]);
    expect(() => cropItems([{ crop_id: 'x', faostat_item_code: 1, faostat_other_item_codes: '2;b' }])).toThrow(/"b" in faostat_other_item_codes/);
  });

  it('links every crop the atlas matched, once as primary, and no other', () => {
    const matched = atlas.crops.filter((c) => c.match !== 'none').map((c) => c.crop_id);
    expect(links.filter((l) => l.is_primary).map((l) => l.crop_id).sort()).toEqual([...matched].sort());
    for (const c of atlas.crops) expect(c.faostat_item_code == null, String(c.crop_id)).toBe(c.match === 'none');
    expect(new Set(links.map((l) => `${l.crop_id}:${l.faostat_item_code}`)).size).toBe(links.length);
  });

  it('points only at items of the atlas', () => {
    const items = new Set(atlas.items.map((i) => i.faostat_item_code));
    for (const l of links) expect(items.has(l.faostat_item_code), `${l.crop_id} -> ${l.faostat_item_code}`).toBe(true);
  });
});

describe('countries', () => {
  const areas = readAreas();
  const atlasCountries = countryCodes(atlas.cropCountry);

  it('gives every atlas country one FAOSTAT area, under the same name', () => {
    const byIso = new Map(areas.filter((a) => a.iso3).map((a) => [a.iso3, a.name]));
    expect(byIso.size).toBe(areas.filter((a) => a.iso3).length);
    for (const [name, iso3] of atlasCountries) expect(byIso.get(iso3), iso3).toBe(name);
    expect(byIso.size).toBe(atlasCountries.size);
  });

  it('leaves without an ISO code only the areas that are not atlas countries', () => {
    // A change here means FAOSTAT or the atlas changed its list of countries: run `npm run market:areas` and look at the difference.
    expect(areas.filter((a) => !a.iso3).map((a) => a.name).sort()).toEqual(
      ['Belgium-Luxembourg', 'Czechoslovakia', 'Ethiopia PDR', 'French Guiana', 'Guadeloupe', 'Martinique', 'Réunion', 'Serbia and Montenegro', 'Sudan (former)', 'USSR', 'Yugoslav SFR'].sort(),
    );
  });

  it('holds countries only: no regional aggregate, and not the sum row "China"', () => {
    expect(new Set(areas.map((a) => a.area_code)).size).toBe(areas.length);
    for (const a of areas) expect(a.area_code, a.name).toBeLessThan(5000);
    expect(areas.some((a) => a.area_code === 351)).toBe(false);
    expect(areas.find((a) => a.iso3 === 'CHN')?.name).toBe('China, mainland');
  });
});

// ------------------------------------------------------------------------------------------------
// The rows sent to the database
// ------------------------------------------------------------------------------------------------

describe('rows sent to the database', () => {
  it('reads FAOSTAT month codes', () => {
    expect([monthOf(7021), monthOf(7001), monthOf(7012), monthOf(7013), monthOf(2024)]).toEqual([0, 1, 12, null, null]);
  });

  it('folds the four price elements of one area, item and year into one row', async () => {
    const data = await assemble(
      rowsOf([
        priceLine({ 'Element Code': '5530', Value: '8900000', Flag: 'A' }),
        priceLine({ 'Element Code': '5531', Value: '8900000', Flag: 'A' }),
        priceLine({ 'Element Code': '5532', Value: '356', Flag: 'X' }),
        priceLine({ 'Element Code': '5539', Value: '131.2', Flag: 'I' }),
      ]),
      { monthly: false },
      atlas,
    );
    expect(data.prices).toEqual([
      { area_code: 237, faostat_item_code: 27, year: 2024, month: 0, lcu_per_tonne: 8900000, slc_per_tonne: 8900000, usd_per_tonne: 356, price_index: 131.2, lcu_flag: 'A', slc_flag: 'A', usd_flag: 'X', index_flag: 'I' },
    ]);
  });

  it('leaves out aggregates, items outside the atlas, months unless asked for, and lines without a number', async () => {
    const lines = [
      priceLine(),
      priceLine({ 'Area Code': '5000', Area: 'World' }),
      priceLine({ 'Area Code': '351', Area: 'China' }),
      priceLine({ 'Item Code': '867', Item: 'Meat of cattle with the bone, fresh or chilled' }),
      priceLine({ 'Months Code': '7003', Value: '349' }),
      priceLine({ Year: '2023', Value: '' }),
    ];
    const annual = await assemble(rowsOf(lines), { monthly: false }, atlas);
    expect(annual.prices.map((p) => [p.area_code, p.year, p.month, p.usd_per_tonne])).toEqual([[237, 2024, 0, 356]]);
    expect(annual.skipped).toEqual({ aggregateAreas: 2, otherItems: 1, monthly: 1, noValue: 1 });
    const monthly = await assemble(rowsOf(lines), { monthly: true }, atlas);
    expect(monthly.prices.map((p) => p.month).sort()).toEqual([0, 3]);
  });

  it('keeps the prices of a country outside the area list, without an ISO code', async () => {
    const data = await assemble(rowsOf([priceLine({ 'Area Code': '4999', 'Area Code (M49)': "'999", Area: 'Newland' })]), { monthly: false }, atlas);
    expect(data.areas.find((a) => a.area_code === 4999)).toEqual({ area_code: 4999, m49_code: '999', name: 'Newland', iso3: null });
  });

  it('keeps every foreign key of the load satisfied', async () => {
    const data = await assemble(rowsOf([priceLine()]), { monthly: false }, atlas);
    const crops = new Set(data.crops.map((c) => c.crop_id));
    const items = new Set(data.items.map((i) => i.faostat_item_code));
    const iso3 = new Set(data.areas.map((a) => a.iso3));
    for (const c of data.crops) if (c.faostat_item_code != null) expect(items.has(c.faostat_item_code), String(c.crop_id)).toBe(true);
    for (const l of data.cropItems) expect(crops.has(l.crop_id) && items.has(l.faostat_item_code), l.crop_id).toBe(true);
    for (const cc of data.cropCountry) expect(crops.has(cc.crop_id) && iso3.has(String(cc.iso3)), `${cc.crop_id} ${cc.iso3}`).toBe(true);
    for (const p of data.prices) expect(items.has(p.faostat_item_code)).toBe(true);
  });

  it('refuses an atlas whose countries the area list does not know', async () => {
    const stranger = { ...atlas, cropCountry: [...atlas.cropCountry, { ...atlas.cropCountry[0], iso3: 'XTA', country: 'Testland' }] };
    await expect(assemble(rowsOf([]), { monthly: false }, stranger)).rejects.toThrow(/Testland.*npm run market:areas/);
  });
});

describe('sources', () => {
  it('passes on what the atlas build recorded about each of its sources', () => {
    const sources = atlasSources();
    expect(sources).toHaveLength(parseCsvObjects(readFileSync(`${ATLAS_DIR}/sources.csv`, 'utf8')).length);
    expect(new Set(sources.map((s) => s.code)).size).toBe(sources.length);
    for (const s of sources) {
      expect(s.name && s.publisher && s.url, s.code).toBeTruthy();
      if (s.sha256) expect(s.sha256, s.code).toMatch(/^[0-9a-f]{64}$/);
      if (s.accessed_on) expect(s.accessed_on, s.code).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(sources.find((s) => s.code === 'faostat-qcl')?.licence).toMatch(/CC BY 4\.0/);
  });
});

// ------------------------------------------------------------------------------------------------
// The atlas files, the loader and the schema describe the same tables
// ------------------------------------------------------------------------------------------------

describe('atlas, loader and migrations agree', () => {
  const sql = readdirSync('supabase/migrations')
    .sort()
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
    .join('\n');
  /** Columns of the table as its last `create table` declares them: [name, type]. */
  const declared = (table: string): [string, string][] => {
    const all = [...sql.matchAll(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'g'))];
    const body = all.at(-1)?.[1];
    if (!body) throw new Error(`create table public.${table} not found in supabase/migrations`);
    return body
      .split('\n')
      .map((l) => /^ {2}([a-z_0-9]+)\s+(text|integer|numeric|boolean|smallint)\b/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]]);
  };

  it.each(Object.keys(TABLES) as AtlasTable[])('%s: the table has the columns of the atlas file, in its order and with the type the loader sends', (table) => {
    const columns = columnsOf(table);
    expect(declared(table)).toEqual(columns.map((c) => [c, kindOf(table, c)]));
  });

  it('producer_prices and crop_items: every field the loader sends is a column', async () => {
    const data = await assemble(rowsOf([priceLine()]), { monthly: false }, atlas);
    expect(declared('producer_prices').map(([c]) => c).sort()).toEqual(Object.keys(data.prices[0]).sort());
    expect(declared('crop_items').map(([c]) => c).sort()).toEqual(Object.keys(data.cropItems[0]).sort());
  });

  it('areas: the area list has the columns of the table', () => {
    const header = readFileSync(AREAS_FILE, 'utf8').split('\n')[0].split(',');
    expect(header).toEqual(['area_code', 'm49_code', 'name', 'iso3']);
    expect(sql).toMatch(/alter table public\.areas add column iso3 text/);
  });

  it('migration files are named in the order they apply', () => {
    const files = readdirSync('supabase/migrations');
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(new Set(files.map((f) => f.slice(0, 14))).size).toBe(files.length);
  });
});
