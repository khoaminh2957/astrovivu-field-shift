/**
 * The list panel and its add-a-field step.
 *   FieldList  title and total, a search-and-sort row, the fields as rows (your own first, then the
 *              demo group), the card that starts the add step, and a card that opens the assistant.
 *   FindField  one address (or "lat, lon") and one area, or a click on the map; the outline that
 *              lands can be dragged by its corners, then the field is named and locked.
 * One green button per state: Add field, then Show on the map, then Lock field.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, LocateFixed, MapPin, MessageCircleQuestion, Plus, Search, SquarePlus } from 'lucide-react';
import type { LngLat, Parcel, PlaceHit, PlaceInfo } from '@/contracts';
import { pick } from '@/contracts';
import { SAMPLE_PARCELS, reverseGeocode, searchPlace } from '@/data';
import { draftToParcel, flyToPlace, isLockable, squareDraft } from '@/globe';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, Field, IconButton, Input, Segmented, cn } from '@/ui/design';
import { parseLatLon } from '@/ui/chrome/MapSearch';
import { useMissionUi } from '@/ui/chrome/uiState';
import { fmtNum } from '@/ui/hud/format';
import { LiveFieldCanvas, ShapeThumb } from './FieldCanvas';
import { SelectOnMapStatus, useSelectOnMap } from './SelectOnMap';
import './strings';

const DEFAULT_AREA_HA = 2;

const areaOf = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 5000 ? n : null;
};

const fmtArea = (ha: number): string => `${fmtNum(ha, ha < 10 ? 1 : 0)} ha`;

type SortBy = 'default' | 'area' | 'name';
const NEXT_SORT: Record<SortBy, SortBy> = { default: 'area', area: 'name', name: 'default' };

/** One field in the list: a dark thumbnail of its shape, its name, an optional tag, area and place. */
function FieldRow({ parcel, current, tag, sub, onOpen, label }: { parcel: Parcel; current: boolean; tag?: string; sub: string; onOpen: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      aria-current={current || undefined}
      className={cn('flex min-h-14 w-full items-center gap-2.5 rounded-sm px-1.5 py-1 text-left transition-colors duration-(--dur-fast)', current ? 'bg-surface-2' : 'hover:bg-surface-2')}
    >
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xs bg-ink-1">
        {/* The open field shows its real vegetation picture; the others their outline. */}
        {current ? <LiveFieldCanvas branch="vegetation" pad={4} /> : <ShapeThumb parcel={parcel} size={32} light />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-medium text-ink-1">{parcel.name}</span>
        {tag && <span className="self-start rounded-xs bg-signal px-1 text-[11px] leading-[14px] font-bold text-on-signal narrow:text-xs">{tag}</span>}
        <span className="truncate text-xs text-ink-3">{sub}</span>
      </span>
    </button>
  );
}

function Demos({ filter, sort }: { filter: string; sort: SortBy }) {
  const t = useT();
  const lang = useLang();
  const lockSample = useMission((s) => s.lockSample);
  const current = useMission((s) => s.parcel?.id);
  const q = filter.trim().toLowerCase();
  const rows = SAMPLE_PARCELS.filter((p) => !q || `${p.name} ${p.place?.label ?? ''}`.toLowerCase().includes(q));
  if (sort === 'area') rows.sort((a, b) => b.areaHa - a.areaHa);
  if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section aria-labelledby="demo-title" className="flex flex-col gap-1 pt-2">
      <h3 id="demo-title" className="px-1 pb-1 text-xs font-medium text-ink-1">
        {t('field.demo.group')}
      </h3>
      {rows.length === 0 ? (
        <p className="t-caption px-1">{t('field.list.none')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((p) => (
            <li key={p.id}>
              <FieldRow
                parcel={p}
                current={current === p.id}
                tag={t('field.demo.tag')}
                sub={[fmtArea(p.areaHa), p.place?.label].filter(Boolean).join(' · ')}
                label={t('field.demo.open', { name: p.name })}
                onOpen={() => void lockSample(p.id)}
              />
            </li>
          ))}
        </ul>
      )}
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
    <div className="flex flex-col gap-4 border-t border-line-1 pt-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium text-ink-1">{t('field.area.live')}</span>
          {draft?.areaHa != null ? (
            <span className="flex items-baseline gap-1" aria-live="polite">
              <span className="t-value text-lg text-ink-1">{fmtNum(draft.areaHa, draft.areaHa < 10 ? 2 : 1)}</span>
              <span className="t-unit">ha</span>
            </span>
          ) : (
            <span className="t-caption">--</span>
          )}
        </div>
        <p className="t-caption">{t('field.drag')}</p>
        {crossed && <p className="t-caption text-watch">{t('field.crossed')}</p>}
      </div>
      <Field label={t('field.name')} htmlFor={id}>
        <Input id={id} size="lg" value={name} placeholder={finalName} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lockable && lock()} />
      </Field>
      <div className="flex gap-2">
        <Button variant="secondary" size="lg" onClick={cancelDraw}>
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
  const [way, setWay] = useState<'address' | 'map'>('address');
  const sel = useSelectOnMap(way === 'map');
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
    <div className="flex flex-col gap-4 px-1">
      <header className="flex flex-col gap-2">
        <button type="button" onClick={() => (cancelDraw(), setListMode('list'))} className="-ml-1.5 flex h-8 items-center gap-1 self-start rounded-sm px-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink-1 narrow:h-11 narrow:text-base">
          <ArrowLeft size={16} aria-hidden />
          {t('field.add.back')}
        </button>
        <h2 className="text-base font-medium text-ink-1">{t('field.add.step')}</h2>
      </header>

      <Segmented<'address' | 'map'>
        ariaLabel={t('field.select.way')}
        block
        value={way}
        onValueChange={(v) => {
          cancelDraw();
          setChosen(null);
          setWay(v);
        }}
        options={[
          { value: 'address', label: t('field.select.address') },
          { value: 'map', label: t('field.select.map') },
        ]}
      />
      {way === 'map' ? (
        <>
          <SelectOnMapStatus state={sel.state} />
          {sel.state.kind === 'found' && draft?.closed && <LockForm place={sel.place} defaultName={sel.place?.label.split(',')[0]} />}
        </>
      ) : (
        <>
          <p className="t-caption">{t('field.add.lede')}</p>
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
                    className="pr-10"
                  />
                  <IconButton label={t('field.gps')} icon={<LocateFixed />} size="md" loading={locating} onClick={locate} className="absolute top-1/2 right-1 -translate-y-1/2" />
                </div>
              </Field>
              {(busy || hits) && (
                <ul id={`${id}-list`} role="listbox" aria-label={t('field.address')} className="absolute inset-x-0 top-full z-(--z-popover) mt-1 flex max-h-64 flex-col overflow-y-auto rounded-sm border border-line-1 bg-surface-0 py-1 shadow-lg">
                  {busy && <li className="t-caption px-3 py-2">{t('field.searching')}</li>}
                  {!busy && hits?.length === 0 && <li className="t-caption px-3 py-2">{failed ? t('field.search.failed') : t('field.search.none', { q })}</li>}
                  {!busy &&
                    hits?.map((h) => (
                      <li key={`${h.location[0]},${h.location[1]}`} role="option" aria-selected={false}>
                        <button type="button" onClick={() => put(h)} className="flex min-h-11 w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2">
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
              <Button type="submit" variant="primary" size="lg" iconRight={<ArrowRight />} disabled={!canSubmit || areaInvalid}>
                {t('field.show')}
              </Button>
            )}
          </form>

          {placed && <LockForm place={chosen ? { label: chosen.label, country: chosen.country, admin1: chosen.admin1 } : undefined} defaultName={chosen?.label.split(',')[0]} />}
        </>
      )}
    </div>
  );
}

/** The list panel: title and total, search and sort, your field, the demo group, then the two cards. */
export function FieldList() {
  const t = useT();
  const parcel = useMission((s) => s.parcel);
  const setPhase = useMission((s) => s.setPhase);
  const setAskOpen = useMission((s) => s.setAskOpen);
  const setListMode = useMissionUi((s) => s.setListMode);
  const isDemo = SAMPLE_PARCELS.some((p) => p.id === parcel?.id);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortBy>('default');
  const own = parcel && !isDemo ? parcel : null;
  return (
    <div className="flex min-h-full flex-col gap-3">
      <header className="flex flex-col gap-3 px-1">
        <div className="flex flex-col">
          <h2 className="text-base font-medium text-ink-1">{t('field.list.title')}</h2>
          <span className="text-xs text-ink-3">
            {t('field.list.total', {
              n: SAMPLE_PARCELS.length + (own ? 1 : 0),
              a: fmtNum(SAMPLE_PARCELS.reduce((a, p) => a + p.areaHa, 0) + (own ? own.areaHa : 0), 1),
            })}
          </span>
        </div>
        <div className="flex h-8 items-center gap-2 border-b border-line-1 pb-1 narrow:h-11">
          <Search size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('field.list.search')}
            aria-label={t('field.list.search')}
            className="h-full min-w-0 flex-1 bg-transparent text-xs text-ink-1 outline-none narrow:text-base"
          />
          <button
            type="button"
            onClick={() => setSort(NEXT_SORT[sort])}
            title={t(`field.list.sort.${sort}`)}
            aria-label={`${t('field.list.sort')}: ${t(`field.list.sort.${sort}`)}`}
            className={cn('flex h-full shrink-0 items-center gap-1 rounded-xs px-1 text-xs font-medium hover:bg-surface-2', sort === 'default' ? 'text-ink-1' : 'text-signal-strong')}
          >
            {t('field.list.sort')}
            <ArrowDownUp size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </header>
      {own && (
        <section className="flex flex-col gap-1 pt-2">
          <h3 className="px-1 pb-1 text-xs font-medium text-ink-1">{t('field.list.yours')}</h3>
          <FieldRow parcel={own} current sub={[fmtArea(own.areaHa), own.place?.label].filter(Boolean).join(' · ')} label={own.name} onOpen={() => setPhase('locked')} />
        </section>
      )}
      <Demos filter={q} sort={sort} />
      <div className="flex min-h-52 flex-1 flex-col items-center justify-center gap-2 rounded-sm bg-surface-2 px-4 py-6 text-center">
        <SquarePlus size={20} strokeWidth={1.5} aria-hidden className="text-ink-1" />
        <h3 className="text-md font-medium text-ink-1">{t('field.add.title')}</h3>
        <p className="text-xs text-ink-3">{t('field.add.card')}</p>
        <Button variant="primary" icon={<Plus />} className="mt-2 narrow:h-11 narrow:px-4 narrow:text-base" onClick={() => setListMode('add')}>
          {t('field.add.button')}
        </Button>
      </div>
      <div className="flex flex-col items-center gap-1.5 rounded-sm border border-signal px-4 py-4 text-center">
        <MessageCircleQuestion size={20} strokeWidth={1.5} aria-hidden className="text-ink-1" />
        <h3 className="text-md font-medium text-ink-1">{t('field.askCard.title')}</h3>
        <p className="text-xs text-ink-3">{t('field.askCard.body')}</p>
        <Button variant="secondary" className="mt-1.5 border-signal text-signal-strong narrow:h-11 narrow:px-4 narrow:text-base" onClick={() => setAskOpen(true)}>
          {t('field.askCard.button')}
        </Button>
      </div>
    </div>
  );
}
