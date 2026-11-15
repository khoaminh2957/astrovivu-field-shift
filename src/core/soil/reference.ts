import type { ReferenceSoilType } from './types';

/**
 * Soil group of the buffer method (`buffer.ts`). Used by that method only, which the advisory
 * report does not call: the cut-offs below (organic carbon above 120 g/kg, pH 7.6) have no
 * recorded source, so the group is not shown to a grower and no verdict rests on it.
 *
 * The table of reference values per soil group that stood here (pH, AWC, CEC and nutrient rates
 * for six groups, about 110 numbers) was removed: it named organisations but no document, table or
 * page, and the folder it was copied from is not in the repository. It can come back row by row,
 * each with its publication, year, table or page and licence; see docs/SOIL.md, "Removed".
 */
export function classifyReferenceSoilType(
  textureClass: string | null | undefined,
  usdaTexture: string | null | undefined,
  ph: number | null | undefined,
  socGkg: number | null | undefined,
): ReferenceSoilType {
  if (textureClass === 'organic' || (socGkg != null && socGkg > 120)) {
    return 'Peat / Organic';
  }

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
