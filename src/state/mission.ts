/**
 * Mission store: the single runtime contract between the globe, the HUD and the model tiers.
 *
 * Data flows one way:
 *   lockParcel -> data.loadTelemetry (progressive) -> recompute (scoring, insights, advisory) -> UI
 *   setCursor / play -> every time-aware view re-reads its value at `timeline.cursor`
 *   setCrop / setGroundTruth / setPriorities -> recompute
 *
 * UI code never fetches and never scores; it reads this store and calls these actions.
 */
import { create } from 'zustand';
import type {
  AdvisoryReport,
  BaseLayerId,
  BranchId,
  DrawMode,
  FarmerPriority,
  FieldTelemetry,
  GroundTruth,
  ISODate,
  Insight,
  Lang,
  LayerState,
  ModelInput,
  OverlayId,
  Parcel,
  ParcelDraft,
  ScoreTimeline,
  SampleParcel,
  ScreenAnchor,
  TrackingData,
} from '@/contracts';
import { BRANCHES } from '@/contracts';
import { buildAdvisoryReport, buildInsights } from '@/core/advisory';
import { computeScoreTimeline } from '@/core/scoring';
import { buildTracking } from '@/core/tracking';
import { getSampleParcel, loadTelemetry } from '@/data';
import { addDays, clampDate, todayISO } from '@/lib/time';

/** hero -> explore -> locked (HUD + timeline) -> advisory | tracking; urban is a side mission. */
export type Phase = 'hero' | 'explore' | 'locked' | 'advisory' | 'tracking' | 'urban';
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface TimelineState {
  start: ISODate;
  end: ISODate;
  cursor: ISODate;
  playing: boolean;
  /** Days the cursor advances per playback tick. */
  stepDays: number;
}

export interface MissionState {
  phase: Phase;
  lang: Lang;

  parcel: Parcel | null;
  drawMode: DrawMode | null;
  draft: ParcelDraft | null;

  telemetry: FieldTelemetry | null;
  branchStatus: Record<BranchId, LoadState>;
  loadError: string | null;

  timeline: TimelineState;

  cropId: string | null;
  groundTruth: GroundTruth;
  priorities: FarmerPriority[];

  score: ScoreTimeline | null;
  insights: Insight[];
  advisory: AdvisoryReport | null;
  tracking: TrackingData | null;

  layers: LayerState;
  /** Parcel footprint in screen space, written by the globe on every camera move. */
  anchor: ScreenAnchor | null;
  /** HUD branch the user is inspecting (expanded callout); also selects the parcel colouring. */
  focusBranch: BranchId | null;
  askOpen: boolean;

  setLang(lang: Lang): void;
  setPhase(phase: Phase): void;
  enterExplore(): void;

  startDraw(mode: DrawMode): void;
  setDraft(draft: ParcelDraft | null): void;
  cancelDraw(): void;
  lockParcel(parcel: Parcel): Promise<void>;
  lockSample(id: string): Promise<void>;
  unlockParcel(): void;

  setCrop(cropId: string | null): void;
  setGroundTruth(patch: Partial<GroundTruth>): void;
  resetGroundTruth(): void;
  setPriorities(priorities: FarmerPriority[]): void;
  recompute(): void;

  setCursor(t: ISODate): void;
  play(): void;
  pause(): void;

  setBaseLayer(id: BaseLayerId, on: boolean): void;
  setOverlay(id: OverlayId): void;
  setOverlayOpacity(value: number): void;
  setParcelMetric(key: string | null): void;
  setAnchor(anchor: ScreenAnchor | null): void;
  setFocusBranch(branch: BranchId | null): void;
  setAskOpen(open: boolean): void;
}

const PLAY_TICK_MS = 110;
const allStatus = (s: LoadState) => Object.fromEntries(BRANCHES.map((b) => [b, s])) as Record<BranchId, LoadState>;

let playTimer: ReturnType<typeof setInterval> | null = null;
let loadAbort: AbortController | null = null;

function stopTimer(): void {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
}

export function toModelInput(s: Pick<MissionState, 'parcel' | 'telemetry' | 'cropId' | 'groundTruth' | 'priorities'>): ModelInput | null {
  if (!s.parcel || !s.telemetry) return null;
  return {
    parcel: s.parcel,
    telemetry: s.telemetry,
    cropId: s.cropId,
    groundTruth: s.groundTruth,
    priorities: s.priorities,
    today: s.telemetry.window.today,
  };
}

const today = todayISO();

/** The assumed farm profile of a demo field (a copy, so edits never touch the sample), else none. */
export function defaultGroundTruth(parcel: Parcel): GroundTruth {
  const gt = (parcel as Partial<SampleParcel>).defaultGroundTruth;
  return gt ? structuredClone(gt) : {};
}

export const useMission = create<MissionState>()((set, get) => ({
  phase: 'hero',
  lang: 'en',

  parcel: null,
  drawMode: null,
  draft: null,

  telemetry: null,
  branchStatus: allStatus('idle'),
  loadError: null,

  timeline: { start: addDays(today, -364), end: today, cursor: today, playing: false, stepDays: 3 },

  cropId: null,
  groundTruth: {},
  priorities: ['profit', 'soil', 'water'],

  score: null,
  insights: [],
  advisory: null,
  tracking: null,

  layers: { base: { satellite: true, terrain: true, labels: false }, overlay: 'none', overlayOpacity: 0.7, parcelMetric: 'ndvi' },
  anchor: null,
  focusBranch: null,
  askOpen: false,

  setLang: (lang) => {
    set({ lang });
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  },

  setPhase: (phase) => {
    if (phase !== 'locked') get().pause();
    set({ phase });
    if (phase === 'tracking' && !get().tracking) {
      const input = toModelInput(get());
      if (input) set({ tracking: buildTracking(input) });
    }
  },

  enterExplore: () => set({ phase: 'explore' }),

  startDraw: (mode) => set({ drawMode: mode, draft: { mode, vertices: [], closed: false, areaHa: null } }),
  setDraft: (draft) => set({ draft }),
  cancelDraw: () => set({ drawMode: null, draft: null }),

  lockParcel: async (parcel) => {
    loadAbort?.abort();
    const abort = new AbortController();
    loadAbort = abort;
    stopTimer();
    const isCurrent = () => get().parcel?.id === parcel.id && !abort.signal.aborted;

    set((s) => ({
      parcel,
      phase: 'locked',
      drawMode: null,
      draft: null,
      telemetry: null,
      branchStatus: allStatus('loading'),
      loadError: null,
      cropId: 'defaultCropId' in parcel ? (parcel as { defaultCropId: string }).defaultCropId : null,
      groundTruth: defaultGroundTruth(parcel),
      score: null,
      insights: [],
      advisory: null,
      tracking: null,
      focusBranch: null,
      timeline: { ...s.timeline, playing: false },
    }));

    const adoptWindow = (t: FieldTelemetry) =>
      set((s) => ({
        timeline: { ...s.timeline, start: t.window.start, end: t.window.end, cursor: clampDate(s.timeline.cursor, t.window.start, t.window.end) },
      }));

    try {
      const telemetry = await loadTelemetry(parcel, {
        signal: abort.signal,
        onProgress: (partial, branch) => {
          if (!isCurrent()) return;
          const status: LoadState = partial.branches[branch].status === 'unavailable' ? 'error' : 'ready';
          set((s) => ({ telemetry: partial, branchStatus: { ...s.branchStatus, [branch]: status } }));
          adoptWindow(partial);
          get().recompute();
        },
      });
      if (!isCurrent()) return;
      const branchStatus = Object.fromEntries(
        BRANCHES.map((b) => [b, telemetry.branches[b].status === 'unavailable' ? 'error' : 'ready']),
      ) as Record<BranchId, LoadState>;
      set((s) => ({ telemetry, branchStatus, timeline: { ...s.timeline, start: telemetry.window.start, end: telemetry.window.end, cursor: telemetry.window.end } }));
      get().recompute();
    } catch (err) {
      if (!isCurrent()) return;
      set({ loadError: err instanceof Error ? err.message : String(err), branchStatus: allStatus('error') });
    }
  },

  lockSample: async (id) => {
    const sample = getSampleParcel(id);
    if (sample) await get().lockParcel(sample);
  },

  unlockParcel: () => {
    loadAbort?.abort();
    stopTimer();
    set((s) => ({
      parcel: null,
      phase: 'explore',
      telemetry: null,
      branchStatus: allStatus('idle'),
      score: null,
      insights: [],
      advisory: null,
      tracking: null,
      anchor: null,
      focusBranch: null,
      timeline: { ...s.timeline, playing: false },
    }));
  },

  setCrop: (cropId) => {
    set({ cropId });
    get().recompute();
  },
  setGroundTruth: (patch) => {
    set((s) => ({ groundTruth: { ...s.groundTruth, ...patch } }));
    get().recompute();
  },
  resetGroundTruth: () => {
    // A demo field resets to its assumed farm profile, any other field to no overrides.
    set((s) => ({ groundTruth: s.parcel ? defaultGroundTruth(s.parcel) : {} }));
    get().recompute();
  },
  setPriorities: (priorities) => {
    set({ priorities: priorities.slice(0, 3) });
    get().recompute();
  },

  recompute: () => {
    const input = toModelInput(get());
    if (!input) return;
    const score = computeScoreTimeline(input);
    set({
      score,
      insights: buildInsights(input, score),
      advisory: buildAdvisoryReport(input, score),
      tracking: get().phase === 'tracking' ? buildTracking(input) : null,
    });
  },

  setCursor: (t) => set((s) => ({ timeline: { ...s.timeline, cursor: clampDate(t, s.timeline.start, s.timeline.end) } })),

  play: () => {
    if (playTimer) return;
    set((s) => ({
      timeline: { ...s.timeline, playing: true, cursor: s.timeline.cursor >= s.timeline.end ? s.timeline.start : s.timeline.cursor },
    }));
    playTimer = setInterval(() => {
      const tl = get().timeline;
      const next = addDays(tl.cursor, tl.stepDays);
      if (next >= tl.end) {
        stopTimer();
        set({ timeline: { ...tl, cursor: tl.end, playing: false } });
      } else {
        set({ timeline: { ...tl, cursor: next } });
      }
    }, PLAY_TICK_MS);
  },

  pause: () => {
    stopTimer();
    if (get().timeline.playing) set((s) => ({ timeline: { ...s.timeline, playing: false } }));
  },

  setBaseLayer: (id, on) => set((s) => ({ layers: { ...s.layers, base: { ...s.layers.base, [id]: on } } })),
  setOverlay: (overlay) => set((s) => ({ layers: { ...s.layers, overlay } })),
  setOverlayOpacity: (value) => set((s) => ({ layers: { ...s.layers, overlayOpacity: Math.max(0, Math.min(1, value)) } })),
  setParcelMetric: (key) => set((s) => ({ layers: { ...s.layers, parcelMetric: key } })),
  setAnchor: (anchor) => set({ anchor }),
  setFocusBranch: (focusBranch) => set({ focusBranch }),
  setAskOpen: (askOpen) => set({ askOpen }),
}));

/**
 * Deep links for demos and for agents testing one state in isolation:
 *   ?sample=daklak-coffee            lock a demo field
 *   &phase=advisory|tracking|locked  jump to a state after locking
 *   &crop=glycine-max  &lang=vi      override crop / language
 *   ?phase=explore | ?phase=urban    states that need no parcel
 */
export function bootFromQuery(search: string): void {
  const q = new URLSearchParams(search);
  const store = useMission.getState();
  const lang = q.get('lang');
  if (lang === 'en' || lang === 'vi') store.setLang(lang);
  const phase = q.get('phase') as Phase | null;
  const sample = q.get('sample');
  if (sample) {
    void store.lockSample(sample).then(() => {
      const crop = q.get('crop');
      if (crop) useMission.getState().setCrop(crop);
      if (phase && phase !== 'hero' && phase !== 'explore') useMission.getState().setPhase(phase);
    });
  } else if (phase === 'explore' || phase === 'urban') {
    store.setPhase(phase);
  }
}
