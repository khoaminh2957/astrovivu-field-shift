/**
 * Day-of-year climatology (rule T6) and rainfall anomaly. Pure.
 *
 * The band for day d pools every value within ±halfWindow days of d (circular over the year)
 * across all baseline years, so 10-20 years give 150-600 values per point and the band is
 * smooth without fitting harmonics.
 */
import type { BaselinePoint, ISODate, Sample } from '@/contracts';
import { addDays, dayOfYear, diffDays } from '@/lib/time';

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export interface BaselineOptions {
  halfWindow?: number;
  /** Day-of-year step of the output (1 = every day). */
  step?: number;
  digits?: number;
  /** Ignore samples on or after this date (keep the current year out of its own normal). */
  before?: ISODate;
  minCount?: number;
}

export function doyBaseline(samples: Sample[], opts: BaselineOptions = {}): BaselinePoint[] {
  const half = opts.halfWindow ?? 7;
  const step = opts.step ?? 1;
  const digits = opts.digits ?? 3;
  const minCount = opts.minCount ?? 5;
  const byDoy: number[][] = Array.from({ length: 367 }, () => []);
  for (const s of samples) {
    if (s.v == null || !Number.isFinite(s.v)) continue;
    if (opts.before && s.t >= opts.before) continue;
    byDoy[Math.min(dayOfYear(s.t), 366)].push(s.v);
  }
  const out: BaselinePoint[] = [];
  for (let d = 1; d <= 366; d += step) {
    const pool: number[] = [];
    for (let k = -half; k <= half; k++) {
      let dd = d + k;
      if (dd < 1) dd += 366;
      if (dd > 366) dd -= 366;
      pool.push(...byDoy[dd]);
    }
    if (pool.length < minCount) continue;
    pool.sort((a, b) => a - b);
    const mean = pool.reduce((a, b) => a + b, 0) / pool.length;
    out.push({ doy: d, mean: r(mean, digits), p10: r(quantile(pool, 0.1), digits), p90: r(quantile(pool, 0.9), digits) });
  }
  return out;
}

/** Trailing n-day sum ending at each date (null when more than 20 % of the window is missing). */
export function trailingSum(samples: Sample[], n: number): Map<ISODate, number> {
  const out = new Map<ISODate, number>();
  if (samples.length === 0) return out;
  const t0 = samples[0].t;
  const len = diffDays(samples[samples.length - 1].t, t0) + 1;
  const vals = new Array<number | null>(len).fill(null);
  for (const s of samples) vals[diffDays(s.t, t0)] = s.v;
  for (let i = n - 1; i < len; i++) {
    let sum = 0;
    let missing = 0;
    for (let k = 0; k < n; k++) {
      const v = vals[i - k];
      if (v == null) missing++;
      else sum += v;
    }
    if (missing <= n * 0.2) out.set(addDays(t0, i), sum * (n / (n - missing)));
  }
  return out;
}

export interface RainAnomaly {
  samples: Sample[];
  /** Band of the same ratio across baseline years, in % of normal (mean is ~100). */
  baseline: BaselinePoint[];
}

/**
 * Trailing 30-day rainfall as % of the normal 30-day total for the same day of year. `history`
 * must hold daily rain for the baseline years and the window; both come from the same source so
 * the ratio is internally consistent (never mixes CHIRPS and ERA5).
 */
export function rainAnomaly(history: Sample[], windowStart: ISODate, windowEnd: ISODate, n = 30): RainAnomaly {
  const sums = trailingSum(history, n);
  const clim: number[][] = Array.from({ length: 367 }, () => []);
  for (const [t, v] of sums) if (t < windowStart) clim[Math.min(dayOfYear(t), 366)].push(v);
  const normalAt = (doy: number): number[] => {
    const pool: number[] = [];
    for (let k = -3; k <= 3; k++) {
      let d = doy + k;
      if (d < 1) d += 366;
      if (d > 366) d -= 366;
      pool.push(...clim[d]);
    }
    return pool;
  };
  const samples: Sample[] = [];
  for (const [t, v] of sums) {
    if (t < windowStart || t > windowEnd) continue;
    const pool = normalAt(dayOfYear(t));
    const mean = pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : NaN;
    // Below ~5 mm of normal rain the ratio explodes; dry-season zeros say nothing about drought.
    samples.push({ t, v: pool.length >= 5 && mean >= 5 ? Math.round((100 * v) / mean) : null });
  }
  const baseline: BaselinePoint[] = [];
  for (let d = 1; d <= 366; d += 3) {
    const pool = normalAt(d);
    if (pool.length < 5) continue;
    const mean = pool.reduce((a, b) => a + b, 0) / pool.length;
    if (mean < 5) continue;
    const ratios = pool.map((v) => (100 * v) / mean).sort((a, b) => a - b);
    baseline.push({ doy: d, mean: 100, p10: Math.round(quantile(ratios, 0.1)), p90: Math.round(quantile(ratios, 0.9)) });
  }
  samples.sort((a, b) => (a.t < b.t ? -1 : 1));
  return { samples, baseline };
}
