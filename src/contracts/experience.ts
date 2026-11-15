import type { I18nText, ISODate, Lang } from './common';
import type { LngLat, PlaceInfo } from './geo';
import type { BranchId, Cadence, Sample } from './telemetry';

// ---------------------------------------------------------------------------------------------
// Map layers and the bridge between the globe and the HUD
// ---------------------------------------------------------------------------------------------

export type BaseLayerId = 'satellite' | 'terrain' | 'labels';
/** Time-enabled NASA GIBS rasters draped on the globe for regional context. */
export type OverlayId = 'none' | 'truecolor' | 'ndvi' | 'soilMoisture' | 'rain' | 'lst';

export interface LayerState {
  base: Record<BaseLayerId, boolean>;
  overlay: OverlayId;
  overlayOpacity: number;
  /** `Series.key` whose value at the cursor date colours the parcel fill (instant, no network). */
  parcelMetric: string | null;
  /** Colour scale of field pictures: the raster's fixed range, or stretched to this field's own values. */
  stretch?: 'fixed' | 'field';
}

export interface OverlayInfo {
  id: OverlayId;
  label: I18nText;
  gibsLayer: string | null;
  cadence: Cadence;
  sourceId: string;
  legend?: { min: number; max: number; unit: string };
}

/** Parcel footprint in CSS pixels, published by the globe so the HUD can attach leader lines. */
export interface ScreenAnchor {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

// ---------------------------------------------------------------------------------------------
// Long-term tracking (State 6). The page and its engine were removed on 2026-11-15 (docs/UX_PLAN.md, U9);
// the types stay because contracts are never removed.
// ---------------------------------------------------------------------------------------------

export interface JournalEntry {
  id: string;
  t: ISODate;
  kind: 'operation' | 'scouting' | 'note' | 'harvest' | 'soil-test' | 'alert';
  title: I18nText;
  body?: I18nText;
  simulated: boolean;
}

export interface SeasonRecord {
  id: string;
  label: I18nText;
  cropId: string;
  start: ISODate;
  end: ISODate;
  yieldTHa?: number;
  revenueUsd?: number;
  costUsd?: number;
  ndviPeak?: number;
  rainMm?: number;
  simulated: boolean;
}

export interface SoilTest {
  t: ISODate;
  lab: string;
  values: { key: string; label: I18nText; value: number; unit: string; rating: 'low' | 'optimal' | 'high' }[];
  simulated: boolean;
}

export interface AlertItem {
  id: string;
  t: ISODate;
  severity: 'info' | 'watch' | 'alert';
  title: I18nText;
  body: I18nText;
  branch?: BranchId;
}

export interface TrackingData {
  parcelId: string;
  /** True when any part of the history is simulated for the demo. */
  simulated: boolean;
  seasons: SeasonRecord[];
  journal: JournalEntry[];
  soilTests: SoilTest[];
  alerts: AlertItem[];
  planVsActual: { month: number; plannedCostUsd: number; actualCostUsd: number | null; plannedRevenueUsd: number; actualRevenueUsd: number | null }[];
  /** Vegetation curves of previous years, for season-over-season comparison. */
  ndviByYear: { year: number; samples: Sample[]; simulated: boolean }[];
}

// ---------------------------------------------------------------------------------------------
// Urban Grower Companion
// ---------------------------------------------------------------------------------------------

export type UrbanPreference = 'vegetables' | 'herbs' | 'flowers' | 'shade-easy' | 'fruit';

export interface UrbanSite {
  location: LngLat;
  place?: PlaceInfo;
  light: 'full' | 'partial' | 'shade';
  space: 'windowsill' | 'balcony' | 'rooftop' | 'yard';
  /** Circular container diameter in centimetres, used to compute daily pot water in litres (D6, #19). */
  potDiameterCm?: number;
}

export interface UrbanClimateMonth {
  month: number;
  tMean: number;
  tMin: number;
  tMax: number;
  rainMm: number;
  /** Monthly reference evapotranspiration total, mm/month (ERA5-Land via Open-Meteo when available). */
  et0Mm?: number | null;
  /** Photosynthetically active radiation, MJ/m²/day. */
  par: number | null;
  rh: number | null;
}

export interface UrbanClimate {
  location: LngLat;
  months: UrbanClimateMonth[];
  /** Conditions right now (air temperature, humidity, today's radiation), when available. */
  now?: { t: number | null; rh: number | null; par: number | null; observedAt: string };
  sourceIds: string[];
}

export interface UrbanRecommendation {
  cropId: string;
  name: I18nText;
  score: number;
  why: I18nText[];
  difficulty: 1 | 2 | 3;
  care: {
    water: I18nText;
    /** Daily irrigation range in litres per pot for each calendar month (min = initial stage Kc.ini, max = mid-season Kc.mid). */
    waterLitres?: { month: number; min: number; max: number }[];
    /** Provenance and assumptions behind `waterLitres` (pot diameter, ET0 source, FAO-56 row, proxy flag, rain caveat). */
    waterBasis?: I18nText;
    light: I18nText;
    sowMonths: number[];
    /**
     * Temperature suitability of sowing in each calendar month, January first, 0..1 (twelve values).
     * `sowMonths` are the months at or above the sowing threshold; this lets a calendar also show
     * the marginal months. Absent when the recommender did not compute it.
     */
    sowFit?: number[];
    harvestDays: [min: number, max: number];
    tips: I18nText[];
  };
  calendar: { month: number; tasks: I18nText[] }[];
}

// ---------------------------------------------------------------------------------------------
// Crop-knowledge RAG
// ---------------------------------------------------------------------------------------------

export interface KnowledgeChunk {
  id: string;
  docId: string;
  title: string;
  text: string;
  lang: Lang;
  source: { name: string; url: string; license: string };
  cropIds?: string[];
  tags?: string[];
}

/** Compact, serialisable summary of the locked parcel handed to the assistant as grounding. */
export interface FieldContext {
  parcelName: string;
  place?: string;
  location: LngLat;
  areaHa: number;
  cropId: string | null;
  date: ISODate;
  /** Flat facts, e.g. `{ ph: '5.6 (SoilGrids, 250 m)', rain_30d: '212 mm (IMERG)' }`. */
  facts: Record<string, string>;
  limitingFactor?: string;
  productivity?: number;
}

export interface AskRequest {
  query: string;
  lang: Lang;
  context?: FieldContext;
  topK?: number;
}

export interface Citation {
  chunkId: string;
  title: string;
  source: string;
  url: string;
  license: string;
  snippet: string;
  score: number;
}

export interface AskResult {
  answer: string;
  /** extractive = composed from retrieved passages and structured data; generative = LLM over the same grounding. */
  mode: 'extractive' | 'generative';
  citations: Citation[];
  followUps: string[];
  confidence: number;
}
