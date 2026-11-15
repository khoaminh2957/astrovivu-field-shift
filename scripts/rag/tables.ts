/**
 * The tables of the crop atlas the assistant looks numbers up in, as small JSON files under
 * `public/rag/tables/` (src/rag/tables.ts reads them, src/rag/lookups.ts answers from them):
 *
 *   crops.json           the 387 crops: names, match, FAOSTAT item; and each item with its crops
 *   countries.json       the 198 countries: ISO3 -> name as FAOSTAT writes it
 *   crop/<crop_id>.json  the countries that report the crop (crops with an item of their own)
 *   region/<ISO3>.json   MapSPAM harvested area by first-level region of the country
 *   spam.json            the 46 SPAM crops: name, class, the crops of ours tied to each
 *   sources.json         title, publisher, licence, landing page and day of access of the sources
 *   national.json        for each row of national statistics: publication, address, table, licence
 *   row-items.json       the FAOSTAT items of the rows whose items are not the crop's own item
 *
 * The crops of one country are not written here: `public/data/crops/country/<ISO3>.json`
 * (scripts/crops/country-tables.ts) already holds the same rows, and the assistant reads those.
 *
 * Nothing is computed: every value is a cell of data/crops/atlas/*.csv. The files carry no date,
 * so a second run writes the same bytes. Run by `npm run rag:build`, or on its own:
 *   npx tsx scripts/rag/tables.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import type { CountriesTable, CropCountriesFile, CropsTable, NationalTable, RegionFile, RowItemsTable, SourcesTable, SpamTable } from '../../src/rag/tables';
import { ATLAS_DIR } from './atlas';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const TABLES_DIR = path.join(ROOT, 'public/rag/tables');

type Row = Record<string, string>;
const read = (name: string): Row[] => Papa.parse<Row>(fs.readFileSync(path.join(ATLAS_DIR, name), 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
const num = (s: string | undefined): number | null => (s == null || s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

/** The sources the lookups cite, by the id of data/crops/atlas/sources.csv. */
const CITED = ['faostat-qcl', 'spam-harvested-area', 'ecocrop'];

export interface BuiltTables {
  crops: CropsTable;
  countries: CountriesTable;
  crop: Map<string, CropCountriesFile>;
  region: Map<string, RegionFile>;
  spam: SpamTable;
  sources: SourcesTable;
  national: NationalTable;
  rowItems: RowItemsTable;
}

/** The hand-read national statistics behind the atlas's `match = national` rows (data/crops/national, read-only here). */
const NATIONAL_CSV = path.join(ROOT, 'data/crops/national/prevalence.csv');

export function buildTables(): BuiltTables {
  const cropRows = read('crops.csv');
  const itemNames: Record<string, string> = {};
  for (const r of read('items.csv')) itemNames[r.faostat_item_code] = r.faostat_item;
  const crops: CropsTable = { crops: {}, items: {}, itemNames };
  for (const r of cropRows) {
    const item = r.faostat_item_code || null;
    const eco = num(r.ecocrop_id);
    const otherItems = (r.faostat_other_item_codes ?? '').split(';').filter(Boolean);
    crops.crops[r.crop_id] = { sci: r.scientific_name.trim(), ...(r.name_en ? { en: r.name_en } : {}), ...(r.name_vi ? { vi: r.name_vi } : {}), match: r.match as 'exact' | 'group' | 'none', ...(item ? { item } : {}), ...(otherItems.length && r.match === 'exact' ? { otherItems } : {}), ...(eco != null ? { eco } : {}) };
    if (item && r.match !== 'none') {
      const entry = (crops.items[item] ??= { name: r.faostat_item, crops: [] });
      entry.crops.push(r.crop_id);
    }
  }

  const countries: CountriesTable = {};
  const crop = new Map<string, CropCountriesFile>();
  const rowItems: RowItemsTable = {};
  for (const r of read('crop_country.csv')) {
    countries[r.iso3] ??= r.country;
    // A crop counted inside a group item has no row of its own: its file would hold the group's numbers.
    if (r.match !== 'exact' || !['major', 'common', 'minor', 'present'].includes(r.level)) continue;
    // The items of the row as the atlas writes them; kept where they are not the crop's own item.
    const own = crops.crops[r.crop_id]?.item;
    const codes = r.faostat_item_code.split(';').filter(Boolean);
    for (const c of codes) if (!itemNames[c]) throw new Error(`crop_country.csv: ${r.crop_id} ${r.iso3} has the item ${c}, which items.csv does not name`);
    const other = codes.length !== 1 || codes[0] !== own;
    if (other) rowItems[`${r.crop_id}:${r.iso3}`] = codes;
    const file = crop.get(r.crop_id) ?? { cropId: r.crop_id, item: own ?? codes[0], source: 'faostat-qcl', rows: [] };
    file.rows.push({ iso3: r.iso3, areaHa: num(r.area_ha), productionT: num(r.production_t), level: r.level as CropCountriesFile['rows'][number]['level'], years: [Number(r.year_from), Number(r.year_to)], ...(other ? { items: codes } : {}) });
    crop.set(r.crop_id, file);
  }
  // Largest harvested area first; countries with production and no area last, by production.
  for (const f of crop.values()) f.rows.sort((a, b) => (b.areaHa ?? -1) - (a.areaHa ?? -1) || (b.productionT ?? 0) - (a.productionT ?? 0) || a.iso3.localeCompare(b.iso3));

  // What a SPAM crop is (name, class, crops of ours) is the same in every region: it is written once.
  const region = new Map<string, RegionFile>();
  const spam: SpamTable = {};
  for (const r of read('region_crops.csv')) {
    const entry = { name: r.spam_crop_name, residual: r.spam_class === 'residual', crops: r.crop_ids ? r.crop_ids.split(';') : [] };
    const known = spam[r.spam_crop];
    if (known && JSON.stringify(known) !== JSON.stringify(entry)) throw new Error(`region_crops.csv: SPAM crop ${r.spam_crop} is described in two ways`);
    spam[r.spam_crop] = entry;
    if (r.level !== 'admin1' || !r.admin1) continue;
    const file = region.get(r.iso3) ?? { iso3: r.iso3, source: 'spam-harvested-area', regions: {} };
    (file.regions[r.admin1] ??= []).push([r.spam_crop, Number(r.harvested_area_ha), num(r.share_of_region_pct), Number(r.rank_in_region)]);
    region.set(r.iso3, file);
  }
  for (const f of region.values()) for (const rows of Object.values(f.regions)) rows.sort((a, b) => a[3] - b[3]);

  const sources: SourcesTable = {};
  for (const r of read('sources.csv')) if (CITED.includes(r.source)) sources[r.source] = { title: r.title, publisher: r.publisher, url: r.landing_page || r.url, licence: r.licence, ...(r.accessed ? { accessed: r.accessed } : {}) };
  for (const id of CITED) if (!sources[id]) throw new Error(`sources.csv has no source "${id}"`);

  // A row of national statistics is cited by its publication: where it is and under which terms
  // is in prevalence.csv (address, table, day read) and in sources.csv (terms, by the same address).
  const national: NationalTable = {};
  const read1 = Papa.parse<Row>(fs.readFileSync(NATIONAL_CSV, 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
  const terms = new Map(read('sources.csv').filter((r) => r.source.startsWith('national-')).map((r) => [r.url, r.licence]));
  for (const r of read('crop_country.csv')) {
    if (r.match !== 'national') continue;
    const from = read1.find((x) => x.crop_id === r.crop_id && x.iso3 === r.iso3 && x.source.trim() === r.source.trim()) ?? read1.find((x) => x.crop_id === r.crop_id && x.iso3 === r.iso3);
    if (!from) throw new Error(`crop_country.csv: ${r.crop_id} ${r.iso3} is from national statistics, and data/crops/national/prevalence.csv has no such row`);
    const licence = terms.get(from.url);
    if (!licence) throw new Error(`sources.csv has no national source at ${from.url} (${r.crop_id} ${r.iso3}): its terms are not known`);
    national[`${r.crop_id}:${r.iso3}`] = { source: r.source.trim(), url: from.url, licence, ...(from.accessed ? { accessed: from.accessed } : {}), ...(from.table ? { table: from.table } : {}) };
  }

  return { crops, countries, crop, region, spam, sources, national, rowItems };
}

/** Writes the files; returns their sizes in bytes, by path under public/rag/tables. */
export function writeTables(dir = TABLES_DIR): Map<string, number> {
  const t = buildTables();
  const sizes = new Map<string, number>();
  fs.rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, data: unknown) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const s = JSON.stringify(data);
    fs.writeFileSync(file, s);
    sizes.set(rel, Buffer.byteLength(s));
  };
  write('crops.json', t.crops);
  write('countries.json', t.countries);
  write('sources.json', t.sources);
  write('spam.json', t.spam);
  write('national.json', t.national);
  write('row-items.json', t.rowItems);
  for (const [id, f] of [...t.crop].sort(([a], [b]) => a.localeCompare(b))) write(`crop/${id}.json`, f);
  for (const [iso3, f] of [...t.region].sort(([a], [b]) => a.localeCompare(b))) write(`region/${iso3}.json`, f);
  return sizes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const sizes = writeTables();
  const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
  const group = (prefix: string) => [...sizes].filter(([k]) => k.startsWith(prefix));
  const total = (xs: [string, number][]) => xs.reduce((a, [, n]) => a + n, 0);
  for (const f of ['crops.json', 'countries.json', 'sources.json', 'spam.json', 'national.json', 'row-items.json']) console.log(`${f}: ${kb(sizes.get(f)!)}`);
  for (const p of ['crop/', 'region/']) {
    const xs = group(p);
    const largest = xs.reduce((a, b) => (b[1] > a[1] ? b : a));
    console.log(`${p}: ${xs.length} files, ${kb(total(xs))} in all, largest ${largest[0]} ${kb(largest[1])}`);
  }
  console.log(`all: ${sizes.size} files, ${kb(total([...sizes]))}`);
}
