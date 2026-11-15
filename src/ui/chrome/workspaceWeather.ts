import { METRICS, type FieldTelemetry, type ISODate, type MetricKey } from '@/contracts';
import { findSeries, sampleAt } from '@/lib/series';
import { addDays } from '@/lib/time';

export const WEATHER_HISTORY = ['t2m_max', 't2m_min', 'rain', 'wind'] as const;
export const WEATHER_FORECAST = ['fc_tmax', 'fc_tmin', 'fc_rain'] as const;

export function weatherSeries(telemetry: FieldTelemetry, key: MetricKey) {
  return findSeries(telemetry.branches[METRICS[key].branch], key);
}

export function latestWeather(telemetry: FieldTelemetry, key: MetricKey) {
  const series = weatherSeries(telemetry, key);
  if (!series) return null;
  const source = telemetry.sources[series.sourceId];
  const { sample, stale } = sampleAt(series, telemetry.window.today, source?.latencyDays);
  return sample?.v != null ? { date: sample.t, value: sample.v, unit: series.unit, source, stale } : null;
}

export function weatherDays(telemetry: FieldTelemetry, forecast: boolean) {
  const metrics = forecast ? WEATHER_FORECAST : WEATHER_HISTORY;
  const { today, forecastEnd } = telemetry.window;
  const start = forecast ? today : addDays(today, -6);
  const end = forecast ? forecastEnd : today;
  const rows = new Map<ISODate, Partial<Record<MetricKey, number>>>();
  for (const key of metrics) {
    for (const { t, v } of weatherSeries(telemetry, key)?.samples ?? []) {
      if (t < start || (end && t > end) || v == null) continue;
      const row = rows.get(t) ?? {};
      row[key] = v;
      rows.set(t, row);
    }
  }
  return [...rows].sort(([a], [b]) => a.localeCompare(b));
}
