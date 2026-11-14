/**
 * Status-tab charts. Each is a quiet plot with a labelled value axis and a month axis: grid lines
 * in the hairline grey, 12 px tick labels, one 2 px line.
 *   NdviChart  Sentinel-2 field mean per real frame with its min-max band inside the parcel, gaps
 *              where no cloud-free frame exists, over the MODIS series and its normal band.
 *   AccumChart a running total (rainfall, degree-days) up to the last sample received.
 *   gddSeries  growing degree-days accumulated over the window, base from the selected crop.
 */
import { type ReactNode, useMemo } from 'react';
import type { CropProfile, FieldRaster, ISODate, Parcel, Series } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { frameStats } from '@/lib/raster';
import { findSeries } from '@/lib/series';
import { addDays, diffDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { MONTHS, cropName, fmtNum } from '@/ui/hud/format';
import { baselineAt } from '@/ui/hud/readings';
import { rasterFor } from './picture';
import './strings';

/** Frames further apart than this are not joined: the gap is drawn as a gap. */
const MAX_JOIN_DAYS = 30;
const W = 480;
const H = 120;

interface Point {
  t: ISODate;
  mean: number;
  min: number;
  max: number;
}

export function s2Points(raster: FieldRaster | undefined, parcel: Parcel | null): Point[] {
  if (!raster || !parcel) return [];
  const out: Point[] = [];
  for (const f of raster.frames) {
    const s = frameStats(raster, f, parcel.polygon);
    if (s && s.n > 0) out.push({ t: f.t, mean: s.mean, min: s.min, max: s.max });
  }
  return out;
}

interface Tick {
  /** Position along the axis, 0..1 (from the left, or from the bottom). */
  at: number;
  label: string;
}

/** Every second month of the telemetry window, as positions along the time axis. */
function useMonthTicks(): Tick[] {
  const lang = useLang();
  const window = useMission((s) => s.telemetry?.window);
  return useMemo(() => {
    if (!window) return [];
    const span = Math.max(1, diffDays(window.end, window.start));
    const out: Tick[] = [];
    for (let d = 0; d <= span; d++) {
      const date = addDays(window.start, d);
      if (!date.endsWith('-01')) continue;
      const m = Number(date.slice(5, 7));
      if (m % 2 === 0) out.push({ at: d / span, label: MONTHS[lang][m - 1] });
    }
    return out;
  }, [window, lang]);
}

/** Two round values under `max` for the value axis. */
function niceTicks(max: number, digits = 0): Tick[] {
  if (!(max > 0)) return [];
  const raw = max / 2.4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) ?? raw;
  return [1, 2].map((k) => k * step).filter((v) => v <= max).map((v) => ({ at: v / max, label: fmtNum(v, step < 1 ? Math.max(digits, 1) : digits) }));
}

/** The plot area with its axes. `children` is an SVG that fills it (viewBox 0 0 W H, y down). */
function ChartFrame({ yTicks, children }: { yTicks: Tick[]; children: ReactNode }) {
  const xTicks = useMonthTicks();
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      <div aria-hidden className="relative h-24 min-w-5">
        {yTicks.map((k) => (
          <span key={k.label} className="t-value absolute right-0 -translate-y-1/2 text-xs font-normal text-ink-4" style={{ top: `${(1 - k.at) * 100}%` }}>
            {k.label}
          </span>
        ))}
        {/* Keeps the column as wide as its widest label. */}
        <span className="t-value invisible text-xs font-normal">{yTicks.reduce((a, k) => (k.label.length > a.length ? k.label : a), '')}</span>
      </div>
      <div className="relative h-24">
        {yTicks.map((k) => (
          <span key={k.label} aria-hidden className="absolute inset-x-0 h-px bg-line-1" style={{ top: `${(1 - k.at) * 100}%` }} />
        ))}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-line-1" />
        {children}
      </div>
      <span />
      <div aria-hidden className="relative mt-1 h-4">
        {xTicks
          .filter((k) => k.at > 0.03 && k.at < 0.97)
          .map((k) => (
            <span key={k.at} className="absolute -translate-x-1/2 text-xs whitespace-nowrap text-ink-4" style={{ left: `${k.at * 100}%` }}>
              {k.label}
            </span>
          ))}
      </div>
    </div>
  );
}

const SVG_CLASS = 'absolute inset-0 h-full w-full overflow-visible';

export function NdviChart({ modis }: { modis: Series | undefined }) {
  const t = useT();
  const parcel = useMission((s) => s.parcel);
  const raster = useMission((s) => rasterFor(s.rasters, 'vegetation'));
  const window = useMission((s) => s.telemetry?.window);
  const cursor = useMission((s) => s.timeline.cursor);
  const pts = useMemo(() => s2Points(raster, parcel), [raster, parcel]);
  if (!window) return null;
  const span = Math.max(1, diffDays(window.end, window.start));
  const x = (d: ISODate) => (diffDays(d, window.start) / span) * W;
  const y = (v: number) => H - Math.max(0, Math.min(1, v)) * H;

  // Runs of frames close enough to join.
  const runs: Point[][] = [];
  for (const p of pts) {
    const last = runs.at(-1)?.at(-1);
    if (last && diffDays(p.t, last.t) <= MAX_JOIN_DAYS) runs.at(-1)!.push(p);
    else runs.push([p]);
  }
  const modisPts = (modis?.samples ?? []).filter((s) => s.v != null && s.t >= window.start && s.t <= window.end);
  const normal: string[] = [];
  if (modis?.baseline?.length) {
    const days: ISODate[] = modisPts.map((s) => s.t);
    const edge = (pick: 'p90' | 'p10') =>
      days
        .map((d) => {
          const b = baselineAt(modis.baseline, d);
          return b ? `${x(d).toFixed(1)},${y(b[pick]).toFixed(1)}` : null;
        })
        .filter(Boolean);
    const top = edge('p90');
    const bot = edge('p10').reverse();
    if (top.length > 1) normal.push([...top, ...bot].join(' '));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ChartFrame
        yTicks={[
          { at: 0.4, label: '0.4' },
          { at: 0.8, label: '0.8' },
        ]}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={SVG_CLASS} role="img" aria-label={t('field.ndvi.aria', { k: pts.length })}>
          {normal.map((pp, i) => (
            <polygon key={i} points={pp} fill="var(--color-ink-4)" fillOpacity={0.12} />
          ))}
          {modisPts.length > 1 && (
            <polyline points={modisPts.map((s) => `${x(s.t).toFixed(1)},${y(s.v!).toFixed(1)}`).join(' ')} fill="none" stroke="var(--color-line-2)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          )}
          {runs.map((run, i) => (
            <g key={i}>
              {run.length > 1 && (
                <polygon
                  points={[...run.map((p) => `${x(p.t).toFixed(1)},${y(p.max).toFixed(1)}`), ...[...run].reverse().map((p) => `${x(p.t).toFixed(1)},${y(p.min).toFixed(1)}`)].join(' ')}
                  fill="var(--color-signal)"
                  fillOpacity={0.14}
                />
              )}
              {run.length > 1 && <polyline points={run.map((p) => `${x(p.t).toFixed(1)},${y(p.mean).toFixed(1)}`).join(' ')} fill="none" stroke="var(--color-signal)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            </g>
          ))}
          {pts.map((p) => (
            <line key={p.t} x1={x(p.t)} x2={x(p.t)} y1={y(p.mean) - 0.01} y2={y(p.mean) + 0.01} stroke="var(--color-signal)" strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} stroke="var(--color-ink-4)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
      </ChartFrame>
      <span className="flex flex-wrap gap-x-3 pl-7 text-[11px] leading-4 text-ink-3 narrow:text-xs">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-0.5 w-3 bg-signal" />
          {t('field.ndvi.s2')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-0.5 w-3 bg-line-2" />
          {t('field.ndvi.modis')}
        </span>
      </span>
    </div>
  );
}

/** A running total over the window: the line stops at the last sample received, never beyond today. */
export function AccumChart({ samples, color, label }: { samples: Series['samples']; color: string; label: string }) {
  const window = useMission((s) => s.telemetry?.window);
  const cursor = useMission((s) => s.timeline.cursor);
  const pts = useMemo(() => (window ? samples.filter((s) => s.v != null && s.t >= window.start && s.t <= window.today) : []), [samples, window]);
  if (!window) return null;
  const max = Math.max(1e-6, ...pts.map((p) => p.v ?? 0));
  // Head room, so the last value does not sit on the top edge of the plot.
  const top = max * 1.1;
  const span = Math.max(1, diffDays(window.end, window.start));
  const x = (d: ISODate) => (diffDays(d, window.start) / span) * W;
  const y = (v: number) => H - (Math.max(0, v) / top) * H;
  const at = [...pts].reverse().find((p) => p.t <= cursor);
  return (
    <ChartFrame yTicks={niceTicks(max).map((k) => ({ ...k, at: (k.at * max) / top }))}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={SVG_CLASS} role="img" aria-label={label}>
        {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v!).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} stroke="var(--color-ink-4)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {at && <line x1={x(at.t)} x2={x(at.t)} y1={y(at.v!) - 0.01} y2={y(at.v!) + 0.01} stroke={color} strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
    </ChartFrame>
  );
}

/** Base temperature for degree-days: the crop's lower optimum, else 10 °C. */
export function gddBase(crop: CropProfile | undefined): number {
  const b = crop?.req.tempC[1];
  return typeof b === 'number' && Number.isFinite(b) ? b : 10;
}

/** Degree-days accumulated over the window from daily mean air temperature (or the max-min average). */
export function gddSeries(agromet: Parameters<typeof findSeries>[0], base: number): Series | null {
  const mean = findSeries(agromet, 't2m');
  const tmax = findSeries(agromet, 't2m_max');
  const tmin = findSeries(agromet, 't2m_min');
  const src = mean ?? tmax;
  if (!src) return null;
  const minBy = new Map((tmin?.samples ?? []).map((s) => [s.t, s.v]));
  let sum = 0;
  const samples = src.samples.map((s) => {
    let v = s.v;
    if (!mean && v != null) {
      const lo = minBy.get(s.t);
      v = lo == null ? null : (v + lo) / 2;
    }
    if (v != null) sum += Math.max(0, v - base);
    return { ...s, v: v == null ? null : sum };
  });
  return { ...src, key: 'gdd', unit: '°C·d', samples, baseline: undefined, range: [0, Math.max(1, sum)], label: { en: 'Growing degree-days', vi: 'Tích ôn' } };
}

export function gddNote(t: (k: string, v?: Record<string, string | number>) => string, lang: 'en' | 'vi', crop: CropProfile | undefined, base: number): string {
  return crop ? t('field.gdd.noteCrop', { b: fmtNum(base, 0), c: cropName(crop.names, lang) }) : t('field.gdd.noteNone', { b: fmtNum(base, 0) });
}
