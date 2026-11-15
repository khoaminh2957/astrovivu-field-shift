import type { I18nText, SoilPlan, SoilPlanItem, SoilStatus } from '@/contracts';

export type { SoilStatus, SoilPlanItem, SoilPlan };

export type ReferenceSoilType =
  | 'Sandy'
  | 'Loamy'
  | 'Silty'
  | 'Clay'
  | 'Peat / Organic'
  | 'Chalky / Calcareous';

export interface SoilTypeReference {
  soilType: ReferenceSoilType;
  ph: { min: number; opt: number; max: number };
  awcInFt: { min: number; opt: number; max: number };
  cecMeq100g: { min: number; opt: number; max: number };
  macronutrientsKgHa: {
    n: number;
    p2o5: number;
    k2o: number;
  };
  secondaryMacronutrientsKgHa: {
    ca: number;
    mg: number;
    s: number;
  };
  micronutrientsKgHa: {
    fe: number;
    zn: number;
    mn: number;
    cu: number;
    b: number;
  };
}

export interface SoilMetricDiagnosis {
  key: string;
  label: I18nText;
  currentValue: number | string | null;
  unit?: string;
  sourceId?: string;
  uncertainty?: [number, number] | null;
  targetRange?: {
    optLo?: number | string;
    optHi?: number | string;
    absLo?: number | string;
    absHi?: number | string;
  };
  status: SoilStatus;
  deficit?: number | null;
  note: I18nText;
  isLimiting: boolean;
}

export interface SoilDiagnosis {
  fieldId: string;
  cropId: string | null;
  soilType: ReferenceSoilType;
  metrics: SoilMetricDiagnosis[];
  mostLimitingFactor: SoilMetricDiagnosis | null;
  summary: I18nText;
}

export interface SoilFact {
  key: string;
  label: I18nText;
  value: number | string | null;
  unit?: string;
  sourceId: string;
  sourceName: I18nText;
  uncertainty?: [lo: number, hi: number];
  fromGrower: boolean;
  estimate?: number | string | null;
}
