/**
 * How the crop differs across the field, for the stage: the latest NDVI picture of the parcel
 * (Sentinel-2 field raster, 10 m) laid over the stage's grid of plants. Each patch is the ratio of
 * its cell to the parcel mean of that date, the same measure as the within-field zones
 * (`src/core/zones`), so a uniform field stays uniform and a field with a weak corner shows it.
 *
 * The stage is a drawing, not a map: its far rows stand for the north of the field and its left
 * column for the west, and the grid is stretched over the parcel's extent.
 */
import type { FieldRaster, ISODate, Parcel } from '@/contracts';
import { NO_DATA, decodeFrame, parcelCellMask } from '@/lib/raster';
import { diffDays } from '@/lib/time';

/** A picture older than this does not say how the crop stands today. A project choice. */
export const PATCH_MAX_AGE_DAYS = 45;
/** Same bands as the zones (`src/core/zones`): below 0.93 of the field mean is low, above 1.07 high. */
export const PATCH_LOW = 0.93;
export const PATCH_HIGH = 1.07;
/** Fewer valid cells than this inside the parcel and the picture says nothing about variation. */
const MIN_CELLS = 8;

export interface FieldPatches {
  rows: number;
  cols: number;
  /** Ratio to the parcel mean, row by row from the far (north) row, each row west to east. */
  ratio: number[];
  /** Date of the picture used. */
  date: ISODate;
  sourceId: string;
  /** Share of the patches below, inside and above the bands, 0..1. */
  shares: { low: number; medium: number; high: number };
}

export function fieldPatches(raster: FieldRaster | undefined, parcel: Pick<Parcel, 'polygon'>, day: ISODate, rows: number, cols: number): FieldPatches | null {
  if (!raster || rows < 1 || cols < 1) return null;
  const frame = [...raster.frames].reverse().find((f) => f.t <= day);
  if (!frame || diffDays(day, frame.t) > PATCH_MAX_AGE_DAYS) return null;
  const bytes = decodeFrame(frame);
  const mask = parcelCellMask(raster, parcel.polygon);
  const { width: w, height: h } = raster;
  const value = (i: number): number | null => (mask[i] && bytes[i] !== NO_DATA ? raster.offset + raster.scale * bytes[i] : null);

  let sum = 0;
  let n = 0;
  let minR = h, maxR = -1, minC = w, maxC = -1;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const v = value(r * w + c);
      if (v == null) continue;
      sum += v;
      n++;
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
    }
  const mean = n ? sum / n : 0;
  if (n < MIN_CELLS || mean <= 0) return null;

  // The nearest valid cell to a point of the parcel's extent: the grid is coarser or finer than the raster.
  const nearest = (fr: number, fc: number): number | null => {
    const r0 = Math.round(fr);
    const c0 = Math.round(fc);
    for (let d = 0; d <= 3; d++)
      for (let dr = -d; dr <= d; dr++)
        for (let dc = -d; dc <= d; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
          const r = r0 + dr;
          const c = c0 + dc;
          if (r < 0 || c < 0 || r >= h || c >= w) continue;
          const v = value(r * w + c);
          if (v != null) return v;
        }
    return null;
  };

  const ratio: number[] = [];
  let low = 0;
  let high = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const fr = minR + ((r + 0.5) / rows) * (maxR - minR + 1) - 0.5;
      const fc = minC + ((c + 0.5) / cols) * (maxC - minC + 1) - 0.5;
      const v = nearest(fr, fc);
      const k = v == null ? 1 : v / mean;
      ratio.push(k);
      if (k < PATCH_LOW) low++;
      else if (k > PATCH_HIGH) high++;
    }
  const total = rows * cols;
  return { rows, cols, ratio, date: frame.t, sourceId: raster.sourceId, shares: { low: low / total, medium: (total - low - high) / total, high: high / total } };
}
