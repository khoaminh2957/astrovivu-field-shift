import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Parcel } from '@/contracts';
import { byteToValue, decodeFrame, NO_DATA } from '@/lib/raster';
import { makeParcel, squareForArea } from '@/lib/geo';
import { band, binScenes, landsatClear, landsatLstC, makeGrid, normDiff, parseNpy, quantise, s2Offset, s2Reflectance, sclValid } from './pure';
import { NDVI } from './specs';
import { fitRange } from './index';

// Recorded 2026-11-14: Planetary Computer data API, Sentinel-2 L2A scene of 2026-06-16 (baseline 05.12)
// over the Nevada demo pivot, B04/B08/SCL resampled to 4x4, plus the validity mask band.
const fixture = new Uint8Array(readFileSync(fileURLToPath(new URL('./__fixtures__/s2-nevada-4x4.npy', import.meta.url))));

describe('parseNpy', () => {
  it('reads the recorded scene', () => {
    const a = parseNpy(fixture);
    expect(a.shape).toEqual([4, 4, 4]);
    expect(Array.from(band(a, 0).slice(0, 2))).toEqual([3591, 4002]);
    expect(band(a, 2)[0]).toBe(5);
    expect(Array.from(band(a, 3)).every((v) => v === 255)).toBe(true);
  });
  it('rejects non-NPY bytes', () => {
    expect(() => parseNpy(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toThrow();
  });
});

describe('Sentinel-2 NDVI', () => {
  it('applies the BOA offset of baseline 04.00 and later only', () => {
    expect(s2Offset('05.12')).toBe(1000);
    expect(s2Offset('03.01')).toBe(0);
    expect(s2Reflectance(2000, 1000)).toBeCloseTo(0.1);
  });
  it('computes NDVI with the offset (it would be biased low without it)', () => {
    const a = parseNpy(fixture);
    const bands = [0, 1, 2].map((b) => band(a, b));
    // Cell 4: red 2452, nir 5013, SCL 4 (vegetation).
    const v = NDVI.cell({ baseline: '05.12' })(bands, 4)!;
    expect(v).toBeCloseTo((4013 - 1452) / (4013 + 1452), 6);
    const raw = NDVI.cell({ baseline: '03.00' })(bands, 4)!;
    expect(raw).toBeLessThan(v);
  });
  it('masks with SCL: keeps vegetation, soil and water, drops cloud, shadow and snow', () => {
    expect([4, 5, 6, 7].every(sclValid)).toBe(true);
    expect([0, 1, 3, 8, 9, 10, 11].some(sclValid)).toBe(false);
    expect(NDVI.cell({ baseline: '05.12' })([new Float64Array([2000]), new Float64Array([4000]), new Float64Array([9])], 0)).toBeNull();
  });
  it('rejects non-physical reflectances', () => {
    expect(normDiff(0, 0.3)).toBeNull();
    expect(normDiff(0.4, 0.1)).toBeCloseTo(0.6);
  });
});

describe('Landsat', () => {
  it('converts ST_B10 to °C and masks with QA_PIXEL', () => {
    expect(landsatLstC(44_000)).toBeCloseTo(44_000 * 0.00341802 + 149 - 273.15, 6);
    expect(landsatLstC(0)).toBeNull();
    expect(landsatClear(21824)).toBe(true); // clear land, typical L8 value
    expect(landsatClear(22280)).toBe(false); // cloud bit set
    expect(landsatClear(1)).toBe(false); // fill
  });
});

describe('grid and quantisation', () => {
  const parcel: Parcel = makeParcel({ id: 't', name: 't', polygon: squareForArea([-115.97, 39.72], 4), source: 'quad' });
  it('covers the bbox plus one cell of margin at about the target size', () => {
    const g = makeGrid(parcel, 10);
    expect(g.width).toBeGreaterThanOrEqual(22);
    expect(g.width).toBeLessThanOrEqual(23);
    expect(g.insideCount).toBeGreaterThan(300);
    expect(g.corners[0][0]).toBeLessThan(parcel.bbox[0]);
    expect(g.corners[2][1]).toBeLessThan(parcel.bbox[1]);
  });
  it('caps the long side at 96 cells', () => {
    const big = makeParcel({ id: 'b', name: 'b', polygon: squareForArea([-115.97, 39.72], 400), source: 'quad' });
    const g = makeGrid(big, 10);
    expect(Math.max(g.width, g.height)).toBeLessThanOrEqual(96);
    expect(g.cellM).toBeGreaterThan(20);
  });
  it('quantises values, writes 255 for no data and measures coverage inside the parcel', () => {
    const g = makeGrid(parcel, 10);
    const vals = Array.from({ length: g.width * g.height }, (_, i) => (i % 2 ? 0.5 : null));
    const q = quantise(vals, g, NDVI);
    expect(q.bytes[0]).toBe(NO_DATA);
    expect(byteToValue(NDVI, q.bytes[1])!).toBeCloseTo(0.5, 2);
    expect(q.coverage).toBeGreaterThan(0.4);
    expect(q.coverage).toBeLessThan(0.6);
    expect(decodeFrame({ t: '2026-01-01', data: btoa(String.fromCharCode(...q.bytes.slice(0, 4))), coverage: 1 }).length).toBe(4);
  });
});

describe('scene selection', () => {
  it('bins newest first, clearest first, and drops scenes outside the window', () => {
    const bins = binScenes(
      [
        { id: 'a', t: '2026-11-10', cloud: 30 },
        { id: 'b', t: '2026-11-05', cloud: 2 },
        { id: 'c', t: '2026-10-01', cloud: 10 },
        { id: 'old', t: '2025-11-01', cloud: 0 },
      ],
      '2026-11-14',
      365,
      15,
    );
    expect(bins.map((b) => b.map((s) => s.id))).toEqual([['b', 'a'], ['c']]);
  });
  it('fits a display range to the values seen', () => {
    expect(fitRange([1, 2], [0, 50])).toEqual([0, 50]);
    expect(fitRange(Array.from({ length: 100 }, (_, i) => 10 + i * 0.2), [0, 50])).toEqual([10, 30]);
  });
});
