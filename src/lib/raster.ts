/**
 * Field rasters: decoding, picking the frame for a date, and painting. Pure and DOM-free, so the
 * map overlay, the metric cards and the cache script all use the same code.
 */
import type { FieldRaster, FieldRasterFrame, ISODate } from '@/contracts';
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

const luts = new WeakMap<FieldRaster, { color: RampColor; lut: Uint8ClampedArray }>();

function lutFor(raster: FieldRaster, color: RampColor): Uint8ClampedArray {
  const hit = luts.get(raster);
  if (hit && hit.color === color) return hit.lut;
  const lut = new Uint8ClampedArray(255 * 3);
  const span = raster.range[1] - raster.range[0] || 1;
  for (let b = 0; b < 255; b++) {
    const pos = Math.max(0, Math.min(1, (raster.offset + raster.scale * b - raster.range[0]) / span));
    const [r, g, bl] = color(pos);
    lut[b * 3] = r;
    lut[b * 3 + 1] = g;
    lut[b * 3 + 2] = bl;
  }
  luts.set(raster, { color, lut });
  return lut;
}

/**
 * Paint the raster as it stands at date `t` into RGBA pixels (`width * height * 4`). Cells without
 * data are transparent. With `blend`, values move linearly from one frame to the next, so the
 * picture changes continuously while the timeline plays. Returns false when there is no frame.
 */
export function paintRaster(raster: FieldRaster, t: ISODate, color: RampColor, out: Uint8ClampedArray, blend = true): boolean {
  const pair = framesAt(raster, t);
  if (!pair) return false;
  const a = decodeFrame(pair.a);
  const b = blend && pair.b && pair.mix > 0 ? decodeFrame(pair.b) : null;
  const lut = lutFor(raster, color);
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
