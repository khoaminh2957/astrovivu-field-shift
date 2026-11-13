/**
 * Presentation state of the mission screens that no other layer needs: which side panel is open
 * and whether the timeline is moving. Kept out of the mission store on purpose; the store holds
 * the mission, this holds the screen.
 */
import { create } from 'zustand';

export interface MissionUiState {
  overrideOpen: boolean;
  /** Playback driven by requestAnimationFrame in the scrubber (smoother than the store's interval). */
  playing: boolean;
  /** Days per second at 1×. */
  speed: 1 | 2 | 4;
  /** The pointer is on the scrubber: instruments follow with no easing. */
  scrubbing: boolean;
  setOverrideOpen(open: boolean): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: 1 | 2 | 4): void;
  setScrubbing(on: boolean): void;
}

export const useMissionUi = create<MissionUiState>()((set) => ({
  overrideOpen: false,
  playing: false,
  speed: 1,
  scrubbing: false,
  setOverrideOpen: (overrideOpen) => set({ overrideOpen }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setScrubbing: (scrubbing) => set({ scrubbing }),
}));

/** Instruments skip easing while time moves under them. */
export const useTimeMoving = (): boolean => useMissionUi((s) => s.playing || s.scrubbing);
