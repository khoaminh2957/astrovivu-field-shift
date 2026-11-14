import { readFileSync, readdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { ATLAS_FILE, cleanAtlasRow, readAtlas } from './atlas';
import { csvLine, parseCsvLine } from './csv';
import { bareCode, faostatRows } from './faostat';
import { assemble, monthOf, readMapping } from './load';
import { AREAS_FILE, isResidualItem } from './match-faostat';
import { openZipEntry, zipEntries } from './zip';

// ------------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------------

/** A ZIP archive built by hand, so the reader is tested against the format and not against itself. */
function zipOf(files: { name: string; text: string; store?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.text, 'utf8');
    const data = f.store ? raw : deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(f.store ? 0 : 8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

async function textOf(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function* rowsOf(rows: Record<string, string>[]): AsyncGenerator<Record<string, string>> {
  yield* rows;
}

const atlasSource = (): Record<string, string>[] =>
  Papa.parse<Record<string, string>>(readFileSync(ATLAS_FILE, 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
const sourceRow = (scientificName: string): Record<string, string> => {
  const row = atlasSource().find((r) => r.scientific_name.trim() === scientificName);
  if (!row) throw new Error(`${scientificName} is not in ${ATLAS_FILE}`);
  return row;
};

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

// ------------------------------------------------------------------------------------------------
// Reading FAOSTAT bulk files
// ------------------------------------------------------------------------------------------------

describe('zip reader', () => {
  it('lists and inflates deflated and stored entries', async () => {
    const big = 'line of text\n'.repeat(5000);
    const zip = zipOf([
      { name: 'Readme.txt', text: 'stored as is', store: true },
      { name: 'Prices_E_All_Data_(Normalized).csv', text: big },
    ]);
    const entries = zipEntries(zip);
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['Readme.txt', 0, 12],
      ['Prices_E_All_Data_(Normalized).csv', 8, big.length],
    ]);
    expect(await textOf(openZipEntry(zip, entries[0]))).toBe('stored as is');
    expect(await textOf(openZipEntry(zip, entries[1]))).toBe(big);
  });

  it('refuses what it cannot read instead of returning garbage', () => {
    expect(() => zipEntries(Buffer.from('not a zip file at all, just some bytes'))).toThrow(/Not a ZIP/);
    const zip = zipOf([{ name: 'a.csv', text: 'x' }]);
    const [entry] = zipEntries(zip);
    expect(() => openZipEntry(zip, { ...entry, method: 12 })).toThrow(/Unsupported ZIP compression/);
    expect(() => openZipEntry(zip, { ...entry, offset: 3 })).toThrow(/bad local header/);
  });
});

describe('csv line', () => {
  it('reads quoted commas, doubled quotes and empty cells', () => {
    expect(parseCsvLine('"237","Viet Nam","Rice, paddy",356.0,,"A"')).toEqual(['237', 'Viet Nam', 'Rice, paddy', '356.0', '', 'A']);
    expect(parseCsvLine('"say ""hi""",x,')).toEqual(['say "hi"', 'x', '']);
    expect(parseCsvLine('')).toEqual(['']);
  });

  it('writes what it can read back', () => {
    const cells = ['Other vegetables, fresh n.e.c.', 'a "quoted" word', '', '12.5', 'plain'];
    expect(parseCsvLine(csvLine(cells))).toEqual(cells);
    expect(csvLine([1, true, null, undefined, 'x'])).toBe('1,true,,,x');
  });
});

describe('faostat rows', () => {
  it('keys each line by the header, without the byte-order mark', async () => {
    const csv = '\uFEFF"Area Code","Area","Item Code","Item","Value"\n"237","Viet Nam","27","Rice","356"\n\n"231","United States of America","56","Maize (corn)","185.4"\n';
    const zip = zipOf([
      { name: 'Prices_E_Flags.csv', text: 'Flag,Description\n' },
      { name: 'Prices_E_All_Data_(Normalized).csv', text: csv },
    ]);
    const rows: Record<string, string>[] = [];
    for await (const r of faostatRows(zip)) rows.push(r);
    expect(rows).toEqual([
      { 'Area Code': '237', Area: 'Viet Nam', 'Item Code': '27', Item: 'Rice', Value: '356' },
      { 'Area Code': '231', Area: 'United States of America', 'Item Code': '56', Item: 'Maize (corn)', Value: '185.4' },
    ]);
  });

  it('strips the apostrophe FAOSTAT puts before codes', () => {
    expect(bareCode("'704")).toBe('704');
    expect(bareCode('01239.01')).toBe('01239.01');
  });
});

// ------------------------------------------------------------------------------------------------
// The atlas
// ------------------------------------------------------------------------------------------------

describe('atlas cleaning', () => {
  it('normalises classes, lists and climate zones', () => {
    const { row, producingCountries } = cleanAtlasRow(sourceRow('Oryza sativa'));
    expect(row.id).toBe('oryza-sativa');
    expect([row.soil_depth_opt, row.soil_depth_abs, row.soil_salinity_opt]).toEqual(['medium', 'shallow', 'low']);
    expect(row.soil_drainage_opt).toEqual(['poorly']);
    expect(row.climate_zones).toEqual(['Aw', 'Ar', 'Cf', 'Cs', 'Cw']);
    expect([row.lat_opt_min, row.lat_abs_max]).toEqual([null, 55]);
    expect(row.quality_notes).toEqual([]);
    expect(producingCountries).toContain('Viet Nam');
  });

  it('exchanges temperature and rainfall entered in each other\'s columns, and says so', () => {
    const { row } = cleanAtlasRow(sourceRow('Eugenia stipitata'));
    expect([row.temp_opt_min, row.temp_opt_max, row.temp_abs_min, row.temp_abs_max]).toEqual([22, 30, 18, 34]);
    expect([row.rain_opt_min, row.rain_opt_max, row.rain_abs_min, row.rain_abs_max]).toEqual([2000, 3500, 1500, 4000]);
    expect(row.quality_notes.join(' ')).toMatch(/temperature and rainfall columns were swapped/);
  });

  it('never keeps a latitude above 90', () => {
    const base = sourceRow('Oryza sativa');
    const swapped = cleanAtlasRow({ ...base, eco_latitude_abs_max: '1800', eco_altitude_abs_max: '30' }).row;
    expect([swapped.lat_abs_max, swapped.altitude_abs_max]).toEqual([30, 1800]);
    expect(swapped.quality_notes.join(' ')).toMatch(/latitude and altitude columns were swapped/);
    const dropped = cleanAtlasRow({ ...base, eco_latitude_abs_max: '1800', eco_altitude_abs_max: '2500' }).row;
    expect([dropped.lat_abs_max, dropped.altitude_abs_max]).toEqual([null, 2500]);
    expect(dropped.quality_notes.join(' ')).toMatch(/was dropped/);
  });

  it('reads a cycle of 0 as "not given" and keeps the note', () => {
    const { row } = cleanAtlasRow({ ...sourceRow('Oryza sativa'), cult_cycle_min: '0', cult_cycle_max: '0' });
    expect([row.cycle_min_days, row.cycle_max_days]).toEqual([null, null]);
    expect(row.quality_notes).toEqual(['growing cycle not given in the source (0)']);
  });

  it('flags a range it does not correct', () => {
    const { row } = cleanAtlasRow({ ...sourceRow('Oryza sativa'), eco_soil_ph_opt_max: '9.5' });
    expect(row.ph_opt_max).toBe(9.5);
    expect(row.quality_notes).toEqual(['pH: the optimal range lies partly outside the absolute range in the source']);
  });
});

describe('atlas file', () => {
  const atlas = readAtlas();
  const rows = atlas.map((c) => c.row);

  it('holds 489 crops with unique ids and names a database row accepts', () => {
    expect(atlas).toHaveLength(489);
    expect(new Set(rows.map((r) => r.id)).size).toBe(489);
    expect(new Set(rows.map((r) => r.scientific_name)).size).toBe(489);
    for (const r of rows) expect(r.id, r.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('satisfies the range checks of the crops table', () => {
    for (const r of rows) {
      for (const t of [r.temp_opt_min, r.temp_opt_max, r.temp_abs_min, r.temp_abs_max]) if (t != null) expect(t, `${r.name} temperature`).toBeLessThan(70);
      for (const l of [r.lat_opt_min, r.lat_opt_max, r.lat_abs_min, r.lat_abs_max]) if (l != null) expect(l, `${r.name} latitude`).toBeLessThanOrEqual(90);
      for (const p of [r.ph_opt_min, r.ph_opt_max, r.ph_abs_min, r.ph_abs_max]) if (p != null) expect(p, `${r.name} pH`).toBeLessThanOrEqual(14);
      for (const d of [r.cycle_min_days, r.cycle_max_days]) if (d != null) expect(d, `${r.name} cycle`).toBeGreaterThan(0);
    }
  });

  it('explains every value it changed', () => {
    const noted = rows.filter((r) => r.quality_notes.length);
    expect(noted.map((r) => r.id)).toEqual(expect.arrayContaining(['eugenia-stipitata', 'solanum-melongena', 'hylocereus-undatus', 'vitellaria-paradoxa']));
    expect(rows.find((r) => r.id === 'vitellaria-paradoxa')?.cycle_max_days).toBe(240);
  });
});

// ------------------------------------------------------------------------------------------------
// The link to FAOSTAT and the rows sent to the database
// ------------------------------------------------------------------------------------------------

describe('crop to FAOSTAT item link', () => {
  const atlas = readAtlas();
  const mapping = readMapping();
  const areas = Papa.parse<Record<string, string>>(readFileSync(AREAS_FILE, 'utf8'), { header: true, skipEmptyLines: true }).data;

  it('links every atlas crop to one item', () => {
    expect(mapping.map((m) => m.crop_id).sort()).toEqual(atlas.map((c) => c.row.id).sort());
    for (const m of mapping) {
      expect(Number.isInteger(m.item_code) && m.item_code > 0, m.crop_id).toBe(true);
      expect(m.faostat_item, m.crop_id).not.toBe('');
      expect(m.match_method).toBe('producing-countries');
    }
    expect(new Set(mapping.map((m) => m.item_code)).size).toBe(146);
  });

  it('gives one name to one item code', () => {
    const names = new Map<number, string>();
    for (const m of mapping) {
      expect(names.get(m.item_code) ?? m.faostat_item).toBe(m.faostat_item);
      names.set(m.item_code, m.faostat_item);
    }
  });

  it('documents the three ties', () => {
    const tied = mapping.filter((m) => m.tie_note);
    expect(new Set(tied.map((m) => m.item_code))).toEqual(new Set([254, 310, 328]));
  });

  it('knows the FAOSTAT area of every producing country, and no regional aggregate', () => {
    const known = new Set(areas.map((a) => a.name));
    for (const c of atlas) for (const country of c.producingCountries) expect(known.has(country), `${c.row.name}: ${country}`).toBe(true);
    expect(new Set(areas.map((a) => a.area_code)).size).toBe(areas.length);
    for (const a of areas) expect(Number(a.area_code)).toBeLessThan(5000);
    expect(areas.some((a) => a.area_code === '351')).toBe(false);
  });

  it('recognises pooled items by name', () => {
    expect(isResidualItem('Other vegetables, fresh n.e.c.')).toBe(true);
    expect(isResidualItem('Other pome fruits')).toBe(true);
    expect(isResidualItem('Rice')).toBe(false);
    expect(isResidualItem('Chillies and peppers, green (Capsicum spp. and Pimenta spp.)')).toBe(false);
  });
});

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
    );
    expect(data.prices).toEqual([
      { area_code: 237, item_code: 27, year: 2024, month: 0, lcu_per_tonne: 8900000, slc_per_tonne: 8900000, usd_per_tonne: 356, price_index: 131.2, lcu_flag: 'A', slc_flag: 'A', usd_flag: 'X', index_flag: 'I' },
    ]);
  });

  it('leaves out aggregates, unlinked items, months unless asked for, and lines without a number', async () => {
    const lines = [
      priceLine(),
      priceLine({ 'Area Code': '5000', Area: 'World' }),
      priceLine({ 'Area Code': '351', Area: 'China' }),
      priceLine({ 'Item Code': '867', Item: 'Meat of cattle with the bone, fresh or chilled' }),
      priceLine({ 'Months Code': '7003', Value: '349' }),
      priceLine({ Year: '2023', Value: '' }),
    ];
    const annual = await assemble(rowsOf(lines), { monthly: false });
    expect(annual.prices.map((p) => [p.area_code, p.year, p.month, p.usd_per_tonne])).toEqual([[237, 2024, 0, 356]]);
    expect(annual.skipped).toEqual({ aggregateAreas: 2, otherItems: 1, monthly: 1, noValue: 1 });
    const monthly = await assemble(rowsOf(lines), { monthly: true });
    expect(monthly.prices.map((p) => p.month).sort()).toEqual([0, 3]);
  });

  it('adds a country that reports prices but is not in the areas file', async () => {
    const data = await assemble(rowsOf([priceLine({ 'Area Code': '4999', 'Area Code (M49)': "'999", Area: 'Newland' })]), { monthly: false });
    expect(data.areas.find((a) => a.area_code === 4999)).toEqual({ area_code: 4999, m49_code: '999', name: 'Newland' });
  });

  it('keeps every foreign key of the load satisfied', async () => {
    const data = await assemble(rowsOf([priceLine()]), { monthly: false });
    const crops = new Set(data.crops.map((c) => c.id));
    const items = new Set(data.items.map((i) => i.item_code));
    const areas = new Set(data.areas.map((a) => a.area_code));
    for (const l of data.links) expect(crops.has(l.crop_id) && items.has(l.item_code), l.crop_id).toBe(true);
    for (const cc of data.cropCountries) expect(crops.has(cc.crop_id) && areas.has(cc.area_code), `${cc.crop_id} ${cc.area_code}`).toBe(true);
    expect(new Set(data.cropCountries.map((cc) => `${cc.crop_id}:${cc.area_code}`)).size).toBe(data.cropCountries.length);
    expect(data.items.filter((i) => i.is_residual).length).toBe(16);
  });
});

// ------------------------------------------------------------------------------------------------
// The loader and the schema describe the same tables
// ------------------------------------------------------------------------------------------------

describe('loader and migrations agree', () => {
  const sql = readdirSync('supabase/migrations')
    .sort()
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
    .join('\n');
  const columnsOf = (table: string): string[] => {
    const body = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1];
    if (!body) throw new Error(`create table public.${table} not found in supabase/migrations`);
    return body
      .split('\n')
      .map((l) => /^ {2}([a-z_0-9]+) /.exec(l)?.[1])
      .filter((c): c is string => !!c && !['primary', 'constraint', 'check', 'unique', 'foreign'].includes(c));
  };

  it('crops: every field the loader sends is a column', () => {
    const sent = Object.keys(readAtlas()[0].row).sort();
    expect(columnsOf('crops').sort()).toEqual(sent);
  });

  it('producer_prices: every field the loader sends is a column', async () => {
    const data = await assemble(rowsOf([priceLine()]), { monthly: false });
    expect(columnsOf('producer_prices').sort()).toEqual(Object.keys(data.prices[0]).sort());
  });

  it('migration files are named in the order they apply', () => {
    const files = readdirSync('supabase/migrations');
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(new Set(files.map((f) => f.slice(0, 14))).size).toBe(files.length);
  });
});
