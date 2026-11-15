import type { FactorKind, I18nText } from '@/contracts';

export type SoilStatus = 'optimal' | 'tolerable' | 'outside' | 'uncertain' | 'no_data';

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

export type SoilGapStatus = 'optimal' | 'tolerated' | 'outside' | 'unknown';

export interface SoilGapAmount {
  amount: number;
  unit: string;
  direction: 'raise' | 'lower';
}

export type SoilGapKey = 'ph' | 'texture' | 'drainage' | 'depth' | 'salinity' | 'fertility';

export interface SoilGap {
  key: SoilGapKey;
  label: I18nText;
  facts: SoilFact[];
  optimal: string;
  tolerated: string;
  status: SoilGapStatus;
  gap: SoilGapAmount | null;
  gapAtEnds?: [SoilGapAmount | null, SoilGapAmount | null];
  limiting: boolean;
  kind: FactorKind;
  note?: I18nText;
}

export interface SoilDiagnosis {
  cropId: string;
  gaps: SoilGap[];
  limitingKey: SoilGapKey | null;
  conflicts: I18nText[];
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
