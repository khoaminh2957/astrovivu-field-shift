/**
 * Plain map clicks for the UI (select a field, "select on the map"). The engine reports every
 * click that is not a drag; listeners decide what it means. Returns an unsubscribe function.
 */
import type { LngLat } from '@/contracts';

export interface MapClickMods {
  altKey: boolean;
  shiftKey: boolean;
}

type Listener = (at: LngLat, mods: MapClickMods) => void;
const listeners = new Set<Listener>();

export function onMapClick(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitMapClick(at: LngLat, ev?: MouseEvent): void {
  const mods: MapClickMods = { altKey: !!ev?.altKey, shiftKey: !!ev?.shiftKey };
  for (const fn of [...listeners]) fn(at, mods);
}
