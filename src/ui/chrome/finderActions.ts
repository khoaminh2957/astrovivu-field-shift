/**
 * What the finder's choices do, in one place so the landing, the box on the map and the search
 * beside an open field all behave the same. Plain functions over the two stores: no React.
 */
import type { LngLat } from '@/contracts';
import { DEMO_FIELD } from '@/data';
import { flyToPoint } from '@/globe';
import { useMission } from '@/state/mission';
import { useMissionUi } from './uiState';

/** A named place lands at the scale where single fields can be told apart and clicked. */
export const PLACE_ZOOM = 15;
/** Typed coordinates are already on the field. */
export const COORDS_ZOOM = 16;

/** Turns "Select on the map" on or off. Turning it on from the landing leaves the landing; the globe stays where it was turned. */
export function setSelectOnMap(on: boolean): void {
  const mission = useMission.getState();
  const ui = useMissionUi.getState();
  mission.cancelDraw();
  if (!on) {
    ui.setListMode('list');
    return;
  }
  if (mission.phase !== 'explore') mission.setPhase('explore');
  ui.setAddWay('map');
  ui.setListMode('add');
}

/**
 * A place from the search. Before a field is open: fly there and wait for the click that picks
 * the field. With a field open the place only moves the map, and the field stays as it is.
 */
export function goToPlace(at: LngLat, zoom: number): void {
  if (!useMission.getState().parcel) setSelectOnMap(true);
  // After the phase change, so this flight replaces the step the globe takes when it leaves the landing.
  flyToPoint(at, zoom);
}

export function openDemoField(): void {
  void useMission.getState().lockSample(DEMO_FIELD.id);
}

/** Opens the field the visitor made in this session; a no-op when there is none. */
export function openOwnField(): void {
  const mission = useMission.getState();
  const own = useMissionUi.getState().ownField;
  if (!own) return;
  if (mission.parcel?.id === own.id) mission.setPhase('locked');
  else void mission.lockParcel(own);
}

/** Back to the landing: nothing open, nothing being drawn. The visitor's own field stays on offer in the search. */
export function goLanding(): void {
  const mission = useMission.getState();
  const ui = useMissionUi.getState();
  ui.setWorkspacePage(null);
  mission.setAskOpen(false);
  mission.cancelDraw();
  ui.setListMode('list');
  if (mission.parcel) mission.unlockParcel();
  mission.setPhase('hero');
  const url = new URL(window.location.href);
  const previous = url.search;
  for (const key of ['phase', 'sample', 'crop']) url.searchParams.delete(key);
  if (url.search !== previous) window.history.replaceState(window.history.state, '', url);
}
