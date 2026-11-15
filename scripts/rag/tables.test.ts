/** The lookup tables against the atlas they are written from, and the files against the tables. */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { fileReader } from '../../server/loader';
import { tableSource } from '../../src/rag/tables';
import { buildTables, TABLES_DIR } from './tables';

const ROOT = path.resolve(import.meta.dirname, '../..');
type Row = Record<string, string>;
const csv = (name: string): Row[] => Papa.parse<Row>(fs.readFileSync(path.join(ROOT, 'data/crops/atlas', name), 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
const built = buildTables();

function walk(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
}

describe('the lookup tables', () => {
  it('hold every crop and every country of the atlas', () => {
    const crops = csv('crops.csv');
    expect(Object.keys(built.crops.crops)).toHaveLength(crops.length);
    expect(Object.keys(built.crops.crops)).toHaveLength(387);
    expect(Object.keys(built.countries)).toHaveLength(new Set(csv('crop_country.csv').map((r) => r.iso3)).size);
    expect(Object.keys(built.countries)).toHaveLength(198);
    // Every crop tied to an item is listed under that item, and only there.
    for (const c of crops) {
      const entry = built.crops.crops[c.crop_id];
      expect(entry).toMatchObject({ sci: c.scientific_name.trim(), match: c.match });
      if (c.match === 'none') expect(entry.item ?? '').toBe(c.faostat_item_code);
      else expect(built.crops.items[c.faostat_item_code].crops).toContain(c.crop_id);
    }
    // "Rice" is the item of the three rice crops and also counts African rice, as a group crop.
    expect(built.crops.items['27'].name).toBe('Rice');
    expect(built.crops.items['27'].crops.filter((id) => built.crops.crops[id].match === 'exact')).toHaveLength(3);
    expect(built.crops.items['27'].crops.filter((id) => built.crops.crops[id].match === 'group')).toEqual(['oryza-glaberrima']);
  });

  it('give a crop file to the crops with an item of their own, with every reporting country, and to no other', () => {
    const rows = csv('crop_country.csv');
    const exact = csv('crops.csv').filter((c) => c.match === 'exact');
    expect(built.crop.size).toBe(exact.length);
    for (const c of exact) {
      const reporting = rows.filter((r) => r.crop_id === c.crop_id && ['major', 'common', 'minor', 'present'].includes(r.level));
      const file = built.crop.get(c.crop_id)!;
      expect(file.rows, c.crop_id).toHaveLength(reporting.length);
      expect(file.rows.length).toBe(Number(c.n_countries_producing));
    }
    const rice = built.crop.get('oryza-sativa')!;
    const vnm = rows.find((r) => r.crop_id === 'oryza-sativa' && r.iso3 === 'VNM')!;
    expect(rice.rows.find((r) => r.iso3 === 'VNM')).toEqual({ iso3: 'VNM', areaHa: Number(vnm.area_ha), productionT: Number(vnm.production_t), level: vnm.level, years: [Number(vnm.year_from), Number(vnm.year_to)] });
    expect(built.crop.has('durio-zibethinus')).toBe(false);
  });

  it('give the regions of a country every MapSPAM row of the atlas, and describe each SPAM crop once', () => {
    const rows = csv('region_crops.csv').filter((r) => r.level === 'admin1' && r.admin1);
    expect([...built.region.values()].reduce((a, f) => a + Object.values(f.regions).reduce((n, x) => n + x.length, 0), 0)).toBe(rows.length);
    const dakLak = built.region.get('VNM')!.regions['Dak Lak'];
    const coffee = rows.find((r) => r.iso3 === 'VNM' && r.admin1 === 'Dak Lak' && r.spam_crop === 'rcof')!;
    expect(dakLak.find((r) => r[0] === 'rcof')).toEqual(['rcof', Number(coffee.harvested_area_ha), Number(coffee.share_of_region_pct), Number(coffee.rank_in_region)]);
    expect(built.spam.rcof).toEqual({ name: coffee.spam_crop_name, residual: false, crops: ['coffea-canephora'] });
    expect(Object.keys(built.spam)).toHaveLength(new Set(csv('region_crops.csv').map((r) => r.spam_crop)).size);
    expect(built.region.get('USA')!.regions.Nevada).toBeUndefined();
  });

  it('name the sources the lookups cite, with a licence', () => {
    expect(Object.keys(built.sources).sort()).toEqual(['ecocrop', 'faostat-qcl', 'spam-harvested-area']);
    expect(built.sources['faostat-qcl']).toMatchObject({ licence: expect.stringContaining('CC BY 4.0'), accessed: '2026-11-15' });
    expect(built.sources['spam-harvested-area'].licence).toContain('CC BY 4.0');
  });
});

describe('the files under public/rag/tables', () => {
  const files = walk(TABLES_DIR);
  const size = (rel: string) => fs.statSync(path.join(TABLES_DIR, rel)).size;

  it('are the tables, file for file', () => {
    expect(files.filter((f) => f.startsWith('crop/'))).toHaveLength(built.crop.size);
    expect(files.filter((f) => f.startsWith('region/'))).toHaveLength(built.region.size);
    expect(files.filter((f) => !f.includes('/')).sort()).toEqual(['countries.json', 'crops.json', 'sources.json', 'spam.json']);
    const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(TABLES_DIR, rel), 'utf8')) as unknown;
    expect(read('crops.json')).toEqual(built.crops);
    expect(read('crop/oryza-sativa.json')).toEqual(built.crop.get('oryza-sativa'));
    expect(read('region/VNM.json')).toEqual(built.region.get('VNM'));
    expect(read('spam.json')).toEqual(built.spam);
  });

  it('none is larger than 150 kB', () => {
    const largest = files.map((f) => [f, size(f)] as const).sort((a, b) => b[1] - a[1])[0];
    expect(largest[1], largest[0]).toBeLessThan(150 * 1024);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rag/manifest.json'), 'utf8')) as { tables: { files: number; bytes: number; largest: string; largestBytes: number } };
    expect(manifest.tables.files).toBe(files.length);
    expect(manifest.tables.bytes).toBe(files.reduce((a, f) => a + size(f), 0));
    expect([manifest.tables.largest, manifest.tables.largestBytes]).toEqual([largest[0], largest[1]]);
  });

  it('are read through a table source, which keeps what it has read and says null for what is not there', async () => {
    let reads = 0;
    const reader = fileReader(path.join(ROOT, 'public'));
    const tables = tableSource((rel) => {
      reads++;
      return reader(rel);
    });
    expect((await tables.crop('oryza-sativa'))!.cropId).toBe('oryza-sativa');
    expect((await tables.crop('oryza-sativa'))!.rows.length).toBeGreaterThan(100);
    expect(reads).toBe(1);
    expect(await tables.crop('durio-zibethinus')).toBeNull();
    expect(await tables.regions('XXX')).toBeNull();
    expect((await tables.country('vnm'))!.iso3).toBe('VNM');
    // An id that is not one is not turned into a path.
    expect(await tables.crop('../../package')).toBeNull();
    expect(await reader('../package.json')).toBeNull();
  });
});
