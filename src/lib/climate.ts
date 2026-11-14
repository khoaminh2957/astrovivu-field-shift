/**
 * Monthly climate normals from the multi-year record a field carries (FieldTelemetry.climateHistory).
 * Pure: the rotation calendar and the urban tool draw their rain and temperature strips from this.
 */
import type { YearClimate } from '@/contracts';

export interface MonthNormal {
  /** 1..12 */
  month: number;
  /** Mean of the monthly totals, mm; null when no year has the month. */
  rainMm: number | null;
  /** Driest and wettest tenth of the years (10th and 90th percentile), mm. */
  rainLowMm: number | null;
  rainHighMm: number | null;
  tMean: number | null;
  tMin: number | null;
  tMax: number | null;
  et0Mm: number | null;
  /** Years that contributed a rainfall value. */
  years: number;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Twelve entries, January first. Months no year covers come back with nulls and `years: 0`. */
export function monthlyNormals(history: readonly YearClimate[] | undefined): MonthNormal[] {
  const out: MonthNormal[] = [];
  for (let month = 1; month <= 12; month++) {
    const rows = (history ?? []).flatMap((y) => y.months.filter((m) => m.month === month));
    const pickNum = (f: (m: (typeof rows)[number]) => number | null | undefined): number[] =>
      rows.map(f).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const rain = pickNum((m) => m.rainMm).sort((a, b) => a - b);
    out.push({
      month,
      rainMm: mean(rain),
      rainLowMm: quantile(rain, 0.1),
      rainHighMm: quantile(rain, 0.9),
      tMean: mean(pickNum((m) => m.tMean)),
      tMin: mean(pickNum((m) => m.tMin)),
      tMax: mean(pickNum((m) => m.tMax)),
      et0Mm: mean(pickNum((m) => m.et0Mm)),
      years: rain.length,
    });
  }
  return out;
}
