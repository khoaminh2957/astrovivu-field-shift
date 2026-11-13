/**
 * Generic weather-threshold events from the 16-day forecast. Crop-specific risk (stage-aware
 * heat, pest and disease pressure) is added downstream by the advisory engine. Pure.
 *
 * Thresholds (documented in docs/DATA_SOURCES.md):
 *   heat        Tmax >= 35 °C on 2+ consecutive days; warning >= 38, severe >= 41
 *   frost       Tmin <= 2 °C watch, <= 0 warning, <= -3 severe (single day counts)
 *   heavy rain  daily rain >= 30 mm watch, >= 50 warning, >= 100 severe
 *   dry spell   >= 10 consecutive days < 1 mm watch, >= 14 warning
 *   wind        daily max wind >= 50 km/h watch, >= 70 warning
 */
import type { ISODate, RiskEvent } from '@/contracts';
import { tx } from '@/contracts';

export interface ForecastDay {
  t: ISODate;
  tMax: number | null;
  tMin: number | null;
  rain: number | null;
  windMaxKmh?: number | null;
}

type Sev = 0 | 1 | 2 | 3;

function runs(days: ForecastDay[], test: (d: ForecastDay) => boolean): ForecastDay[][] {
  const out: ForecastDay[][] = [];
  let cur: ForecastDay[] = [];
  for (const d of days) {
    if (test(d)) cur.push(d);
    else {
      if (cur.length) out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

export function thresholdEvents(days: ForecastDay[], sourceId: string): RiskEvent[] {
  const ev: RiskEvent[] = [];
  for (const run of runs(days, (d) => (d.tMax ?? -99) >= 35)) {
    if (run.length < 2) continue;
    const peak = Math.max(...run.map((d) => d.tMax ?? -99));
    const severity: Sev = peak >= 41 ? 3 : peak >= 38 ? 2 : 1;
    ev.push({
      id: `heat-${run[0].t}`,
      kind: 'heat',
      start: run[0].t,
      end: run[run.length - 1].t,
      severity,
      title: tx('Heat spell in the forecast', 'Đợt nắng nóng trong dự báo'),
      detail: tx(`${run.length} days at or above 35 °C, peak ${fmt(peak)} °C.`, `${run.length} ngày từ 35 °C trở lên, cao nhất ${fmt(peak)} °C.`),
      sourceId,
    });
  }
  for (const run of runs(days, (d) => d.tMin != null && d.tMin <= 2)) {
    const low = Math.min(...run.map((d) => d.tMin ?? 99));
    const severity: Sev = low <= -3 ? 3 : low <= 0 ? 2 : 1;
    ev.push({
      id: `frost-${run[0].t}`,
      kind: 'frost',
      start: run[0].t,
      end: run[run.length - 1].t,
      severity,
      title: tx('Frost risk', 'Nguy cơ sương giá'),
      detail: tx(`Minimum temperature down to ${fmt(low)} °C.`, `Nhiệt độ thấp nhất xuống ${fmt(low)} °C.`),
      sourceId,
    });
  }
  for (const d of days) {
    const r = d.rain ?? 0;
    if (r < 30) continue;
    const severity: Sev = r >= 100 ? 3 : r >= 50 ? 2 : 1;
    ev.push({
      id: `rain-${d.t}`,
      kind: 'heavy-rain',
      start: d.t,
      end: d.t,
      severity,
      title: tx('Heavy rain', 'Mưa lớn'),
      detail: tx(`${fmt(r)} mm forecast in one day.`, `Dự báo ${fmt(r)} mm trong một ngày.`),
      sourceId,
    });
  }
  for (const run of runs(days, (d) => d.rain != null && d.rain < 1)) {
    if (run.length < 10) continue;
    const severity: Sev = run.length >= 14 ? 2 : 1;
    ev.push({
      id: `dry-${run[0].t}`,
      kind: 'dry-spell',
      start: run[0].t,
      end: run[run.length - 1].t,
      severity,
      title: tx('Dry spell ahead', 'Sắp có đợt khô hạn'),
      detail: tx(`${run.length} consecutive days with less than 1 mm of rain.`, `${run.length} ngày liên tiếp mưa dưới 1 mm.`),
      sourceId,
    });
  }
  for (const d of days) {
    const w = d.windMaxKmh ?? 0;
    if (w < 50) continue;
    ev.push({
      id: `wind-${d.t}`,
      kind: 'wind',
      start: d.t,
      end: d.t,
      severity: w >= 70 ? 2 : 1,
      title: tx('Strong wind', 'Gió mạnh'),
      detail: tx(`Wind up to ${Math.round(w)} km/h.`, `Gió đến ${Math.round(w)} km/h.`),
      sourceId,
    });
  }
  return ev.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : b.severity - a.severity));
}
