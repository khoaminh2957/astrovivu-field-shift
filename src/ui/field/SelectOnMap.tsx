/**
 * "Select on the map": the user clicks inside a field, its boundary is recognised from Sentinel-2
 * (`detectFieldBoundary`, a few seconds), and the outline becomes the draft, corners draggable.
 */
import { useEffect, useRef, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import type { LngLat, PlaceInfo } from '@/contracts';
import { detectFieldBoundary, reverseGeocode } from '@/data';
import { makeDraft, onMapClick } from '@/globe';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { fmtNum } from '@/ui/hud/format';
import './strings';

type State = { kind: 'idle' } | { kind: 'detecting' } | { kind: 'none' } | { kind: 'found'; confidence: number; place?: PlaceInfo };

/** Below this the outline is shown with a plain warning that it may be partial. */
const LOW_CONFIDENCE = 0.5;

export function useSelectOnMap(active: boolean): { state: State; place?: PlaceInfo } {
  const lang = useLang();
  const startDraw = useMission((s) => s.startDraw);
  const setDraft = useMission((s) => s.setDraft);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) return;
    const off = onMapClick((at: LngLat) => {
      // While a recognised outline is being adjusted, clicks belong to the corners.
      if (useMission.getState().draft?.closed) return;
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setState({ kind: 'detecting' });
      detectFieldBoundary(at, { signal: ac.signal }).then(
        (b) => {
          if (ac.signal.aborted) return;
          if (!b) return setState({ kind: 'none' });
          startDraw('coords');
          setDraft(makeDraft('coords', b.polygon.coordinates[0], true));
          setState({ kind: 'found', confidence: b.confidence });
          void reverseGeocode(at, lang).then((place) => place && !ac.signal.aborted && setState((s) => (s.kind === 'found' ? { ...s, place } : s)));
        },
        () => !ac.signal.aborted && setState({ kind: 'none' }),
      );
    });
    return () => {
      off();
      abort.current?.abort();
    };
  }, [active, lang, startDraw, setDraft]);

  return { state, place: state.kind === 'found' ? state.place : undefined };
}

export function SelectOnMapStatus({ state }: { state: State }) {
  const t = useT();
  const draft = useMission((s) => s.draft);
  if (state.kind === 'detecting') {
    return (
      <div role="status" className="flex items-center gap-3 rounded-md bg-surface-2 p-4">
        <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-signal border-t-transparent" aria-hidden />
        <span className="text-sm text-ink-2">{t('field.select.detecting')}</span>
      </div>
    );
  }
  if (state.kind === 'none') return <p className="rounded-md bg-surface-2 p-4 text-sm text-ink-2">{t('field.select.none')}</p>;
  if (state.kind === 'found' && draft?.closed) {
    return (
      <div className="flex flex-col gap-1">
        {state.confidence < LOW_CONFIDENCE && <p className="text-sm text-watch">{t('field.select.low')}</p>}
        <p className="t-caption">{t('field.select.found', { a: fmtNum(draft?.areaHa ?? null, 1) })}</p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-md bg-surface-2 p-4">
      <MousePointerClick size={20} aria-hidden className="mt-0.5 shrink-0 text-ink-2" />
      <p className="text-sm text-ink-2">{t('field.select.howto')}</p>
    </div>
  );
}
