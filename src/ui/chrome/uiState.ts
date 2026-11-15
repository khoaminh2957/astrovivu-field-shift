/**
 * Presentation state of the mission screens that no other layer needs: which panel is open and
 * whether the timeline is moving. Kept out of the mission store on purpose; the store holds the
 * mission, this holds the screen.
 */
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { Parcel } from '@/contracts';

export type MapPopover = 'layers' | 'measure' | null;
export type FieldTab = 'overview' | 'soil' | 'data';
export type WorkspacePage = 'home';
/**
 * What the decision steps show. ② Rotation: the farm stage, the comparison of strategies, the plan
 * of the year. ③ Dossier: how the answer was reached, on one sheet. Both live in the advisory phase.
 */
export type AdvisoryView = 'farm' | 'compare' | 'plan' | 'dossier';
export const ADVISORY_VIEWS: AdvisoryView[] = ['farm', 'compare', 'plan', 'dossier'];

/** A deep link may name the view (`?view=compare`); anything else opens on the farm. */
function viewFromUrl(): AdvisoryView {
  if (typeof window === 'undefined') return 'farm';
  const v = new URLSearchParams(window.location.search).get('view');
  return ADVISORY_VIEWS.includes(v as AdvisoryView) ? (v as AdvisoryView) : 'farm';
}

export interface MissionUiState {
  workspacePage: WorkspacePage | null;
  setWorkspacePage(page: WorkspacePage | null): void;
  advisoryView: AdvisoryView;
  setAdvisoryView(view: AdvisoryView): void;
  /** Soil-and-practice section expanded (the older single-column summary). */
  overrideOpen: boolean;
  /** Tab of the field panel: how the field is, what the grower knows of it, where the numbers come from. */
  fieldTab: FieldTab;
  setFieldTab(tab: FieldTab): void;
  /** Fields (by id) whose three opening questions the visitor closed; they stay closed for the session. */
  quickClosed: Record<string, true>;
  closeQuick(parcelId: string): void;
  /** Narrow: the sheet covers the map except a strip at the top. */
  sheetFull: boolean;
  setSheetFull(on: boolean): void;
  /** The add-a-field step is open: in the list column beside an open field, above the finder box before one. */
  listMode: 'list' | 'add';
  setListMode(mode: 'list' | 'add'): void;
  /** How the add-field step finds the field: set by what opened the step, switchable in the step. */
  addWay: 'address' | 'map';
  setAddWay(way: 'address' | 'map'): void;
  /** The field the visitor made in this session, kept so the list and the search can offer it again after another field is opened. */
  ownField: Parcel | null;
  setOwnField(parcel: Parcel | null): void;
  /** Wide screens, with a field open: the list column is folded away and the map has its room. */
  listFolded: boolean;
  setListFolded(folded: boolean): void;
  /** Before a field is open: the add-a-field step shows as its card (on the left edge of a wide screen), not as its one-line hint. */
  addCard: boolean;
  setAddCard(open: boolean): void;
  /** Height in px of the finder (its box and whatever is open above it), measured by the finder; 0 when it is not on screen. */
  finderH: number;
  setFinderH(h: number): void;
  /** The legend of what the field is painted with is shown on the map. */
  legendOpen: boolean;
  setLegendOpen(open: boolean): void;
  /** Which map-toolbar popover is open. */
  mapPopover: MapPopover;
  /** Playback driven by requestAnimationFrame in the scrubber (smoother than the store's interval). */
  playing: boolean;
  /** Days per second at 1×. */
  speed: 1 | 2 | 4;
  /** The pointer is on the scrubber: instruments follow with no easing. */
  scrubbing: boolean;
  setOverrideOpen(open: boolean): void;
  setMapPopover(p: MapPopover): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: 1 | 2 | 4): void;
  setScrubbing(on: boolean): void;
}

const FOLD_KEY = 'astrovivu.listFolded';

/** Session storage can be refused (private mode, an embedded pane): the fold then lasts until the page reloads. */
function storedFold(): boolean {
  try {
    return sessionStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

function storeFold(folded: boolean): void {
  try {
    sessionStorage.setItem(FOLD_KEY, folded ? '1' : '0');
  } catch {
    // Not remembered across a reload; the state in memory still holds.
  }
}

export const useMissionUi = create<MissionUiState>()((set) => ({
  workspacePage: null,
  setWorkspacePage: (workspacePage) => set({ workspacePage }),
  advisoryView: viewFromUrl(),
  setAdvisoryView: (advisoryView) => set({ advisoryView }),
  overrideOpen: false,
  fieldTab: 'overview',
  setFieldTab: (fieldTab) => set({ fieldTab }),
  quickClosed: {},
  closeQuick: (parcelId) => set((s) => ({ quickClosed: { ...s.quickClosed, [parcelId]: true } })),
  mapPopover: null,
  listMode: 'list',
  setListMode: (listMode) => set({ listMode }),
  addWay: 'address',
  setAddWay: (addWay) => set({ addWay }),
  ownField: null,
  setOwnField: (ownField) => set({ ownField }),
  listFolded: storedFold(),
  setListFolded: (listFolded) => {
    storeFold(listFolded);
    set({ listFolded });
  },
  addCard: false,
  setAddCard: (addCard) => set({ addCard }),
  finderH: 0,
  setFinderH: (finderH) => set({ finderH }),
  legendOpen: true,
  setLegendOpen: (legendOpen) => set({ legendOpen }),
  sheetFull: false,
  setSheetFull: (sheetFull) => set({ sheetFull }),
  playing: false,
  speed: 1,
  scrubbing: false,
  setOverrideOpen: (overrideOpen) => set({ overrideOpen }),
  setMapPopover: (mapPopover) => set({ mapPopover }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setScrubbing: (scrubbing) => set({ scrubbing }),
}));

/** Width in px of the add-a-field card on a wide screen, and its distance from the screen's edges. Mirrored by the classes in FindField. */
export const ADD_CARD = { width: 360, margin: 16 } as const;

/** Instruments skip easing while time moves under them. */
export const useTimeMoving = (): boolean => useMissionUi((s) => s.playing || s.scrubbing);

/** Same query as the `narrow:` variant in tokens.css. */
export const NARROW_QUERY = '(max-width: 68.74rem)';

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const l = window.matchMedia(NARROW_QUERY);
  l.addEventListener('change', onChange);
  return () => l.removeEventListener('change', onChange);
}

/** True below 1100 px: tab bar, map on top, one scrolling sheet. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}
