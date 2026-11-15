import { describe, expect, it } from 'vitest';
import type { BranchId, FieldTelemetry, Parcel, ScoreTimeline } from '@/contracts';
import { BRANCHES } from '@/contracts';
import { emptyBranch } from '@/lib/series';
import { addDays } from '@/lib/time';
import { buildFieldContext } from './fieldContext';

const parcel: Parcel = {
  id: 'p1',
  name: 'Test parcel',
  polygon: { type: 'Polygon', coordinates: [[[108.2, 12.8], [108.201, 12.8], [108.201, 12.801], [108.2, 12.8]]] },
  centroid: [108.2005, 12.8005],
  bbox: [108.2, 12.8, 108.201, 12.801],
  areaHa: 2.04,
  source: 'quad',
  isUS: false,
  elevationM: 602,
};

function telemetry(): FieldTelemetry {
  const branches = Object.fromEntries(BRANCHES.map((b) => [b, emptyBranch(b)])) as Record<BranchId, ReturnType<typeof emptyBranch>>;
  branches.soilMoisture.series.push({
    key: 'sm_root',
    branch: 'soilMoisture',
    label: { en: 'Root zone', vi: 'Vùng rễ' },
    unit: 'm³/m³',
    sourceId: 'smap-l4',
    cadence: 'daily',
    samples: [
      { t: '2026-03-10', v: 0.18 },
      { t: '2026-03-12', v: 0.17 },
    ],
    baseline: [{ doy: 71, mean: 0.22, p10: 0.19, p90: 0.26 }],
  });
  branches.rainfall.series.push({
    key: 'rain',
    branch: 'rainfall',
    label: { en: 'Rain', vi: 'Mưa' },
    unit: 'mm/day',
    sourceId: 'gpm-imerg',
    cadence: 'daily',
    samples: Array.from({ length: 30 }, (_, i) => ({ t: `2026-02-${String(12 + i).padStart(2, '0')}`.replace(/02-(29|3\d|4\d)/, (m) => m), v: 1 })),
  });
  branches.soil.facts.push({ key: 'ph', branch: 'soil', label: { en: 'pH', vi: 'pH' }, value: 5.6, sourceId: 'soilgrids', uncertainty: [4.9, 6.3] });
  return {
    parcelId: 'p1',
    generatedAt: '2026-11-14T00:00:00Z',
    window: { start: '2025-11-15', end: '2026-11-14', today: '2026-11-14' },
    branches,
    mode: 'cached',
    sources: {
      'smap-l4': { id: 'smap-l4', name: 'SMAP L4', agency: 'NASA', provenance: 'modelled', resolutionM: 9000, cadenceDays: 1, latencyDays: 3, access: 'sample cache', url: '' },
      'gpm-imerg': { id: 'gpm-imerg', name: 'GPM IMERG', agency: 'NASA', provenance: 'observed', resolutionM: 10000, cadenceDays: 1, latencyDays: 1, access: 'sample cache', url: '' },
      soilgrids: { id: 'soilgrids', name: 'SoilGrids v2.0', agency: 'ISRIC', provenance: 'modelled', resolutionM: 250, cadenceDays: null, latencyDays: null, access: 'REST', url: '' },
    },
  };
}

const factor = (key: string, score: number) => ({ key, label: { en: key === 'water' ? 'Water' : 'Temperature', vi: key }, score, weight: 1, actual: null, ideal: '-', kind: 'manageable' as const });
const score: ScoreTimeline = {
  cropId: 'glycine-max',
  stepDays: 7,
  snapshots: [
    { t: '2026-02-12', productivity: 74, condition: 76, compatibility: 90, stage: null, factors: [factor('water', 0.7), factor('temp', 0.9)], limiting: 'water', confidence: 0.6 },
    { t: '2026-03-12', productivity: 52, condition: 55, compatibility: 90, stage: null, factors: [factor('water', 0.41), factor('temp', 0.9)], limiting: 'water', confidence: 0.6 },
  ],
  summary: { productivityNow: 52, productivityMean: 60, compatibility: 90, limiting: null, expectedYieldFraction: 0.6, reliability: { yearsOk: 17, yearsTotal: 20 }, calibration: [], headline: { en: '', vi: '' } },
};

describe('buildFieldContext', () => {
  it('writes each fact as value + unit + source, pixel and date', () => {
    const ctx = buildFieldContext({ parcel, telemetry: telemetry(), score, cursor: '2026-03-13', cropId: 'glycine-max' });
    expect(ctx.facts.sm_root).toBe('0.17 m³/m³ (SMAP L4, 9 km pixel, modelled, 2026-03-12; 23% below normal (below the 10th percentile, normal 0.22))');
    expect(ctx.facts.ph).toBe('5.6 (SoilGrids v2.0, 250 m pixel, modelled; 5-95%: 4.9-6.3)');
    expect(ctx.facts.data_mode).toBe('cached demo telemetry');
    expect(ctx.facts['score_2026-03']).toBe('52/100; limiting Water 0.41');
    expect(ctx.facts.score_now).toMatch(/^52\/100 productivity on 2026-03-12/);
    expect(ctx.limitingFactor).toMatch(/^Water/);
    expect(ctx.productivity).toBe(52);
    expect(ctx.areaHa).toBe(2.04);
  });
  it('flags stale readings and lets ground truth win', () => {
    const ctx = buildFieldContext({ parcel, telemetry: telemetry(), score: null, cursor: '2026-04-30', cropId: null, groundTruth: { ph: 6.2, irrigation: 'supplemental' } });
    expect(ctx.facts.sm_root).toMatch(/stale: 49 days old/);
    expect(ctx.facts.ph).toMatch(/^6.2 \(measured by the farmer; satellite\/model estimate was 5.6 \(SoilGrids/);
    expect(ctx.facts.irrigation).toMatch(/^supplemental/);
  });
  it('sums the rain of the last 30 days from the observed series, and from the reanalysis where that stops short', () => {
    const t = telemetry();
    // The observed series of the fixture covers 12 February to 13 March.
    expect(buildFieldContext({ parcel, telemetry: t, score: null, cursor: '2026-03-13', cropId: null }).facts.rain_30d).toBe('30 mm over the 30 days to 2026-03-13 (GPM IMERG, 10 km pixel)');
    // Six weeks later it has nothing for the window: no rain_30d without another series...
    expect(buildFieldContext({ parcel, telemetry: t, score: null, cursor: '2026-04-30', cropId: null }).facts.rain_30d).toBeUndefined();
    // ...and the reanalysis series, named as a model, when there is one.
    t.branches.rainfall.series.push({ key: 'rain_era5', branch: 'rainfall', label: { en: 'Rain (ERA5)', vi: 'Mưa (ERA5)' }, unit: 'mm/day', sourceId: 'era5', cadence: 'daily', samples: Array.from({ length: 30 }, (_, i) => ({ t: `2026-04-${String(1 + i).padStart(2, '0')}`, v: 2.5 })) });
    t.sources.era5 = { id: 'era5', name: 'ERA5', agency: 'ECMWF', provenance: 'modelled', resolutionM: 25_000, cadenceDays: 1, latencyDays: 5, access: 'sample cache', url: '' };
    expect(buildFieldContext({ parcel, telemetry: t, score: null, cursor: '2026-04-30', cropId: null }).facts.rain_30d).toBe('75 mm over the 30 days to 2026-04-30 (ERA5, 25 km pixel, modelled)');
    // The observed series still wins where it reaches the cursor.
    expect(buildFieldContext({ parcel, telemetry: t, score: null, cursor: '2026-03-13', cropId: null }).facts.rain_30d).toContain('GPM IMERG');
  });
  it('says what the forecast holds from the cursor on', () => {
    const t = telemetry();
    const days = ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'];
    const fc = (key: string, unit: string, values: number[]) => ({ key, branch: 'risk' as const, label: { en: key, vi: key }, unit, sourceId: 'open-meteo-forecast', cadence: 'daily' as const, samples: days.map((d, i) => ({ t: d, v: values[i] })) });
    // The day before the cursor has the lowest minimum and the most rain: it is not ahead, so it does not count.
    t.branches.risk.series.push(fc('fc_tmin', '°C', [-4, 3.5, 1.2, 6]), fc('fc_tmax', '°C', [40, 18, 21.5, 20]), fc('fc_rain', 'mm/day', [90, 0, 12.5, 4]));
    t.sources['open-meteo-forecast'] = { id: 'open-meteo-forecast', name: '16-day weather forecast', agency: 'Open-Meteo', provenance: 'forecast', resolutionM: 11_000, cadenceDays: 1, latencyDays: 0, access: 'REST', url: '' };
    const facts = buildFieldContext({ parcel, telemetry: t, score: null, cursor: '2026-11-14', cropId: null }).facts;
    expect(facts.forecast_tmin).toBe('1.2 °C lowest forecast minimum, on 2026-11-15 (16-day weather forecast, 11 km pixel, forecast, 2026-11-14 to 2026-11-16)');
    expect(facts.forecast_tmax).toBe('21.5 °C highest forecast maximum, on 2026-11-15 (16-day weather forecast, 11 km pixel, forecast, 2026-11-14 to 2026-11-16)');
    expect(facts.forecast_rain).toBe('16.5 mm forecast over 3 days, wettest day 12.5 mm on 2026-11-15 (16-day weather forecast, 11 km pixel, forecast, 2026-11-14 to 2026-11-16)');
    // No forecast series, no forecast facts.
    expect(buildFieldContext({ parcel, telemetry: telemetry(), score: null, cursor: '2026-11-14', cropId: null }).facts.forecast_tmin).toBeUndefined();
  });
  it('works before telemetry has loaded', () => {
    const ctx = buildFieldContext({ parcel, telemetry: null, score: null, cursor: '2026-11-14', cropId: null });
    expect(ctx.facts).toEqual({ elevation_m: '602 m (parcel elevation)' });
  });
});
