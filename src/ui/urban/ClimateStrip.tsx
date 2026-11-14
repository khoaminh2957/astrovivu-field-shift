/**
 * Twelve months of the place's climate, drawn straight from `UrbanClimate`: daily low to high with
 * the mean, rain per month and sunlight (PAR). One fixed scale per series, no smoothing. Each
 * series names the source it came from.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { CloudRain, Sun, Thermometer } from 'lucide-react';
import type { UrbanClimate } from '@/contracts';
import { climateScale } from '@/core/urban';
import { SOURCES } from '@/data';
import { useLang, useT } from '@/i18n';
import { Skeleton, Stat, Tag, cn } from '@/ui/design';
import { fmtNum, monthLong, monthShort } from '@/ui/advisory/format';
import { sourceName } from '@/ui/advisory/shared';
import './strings';

export type ClimateState = 'idle' | 'loading' | 'error';

/** Short names of the datasets behind a climate, for the panel heading. */
export function climateSources(climate: UrbanClimate | null): string | null {
  if (!climate) return null;
  const names = climate.sourceIds.filter((id) => id !== SOURCES.current.id).map(sourceName);
  return [...new Set(names)].join(' · ') || null;
}

export function ClimateStrip({ climate, state, month }: { climate: UrbanClimate | null; state: ClimateState; month: number }) {
  const t = useT();
  const lang = useLang();
  const [shown, setShown] = useState(month);
  // A new place starts on the current month again.
  useEffect(() => setShown(month), [climate, month]);

  if (state === 'error') return <p className="text-sm text-watch">{t('urban.noClimateBody')}</p>;
  if (!climate) return <Skeleton className="h-64 w-full" />;
  const ms = [...climate.months].sort((a, b) => a.month - b.month);
  const scale = climateScale(ms);
  if (!scale) return <p className="text-sm text-watch">{t('urban.noClimateBody')}</p>;

  const has = (id: string) => climate.sourceIds.includes(id);
  const tempRainSource = has(SOURCES.era5.id) ? SOURCES.era5.id : has(SOURCES.powerClim.id) ? SOURCES.powerClim.id : null;
  const tPct = (v: number) => ((v - scale.tLo) / (scale.tHi - scale.tLo)) * 100;
  const cur = ms.find((m) => m.month === shown) ?? ms[0];
  const now = climate.now;
  const range = (lo: number, hi: number) => `${fmtNum(lo, lang)} – ${fmtNum(hi, lang)}`;

  return (
    <div className="flex flex-col gap-4">
      {now && (
        <div className="flex flex-col gap-1 border-b border-line-1 pb-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat size="sm" label={t('urban.now.t')} value={now.t == null ? null : fmtNum(now.t, lang, 1)} unit="°C" />
            <Stat size="sm" label={t('urban.now.rh')} value={now.rh == null ? null : fmtNum(now.rh, lang)} unit="%" />
            <Stat size="sm" label={t('urban.now.par')} value={now.par == null ? null : fmtNum(now.par, lang, 1)} unit="MJ/m²" />
          </div>
          <span className="t-meta">{t('urban.now.at', { at: now.observedAt.replace('T', ' ') })}</span>
        </div>
      )}

      <div className="flex gap-1.5">
        <div aria-hidden className="flex w-4 shrink-0 flex-col [&_svg]:size-4 [&_svg]:stroke-[1.5]">
          <span className="flex h-24 items-center text-branch-thermal">
            <Thermometer />
          </span>
          <span className="flex h-12 items-center text-branch-rainfall">
            <CloudRain />
          </span>
          {scale.parMax != null && (
            <span className="flex h-9 items-center text-branch-agromet">
              <Sun />
            </span>
          )}
        </div>
        <div role="group" aria-label={t('urban.climateSummary', { lo: fmtNum(scale.tLo, lang), hi: fmtNum(scale.tHi, lang) })} className="grid min-w-0 flex-1 grid-cols-12 gap-px">
          {ms.map((m) => (
            <button
              key={m.month}
              type="button"
              aria-pressed={m.month === shown}
              aria-label={t('urban.monthBtn', {
                month: monthLong(m.month, lang) + (m.month === month ? ` (${t('urban.thisMonth')})` : ''),
                lo: fmtNum(m.tMin, lang, 1),
                hi: fmtNum(m.tMax, lang, 1),
                rain: fmtNum(m.rainMm, lang),
                light: m.par == null ? '' : t('urban.monthBtnLight', { par: fmtNum(m.par, lang, 1) }),
              })}
              onClick={() => setShown(m.month)}
              className={cn('flex min-w-0 flex-col rounded-xs border hover:bg-surface-2', m.month === month ? 'border-ink-1' : 'border-transparent', m.month === shown && 'bg-surface-2')}
            >
              <span className="relative block h-24 w-full">
                <span className="absolute left-1/2 w-2 -translate-x-1/2 rounded-full bg-branch-thermal/30" style={{ bottom: `${tPct(m.tMin)}%`, height: `${Math.max(2, tPct(m.tMax) - tPct(m.tMin))}%` }} />
                <span className="absolute left-1/2 h-0.5 w-3.5 -translate-x-1/2 translate-y-1/2 bg-branch-thermal" style={{ bottom: `${tPct(m.tMean)}%` }} />
              </span>
              <span className="flex h-12 w-full items-end justify-center border-t border-line-1 pt-1">
                <span className="w-3/5 max-w-3.5 rounded-t-xs bg-branch-rainfall" style={{ height: `${(m.rainMm / scale.rainMax) * 100}%`, minHeight: m.rainMm > 0 ? 1 : 0 }} />
              </span>
              {scale.parMax != null && (
                <span className="flex h-9 w-full items-end justify-center border-t border-line-1 pt-1">
                  {m.par != null && <span className="w-3/5 max-w-3.5 rounded-t-xs bg-branch-agromet" style={{ height: `${(m.par / scale.parMax) * 100}%` }} />}
                </span>
              )}
              <span className={cn('block w-full truncate border-t border-line-1 py-1 text-center text-2xs leading-none tabular-nums', m.month === month ? 'font-medium text-ink-1' : 'text-ink-3')}>{monthShort(m.month, lang)}</span>
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-2">
          <span className="t-heading">{monthLong(cur.month, lang)}</span>
          {cur.month === month && <Tag>{t('urban.thisMonth')}</Tag>}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Stat size="sm" label={t('urban.row.temp')} value={range(cur.tMin, cur.tMax)} unit="°C" hint={t('urban.val.mean', { v: fmtNum(cur.tMean, lang, 1) })} />
          <Stat size="sm" label={t('urban.row.rain')} value={fmtNum(cur.rainMm, lang)} unit="mm" hint={cur.rh == null ? undefined : `${t('urban.val.rh')} ${fmtNum(cur.rh, lang)} %`} />
          <Stat size="sm" label={t('urban.row.light')} value={cur.par == null ? null : fmtNum(cur.par, lang, 1)} unit="MJ/m²" />
        </div>
      </div>

      <ul className="t-caption m-0 flex list-none flex-col gap-1 border-t border-line-1 p-0 pt-3">
        <Key icon={<Thermometer className="text-branch-thermal" />}>
          {t('urban.legend.temp', { lo: fmtNum(scale.tLo, lang), hi: fmtNum(scale.tHi, lang) })}
        </Key>
        <Key icon={<CloudRain className="text-branch-rainfall" />}>{t('urban.legend.rain', { max: fmtNum(scale.rainMax, lang) })}</Key>
        <Key icon={<Sun className="text-branch-agromet" />}>{scale.parMax == null ? t('urban.legend.noLight') : t('urban.legend.light', { max: fmtNum(scale.parMax, lang) })}</Key>
        <Key icon={<span className="block size-3 rounded-xs border border-ink-1" />}>{t('urban.legend.now')}</Key>
      </ul>

      <p className="t-meta flex flex-col gap-0.5">
        {tempRainSource && <span>{t('urban.src.tempRain', { src: sourceName(tempRainSource) ?? tempRainSource })}</span>}
        {has(SOURCES.powerClim.id) && <span>{t('urban.src.light', { src: sourceName(SOURCES.powerClim.id) ?? SOURCES.powerClim.id })}</span>}
        {now && has(SOURCES.current.id) && <span>{t('urban.src.now', { src: sourceName(SOURCES.current.id) ?? SOURCES.current.id })}</span>}
        {/* A source this screen does not know by name is still listed, never hidden. */}
        {climate.sourceIds.filter((id) => id !== SOURCES.era5.id && id !== SOURCES.powerClim.id && id !== SOURCES.current.id).map((id) => (
          <span key={id}>{sourceName(id)}</span>
        ))}
      </p>
    </div>
  );
}

function Key({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-px flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5 [&_svg]:stroke-[1.5]">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}
