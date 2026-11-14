/**
 * Pure parts of the field-raster pipeline: NPY parsing, the output grid, spectral indices with
 * the right reflectance offsets, cloud masks, quantisation and scene selection. No network here,
 * so all of it is unit-tested against a recorded fixture.
 */
import type { BBox, FieldRaster, ISODate, LngLat, PolygonGeometry } from '@/contracts';
import { NO_DATA, valueToByte } from '@/lib/raster';
import { diffDays } from '@/lib/time';
import { pointInPolygon } from '../harmonize/zonal';

// ---------------------------------------------------------------- NPY

export interface NpyArray {
  shape: number[];
  data: Float64Array;
}

/** Parse a NumPy .npy (v1-v3, little-endian u1/u2/i2/u4/i4/f4/f8, C order). */
export function parseNpy(bytes: Uint8Array): NpyArray {
  if (bytes[0] !== 0x93 || String.fromCharCode(...bytes.slice(1, 6)) !== 'NUMPY') throw new Error('Not an NPY array');
  const major = bytes[6];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hlen = major === 1 ? dv.getUint16(8, true) : dv.getUint32(8, true);
  const hstart = major === 1 ? 10 : 12;
  const header = new TextDecoder().decode(bytes.subarray(hstart, hstart + hlen));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const shapeStr = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? '';
  if (/'fortran_order':\s*True/.test(header)) throw new Error('Fortran-order NPY not supported');
  const shape = shapeStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const n = shape.reduce((a, b) => a * b, 1);
  const off = hstart + hlen;
  const out = new Float64Array(n);
  const read: Record<string, [number, (o: number) => number]> = {
    '|u1': [1, (o) => dv.getUint8(o)],
    '<u2': [2, (o) => dv.getUint16(o, true)],
    '<i2': [2, (o) => dv.getInt16(o, true)],
    '<u4': [4, (o) => dv.getUint32(o, true)],
    '<i4': [4, (o) => dv.getInt32(o, true)],
    '<f4': [4, (o) => dv.getFloat32(o, true)],
    '<f8': [8, (o) => dv.getFloat64(o, true)],
  };
  const r = descr ? read[descr] : undefined;
  if (!r) throw new Error(`Unsupported NPY dtype ${descr}`);
  if (off + n * r[0] > bytes.byteLength) throw new Error('Truncated NPY array');
  for (let i = 0; i < n; i++) out[i] = r[1](off + i * r[0]);
  return { shape, data: out };
}

/** Band `b` of a (bands, rows, cols) array. */
export const band = (a: NpyArray, b: number): Float64Array => {
  const size = a.shape[1] * a.shape[2];
  return a.data.subarray(b * size, (b + 1) * size);
};

// ---------------------------------------------------------------- grid

export interface RasterGrid {
  bbox: BBox;
  width: number;
  height: number;
  cellM: number;
  corners: FieldRaster['corners'];
  /** 1 where the cell centre lies inside the parcel. */
  inside: Uint8Array;
  insideCount: number;
}

const M_PER_DEG = 111_320;

/**
 * North-up lng/lat grid over the parcel bounding box plus one cell of margin, with cells near
 * `targetM` and at most `maxSide` on the long side (cells grow for large parcels).
 */
export function makeGrid(parcel: { bbox: BBox; polygon: PolygonGeometry; centroid: LngLat }, targetM: number, maxSide = 96): RasterGrid {
  const coslat = Math.cos((parcel.centroid[1] * Math.PI) / 180);
  const [w0, s0, e0, n0] = parcel.bbox;
  const wM = (e0 - w0) * M_PER_DEG * coslat;
  const hM = (n0 - s0) * M_PER_DEG;
  let cellM = targetM;
  if (Math.max(wM, hM) / cellM + 2 > maxSide) cellM = Math.max(wM, hM) / (maxSide - 2);
  const width = Math.max(3, Math.ceil(wM / cellM) + 2);
  const height = Math.max(3, Math.ceil(hM / cellM) + 2);
  const dLng = cellM / (M_PER_DEG * coslat);
  const dLat = cellM / M_PER_DEG;
  const cx = (w0 + e0) / 2;
  const cy = (s0 + n0) / 2;
  const west = cx - (width * dLng) / 2;
  const north = cy + (height * dLat) / 2;
  const east = west + width * dLng;
  const south = north - height * dLat;
  const inside = new Uint8Array(width * height);
  let insideCount = 0;
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++)
      if (pointInPolygon([west + (c + 0.5) * dLng, north - (r + 0.5) * dLat], parcel.polygon)) {
        inside[r * width + c] = 1;
        insideCount++;
      }
  if (insideCount === 0) {
    // Parcel smaller than a cell: count the centre cell.
    inside[Math.floor(height / 2) * width + Math.floor(width / 2)] = 1;
    insideCount = 1;
  }
  const r6 = (v: number) => Math.round(v * 1e7) / 1e7;
  return {
    bbox: [west, south, east, north],
    width,
    height,
    cellM: Math.round(cellM * 10) / 10,
    corners: [
      [r6(west), r6(north)],
      [r6(east), r6(north)],
      [r6(east), r6(south)],
      [r6(west), r6(south)],
    ],
    inside,
    insideCount,
  };
}

// ---------------------------------------------------------------- indices and masks

/**
 * Sentinel-2 L2A digital numbers to surface reflectance. Processing baseline 04.00 and later
 * (from 2022-01-25) add BOA_ADD_OFFSET = -1000 to every band; earlier baselines have none.
 */
export function s2Offset(baseline: string | undefined): number {
  const b = Number(baseline);
  return Number.isFinite(b) && b >= 4 ? 1000 : 0;
}
export const s2Reflectance = (dn: number, offset: number): number => (dn - offset) / 10_000;

/** SCL classes kept: 4 vegetation, 5 bare soil, 6 water, 7 unclassified, 11 is snow (dropped). */
const SCL_VALID = new Set([4, 5, 6, 7]);
export const sclValid = (scl: number): boolean => SCL_VALID.has(Math.round(scl));

/** Normalised difference of two reflectances; null when the pair is not physical. */
export function normDiff(a: number, b: number): number | null {
  if (!(a > 0) || !(b > 0) || a > 1.5 || b > 1.5) return null;
  const d = a + b;
  return d > 0 ? (a - b) / d : null;
}

/**
 * Landsat Collection 2 QA_PIXEL: bit 0 fill, 1 dilated cloud, 2 cirrus, 3 cloud, 4 shadow,
 * 5 snow. A pixel is kept only when none of those is set.
 */
export const landsatClear = (qa: number): boolean => qa !== 0 && (Math.round(qa) & 0b111111) === 0;

/** Landsat C2 L2 ST_B10: kelvin = DN * 0.00341802 + 149.0; 0 is fill. Returned in °C. */
export const landsatLstC = (dn: number): number | null => (dn > 0 ? dn * 0.00341802 + 149.0 - 273.15 : null);

// ---------------------------------------------------------------- frames

export interface FrameResult {
  bytes: Uint8Array;
  coverage: number;
  /** Mean of valid cells inside the parcel, real units. */
  mean: number | null;
}

/** Quantise per-cell values (null = no data) and measure coverage inside the parcel. */
export function quantise(values: (number | null)[], grid: RasterGrid, enc: Pick<FieldRaster, 'scale' | 'offset'>): FrameResult {
  const bytes = new Uint8Array(values.length);
  let valid = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    bytes[i] = valueToByte(enc, v);
    if (grid.inside[i] && bytes[i] !== NO_DATA && v != null) {
      valid++;
      sum += v;
    }
  }
  return { bytes, coverage: Math.round((valid / grid.insideCount) * 1000) / 1000, mean: valid ? sum / valid : null };
}

// ---------------------------------------------------------------- scene selection

export interface SceneCandidate {
  id: string;
  t: ISODate;
  cloud: number;
}

/**
 * Split the window into bins of `binDays` counted back from `end`, and order the candidates of
 * each bin clearest first. Bins come newest first; empty bins are dropped. One frame is taken per
 * bin, so frames stay spread through the year instead of clustering in dry months.
 */
export function binScenes(scenes: SceneCandidate[], end: ISODate, days: number, binDays: number): SceneCandidate[][] {
  const bins: SceneCandidate[][] = [];
  for (const s of scenes) {
    const age = diffDays(end, s.t);
    if (age < 0 || age >= days) continue;
    const k = Math.floor(age / binDays);
    (bins[k] ??= []).push(s);
  }
  return bins.filter(Boolean).map((b) => b.sort((x, y) => x.cloud - y.cloud || (y.t < x.t ? -1 : 1)));
}
