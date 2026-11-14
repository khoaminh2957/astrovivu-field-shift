/**
 * Field rasters: decoding, picking the frame for a date, and painting. Pure and DOM-free, so the
 * map overlay, the metric cards and the cache script all use the same code.
 */
import type { FieldRaster, FieldRasterFrame, ISODate, PolygonGeometry } from '@/contracts';
import { pointInPolygon } from './geo';
import { diffDays } from './time';

export const NO_DATA = 255;

const decoded = new WeakMap<FieldRasterFrame, Uint8Array>();

export function decodeFrame(frame: FieldRasterFrame): Uint8Array {
  let bytes = decoded.get(frame);
  if (!bytes) {
    const bin = atob(frame.data);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    decoded.set(frame, bytes);
  }
  return bytes;
}

export function encodeFrame(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Quantise a real value to a byte of this raster (254 is the largest valid byte). */
export function valueToByte(raster: Pick<FieldRaster, 'scale' | 'offset'>, value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return NO_DATA;
  return Math.max(0, Math.min(254, Math.round((value - raster.offset) / raster.scale)));
}

export const byteToValue = (raster: Pick<FieldRaster, 'scale' | 'offset'>, byte: number): number | null =>
  byte === NO_DATA ? null : raster.offset + raster.scale * byte;

export interface FramePair {
  a: FieldRasterFrame;
  /** The next frame, to blend toward; null at the end of the stack. */
  b: FieldRasterFrame | null;
  /** 0 = frame `a`, 1 = frame `b`. */
  mix: number;
  /** Days from frame `a` to the date asked for (negative before the first frame). */
  ageDays: number;
}

/** The frame at or before `t` and the one after it, so playback can blend between dates. */
export function framesAt(raster: FieldRaster, t: ISODate): FramePair | null {
  const f = raster.frames;
  if (!f.length) return null;
  let i = -1;
  for (let k = 0; k < f.length; k++) {
    if (f[k].t <= t) i = k;
    else break;
  }
  if (i < 0) return { a: f[0], b: null, mix: 0, ageDays: diffDays(t, f[0].t) };
  const a = f[i];
  const b = f[i + 1] ?? null;
  const span = b ? diffDays(b.t, a.t) : 0;
  const ageDays = diffDays(t, a.t);
  return { a, b, mix: b && span > 0 ? Math.max(0, Math.min(1, ageDays / span)) : 0, ageDays };
}

export type RampColor = (position: number) => [r: number, g: number, b: number];

const luts = new WeakMap<FieldRaster, { color: RampColor; lo: number; hi: number; lut: Uint8ClampedArray }>();

function lutFor(raster: FieldRaster, color: RampColor, range: [number, number] = raster.range): Uint8ClampedArray {
  const hit = luts.get(raster);
  if (hit && hit.color === color && hit.lo === range[0] && hit.hi === range[1]) return hit.lut;
  const lut = new Uint8ClampedArray(255 * 3);
  const span = range[1] - range[0] || 1;
  for (let b = 0; b < 255; b++) {
    const pos = Math.max(0, Math.min(1, (raster.offset + raster.scale * b - range[0]) / span));
    const [r, g, bl] = color(pos);
    lut[b * 3] = r;
    lut[b * 3 + 1] = g;
    lut[b * 3 + 2] = bl;
  }
  luts.set(raster, { color, lo: range[0], hi: range[1], lut });
  return lut;
}

/**
 * Paint the raster as it stands at date `t` into RGBA pixels (`width * height * 4`). Cells without
 * data are transparent. With `blend`, values move linearly from one frame to the next, so the
 * picture changes continuously while the timeline plays. Returns false when there is no frame.
 */
export function paintRaster(raster: FieldRaster, t: ISODate, color: RampColor, out: Uint8ClampedArray, blend = true, range?: [number, number]): boolean {
  const pair = framesAt(raster, t);
  if (!pair) return false;
  const a = decodeFrame(pair.a);
  const b = blend && pair.b && pair.mix > 0 ? decodeFrame(pair.b) : null;
  const lut = lutFor(raster, color, range);
  const n = raster.width * raster.height;
  for (let i = 0; i < n; i++) {
    let v = a[i];
    if (b) {
      const vb = b[i];
      if (v === NO_DATA) v = vb;
      else if (vb !== NO_DATA) v = Math.round(v + (vb - v) * pair.mix);
    }
    const o = i * 4;
    if (v === NO_DATA || v === undefined) {
      out[o + 3] = 0;
      continue;
    }
    out[o] = lut[v * 3];
    out[o + 1] = lut[v * 3 + 1];
    out[o + 2] = lut[v * 3 + 2];
    out[o + 3] = 255;
  }
  return true;
}

/** Mean of the valid cells at date `t`, in real units (no blending). */
export function rasterMean(raster: FieldRaster, t: ISODate): number | null {
  const pair = framesAt(raster, t);
  if (!pair) return null;
  const a = decodeFrame(pair.a);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== NO_DATA) {
      sum += a[i];
      n++;
    }
  }
  return n ? raster.offset + raster.scale * (sum / n) : null;
}

/** Cell centres of the raster grid in lng/lat (the grid is north-up between its NW and SE corners). */
function cellCentre(raster: Pick<FieldRaster, 'corners' | 'width' | 'height'>, i: number): [number, number] {
  const [nw, , se] = raster.corners;
  const x = i % raster.width;
  const y = Math.floor(i / raster.width);
  return [nw[0] + ((x + 0.5) / raster.width) * (se[0] - nw[0]), nw[1] + ((y + 0.5) / raster.height) * (se[1] - nw[1])];
}

const masks = new WeakMap<FieldRaster, { polygon: PolygonGeometry; mask: Uint8Array }>();

/** 1 for cells whose centre lies inside the parcel, else 0. Cached per raster and polygon. */
export function parcelCellMask(raster: FieldRaster, polygon: PolygonGeometry): Uint8Array {
  const hit = masks.get(raster);
  if (hit && hit.polygon === polygon) return hit.mask;
  const n = raster.width * raster.height;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = pointInPolygon(cellCentre(raster, i), polygon) ? 1 : 0;
  masks.set(raster, { polygon, mask });
  return mask;
}

const fieldRanges = new WeakMap<FieldRaster, { polygon: PolygonGeometry; range: [number, number] | null }>();

/**
 * This field's own display range: the 2nd to 98th percentile of the valid cells inside the parcel
 * over every frame of the stack, so a stretched picture still rises and falls through the season.
 * Null when fewer than 2 distinct values exist.
 */
export function fieldRange(raster: FieldRaster, polygon: PolygonGeometry, lo = 0.02, hi = 0.98): [number, number] | null {
  const hit = fieldRanges.get(raster);
  if (hit && hit.polygon === polygon) return hit.range;
  const mask = parcelCellMask(raster, polygon);
  const hist = new Uint32Array(255);
  let n = 0;
  for (const f of raster.frames) {
    const bytes = decodeFrame(f);
    for (let i = 0; i < bytes.length; i++) {
      if (!mask[i] || bytes[i] === NO_DATA) continue;
      hist[bytes[i]]++;
      n++;
    }
  }
  let range: [number, number] | null = null;
  if (n > 0) {
    const at = (q: number) => {
      const target = q * (n - 1);
      let acc = 0;
      for (let b = 0; b < 255; b++) {
        acc += hist[b];
        if (acc > target) return b;
      }
      return 254;
    };
    const a = at(lo);
    const b = at(hi);
    if (b > a) range = [raster.offset + raster.scale * a, raster.offset + raster.scale * b];
  }
  fieldRanges.set(raster, { polygon, range });
  return range;
}

/** Mean, min and max of the valid cells inside the parcel for one frame (no blending). */
export function frameStats(raster: FieldRaster, frame: FieldRasterFrame, polygon: PolygonGeometry): { mean: number; min: number; max: number; n: number } | null {
  const mask = parcelCellMask(raster, polygon);
  const bytes = decodeFrame(frame);
  let sum = 0, n = 0, mn = 255, mx = -1;
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    if (!mask[i] || v === NO_DATA) continue;
    sum += v;
    n++;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (!n) return null;
  const val = (b: number) => raster.offset + raster.scale * b;
  return { mean: val(sum / n), min: val(mn), max: val(mx), n };
}

/**
 * The range a picture is painted over: the raster's own fixed range, or this field's range
 * (dated rasters only; a single-frame layer such as terrain keeps its own min and max).
 */
export function displayRange(raster: FieldRaster, polygon: PolygonGeometry | null | undefined, stretch: 'fixed' | 'field' | undefined): [number, number] {
  if (stretch === 'fixed' || !polygon || raster.frames.length < 2) return raster.range;
  return fieldRange(raster, polygon) ?? raster.range;
}
