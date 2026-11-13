/**
 * Soil texture. Two outputs:
 *   - the USDA texture class (12-class triangle, Soil Survey Manual, 2017), shown as detail;
 *   - the EcoCrop class the scorer matches against crop requirements: heavy / medium / light /
 *     organic.
 *
 * EcoCrop defines its classes only verbally ("heavy = clay-rich, medium = loams, light = sandy").
 * Thresholds chosen here and documented in docs/DATA_SOURCES.md:
 *   organic  SOC >= 120 g/kg (≈ 12 % organic carbon, the lower bound of organic soil material)
 *   heavy    clay >= 35 % (clay, silty clay, sandy clay, and clay loam / silty clay loam near the top)
 *   light    sand >= 52 % and clay < 20 % (sandy loam, loamy sand, sand)
 *   medium   everything else (loam, silt loam, silt, sandy clay loam, lower clay loams)
 */

export type EcoTexture = 'heavy' | 'medium' | 'light' | 'organic';

export function usdaTexture(clay: number, sand: number, silt: number): string {
  // Normalise so the three fractions sum to 100 (SoilGrids means rarely do exactly).
  const tot = clay + sand + silt;
  if (!(tot > 0)) return 'unknown';
  const c = (clay / tot) * 100;
  const s = (sand / tot) * 100;
  const si = (silt / tot) * 100;
  if (si + 1.5 * c < 15) return 'sand';
  if (si + 1.5 * c >= 15 && si + 2 * c < 30) return 'loamy sand';
  if ((c >= 7 && c < 20 && s > 52 && si + 2 * c >= 30) || (c < 7 && si < 50 && si + 2 * c >= 30)) return 'sandy loam';
  if (c >= 7 && c < 27 && si >= 28 && si < 50 && s <= 52) return 'loam';
  if ((si >= 50 && c >= 12 && c < 27) || (si >= 50 && si < 80 && c < 12)) return 'silt loam';
  if (si >= 80 && c < 12) return 'silt';
  if (c >= 20 && c < 35 && si < 28 && s > 45) return 'sandy clay loam';
  if (c >= 27 && c < 40 && s > 20 && s <= 45) return 'clay loam';
  if (c >= 27 && c < 40 && s <= 20) return 'silty clay loam';
  if (c >= 35 && s > 45) return 'sandy clay';
  if (c >= 40 && si >= 40) return 'silty clay';
  if (c >= 40 && s <= 45 && si < 40) return 'clay';
  return 'loam';
}

export const ECO_THRESHOLDS = { organicSocGkg: 120, heavyClayPct: 35, lightSandPct: 52, lightMaxClayPct: 20 } as const;

export function ecoTextureClass(clayPct: number | null, sandPct: number | null, socGkg: number | null): EcoTexture | null {
  if (socGkg != null && socGkg >= ECO_THRESHOLDS.organicSocGkg) return 'organic';
  if (clayPct == null || sandPct == null) return null;
  if (clayPct >= ECO_THRESHOLDS.heavyClayPct) return 'heavy';
  if (sandPct >= ECO_THRESHOLDS.lightSandPct && clayPct < ECO_THRESHOLDS.lightMaxClayPct) return 'light';
  return 'medium';
}
