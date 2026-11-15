/**
 * The tables of the crop atlas the assistant looks numbers up in (public/rag/tables, written by
 * scripts/rag/tables.ts; the crops of one country are `public/data/crops/country/<ISO3>.json`,
 * the file the app loads for the model). A `TableSource` loads a table on demand and keeps it;
 * the lookups of `lookups.ts` take the loaded tables and do no loading themselves.
 */
import type { CountryTableFile } from '@/data/countryTable';

/** One crop of the atlas: its names, how FAOSTAT covers it, and the FAOSTAT item it is tied to. */
export interface CropEntry {
  sci: string;
  en?: string;
  vi?: string;
  /** `exact`: an item of its own. `group`: counted inside an item of several crops. `none`: no item. */
  match: 'exact' | 'group' | 'none';
  /** FAOSTAT item code. */
  item?: string;
  /**
   * The crop's other FAOSTAT items (dry and green peas; maize grain and green corn): a country's
   * figures are the sum of the crop's items it reports (docs/CROP_DATA.md, section 7).
   */
  otherItems?: string[];
  /** FAO EcoCrop record, when the crop has one: its species page is `ecocrop.apps.fao.org/ecocrop/srv/en/cropView?id=<eco>`. */
  eco?: number;
}

export interface CropsTable {
  crops: Record<string, CropEntry>;
  /**
   * FAOSTAT item code -> its name and every crop of the atlas tied to it. An item can hold both
   * kinds: "Rice" is the item of three rice crops (`exact`: one set of numbers for the three) and
   * also counts African rice (`group`: no number of its own). Each crop's own `match` says which.
   */
  items: Record<string, { name: string; crops: string[] }>;
  /**
   * The name of every FAOSTAT item of the atlas (data/crops/atlas/items.csv), also of those that
   * are no crop's own item: a country's row can be of another item than the crop's ("Bananas"
   * for Musa sapientum, whose own item is "Plantains and cooking bananas").
   */
  itemNames: Record<string, string>;
}

/** ISO 3166-1 alpha-3 -> name as FAOSTAT writes it. */
export type CountriesTable = Record<string, string>;

/** The countries that report a crop, largest harvested area first. Only for crops with an item of their own. */
export interface CropCountriesFile {
  cropId: string;
  item: string;
  /** Key of `SourcesTable`. */
  source: string;
  rows: {
    iso3: string;
    areaHa: number | null;
    productionT: number | null;
    level: 'major' | 'common' | 'minor' | 'present';
    years: [from: number, to: number];
    /**
     * The FAOSTAT items the row's figures are of, when they are not `item` alone: another item
     * (melons in the United States are "Cantaloupes and other melons"), or the sum of several
     * ("Maize (corn)" and "Green corn (maize)"). As `crop_country.csv` writes them.
     */
    items?: string[];
  }[];
}

/**
 * The FAOSTAT items of a crop's row in a country, `<crop_id>:<ISO3>` -> item codes, for the rows
 * whose items are not the crop's own item (835 of 11,399 rows): the country files do not carry them.
 */
export type RowItemsTable = Record<string, string[]>;

/** The SPAM crops: code -> name, whether it is a class of several crops, and the crops of ours tied to it. */
export type SpamTable = Record<string, { name: string; /** A class such as "Other Vegetables": no crop of ours is tied to it. */ residual: boolean; crops: string[] }>;

/** One SPAM crop in one region: code, harvested area in hectares, share of the region's area in percent, rank in the region. */
export type RegionRow = [spam: string, areaHa: number, sharePct: number | null, rank: number];

/** MapSPAM harvested area by first-level region of one country: a model estimate, per SPAM crop. */
export interface RegionFile {
  iso3: string;
  source: string;
  /** Region name as MapSPAM writes it -> its SPAM crops by rank. */
  regions: Record<string, RegionRow[]>;
}

export interface SourceEntry {
  title: string;
  publisher: string;
  url: string;
  licence: string;
  /** Day the source was read, where the atlas records one. */
  accessed?: string;
}
export type SourcesTable = Record<string, SourceEntry>;

/**
 * What is needed to cite a row of national statistics (`match = national` in the atlas): the
 * publication as the atlas names it, where it is, the table read, the day it was read and its
 * terms. Keyed `<crop_id>:<ISO3>`. The figures themselves are in the country's file.
 */
export type NationalTable = Record<string, { source: string; url: string; licence: string; accessed?: string; table?: string }>;

/** Loads the tables. Every method resolves to null when the table does not exist (a crop without an item, a country without regions). */
export interface TableSource {
  crops(): Promise<CropsTable>;
  countries(): Promise<CountriesTable>;
  sources(): Promise<SourcesTable>;
  spam(): Promise<SpamTable>;
  national(): Promise<NationalTable>;
  rowItems(): Promise<RowItemsTable>;
  country(iso3: string): Promise<CountryTableFile | null>;
  crop(cropId: string): Promise<CropCountriesFile | null>;
  regions(iso3: string): Promise<RegionFile | null>;
}

/** How one file is read: `null` when it is not there. The browser fetches, the server reads the disk. */
export type TableReader = (relativePath: string) => Promise<unknown | null>;

/** A table source over a reader, with each table read once. `tables` is the folder of the tables, `countries` the folder of the country files. */
export function tableSource(read: TableReader, paths = { tables: 'rag/tables/', countries: 'data/crops/country/' }): TableSource {
  const kept = new Map<string, Promise<unknown | null>>();
  const once = <T>(rel: string): Promise<T | null> => {
    let p = kept.get(rel);
    if (!p) {
      p = read(rel).catch((e) => {
        // A failed read is tried again next time.
        kept.delete(rel);
        throw e;
      });
      kept.set(rel, p);
    }
    return p as Promise<T | null>;
  };
  const must = async <T>(rel: string): Promise<T> => {
    const v = await once<T>(rel);
    if (v == null) throw new Error(`${rel} is missing: run \`npm run rag:build\``);
    return v;
  };
  // Ids go into a path: only the characters of a crop id or a country code are let through.
  const safe = (id: string) => /^[A-Za-z0-9-]+$/.test(id);
  return {
    crops: () => must<CropsTable>(`${paths.tables}crops.json`),
    countries: () => must<CountriesTable>(`${paths.tables}countries.json`),
    sources: () => must<SourcesTable>(`${paths.tables}sources.json`),
    spam: () => must<SpamTable>(`${paths.tables}spam.json`),
    national: () => must<NationalTable>(`${paths.tables}national.json`),
    rowItems: () => must<RowItemsTable>(`${paths.tables}row-items.json`),
    country: (iso3) => (safe(iso3) ? once<CountryTableFile>(`${paths.countries}${iso3.toUpperCase()}.json`) : Promise.resolve(null)),
    crop: (cropId) => (safe(cropId) ? once<CropCountriesFile>(`${paths.tables}crop/${cropId}.json`) : Promise.resolve(null)),
    regions: (iso3) => (safe(iso3) ? once<RegionFile>(`${paths.tables}region/${iso3.toUpperCase()}.json`) : Promise.resolve(null)),
  };
}

/** Browser reader: `fetch` under the app's base path; a 404 is "not there". */
export const fetchReader: TableReader = async (rel) => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const res = await fetch(`${base}${rel}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  // A static host that answers an unknown path with its index page: not a table.
  if (!res.headers.get('content-type')?.includes('json')) return null;
  return (await res.json()) as unknown;
};
