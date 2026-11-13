/**
 * NASA POWER (power.larc.nasa.gov). CORS *, 1-2 s. Fill value −999.
 * The response geometry's third coordinate is the MERRA-2 cell's mean elevation, used for the
 * lapse-rate correction (S4).
 */
import type { LngLat, Sample } from '@/contracts';
import { cached, ck, TTL } from '../cache';
import { getJson } from '../http';
import { compactToIso, isoToCompact, powerValue } from '../harmonize/units';

interface PowerDailyResponse {
  geometry: { coordinates: [number, number, number] };
  properties: { parameter: Record<string, Record<string, number>> };
  parameters?: Record<string, { units: string; longname: string }>;
}

export interface PowerDaily {
  cellElevationM: number | null;
  series: Record<string, Sample[]>;
  units: Record<string, string>;
}

export async function powerDaily(at: LngLat, start: string, end: string, params: string[], signal?: AbortSignal): Promise<PowerDaily> {
  const [lon, lat] = at;
  const url =
    `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${params.join(',')}` +
    `&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&start=${isoToCompact(start)}&end=${isoToCompact(end)}&format=JSON`;
  const key = `power:${params.join(',')}:${ck(lon, 2)},${ck(lat, 2)}:${start}:${end}`;
  const j = await cached(key, TTL.day, () => getJson<PowerDailyResponse>(url, { signal, timeoutMs: 45_000 }));
  const series: Record<string, Sample[]> = {};
  for (const p of params) {
    const raw = j.properties.parameter[p] ?? {};
    series[p] = Object.entries(raw)
      .map(([d, v]) => ({ t: compactToIso(d), v: powerValue(v) }))
      .sort((a, b) => (a.t < b.t ? -1 : 1));
  }
  const units = Object.fromEntries(Object.entries(j.parameters ?? {}).map(([k, v]) => [k, v.units]));
  const elev = j.geometry?.coordinates?.[2];
  return { cellElevationM: Number.isFinite(elev) ? elev : null, series, units };
}

interface PowerClimResponse {
  geometry: { coordinates: [number, number, number] };
  properties: { parameter: Record<string, Record<string, number>> };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Monthly climatology (12 values per parameter, null where filled). */
export async function powerClimatology(at: LngLat, params: string[], signal?: AbortSignal): Promise<{ cellElevationM: number | null; months: Record<string, (number | null)[]> }> {
  const [lon, lat] = at;
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=${params.join(',')}&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
  const j = await cached(`powerclim:${params.join(',')}:${ck(lon, 2)},${ck(lat, 2)}`, TTL.year, () => getJson<PowerClimResponse>(url, { signal, timeoutMs: 45_000 }));
  const months: Record<string, (number | null)[]> = {};
  for (const p of params) months[p] = MONTHS.map((m) => powerValue(j.properties.parameter[p]?.[m]));
  const elev = j.geometry?.coordinates?.[2];
  return { cellElevationM: Number.isFinite(elev) ? elev : null, months };
}
