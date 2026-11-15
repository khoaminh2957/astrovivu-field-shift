/**
 * The crop atlas (data/crops/atlas/, built by scripts/crops/atlas/build.ts, described in
 * docs/CROP_DATA.md and column by column in data/crops/atlas/columns.csv) as rows for the
 * database. Three of its tables are mirrored column for column: crops, items and crop_country.
 *
 * Nothing is cleaned or corrected here. The atlas build did that and wrote what it dropped to
 * `crops.ecocrop_cleaning`. This module gives each column the type its name declares, turns an
 * empty cell into null, and derives the crop-to-item link from two columns of `crops`.
 */
import { readFileSync } from 'node:fs';
import { parseCsv } from '../crops/atlas/csv';

export const ATLAS_DIR = 'data/crops/atlas';

/** The mirrored tables: their file and the columns that identify a row. */
export const TABLES = {
  crops: { file: 'crops.csv', key: ['crop_id'] },
  items: { file: 'items.csv', key: ['faostat_item_code'] },
  crop_country: { file: 'crop_country.csv', key: ['crop_id', 'iso3'] },
} as const;
export type AtlasTable = keyof typeof TABLES;

export type Kind = 'text' | 'integer' | 'numeric' | 'boolean';
export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;

const INTEGER = new Set(['ecocrop_id', 'cycle_min_days', 'cycle_max_days', 'item_shared_by_n_crops', 'n_crops', 'n_countries_producing', 'year_from', 'year_to', 'rank_in_country']);
/** Written "yes" or "no" in the atlas. */
const BOOLEAN = new Set(['curated', 'item_reported']);
/** A column whose name ends in a unit holds a quantity: temp_opt_min_c, area_ha, world_production_t. */
const QUANTITY = /^ph_|_(c|mm|deg|m|ha|t|pct)$/;

/** The type of a column, from its name. `supabase/migrations` declares the same types; a test compares the two. */
export function kindOf(table: AtlasTable, column: string): Kind {
  // One item code is a number; crop_country lists the items its quantities come from ("56;446").
  if (column === 'faostat_item_code') return table === 'crop_country' ? 'text' : 'integer';
  if (INTEGER.has(column)) return 'integer';
  if (BOOLEAN.has(column)) return 'boolean';
  return QUANTITY.test(column) ? 'numeric' : 'text';
}

function convert(kind: Kind, raw: string, where: () => string): Value {
  if (raw === '') return null;
  if (kind === 'text') return raw;
  if (kind === 'boolean') {
    if (raw === 'yes') return true;
    if (raw === 'no') return false;
    throw new Error(`${where()}: "${raw}" is neither yes nor no`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || (kind === 'integer' && !Number.isInteger(n))) throw new Error(`${where()}: "${raw}" is not ${kind === 'integer' ? 'a whole number' : 'a number'}`);
  return n;
}

/** Column names of a table, in file order. */
export function columnsOf(table: AtlasTable, dir = ATLAS_DIR): string[] {
  const text = readFileSync(`${dir}/${TABLES[table].file}`, 'utf8');
  const end = text.indexOf('\n');
  return parseCsv(end < 0 ? text : text.slice(0, end))[0] ?? [];
}

/** Every row of a table, typed. Stops at the first value that does not fit the type of its column. */
export function readTable(table: AtlasTable, dir = ATLAS_DIR): Row[] {
  const file = `${dir}/${TABLES[table].file}`;
  const [header, ...body] = parseCsv(readFileSync(file, 'utf8'));
  if (!header) throw new Error(`${file} is empty`);
  const kinds = header.map((column) => kindOf(table, column));
  const rows = body.map((cells, r) => {
    const row: Row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = convert(kinds[i], cells[i] ?? '', () => `${file}, row ${r + 2}, ${header[i]}`);
    return row;
  });
  const seen = new Set<string>();
  for (const row of rows) {
    const id = TABLES[table].key.map((k) => row[k]).join(' / ');
    if (seen.has(id)) throw new Error(`${file}: two rows for ${id}`);
    seen.add(id);
  }
  return rows;
}

export interface CropItem {
  crop_id: string;
  faostat_item_code: number;
  /** The item the atlas attaches the crop to; false for its other items (green corn beside maize grain). */
  is_primary: boolean;
}

/** One row per crop and FAOSTAT item, from `faostat_item_code` and `faostat_other_item_codes`. A crop with `match = none` has none. */
export function cropItems(crops: Row[]): CropItem[] {
  const out: CropItem[] = [];
  for (const crop of crops) {
    if (crop.faostat_item_code == null) continue;
    const crop_id = String(crop.crop_id);
    out.push({ crop_id, faostat_item_code: Number(crop.faostat_item_code), is_primary: true });
    for (const code of String(crop.faostat_other_item_codes ?? '').split(';').filter(Boolean)) {
      const n = Number(code);
      if (!Number.isInteger(n)) throw new Error(`${crop_id}: "${code}" in faostat_other_item_codes is not an item code`);
      out.push({ crop_id, faostat_item_code: n, is_primary: false });
    }
  }
  return out;
}

/** ISO 3166-1 alpha-3 code of every atlas country, by the name FAOSTAT gives it. */
export function countryCodes(cropCountry: Row[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of cropCountry) out.set(String(row.country), String(row.iso3));
  return out;
}

export interface Atlas {
  crops: Row[];
  items: Row[];
  cropCountry: Row[];
  cropItems: CropItem[];
}

export function readAtlas(dir = ATLAS_DIR): Atlas {
  const crops = readTable('crops', dir);
  return { crops, items: readTable('items', dir), cropCountry: readTable('crop_country', dir), cropItems: cropItems(crops) };
}
