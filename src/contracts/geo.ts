import type { I18nText } from './common';
import type { GroundTruth } from './model';

export type LngLat = [lng: number, lat: number];
export type BBox = [west: number, south: number, east: number, north: number];

/** GeoJSON polygon; `coordinates[0]` is the closed outer ring (first vertex repeated last). */
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: LngLat[][];
}

/** How the parcel was defined: a pre-cached sample, 4 tapped corners, typed coordinates, or device GPS. */
export type ParcelSource = 'sample' | 'quad' | 'coords' | 'gps';
export type DrawMode = 'quad' | 'coords' | 'gps';

export interface PlaceInfo {
  label: string;
  country?: string;
  countryCode?: string;
  admin1?: string;
}

export interface Parcel {
  id: string;
  name: string;
  polygon: PolygonGeometry;
  centroid: LngLat;
  bbox: BBox;
  areaHa: number;
  source: ParcelSource;
  place?: PlaceInfo;
  /** Enables the US-only sources (SSURGO, Cropland Data Layer, Crop-CASMA, Daymet). */
  isUS: boolean;
  elevationM?: number;
}

/** Work-in-progress boundary while the user is drawing or adjusting vertices. */
export interface ParcelDraft {
  mode: DrawMode;
  vertices: LngLat[];
  closed: boolean;
  areaHa: number | null;
}

/** A demo field whose telemetry is pre-cached so the story plays instantly. */
export interface SampleParcel extends Parcel {
  tagline: I18nText;
  story: I18nText;
  defaultCropId: string;
  /** Assumed farm profile a demo field starts with (irrigation, rotation); the user can change it, Reset returns to it. */
  defaultGroundTruth?: GroundTruth;
}

export interface PlaceHit {
  label: string;
  location: LngLat;
  country?: string;
  admin1?: string;
}
