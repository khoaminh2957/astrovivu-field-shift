/**
 * "Select on the map": LabelMe / SAM-style 1-touch + multi-point interactive field segmentation:
 * 1) First click inside a field runs multi-spectral Sentinel-2 segmentation (`openFieldSession`)
 *    and caches the 10 m / 20 m stack in memory.
 * 2) Subsequent clicks refine the polygon in tens of milliseconds with zero network calls:
 *    - `+ Thêm vùng` (default): click missed parts of the field to merge & weld them in.
 *    - `− Bớt vùng` (or Alt+click): click unwanted spills to carve along the sharpest border ridge
 *      via geodesic watershed competition.
 * 3) Pressing "Chuẩn hóa cạnh" (`Regularise`) progressively snaps near-orthogonal agricultural
 *    edges and removes jagged staircase steps on each click while preserving true area.
 * 4) Also includes preset scale chips, Undo, zoom-in guard, and 4-corner manual fallback.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MousePointerClick, PenLine, Sparkles, Undo2, ZoomIn } from 'lucide-react';
import type { LngLat, PlaceInfo } from '@/contracts';
import {
  openFieldSession,
  regularizePolygonRing,
  reverseGeocode,
  type FieldBoundary,
  type FieldPromptPoint,
  type FieldPromptSession,
} from '@/data';
import {
  flyToPoint,
  makeDraft,
  onMapClick,
  setPickMode,
  setPickTarget,
  setPromptMarkers,
  useMapView,
  type MapClickMods,
} from '@/globe';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, Segmented, cn } from '@/ui/design';
import { fmtNum } from '@/ui/hud/format';
import './strings';

interface RefineSnapshot {
  prompts: FieldPromptPoint[];
  regularizeSteps: number;
  vertices: LngLat[];
  confidence: number;
  selectedPreset: number | null;
}

export type SelectMapState =
  | { kind: 'idle' }
  | { kind: 'zoomed' }
  | { kind: 'detecting' }
  | { kind: 'none' }
  | { kind: 'manual'; place?: PlaceInfo }
  | {
      kind: 'found';
      candidates: FieldBoundary[];
      selectedPreset: number | null;
      prompts: FieldPromptPoint[];
      promptMode: 'positive' | 'negative';
      regularizeSteps: number;
      history: RefineSnapshot[];
      confidence: number;
      place?: PlaceInfo;
    };

/** Below this zoom a click lands at town/district scale, so we fly in first instead of guessing. */
const MIN_PICK_ZOOM = 13.5;
const TARGET_PICK_ZOOM = 15.8;

/** Below this the outline is shown with a plain warning that it may be partial. */
const LOW_CONFIDENCE = 0.55;

/** True when `pt` sits inside `ring` or within ~25 m of its perimeter. */
function nearOrInsideRing(pt: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  if (inside) return true;
  const cos = Math.cos((pt[1] * Math.PI) / 180);
  for (let i = 0; i < ring.length - 1; i++) {
    const ax = (ring[i][0] - pt[0]) * 111_320 * cos;
    const ay = (ring[i][1] - pt[1]) * 111_320;
    const bx = (ring[i + 1][0] - pt[0]) * 111_320 * cos;
    const by = (ring[i + 1][1] - pt[1]) * 111_320;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(ax + t * dx, ay + t * dy) <= 25) return true;
  }
  return false;
}

export interface SelectOnMapControl {
  state: SelectMapState;
  place?: PlaceInfo;
  selectCandidate: (index: number) => void;
  setPromptMode: (mode: 'positive' | 'negative') => void;
  regularize: () => void;
  undo: () => void;
  startManual: () => void;
  backToAuto: () => void;
}

export function useSelectOnMap(active: boolean): SelectOnMapControl {
  const lang = useLang();
  const startDraw = useMission((s) => s.startDraw);
  const setDraft = useMission((s) => s.setDraft);
  const cancelDraw = useMission((s) => s.cancelDraw);
  const draft = useMission((s) => s.draft);
  const drawMode = useMission((s) => s.drawMode);
  const { zoom } = useMapView();
  const [state, setState] = useState<SelectMapState>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const sessionRef = useRef<FieldPromptSession | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Reset back to idle when the user presses "Start over" (cancelDraw sets draft & drawMode to null).
  useEffect(() => {
    if (!active) return;
    if (!draft && !drawMode && (state.kind === 'found' || state.kind === 'manual')) {
      sessionRef.current = null;
      setPickTarget(null);
      setPromptMarkers([]);
      setPickMode(true);
      setState({ kind: 'idle' });
    }
  }, [active, draft, drawMode, state.kind]);

  // Reverse-geocode manual 4-corner polygon once closed so LockForm gets a sensible regional name.
  useEffect(() => {
    if (!active || state.kind !== 'manual' || state.place || !draft?.closed || draft.vertices.length < 3) return;
    let cancelled = false;
    const cx = draft.vertices.reduce((s, v) => s + v[0], 0) / draft.vertices.length;
    const cy = draft.vertices.reduce((s, v) => s + v[1], 0) / draft.vertices.length;
    void reverseGeocode([cx, cy], lang).then((place) => {
      if (!cancelled && place) setState((s) => (s.kind === 'manual' ? { ...s, place } : s));
    });
    return () => {
      cancelled = true;
    };
  }, [active, state, draft, lang]);

  const applyVertices = useCallback(
    (vertices: LngLat[]) => {
      startDraw('coords');
      setDraft(makeDraft('coords', vertices, true));
    },
    [startDraw, setDraft],
  );

  const selectCandidate = useCallback(
    (index: number) => {
      const prev = stateRef.current;
      if (prev.kind !== 'found') return;
      const cand = prev.candidates[index];
      if (!cand) return;
      const curVerts = useMission.getState().draft?.vertices ?? cand.polygon.coordinates[0];
      const snap: RefineSnapshot = {
        prompts: prev.prompts,
        regularizeSteps: prev.regularizeSteps,
        vertices: curVerts,
        confidence: prev.confidence,
        selectedPreset: prev.selectedPreset,
      };
      const firstPos = prev.prompts.find((p) => p.kind === 'positive') ?? prev.prompts[0];
      const resetPrompts = firstPos ? [firstPos] : prev.prompts;
      setPromptMarkers(resetPrompts);
      applyVertices(cand.polygon.coordinates[0]);
      setState({
        ...prev,
        prompts: resetPrompts,
        regularizeSteps: 0,
        selectedPreset: index,
        confidence: cand.confidence,
        history: [...prev.history, snap],
      });
    },
    [applyVertices],
  );

  const setPromptMode = useCallback((mode: 'positive' | 'negative') => {
    setState((prev) => (prev.kind === 'found' ? { ...prev, promptMode: mode } : prev));
  }, []);

  /** Each press straightens & orthogonalises edges one step further ("bấm thêm nút mỗi lần sẽ chuẩn hóa lại"). */
  const regularize = useCallback(() => {
    const prev = stateRef.current;
    if (prev.kind !== 'found') return;
    const curDraft = useMission.getState().draft;
    if (!curDraft?.closed || curDraft.vertices.length < 3) return;
    const nextSteps = prev.regularizeSteps + 1;
    const snap: RefineSnapshot = {
      prompts: prev.prompts,
      regularizeSteps: prev.regularizeSteps,
      vertices: curDraft.vertices,
      confidence: prev.confidence,
      selectedPreset: prev.selectedPreset,
    };
    const session = sessionRef.current;
    let nextVertices: LngLat[] | null = null;
    let nextConf = prev.confidence;
    if (session && prev.selectedPreset === null) {
      const solved = session.solve(prev.prompts, { regularizeSteps: nextSteps });
      if (solved) {
        nextVertices = solved.polygon.coordinates[0];
        nextConf = solved.confidence;
      }
    }
    if (!nextVertices) {
      nextVertices = regularizePolygonRing(curDraft.vertices, nextSteps);
    }
    applyVertices(nextVertices);
    setState({
      ...prev,
      regularizeSteps: nextSteps,
      confidence: nextConf,
      history: [...prev.history, snap],
    });
  }, [applyVertices]);

  const undo = useCallback(() => {
    const prev = stateRef.current;
    if (prev.kind !== 'found' || !prev.history.length) return;
    const last = prev.history[prev.history.length - 1];
    setPromptMarkers(last.prompts);
    applyVertices(last.vertices);
    setState({
      ...prev,
      prompts: last.prompts,
      regularizeSteps: last.regularizeSteps,
      selectedPreset: last.selectedPreset,
      confidence: last.confidence,
      history: prev.history.slice(0, -1),
    });
  }, [applyVertices]);

  const startManual = useCallback(() => {
    abort.current?.abort();
    sessionRef.current = null;
    setPickTarget(null);
    setPromptMarkers([]);
    setPickMode(true);
    cancelDraw();
    startDraw('quad');
    setState({ kind: 'manual' });
  }, [cancelDraw, startDraw]);

  const backToAuto = useCallback(() => {
    abort.current?.abort();
    sessionRef.current = null;
    cancelDraw();
    setPickTarget(null);
    setPromptMarkers([]);
    setPickMode(true);
    setState({ kind: 'idle' });
  }, [cancelDraw]);

  useEffect(() => {
    if (!active) {
      abort.current?.abort();
      sessionRef.current = null;
      setPickMode(false);
      setPickTarget(null);
      setPromptMarkers([]);
      setState({ kind: 'idle' });
      return;
    }
    setPickMode(true);

    const startFreshSession = (at: LngLat) => {
      abort.current?.abort();
      sessionRef.current = null;
      const ac = new AbortController();
      abort.current = ac;
      setPromptMarkers([]);
      setPickTarget(at, true);
      setState({ kind: 'detecting' });
      openFieldSession(at, { signal: ac.signal }).then(
        (session) => {
          if (ac.signal.aborted) return;
          const initialPrompts: FieldPromptPoint[] = [{ at, kind: 'positive' }];
          const primary = session?.candidates[0] ?? session?.solve(initialPrompts) ?? null;
          if (!session || !primary) {
            setPickTarget(at, false);
            setState({ kind: 'none' });
            return;
          }
          sessionRef.current = session;
          const rawCands = session.candidates.length ? session.candidates : [primary];
          const byArea = [...rawCands].sort((a, b) => a.areaHa - b.areaHa);
          const selectedPreset = byArea.indexOf(primary);
          setPickTarget(null);
          setPromptMarkers(initialPrompts);
          applyVertices(primary.polygon.coordinates[0]);
          setState({
            kind: 'found',
            candidates: byArea,
            selectedPreset: selectedPreset >= 0 ? selectedPreset : null,
            prompts: initialPrompts,
            promptMode: 'positive',
            regularizeSteps: 0,
            history: [],
            confidence: primary.confidence,
          });
          void reverseGeocode(at, lang).then(
            (place) => place && !ac.signal.aborted && setState((s) => (s.kind === 'found' ? { ...s, place } : s)),
          );
        },
        () => {
          if (!ac.signal.aborted) {
            setPickTarget(at, false);
            setState({ kind: 'none' });
          }
        },
      );
    };

    const off = onMapClick((at: LngLat, mods: MapClickMods) => {
      const curState = stateRef.current;
      const mission = useMission.getState();
      // In manual 4-corner mode, DraftEditor owns map clicks.
      if (curState.kind === 'manual' || mission.drawMode === 'quad') return;

      // Zoom guard: fly to field scale first instead of running Sentinel-2 on a random district click.
      if (zoomRef.current < MIN_PICK_ZOOM) {
        abort.current?.abort();
        setPickTarget(at, false);
        flyToPoint(at, TARGET_PICK_ZOOM);
        setState({ kind: 'zoomed' });
        return;
      }

      // Active LabelMe / SAM session: refine locally when clicking within the Sentinel-2 window.
      if (curState.kind === 'found' && sessionRef.current) {
        if (!sessionRef.current.contains(at)) {
          // Clicked far away (> ~750 m): start a fresh 1-click session on that new farm.
          startFreshSession(at);
          return;
        }
        const kind: 'positive' | 'negative' = mods.altKey ? 'negative' : curState.promptMode;
        let nextPrompts: FieldPromptPoint[] = [...curState.prompts, { at, kind }];
        let solved = sessionRef.current.solve(nextPrompts, { regularizeSteps: curState.regularizeSteps });
        // If a positive click landed on a separate farm > 60 m away across a major road/canal that
        // could not weld into one Polygon, switch cleanly to that farm in < 15 ms (Undo restores prior).
        if (kind === 'positive' && solved && !nearOrInsideRing(at, solved.polygon.coordinates[0])) {
          const singlePrompt: FieldPromptPoint[] = [{ at, kind: 'positive' }];
          const reSolved = sessionRef.current.solve(singlePrompt, { regularizeSteps: 0 });
          if (reSolved) {
            nextPrompts = singlePrompt;
            solved = reSolved;
          }
        }
        // Keep only positive pins that belong to the active connected polygon so no `+` pin floats outside.
        if (solved) {
          const ring = solved.polygon.coordinates[0];
          nextPrompts = nextPrompts.filter((p) => p.kind === 'negative' || nearOrInsideRing(p.at, ring));
        }
        if (!solved || !nextPrompts.some((p) => p.kind === 'positive')) return;
        const curVerts = mission.draft?.vertices ?? solved.polygon.coordinates[0];
        const snap: RefineSnapshot = {
          prompts: curState.prompts,
          regularizeSteps: curState.regularizeSteps,
          vertices: curVerts,
          confidence: curState.confidence,
          selectedPreset: curState.selectedPreset,
        };
        setPromptMarkers(nextPrompts);
        applyVertices(solved.polygon.coordinates[0]);
        setState((prev) =>
          prev.kind === 'found'
            ? {
                ...prev,
                prompts: nextPrompts,
                selectedPreset: null,
                confidence: solved.confidence,
                history: [...prev.history, snap],
              }
            : prev,
        );
        return;
      }

      startFreshSession(at);
    });
    return () => {
      off();
      abort.current?.abort();
      sessionRef.current = null;
      setPickMode(false);
      setPickTarget(null);
      setPromptMarkers([]);
    };
  }, [active, lang, applyVertices]);

  const place = state.kind === 'found' || state.kind === 'manual' ? state.place : undefined;
  return { state, place, selectCandidate, setPromptMode, regularize, undo, startManual, backToAuto };
}

/**
 * The one line shown above the finder box while "Select on map" waits for a click: what to do
 * next, and the way to the other method. Once an outline is found the full step takes over.
 */
export function SelectOnMapHint({ control, onAddress }: { control: SelectOnMapControl; onAddress: () => void }) {
  const t = useT();
  const { zoom } = useMapView();
  const { kind } = control.state;
  const tooFar = zoom < MIN_PICK_ZOOM;
  const message = kind === 'detecting' ? t('field.select.hint.detecting') : kind === 'zoomed' ? t('field.select.hint.zoomed') : tooFar ? t('field.select.hint.zoom') : t('field.select.hint');
  return (
    <div role="status" className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 self-center rounded-[22px] border border-line-2 bg-surface-0 px-4 py-2.5 text-base text-ink-1 shadow-lg">
      <span className="flex min-w-0 items-center gap-2">
        {kind === 'detecting' ? (
          <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-signal border-t-transparent" aria-hidden />
        ) : tooFar && kind !== 'zoomed' ? (
          <ZoomIn size={18} strokeWidth={1.5} aria-hidden className="shrink-0" />
        ) : (
          <MousePointerClick size={18} strokeWidth={1.5} aria-hidden className="shrink-0" />
        )}
        {message}
      </span>
      {kind !== 'detecting' && (
        <button type="button" onClick={onAddress} className="shrink-0 rounded-xs font-medium text-ink-1 underline underline-offset-4 hover:text-signal-strong">
          {t('field.select.orAddress')}
        </button>
      )}
    </div>
  );
}

export function SelectOnMapStatus({ control }: { control: SelectOnMapControl }) {
  const t = useT();
  const draft = useMission((s) => s.draft);
  const { zoom } = useMapView();
  const { state, selectCandidate, setPromptMode, regularize, undo, startManual, backToAuto } = control;

  if (state.kind === 'detecting') {
    return (
      <div role="status" className="flex items-center gap-3 rounded-md bg-surface-2 p-4">
        <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-signal border-t-transparent" aria-hidden />
        <span className="text-sm text-ink-2">{t('field.select.detecting')}</span>
      </div>
    );
  }

  if (state.kind === 'manual') {
    const placedCorners = draft?.vertices.length ?? 0;
    if (draft?.closed) {
      return (
        <div className="flex flex-col gap-2">
          <p className="t-caption">{t('field.select.manualDone', { a: fmtNum(draft.areaHa ?? null, draft.areaHa && draft.areaHa < 10 ? 2 : 1) })}</p>
          <button type="button" onClick={backToAuto} className="self-start text-xs font-medium text-signal-strong hover:underline">
            {t('field.select.autoBtn')}
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-4">
        <div className="flex items-start gap-3">
          <PenLine size={18} aria-hidden className="mt-0.5 shrink-0 text-signal-strong" />
          <p className="text-sm text-ink-1">{t('field.select.manualProgress', { n: placedCorners })}</p>
        </div>
        <Button variant="secondary" size="sm" className="self-start" onClick={backToAuto}>
          {t('field.select.autoBtn')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'none') {
    return (
      <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-4">
        <p className="text-sm text-ink-2">{t('field.select.none')}</p>
        <Button variant="secondary" size="sm" icon={<PenLine />} className="self-start" onClick={startManual}>
          {t('field.select.manualBtn')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'found' && draft?.closed) {
    return (
      <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-3">
        {state.confidence < LOW_CONFIDENCE && <p className="text-xs text-watch">{t('field.select.low')}</p>}
        <p className="t-caption">
          {t('field.select.found', {
            a: fmtNum(draft.areaHa ?? null, draft.areaHa && draft.areaHa < 10 ? 2 : 1),
            p: state.prompts.length,
          })}
        </p>

        {/* LabelMe / SAM-style positive (+) and negative (-) map click mode */}
        <div className="flex flex-col gap-1.5">
          <Segmented<'positive' | 'negative'>
            ariaLabel={t('field.select.mode.label')}
            block
            value={state.promptMode}
            onValueChange={setPromptMode}
            options={[
              { value: 'positive', label: t('field.select.mode.add') },
              { value: 'negative', label: t('field.select.mode.sub') },
            ]}
          />
          <p className="text-xs leading-4 text-ink-3">
            {state.promptMode === 'positive' ? t('field.select.mode.hintAdd') : t('field.select.mode.hintSub')}
          </p>
        </div>

        {/* One-click iterative edge regularisation + Undo */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" icon={<Sparkles />} onClick={regularize}>
            {state.regularizeSteps > 0 ? t('field.select.regularizeCount', { n: state.regularizeSteps }) : t('field.select.regularize')}
          </Button>
          {state.history.length > 0 && (
            <Button variant="secondary" size="sm" icon={<Undo2 />} onClick={undo}>
              {t('field.select.undo')}
            </Button>
          )}
        </div>

        {/* Preset multi-scale candidates from initial 1-touch pass */}
        {state.candidates.length > 1 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-3">{t('field.select.candidates')}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('field.select.candidates')}>
              {state.candidates.map((cand, idx) => {
                const isSelected = idx === state.selectedPreset;
                return (
                  <button
                    key={`${cand.areaHa}-${idx}`}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => selectCandidate(idx)}
                    className={cn(
                      'rounded-sm border px-2 py-0.5 text-xs tabular-nums transition-colors duration-(--dur-fast)',
                      isSelected
                        ? 'border-signal bg-surface-3 font-semibold text-ink-1'
                        : 'border-line-2 bg-surface-1 text-ink-2 hover:border-line-3 hover:text-ink-1',
                    )}
                  >
                    {fmtNum(cand.areaHa, cand.areaHa < 10 ? 2 : 1)} ha
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button type="button" onClick={startManual} className="inline-flex items-center gap-1 self-start text-xs font-medium text-ink-3 hover:text-ink-1">
          <PenLine size={13} aria-hidden />
          {t('field.select.manualBtn')}
        </button>
      </div>
    );
  }

  const tooFar = zoom < MIN_PICK_ZOOM;
  const message = state.kind === 'zoomed' ? t('field.select.zoomed') : tooFar ? t('field.select.zoomFirst') : t('field.select.howto');

  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-4">
      <div className="flex items-start gap-3">
        {tooFar ? (
          <ZoomIn size={20} aria-hidden className="mt-0.5 shrink-0 text-signal-strong" />
        ) : (
          <MousePointerClick size={20} aria-hidden className="mt-0.5 shrink-0 text-ink-2" />
        )}
        <p className="text-sm text-ink-2">{message}</p>
      </div>
      {!tooFar && (
        <Button variant="secondary" size="sm" icon={<PenLine />} className="self-start" onClick={startManual}>
          {t('field.select.manualBtn')}
        </Button>
      )}
    </div>
  );
}
