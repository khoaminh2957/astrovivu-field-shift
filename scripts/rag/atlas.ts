/**
 * The crop atlas (data/crops/atlas, docs/CROP_DATA.md) as the assistant's index build reads it:
 * which crops are kept, what is known about where each is grown, and which EcoCrop species were
 * dropped and why. Read-only: nothing here writes into data/crops/.
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import type { CropWhere } from '../../src/rag/types';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const ATLAS_DIR = path.join(ROOT, 'data/crops/atlas');

/** Where the country figures come from: FAOSTAT crops and livestock products, through the atlas. */
export const FAOSTAT_SOURCE = {
  name: 'FAOSTAT crops and livestock products (QCL), via the Astrovivu crop atlas',
  url: 'https://www.fao.org/faostat/en/#data/QCL',
  license: 'CC BY 4.0, © FAO',
};

type Row = Record<string, string>;

function readCsv(name: string): Row[] {
  const csv = fs.readFileSync(path.join(ATLAS_DIR, name), 'utf8').replace(/^\uFEFF/, '');
  return Papa.parse<Row>(csv, { header: true, skipEmptyLines: true }).data;
}

const num = (s: string | undefined): number | undefined => (s == null || s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));
const text = (s: string | undefined): string | undefined => (s == null || s.trim() === '' ? undefined : s.trim());

export interface AtlasCrop {
  cropId: string;
  /** Empty for a crop the atlas keeps that EcoCrop has no record of. */
  ecocropId: number | null;
  sci: string;
  nameEn?: string;
  nameVi?: string;
  match: CropWhere['match'];
  /** The row of crops.csv, for the columns a fact sheet is built from when there is no EcoCrop row. */
  row: Row;
}

let cropsCache: AtlasCrop[] | null = null;

/** The crops the atlas keeps: one per row of crops.csv. */
export function readAtlasCrops(): AtlasCrop[] {
  cropsCache ??= readCsv('crops.csv').map((r) => {
    const match = r.match;
    if (match !== 'exact' && match !== 'group' && match !== 'none') throw new Error(`crops.csv: ${r.crop_id} has match "${match}"`);
    return { cropId: r.crop_id, ecocropId: num(r.ecocrop_id) ?? null, sci: r.scientific_name.trim(), nameEn: text(r.name_en), nameVi: text(r.name_vi), match, row: r };
  });
  return cropsCache;
}

export type DropReason = 'no-item' | 'group-only';

/** The two reasons dropped.csv gives, word for word, and the short form the assistant stores. */
export const DROP_REASONS: Record<string, DropReason> = {
  'no FAOSTAT crop item names it (scientific or common name)': 'no-item',
  'named only in a group item and EcoCrop does not describe it as grown on a large or small scale': 'group-only',
};

export interface DroppedSpecies {
  id: string;
  sci: string;
  commonNames: string[];
  reason: DropReason;
}

/** EcoCrop species the atlas does not keep, with the reason of dropped.csv. An unknown reason stops the build. */
export function readDropped(): DroppedSpecies[] {
  return readCsv('dropped.csv').map((r) => {
    const reason = DROP_REASONS[r.reason];
    if (!reason) throw new Error(`dropped.csv: ${r.crop_id} has a reason the assistant has no wording for: "${r.reason}"`);
    return { id: r.crop_id, sci: r.scientific_name.trim(), commonNames: (r.common_names ?? '').split(/,\s*/).map((n) => n.trim()).filter((n) => n.length > 1), reason };
  });
}

export interface CountryArea {
  iso3: string;
  /** As FAOSTAT names the country. */
  name: string;
  areaHa: number;
  level: string;
  /** Place among the countries that report an area of the crop, 1 = largest. */
  rank: number;
}

let byCrop: Map<string, CountryArea[]> | null = null;

/** Countries that report a harvested area of the crop, largest first. Empty for group and unmatched crops. */
export function countriesOf(cropId: string): CountryArea[] {
  if (!byCrop) {
    byCrop = new Map();
    for (const r of readCsv('crop_country.csv')) {
      const areaHa = num(r.area_ha);
      if (areaHa == null || areaHa <= 0 || r.match !== 'exact') continue;
      const list = byCrop.get(r.crop_id) ?? [];
      list.push({ iso3: r.iso3, name: r.country, areaHa, level: r.level, rank: 0 });
      byCrop.set(r.crop_id, list);
    }
    for (const list of byCrop.values()) {
      list.sort((a, b) => b.areaHa - a.areaHa || a.iso3.localeCompare(b.iso3));
      list.forEach((c, i) => (c.rank = i + 1));
    }
  }
  return byCrop.get(cropId) ?? [];
}

export function topCountries(cropId: string, n: number): CountryArea[] {
  return countriesOf(cropId).slice(0, n);
}

/** The countries of the app's demo fields and reference economics: named in a sheet even when they are not among the largest. */
export const HOME_COUNTRIES = ['VNM', 'USA'];

/** What the atlas knows about where a crop is grown, in the shape a fact sheet is rendered from. */
export function whereOf(crop: AtlasCrop): CropWhere {
  const r = crop.row;
  const where: CropWhere = { match: crop.match };
  if (crop.match === 'none') return where;
  where.faostatItem = text(r.faostat_item);
  where.sharedBy = num(r.item_shared_by_n_crops);
  if (crop.match === 'group') return where;
  where.countries = num(r.n_countries_producing);
  where.worldAreaHa = num(r.world_area_ha);
  where.commonness = text(r.commonness);
  where.years = text(r.data_years);
  const top = topCountries(crop.cropId, 5);
  const pick = (c: CountryArea) => ({ iso3: c.iso3, name: c.name, areaHa: c.areaHa, level: c.level, rank: c.rank });
  if (top.length) where.top = top.map(pick);
  const also = countriesOf(crop.cropId).filter((c) => HOME_COUNTRIES.includes(c.iso3) && !top.some((t) => t.iso3 === c.iso3));
  if (also.length) where.also = also.map(pick);
  return where;
}
