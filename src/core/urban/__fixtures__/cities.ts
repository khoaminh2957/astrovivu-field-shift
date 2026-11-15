/**
 * Real 12-month urban climate normals for three reference cities in distinct climate zones:
 *   1. Ho Chi Minh City, Vietnam (10.78° N, 106.70° E) — Tropical savanna / monsoon (Aw)
 *   2. Berlin, Germany (52.52° N, 13.40° E) — Temperate oceanic / continental transition (Cfb)
 *   3. Phoenix, Arizona, USA (33.45° N, 112.07° W) — Hot subtropical desert (BWh)
 *
 * Provenance (same pipeline as `loadUrban` in `src/data/urban.ts`, fetched on 2026-11-15):
 *   - `tMean`, `tMin`, `tMax` (°C, 10-year monthly means of daily mean/min/max) and `rainMm`
 *     (mm/month, 10-year mean): ECMWF ERA5 2016-01-01..2025-12-31 via the Open-Meteo Historical
 *     Weather API (`https://archive-api.open-meteo.com/v1/archive`), licence CC BY 4.0.
 *   - `par` (`ALLSKY_SFC_PAR_TOT`, MJ/m²/day) and `rh` (`RH2M`, %): NASA POWER Climatology API
 *     (`https://power.larc.nasa.gov/api/temporal/climatology/point`, MERRA-2 / CERES), U.S.
 *     Government public domain (17 U.S.C. § 105; attribution to NASA Langley Research Center POWER
 *     Project, see `docs/DATA_SOURCES.md` §1).
 */
import type { UrbanClimate } from '@/contracts';

export const HO_CHI_MINH_CITY: UrbanClimate = {
  location: [106.7, 10.78],
  sourceIds: ['era5', 'power-climatology'],
  months: [
    { month: 1, tMean: 26.9, tMin: 23.0, tMax: 31.9, rainMm: 31, par: 8.5, rh: 70.5 },
    { month: 2, tMean: 27.6, tMin: 23.3, tMax: 33.3, rainMm: 17, par: 9.8, rh: 61.7 },
    { month: 3, tMean: 28.6, tMin: 24.7, tMax: 34.6, rainMm: 19, par: 10.3, rh: 59.2 },
    { month: 4, tMean: 29.3, tMin: 25.9, tMax: 34.3, rainMm: 77, par: 10.2, rh: 61.1 },
    { month: 5, tMean: 28.8, tMin: 26.1, tMax: 32.9, rainMm: 242, par: 9.1, rh: 74.1 },
    { month: 6, tMean: 27.7, tMin: 25.3, tMax: 31.5, rainMm: 265, par: 8.5, rh: 84.4 },
    { month: 7, tMean: 27.2, tMin: 25.0, tMax: 30.8, rainMm: 307, par: 8.5, rh: 87.1 },
    { month: 8, tMean: 27.2, tMin: 24.9, tMax: 31.0, rainMm: 311, par: 8.5, rh: 87.8 },
    { month: 9, tMean: 26.9, tMin: 24.7, tMax: 30.6, rainMm: 369, par: 8.3, rh: 88.1 },
    { month: 10, tMean: 26.7, tMin: 24.3, tMax: 30.4, rainMm: 312, par: 8.2, rh: 87.2 },
    { month: 11, tMean: 26.8, tMin: 24.0, tMax: 30.7, rainMm: 153, par: 8.2, rh: 84.4 },
    { month: 12, tMean: 26.5, tMin: 23.0, tMax: 30.8, rainMm: 72, par: 7.9, rh: 78.6 },
  ],
};

export const BERLIN: UrbanClimate = {
  location: [13.4, 52.52],
  sourceIds: ['era5', 'power-climatology'],
  months: [
    { month: 1, tMean: 1.8, tMin: -0.8, tMax: 4.2, rainMm: 58, par: 1.0, rh: 93.7 },
    { month: 2, tMean: 2.8, tMin: -0.4, tMax: 6.3, rainMm: 50, par: 2.1, rh: 90.5 },
    { month: 3, tMean: 5.3, tMin: 1.1, tMax: 9.7, rainMm: 42, par: 3.8, rh: 85.1 },
    { month: 4, tMean: 9.5, tMin: 4.4, tMax: 14.4, rainMm: 32, par: 6.3, rh: 77.5 },
    { month: 5, tMean: 14.5, tMin: 9.1, tMax: 19.3, rainMm: 41, par: 7.9, rh: 72.8 },
    { month: 6, tMean: 19.7, tMin: 14.0, tMax: 24.6, rainMm: 71, par: 8.6, rh: 66.0 },
    { month: 7, tMean: 19.9, tMin: 14.9, tMax: 24.5, rainMm: 76, par: 8.1, rh: 65.0 },
    { month: 8, tMean: 20.3, tMin: 15.2, tMax: 25.0, rainMm: 47, par: 6.9, rh: 66.2 },
    { month: 9, tMean: 16.3, tMin: 11.7, tMax: 20.9, rainMm: 40, par: 5.0, rh: 71.8 },
    { month: 10, tMean: 11.2, tMin: 7.8, tMax: 14.7, rainMm: 54, par: 2.7, rh: 83.2 },
    { month: 11, tMean: 5.6, tMin: 2.9, tMax: 8.3, rainMm: 46, par: 1.2, rh: 92.2 },
    { month: 12, tMean: 3.1, tMin: 0.8, tMax: 5.2, rainMm: 50, par: 0.7, rh: 94.2 },
  ],
};

export const PHOENIX: UrbanClimate = {
  location: [-112.07, 33.45],
  sourceIds: ['era5', 'power-climatology'],
  months: [
    { month: 1, tMean: 11.6, tMin: 5.7, tMax: 18.7, rainMm: 31, par: 5.5, rh: 45.7 },
    { month: 2, tMean: 14.1, tMin: 7.3, tMax: 21.9, rainMm: 30, par: 7.1, rh: 43.6 },
    { month: 3, tMean: 17.7, tMin: 10.4, tMax: 25.5, rainMm: 30, par: 9.4, rh: 37.8 },
    { month: 4, tMean: 23.4, tMin: 15.1, tMax: 31.1, rainMm: 4, par: 11.5, rh: 29.0 },
    { month: 5, tMean: 27.7, tMin: 19.8, tMax: 35.0, rainMm: 3, par: 12.9, rh: 21.6 },
    { month: 6, tMean: 33.8, tMin: 25.7, tMax: 41.0, rainMm: 5, par: 13.6, rh: 15.3 },
    { month: 7, tMean: 35.5, tMin: 29.2, tMax: 41.8, rainMm: 48, par: 12.5, rh: 30.2 },
    { month: 8, tMean: 34.4, tMin: 28.2, tMax: 40.7, rainMm: 35, par: 11.5, rh: 34.6 },
    { month: 9, tMean: 31.4, tMin: 24.7, tMax: 38.0, rainMm: 30, par: 10.1, rh: 30.9 },
    { month: 10, tMean: 24.9, tMin: 17.5, tMax: 32.3, rainMm: 34, par: 8.0, rh: 30.1 },
    { month: 11, tMean: 18.1, tMin: 11.2, tMax: 25.3, rainMm: 21, par: 6.0, rh: 33.9 },
    { month: 12, tMean: 13.0, tMin: 7.0, tMax: 19.9, rainMm: 33, par: 4.9, rh: 44.6 },
  ],
};

export const REFERENCE_CITIES = {
  hoChiMinhCity: HO_CHI_MINH_CITY,
  berlin: BERLIN,
  phoenix: PHOENIX,
} as const;
