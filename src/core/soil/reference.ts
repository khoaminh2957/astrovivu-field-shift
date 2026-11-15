import type { ReferenceSoilType, SoilTypeReference } from './types';

/**
 * Standard reference baselines for 6 agronomic soil types.
 * Sources:
 * - Primary Macronutrients: International Fertilizer Association (IFA) World Fertilizer Use Manual;
 *   FAO Fertilizer and Plant Nutrition Bulletin 16.
 * - Secondary Macronutrients: USDA NRCS Nutrient Management Technical Notes;
 *   University of California ANR Soil Fertility Guidelines.
 * - Micronutrients: FAO Soils Bulletin 63; Purdue & Michigan State University Extension.
 * - Physical & Chemical Thresholds (pH, AWC, CEC): FAO Harmonized World Soil Database (HWSD);
 *   USDA NRCS National Engineering Handbook.
 */
export const SOIL_TYPE_REFERENCES: Record<ReferenceSoilType, SoilTypeReference> = {
  Sandy: {
    soilType: 'Sandy',
    ph: { min: 4.5, opt: 6.25, max: 7.5 },
    awcInFt: { min: 0.4, opt: 0.8, max: 1.25 },
    cecMeq100g: { min: 1.0, opt: 3.5, max: 5.0 },
    macronutrientsKgHa: { n: 150.0, p2o5: 60.0, k2o: 140.0 },
    secondaryMacronutrientsKgHa: { ca: 200.0, mg: 40.0, s: 30.0 },
    micronutrientsKgHa: { fe: 3.0, zn: 4.0, mn: 3.0, cu: 1.5, b: 1.5 },
  },
  Loamy: {
    soilType: 'Loamy',
    ph: { min: 5.5, opt: 6.5, max: 7.5 },
    awcInFt: { min: 1.5, opt: 2.0, max: 2.3 },
    cecMeq100g: { min: 10.0, opt: 13.5, max: 20.0 },
    macronutrientsKgHa: { n: 120.0, p2o5: 60.0, k2o: 100.0 },
    secondaryMacronutrientsKgHa: { ca: 100.0, mg: 25.0, s: 20.0 },
    micronutrientsKgHa: { fe: 2.0, zn: 3.0, mn: 2.0, cu: 1.0, b: 1.0 },
  },
  Silty: {
    soilType: 'Silty',
    ph: { min: 5.5, opt: 6.5, max: 8.0 },
    awcInFt: { min: 1.5, opt: 2.1, max: 2.5 },
    cecMeq100g: { min: 15.0, opt: 20.0, max: 25.0 },
    macronutrientsKgHa: { n: 110.0, p2o5: 55.0, k2o: 110.0 },
    secondaryMacronutrientsKgHa: { ca: 120.0, mg: 25.0, s: 20.0 },
    micronutrientsKgHa: { fe: 2.0, zn: 3.0, mn: 2.0, cu: 1.0, b: 1.0 },
  },
  Clay: {
    soilType: 'Clay',
    ph: { min: 5.5, opt: 6.75, max: 8.5 },
    awcInFt: { min: 1.6, opt: 2.0, max: 2.5 },
    cecMeq100g: { min: 25.0, opt: 35.0, max: 50.0 },
    macronutrientsKgHa: { n: 100.0, p2o5: 80.0, k2o: 70.0 },
    secondaryMacronutrientsKgHa: { ca: 300.0, mg: 15.0, s: 25.0 },
    micronutrientsKgHa: { fe: 5.0, zn: 5.0, mn: 4.0, cu: 1.0, b: 1.0 },
  },
  'Peat / Organic': {
    soilType: 'Peat / Organic',
    ph: { min: 3.5, opt: 5.75, max: 7.0 },
    awcInFt: { min: 2.5, opt: 3.0, max: 4.0 },
    cecMeq100g: { min: 50.0, opt: 75.0, max: 100.0 },
    macronutrientsKgHa: { n: 60.0, p2o5: 90.0, k2o: 150.0 },
    secondaryMacronutrientsKgHa: { ca: 500.0, mg: 50.0, s: 15.0 },
    micronutrientsKgHa: { fe: 3.0, zn: 6.0, mn: 5.0, cu: 6.0, b: 1.5 },
  },
  'Chalky / Calcareous': {
    soilType: 'Chalky / Calcareous',
    ph: { min: 7.1, opt: 7.35, max: 8.5 },
    awcInFt: { min: 1.0, opt: 1.5, max: 2.0 },
    cecMeq100g: { min: 10.0, opt: 20.0, max: 30.0 },
    macronutrientsKgHa: { n: 120.0, p2o5: 95.0, k2o: 120.0 },
    secondaryMacronutrientsKgHa: { ca: 0.0, mg: 35.0, s: 45.0 },
    micronutrientsKgHa: { fe: 10.0, zn: 7.0, mn: 8.0, cu: 2.0, b: 2.0 },
  },
};

/**
 * Determine closest matching reference soil type from texture class, USDA texture and pH.
 */
export function classifyReferenceSoilType(
  textureClass: string | null | undefined,
  usdaTexture: string | null | undefined,
  ph: number | null | undefined,
  socGkg: number | null | undefined,
): ReferenceSoilType {
  // If organic carbon is very high (> 120 g/kg or ~12-20% organic matter) or classified organic
  if (textureClass === 'organic' || (socGkg != null && socGkg > 120)) {
    return 'Peat / Organic';
  }

  // If high pH (> 7.6) and alkaline, classified as Chalky / Calcareous
  if (ph != null && ph >= 7.6) {
    return 'Chalky / Calcareous';
  }

  const ut = (usdaTexture ?? '').toLowerCase();

  if (ut.includes('clay')) {
    return 'Clay';
  }
  if (ut.includes('silt')) {
    return 'Silty';
  }
  if (ut.includes('sand') || textureClass === 'light') {
    return 'Sandy';
  }
  if (textureClass === 'heavy') {
    return 'Clay';
  }

  return 'Loamy';
}

