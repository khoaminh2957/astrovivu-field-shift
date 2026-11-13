/**
 * Reference economics by region. These are REFERENCE values (official statistics, university
 * enterprise budgets, or press reports where nothing better exists), never the farmer's own
 * numbers: every record says where each figure comes from and how good the source is.
 */

/** VN = Vietnam; US = United States; US-HEARTLAND = Corn Belt (Iowa); US-WEST = irrigated Intermountain West (Nevada). */
export type EconRegion = 'VN' | 'US' | 'US-HEARTLAND' | 'US-WEST';

/**
 * official = statistics agency (FAOSTAT, USDA NASS, USDA ERS);
 * budget   = university or government enterprise budget;
 * press    = newspaper or extension article quoting a farm or a demonstration model;
 * derived  = computed from two published statements, not a published figure itself;
 * none     = no source found: the value is null and nothing is assumed.
 */
export type SourceQuality = 'official' | 'budget' | 'press' | 'derived' | 'none';

export interface ReferenceEconomics {
  region: EconRegion;
  /** What the yield refers to, e.g. `Viet Nam, national average (paddy)`. */
  yieldRegion: string;
  /** t/ha of the marketed product. 0 for cover crops, which are not harvested. */
  refYieldTHa: number | null;
  /** Farm-gate price, USD per tonne of the marketed product. */
  priceUsdPerT: number | null;
  /**
   * Operating (variable) cost, USD/ha per season: inputs, hired work, machinery running costs.
   * Land, family labour and overhead are excluded because they do not change with the crop choice.
   */
  costUsdPerHa: number | null;
  /** Year of the most recent figure; each source line carries its own year. */
  year: number;
  quality: { yield: SourceQuality; price: SourceQuality; cost: SourceQuality };
  sources: string[];
}

export type ReferenceTable = Record<string, Partial<Record<EconRegion, ReferenceEconomics>>>;
