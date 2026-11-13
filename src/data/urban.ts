/**
 * Urban Grower Companion climate: monthly normals (ERA5 2016-2025 via Open-Meteo for temperature
 * and rain, NASA POWER climatology for PAR and humidity) and current conditions.
 * POWER rain is not used: its record breaks in 2016 in parts of SE Asia (DATA_SOURCES.md).
 */
import type { LngLat, UrbanClimate, UrbanClimateMonth } from '@/contracts';
import { todayISO } from '@/lib/time';
import { currentConditions, era5Daily } from './adapters/openmeteo';
import { powerClimatology } from './adapters/power';
import { TTL } from './cache';
import { monthlyClimate } from './harmonize/monthly';
import { SOURCES } from './sources';

const avg = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

/** PAR is ~48 % of global shortwave (median PAR/SW ratio observed in POWER at the test points). */
const PAR_FRACTION = 0.48;

export async function loadUrban(at: LngLat): Promise<UrbanClimate> {
  const year = Number(todayISO().slice(0, 4));
  const [era, clim, now] = await Promise.allSettled([
    era5Daily(at, `${year - 10}-01-01`, `${year - 1}-12-31`, ['precipitation_sum', 'temperature_2m_mean', 'temperature_2m_min', 'temperature_2m_max'], undefined, TTL.month),
    powerClimatology(at, ['ALLSKY_SFC_PAR_TOT', 'RH2M', 'T2M', 'T2M_MIN', 'T2M_MAX', 'PRECTOTCORR']),
    currentConditions(at),
  ]);
  const sourceIds: string[] = [];
  let years: ReturnType<typeof monthlyClimate> = [];
  if (era.status === 'fulfilled') {
    const s = era.value.series;
    years = monthlyClimate(
      s.precipitation_sum.map((r, i) => ({ t: r.t, rain: r.v, tMean: s.temperature_2m_mean[i]?.v ?? null, tMin: s.temperature_2m_min[i]?.v ?? null, tMax: s.temperature_2m_max[i]?.v ?? null })),
      year - 10,
      year - 1,
    );
    if (years.length) sourceIds.push(SOURCES.era5.id);
  }
  const pc = clim.status === 'fulfilled' ? clim.value.months : null;
  if (pc) sourceIds.push(SOURCES.powerClim.id);
  const months: UrbanClimateMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    const ms = years.map((y) => y.months[m - 1]);
    const tMean = avg(ms.map((x) => x.tMean)) ?? pc?.T2M[m - 1] ?? null;
    const tMin = avg(ms.map((x) => x.tMin)) ?? pc?.T2M_MIN[m - 1] ?? null;
    const tMax = avg(ms.map((x) => x.tMax)) ?? pc?.T2M_MAX[m - 1] ?? null;
    // POWER climatology rain (mm/day × days) only as a last resort when ERA5 is down.
    const rain = avg(ms.map((x) => x.rainMm)) ?? (pc?.PRECTOTCORR[m - 1] != null ? pc.PRECTOTCORR[m - 1]! * new Date(Date.UTC(2001, m, 0)).getUTCDate() : null);
    if (tMean == null || tMin == null || tMax == null || rain == null) throw new Error('No climate source answered for this location');
    months.push({ month: m, tMean: r1(tMean)!, tMin: r1(tMin)!, tMax: r1(tMax)!, rainMm: Math.round(rain), par: r1(pc?.ALLSKY_SFC_PAR_TOT[m - 1] ?? null), rh: r1(pc?.RH2M[m - 1] ?? null) });
  }
  const out: UrbanClimate = { location: at, months, sourceIds };
  if (now.status === 'fulfilled' && now.value) {
    out.now = { t: now.value.t, rh: now.value.rh, par: now.value.swMJ == null ? null : r1(now.value.swMJ * PAR_FRACTION), observedAt: now.value.time };
    sourceIds.push(SOURCES.current.id);
  }
  return out;
}
