/**
 * Daily container irrigation volume by calendar month (D6, #19).
 *
 * Equations and sources:
 *   1. Single crop coefficient evapotranspiration (Allen et al., 1998, FAO Irrigation and Drainage
 *      Paper No. 56, Chapter 6, Eq. 56):
 *        ETc = Kc * ET0   (mm/day)
 *   2. Daily volume per container (1 mm over 1 m² = 1 L):
 *        litresMin = round1(Kc_ini * ET0 * canopyM2)   (young plant / initial stage)
 *        litresMax = round1(Kc_mid * ET0 * canopyM2)   (full canopy / mid-season stage)
 *   3. Reference evapotranspiration ET0 (mm/day):
 *      - When `UrbanClimateMonth.et0Mm` is provided (ERA5-Land `et0_fao_evapotranspiration` via
 *        Open-Meteo, CC BY 4.0): `ET0 = et0Mm / daysInMonth`, `et0From = 'era5'`.
 *      - Otherwise: FAO-56 Eq. 52 Hargreaves temperature estimate `hargreaves(tMean, tMax, tMin, latDeg, doy)`
 *        at the mid-month day of year (`MID_DOY`), `et0From = 'hargreaves'`.
 */
import type { CropProfile, UrbanClimate } from '@/contracts';
import { hargreaves } from '@/core/scoring';

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MID_DOY = [16, 45, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350];

export interface PotWaterMonth {
  month: number;
  et0MmDay: number;
  et0From: 'era5' | 'hargreaves';
  litresMin: number;
  litresMax: number;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Surface area (m²) of a circular pot of diameter `diameterCm` (cm): π * (diameterCm / 200)².
 */
export function canopyFromPot(diameterCm: number): number {
  if (!Number.isFinite(diameterCm) || diameterCm <= 0) return 0;
  const rMeters = diameterCm / 200;
  return Math.PI * rMeters * rMeters;
}

/**
 * Computes daily irrigation range (`litresMin`..`litresMax`, L/day) for one container (`opts.canopyM2`)
 * across each month in `climate.months`. Returns `[]` when the crop has no FAO-56 water model (`crop.water`).
 */
export function potWater(crop: CropProfile, climate: UrbanClimate, opts: { canopyM2: number }): PotWaterMonth[] {
  const w = crop.water;
  if (!w || !Number.isFinite(opts.canopyM2) || opts.canopyM2 <= 0) return [];

  const latDeg = climate.location[1];
  const kcLow = Math.min(w.kc.ini, w.kc.mid);
  const kcHigh = Math.max(w.kc.ini, w.kc.mid);

  return climate.months.map((m) => {
    const idx = ((m.month - 1) % 12 + 12) % 12;
    const days = DAYS_IN_MONTH[idx] ?? 30;
    const doy = MID_DOY[idx] ?? 16;

    const hasEra5 = m.et0Mm != null && Number.isFinite(m.et0Mm) && m.et0Mm >= 0;
    const et0MmDay = hasEra5 ? m.et0Mm! / days : hargreaves(m.tMean, m.tMax, m.tMin, latDeg, doy);
    const et0From: 'era5' | 'hargreaves' = hasEra5 ? 'era5' : 'hargreaves';

    const litresMin = round1(kcLow * et0MmDay * opts.canopyM2);
    const litresMax = round1(kcHigh * et0MmDay * opts.canopyM2);

    return {
      month: m.month,
      et0MmDay: Math.round(et0MmDay * 100) / 100,
      et0From,
      litresMin,
      litresMax,
    };
  });
}
