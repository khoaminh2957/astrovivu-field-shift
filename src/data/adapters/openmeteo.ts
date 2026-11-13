/**
 * Open-Meteo: ERA5 / ERA5-Land archive, 16-day forecast, current conditions, Copernicus DEM
 * elevation. CORS *, key-free, CC BY 4.0. The archive's `elevation` is the 90 m DEM height
 * Open-Meteo already downscaled to; we lapse-adjust from there to the parcel elevation.
 */
import type { LngLat, Sample } from '@/contracts';
import { cached, ck, TTL } from '../cache';
import { getJson } from '../http';

interface DailyResponse {
  elevation: number;
  daily: Record<string, (number | null)[]> & { time: string[] };
  daily_units?: Record<string, string>;
  current?: Record<string, number | string>;
}

export interface DailyTable {
  elevationM: number | null;
  series: Record<string, Sample[]>;
  units: Record<string, string>;
}

function toTable(j: DailyResponse, vars: string[]): DailyTable {
  const series: Record<string, Sample[]> = {};
  for (const v of vars) {
    const arr = j.daily[v] ?? [];
    series[v] = j.daily.time.map((t, i) => ({ t, v: arr[i] ?? null }));
  }
  return { elevationM: Number.isFinite(j.elevation) ? j.elevation : null, series, units: j.daily_units ?? {} };
}

export async function era5Daily(at: LngLat, start: string, end: string, vars: string[], signal?: AbortSignal, ttl: number = TTL.short): Promise<DailyTable> {
  const [lon, lat] = at;
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${start}&end_date=${end}&daily=${vars.join(',')}&timezone=UTC`;
  const j = await cached(`era5:${vars.join(',')}:${ck(lon)},${ck(lat)}:${start}:${end}`, ttl, () =>
    getJson<DailyResponse>(url, { signal, timeoutMs: 40_000 }),
  );
  return toTable(j, vars);
}

export async function forecastDaily(at: LngLat, vars: string[], days = 16, signal?: AbortSignal): Promise<DailyTable> {
  const [lon, lat] = at;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&daily=${vars.join(',')}&forecast_days=${days}&timezone=UTC`;
  const j = await cached(`omfc:${vars.join(',')}:${ck(lon)},${ck(lat)}:${new Date().toISOString().slice(0, 13)}`, TTL.short, () =>
    getJson<DailyResponse>(url, { signal, timeoutMs: 15_000 }),
  );
  return toTable(j, vars);
}

export async function currentConditions(at: LngLat, signal?: AbortSignal): Promise<{ t: number | null; rh: number | null; swMJ: number | null; time: string } | null> {
  const [lon, lat] = at;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,relative_humidity_2m,shortwave_radiation&daily=shortwave_radiation_sum&forecast_days=1&timezone=UTC`;
  const j = await getJson<DailyResponse>(url, { signal, timeoutMs: 15_000 });
  const c = j.current;
  if (!c) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { t: num(c.temperature_2m), rh: num(c.relative_humidity_2m), swMJ: num(j.daily.shortwave_radiation_sum?.[0]), time: String(c.time ?? '') };
}

export async function elevation(at: LngLat, signal?: AbortSignal): Promise<number | null> {
  const [lon, lat] = at;
  const j = await cached(`omelev:${ck(lon, 4)},${ck(lat, 4)}`, TTL.year, () =>
    getJson<{ elevation: number[] }>(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`, { signal, timeoutMs: 10_000 }),
  );
  const v = j.elevation?.[0];
  return Number.isFinite(v) ? v : null;
}
