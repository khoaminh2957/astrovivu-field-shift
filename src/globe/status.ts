/**
 * What the map is actually showing, for anyone who needs to say so on screen: which imagery
 * answered, which date the NASA overlay really is, whether motion is reduced. The mission store
 * says what was asked for; this says what was delivered.
 */
import { create } from 'zustand';
import type { ISODate, OverlayId } from '@/contracts';

export type ImagerySource = 'esri' | 'sentinel2' | 'bluemarble';

export interface OverlayStatus {
  id: OverlayId;
  /** Date of the picture on screen, after snapping to the layer's cadence and newest date. */
  date: ISODate | null;
  ageDays: number | null;
  stale: boolean;
  state: 'off' | 'loading' | 'ready' | 'no-data';
}

export interface GlobeStatus {
  /** False when the browser could not create a WebGL 2 context. */
  webgl: boolean;
  ready: boolean;
  imagery: ImagerySource;
  /** i18n key (`globe.*`) of a message worth showing, or null. */
  notice: string | null;
  overlay: OverlayStatus;
  terrain: boolean;
  /** A scripted camera flight is in progress. */
  flying: boolean;
  reducedMotion: boolean;
  /** Attribution for what is on screen right now, already in the interface language. */
  credits: string;
}

export const useGlobeStatus = create<GlobeStatus>()(() => ({
  webgl: true,
  ready: false,
  imagery: 'esri',
  notice: null,
  overlay: { id: 'none', date: null, ageDays: null, stale: false, state: 'off' },
  terrain: false,
  flying: false,
  reducedMotion: false,
  credits: '',
}));

export const setGlobeStatus = (patch: Partial<GlobeStatus>): void => useGlobeStatus.setState(patch);
