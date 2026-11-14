/**
 * State the map publishes for its toolbar and legend. Kept apart from the engine so the hooks in
 * `tools.ts` can be imported without pulling MapLibre into a component's module graph.
 */
import { create } from 'zustand';
import type { I18nText, ISODate, LngLat } from '@/contracts';

export interface MapViewState {
  zoom: number;
  bearing: number;
  pitch: number;
  /** True when the camera is pitched for 3D terrain. */
  tilted: boolean;
  /** Camera flights and globe rotation: animated, or cut. */
  motion: 'full' | 'reduced';
}

export type MeasureKind = 'distance' | 'area';

export interface MeasureState {
  kind: MeasureKind | null;
  points: LngLat[];
  /** Metres for distance, hectares for area; null until there are enough points. */
  value: number | null;
}

/** What the parcel is painted with right now, so a legend beside the map can match it exactly. */
export interface ParcelPaintInfo {
  /** `raster`: the within-field picture; `series`: one colour from the field-mean series. */
  source: 'raster' | 'series';
  key: string;
  label: I18nText | null;
  unit: string;
  /** CSS `background` value for a left-to-right legend bar. */
  rampCss: string;
  range: [min: number, max: number];
  /** Date of the picture shown (raster frame or series sample); null when there is none. */
  date: ISODate | null;
  /** When the raster is blended toward the next frame: that frame's date. */
  nextDate: ISODate | null;
}

/** Pitch above which the view counts as tilted. */
export const TILT_THRESHOLD = 8;

export const useMapViewStore = create<MapViewState>()(() => ({ zoom: 0, bearing: 0, pitch: 0, tilted: false, motion: 'full' }));
export const useMeasureStore = create<MeasureState>()(() => ({ kind: null, points: [], value: null }));
export const useParcelPaintStore = create<{ paint: ParcelPaintInfo | null }>()(() => ({ paint: null }));
