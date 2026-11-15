/**
 * The list panel and the add-a-field step.
 *   FieldList  title, total and sort, the fields as rows (your own first, then the demo field), the
 *              card that starts the add step, and a card that opens the assistant. Finding a field
 *              by typing is the job of the one search (`@/ui/chrome/PlaceSearch`), not of this list.
 *   FindField  one address (or "lat, lon") and one area, or a click on the map; the outline that
 *              lands can be dragged by its corners, then the field is named and locked. Beside an
 *              open field it fills the list column; before one (`floating`) it is one line above
 *              the finder box while it waits for a click on the map, and otherwise a card on the
 *              left edge of a wide screen, or a sheet above the box on a narrow one, so that the
 *              outline it talks about stays in view.
 * One green button per state: Add field, then Show on the map, then Open this field (always in view, on the
 * bottom edge of the step).
 */
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, LocateFixed, MapPin, MessageCircleQuestion, MousePointerClick, Plus, Search, SquarePlus, X } from 'lucide-react';
import type { LngLat, Parcel, PlaceHit, PlaceInfo, SampleParcel } from '@/contracts';
import { pick } from '@/contracts';
import { DEMO_FIELD, getSampleParcel, reverseGeocode, searchPlace } from '@/data';
import { draftToParcel, isLockable, squareDraft } from '@/globe';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, Field, IconButton, Input, Popover, Segmented, cn } from '@/ui/design';
import { parseLatLon } from '@/ui/chrome/searchModel';
import { useMissionUi } from '@/ui/chrome/uiState';
import { fmtNum } from '@/ui/hud/format';
import { LiveFieldCanvas, ShapeThumb } from './FieldCanvas';
import { SelectOnMapHint, SelectOnMapStatus, useSelectOnMap } from './SelectOnMap';
import './strings';

const DEFAULT_AREA_HA = 2;

const areaOf = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 5000 ? n : null;
};

const fmtArea = (ha: number): string => `${fmtNum(ha, ha < 10 ? 1 : 0)} ha`;

/** The short place line of a row: region and country when the geocoder gave them, else its label. */
const placeLine = (place: PlaceInfo | undefined): string | undefined => (place ? [place.admin1, place.country].filter(Boolean).join(', ') || place.label : undefined);

/**
 * A neutral default name, "Field in <region>". The first part of a geocoder label is often a shop
 * or a street, so the region is taken from `admin1`, else from the second-last part of the label.
 */
function defaultFieldName(t: (k: string, v?: Record<string, string | number>) => string, place: PlaceInfo | undefined): string | undefined {
  if (!place) return undefined;
  const parts = place.label.split(',').map((p) => p.trim()).filter(Boolean);
  const fromLabel = parts.length >= 3 ? parts.at(-2) : undefined;
  const region = place.admin1 ?? (fromLabel && !/^[-\d.\s]+$/.test(fromLabel) ? fromLabel : undefined);
  return region ? t('field.name.in', { place: region }) : undefined;
}

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
      // A row runs edge to edge of the panel, 56 px tall, and turns grey under the pointer and when it is the open field.
      className={cn('flex min-h-14 w-full items-center gap-2 px-4 py-1 text-left transition-colors duration-(--dur-fast)', current ? 'bg-surface-2' : 'hover:bg-surface-2')}
    >
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-ink-1">
        {/* The open field shows its real vegetation picture; the others their outline. */}
        {current ? <LiveFieldCanvas branch="vegetation" pad={5} /> : <ShapeThumb parcel={parcel} size={38} light />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base leading-[18px] font-medium text-ink-1">{parcel.name}</span>
        {tag && <span className="self-start rounded-xs bg-signal px-1 text-[10px] leading-[13px] font-medium text-on-signal narrow:text-xs narrow:leading-4">{tag}</span>}
        <span className="truncate text-xs leading-4 text-ink-3">{sub}</span>
      </span>
    </button>
  );
}

/**
 * The demo fields the list shows: the one the app offers, and a sample opened by a `?sample=<id>`
 * deep link, so that the open field is always in the list.
 */
function useDemoRows(): SampleParcel[] {
  const openId = useMission((s) => s.parcel?.id);
  const open = openId && openId !== DEMO_FIELD.id ? getSampleParcel(openId) : undefined;
  return open ? [DEMO_FIELD, open] : [DEMO_FIELD];
}

function Demos({ rows, sort, onOpenField }: { rows: SampleParcel[]; sort: SortBy; onOpenField?: () => void }) {
  const t = useT();
  const lang = useLang();
  const lockSample = useMission((s) => s.lockSample);
  const current = useMission((s) => s.parcel?.id);
  const sorted = [...rows];
  if (sort === 'area') sorted.sort((a, b) => b.areaHa - a.areaHa);
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section aria-labelledby="demo-title" className="flex flex-col pt-2">
      <h3 id="demo-title" className="px-4 pb-3 text-base leading-4 font-medium text-ink-1">
        {t(sorted.length > 1 ? 'field.demo.groupMany' : 'field.demo.group')}
      </h3>
      <ul className="flex flex-col">
        {sorted.map((p) => (
          <li key={p.id}>
            <FieldRow
              parcel={p}
              current={current === p.id}
              tag={t('field.demo.tag')}
              sub={[fmtArea(p.areaHa), placeLine(p.place)].filter(Boolean).join(' · ')}
              label={t('field.demo.open', { name: p.name })}
              onOpen={() => {
                if (!onOpenField || p.id !== current) void lockSample(p.id);
                onOpenField?.();
              }}
            />
          </li>
        ))}
      </ul>
      <span className="sr-only">{sorted.map((p) => pick(p.tagline, lang)).join('. ')}</span>
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
    <>
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
      </div>
      {/*
        The step scrolls inside a short sheet on a phone and inside a card on a low window. The button that
        opens the field is the point of the step, so it stays on the bottom edge of whatever scrolls:
        a sibling of the form, not a part of it, because a sticky box cannot leave its parent
        (the negative offsets take it out to the edges of the step's padding, so nothing shows under it).
      */}
      <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex gap-2 border-t border-line-1 bg-surface-0 px-4 py-3">
        <Button variant="secondary" size="lg" onClick={cancelDraw}>
          {t('field.cancel')}
        </Button>
        <Button variant="primary" size="lg" className="flex-1" iconRight={<ArrowRight />} disabled={!lockable} onClick={lock}>
          {t('field.lock')}
        </Button>
      </div>
    </>
  );
}

export function FindField({ floating = false }: { floating?: boolean }) {
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
  const way = useMissionUi((s) => s.addWay);
  const setWay = useMissionUi((s) => s.setAddWay);
  const setAddCard = useMissionUi((s) => s.setAddCard);
  const finderH = useMissionUi((s) => s.finderH);
  const sel = useSelectOnMap(way === 'map');
  const placed = !!draft?.closed && !!chosen;
  /** Floating only: the visitor asked for the whole step, so it no longer folds to one line. */
  const [expanded, setExpanded] = useState(false);

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
    // No flight of its own: the globe frames the square in the free part of the screen when it lands.
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

  const switchWay = (v: 'address' | 'map') => {
    cancelDraw();
    setChosen(null);
    setWay(v);
  };
  const leave = () => {
    cancelDraw();
    setListMode('list');
  };

  // Waiting for the click that picks the field: one line, so the map under it stays clear.
  // An outline already on the map is never "waiting", whatever led to it: the step must then offer the button that opens it.
  const waiting = way === 'map' && !draft?.closed && (sel.state.kind === 'idle' || sel.state.kind === 'zoomed' || sel.state.kind === 'detecting');
  const card = floating && !(waiting && !expanded);
  // The shell counts the card as covered map, so the outline is framed beside it.
  useEffect(() => {
    if (!floating) return;
    setAddCard(card);
    return () => setAddCard(false);
  }, [floating, card, setAddCard]);
  if (floating && !card) {
    return (
      <SelectOnMapHint
        control={sel}
        onAddress={() => {
          setExpanded(true);
          switchWay('address');
        }}
      />
    );
  }

  const step = (
    <div className="flex flex-col gap-4 px-4">
      {floating ? (
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-md leading-[21px] font-medium text-ink-1">{t('field.add.step')}</h2>
          <IconButton label={t('field.add.close')} icon={<X />} size="md" onClick={leave} className="-mr-1.5" />
        </header>
      ) : (
        <header className="flex flex-col gap-2">
          <button type="button" onClick={leave} className="-ml-1.5 flex h-8 items-center gap-1 self-start rounded-sm px-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink-1 narrow:h-11 narrow:text-base">
            <ArrowLeft size={16} aria-hidden />
            {t('field.add.back')}
          </button>
          <h2 className="text-md leading-[21px] font-medium text-ink-1">{t('field.add.step')}</h2>
        </header>
      )}

      <Segmented<'address' | 'map'>
        ariaLabel={t('field.select.way')}
        block
        value={way}
        onValueChange={(v) => {
          setExpanded(true);
          switchWay(v);
        }}
        options={[
          { value: 'address', label: t('field.select.address') },
          { value: 'map', label: t('field.select.map') },
        ]}
      />
      {way === 'map' ? (
        <>
          <SelectOnMapStatus control={sel} />
          {draft?.closed && <LockForm place={sel.place} defaultName={defaultFieldName(t, sel.place)} />}
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

          {placed && chosen && <LockForm place={{ label: chosen.label, country: chosen.country, admin1: chosen.admin1 }} defaultName={defaultFieldName(t, chosen)} />}
        </>
      )}
    </div>
  );
  if (!floating) return step;
  return (
    <section
      aria-label={t('field.add.step')}
      data-panel-scroll
      // Wide: a card on the left edge (ADD_CARD in uiState: 360 px, 16 px margins), clear of the credits under it. Narrow: a sheet in the finder's stack.
      // Between 1100 and 1362 px the centred finder box (594 px) reaches under the card's right edge, so there the card ends above the box.
      style={{ '--finder-h': `${finderH || 150}px` } as CSSProperties}
      className="pointer-events-auto fixed top-4 left-4 max-h-[calc(100dvh-56px)] w-[360px] overflow-y-auto rounded-lg border border-line-2 bg-surface-0 py-4 shadow-lg min-[1100px]:max-[1362px]:max-h-[calc(100dvh-var(--finder-h)-44px)] narrow:static narrow:max-h-[45dvh] narrow:w-auto"
    >
      {step}
    </section>
  );
}

/** The list panel: title, total and sort, your field, the demo field, then the two cards. */
export function FieldList({ onOpenField }: { onOpenField?: () => void }) {
  const t = useT();
  const parcel = useMission((s) => s.parcel);
  const setPhase = useMission((s) => s.setPhase);
  const lockParcel = useMission((s) => s.lockParcel);
  const setAskOpen = useMission((s) => s.setAskOpen);
  const setListMode = useMissionUi((s) => s.setListMode);
  const setAddWay = useMissionUi((s) => s.setAddWay);
  const own = useMissionUi((s) => s.ownField);
  const demos = useDemoRows();
  const [sort, setSort] = useState<SortBy>('default');
  const count = demos.length + (own ? 1 : 0);
  const area = demos.reduce((a, p) => a + p.areaHa, 0) + (own ? own.areaHa : 0);
  const ownOpen = !!own && own.id === parcel?.id;
  return (
    <div className="flex min-h-full flex-col gap-3">
      <header className="flex items-start justify-between gap-2 border-b border-line-1 pr-2 pb-2 pl-4">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-md leading-[21px] font-medium text-ink-1">{t('field.list.title')}</h2>
          <span className="text-xs leading-4 text-ink-3">{t(count === 1 ? 'field.list.totalOne' : 'field.list.total', { n: count, a: fmtNum(area, 1) })}</span>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => setSort(NEXT_SORT[sort])}
            title={t(`field.list.sort.${sort}`)}
            aria-label={`${t('field.list.sort')}: ${t(`field.list.sort.${sort}`)}`}
            className={cn('flex h-8 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium hover:bg-surface-3', sort === 'default' ? 'text-ink-1' : 'text-signal-strong')}
          >
            {t('field.list.sort')}
            <ArrowDownUp size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </header>
      {own && (
        <section className="flex flex-col pt-2">
          <h3 className="px-4 pb-3 text-base leading-4 font-medium text-ink-1">{t('field.list.yours')}</h3>
          <FieldRow
            parcel={own}
            current={ownOpen}
            sub={[fmtArea(own.areaHa), placeLine(own.place)].filter(Boolean).join(' · ')}
            label={own.name}
            onOpen={() => {
              if (ownOpen) setPhase('locked');
              else void lockParcel(own);
              onOpenField?.();
            }}
          />
        </section>
      )}
      <Demos rows={demos} sort={sort} onOpenField={onOpenField} />
      <div className="mx-3 flex min-h-56 flex-1 flex-col items-center justify-center gap-2 rounded-sm bg-surface-2 p-4 text-center">
        <SquarePlus size={24} strokeWidth={1.5} aria-hidden className="mb-2 text-ink-1" />
        <h3 className="text-md leading-[19px] font-medium text-ink-1">{t('field.add.title')}</h3>
        <p className="text-base leading-[17px] text-ink-1">{t('field.add.card')}</p>
        {/* The green button opens the ways to add a field, the way the reference's does; the step that follows can still switch. */}
        <Popover
          side="bottom"
          align="center"
          label={t('field.add.way')}
          className="w-52 border-0 px-0 py-2"
          trigger={
            <Button variant="primary" icon={<Plus />} className="mt-4 narrow:h-11 narrow:px-4 narrow:text-base">
              {t('field.add.button')}
            </Button>
          }
        >
          <ul className="flex flex-col">
            {(
              [
                ['map', <MousePointerClick key="i" />, 'field.select.map'],
                ['address', <MapPin key="i" />, 'field.select.address'],
              ] as const
            ).map(([way, icon, key]) => (
              <li key={way} className="px-2">
                <button
                  type="button"
                  onClick={() => (setAddWay(way), setListMode('add'))}
                  className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-base text-ink-1 hover:bg-surface-2 narrow:h-11 [&_svg]:size-4 [&_svg]:stroke-[1.5] [&_svg]:text-ink-3"
                >
                  {icon}
                  {t(key)}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      </div>
      <div className="mx-3 flex flex-col items-center gap-1.5 rounded-lg border-2 border-signal px-4 py-5 text-center">
        <MessageCircleQuestion size={24} strokeWidth={1.5} aria-hidden className="mb-1 text-ink-1" />
        <h3 className="text-md leading-[21px] font-medium text-ink-1">{t('field.askCard.title')}</h3>
        <p className="text-xs leading-4 text-ink-3">{t('field.askCard.body')}</p>
        <Button variant="secondary" className="mt-1.5 border-signal text-signal-strong narrow:h-11 narrow:px-4 narrow:text-base" onClick={() => setAskOpen(true)}>
          {t('field.askCard.button')}
        </Button>
      </div>
    </div>
  );
}
