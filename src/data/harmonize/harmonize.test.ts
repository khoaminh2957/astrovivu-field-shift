import { describe, expect, it } from 'vitest';
import type { Sample } from '@/contracts';
import { addDays, eachDay } from '@/lib/time';
import { makeParcel, rectPolygon } from '@/lib/geo';
import { parseSoilGrids } from '../adapters/soilgrids';
import { parseCdl } from '../adapters/cdl';
import { compositeDates } from '../adapters/ornl';
import { parseSmapCsv } from '../adapters/appeears';
import { CDL_XML, ORNL_MOD13Q1, POWER_PAR_SW, SOILGRIDS_DAKLAK } from '../__fixtures__/recorded';
import { doyBaseline, quantile, rainAnomaly, trailingSum } from './baseline';
import { monthlyClimate } from './monthly';
import { thresholdEvents } from './risk';
import { analyseDem, compass8, terrariumElevation } from './terrain';
import { ecoTextureClass, usdaTexture } from './texture';
import { fractionToPct, lapseAdjust, modisDate, modisEtToMmDay, modisLstToC, modisVi, powerValue, weightedMean } from './units';
import { footprintFit, pixelsInParcel } from './zonal';

describe('unit conversion', () => {
  it('lapse-rate corrects temperature by -6.5 °C/km', () => {
    expect(lapseAdjust(25, 398, 602)).toBeCloseTo(25 - 0.0065 * 204, 6);
    expect(lapseAdjust(25, null, 602)).toBe(25);
    expect(lapseAdjust(null, 0, 100)).toBeNull();
  });
  it('decodes MODIS scaled integers', () => {
    expect(modisLstToC(15000)).toBeCloseTo(26.85, 2);
    expect(modisLstToC(0)).toBeNull();
    expect(modisVi(ORNL_MOD13Q1.subset[0].data[0])).toBeCloseTo(0.6337, 4);
    expect(modisVi(-3000)).toBeNull();
    expect(modisEtToMmDay(240)).toBeCloseTo(3, 6);
    expect(modisEtToMmDay(32767)).toBeNull();
  });
  it('treats NASA POWER fill values as missing and scales wetness', () => {
    expect(powerValue(-999)).toBeNull();
    expect(powerValue(7.83)).toBe(7.83);
    expect(fractionToPct(0.42)).toBeCloseTo(42);
  });
  it('PAR is about half of shortwave in the recorded POWER response', () => {
    const r = POWER_PAR_SW.par['20260801'] / POWER_PAR_SW.sw['20260801'];
    expect(r).toBeGreaterThan(0.45);
    expect(r).toBeLessThan(0.52);
  });
  it('builds MODIS composite ids', () => {
    expect(modisDate('2025-01-01')).toBe('A2025001');
    expect(modisDate('2026-09-14')).toBe('A2026257');
  });
  it('depth-weights layers, ignoring nulls', () => {
    expect(weightedMean([1, 2, 3], [5, 10, 15])).toBeCloseTo((5 + 20 + 45) / 30);
    expect(weightedMean([1, null, 3], [5, 10, 15])).toBeCloseTo((5 + 45) / 20);
    expect(weightedMean([null], [1])).toBeNull();
  });
});

describe('recorded fixtures', () => {
  it('parses SoilGrids with d_factor', () => {
    const v = parseSoilGrids(SOILGRIDS_DAKLAK)!;
    // 0-5 (w5) and 5-15 (w10) only; 15-30 absent in the fixture.
    expect(v.clay.mean).toBeCloseTo((33.9 * 5 + 33.4 * 10) / 15, 4);
    expect(v.phh2o.mean).toBeCloseTo(5.6, 6);
    expect(v.phh2o.q05).toBeCloseTo((4.4 * 5 + 4.3 * 10) / 15, 4);
    expect(v.sand.mean).toBeNull();
  });
  it('returns null for a fully masked SoilGrids pixel', () => {
    expect(parseSoilGrids({ properties: { layers: [{ name: 'clay', unit_measure: { d_factor: 10, target_units: '%' }, depths: [{ label: '0-5cm', values: { mean: null } }] }] } })).toBeNull();
  });
  it('parses the CropScape XML', () => {
    expect(parseCdl(CDL_XML)).toEqual({ code: 1, crop: 'Corn' });
    expect(parseCdl('<error/>')).toBeNull();
  });
  it('locates the parcel pixel in an ORNL sinusoidal subset', () => {
    const p = makeParcel({ id: 't', name: 't', polygon: rectPolygon([108.2, 12.8], 190, 130), source: 'coords' });
    const g = ORNL_MOD13Q1;
    expect(pixelsInParcel({ xll: Number(g.xllcorner), yll: Number(g.yllcorner), cell: g.cellsize, nrows: g.nrows, ncols: g.ncols }, p)).toEqual([0]);
  });
  it('generates the MODIS composite calendar', () => {
    const d = compositeDates('2025-12-01', '2026-02-15', 16);
    expect(d).toEqual(['2025-12-03', '2025-12-19', '2026-01-01', '2026-01-17', '2026-02-02']);
    expect(compositeDates('2026-01-01', '2026-01-31', 8)).toEqual(['2026-01-01', '2026-01-09', '2026-01-17', '2026-01-25']);
  });
  it('averages 3-hourly SMAP rows into days', () => {
    const csv = 'ID,Latitude,Longitude,Date,SPL4SMGP_008_Geophysical_Data_sm_surface,SPL4SMGP_008_Geophysical_Data_sm_rootzone\nparcel,1,2,2026-01-01T01:30:00,0.2,0.3\nparcel,1,2,2026-01-01T04:30:00,0.4,0.3\nparcel,1,2,2026-01-02T01:30:00,-9999,0.25';
    const r = parseSmapCsv(csv);
    expect(r.surface).toEqual([
      { t: '2026-01-01', v: 0.3 },
      { t: '2026-01-02', v: null },
    ]);
    expect(r.root[1]).toEqual({ t: '2026-01-02', v: 0.25 });
  });
});

describe('baselines', () => {
  const years = eachDay('2010-01-01', '2019-12-31');
  it('pools a ±window across years', () => {
    const s: Sample[] = years.map((t) => ({ t, v: Number(t.slice(0, 4)) - 2010 }));
    const b = doyBaseline(s, { halfWindow: 3 });
    const d100 = b.find((x) => x.doy === 100)!;
    expect(d100.mean).toBeCloseTo(4.5, 2);
    expect(d100.p10).toBeCloseTo(quantile([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9], 0.1), 3);
    expect(d100.p90).toBeGreaterThan(d100.mean);
  });
  it('respects `before` and skips nulls', () => {
    const s: Sample[] = years.map((t) => ({ t, v: t >= '2015-01-01' ? 100 : t.endsWith('-01') ? null : 1 }));
    const b = doyBaseline(s, { before: '2015-01-01' });
    expect(b.every((x) => x.mean === 1)).toBe(true);
  });
  it('trailing sums rescale small gaps and drop large ones', () => {
    const s: Sample[] = eachDay('2020-01-01', '2020-02-29').map((t, i) => ({ t, v: i === 40 ? null : 2 }));
    const m = trailingSum(s, 30);
    expect(m.get('2020-01-30')).toBe(60);
    expect(m.get('2020-02-15')).toBeCloseTo(60, 6);
    expect(m.has('2020-01-29')).toBe(false);
  });
  it('rain anomaly is 100 % for a constant climate and 50 % for half the rain', () => {
    const all = eachDay('2006-01-01', '2026-11-14');
    const start = addDays('2026-11-14', -364);
    const s: Sample[] = all.map((t) => ({ t, v: t >= '2026-06-01' ? 1 : 2 }));
    const a = rainAnomaly(s, start, '2026-11-14');
    expect(a.samples.find((x) => x.t === '2026-03-01')?.v).toBe(100);
    expect(a.samples.find((x) => x.t === '2026-10-01')?.v).toBe(50);
    expect(a.baseline[0]).toMatchObject({ mean: 100, p10: 100, p90: 100 });
  });
});

describe('monthly climate', () => {
  it('sums rain, averages temperatures, nulls months with gaps', () => {
    const days = eachDay('2020-01-01', '2020-12-31').map((t) => ({ t, rain: t.startsWith('2020-03') && t > '2020-03-20' ? null : 1, tMean: 10, tMin: 5, tMax: 15, et0: 2 }));
    const [y] = monthlyClimate(days, 2020, 2020);
    expect(y.months[0]).toMatchObject({ month: 1, rainMm: 31, tMean: 10, tMin: 5, tMax: 15, et0Mm: 62 });
    expect(y.months[1].rainMm).toBe(29);
    expect(y.months[2].rainMm).toBeNull();
  });
});

describe('texture', () => {
  it('classifies the USDA triangle', () => {
    expect(usdaTexture(10, 85, 5)).toBe('loamy sand');
    expect(usdaTexture(3, 95, 2)).toBe('sand');
    expect(usdaTexture(15, 65, 20)).toBe('sandy loam');
    expect(usdaTexture(20, 40, 40)).toBe('loam');
    expect(usdaTexture(15, 20, 65)).toBe('silt loam');
    expect(usdaTexture(5, 5, 90)).toBe('silt');
    expect(usdaTexture(30, 30, 40)).toBe('clay loam');
    expect(usdaTexture(34, 10, 56)).toBe('silty clay loam');
    expect(usdaTexture(25, 60, 15)).toBe('sandy clay loam');
    expect(usdaTexture(40, 50, 10)).toBe('sandy clay');
    expect(usdaTexture(45, 5, 50)).toBe('silty clay');
    expect(usdaTexture(60, 20, 20)).toBe('clay');
  });
  it('maps to EcoCrop classes', () => {
    expect(ecoTextureClass(34, 28, 20)).toBe('medium');
    expect(ecoTextureClass(45, 20, 20)).toBe('heavy');
    expect(ecoTextureClass(8, 80, 5)).toBe('light');
    expect(ecoTextureClass(20, 30, 150)).toBe('organic');
    expect(ecoTextureClass(null, null, 10)).toBeNull();
  });
});

describe('terrain', () => {
  const grid = (f: (x: number, y: number) => number, n = 7, cell = 30) => {
    const data: number[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) data.push(f(c * cell, (n - 1 - r) * cell)); // y north
    return { width: n, height: n, data, cellX: cell, cellY: cell, inside: (c: number, r: number) => c > 0 && r > 0 && c < n - 1 && r < n - 1 };
  };
  it('decodes Terrarium RGB', () => {
    expect(terrariumElevation(128, 0, 0)).toBe(0);
    expect(terrariumElevation(130, 90, 128)).toBeCloseTo(602.5, 6);
  });
  it('plane rising to the east: slope atan(0.1), faces and drains west', () => {
    const s = analyseDem(grid((x) => 100 + 0.1 * x))!;
    expect(s.slopeMeanDeg).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 4);
    expect(s.aspectDeg).toBeCloseTo(270, 4);
    expect(s.aspectLabel).toBe('W');
    expect(s.flowDirLabel).toBe('W');
    expect(s.reliefM).toBeCloseTo(0.1 * 120, 4);
  });
  it('plane falling to the south-east', () => {
    const s = analyseDem(grid((x, y) => 50 - 0.05 * x + 0.05 * y))!;
    expect(s.aspectDeg).toBeCloseTo(135, 4);
    expect(s.flowDirLabel).toBe('SE');
  });
  it('flat ground has no aspect', () => {
    const s = analyseDem(grid(() => 10))!;
    expect(s.slopeMeanDeg).toBe(0);
    expect(s.aspectLabel).toBe('flat');
    expect(s.flowDirLabel).toBe('flat');
  });
  it('compass labels wrap', () => {
    expect(compass8(359)).toBe('N');
    expect(compass8(-45)).toBe('NW');
  });
});

describe('footprint and risk', () => {
  it('fit is sqrt(area)/resolution capped at 1', () => {
    expect(footprintFit(2, 250)).toBeCloseTo(Math.sqrt(20000) / 250, 6);
    expect(footprintFit(2, 30)).toBe(1);
    expect(footprintFit(2, null)).toBe(1);
  });
  it('emits generic threshold events', () => {
    const days = eachDay('2026-11-14', '2026-11-29').map((t, i) => ({
      t,
      tMax: i < 3 ? 39 : 30,
      tMin: i === 5 ? -1 : 15,
      rain: i === 4 ? 60 : 0,
      windMaxKmh: i === 6 ? 75 : 10,
    }));
    const ev = thresholdEvents(days, 'fc');
    expect(ev.map((e) => `${e.kind}:${e.severity}`)).toEqual(['heat:2', 'heavy-rain:2', 'frost:2', 'dry-spell:1', 'wind:2']);
    expect(ev.find((e) => e.kind === 'dry-spell')!.start).toBe('2026-11-19');
  });
});
