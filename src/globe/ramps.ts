/**
 * Parcel colouring: which design-system ramp a series is painted with and over what range.
 * Pure, so the HUD or the timeline can call the same functions and draw a legend that matches
 * the fill exactly.
 */
import type { ISODate, Series } from '@/contracts';
import { sampleAt } from '@/lib/series';
import { BRANCH_RAMP, RAMPS, type MapMetric, type RampMode } from '@/ui/design/tokens';

export interface MetricPaint {
  metric: MapMetric;
  mode: RampMode;
  domain: [min: number, max: number];
  /** `sqrt` spreads heavy-tailed quantities (daily rain) so ordinary days are not all the palest stop. */
  scale: 'linear' | 'sqrt';
}

type PaintRule = Omit<MetricPaint, 'domain'> & { domain?: [number, number] };

/**
 * Series keys with a meaning the branch default would get wrong (anomalies are diverging, air
 * temperature belongs on the heat ramp although it sits in the agromet branch).
 */
const KEY_RULES: Record<string, PaintRule> = {
  ndvi: { metric: 'vegetation', mode: 'sequential', scale: 'linear', domain: [0, 1] },
  evi: { metric: 'vegetation', mode: 'sequential', scale: 'linear', domain: [0, 0.8] },
  sm_surface: { metric: 'moisture', mode: 'sequential', scale: 'linear' },
  sm_root: { metric: 'moisture', mode: 'sequential', scale: 'linear' },
  lst_day: { metric: 'heat', mode: 'sequential', scale: 'linear', domain: [5, 55] },
  lst_night: { metric: 'heat', mode: 'sequential', scale: 'linear', domain: [-5, 35] },
  esi: { metric: 'moisture', mode: 'diverging', scale: 'linear', domain: [-3, 3] },
  et: { metric: 'moisture', mode: 'sequential', scale: 'linear', domain: [0, 8] },
  rain: { metric: 'rain', mode: 'sequential', scale: 'sqrt', domain: [0, 60] },
  rain_anom: { metric: 'rain', mode: 'diverging', scale: 'linear', domain: [-100, 100] },
  fc_rain: { metric: 'rain', mode: 'sequential', scale: 'sqrt', domain: [0, 60] },
  t2m: { metric: 'heat', mode: 'sequential', scale: 'linear', domain: [0, 45] },
  t2m_max: { metric: 'heat', mode: 'sequential', scale: 'linear', domain: [0, 45] },
  t2m_min: { metric: 'heat', mode: 'sequential', scale: 'linear', domain: [-10, 35] },
  fc_tmax: { metric: 'heat', mode: 'sequential', scale: 'linear', domain: [0, 45] },
  fc_tmin: { metric: 'heat', mode: 'sequential', scale: 'linear', domain: [-10, 35] },
  rh: { metric: 'moisture', mode: 'sequential', scale: 'linear', domain: [20, 100] },
  et0: { metric: 'heat', mode: 'sequential', scale: 'linear', domain: [0, 9] },
  par: { metric: 'heat', mode: 'sequential', scale: 'linear', domain: [0, 14] },
};

function extent(series: Pick<Series, 'samples'>): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series.samples) {
    if (s.v == null) continue;
    if (s.v < lo) lo = s.v;
    if (s.v > hi) hi = s.v;
  }
  return Number.isFinite(lo) && hi > lo ? [lo, hi] : null;
}

/**
 * How a series paints the parcel, or null when it has no map paint (the design system gives
 * terrain, soil, wind and the like no ramp; the parcel then shows its outline only).
 */
export function paintForSeries(series: Pick<Series, 'key' | 'branch' | 'range' | 'samples'>): MetricPaint | null {
  const rule: PaintRule | null =
    KEY_RULES[series.key] ??
    (BRANCH_RAMP[series.branch] ? { metric: BRANCH_RAMP[series.branch] as MapMetric, mode: 'sequential', scale: 'linear' } : null);
  if (!rule) return null;
  // A diverging ramp needs its symmetric range; otherwise the adapter's display range wins,
  // because units differ between sources (soil moisture in m3/m3 or in % of saturation).
  const domain = (rule.mode === 'diverging' ? rule.domain : (series.range ?? rule.domain)) ?? extent(series);
  if (!domain) return null;
  return { metric: rule.metric, mode: rule.mode, scale: rule.scale, domain };
}

/** Position of a value on its ramp, 0..1. */
export function rampPosition(paint: MetricPaint, value: number): number {
  const [min, max] = paint.domain;
  const t = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  return paint.scale === 'sqrt' ? Math.sqrt(t) : t;
}

export function colorForValue(paint: MetricPaint, value: number): string {
  return RAMPS[paint.metric][paint.mode].at(rampPosition(paint, value));
}

/** The ramp as a CSS gradient (design-system variable), for a legend next to the fill. */
export const rampCss = (paint: MetricPaint): string => RAMPS[paint.metric][paint.mode].cssVar;

export interface ParcelReading {
  /** Null when the series has no reading at or before the cursor. */
  color: string | null;
  value: number | null;
  /** Held beyond the cadence's hold window: drawn hatched, never as a fresh value. */
  stale: boolean;
  paint: MetricPaint;
}

/** Temporal rule T2 applied to the parcel fill: the latest valid sample at or before the cursor. */
export function parcelReadingAt(series: Series, t: ISODate): ParcelReading | null {
  const paint = paintForSeries(series);
  if (!paint) return null;
  const at = sampleAt(series, t);
  const value = at.sample?.v ?? null;
  return { paint, value, stale: at.stale, color: value == null ? null : colorForValue(paint, value) };
}
