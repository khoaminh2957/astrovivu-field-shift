import type { I18nText, Quad } from './common';
import type { CropPrevalence, Iso3 } from './country';

export type TextureClass = 'heavy' | 'medium' | 'light' | 'organic';
export type DrainageClass = 'poor' | 'well' | 'excessive';
export type DepthClass = 'very-shallow' | 'shallow' | 'medium' | 'deep';
export type SalinityClass = 'none' | 'low' | 'medium' | 'high';
export type FertilityClass = 'low' | 'moderate' | 'high';
export type AlToxicityClass = 'none' | 'low' | 'medium' | 'high';

export type CropCategory =
  | 'cereal'
  | 'pulse'
  | 'oilseed'
  | 'root'
  | 'vegetable'
  | 'fruit'
  | 'forage'
  | 'cover'
  | 'industrial'
  | 'spice'
  | 'herb'
  | 'ornamental'
  | 'other';

/** Ecological requirements, mostly from FAO EcoCrop (opt = optimal, abs = tolerated). */
export interface CropRequirements {
  tempC: Quad;
  /** Rainfall over the growing cycle, mm (EcoCrop evaluates the season total, not the calendar year). */
  rainMm: Quad;
  ph: Quad;
  texture?: { opt: TextureClass[]; abs: TextureClass[] };
  depth?: { opt: DepthClass; abs: DepthClass };
  drainage?: { opt: DrainageClass[]; abs: DrainageClass[] };
  salinity?: { opt: SalinityClass; abs: SalinityClass };
  fertility?: { opt: FertilityClass; abs: FertilityClass };
  /** Aluminium saturation tolerance class from FAO EcoCrop (`eco_soil_al_tox_opt` / `eco_soil_al_tox_abs`). */
  alToxicity?: { opt: AlToxicityClass; abs: AlToxicityClass };
  /** Temperature that kills the plant in early growth, °C. */
  killTempC?: number | null;
  /** Temperature that kills the plant while it rests (winter dormancy), °C. Used for perennials. */
  killTempRestC?: number | null;
  altitudeMaxM?: number | null;
  /** Absolute latitude limits [south, north] in degrees, as published by EcoCrop. */
  latitudeAbs?: [number, number] | null;
  photoperiod?: string[];
  climateZones?: string[];
}

/** FAO-56 crop coefficients and stage lengths (fractions of the cycle), FAO-33 yield response Ky. */
export interface CropWaterModel {
  kc: { ini: number; mid: number; end: number };
  stages: [initial: number, development: number, mid: number, late: number];
  rootDepthM: number;
  /** Fraction of available water a crop can deplete before stress (FAO-56 `p`). */
  depletionFraction: number;
  ky?: number;
  source: string;
}

export interface CropEconomics {
  /** Attainable reference yield under good management, t/ha, with the region it applies to. */
  refYieldTHa: number;
  yieldRegion: string;
  priceUsdPerT: number;
  costUsdPerHa: number;
  year: number;
  sources: string[];
}

export interface CropRotationTraits {
  family: string;
  nitrogenFixing: boolean;
  residue: 'low' | 'medium' | 'high';
  rooting: 'shallow' | 'deep' | 'taproot' | 'fibrous';
  /** Crops sharing a pest group should not follow each other. */
  pestGroup: string;
  waterUse: 'low' | 'medium' | 'high';
  coverValue: 'low' | 'medium' | 'high';
}

export type UrbanHarvestType = 'cut-and-come-again' | 'once' | 'repeated-fruit';

export interface CropUrbanTraits {
  suitable: boolean;
  light: 'full' | 'partial' | 'shade';
  container: boolean;
  difficulty: 1 | 2 | 3;
  tags: string[];
  potDepthCm?: number;
  potVolumeL?: number;
  spacingCm?: number;
  sunHoursMin?: number;
  firstHarvestDays?: [ number, number ];
  harvestType?: UrbanHarvestType;
  needsTrellis?: boolean;
  sources?: string[];
}

export interface CropProfile {
  /** Slug of the scientific name, e.g. `coffea-canephora`. */
  id: string;
  ecocropId?: number;
  scientificName: string;
  names: { en: string; vi?: string; aliases?: string[] };
  category: CropCategory;
  lifeSpan: 'annual' | 'biennial' | 'perennial';
  req: CropRequirements;
  /** Days from sowing to harvest [shortest, longest]. */
  cycleDays: [min: number, max: number];
  water?: CropWaterModel;
  economics?: CropEconomics;
  /** Prevalence by country (ISO 3166-1 alpha-3), from the crop atlas (crop_country.csv). */
  prevalence?: Record<Iso3, CropPrevalence>;
  rotation?: CropRotationTraits;
  urban?: CropUrbanTraits;
  summary?: I18nText;
  /** True when agronomy and economics were hand-curated with sources (not only EcoCrop thresholds). */
  curated: boolean;
  /**
   * Data-quality flags set by the catalogue build, e.g. `cycle-assumed`, `ph-missing`,
   * `quad-repaired`, `not-in-ecocrop`, `water-model-assumed`. The scorer turns them into caveats.
   */
  flags?: string[];
}
