import { describe, expect, it } from 'vitest';
import type { FieldRaster, Parcel } from '@/contracts';
import { decodeFrame, encodeFrame, valueToByte } from '@/lib/raster';
import { computeFieldZones } from './index';

// 30 x 10 cells of 10 m (~0.0001 deg) at the equator; the parcel covers the whole grid.
const W = 30;
const H = 10;
const D = 10 / 111_320;
const parcel: Parcel = {
  id: 't',
  name: 't',
  polygon: { type: 'Polygon', coordinates: [[[-D, D], [W * D + D, D], [W * D + D, -H * D - D], [-D, -H * D - D], [-D, D]]] },
  centroid: [(W * D) / 2, (-H * D) / 2],
  bbox: [0, -H * D, W * D, 0],
  areaHa: 3,
  source: 'quad',
  isUS: false,
};
const enc = { scale: 2 / 254, offset: -1 };

function raster(frames: { t: string; at: (c: number, r: number) => number | null }[]): FieldRaster {
  return {
    key: 'ndvi',
    branch: 'vegetation',
    label: { en: 'NDVI', vi: 'NDVI' },
    unit: 'NDVI',
    sourceId: 'sentinel-2-l2a',
    ramp: 'vegetation',
    cellM: 10,
    width: W,
    height: H,
    corners: [[0, 0], [W * D, 0], [W * D, -H * D], [0, -H * D]],
    ...enc,
    range: [0, 1],
    cadence: '16-day',
    frames: frames.map(({ t, at }) => {
      const b = new Uint8Array(W * H);
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) b[r * W + c] = valueToByte(enc, at(c, r));
      return { t, data: encodeFrame(b), coverage: 1 };
    }),
  };
}

// Three column blocks at 75 %, 100 % and 125 % of the field mean, scaled per date.
const gradient = (scale: number) => (c: number) => scale * (c < 10 ? 0.45 : c < 20 ? 0.6 : 0.75);

describe('computeFieldZones', () => {
  it('splits a known gradient into three equal zones', () => {
    const z = computeFieldZones(raster([0.7, 1, 1.2].map((s, i) => ({ t: `2026-0${i + 5}-01`, at: gradient(s) }))), parcel)!;
    expect(z.framesUsed).toHaveLength(3);
    expect(z.zones.map((x) => x.id)).toEqual(['high', 'medium', 'low']);
    for (const x of z.zones) {
      expect(x.areaHa).toBeCloseTo(1, 2);
      expect(x.sharePct).toBeCloseTo(33.3, 0);
    }
    expect(z.zones[0].deviationPct).toBeCloseTo(25, 0);
    expect(z.zones[2].deviationPct).toBeCloseTo(-25, 0);
    expect(z.stableSharePct).toBe(100);
    const bytes = decodeFrame(z.raster.frames[0]);
    expect([bytes[0], bytes[15], bytes[29]]).toEqual([0, 1, 2]);
    expect(z.method.en).toMatch(/not yield/);
  });

  it('leaves a uniform field almost entirely medium', () => {
    const z = computeFieldZones(raster([1, 2, 3].map((i) => ({ t: `2026-0${i + 5}-01`, at: (c, r) => 0.6 + ((c + r) % 3) * 0.01 }))), parcel)!;
    expect(z.zones[1].sharePct).toBeGreaterThan(95);
  });

  it('uses only the dates passed in opts.frames, and skips bare-soil dates by default', () => {
    const r = raster([
      { t: '2026-03-01', at: () => 0.15 },
      { t: '2026-06-01', at: gradient(1) },
      { t: '2026-07-01', at: (c) => (c < 15 ? 0.8 : 0.4) },
    ]);
    expect(computeFieldZones(r, parcel)!.framesUsed).toEqual(['2026-06-01', '2026-07-01']);
    const only = computeFieldZones(r, parcel, { frames: ['2026-06-01'] })!;
    expect(only.framesUsed).toEqual(['2026-06-01']);
    expect(only.stableSharePct).toBeNull();
    expect(only.zones[0].sharePct).toBeCloseTo(33.3, 0);
  });

  it('returns null without usable data', () => {
    expect(computeFieldZones(raster([]), parcel)).toBeNull();
    expect(computeFieldZones(raster([{ t: '2026-06-01', at: () => null }]), parcel)).toBeNull();
  });
});
