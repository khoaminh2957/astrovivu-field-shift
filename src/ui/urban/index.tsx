/**
 * Urban Grower Companion (side mission). Location -> conditions now and monthly climate ->
 * light, space and preferences -> plant picks with a care calendar. Phone first.
 */
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Crosshair, Search, Sprout } from 'lucide-react';
import type { LngLat, PlaceHit, UrbanClimate, UrbanPreference, UrbanRecommendation, UrbanSite } from '@/contracts';
import { pick } from '@/contracts';
import { recommendUrban } from '@/core/urban';
import { loadUrbanClimate, reverseGeocode, searchPlace } from '@/data';
import { useLang, useT } from '@/i18n';
import { todayISO } from '@/lib/time';
import { Button, EmptyState, Input, Panel, Skeleton, SkeletonText, Stat, Tag, cn } from '@/ui/design';
import { useFixture } from '@/ui/advisory/fixture';
import { fmtNum, monthShort } from '@/ui/advisory/format';
import { FixtureTag, TextList, sourceName } from '@/ui/advisory/shared';
import './strings';

const PREFS: UrbanPreference[] = ['vegetables', 'herbs', 'flowers', 'shade-easy', 'fruit'];
type Loc = { at: LngLat; label: string };

export function UrbanCompanion() {
  const t = useT();
  const lang = useLang();
  const [loc, setLoc] = useState<Loc | null>(null);
  const [climate, setClimate] = useState<UrbanClimate | null>(null);
  const [climateState, setClimateState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [light, setLight] = useState<UrbanSite['light']>('partial');
  const [space, setSpace] = useState<UrbanSite['space']>('balcony');
  const [prefs, setPrefs] = useState<UrbanPreference[]>(['vegetables', 'herbs']);
  const fixture = useFixture(import.meta.env.DEV ? () => import('./__fixtures__/urban').then((m) => m.URBAN_FIXTURE) : null);
  const month = Number(todayISO().slice(5, 7));

  useEffect(() => {
    if (!loc) return;
    let alive = true;
    setClimate(null);
    setClimateState('loading');
    loadUrbanClimate(loc.at).then(
      (c) => alive && (setClimate(c), setClimateState('idle')),
      () => alive && setClimateState('error'),
    );
    return () => {
      alive = false;
    };
  }, [loc]);

  const recs: UrbanRecommendation[] = useMemo(() => {
    if (fixture) return fixture;
    if (!loc || !climate) return [];
    return recommendUrban({ location: loc.at, light, space, place: { label: loc.label } }, climate, prefs, month);
  }, [fixture, loc, climate, light, space, prefs, month]);

  return (
    <main aria-labelledby="urb-title" className="absolute inset-0 overflow-y-auto bg-surface-0">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 pt-4 pb-24 lg:px-6 lg:pt-5">
        <header className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 id="urb-title" className="text-xl leading-7 font-semibold text-ink-1">
              {t('urban.title')}
            </h1>
            {fixture && <FixtureTag />}
          </div>
          <p className="t-reading max-w-[68ch] text-ink-2 stacked:text-md">{t('urban.lead')}</p>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Panel title={t('urban.where')}>
              <LocationPicker loc={loc} onPick={setLoc} />
            </Panel>
            {loc && (
              <Panel title={t('urban.climate')}>
                <ClimateView climate={climate} state={climateState} month={month} />
              </Panel>
            )}
            <Panel title={t('urban.yourSpace')}>
              <div className="flex flex-col gap-4">
                <Choice label={t('urban.light')}>
                  <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={t('urban.light')}>
                    {(['full', 'partial', 'shade'] as const).map((v) => (
                      <ToggleChip key={v} on={light === v} onClick={() => setLight(v)} radio>
                        {t(`urban.light.${v}`)}
                      </ToggleChip>
                    ))}
                  </div>
                </Choice>
                <Choice label={t('urban.space')}>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-4" role="radiogroup" aria-label={t('urban.space')}>
                    {(['windowsill', 'balcony', 'rooftop', 'yard'] as const).map((v) => (
                      <ToggleChip key={v} on={space === v} onClick={() => setSpace(v)} radio>
                        {t(`urban.space.${v}`)}
                      </ToggleChip>
                    ))}
                  </div>
                </Choice>
                <Choice label={t('urban.prefs')} hint={t('urban.prefsHint')}>
                  <div className="flex flex-wrap gap-1">
                    {PREFS.map((p) => (
                      <ToggleChip key={p} on={prefs.includes(p)} onClick={() => setPrefs((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]))}>
                        {t(`urban.pref.${p}`)}
                      </ToggleChip>
                    ))}
                  </div>
                </Choice>
              </div>
            </Panel>
          </div>

          <section aria-labelledby="urb-picks" className="flex min-w-0 flex-col gap-3">
            <h2 id="urb-picks" className="t-title">
              {t('urban.picks')}
              {recs.length > 0 && <span className="t-meta ml-2">{recs.length}</span>}
            </h2>
            {recs.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {recs.map((r) => (
                  <PlantCard key={r.cropId} rec={r} month={month} />
                ))}
              </div>
            ) : !loc && !fixture ? (
              <EmptyState icon={<Sprout />} title={t('urban.noLoc')} body={t('urban.noLocBody')} />
            ) : climateState === 'loading' ? (
              <div className="grid gap-3 xl:grid-cols-2">
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
              </div>
            ) : (
              <EmptyState icon={<Sprout />} title={t('urban.noPicks')} body={t(climateState === 'error' ? 'urban.noClimateBody' : 'urban.noPicksBody')} />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Choice({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="t-label mb-1.5">{label}</legend>
      {children}
      {hint && <p className="t-caption">{hint}</p>}
    </fieldset>
  );
}

function ToggleChip({ on, onClick, radio, children }: { on: boolean; onClick: () => void; radio?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? on : undefined}
      aria-pressed={radio ? undefined : on}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center justify-center rounded-sm border px-2 py-1 text-center text-sm leading-tight font-medium transition-colors duration-(--dur-instant) lg:min-h-9',
        on ? 'border-signal bg-signal/12 text-signal-strong' : 'border-line-2 bg-surface-0 text-ink-2 hover:bg-surface-2 hover:text-ink-1',
      )}
    >
      {children}
    </button>
  );
}

function LocationPicker({ loc, onPick }: { loc: Loc | null; onPick: (l: Loc) => void }) {
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
    <div className="flex flex-col gap-3">
      {loc && (
        <p className="flex flex-col">
          <span className="text-md text-ink-1">{loc.label}</span>
          <span className="t-meta">
            {loc.at[1].toFixed(4)}, {loc.at[0].toFixed(4)}
          </span>
        </p>
      )}
      <Button size="lg" variant={loc ? 'secondary' : 'primary'} icon={<Crosshair />} onClick={useGps} loading={busy === 'gps'} block>
        {t('urban.useGps')}
      </Button>
      <form onSubmit={search} className="flex gap-2" role="search">
        <label htmlFor="urb-q" className="sr-only">
          {t('urban.searchLabel')}
        </label>
        <Input id="urb-q" size="lg" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('urban.searchPh')} prefix={<Search />} />
        <Button type="submit" size="lg" loading={busy === 'search'}>
          {t('urban.search')}
        </Button>
      </form>
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

function ClimateView({ climate, state, month }: { climate: UrbanClimate | null; state: 'idle' | 'loading' | 'error'; month: number }) {
  const t = useT();
  const lang = useLang();
  if (state === 'error') return <p className="text-sm text-watch">{t('urban.noClimateBody')}</p>;
  if (!climate) return <SkeletonText lines={4} />;
  const ms = [...climate.months].sort((a, b) => a.month - b.month);
  const tLo = Math.floor(Math.min(...ms.map((m) => m.tMin)) / 5) * 5;
  const tHi = Math.ceil(Math.max(...ms.map((m) => m.tMax)) / 5) * 5;
  const rainMax = Math.max(50, ...ms.map((m) => m.rainMm));
  const pct = (v: number) => ((v - tLo) / (tHi - tLo || 1)) * 100;
  const now = climate.now;
  return (
    <div className="flex flex-col gap-4">
      {now && (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('urban.now.t')} value={now.t == null ? null : fmtNum(now.t, lang, 1)} unit="°C" />
            <Stat label={t('urban.now.rh')} value={now.rh == null ? null : fmtNum(now.rh, lang)} unit="%" />
            <Stat label={t('urban.now.par')} value={now.par == null ? null : fmtNum(now.par, lang, 1)} unit="MJ/m²" />
          </div>
          <span className="t-meta">{t('urban.now.at', { at: now.observedAt.replace('T', ' ') })}</span>
        </div>
      )}
      <figure className="m-0 flex flex-col gap-1" role="img" aria-label={t('urban.climateSummary', { lo: fmtNum(tLo, lang), hi: fmtNum(tHi, lang) })}>
        <div className="grid h-28 grid-cols-12 gap-1">
          {ms.map((m) => (
            <div key={m.month} className={cn('relative', m.month === month && 'bg-surface-2')} title={`${monthShort(m.month, lang)}: ${fmtNum(m.tMin, lang)}-${fmtNum(m.tMax, lang)} °C, ${fmtNum(m.rainMm, lang)} mm`}>
              <span aria-hidden className="absolute left-1/2 w-1.5 -translate-x-1/2 bg-ink-2" style={{ bottom: `${pct(m.tMin)}%`, height: `${Math.max(2, pct(m.tMax) - pct(m.tMin))}%` }} />
            </div>
          ))}
        </div>
        <div className="grid h-10 grid-cols-12 items-end gap-1 border-t border-line-1 pt-1">
          {ms.map((m) => (
            <span key={m.month} aria-hidden className="mx-auto block w-full max-w-4 bg-ink-4" style={{ height: `${(m.rainMm / rainMax) * 100}%` }} />
          ))}
        </div>
        <div className="grid grid-cols-12 gap-1">
          {ms.map((m) => (
            <span key={m.month} className={cn('t-meta text-center', m.month === month && 'text-ink-1')}>
              {monthShort(m.month, lang)}
            </span>
          ))}
        </div>
        <figcaption className="t-caption mt-1">{t('urban.climateLegend', { lo: fmtNum(tLo, lang), hi: fmtNum(tHi, lang), rain: fmtNum(rainMax, lang) })}</figcaption>
        <p className="t-meta">{climate.sourceIds.map(sourceName).join(' · ')}</p>
      </figure>
    </div>
  );
}

function PlantCard({ rec, month }: { rec: UrbanRecommendation; month: number }) {
  const t = useT();
  const lang = useLang();
  const sowNow = rec.care.sowMonths.includes(month);
  return (
    <Panel as="article" title={pick(rec.name, lang)} meta={`${fmtNum(rec.score <= 1 ? rec.score * 100 : rec.score, lang)}/100`} actions={<Tag>{t(`urban.diff.${rec.difficulty}`)}</Tag>}>
      <div className="flex flex-col gap-3">
        <TextList items={rec.why} />
        <dl className="m-0 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="t-label">{t('urban.care.water')}</dt>
          <dd className="m-0 text-ink-1">{pick(rec.care.water, lang)}</dd>
          <dt className="t-label">{t('urban.care.light')}</dt>
          <dd className="m-0 text-ink-1">{pick(rec.care.light, lang)}</dd>
          <dt className="t-label">{t('urban.care.harvest')}</dt>
          <dd className="t-value m-0 text-ink-1">
            {fmtNum(rec.care.harvestDays[0], lang)}-{fmtNum(rec.care.harvestDays[1], lang)} <span className="t-unit">{t('urban.days')}</span>
          </dd>
        </dl>
        <div className="flex flex-col gap-1">
          <span className="t-label">
            {t('urban.care.sow')} {sowNow && <span className="text-ink-1">· {t('urban.sowNow')}</span>}
          </span>
          <div className="grid grid-cols-12 gap-0.5" aria-label={rec.care.sowMonths.map((m) => monthShort(m, lang)).join(', ')} role="img">
            {Array.from({ length: 12 }, (_, i) => {
              const on = rec.care.sowMonths.includes(i + 1);
              return (
                <span key={i} className={cn('flex h-7 items-center justify-center text-2xs', on ? 'bg-ink-2 text-on-signal' : 'bg-inset text-ink-3', i + 1 === month && 'outline-1 outline-signal')}>
                  {monthShort(i + 1, lang)}
                </span>
              );
            })}
          </div>
        </div>
        {rec.calendar.some((c) => c.tasks.length) && (
          <ul className="m-0 flex list-none flex-col p-0 text-sm">
            {rec.calendar
              .filter((c) => c.tasks.length)
              .map((c) => (
                <li key={c.month} className="grid grid-cols-[2.5rem_1fr] gap-2 border-b border-line-1 py-1 last:border-b-0">
                  <span className="t-value text-xs text-ink-1">{monthShort(c.month, lang)}</span>
                  <span className="text-ink-2">{c.tasks.map((x) => pick(x, lang)).join(' · ')}</span>
                </li>
              ))}
          </ul>
        )}
        {rec.care.tips.length > 0 && <TextList items={rec.care.tips} glyph="info" className="text-xs" />}
      </div>
    </Panel>
  );
}
