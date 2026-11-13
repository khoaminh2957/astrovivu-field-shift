/** Unit conversions and corrections shared by the adapters. Pure. */

/** Environmental lapse rate used for rule S4 (ARCHITECTURE.md §4.1), °C per metre. */
export const LAPSE_C_PER_M = -0.0065;

/** Shift an air temperature read at a grid cell's mean elevation to the parcel's elevation. */
export function lapseAdjust(tC: number | null, fromElevM: number | null | undefined, toElevM: number | null | undefined): number | null {
  if (tC == null || !Number.isFinite(tC)) return null;
  if (fromElevM == null || toElevM == null || !Number.isFinite(fromElevM) || !Number.isFinite(toElevM)) return tC;
  return tC + LAPSE_C_PER_M * (toElevM - fromElevM);
}

/** MODIS MOD11A2 LST: unsigned integer × 0.02 = Kelvin; 0 is the fill value. */
export function modisLstToC(raw: number | null): number | null {
  if (raw == null || raw <= 0 || raw >= 65535) return null;
  return raw * 0.02 - 273.15;
}

/** MOD13Q1 / VNP13A1 NDVI and EVI: ×0.0001, valid range −2000..10000, fill −3000. */
export function modisVi(raw: number | null): number | null {
  if (raw == null || raw < -2000 || raw > 10000) return null;
  return raw * 0.0001;
}

/** MOD16A2 ET: kg/m²/8 day × 0.1; values ≥ 32761 are fill/water/urban codes. Returns mm/day. */
export function modisEtToMmDay(raw: number | null, compositeDays = 8): number | null {
  if (raw == null || raw < 0 || raw >= 32761) return null;
  return (raw * 0.1) / compositeDays;
}

/** NASA POWER uses −999 (and occasionally −99) as the fill value. */
export function powerValue(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= -99) return null;
  return v;
}

/** NASA POWER GWET* is a 0-1 fraction of saturation; the series is published as % sat. */
export const fractionToPct = (v: number | null): number | null => (v == null ? null : v * 100);

export function round(v: number | null, digits = 2): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** YYYYMMDD → YYYY-MM-DD */
export const compactToIso = (s: string): string => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
/** YYYY-MM-DD → YYYYMMDD */
export const isoToCompact = (s: string): string => s.replaceAll('-', '');

/** MODIS "AYYYYDDD" composite id for a calendar date. */
export function modisDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
  return `A${d.getUTCFullYear()}${String(doy).padStart(3, '0')}`;
}

/** Weighted mean of depth layers ignoring nulls; returns null when nothing is valid. */
export function weightedMean(values: (number | null)[], weights: number[]): number | null {
  let s = 0;
  let w = 0;
  values.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) {
      s += v * weights[i];
      w += weights[i];
    }
  });
  return w > 0 ? s / w : null;
}
