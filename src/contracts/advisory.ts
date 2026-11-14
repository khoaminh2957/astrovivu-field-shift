import type { I18nText, ISODate } from './common';
import type { FarmerPriority, SowingWindow } from './model';
import type { BranchId } from './telemetry';

// ---------------------------------------------------------------------------------------------
// Economics
// ---------------------------------------------------------------------------------------------

export interface YieldEstimate {
  expectedTHa: number;
  lowTHa: number;
  highTHa: number;
  /** Attainable reference yield the estimate was scaled from. */
  refTHa: number;
  basis: I18nText;
}

export interface SeasonEconomics {
  cropId: string;
  areaHa: number;
  yield: YieldEstimate;
  productionT: number;
  priceUsdPerT: number;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number;
  breakEvenYieldTHa: number;
  /** Where yield, price and cost assumptions come from. */
  sources: string[];
  /** True when any input is a reference value rather than the farmer's own number. */
  usesReferenceValues: boolean;
}

export interface StrategyEconomics {
  perYear: { revenueUsd: number; costUsd: number; marginUsd: number };
  perHaMarginUsd: number;
  seasons: SeasonEconomics[];
}

export interface CurrencyInfo {
  code: 'USD' | 'VND';
  perUsd: number;
  asOf: string;
  source: string;
}

export interface MonthPlan {
  month: number;
  tasks: I18nText[];
  costUsd: number;
  revenueUsd: number;
  /** Cumulative cash position at month end. */
  cashUsd: number;
}

/** Twelve-month farming and cash-flow plan for the chosen rotation strategy. */
export interface AnnualPlan {
  strategyId: string;
  months: MonthPlan[];
  totals: { revenueUsd: number; costUsd: number; marginUsd: number; marginPct: number };
  assumptions: I18nText[];
}

// ---------------------------------------------------------------------------------------------
// Advisory
// ---------------------------------------------------------------------------------------------

export interface EvidenceItem {
  label: I18nText;
  value: string | I18nText;
  sourceId?: string;
  branch?: BranchId;
}

export interface ActionStep {
  when: I18nText;
  what: I18nText;
  amount?: string | I18nText;
}

export type AdvisoryKind = 'irrigation' | 'ph' | 'sowing' | 'rotation' | 'risk' | 'fertility' | 'drainage' | 'erosion';

export interface Advisory {
  id: string;
  kind: AdvisoryKind;
  priority: 1 | 2 | 3;
  title: I18nText;
  summary: I18nText;
  actions: ActionStep[];
  impact: { scoreDelta?: number; waterSavedMm?: number; marginDeltaUsdPerHa?: number };
  evidence: EvidenceItem[];
  confidence: number;
  caveats: I18nText[];
  /** The challenge asks every suggestion to say where local expertise must review it. */
  needsLocalReview: boolean;
}

export type SeasonSlotRole = 'inter-row' | 'companion' | 'converted' | 'break' | 'cover';

export interface RotationSeason {
  /** A crop id, or `fallow`. Cover crops are ordinary crop ids with category `cover`. */
  cropId: string;
  label: I18nText;
  startMonth: number;
  endMonth: number;
  /**
   * 0-based year of the rotation in which the season starts. Optional: without it the UI lays
   * seasons out in order, treating a 12-month season as standing across every year (a perennial).
   */
  year?: number;
  /** Share of the parcel area occupied by this crop (0..1); 1 when omitted. */
  share?: number;
  /** Structural slot role when part of an intercrop, partial conversion, stand break or cover slot. */
  slotRole?: SeasonSlotRole;
  /**
   * Per-season detail for the rotation calendar. All optional: a report computed before these
   * existed, a fixture, or a fallow season simply omits them and the UI shows the block without them.
   */
  detail?: RotationSeasonDetail;
}

/** What one season of a rotation is expected to do on this field, with the reason it sits where it does. */
export interface RotationSeasonDetail {
  /** What the season is there for. A cash crop that is also a legume is `cash`. */
  role: 'cash' | 'legume' | 'cover' | 'fallow' | 'perennial';
  /** 0..100 climate and soil fit of this crop sown in `startMonth` on this field. */
  suitability?: number;
  /** In how many of the analysed years the crop's needs were met in this slot. */
  metInYears?: { met: number; of: number };
  /** Modelled crop water need over the season, mm. */
  waterNeedMm?: number;
  /** Normal rainfall over the months of the season, mm (same climate record as the score). */
  rainMm?: number;
  /** Expected yield, t/ha (reference-scaled, see SeasonEconomics.yield). */
  yieldTHa?: number;
  /** Margin of this season per hectare, USD. */
  marginUsdPerHa?: number;
  /** Nitrogen left by a legume or cover crop, kg N/ha (indicative). */
  nitrogenKgHa?: number;
  /** One sentence: why this crop, in these months. */
  reason?: I18nText;
}

export type RotationKind = 'current' | 'soil-health' | 'water-saver' | 'income' | 'resilience' | 'custom';

/** One option when swapping the crop of a season slot on the rotation calendar. */
export interface SlotCropChoice {
  cropId: string;
  label: I18nText;
  /** 0..100 climate and soil fit in the months it would take; null for fallow or unscored crops. */
  suitability: number | null;
  startMonth: number;
  cycleMonths: number;
}

/**
 * One rotation strategy. The challenge requires comparing at least three (including the existing
 * one) and, for each, explaining why, the evidence, the benefits, the information gaps and the
 * risks that need local review. Those five lists are mandatory.
 */
export interface RotationStrategy {
  id: string;
  kind: RotationKind;
  name: I18nText;
  /** Length of the rotation in years. */
  years: number;
  seasons: RotationSeason[];
  metrics: {
    suitability: number;
    soilHealth: number;
    waterUseMm: number;
    /** 0..100: how well demand fits rain plus the water the farmer can supply. */
    waterFit: number;
    marginUsdPerHaYr: number;
    risk: number;
    nitrogenKgHaYr: number;
    /** Share of the year the soil is covered, %. */
    groundCoverPct: number;
    pestBreak: number;
  };
  economics: StrategyEconomics;
  /** 0..100 after weighting the metrics by the farmer's priorities. */
  score: number;
  why: I18nText[];
  evidence: EvidenceItem[];
  benefits: I18nText[];
  gaps: I18nText[];
  risks: I18nText[];
}

export interface IrrigationEvent {
  t: ISODate;
  mm: number;
  reason: I18nText;
}

export interface IrrigationPlan {
  events: IrrigationEvent[];
  totalMm: number;
  /** Water saved against a fixed-interval schedule, mm. */
  savedVsFixedMm: number;
  method: I18nText;
  basis: I18nText;
}

export interface PhPlan {
  current: number;
  target: number;
  amendment: 'lime' | 'sulfur' | 'none';
  /** Indicative range, t/ha. Null when it cannot be estimated responsibly. */
  rateTHa: [lo: number, hi: number] | null;
  basis: I18nText;
  caveats: I18nText[];
}

export interface AdvisoryReport {
  generatedAt: ISODate;
  cropId: string | null;
  priorities: FarmerPriority[];
  advisories: Advisory[];
  rotations: RotationStrategy[];
  irrigation?: IrrigationPlan;
  sowing?: SowingWindow[];
  ph?: PhPlan;
  annualPlan?: AnnualPlan;
}

/** Automatic commentary pinned to a date: what changed on the field and why it matters. */
export interface Insight {
  t: ISODate;
  branch: BranchId | 'score';
  severity: 'info' | 'watch' | 'alert';
  text: I18nText;
  metricKey?: string;
  /** Standard score against the multi-year baseline, when the insight is an anomaly. */
  z?: number;
}
