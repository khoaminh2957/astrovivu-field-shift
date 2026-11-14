/**
 * Map tools: what the toolbar calls and reads. PLACEHOLDER IMPLEMENTATION (owner: globe agent);
 * the names and signatures are the contract with the UI.
 */
import type { LngLat } from '@/contracts';

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

export function zoomBy(_delta: number): void {}
/** Bearing back to north, pitch unchanged. */
export function resetNorth(): void {}
/** Pitched 3D view on or off. */
export function setTilt(_tilted: boolean): void {}
/** Frame the locked parcel (or the draft) inside the free part of the screen. */
export function fitParcel(): void {}
/** Fly to the device position; resolves to it, or null when geolocation is refused or unavailable. */
export function locateMe(): Promise<LngLat | null> {
  return Promise.resolve(null);
}
export function setMotion(_motion: 'full' | 'reduced'): void {}
export function startMeasure(_kind: MeasureKind): void {}
export function stopMeasure(): void {}

/** Camera state for the toolbar, updated at most once per animation frame. */
export function useMapView(): MapViewState {
  return { zoom: 0, bearing: 0, pitch: 0, tilted: false, motion: 'full' };
}

export function useMeasure(): MeasureState {
  return { kind: null, points: [], value: null };
}
