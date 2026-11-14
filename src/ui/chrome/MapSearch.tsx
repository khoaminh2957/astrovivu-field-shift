/**
 * A place search for the map (a dark pill, like every map control) that flies the camera there,
 * and the latest weather reading of the locked field as plain white text over the imagery.
 * Neither changes the field in the panel.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { CloudSun, MapPin, Search, Wind, X } from 'lucide-react';
import type { LngLat, PlaceHit } from '@/contracts';
import { searchPlace } from '@/data';
import { flyToPoint } from '@/globe';
import { useLang, useT } from '@/i18n';
import { findSeries } from '@/lib/series';
import { useMission } from '@/state/mission';
import { cn } from '@/ui/design';
import { fmtNum } from '@/ui/hud/format';
import './strings';

/** "12.68, 108.05" or "12.68 108.05": latitude first, the way people copy it from a map. */
export function parseLatLon(q: string): LngLat | null {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

export function MapSearch({ className }: { className?: string }) {
  const t = useT();
  const lang = useLang();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const id = useId();

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || parseLatLon(query)) {
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
  }, [q, lang]);

  const go = (at: LngLat, label?: string) => {
    flyToPoint(at, 14);
    if (label) setQ(label);
    setOpen(false);
  };
  const submit = () => {
    const ll = parseLatLon(q);
    if (ll) go(ll);
    else if (hits?.[0]) go(hits[0].location, hits[0].label);
  };
  const showList = open && (busy || hits != null);

  return (
    <form
      role="search"
      className={cn('relative', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      <label className="flex h-10 items-center gap-2 rounded-[20px] border border-ink-1 bg-ink-1 pr-1.5 pl-3 text-white shadow-map focus-within:border-white/50 narrow:h-11">
        <Search size={20} strokeWidth={1.5} aria-hidden className="shrink-0" />
        <span className="sr-only">{t('map.search')}</span>
        <input
          value={q}
          autoComplete="off"
          placeholder={t('map.search')}
          aria-expanded={showList}
          aria-controls={`${id}-list`}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-ink-4"
        />
        {q && (
          <button type="button" aria-label={t('map.search.clear')} onClick={() => (setQ(''), setHits(null))} className="flex size-7 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white">
            <X size={14} aria-hidden />
          </button>
        )}
      </label>
      {showList && (
        <ul id={`${id}-list`} role="listbox" aria-label={t('map.search')} className="absolute top-full right-0 z-(--z-popover) mt-1.5 flex max-h-64 w-72 max-w-[calc(100vw-24px)] flex-col overflow-y-auto rounded-sm bg-surface-0 py-2 shadow-lg">
          {busy && <li className="t-caption px-3 py-2">{t('field.searching')}</li>}
          {!busy && hits?.length === 0 && <li className="t-caption px-3 py-2">{failed ? t('field.search.failed') : t('field.search.none', { q })}</li>}
          {!busy &&
            hits?.map((h) => (
              <li key={`${h.location[0]},${h.location[1]}`} role="option" aria-selected={false}>
                <button type="button" onClick={() => go(h.location, h.label)} className="mx-2 flex min-h-8 w-[calc(100%-16px)] items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2">
                  <MapPin size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-3" />
                  <span className="min-w-0 truncate text-base text-ink-1">{h.label}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </form>
  );
}

export interface WeatherNow {
  tmax: number | null;
  rain: number | null;
  wind: number | null;
}

/** The latest daily values at or before today from the field's own telemetry; null before it loads. */
export function useWeatherNow(): WeatherNow | null {
  const tel = useMission((s) => s.telemetry);
  if (!tel) return null;
  const last = (key: string, b: 'agromet' | 'rainfall') => findSeries(tel.branches[b], key)?.samples.filter((v) => v.t <= tel.window.today && v.v != null).at(-1)?.v ?? null;
  return { tmax: last('t2m_max', 'agromet'), rain: last('rain', 'rainfall'), wind: last('wind', 'agromet') };
}

/** Weather for the locked field, white text straight on the map. Hidden until there is a reading. */
export function WeatherChip({ className }: { className?: string }) {
  const t = useT();
  const w = useWeatherNow();
  if (!w || w.tmax == null) return null;
  return (
    <div title={t('field.weather')} className={cn('t-value flex h-8 shrink-0 items-center gap-3 px-2 text-base font-normal whitespace-nowrap text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]', className)}>
      <span className="inline-flex items-center gap-1.5">
        <CloudSun size={18} strokeWidth={1.5} aria-hidden />
        {fmtNum(w.tmax, 0)}°
      </span>
      {w.wind != null && (
        <span className="inline-flex items-center gap-1.5">
          <Wind size={16} strokeWidth={1.5} aria-hidden />
          {fmtNum(w.wind, 0)} m/s
        </span>
      )}
      <span className="sr-only">{t('field.weather')}</span>
    </div>
  );
}
