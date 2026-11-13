import { useEffect, useId, useRef, useState } from 'react';
import { Crosshair, LocateFixed, MapPin, Search, SquareDashed, Tractor } from 'lucide-react';
import type { DrawMode, LngLat, PlaceHit, PlaceInfo } from '@/contracts';
import { pick } from '@/contracts';
import { SAMPLE_PARCELS, reverseGeocode, searchPlace } from '@/data';
import { MIN_DRAW_ZOOM, draftToParcel, flyToPlace, isLockable, squareDraft } from '@/globe';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, Field, Input, Segmented, cn, useHudDensity } from '@/ui/design';
import { fmtNum } from '@/ui/hud/format';
import './strings';

type Mode = 'sample' | DrawMode;
const DEFAULT_AREA_HA = 2;

function Samples() {
  const t = useT();
  const lang = useLang();
  const lockSample = useMission((s) => s.lockSample);
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-4 gap-2 stacked:grid-cols-2">
        {SAMPLE_PARCELS.map((p) => (
          <li key={p.id} className="min-w-0">
            <button
              type="button"
              aria-label={t('dock.sample.open', { name: p.name })}
              onClick={() => void lockSample(p.id)}
              className="group flex h-full w-full min-w-0 flex-col gap-1 rounded-sm border border-line-2 bg-surface-1 p-2.5 text-left transition-colors duration-(--dur-fast) hover:border-ink-3 hover:bg-surface-2"
            >
              <span className="t-meta truncate">{p.place?.label}</span>
              <span className="line-clamp-2 text-sm leading-tight font-medium text-ink-1 [font-stretch:var(--stretch-semi)]">{p.name}</span>
              <span className="t-caption line-clamp-2">{pick(p.tagline, lang)}</span>
              <span className="t-meta mt-auto pt-1 text-ink-3 group-hover:text-ink-2">
                {fmtNum(p.areaHa, p.areaHa < 10 ? 1 : 0)} ha
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="t-caption">{t('dock.sample.note')}</p>
    </div>
  );
}

/** Name, live area and lock: shared by every drawing mode. */
function DraftFooter({ place, defaultName }: { place?: PlaceInfo; defaultName?: string }) {
  const t = useT();
  const draft = useMission((s) => s.draft);
  const lockParcel = useMission((s) => s.lockParcel);
  const cancelDraw = useMission((s) => s.cancelDraw);
  const [name, setName] = useState('');
  const id = useId();
  const lockable = isLockable(draft);
  const crossed = !!draft && draft.closed && draft.areaHa == null;
  const finalName = name.trim() || defaultName || t('dock.name.default');

  const lock = () => {
    const parcel = draftToParcel(draft, finalName, place);
    if (parcel) void lockParcel(parcel);
  };

  return (
    <div className="flex items-end gap-3 border-t border-line-1 pt-3 stacked:flex-wrap">
      <Field label={t('dock.name')} htmlFor={id} className="min-w-0 flex-1">
        <Input id={id} value={name} placeholder={finalName} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lockable && lock()} maxLength={60} />
      </Field>
      <div className="flex min-w-28 flex-col pb-1">
        <span className="t-label">{t('dock.area')}</span>
        {draft?.areaHa != null ? (
          <span className="flex items-baseline gap-1">
            <span className="t-value text-xl leading-6 text-ink-1">{fmtNum(draft.areaHa, draft.areaHa < 10 ? 2 : 1)}</span>
            <span className="t-unit">ha</span>
          </span>
        ) : (
          <span className="t-caption">{t('dock.area.none')}</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={cancelDraw}>
          {t('dock.cancel')}
        </Button>
        <Button variant="primary" disabled={!lockable} onClick={lock}>
          {t('dock.lock')}
        </Button>
      </div>
      {crossed && <p className="t-caption basis-full text-watch">{t('dock.quad.crossed')}</p>}
    </div>
  );
}

function QuadMode() {
  const t = useT();
  const draft = useMission((s) => s.draft);
  const n = draft?.vertices.length ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <SquareDashed size={20} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm text-ink-1">{t('dock.quad.howto')}</p>
          <p className="t-caption">{t('dock.quad.zoom', { z: MIN_DRAW_ZOOM })}</p>
        </div>
        <span className="t-value shrink-0 text-sm text-ink-2" aria-live="polite">
          {t('dock.quad.count', { n: Math.min(n, 4) })}
        </span>
      </div>
      <DraftFooter />
    </div>
  );
}

function AreaInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const id = useId();
  const n = Number(value.replace(',', '.'));
  const invalid = value.trim() !== '' && (!Number.isFinite(n) || n <= 0 || n > 5000);
  return (
    <Field label={t('dock.coords.area')} htmlFor={id} className="w-32 shrink-0">
      <Input id={id} numeric inputMode="decimal" unit="ha" value={value} invalid={invalid} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

const areaOf = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 5000 ? n : null;
};

function CoordsMode() {
  const t = useT();
  const lang = useLang();
  const setDraft = useMission((s) => s.setDraft);
  const draft = useMission((s) => s.draft);
  const [q, setQ] = useState('');
  const [area, setArea] = useState(String(DEFAULT_AREA_HA));
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<PlaceHit | null>(null);
  const seq = useRef(0);
  const id = useId();

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || (chosen && chosen.label === q)) {
      setHits(null);
      return;
    }
    const my = ++seq.current;
    setBusy(true);
    setFailed(false);
    // Public geocoders ask for no more than one request a second: wait for the typing to settle.
    const timer = setTimeout(() => {
      searchPlace(query, lang)
        .then((r) => my === seq.current && setHits(r.slice(0, 5)))
        .catch(() => my === seq.current && (setFailed(true), setHits([])))
        .finally(() => my === seq.current && setBusy(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [q, lang, chosen]);

  const place = (hit: PlaceHit, ha = areaOf(area)) => {
    setChosen(hit);
    setQ(hit.label);
    setHits(null);
    if (ha == null) return;
    flyToPlace(hit.location);
    setDraft(squareDraft('coords', hit.location, ha));
  };

  const changeArea = (v: string) => {
    setArea(v);
    const ha = areaOf(v);
    // Re-square around the same point; a boundary already dragged by hand is redrawn.
    if (chosen && ha != null && draft) setDraft(squareDraft('coords', chosen.location, ha));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <div className="relative min-w-0 flex-1">
          <Field label={t('dock.coords.search')} htmlFor={id}>
            <Input
              id={id}
              prefix={<Search size={14} strokeWidth={1.5} aria-hidden />}
              value={q}
              autoComplete="off"
              placeholder={t('dock.coords.placeholder')}
              onChange={(e) => (setQ(e.target.value), setChosen(null))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hits?.[0]) place(hits[0]);
              }}
              aria-expanded={!!hits?.length}
              aria-controls={`${id}-list`}
            />
          </Field>
          {(busy || hits) && (
            <ul id={`${id}-list`} className="plate-raised absolute right-0 bottom-full left-0 mb-1 flex max-h-56 flex-col overflow-y-auto py-1" role="listbox" aria-label={t('dock.coords.search')}>
              {busy && <li className="t-caption px-3 py-1.5">{t('dock.coords.searching')}</li>}
              {!busy && hits?.length === 0 && <li className="t-caption px-3 py-1.5">{failed ? t('dock.coords.failed') : t('dock.coords.none', { q })}</li>}
              {!busy &&
                hits?.map((h) => (
                  <li key={`${h.location[0]},${h.location[1]}`} role="option" aria-selected={false}>
                    <button type="button" onClick={() => place(h)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-surface-3">
                      <MapPin size={14} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-ink-1">{h.label}</span>
                        <span className="t-meta">
                          {fmtNum(h.location[1], 4)}, {fmtNum(h.location[0], 4)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <AreaInput value={area} onChange={changeArea} />
      </div>
      <p className="t-caption">{draft?.closed ? t('dock.adjust.hint') : t('dock.coords.hint')}</p>
      {draft?.closed && <DraftFooter place={chosen ? { label: chosen.label, country: chosen.country, admin1: chosen.admin1 } : undefined} defaultName={chosen?.label.split(',')[0]} />}
    </div>
  );
}

type GpsState = { kind: 'idle' } | { kind: 'locating' } | { kind: 'error'; key: string } | { kind: 'ok'; at: LngLat; accuracy: number; place?: PlaceInfo };

function GpsMode() {
  const t = useT();
  const lang = useLang();
  const setDraft = useMission((s) => s.setDraft);
  const [area, setArea] = useState(String(DEFAULT_AREA_HA));
  const [state, setState] = useState<GpsState>({ kind: 'idle' });

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setState({ kind: 'error', key: 'dock.gps.unsupported' });
      return;
    }
    setState({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at: LngLat = [pos.coords.longitude, pos.coords.latitude];
        const ha = areaOf(area) ?? DEFAULT_AREA_HA;
        setState({ kind: 'ok', at, accuracy: pos.coords.accuracy });
        flyToPlace(at);
        setDraft(squareDraft('gps', at, ha));
        void reverseGeocode(at, lang).then((place) => place && setState((s) => (s.kind === 'ok' ? { ...s, place } : s)));
      },
      (err) => setState({ kind: 'error', key: err.code === err.PERMISSION_DENIED ? 'dock.gps.denied' : err.code === err.TIMEOUT ? 'dock.gps.timeout' : 'dock.gps.unavailable' }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const changeArea = (v: string) => {
    setArea(v);
    const ha = areaOf(v);
    if (state.kind === 'ok' && ha != null) setDraft(squareDraft('gps', state.at, ha));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm text-ink-1">{t('dock.gps.howto')}</p>
          {state.kind === 'error' && <p className="t-caption text-watch">{t(state.key)}</p>}
          {state.kind === 'ok' && (
            <p className="t-meta">
              {fmtNum(state.at[1], 5)}, {fmtNum(state.at[0], 5)} · {t('dock.gps.accuracy', { m: Math.round(state.accuracy) })}
              {state.place ? ` · ${state.place.label}` : ''}
            </p>
          )}
        </div>
        <AreaInput value={area} onChange={changeArea} />
        <Button icon={<LocateFixed />} loading={state.kind === 'locating'} onClick={locate} className="mb-px">
          {state.kind === 'locating' ? t('dock.gps.locating') : t('dock.gps.ask')}
        </Button>
      </div>
      {state.kind === 'ok' && <DraftFooter place={state.place} defaultName={state.place?.label.split(',')[0]} />}
    </div>
  );
}

/**
 * Bottom Action Dock (State 2): four ways to define the field. Every drawing mode ends in the same
 * footer: name it, check the live area, lock it. Vertex dragging happens on the map itself.
 */
export function ActionDock() {
  const t = useT();
  const density = useHudDensity();
  const drawMode = useMission((s) => s.drawMode);
  const startDraw = useMission((s) => s.startDraw);
  const cancelDraw = useMission((s) => s.cancelDraw);
  const mode: Mode = drawMode ?? 'sample';
  const stacked = density === 'stacked';

  const choose = (m: Mode) => {
    if (m === 'sample') cancelDraw();
    else startDraw(m);
  };

  return (
    <section
      aria-label={t('dock.title')}
      className="plate absolute bottom-4 left-1/2 z-(--z-dock) flex w-[min(940px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-3 p-(--panel-pad) stacked:bottom-0 stacked:w-full stacked:rounded-none"
    >
      <div className="flex items-center gap-3 stacked:flex-col stacked:items-stretch">
        <h2 className="t-title shrink-0">{t('dock.title')}</h2>
        <Segmented<Mode>
          ariaLabel={t('dock.mode.label')}
          size={stacked ? 'lg' : 'md'}
          value={mode}
          onValueChange={choose}
          className={cn(!stacked && 'ml-auto')}
          block={stacked}
          options={[
            { value: 'sample', label: t('dock.mode.sample'), icon: <Tractor /> },
            { value: 'quad', label: t('dock.mode.quad'), icon: <SquareDashed /> },
            { value: 'coords', label: t('dock.mode.coords'), icon: <Crosshair /> },
            { value: 'gps', label: t('dock.mode.gps'), icon: <LocateFixed /> },
          ]}
        />
      </div>
      {mode === 'sample' && <Samples />}
      {mode === 'quad' && <QuadMode />}
      {mode === 'coords' && <CoordsMode />}
      {mode === 'gps' && <GpsMode />}
    </section>
  );
}
