/**
 * The one search of the app, for places and fields alike. Rows come from `searchModel` (the
 * visitor's own field, the demo field, typed coordinates, places from the geocoder); a row is taken
 * with a click or with Enter. Two looks: `glass` is the outlined pill of the landing and of the
 * finder box, with the list opening upward; `map` is the dark pill beside an open field, with the
 * list opening downward.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { LandPlot, LocateFixed, MapPin, Search, Sprout, X } from 'lucide-react';
import type { PlaceHit } from '@/contracts';
import { DEMO_FIELD, searchPlace } from '@/data';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { cn } from '@/ui/design';
import { COORDS_ZOOM, PLACE_ZOOM, goToPlace, openDemoField, openOwnField } from './finderActions';
import { highlight, mergeSuggestions, moveIndex, parseLatLon, type Suggestion, type SuggestionKind } from './searchModel';
import { useMissionUi } from './uiState';
import './strings';

/** Public geocoders ask for no more than one request a second: wait for the typing to settle. */
const DEBOUNCE_MS = 450;

const KIND_ICON: Record<SuggestionKind, ReactNode> = {
  own: <LandPlot aria-hidden />,
  demo: <Sprout aria-hidden />,
  coords: <LocateFixed aria-hidden />,
  place: <MapPin aria-hidden />,
};

const LOOK = {
  glass: {
    pill: 'h-[58px] gap-3 rounded-full border-[1.5px] border-white bg-surface-0/55 pr-3 pl-6 focus-within:bg-surface-0/80 narrow:h-[52px] narrow:pl-5',
    input: 'text-lg placeholder:text-white/75 narrow:text-md',
    icon: 22,
    // Solid where the browser cannot blur what is behind; frosted where it can.
    popup:
      'bottom-full mb-3 rounded-[22px] border border-white/40 bg-surface-0 p-1.5 text-white supports-[backdrop-filter:blur(1px)]:bg-surface-0/70 supports-[backdrop-filter:blur(1px)]:backdrop-blur-xl',
    option: 'min-h-14 gap-4 rounded-[16px] px-4 py-2 [&_svg]:size-6',
    active: 'bg-white/15',
    title: 'text-lg leading-6 narrow:text-md',
    detail: 'text-base text-white/75',
    note: 'px-4 py-2.5 text-base text-white/75',
  },
  map: {
    pill: 'h-10 gap-2 rounded-[20px] border border-ink-1 bg-ink-1 pr-1.5 pl-3 shadow-map focus-within:border-white/50 narrow:h-11',
    input: 'text-base placeholder:text-ink-4',
    icon: 20,
    popup: 'top-full right-0 mt-1.5 w-80 max-w-[calc(100vw-24px)] rounded-sm bg-surface-0 py-2 text-ink-1 shadow-lg',
    option: 'mx-2 min-h-11 gap-2.5 rounded-sm px-2 py-1.5 [&_svg]:size-4 [&_svg]:text-ink-3',
    active: 'bg-surface-2',
    title: 'text-base',
    detail: 'text-xs text-ink-3',
    note: 't-caption px-4 py-2',
  },
} as const;

export interface PlaceSearchProps {
  look: keyof typeof LOOK;
  /** A short placeholder for a narrow pill; the accessible name stays the full one. */
  compact?: boolean;
  /** Told when the list opens or closes, so the host can hide what it would cover. */
  onOpenChange?: (open: boolean) => void;
  onOpenField?: () => void;
  className?: string;
}

export function PlaceSearch({ look, compact, onOpenChange, onOpenField, className }: PlaceSearchProps) {
  const t = useT();
  const lang = useLang();
  const hero = useMission((s) => s.phase === 'hero');
  const own = useMissionUi((s) => s.ownField);
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<PlaceHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  /** The text a chosen place left in the input: it is not searched again. */
  const [settled, setSettled] = useState<string | null>(null);
  const seq = useRef(0);
  const id = useId();
  const style = LOOK[look];

  // Back on the landing the search starts empty.
  useEffect(() => {
    if (!hero) return;
    setQ('');
    setSettled(null);
    setOpen(false);
  }, [hero]);

  useEffect(() => {
    const query = q.trim();
    seq.current++;
    if (query.length < 2 || query === settled || parseLatLon(query)) {
      setPlaces(null);
      setBusy(false);
      return;
    }
    const my = seq.current;
    setBusy(true);
    setFailed(false);
    const timer = setTimeout(() => {
      searchPlace(query, lang)
        .then((r) => my === seq.current && setPlaces(r))
        .catch(() => my === seq.current && (setFailed(true), setPlaces([])))
        .finally(() => my === seq.current && setBusy(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, lang, settled]);

  const kindLabel = (kind: SuggestionKind) => t(`search.kind.${kind}`);
  const ownWords = t('search.kind.own');
  const demoWords = t('search.kind.demo');
  const rows = useMemo(() => mergeSuggestions({ query: q, own, demo: DEMO_FIELD, ownWords, demoWords, places }), [q, own, ownWords, demoWords, places]);
  const rowIds = rows.map((r) => r.id).join('|');
  // A new list starts with its first row highlighted: Enter takes it.
  useEffect(() => setIndex(0), [rowIds]);

  const searched = places != null && !busy;
  const shown = open && q.trim() !== '' && q.trim() !== settled && (rows.length > 0 || busy || searched);
  useEffect(() => onOpenChange?.(shown), [shown, onOpenChange]);
  const active = shown ? rows[Math.min(index, rows.length - 1)] : undefined;

  const choose = (row: Suggestion) => {
    setOpen(false);
    if (row.kind === 'own' || row.kind === 'demo') {
      setQ('');
      setSettled(null);
      if (row.kind === 'own') openOwnField();
      else openDemoField();
      onOpenField?.();
      return;
    }
    setQ(row.title);
    setSettled(row.title);
    goToPlace(row.location, row.kind === 'coords' ? COORDS_ZOOM : PLACE_ZOOM);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown) setOpen(true);
      else setIndex((i) => moveIndex(i, e.key === 'ArrowDown' ? 1 : -1, rows.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) choose(active);
    } else if (e.key === 'Escape' && shown) {
      // Only the list closes: the key does not reach whatever else listens for Escape.
      e.stopPropagation();
      setOpen(false);
    }
  };

  const clear = () => {
    setQ('');
    setSettled(null);
    setPlaces(null);
  };

  return (
    <div
      role="search"
      className={cn('relative', className)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label className={cn('flex items-center text-white transition-colors duration-(--dur-fast)', style.pill)}>
        <Search size={style.icon} strokeWidth={1.5} aria-hidden className="shrink-0" />
        <input
          role="combobox"
          aria-label={t('search.label')}
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-activedescendant={active ? `${id}-${active.id}` : undefined}
          value={q}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={t(compact ? 'search.short' : 'search.label')}
          onChange={(e) => {
            setQ(e.target.value);
            setSettled(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn('h-full min-w-0 flex-1 bg-transparent text-white outline-none', style.input)}
        />
        {q && (
          <button type="button" aria-label={t('search.clear')} onClick={clear} className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/75 hover:bg-white/15 hover:text-white narrow:size-10">
            <X size={16} aria-hidden />
          </button>
        )}
      </label>

      <div className={cn('absolute z-(--z-popover) flex-col', look === 'glass' && 'inset-x-0', style.popup, shown ? 'flex' : 'hidden')}>
        {/* The list stays in the page while closed, so `aria-controls` always points at something. */}
        <ul id={`${id}-list`} role="listbox" aria-label={t('search.results')} className="m-0 flex max-h-[min(60dvh,26rem)] list-none flex-col overflow-y-auto p-0">
          {rows.map((row, i) => (
            <li
              key={row.id}
              id={`${id}-${row.id}`}
              role="option"
              aria-selected={row === active}
              // The press must not take the focus from the input, or the list would close before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => index !== i && setIndex(i)}
              onClick={() => choose(row)}
              className={cn('flex cursor-pointer items-center text-left', style.option, row === active && style.active)}
            >
              <span className="flex shrink-0 [&_svg]:stroke-[1.5]">{KIND_ICON[row.kind]}</span>
              <span className="flex min-w-0 flex-col">
                <span className={cn('truncate', style.title)}>
                  {highlight(row.title, q).map((part, k) => (part.bold ? <strong key={k} className="font-bold">{part.text}</strong> : <span key={k}>{part.text}</span>))}
                </span>
                <span className={cn('truncate', style.detail)}>{[kindLabel(row.kind), row.detail].filter(Boolean).join(' · ')}</span>
              </span>
            </li>
          ))}
        </ul>
        <p role="status" className={cn('m-0', style.note, !(busy || (searched && rows.length === 0)) && 'hidden')}>
          {busy ? t('search.searching') : searched && rows.length === 0 ? (failed ? t('search.failed') : t('search.none', { q: q.trim() })) : ''}
        </p>
        {look === 'glass' && (
          // The notch that points at the input: the lower half of a turned square, hanging from the frame.
          <span aria-hidden className="pointer-events-none absolute top-[calc(100%+1px)] left-9 h-2 w-5 overflow-hidden">
            <span className="absolute -top-[7px] left-[3px] size-3.5 rotate-45 border border-white/40 bg-surface-0 supports-[backdrop-filter:blur(1px)]:bg-surface-0/70" />
          </span>
        )}
      </div>
    </div>
  );
}
