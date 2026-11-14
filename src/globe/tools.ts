/**
 * Map tools: what the toolbar calls and reads. The names and signatures are the contract with the
 * UI. Every command goes to the engine on screen and does nothing before the map exists.
 */
import type { LngLat } from '@/contracts';
import { getActiveGlobe } from './engine';
import { useMapViewStore, useMeasureStore, type MapViewState, type MeasureKind, type MeasureState } from './toolState';

export type { MapViewState, MeasureKind, MeasureState } from './toolState';

/** Pitch of the 3D view the tilt button switches to (the parcel framing uses the same). */
const TILT_PITCH = 54;
const LOCATE_TIMEOUT_MS = 10_000;

export function zoomBy(delta: number): void {
  getActiveGlobe()?.zoomBy(delta);
}

/** Bearing back to north, pitch unchanged. */
export function resetNorth(): void {
  getActiveGlobe()?.ease({ bearing: 0 });
}

/** Turns the map by `deg`, clockwise on screen when positive. */
export function rotateBy(deg: number): void {
  getActiveGlobe()?.rotateBy(deg);
}

/** Pitched 3D view on or off. */
export function setTilt(tilted: boolean): void {
  getActiveGlobe()?.ease({ pitch: tilted ? TILT_PITCH : 0 });
}

/** Frame the locked parcel (or the draft) inside the free part of the screen. */
export function fitParcel(): void {
  getActiveGlobe()?.fitParcel();
}

/** Fly to the device position; resolves to it, or null when geolocation is refused or unavailable. */
export function locateMe(): Promise<LngLat | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at: LngLat = [pos.coords.longitude, pos.coords.latitude];
        // A coarse fix (Wi-Fi, IP) is shown at town scale rather than pretending to field precision.
        getActiveGlobe()?.flyTo(at, pos.coords.accuracy > 500 ? 12 : 15.5);
        resolve(at);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

/** Fly to a place whatever the state (the map search): a locked field stays locked. */
export function flyToPoint(location: LngLat, zoom = 13.5): void {
  getActiveGlobe()?.flyTo(location, zoom);
}

export function setMotion(motion: 'full' | 'reduced'): void {
  getActiveGlobe()?.setMotion(motion);
}

export function startMeasure(kind: MeasureKind): void {
  getActiveGlobe()?.startMeasure(kind);
}

export function stopMeasure(): void {
  getActiveGlobe()?.stopMeasure();
}

/** Camera state for the toolbar, updated at most once per animation frame. */
export function useMapView(): MapViewState {
  return useMapViewStore();
}

export function useMeasure(): MeasureState {
  return useMeasureStore();
}
