import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, Sample } from '@/contracts';
import { mockTelemetry } from '@/data/mock';
import { DEMO_FIELD } from '@/data/samples';
import { latestWeather, weatherDays, weatherSeries } from './workspaceWeather';

function setReadings(telemetry: FieldTelemetry, key: 'rain' | 'fc_rain' | 'fc_tmax', samples: Sample[]) {
  const series = weatherSeries(telemetry, key);
  if (!series) throw new Error(`No test series for ${key}`);
  series.samples = samples;
}

describe('weather workspace', () => {
  it('keeps a zero rainfall reading and marks it older than the source window', () => {
    const telemetry = mockTelemetry(DEMO_FIELD, '2026-11-15');
    setReadings(telemetry, 'rain', [
      { t: '2026-10-20', v: 0 },
      { t: '2026-11-15', v: null },
      { t: '2026-11-16', v: 8 },
    ]);
    expect(latestWeather(telemetry, 'rain')).toMatchObject({ date: '2026-10-20', value: 0, stale: true });
  });

  it('aligns forecast metrics by date, leaving gaps and excluding dates outside the forecast', () => {
    const telemetry = mockTelemetry(DEMO_FIELD, '2026-11-15');
    telemetry.window.forecastEnd = '2026-11-16';
    setReadings(telemetry, 'fc_tmax', [{ t: '2026-11-15', v: 14 }]);
    setReadings(telemetry, 'fc_rain', [
      { t: '2026-11-14', v: 5 },
      { t: '2026-11-15', v: null },
      { t: '2026-11-16', v: 0 },
      { t: '2026-11-17', v: 9 },
    ]);
    expect(weatherDays(telemetry, true)).toEqual([
      ['2026-11-15', { fc_tmax: 14 }],
      ['2026-11-16', { fc_rain: 0 }],
    ]);
  });
});
