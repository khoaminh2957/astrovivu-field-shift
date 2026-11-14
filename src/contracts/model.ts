import type { I18nText, ISODate } from './common';
import type { DrainageClass, TextureClass } from './crop';
import type { Parcel } from './geo';
import type { BranchId, FieldTelemetry } from './telemetry';

// ---------------------------------------------------------------------------------------------
// Ground truth: what the farmer knows better than any satellite.
// ---------------------------------------------------------------------------------------------

export type IrrigationMode = 'rainfed' | 'supplemental' | 'full';
export type WaterSource = 'rain' | 'river-canal' | 'well' | 'reservoir' | 'other' | 'unknown';
export type FarmerPriority = 'profit' | 'yield' | 'water' | 'soil' | 'risk' | 'cost';
export type FieldIssue = 'waterlogging' | 'drought' | 'salinity' | 'acid-sulfate' | 'low-fertility';

export interface FieldMeasurement {
  t: ISODate;
  v: number;
}

/** Ground-Truth Override. Any field present here wins over the satellite/model estimate. */
export interface GroundTruth {
  ph?: number;
  ecDsM?: number;
  texture?: TextureClass;
  drainage?: DrainageClass;
  soilDepthCm?: number;
  organicMatterPct?: number;
  irrigation?: IrrigationMode;
  waterSource?: WaterSource;
  waterReliability?: 'year-round' | 'dry-season-short' | 'often-short' | 'unknown';
  variety?: string;
  sowingDate?: ISODate;
  /**
   * The rotation the farmer runs today; months are 1-12. Entries whose months overlap an earlier
   * entry are later years of the rotation, unless they share the same `season` number: those grow
   * side by side in one season (intercrop or a split field), each on `share` of the area.
   */
  currentRotation?: {
    cropId: string;
    startMonth: number;
    endMonth: number;
    /** Season number; entries with the same number grow at the same time on one field. */
    season?: number;
    /** Fraction of the field (0-1). Default: the season's area split equally between its crops. */
    share?: number;
    /** Exact sowing date when the farmer knows it. */
    sowingDate?: ISODate;
  }[];
  issues?: FieldIssue[];
  measuredSoilMoisture?: FieldMeasurement[];
  measuredRain?: FieldMeasurement[];
  lastYieldTHa?: number;
  pricePerT?: number;
  costPerHa?: number;
  currency?: 'USD' | 'VND';
  avoidCropIds?: string[];
}

/** One line of the calibration ledger: what the satellite said, what the farmer measured, what changed. */
export interface CalibrationNote {
  key: string;
  label: I18nText;
  satellite: number | string | null;
  ground: number | string;
  delta?: number;
  effect: I18nText;
  /** Season score (expected % of attainable yield) with and without this override; absent when not re-scored. */
  scoreEffect?: { with: number; without: number; delta: number };
}

/** Everything the model tier needs. Pure functions of this input: no fetches, no globals. */
export interface ModelInput {
  parcel: Parcel;
  telemetry: FieldTelemetry;
  cropId: string | null;
  groundTruth: GroundTruth;
  priorities: FarmerPriority[];
  today: ISODate;
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

/** fixed = cannot be changed (climate, texture); manageable = costs effort (water, pH); choice = free (sowing date, crop). */
export type FactorKind = 'fixed' | 'manageable' | 'choice';

export interface FactorScore {
  /** e.g. temperature, water, ph, texture, drainage, salinity, fertility, depth, altitude, frost, heat, vigor, evapStress, radiation, slope. */
  key: string;
  label: I18nText;
  /** 0..1, or null when the information is missing (missing is never scored as zero). */
  score: number | null;
  weight: number;
  actual: number | string | null;
  unit?: string;
  /** Human-readable ideal window, e.g. `5.5-6.5`. */
  ideal: string;
  kind: FactorKind;
  limiting?: boolean;
  sourceId?: string;
  branch?: BranchId;
  note?: I18nText;
}

/** `dormant`: a perennial outside its active (warm-enough) season; alive, not growing, not failing. */
export type StageId = 'fallow' | 'pre-sowing' | 'initial' | 'development' | 'mid-season' | 'late-season' | 'harvest' | 'dormant';

export interface GrowthStage {
  id: StageId;
  label: I18nText;
  /** Progress through the whole cycle, 0..1. */
  progress: number;
  dayInSeason: number | null;
}

export interface ScoreSnapshot {
  t: ISODate;
  /** Headline 0..100 shown in the Center Productivity Hub. With a crop: compatibility x condition. */
  productivity: number;
  /** Dynamic growing condition at `t`, 0..100 (water, heat, vigour, evaporative stress, light). */
  condition: number;
  /** Static crop-site suitability, 0..100. Null until a crop is chosen. */
  compatibility: number | null;
  stage: GrowthStage | null;
  factors: FactorScore[];
  /** Key of the limiting factor at `t`. */
  limiting: string | null;
  /** 0..1, aggregated from the branches the score used. */
  confidence: number;
  /**
   * True when no crop is growing at `t` (fallow, before sowing, dormant). `productivity` then carries
   * the outlook (the static compatibility), not a reading of a failing crop.
   */
  offSeason?: boolean;
}

export interface ScoreSummary {
  productivityNow: number;
  productivityMean: number;
  compatibility: number | null;
  limiting: FactorScore | null;
  /** Expected fraction of the attainable yield (0..1), null without a crop. */
  expectedYieldFraction: number | null;
  /** In how many of the analysed years the season would have met the crop's needs. */
  reliability: { yearsOk: number; yearsTotal: number } | null;
  calibration: CalibrationNote[];
  headline: I18nText;
  /** State on the last day of the window (today): growing, off-season (annual) or dormant (perennial). */
  seasonNow?: 'in-season' | 'off-season' | 'dormant';
}

export interface ScoreTimeline {
  cropId: string | null;
  stepDays: number;
  /** Ascending by `t`, spanning the telemetry window. */
  snapshots: ScoreSnapshot[];
  summary: ScoreSummary;
}

/** Suitability if the crop were sown in each calendar month (1-12). */
export interface SowingWindow {
  month: number;
  score: number;
  reliability: number | null;
  limiting: string | null;
}

export interface WhatIfResult {
  label: I18nText;
  changedFactor: string;
  before: number;
  after: number;
  delta: number;
}
