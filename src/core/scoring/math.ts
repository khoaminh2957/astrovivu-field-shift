import type { Quad } from '@/contracts';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const round = (v: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/**
 * EcoCrop trapezoid (Hijmans et al. 2001; Ramirez-Villegas et al. 2013, eq. 1-2): 0 at or beyond
 * the absolute limits, 1 inside the optimal window, linear in between.
 */
export function trapezoid(x: number, [absMin, optMin, optMax, absMax]: Quad): number {
  if (!(x > absMin) || !(x < absMax)) return x >= optMin && x <= optMax ? 1 : 0;
  if (x < optMin) return (x - absMin) / (optMin - absMin);
  if (x <= optMax) return 1;
  return (absMax - x) / (absMax - optMax);
}

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (!Number.isNaN(v)) {
      s += v;
      n++;
    }
  }
  return n ? s / n : NaN;
}

/** Linear-interpolated quantile of an unsorted list; NaN for an empty one. */
export function quantile(xs: number[], q: number): number {
  const s = xs.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
