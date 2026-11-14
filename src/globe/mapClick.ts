/**
 * Plain map clicks for the UI (select a field, "select on the map"). The engine reports every
 * click that is not a drag; listeners decide what it means. Returns an unsubscribe function.
 */
import type { LngLat } from '@/contracts';

type Listener = (at: LngLat) => void;
const listeners = new Set<Listener>();

export function onMapClick(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitMapClick(at: LngLat): void {
  for (const fn of [...listeners]) fn(at);
}
