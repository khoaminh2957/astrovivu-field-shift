import { describe, expect, it } from 'vitest';
import type { FieldRaster, PolygonGeometry } from '@/contracts';
import { pointInPolygon, pointInRing } from './geo';
import { NO_DATA, encodeFrame, fieldRange, frameStats, paintRaster, parcelCellMask } from './raster';

// 4 x 4 grid over lng 0..4, lat 0..4 (north-up: row 0 is lat 3..4).
function raster(frames: number[][]): FieldRaster {
  return {
    key: 'ndvi', branch: 'vegetation', label: { en: 'NDVI', vi: 'NDVI' }, unit: '', sourceId: 's2', ramp: 'vegetation', cellM: 10,
    width: 4, height: 4, corners: [[0, 4], [4, 4], [4, 0], [0, 0]], scale: 0.01, offset: 0, range: [0, 1], cadence: '8-day',
    frames: frames.map((b, i) => ({ t: `2026-0${i + 1}-01`, data: encodeFrame(Uint8Array.from(b)), coverage: 1 })),
  } as FieldRaster;
}
// The parcel covers the left half: columns 0-1.
const half: PolygonGeometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]] };

describe('point in polygon', () => {
  it('handles inside, outside and holes', () => {
    expect(pointInRing([1, 1], half.coordinates[0])).toBe(true);
    expect(pointInRing([3, 1], half.coordinates[0])).toBe(false);
    const holed: PolygonGeometry = { type: 'Polygon', coordinates: [half.coordinates[0], [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]] };
    expect(pointInPolygon([1, 1], holed)).toBe(false);
    expect(pointInPolygon([1, 3], holed)).toBe(true);
  });
});

describe('field range', () => {
  const left = (v: number) => [v, v, 200, 200];
  const r = raster([
    [...left(10), ...left(20), ...left(30), ...left(NO_DATA)],
    [...left(40), ...left(50), ...left(60), ...left(70)],
  ]);
  it('masks the cells inside the parcel', () => {
    const m = parcelCellMask(r, half);
    expect(Array.from(m.slice(0, 4))).toEqual([1, 1, 0, 0]);
    expect(m.reduce((a, b) => a + b, 0)).toBe(8);
  });
  it('ignores cells outside the parcel and no-data, over all frames', () => {
    const [lo, hi] = fieldRange(r, half, 0, 1)!;
    expect(lo).toBeCloseTo(0.1);
    expect(hi).toBeCloseTo(0.7);
  });
  it('frame stats use only valid cells inside', () => {
    const s = frameStats(r, r.frames[0], half)!;
    expect(s.n).toBe(6);
    expect(s.min).toBeCloseTo(0.1);
    expect(s.max).toBeCloseTo(0.3);
    expect(s.mean).toBeCloseTo(0.2);
  });
  it('paints with a custom range', () => {
    const out = new Uint8ClampedArray(16 * 4);
    const grey = (p: number): [number, number, number] => [Math.round(p * 255), 0, 0];
    paintRaster(r, '2026-01-01', grey, out, false, [0.1, 0.3]);
    expect(out[0]).toBe(0);
    expect(out[8 * 4]).toBe(255);
    paintRaster(r, '2026-01-01', grey, out, false);
    expect(out[0]).toBe(Math.round(0.1 * 255));
  });
});
