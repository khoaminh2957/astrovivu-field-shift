/**
 * On-disk form of the crop table of one country (`public/data/crops/country/<ISO3>.json`) and of
 * the index beside it. Written by `scripts/crops/country-tables.ts` from the crop atlas
 * (data/crops/atlas/crop_country.csv), read back here into `CountryCrops`.
 *
 * A country has some 370 crop records and most of them say one of two things: "the statistics
 * report nothing for this crop" or "this crop is counted inside a group". Those are stored as
 * lists of crop ids; only the crops with a reported quantity keep a full record. Nothing is lost:
 * `expandCountryTable` gives back every record of the atlas.
 */
import type { CountryCrops, CropPrevalence, Iso3 } from '@/contracts';

export interface CountryTableFile {
  iso3: Iso3;
  /** Name of the country as the source writes it. */
  country: string;
  /** Source of every record that does not name its own. */
  source: string;
  /** Crops with a reported quantity (major, common, minor, present), as the model reads them; also every row from a national source (match national), which is `unknown` when that source has no figure. */
  prevalence: Record<string, CropPrevalence>;
  /** Crops tied to an item of their own for which the country reports nothing above zero. */
  absent: string[];
  /** Crops counted inside a group item: the country reports that item, or it does not. Unknown either way. */
  group: { reported: string[]; unreported: string[] };
}

export interface CountryIndexEntry {
  iso3: Iso3;
  name: string;
  /** First characters of the SHA-1 of the country's file: a new file gets a new cache key. */
  hash: string;
  /** Number of crops with a reported quantity. */
  grown: number;
}

/** `public/data/crops/country/index.json`: the countries that have a table, by ISO 3166-1 alpha-2 code. */
export interface CountryIndexFile {
  source: string;
  /** First and last year any record rests on; each record carries its own period. */
  years: [from: number, to: number];
  countries: Record<string, CountryIndexEntry>;
}

/** The table as `ModelInput.country` takes it. */
export function expandCountryTable(file: CountryTableFile): CountryCrops {
  const prevalence: Record<string, CropPrevalence> = { ...file.prevalence };
  for (const id of file.absent) prevalence[id] = { level: 'absent', match: 'exact', itemReported: false, source: file.source };
  for (const id of file.group.reported) prevalence[id] = { level: 'unknown', match: 'group', itemReported: true, source: file.source };
  for (const id of file.group.unreported) prevalence[id] = { level: 'unknown', match: 'group', itemReported: false, source: file.source };
  return { iso3: file.iso3, prevalence };
}

/** Whether a parsed file has the shape above; a wrong answer from the server (an HTML page, say) does not. */
export function isCountryTableFile(v: unknown): v is CountryTableFile {
  const f = v as Partial<CountryTableFile> | null;
  return !!f && typeof f.iso3 === 'string' && typeof f.source === 'string' && typeof f.prevalence === 'object' && Array.isArray(f.absent) && Array.isArray(f.group?.reported) && Array.isArray(f.group?.unreported);
}
