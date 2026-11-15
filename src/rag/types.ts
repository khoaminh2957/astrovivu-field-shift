import type { AskRequest, KnowledgeChunk, ModelInput } from '@/contracts';
import type { AliasTable } from './aliases';

/** EcoCrop-style window with possibly missing ends: [absMin, optMin, optMax, absMax]. */
export type Range4 = [absMin: number | null, optMin: number | null, optMax: number | null, absMax: number | null];

/** One country in the list of where a crop is grown. */
export interface CropCountry {
  /** ISO 3166-1 alpha-3. */
  iso3: string;
  /** As FAOSTAT names the country. */
  name: string;
  /** Harvested area in hectares: the mean of this country's latest three years with a value, the years of `years`. */
  areaHa: number;
  /** The years that mean is of, "2022-2024": each country has its own. */
  years?: string;
  /** `major`, `common` or `minor` in that country (docs/CROP_DATA.md, section 7). */
  level: string;
  /** Place among the countries that report an area of the crop, 1 = largest. */
  rank: number;
}

/**
 * What the crop atlas knows about where a crop is grown (data/crops/atlas, FAOSTAT QCL).
 * `exact`: a FAOSTAT item is the crop, or names only its genus; the figures are that item's.
 * `group`: FAOSTAT counts the crop inside an item of several crops; no figure is the crop's own.
 * `none`: no FAOSTAT crop item covers it.
 */
/** What a country's own statistics say of a crop, where the atlas has such a row (`match = national` in crop_country.csv). */
export interface CropNational {
  iso3: string;
  name: string;
  areaHa: number;
  productionT?: number;
  /** The year, or years, of the figure. */
  years?: string;
  /** The publication, as the atlas names it. */
  source: string;
}

export interface CropWhere {
  match: 'exact' | 'group' | 'none';
  faostatItem?: string;
  /** Crops of the atlas tied to the same FAOSTAT item; above 1 the figures are shared. */
  sharedBy?: number;
  /** Countries that report production. */
  countries?: number;
  worldAreaHa?: number;
  /** The atlas's word for how widely the crop is grown: global, widespread, regional, local. */
  commonness?: string;
  /** The span that covers the years of every country's mean, "2021-2024". No figure is a mean of exactly this span. */
  years?: string;
  /** The five countries with the largest harvested area. */
  top?: CropCountry[];
  /** Viet Nam and the United States when they report the crop and are not among the five. */
  also?: CropCountry[];
  /**
   * Figures of national statistics, for the countries the atlas has them for (Viet Nam and the
   * United States). They are not FAOSTAT's and are not ranked among FAOSTAT's countries.
   */
  national?: CropNational[];
}

/** Structured requirements of one species, cleaned from FAO EcoCrop (see scripts/rag/ecocrop.ts). */
export interface CropFacts {
  id: string;
  sci: string;
  /** Absent for a crop the atlas keeps that EcoCrop has no record of. */
  ecocropId?: number;
  family?: string;
  /** English / Vietnamese display names: the curated ones, else the names of the crop atlas. */
  en?: string;
  vi?: string;
  /** A few common names as published by EcoCrop, for display. */
  names: string[];
  category?: string;
  lifeForm?: string;
  lifeSpan?: string;
  /** Mean temperature during the growing period, °C. */
  temp?: Range4;
  /** Annual rainfall, mm. */
  rain?: Range4;
  ph?: Range4;
  texture?: { opt?: string; abs?: string };
  drainage?: { opt?: string; abs?: string };
  depth?: { opt?: string; abs?: string };
  fertility?: { opt?: string; abs?: string };
  salinity?: { opt?: string; abs?: string };
  light?: { opt?: string; abs?: string };
  killTempEarly?: number | null;
  killTempRest?: number | null;
  /** Days from sowing to harvest. */
  cycle?: [number, number] | null;
  latAbs?: [number, number] | null;
  altAbsMax?: number | null;
  climate?: string;
  photoperiod?: string;
  uses?: string;
  usesMain?: string;
  companions?: string;
  curated: boolean;
  /** What the build changed while cleaning this row (wrong-scale values dropped, zero cycles). */
  cleaning?: string[];
  /** Where the crop is grown, from the crop atlas. */
  prevalence?: CropWhere;
}

/**
 * EcoCrop species the crop atlas does not keep (data/crops/atlas/dropped.csv), so that a question
 * about one is answered with "not in the data, and why" instead of with a look-alike.
 */
export interface DroppedTable {
  /** Folded name -> ids of the species it names. */
  aliases: Record<string, string[]>;
  /** id -> scientific name and the reason: `n` no FAOSTAT crop item names it; `g` named only in a group item and not described as cultivated. */
  species: Record<string, [sci: string, reason: 'n' | 'g']>;
}

/** Serialised MiniSearch index (`MiniSearch.toJSON()`), kept opaque here. */
export type SerializedIndex = Record<string, unknown>;

/**
 * One shipped artifact. `core` is fetched first (curated crops + glossary + concept articles);
 * `full` is fetched lazily and carries an index over ALL chunks (core included, so BM25 statistics
 * stay consistent when the search switches to it) plus only the chunks/crops/aliases not in core.
 */
export interface RagBundle {
  version: 1;
  kind: 'core' | 'full';
  builtAt: string;
  chunks: KnowledgeChunk[];
  crops: CropFacts[];
  aliases: AliasTable;
  index: SerializedIndex;
  /** In the `full` bundle only. */
  dropped?: DroppedTable;
}

/** Stored fields kept inside the MiniSearch index (used for boosting and filtering). */
export interface StoredFields {
  lang: string;
  kind: ChunkKind;
  cropIds: string;
  tags: string;
}

/** `where`: the sheet on where a crop is grown (crop atlas), beside its `facts` sheet of requirements. */
export type ChunkKind = 'facts' | 'where' | 'narrative' | 'wiki' | 'glossary' | 'concept';

/** Indexed document shape. */
export interface IndexDoc {
  id: string;
  title: string;
  names: string;
  tags: string;
  text: string;
  lang: string;
  kind: ChunkKind;
  cropIds: string;
}

export function chunkKind(c: KnowledgeChunk): ChunkKind {
  const k = c.tags?.find((t) => t.startsWith('kind:'));
  return (k?.slice(5) as ChunkKind | undefined) ?? 'narrative';
}

/**
 * A question as the API server takes it: `AskRequest`, and with it the locked field as the scoring
 * and rotation models read it. The lookups that need a field (suitability, rotations, pH plan,
 * price and margin) run on the server from this; without it they answer "no field is locked".
 * Kept here, beside the assistant, until the contract itself carries the field.
 */
export interface AssistantRequest extends AskRequest {
  field?: ModelInput;
}
