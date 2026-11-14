/** Where the grower lives: device location or a place search. */
import { type FormEvent, useState } from 'react';
import { Crosshair, MapPin, Search } from 'lucide-react';
import type { LngLat, PlaceHit } from '@/contracts';
import { reverseGeocode, searchPlace } from '@/data';
import { useLang, useT } from '@/i18n';
import { Button, Input } from '@/ui/design';
import './strings';

export interface Loc {
  at: LngLat;
  label: string;
}

export function LocationPicker({ loc, onPick }: { loc: Loc | null; onPick: (l: Loc) => void }) {
  const t = useT();
  const lang = useLang();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [busy, setBusy] = useState<'gps' | 'search' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const useGps = () => {
    if (!navigator.geolocation) return setError(t('urban.gpsNone'));
    setBusy('gps');
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const at: LngLat = [p.coords.longitude, p.coords.latitude];
        const info = await reverseGeocode(at, lang);
        onPick({ at, label: info?.label ?? `${at[1].toFixed(3)}, ${at[0].toFixed(3)}` });
        setBusy(null);
      },
      () => {
        setError(t('urban.gpsDenied'));
        setBusy(null);
      },
      { timeout: 12000, maximumAge: 600000 },
    );
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy('search');
    setError(null);
    try {
      const r = await searchPlace(q, lang);
      setHits(r);
      if (!r.length) setError(t('urban.noHits'));
    } catch {
      setError(t('urban.searchFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="t-label">{t('urban.where')}</span>
      {loc && (
        <p className="flex items-start gap-2 rounded-sm bg-surface-2 px-2.5 py-2">
          <MapPin aria-hidden size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-signal-strong" />
          <span className="flex min-w-0 flex-col">
            <span className="text-md leading-snug text-ink-1">{loc.label}</span>
            <span className="t-meta">
              {loc.at[1].toFixed(4)}, {loc.at[0].toFixed(4)}
            </span>
          </span>
        </p>
      )}
      <form onSubmit={search} className="flex gap-2" role="search">
        <label htmlFor="urb-q" className="sr-only">
          {t('urban.searchLabel')}
        </label>
        <Input id="urb-q" size="lg" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('urban.searchPh')} prefix={<Search />} />
        <Button type="submit" size="lg" variant={loc ? 'secondary' : 'primary'} loading={busy === 'search'}>
          {t('urban.search')}
        </Button>
      </form>
      <Button size="lg" variant="secondary" icon={<Crosshair />} onClick={useGps} loading={busy === 'gps'} block>
        {t('urban.useGps')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-watch">
          {error}
        </p>
      )}
      {hits && hits.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {hits.slice(0, 6).map((h) => (
            <li key={`${h.location[0]},${h.location[1]}`}>
              <button
                type="button"
                onClick={() => {
                  onPick({ at: h.location, label: h.label });
                  setHits(null);
                }}
                className="flex min-h-11 w-full flex-col justify-center border-b border-line-1 px-1 text-left hover:bg-surface-2"
              >
                <span className="truncate text-sm text-ink-1">{h.label}</span>
                {(h.admin1 || h.country) && <span className="t-caption">{[h.admin1, h.country].filter(Boolean).join(', ')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
