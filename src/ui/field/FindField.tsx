/**
 * Find a field: one address (or "lat, lon"), one area, one action. The square that lands on the map
 * can be dragged by its corners; then the field is named and locked. Ready-made demo fields sit
 * under a divider.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, LocateFixed, MapPin, Plus, Search } from 'lucide-react';
import type { LngLat, PlaceHit, PlaceInfo } from '@/contracts';
import { pick } from '@/contracts';
import { SAMPLE_PARCELS, reverseGeocode, searchPlace } from '@/data';
import { draftToParcel, flyToPlace, isLockable, squareDraft } from '@/globe';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, Field, IconButton, Input, cn } from '@/ui/design';
import { cropName, fmtNum } from '@/ui/hud/format';
import { getCrop } from '@/core/crops';
import { ShapeThumb } from './FieldCanvas';
import { useMissionUi } from '@/ui/chrome/uiState';
import './strings';

const DEFAULT_AREA_HA = 2;

const areaOf = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 5000 ? n : null;
};

/** "12.68, 108.05" or "12.68 108.05": latitude first, the way people copy it from a map. */
function parseLatLon(q: string): LngLat | null {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

function Demos() {
  const t = useT();
  const lang = useLang();
  const lockSample = useMission((s) => s.lockSample);
  const current = useMission((s) => s.parcel?.id);
  return (
    <section aria-labelledby="demo-title" className="flex flex-col gap-2">
      <h3 id="demo-title" className="text-sm font-medium text-ink-2">
        {t('field.demo.group')}
      </h3>
      <ul className="flex flex-col">
        {SAMPLE_PARCELS.map((p) => {
          const crop = getCrop(p.defaultCropId);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => void lockSample(p.id)}
                aria-label={t('field.demo.open', { name: p.name })}
                aria-current={current === p.id || undefined}
                className={cn('group flex min-h-14 w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors duration-(--dur-fast)', current === p.id ? 'bg-signal/10' : 'hover:bg-surface-2')}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-ink-1">
                  <ShapeThumb parcel={p} size={36} light />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink-1">{p.name}</span>
                  <span className="mt-0.5 self-start rounded-full bg-signal px-1.5 text-[11px] leading-4 font-medium text-on-signal narrow:text-xs">{t('field.demo.tag')}</span>
                  <span className="t-caption truncate">
                    {[p.place?.label, crop ? cropName(crop.names, lang) : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="t-meta shrink-0">{fmtNum(p.areaHa, p.areaHa < 10 ? 1 : 0)} ha</span>
              </button>
            </li>
          );
        })}
      </ul>
      <span className="sr-only">{SAMPLE_PARCELS.map((p) => pick(p.tagline, lang)).join('. ')}</span>
    </section>
  );
}

function LockForm({ place, defaultName }: { place?: PlaceInfo; defaultName?: string }) {
  const t = useT();
  const draft = useMission((s) => s.draft);
  const lockParcel = useMission((s) => s.lockParcel);
  const cancelDraw = useMission((s) => s.cancelDraw);
  const [name, setName] = useState('');
  const id = useId();
  const lockable = isLockable(draft);
  const crossed = !!draft && draft.closed && draft.areaHa == null;
  const finalName = name.trim() || defaultName || t('field.name.default');
  const lock = () => {
    const parcel = draftToParcel(draft, finalName, place);
    if (parcel) void lockParcel(parcel);
  };
  return (
    <div className="flex flex-col gap-4 rounded-sm border border-line-2 bg-surface-1 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-label">{t('field.area.live')}</span>
        {draft?.areaHa != null ? (
          <span className="flex items-baseline gap-1" aria-live="polite">
            <span className="t-value text-2xl text-ink-1">{fmtNum(draft.areaHa, draft.areaHa < 10 ? 2 : 1)}</span>
            <span className="t-unit">ha</span>
          </span>
        ) : (
          <span className="t-caption">--</span>
        )}
      </div>
      <p className="t-caption -mt-2">{t('field.drag')}</p>
      {crossed && <p className="t-caption text-watch">{t('field.crossed')}</p>}
      <Field label={t('field.name')} htmlFor={id}>
        <Input id={id} size="lg" value={name} placeholder={finalName} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lockable && lock()} />
      </Field>
      <div className="flex gap-2">
        <Button variant="ghost" size="lg" onClick={cancelDraw}>
          {t('field.cancel')}
        </Button>
        <Button variant="primary" size="lg" className="flex-1" disabled={!lockable} onClick={lock}>
          {t('field.lock')}
        </Button>
      </div>
    </div>
  );
}

export function FindField() {
  const t = useT();
  const lang = useLang();
  const draft = useMission((s) => s.draft);
  const cancelDraw = useMission((s) => s.cancelDraw);
  const setListMode = useMissionUi((s) => s.setListMode);
  const startDraw = useMission((s) => s.startDraw);
  const setDraft = useMission((s) => s.setDraft);
  const [q, setQ] = useState('');
  const [area, setArea] = useState(String(DEFAULT_AREA_HA));
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<PlaceHit | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const seq = useRef(0);
  const id = useId();
  const areaId = useId();
  const placed = !!draft?.closed && !!chosen;

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || (chosen && chosen.label === q) || parseLatLon(query)) {
      setHits(null);
      setBusy(false);
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

  const put = (hit: PlaceHit, ha = areaOf(area)) => {
    setChosen(hit);
    setQ(hit.label);
    setHits(null);
    if (ha == null) return;
    flyToPlace(hit.location);
    startDraw('coords');
    setDraft(squareDraft('coords', hit.location, ha));
  };

  const submit = () => {
    const ll = parseLatLon(q);
    if (ll) {
      put({ label: `${fmtNum(ll[1], 5)}, ${fmtNum(ll[0], 5)}`, location: ll });
      void reverseGeocode(ll, lang).then((p) => p && setChosen((c) => (c && c.location === ll ? { ...c, label: p.label, country: p.country, admin1: p.admin1 } : c)));
      return;
    }
    if (chosen && chosen.label === q) put(chosen);
    else if (hits?.[0]) put(hits[0]);
  };

  const locate = () => {
    if (!('geolocation' in navigator)) return setGpsError(t('field.gps.unsupported'));
    setLocating(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const at: LngLat = [pos.coords.longitude, pos.coords.latitude];
        const hit: PlaceHit = { label: t('field.gps.here'), location: at };
        put(hit);
        void reverseGeocode(at, lang).then((p) => p && setChosen((c) => (c?.location === at ? { ...c, label: p.label, country: p.country, admin1: p.admin1 } : c)));
      },
      (err) => {
        setLocating(false);
        setGpsError(t(err.code === err.PERMISSION_DENIED ? 'field.gps.denied' : 'field.gps.unavailable'));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const changeArea = (v: string) => {
    setArea(v);
    const ha = areaOf(v);
    if (chosen && ha != null && draft) setDraft(squareDraft('coords', chosen.location, ha));
  };

  const areaInvalid = area.trim() !== '' && areaOf(area) == null;
  const canSubmit = !!parseLatLon(q) || !!(chosen && chosen.label === q) || !!hits?.length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <button type="button" onClick={() => (cancelDraw(), setListMode('list'))} className="flex items-center gap-1 self-start text-sm text-ink-2 hover:text-ink-1">
          <ArrowLeft size={16} aria-hidden />
          {t('field.add.back')}
        </button>
        <h2 className="text-lg font-semibold text-ink-1">{t('field.add.step')}</h2>
        <p className="text-sm text-ink-3">{t('field.add.lede')}</p>
      </header>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <Field label={t('field.address')} htmlFor={id} hint={gpsError ?? undefined}>
            <div className="relative">
              <Input
                id={id}
                size="lg"
                prefix={<Search size={16} strokeWidth={1.5} aria-hidden />}
                value={q}
                autoComplete="off"
                placeholder={t('field.address.placeholder')}
                onChange={(e) => (setQ(e.target.value), setChosen(null))}
                aria-expanded={!!hits?.length}
                aria-controls={`${id}-list`}
                className="pr-12"
              />
              <IconButton label={t('field.gps')} icon={<LocateFixed />} size="md" loading={locating} onClick={locate} className="absolute top-1/2 right-1.5 -translate-y-1/2" />
            </div>
          </Field>
          {(busy || hits) && (
            <ul id={`${id}-list`} role="listbox" aria-label={t('field.address')} className="plate-raised absolute inset-x-0 top-full z-(--z-popover) mt-1 flex max-h-64 flex-col overflow-y-auto py-1">
              {busy && <li className="t-caption px-3 py-2">{t('field.searching')}</li>}
              {!busy && hits?.length === 0 && <li className="t-caption px-3 py-2">{failed ? t('field.search.failed') : t('field.search.none', { q })}</li>}
              {!busy &&
                hits?.map((h) => (
                  <li key={`${h.location[0]},${h.location[1]}`} role="option" aria-selected={false}>
                    <button type="button" onClick={() => put(h)} className="flex min-h-11 w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-3">
                      <MapPin size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-base text-ink-1">{h.label}</span>
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

        <Field label={t('field.areaHa')} htmlFor={areaId} hint={areaInvalid ? t('field.area.invalid') : undefined}>
          <Input id={areaId} size="lg" numeric inputMode="decimal" unit="ha" value={area} invalid={areaInvalid} onChange={(e) => changeArea(e.target.value)} />
        </Field>

        {!placed && (
          <Button type="submit" variant="primary" size="lg" icon={<ArrowRight />} disabled={!canSubmit || areaInvalid}>
            {t('field.show')}
          </Button>
        )}
      </form>

      {placed && <LockForm place={chosen ? { label: chosen.label, country: chosen.country, admin1: chosen.admin1 } : undefined} defaultName={chosen?.label.split(',')[0]} />}

    </div>
  );
}

/** The list panel: your field, the demo group, and the card that starts the add-field step. */
export function FieldList() {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const cropId = useMission((s) => s.cropId);
  const setPhase = useMission((s) => s.setPhase);
  const setListMode = useMissionUi((s) => s.setListMode);
  const isDemo = SAMPLE_PARCELS.some((p) => p.id === parcel?.id);
  const crop = getCrop(cropId);
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold text-ink-1">{t('field.list.title')}</h2>
      {parcel && !isDemo && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink-2">{t('field.list.yours')}</h3>
          <button type="button" aria-current onClick={() => setPhase('locked')} className="flex min-h-14 items-center gap-3 rounded-sm bg-signal/10 px-2 py-2 text-left">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-ink-1">
              <ShapeThumb parcel={parcel} size={36} light />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-ink-1">{parcel.name}</span>
              <span className="t-caption truncate">{[`${fmtNum(parcel.areaHa, parcel.areaHa < 10 ? 1 : 0)} ha`, crop ? cropName(crop.names, lang) : null].filter(Boolean).join(', ')}</span>
            </span>
          </button>
        </section>
      )}
      <Demos />
      <div className="flex flex-col items-center gap-2 rounded-md bg-surface-2 px-5 py-8 text-center">
        <Plus size={20} aria-hidden className="text-ink-2" />
        <h3 className="text-base font-semibold text-ink-1">{t('field.add.title')}</h3>
        <p className="text-sm text-ink-3">{t('field.add.lede')}</p>
        <Button variant="primary" icon={<Plus />} className="mt-2" onClick={() => setListMode('add')}>
          {t('field.add.button')}
        </Button>
      </div>
    </div>
  );
}
