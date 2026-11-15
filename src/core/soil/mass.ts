/**
 * From a quantity per kilogram of soil to a dose per hectare.
 *
 * A laboratory reports exchangeable cations in cmol(+) per kg of soil; a grower spreads tonnes per
 * hectare. Between the two stands the mass of soil the amendment is mixed into, which depends on
 * the depth worked and on the bulk density of the field. Both are stated with every dose; neither
 * is assumed silently (a fixed "2,000 t of soil per hectare" is only true at 1.0 t/m3 and 20 cm).
 */

/**
 * Depth of the layer a dose is computed for, in metres. A stated working depth, not a reading:
 * the 0-20 cm layer the soil sample is taken from and the amendment is worked into. Every note
 * that carries a dose names it.
 */
export const DOSE_DEPTH_M = 0.2;

/**
 * Grams of pure gypsum (CaSO4.2H2O, 172.17 g/mol, two charges per mole) that supply 1 cmol(+) of
 * calcium. FAO Soils Bulletin 39 (Abrol, Yadav & Massoud, 1988), section 4.4.1 (iii) "Quantity of
 * amendment": half a cmol of calcium per kg of soil takes "86 x 10-5 kg" of gypsum per kg of soil.
 */
export const GYPSUM_G_PER_CMOLC = 0.86;

/** Grams of pure calcium carbonate (CaCO3, 100.09 g/mol, two charges per mole) in 1 cmol(+). */
export const CACO3_G_PER_CMOLC = 0.5;

/** Tonnes of soil per hectare in a layer: 10,000 m2 x depth (m) x bulk density (t/m3 = g/cm3). */
export function soilMassTHa(depthM: number, bulkDensityTM3: number): number {
  return 10_000 * depthM * bulkDensityTM3;
}

/**
 * Tonnes per hectare of an amendment that supplies `cmolcPerKg` cmol(+) to every kilogram of soil
 * in the layer. g/kg of soil equals kg per tonne of soil, hence the division by 1,000.
 */
export function amendmentTHa(cmolcPerKg: number, gramsPerCmolc: number, depthM: number, bulkDensityTM3: number): number {
  return (cmolcPerKg * gramsPerCmolc * soilMassTHa(depthM, bulkDensityTM3)) / 1000;
}
