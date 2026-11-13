import { type RefObject, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BaselinePoint, BranchId, Cadence, ISODate, Provenance, Sample } from '@/contracts';
import { useT } from '@/i18n';
import { HOLD_DAYS } from '@/lib/series';
import { addDays, dayOfYear, diffDays } from '@/lib/time';
import { AnomalyGlyph } from './AnomalyMarker';
import { cn } from './cn';
import './strings';
import { BRANCH_VAR, type Severity } from './tokens';

export interface SparkAnomaly {
  t: ISODate;
  severity: Severity;
  label?: string;
}

export interface SparklineProps {
  /** Observations at native cadence, ascending. `v: null` is a gap. Never pre-interpolate. */
  samples: Sample[];
  /** Forecast continuation, drawn dashed. Usually starts at `today`. */
  forecast?: Sample[];
  /** X extent. Defaults to first sample .. last sample (or last forecast). Pass the timeline window. */
  domain?: [start: ISODate, end: ISODate];
  /** Y extent. Defaults to the padded data extent. Pass `Series.range` to keep scales stable. */
  range?: [min: number, max: number];
  /** Enables the hold-window rule: breaks the trace where an observation is too old to carry. */
  cadence?: Cadence;
  /** Day-of-year climatology: drawn as the p10-p90 band with the mean inside it. */
  baseline?: BaselinePoint[];
  /** Timeline cursor. Draws the hairline, the reading in force and how long it has been held. */
  cursor?: ISODate | null;
  /** Marks today and hatches the latency gap between the last observation and today. */
  today?: ISODate;
  anomalies?: SparkAnomaly[];
  /** `ink` (default) for a quiet trace, a branch id for the branch that is in focus, `signal` for the score. */
  tone?: 'ink' | 'signal' | BranchId;
  /** `bars` for accumulations such as rainfall; `line` for everything else. */
  variant?: 'line' | 'bars';
  /** `simulated` draws a dotted trace; `forecast` dashes the whole series. */
  provenance?: Provenance;
  /** Dots on actual observations. `auto` shows them when the series is sparse (40 points or fewer). */
  points?: boolean | 'auto';
  /** Fixed pixel width. Omit to fill the container. */
  width?: number;
  height?: number;
  /** Metric name for the accessible summary. */
  label?: string;
  unit?: string;
  className?: string;
}

interface Pt {
  x: number;
  y: number;
  t: ISODate;
  v: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function useWidth(fixed: number | undefined): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(fixed ?? 0);
  useLayoutEffect(() => {
    if (fixed != null) {
      setW(fixed);
      return;
    }
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixed]);
  return [ref, w];
}

/** Last non-null sample at or before `t` (the reading in force at the cursor). */
function lastAtOrBefore(samples: Sample[], t: ISODate): Sample | null {
  let lo = 0;
  let hi = samples.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  while (idx >= 0 && samples[idx].v == null) idx--;
  return idx >= 0 ? samples[idx] : null;
}

const linePath = (pts: Pt[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${r1(p.x)} ${r1(p.y)}`).join('');

/**
 * Telemetry Sparkline. One series against time with everything needed to read it honestly: the
 * normal band, the cursor reading and its age, gaps, the latency gap, the forecast and anomalies.
 * Pure SVG; the heavy geometry is memoised so moving the cursor only repositions three elements.
 */
export function Sparkline({
  samples,
  forecast,
  domain,
  range,
  cadence,
  baseline,
  cursor,
  today,
  anomalies,
  tone = 'ink',
  variant = 'line',
  provenance,
  points = 'auto',
  width,
  height = 36,
  label,
  unit,
  className,
}: SparklineProps) {
  const t = useT();
  const uid = useId().replace(/:/g, '');
  const [ref, w] = useWidth(width);

  const geo = useMemo(() => {
    const valid = samples.filter((s) => s.v != null);
    const fc = (forecast ?? []).filter((s) => s.v != null);
    const first = samples[0]?.t ?? fc[0]?.t;
    const last = fc[fc.length - 1]?.t ?? samples[samples.length - 1]?.t;
    if (!first || !last || w <= 0) return null;
    const start = domain?.[0] ?? first;
    const end = domain?.[1] ?? (last > first ? last : addDays(first, 1));
    const span = Math.max(1, diffDays(end, start));

    const padTop = anomalies && anomalies.length > 0 ? 10 : 4;
    const padBottom = 3;
    const padX = 3;
    const innerW = Math.max(1, w - padX * 2);
    const innerH = Math.max(1, height - padTop - padBottom);

    let lo: number;
    let hi: number;
    if (range) [lo, hi] = range;
    else {
      const vals = [...valid, ...fc].map((s) => s.v as number);
      lo = vals.length ? Math.min(...vals) : 0;
      hi = vals.length ? Math.max(...vals) : 1;
      if (variant === 'bars') lo = Math.min(0, lo);
      const pad = (hi - lo || 1) * 0.08;
      if (variant !== 'bars') lo -= pad;
      hi += pad;
    }
    const x = (d: ISODate) => padX + (Math.max(0, Math.min(span, diffDays(d, start))) / span) * innerW;
    const y = (v: number) => padTop + (1 - Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)))) * innerH;

    // Segments: nulls and observations older than the hold window break the trace.
    const maxGap = cadence ? HOLD_DAYS[cadence] : Number.POSITIVE_INFINITY;
    const segments: Pt[][] = [];
    let seg: Pt[] = [];
    let prevT: ISODate | null = null;
    for (const s of samples) {
      if (s.t < start || s.t > end) continue;
      if (s.v == null) {
        if (!cadence && seg.length) {
          segments.push(seg);
          seg = [];
          prevT = null;
        }
        continue;
      }
      if (prevT && diffDays(s.t, prevT) > maxGap && seg.length) {
        segments.push(seg);
        seg = [];
      }
      seg.push({ x: x(s.t), y: y(s.v), t: s.t, v: s.v });
      prevT = s.t;
    }
    if (seg.length) segments.push(seg);

    const bridges: string[] = [];
    for (let i = 1; i < segments.length; i++) {
      const a = segments[i - 1][segments[i - 1].length - 1];
      const b = segments[i][0];
      bridges.push(`M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}`);
    }

    const floor = y(Math.max(lo, Math.min(hi, 0)));
    const barW = Math.max(1, Math.min(3, (innerW / span) * 0.8));
    const trace =
      variant === 'bars'
        ? segments
            .flat()
            .filter((p) => p.v > 0)
            .map((p) => `M${r1(p.x)} ${r1(floor)}V${r1(p.y)}`)
            .join('')
        : segments.map(linePath).join('');

    const fcPts: Pt[] = fc.filter((s) => s.t >= start && s.t <= end).map((s) => ({ x: x(s.t), y: y(s.v as number), t: s.t, v: s.v as number }));
    const fcTrace = variant === 'bars' ? fcPts.filter((p) => p.v > 0).map((p) => `M${r1(p.x)} ${r1(floor)}V${r1(p.y)}`).join('') : linePath(fcPts);

    // Normal band: sample the climatology every few days across the window.
    let band: string | null = null;
    let mean: string | null = null;
    if (baseline && baseline.length > 0) {
      const byDoy = new Map(baseline.map((b) => [b.doy, b]));
      const step = Math.max(1, Math.floor(span / 90));
      const top: string[] = [];
      const bottom: string[] = [];
      const mid: string[] = [];
      for (let d = 0; d <= span; d += step) {
        const date = addDays(start, d);
        const b = byDoy.get(dayOfYear(date)) ?? byDoy.get(365);
        if (!b) continue;
        const px = r1(x(date));
        top.push(`${px} ${r1(y(b.p90))}`);
        bottom.push(`${px} ${r1(y(b.p10))}`);
        mid.push(`${px} ${r1(y(b.mean))}`);
      }
      if (top.length > 1) {
        band = `M${top.join('L')}L${bottom.reverse().join('L')}Z`;
        mean = `M${mid.join('L')}`;
      }
    }

    const lastObs = valid.length ? valid[valid.length - 1] : null;
    const pendingTo = today && today <= end ? today : today ? end : null;
    const pending = lastObs && pendingTo && diffDays(pendingTo, lastObs.t) >= 1 && lastObs.t >= start ? { x0: x(lastObs.t), x1: x(pendingTo) } : null;
    const todayX = today && today >= start && today < end ? x(today) : null;

    const count = segments.reduce((n, s) => n + s.length, 0);
    const showPoints = variant === 'line' && (points === true || (points === 'auto' && count > 0 && count <= 40));

    return { x, y, start, end, trace, fcTrace, bridges, band, mean, pending, todayX, segments, fcPts, showPoints, barW, padTop, innerH, lastObs };
  }, [samples, forecast, domain, range, cadence, baseline, today, anomalies, variant, points, w, height]);

  const stroke = tone === 'ink' ? 'var(--color-ink-2)' : tone === 'signal' ? 'var(--color-signal)' : BRANCH_VAR[tone];
  const dash = provenance === 'simulated' ? '0.1 3.2' : provenance === 'forecast' ? '3 3' : undefined;

  // The reading in force at the cursor: the most recent observation, held until the next one.
  let reading: { x: number; cx: number; y: number; stale: boolean; isForecast: boolean } | null = null;
  let cursorX: number | null = null;
  if (geo && cursor && cursor >= geo.start && cursor <= geo.end) {
    cursorX = geo.x(cursor);
    const obs = lastAtOrBefore(samples, cursor);
    const fc = forecast && forecast.length ? lastAtOrBefore(forecast, cursor) : null;
    const useFc = fc != null && (obs == null || fc.t > obs.t);
    const s = useFc ? fc : obs;
    if (s && s.v != null) {
      const age = diffDays(cursor, s.t);
      const stale = !useFc && cadence != null && age > HOLD_DAYS[cadence];
      reading = { x: geo.x(s.t), cx: cursorX, y: geo.y(s.v), stale, isForecast: useFc };
    }
  }

  const latest = geo?.lastObs ?? null;
  const summary = [
    label && latest ? t('design.spark.summary', { label, value: latest.v ?? '', unit: unit ?? '' }).trim() : (label ?? ''),
    anomalies && anomalies.length ? t('design.spark.anomalies', { n: anomalies.length }) : '',
    geo?.pending ? t('design.spark.pending') : '',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <div ref={ref} className={cn('relative w-full min-w-0', className)} style={{ height, width }}>
      {geo ? (
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={summary || undefined} className="block overflow-visible" style={{ color: stroke }}>
          <defs>
            <pattern id={`${uid}-pending`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
              <line x1="0.5" y1="0" x2="0.5" y2="5" stroke="var(--color-stale)" strokeWidth="1" opacity="0.6" />
            </pattern>
          </defs>

          {geo.band && <path d={geo.band} fill="var(--color-ink-3)" fillOpacity={0.22} />}
          {geo.mean && <path d={geo.mean} fill="none" stroke="var(--color-ink-4)" strokeWidth={1} strokeOpacity={0.7} />}

          {geo.pending && (
            <rect x={r1(geo.pending.x0)} y={geo.padTop} width={r1(Math.max(2, geo.pending.x1 - geo.pending.x0))} height={geo.innerH} fill={`url(#${uid}-pending)`} />
          )}
          {geo.todayX != null && <line x1={r1(geo.todayX)} x2={r1(geo.todayX)} y1={geo.padTop - 2} y2={height} stroke="var(--color-line-3)" strokeWidth={1} strokeDasharray="2 2" />}

          {geo.bridges.map((d) => (
            <path key={d} d={d} fill="none" stroke="var(--color-ink-4)" strokeWidth={1} strokeDasharray="1 3" />
          ))}

          {variant === 'bars' ? (
            <>
              <path d={geo.trace} fill="none" stroke="currentColor" strokeWidth={geo.barW} />
              {geo.fcTrace && <path d={geo.fcTrace} fill="none" stroke="currentColor" strokeWidth={geo.barW} strokeOpacity={0.55} />}
            </>
          ) : (
            <>
              <path d={geo.trace} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap={dash ? 'round' : 'butt'} strokeDasharray={dash} />
              {geo.fcTrace && <path d={geo.fcTrace} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeDasharray="3 3" />}
            </>
          )}

          {geo.showPoints && geo.segments.flat().map((p) => <circle key={p.t} cx={r1(p.x)} cy={r1(p.y)} r={1.75} fill="currentColor" stroke="var(--color-surface-1)" strokeWidth={1} />)}

          {anomalies?.map((a) => {
            if (a.t < geo.start || a.t > geo.end) return null;
            const s = lastAtOrBefore(samples, a.t) ?? (forecast ? lastAtOrBefore(forecast, a.t) : null);
            const ay = s?.v != null ? Math.max(5, geo.y(s.v) - 8) : 5;
            return (
              <g key={`${a.t}-${a.severity}`}>
                {a.label && <title>{a.label}</title>}
                <AnomalyGlyph severity={a.severity} x={r1(geo.x(a.t))} y={r1(ay)} size={7} />
              </g>
            );
          })}

          {cursorX != null && <line x1={r1(cursorX)} x2={r1(cursorX)} y1={0} y2={height} stroke="var(--color-signal)" strokeWidth={1} />}
          {reading && (
            <>
              {reading.cx - reading.x > 1.5 && (
                <line
                  x1={r1(reading.x)}
                  x2={r1(reading.cx)}
                  y1={r1(reading.y)}
                  y2={r1(reading.y)}
                  stroke={reading.stale ? 'var(--color-stale)' : 'var(--color-signal)'}
                  strokeWidth={1}
                  strokeDasharray={reading.stale ? '2 2' : undefined}
                />
              )}
              <circle
                cx={r1(reading.x)}
                cy={r1(reading.y)}
                r={3}
                fill={reading.stale ? 'var(--color-surface-1)' : 'var(--color-signal)'}
                stroke={reading.stale ? 'var(--color-stale)' : 'var(--color-surface-1)'}
                strokeWidth={1.5}
              />
            </>
          )}
        </svg>
      ) : (
        w > 0 && (
          <div className="t-caption flex h-full items-center" role="img" aria-label={t('design.spark.empty')}>
            <span aria-hidden className="mr-2 h-px flex-1 border-t border-dashed border-line-2" />
            {t('design.spark.empty')}
            <span aria-hidden className="ml-2 h-px flex-1 border-t border-dashed border-line-2" />
          </div>
        )
      )}
    </div>
  );
}
