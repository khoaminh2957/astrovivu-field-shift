/**
 * Status-tab charts that need more than a sparkline.
 *   NdviChart  Sentinel-2 field mean per real frame with its min-max band inside the parcel, gaps
 *              where no cloud-free frame exists, over the MODIS series and its normal band.
 *   gddSeries  growing degree-days accumulated over the window, base from the selected crop.
 */
import { useMemo } from 'react';
import type { CropProfile, FieldRaster, ISODate, Parcel, Series } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { frameStats } from '@/lib/raster';
import { findSeries } from '@/lib/series';
import { diffDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { cropName, fmtDate, fmtNum } from '@/ui/hud/format';
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

function s2Points(raster: FieldRaster | undefined, parcel: Parcel | null): Point[] {
  if (!raster || !parcel) return [];
  const out: Point[] = [];
  for (const f of raster.frames) {
    const s = frameStats(raster, f, parcel.polygon);
    if (s && s.n > 0) out.push({ t: f.t, mean: s.mean, min: s.min, max: s.max });
  }
  return out;
}

export function NdviChart({ modis }: { modis: Series | undefined }) {
  const t = useT();
  const lang = useLang();
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
    const top = days.map((d) => { const b = baselineAt(modis.baseline, d); return b ? `${x(d).toFixed(1)},${y(b.p90).toFixed(1)}` : null; }).filter(Boolean);
    const bot = days.map((d) => { const b = baselineAt(modis.baseline, d); return b ? `${x(d).toFixed(1)},${y(b.p10).toFixed(1)}` : null; }).filter(Boolean).reverse();
    if (top.length > 1) normal.push([...top, ...bot].join(' '));
  }
  const latest = [...pts].reverse().find((p) => p.t <= cursor);
  const age = latest ? diffDays(cursor, latest.t) : null;
  const mean = pts.length ? pts.reduce((a, p) => a + p.mean, 0) / pts.length : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink-1">{t('field.ndvi.title')}</span>
        <span className="t-value text-base text-ink-1">{latest ? fmtNum(latest.mean, 2) : '--'}</span>
      </div>
      <p className="t-caption -mt-0.5">
        {latest
          ? t('field.ndvi.note', { d: fmtDate(latest.t, lang), n: age ?? 0, m: mean == null ? '--' : fmtNum(mean, 2), k: pts.length })
          : t('field.ndvi.none')}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full overflow-visible" role="img" aria-label={t('field.ndvi.aria', { k: pts.length })}>
        {[0.25, 0.5, 0.75].map((v) => (
          <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--color-line-1)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {normal.map((pp, i) => (
          <polygon key={i} points={pp} fill="var(--color-ink-4)" fillOpacity={0.14} />
        ))}
        {modisPts.length > 1 && (
          <polyline points={modisPts.map((s) => `${x(s.t).toFixed(1)},${y(s.v!).toFixed(1)}`).join(' ')} fill="none" stroke="var(--color-ink-4)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        )}
        {runs.map((run, i) => (
          <g key={i}>
            {run.length > 1 && (
              <polygon
                points={[...run.map((p) => `${x(p.t).toFixed(1)},${y(p.max).toFixed(1)}`), ...[...run].reverse().map((p) => `${x(p.t).toFixed(1)},${y(p.min).toFixed(1)}`)].join(' ')}
                fill="var(--color-branch-vegetation)"
                fillOpacity={0.18}
              />
            )}
            {run.length > 1 && <polyline points={run.map((p) => `${x(p.t).toFixed(1)},${y(p.mean).toFixed(1)}`).join(' ')} fill="none" stroke="var(--color-branch-vegetation)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          </g>
        ))}
        {pts.map((p) => (
          <line key={p.t} x1={x(p.t)} x2={x(p.t)} y1={y(p.mean) - 0.01} y2={y(p.mean) + 0.01} stroke="var(--color-branch-vegetation)" strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} stroke="var(--color-ink-1)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="t-meta flex flex-wrap gap-x-3">
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-0.5 w-3 bg-branch-vegetation" />{t('field.ndvi.s2')}</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-0.5 w-3 bg-ink-4" />{t('field.ndvi.modis')}</span>
      </span>
    </div>
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
