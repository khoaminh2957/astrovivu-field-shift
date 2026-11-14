/**
 * What the parcel is painted with, for a legend drawn by the UI next to the map: ramp, range,
 * unit and the date of the picture shown. Changes only when one of those changes.
 */
import { useParcelPaintStore, type ParcelPaintInfo } from './toolState';

export type { ParcelPaintInfo } from './toolState';

export function useParcelPaint(): ParcelPaintInfo | null {
  return useParcelPaintStore((s) => s.paint);
}
