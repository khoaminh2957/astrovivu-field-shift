import type { I18nText, ISODate } from './common';
import type { LngLat } from './geo';
import type { BranchId, Cadence } from './telemetry';

/** Colour ramps shared by the map overlay, the metric cards and the legends. */
export type RampId = 'vegetation' | 'moisture' | 'heat' | 'rain' | 'terrain' | 'soil' | 'light' | 'risk';

/** One date of a field raster. */
export interface FieldRasterFrame {
  t: ISODate;
  /** base64 of a Uint8Array, row-major from the north-west corner; 255 means no data (cloud, shadow, outside the scene). */
  data: string;
  /** Share of the cells inside the parcel that hold a valid value, 0..1. */
  coverage: number;
  /** Scene id, for attribution. */
  scene?: string;
}

/**
 * The within-field picture of one metric through time: a stack of small rasters covering the
 * parcel's bounding box at 10-30 m (a single frame for static layers such as terrain). This is
 * what lets a card show the field itself, coloured, changing along the timeline.
 *
 * Values are quantised to bytes: `value = offset + scale * byte`. The grid is north-up in
 * longitude/latitude; the renderer clips it to the parcel polygon.
 */
export interface FieldRaster {
  /** `ndvi`, `ndmi`, `lst`, `elevation`, `slope`, ... A raster key may equal a `Series.key` of the same quantity. */
  key: string;
  branch: BranchId;
  label: I18nText;
  unit: string;
  sourceId: string;
  ramp: RampId;
  /** Ground size of one cell, metres. */
  cellM: number;
  width: number;
  height: number;
  /** Grid corners in lng/lat: north-west, north-east, south-east, south-west. */
  corners: [LngLat, LngLat, LngLat, LngLat];
  scale: number;
  offset: number;
  /** Display range in real units, for the ramp and the legend. */
  range: [min: number, max: number];
  cadence: Cadence;
  /** Ascending by date. */
  frames: FieldRasterFrame[];
}

/** Screen space covered by panels, in CSS pixels. The globe frames the parcel inside what is left. */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
