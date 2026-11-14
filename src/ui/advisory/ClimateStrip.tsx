/**
 * The field's own climate under the season calendar, on the same twelve columns: mean monthly rain
 * as bars with a whisker from the driest to the wettest tenth of the years, and the mean temperature
 * as a line in its own row (two measures, two rows; never two scales on one plot).
 */
import type { MonthNormal } from '@/lib/climate';
import { useLang, useT } from '@/i18n';
import { StatusTag, Tooltip } from '@/ui/design';
import { fmtNum, monthLong } from './format';
import { MONTH_COLS, MonthRow } from './MonthGrid';

export interface ClimateStripProps {
  normals: MonthNormal[];
  /** Name of the dataset the record comes from; null when the telemetry does not say. */
  source: string | null;
  /** First and last year of the record. */
  span: [from: number, to: number];
  years: number;
  simulated: boolean;
}

const RAIN_H = 60;
const TEMP_H = 54;
const TEMP_PAD = 16;

export function ClimateStrip({ normals, source, span, years, simulated }: ClimateStripProps) {
  const t = useT();
  const lang = useLang();
  const rainMax = Math.max(1, ...normals.map((m) => m.rainHighMm ?? m.rainMm ?? 0));
  const temps = normals.map((m) => m.tMean);
  const known = temps.filter((v): v is number => v != null);
  const hasRain = normals.some((m) => m.rainMm != null);
  const tip = (m: MonthNormal) =>
    [
      monthLong(m.month, lang),
      m.rainMm != null ? t('advisory.clim.tipRain', { mm: fmtNum(m.rainMm, lang), lo: fmtNum(m.rainLowMm, lang), hi: fmtNum(m.rainHighMm, lang) }) : null,
      m.tMean != null ? t('advisory.clim.tipTemp', { c: fmtNum(m.tMean, lang, 1) }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={t('advisory.clim.title')}>
      {hasRain && (
        <MonthRow label={t('advisory.clim.rain')} sub={t('advisory.clim.rainUnit')} align="end">
          <div className={MONTH_COLS} aria-hidden>
            {normals.map((m) => (
              <Tooltip key={m.month} content={tip(m)}>
                <div className="flex min-w-0 flex-col items-center gap-0.5">
                  <div className="relative w-full border-b border-line-2" style={{ height: RAIN_H }}>
                    {m.rainMm != null && <span className="absolute bottom-0 left-1/2 w-3/5 max-w-6 -translate-x-1/2 rounded-t-xs bg-branch-rainfall" style={{ height: `${(m.rainMm / rainMax) * 100}%` }} />}
                    {m.rainLowMm != null && m.rainHighMm != null && m.years > 1 && (
                      <span
                        className="absolute left-1/2 w-1.5 -translate-x-1/2 border-y border-ink-2"
                        style={{ bottom: `${(m.rainLowMm / rainMax) * 100}%`, height: `${((m.rainHighMm - m.rainLowMm) / rainMax) * 100}%` }}
                      >
                        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink-2" />
                      </span>
                    )}
                  </div>
                  <span className="t-value text-2xs text-ink-2">{m.rainMm == null ? '--' : fmtNum(m.rainMm, lang)}</span>
                </div>
              </Tooltip>
            ))}
          </div>
        </MonthRow>
      )}

      {known.length > 1 && (
        <MonthRow label={t('advisory.clim.temp')} sub="°C">
          <TempLine temps={temps} tip={(i) => tip(normals[i])} />
        </MonthRow>
      )}

      {/* A table ignores the 1 px box of sr-only, so the wrapper carries it. */}
      <div className="sr-only">
        <table>
          <caption>{t('advisory.clim.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('advisory.plan.month')}</th>
              <th scope="col">{t('advisory.clim.rain')} (mm)</th>
              <th scope="col">{t('advisory.clim.range')} (mm)</th>
              <th scope="col">{t('advisory.clim.temp')} (°C)</th>
            </tr>
          </thead>
          <tbody>
            {normals.map((m) => (
              <tr key={m.month}>
                <th scope="row">{monthLong(m.month, lang)}</th>
                <td>{fmtNum(m.rainMm, lang)}</td>
                <td>{`${fmtNum(m.rainLowMm, lang)}-${fmtNum(m.rainHighMm, lang)}`}</td>
                <td>{fmtNum(m.tMean, lang, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MonthRow>
        <p className="t-caption flex flex-wrap items-center gap-x-2 gap-y-1">
          {simulated && <StatusTag status="simulated" />}
          <span>
            {t('advisory.clim.caption', { n: years, from: span[0], to: span[1] })} {source ? t('advisory.clim.source', { source }) : t('advisory.clim.noSource')}{' '}
            {t('advisory.clim.whisker')}
          </span>
        </p>
      </MonthRow>
    </div>
  );
}

/** Mean temperature across the year. Only the coldest and the warmest month carry a number. */
function TempLine({ temps, tip }: { temps: (number | null)[]; tip: (i: number) => string }) {
  const lang = useLang();
  const known = temps.filter((v): v is number => v != null);
  const min = Math.min(...known);
  const max = Math.max(...known);
  // At least ten degrees of axis, so a tropical year stays as flat as it is.
  const pad = Math.max(1, (10 - (max - min)) / 2);
  const lo = min - pad;
  const hi = max + pad;
  const y = (v: number) => TEMP_PAD + (1 - (v - lo) / (hi - lo)) * (TEMP_H - 2 * TEMP_PAD);
  const x = (i: number) => ((i + 0.5) / 12) * 100;
  const d = temps.reduce((path, v, i) => (v == null ? path : `${path}${path && temps[i - 1] != null ? 'L' : 'M'}${x(i)},${y(v).toFixed(1)}`), '');
  const iMin = temps.indexOf(min);
  const iMax = temps.indexOf(max);

  return (
    <div className="relative" style={{ height: TEMP_H }} aria-hidden>
      <svg viewBox={`0 0 100 ${TEMP_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <path d={d} fill="none" stroke="var(--color-branch-thermal)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {temps.map((v, i) =>
        v == null ? null : (
          <Tooltip key={i} content={tip(i)}>
            <span className="absolute top-0 bottom-0 w-[8.33%] -translate-x-1/2" style={{ left: `${x(i)}%` }}>
              {(i === iMin || i === iMax) && (
                <>
                  <span className="absolute left-1/2 size-2.5 -translate-1/2 rounded-full border-2 border-surface-0 bg-branch-thermal" style={{ top: y(v) }} />
                  <span className="t-value absolute left-1/2 -translate-x-1/2 text-2xs whitespace-nowrap text-ink-2" style={i === iMax && iMax !== iMin ? { top: y(v) - 19 } : { top: y(v) + 6 }}>
                    {fmtNum(v, lang, 1)}°
                  </span>
                </>
              )}
            </span>
          </Tooltip>
        ),
      )}
    </div>
  );
}
