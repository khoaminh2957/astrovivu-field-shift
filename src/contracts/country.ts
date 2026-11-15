/**
 * What a country knows about a crop: how much of it is grown there, and what it yields, sells for
 * and costs there. Shapes only. The data is the crop atlas (data/crops/atlas/, docs/CROP_DATA.md);
 * the crop-data scripts build it into what the app loads, the model reads it through `ModelInput`.
 *
 * One rule for every field of this file: **a missing value means "not known"**. It never means
 * zero, and it never means "not grown". The only way to say a country does not grow a crop is
 * `level: 'absent'`, and even that is a statement about a statistical source (see below).
 */
import type { ISODate } from './common';

/**
 * ISO 3166-1 alpha-3 country code in capitals: "VNM", "USA". The key of every country table,
 * because it is the key of the crop atlas. A geocoder gives the two-letter code
 * (`PlaceInfo.countryCode`); `PlaceInfo.iso3` carries this one once the place is resolved.
 */
export type Iso3 = string;

/**
 * How much of a crop a country grows. The first four come from reported quantities:
 * `major` at least 5 % of the country's harvested area, `common` at least 0.5 %, `minor` below,
 * `present` production reported without an area (thresholds: docs/CROP_DATA.md, section 7).
 *
 * `absent`: the source covers the country and reports nothing above zero for the crop. A country
 * can grow a crop its statistics do not itemise, so this is weaker than "not grown".
 *
 * `unknown`: the source cannot tell. The crop is counted inside a group ("Other vegetables") or
 * no statistic names it. A crop without any record is to be read as `unknown` too.
 */
export type PrevalenceLevel = 'major' | 'common' | 'minor' | 'present' | 'absent' | 'unknown';

/**
 * How the crop is tied to the numbers behind its level. `exact`: a FAOSTAT item that is this
 * species or names only its genus. `group`: an item that covers more than this crop; the level is
 * then `unknown`. `national`: a national statistic, used where FAOSTAT has only a group.
 */
export type PrevalenceMatch = 'exact' | 'group' | 'national';

/** One crop in one country. */
export interface CropPrevalence {
  level: PrevalenceLevel;
  match: PrevalenceMatch;
  /** Share of the country's harvested area, in percent (0-100). Present for major, common and minor only. */
  sharePct?: number;
  /** Place of the crop among the crop items of the country by harvested area, 1 = largest. */
  rankInCountry?: number;
  /** Harvested area in hectares and production in tonnes, means over `years`. */
  areaHa?: number;
  productionT?: number;
  /** First and last year of the mean the level rests on. */
  years?: [from: number, to: number];
  /** For `group`: true when the country reports the group item at all. Says nothing about the species. */
  itemReported?: boolean;
  /** Where the record comes from: "FAOSTAT QCL", or the national statistic. */
  source: string;
}

/**
 * How good the source of a figure is: `official` a statistics agency (FAOSTAT, USDA NASS, a
 * national statistics office), `budget` a university or government enterprise budget, `press` a
 * newspaper or extension article, `derived` computed from two published statements, `none` no
 * source found. The vocabulary `src/core/economics` already uses.
 */
export type SourceQuality = 'official' | 'budget' | 'press' | 'derived' | 'none';

/** One published number, with what is needed to check it. A figure without a source is left out, not written as 0 or as `none`. */
export interface SourcedFigure {
  value: number;
  /** Year the figure refers to (not the year it was read). */
  year: number;
  quality: Exclude<SourceQuality, 'none'>;
  /** Publisher, title and table or page. */
  source: string;
  url?: string;
  /** Day the source was read. */
  accessed?: ISODate;
}

/**
 * Yield, farm-gate price and operating cost of one crop in one country, or in one region of it.
 * Each figure stands alone: a row may have a yield from a statistics office, a price from the
 * press and no cost. A missing figure means no source was found; nothing is to be put in its place.
 */
export interface CountryEconomics {
  /** Part of the country the figures refer to ("Iowa", "Central Highlands"). Absent: the whole country. */
  region?: string;
  /** Marketed product the figures refer to ("paddy", "green bean", "dry grain"). */
  product?: string;
  /** Tonnes per hectare of the marketed product. */
  yieldTHa?: SourcedFigure;
  /** Farm-gate price, USD per tonne of the marketed product. */
  priceUsdPerT?: SourcedFigure;
  /** Operating cost, USD per hectare and season: inputs, hired work, machinery running costs. Land, family labour and overhead are not in it. */
  costUsdPerHa?: SourcedFigure;
}

/**
 * What is known about the crops of one country, keyed by crop id. This is what the model receives
 * for the country of the parcel (`ModelInput.country`), so that `src/core` stays free of fetches.
 * A crop id that is missing from `prevalence` has level `unknown`; one missing from `economics`
 * has no country figures, and the reference table of `src/core/economics` applies as before.
 */
export interface CountryCrops {
  iso3: Iso3;
  prevalence: Record<string, CropPrevalence>;
  /** Several records for one crop when regions differ; the whole-country record has no `region`. */
  economics?: Record<string, CountryEconomics[]>;
}
