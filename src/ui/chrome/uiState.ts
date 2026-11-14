/**
 * Presentation state of the mission screens that no other layer needs: which panel is open and
 * whether the timeline is moving. Kept out of the mission store on purpose; the store holds the
 * mission, this holds the screen.
 */
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

export type MapPopover = 'layers' | 'measure' | null;

export interface MissionUiState {
  /** Ground-truth section expanded in the field panel. */
  overrideOpen: boolean;
  /** Tab of the field panel. */
  fieldTab: 'status' | 'report' | 'data' | 'truth';
  setFieldTab(tab: 'status' | 'report' | 'data' | 'truth'): void;
  /** Narrow: the sheet covers the map except a strip at the top. */
  sheetFull: boolean;
  setSheetFull(on: boolean): void;
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

export const useMissionUi = create<MissionUiState>()((set) => ({
  overrideOpen: false,
  fieldTab: 'status',
  setFieldTab: (fieldTab) => set({ fieldTab }),
  mapPopover: null,
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
