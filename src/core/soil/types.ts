import type { I18nText, SoilPlan, SoilPlanItem, SoilStatus } from '@/contracts';

export type { SoilStatus, SoilPlanItem, SoilPlan };

/** One soil value of the field as the soil module reads it: the source's figure, or the grower's own when there is one. */
export interface SoilFact {
  /** Same key as `StaticFact.key`, for example `ph`. */
  key: string;
  label: I18nText;
  value: number | string | null;
  unit?: string;
  /** An id of `telemetry.sources`, or `ground-truth` for a grower's measurement. */
  sourceId: string;
  sourceName: I18nText;
  uncertainty?: [lo: number, hi: number];
  fromGrower: boolean;
  /** The estimate the grower's value replaced; only set when `fromGrower` and the source had one. */
  estimate?: number | string | null;
}

/** Soil groups of the buffer method (`buffer.ts`), which the report does not use yet. */
export type ReferenceSoilType =
  | 'Sandy'
  | 'Loamy'
  | 'Silty'
  | 'Clay'
  | 'Peat / Organic'
  | 'Chalky / Calcareous';

/**
 * Status of one row of the diagnosis. `reading_only`: the field has a reading, but the crop
 * catalogue holds no requirement to set it against, so no verdict is given.
 */
export type SoilMetricStatus = SoilStatus | 'reading_only';

export interface SoilMetricDiagnosis {
  /** Same key as the factor of the suitability model where one exists (ph, texture, drainage, depth, salinity). */
  key: string;
  label: I18nText;
  currentValue: number | string | null;
  unit?: string;
  sourceId?: string;
  uncertainty?: [number, number] | null;
  /** What the crop needs, from the crop catalogue (`CropProfile.req`). Absent when it holds nothing. */
  targetRange?: {
    optLo?: number | string;
    optHi?: number | string;
    absLo?: number | string;
    absHi?: number | string;
  };
  status: SoilMetricStatus;
  /** Distance from the optimum in the unit of the row; 0 inside it; null when it cannot be stated. */
  deficit?: number | null;
  note: I18nText;
  isLimiting: boolean;
}

export interface SoilDiagnosis {
  fieldId: string;
  cropId: string | null;
  metrics: SoilMetricDiagnosis[];
  mostLimitingFactor: SoilMetricDiagnosis | null;
  summary: I18nText;
}
