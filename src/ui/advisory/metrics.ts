/**
 * The ten criteria a rotation strategy is compared on, and the arithmetic behind the trade-off
 * chart: every criterion is put on one axis where right is better, so a strategy can be read
 * against the current practice without knowing which way each number should go. Pure.
 */
import type { FarmerPriority, Lang, RotationStrategy } from '@/contracts';
import { type CurrencyCode, fmtNum, fmtSigned, money } from './format';

export type MetricKey = 'margin' | 'waterUse' | 'soilHealth' | 'pestBreak' | 'risk' | 'cost' | 'nitrogen' | 'groundCover' | 'suitability' | 'waterFit';
type Unit = 'moneyHaYr' | 'moneyYr' | 'mmYr' | 'index' | 'pct' | 'kgN';

export interface MetricDef {
  key: MetricKey;
  better: 'higher' | 'lower';
  unit: Unit;
  get: (r: RotationStrategy) => number | null;
  /** Priorities of the farmer this criterion answers; it moves up when one of them is chosen. */
  priorities: FarmerPriority[];
}

const num = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const METRICS: MetricDef[] = [
  { key: 'margin', better: 'higher', unit: 'moneyHaYr', get: (r) => num(r.metrics.marginUsdPerHaYr), priorities: ['profit'] },
  { key: 'waterUse', better: 'lower', unit: 'mmYr', get: (r) => num(r.metrics.waterUseMm), priorities: ['water'] },
  { key: 'soilHealth', better: 'higher', unit: 'index', get: (r) => num(r.metrics.soilHealth), priorities: ['soil'] },
  { key: 'pestBreak', better: 'higher', unit: 'index', get: (r) => num(r.metrics.pestBreak), priorities: ['risk'] },
  { key: 'risk', better: 'lower', unit: 'index', get: (r) => num(r.metrics.risk), priorities: ['risk'] },
  { key: 'cost', better: 'lower', unit: 'moneyYr', get: (r) => num(r.economics?.perYear?.costUsd), priorities: ['cost'] },
  { key: 'nitrogen', better: 'higher', unit: 'kgN', get: (r) => num(r.metrics.nitrogenKgHaYr), priorities: ['soil', 'cost'] },
  { key: 'groundCover', better: 'higher', unit: 'pct', get: (r) => num(r.metrics.groundCoverPct), priorities: ['soil'] },
  { key: 'suitability', better: 'higher', unit: 'index', get: (r) => num(r.metrics.suitability), priorities: ['yield'] },
  { key: 'waterFit', better: 'higher', unit: 'index', get: (r) => num(r.metrics.waterFit), priorities: ['water'] },
];

export const isMoney = (def: MetricDef): boolean => def.unit === 'moneyHaYr' || def.unit === 'moneyYr';

export function metricUnit(def: MetricDef, lang: Lang, cur: CurrencyCode): string {
  const m = money(0, cur, lang, { compact: true }).unit;
  switch (def.unit) {
    case 'moneyHaYr':
      return `${m}/ha`;
    case 'moneyYr':
      return m;
    case 'mmYr':
      return 'mm';
    case 'kgN':
      return 'kg N/ha';
    case 'pct':
      return '%';
    case 'index':
      return '/100';
  }
}

export const metricValue = (def: MetricDef, v: number | null, lang: Lang, cur: CurrencyCode): string =>
  v == null ? '--' : isMoney(def) ? money(v, cur, lang, { compact: true }).value : fmtNum(v, lang, 0);

export const metricDelta = (def: MetricDef, d: number | null, lang: Lang, cur: CurrencyCode): string =>
  d == null ? '--' : isMoney(def) ? money(d, cur, lang, { compact: true, signed: true }).value : fmtSigned(d, lang, 0);

/** Current first (it is the baseline), then by priority-weighted score. */
export function orderStrategies(rotations: readonly RotationStrategy[]): RotationStrategy[] {
  const current = rotations.filter((r) => r.kind === 'current');
  const rest = rotations.filter((r) => r.kind !== 'current').sort((a, b) => b.score - a.score);
  return [...current, ...rest];
}

/** The strategy with the highest score, the current one included: it can be the best. */
export function bestStrategyId(rotations: readonly RotationStrategy[]): string | null {
  return rotations.reduce<RotationStrategy | null>((a, r) => (a == null || r.score > a.score ? r : a), null)?.id ?? null;
}

/** What the page opens on: the best alternative to what the farmer does today. */
export function defaultSelection(rotations: readonly RotationStrategy[]): string | null {
  const ordered = orderStrategies(rotations);
  return (ordered.find((r) => r.kind !== 'current') ?? ordered[0])?.id ?? null;
}

/** Axis of one criterion. Scores and shares are 0..100; the rest spans the strategies compared, from zero. */
export function metricAxis(def: MetricDef, all: readonly RotationStrategy[]): [lo: number, hi: number] {
  if (def.unit === 'index' || def.unit === 'pct') return [0, 100];
  const vals = all.map(def.get).filter((v): v is number => v != null);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** 0..1 along the axis where right is better: a low water use sits to the right of a high one. */
export function goodness(def: MetricDef, v: number, [lo, hi]: readonly [number, number]): number {
  const p = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return def.better === 'higher' ? p : 1 - p;
}

export type Verdict = 'better' | 'worse' | 'same';

export interface TradeRow {
  def: MetricDef;
  /** 0-based rank among the farmer's priorities, or -1. */
  rank: number;
  current: number | null;
  selected: number | null;
  currentPos: number | null;
  selectedPos: number | null;
  /** Selected minus current, in the criterion's own unit. */
  delta: number | null;
  verdict: Verdict | null;
}

/** One row per criterion, the farmer's priorities first. `current` may be missing or be the selection itself. */
export function tradeOffRows(current: RotationStrategy | null, selected: RotationStrategy, all: readonly RotationStrategy[], priorities: readonly FarmerPriority[]): TradeRow[] {
  const rows = METRICS.map((def, order) => {
    const axis = metricAxis(def, all);
    const cur = current ? def.get(current) : null;
    const sel = def.get(selected);
    const delta = cur != null && sel != null && current?.id !== selected.id ? sel - cur : null;
    // Below half a unit the two print the same number: calling one better would be noise.
    const verdict: Verdict | null = delta == null ? null : Math.abs(delta) < 0.5 ? 'same' : delta > 0 === (def.better === 'higher') ? 'better' : 'worse';
    const rank = priorities.findIndex((p) => def.priorities.includes(p));
    return { order, row: { def, rank, current: cur, selected: sel, currentPos: cur == null ? null : goodness(def, cur, axis), selectedPos: sel == null ? null : goodness(def, sel, axis), delta, verdict } };
  });
  const key = (r: TradeRow) => (r.rank < 0 ? Number.POSITIVE_INFINITY : r.rank);
  return rows.sort((a, b) => key(a.row) - key(b.row) || a.order - b.order).map((x) => x.row);
}

/** The few criteria on which the strategy moves furthest from the current practice, either way. */
export function topDifferences(rows: readonly TradeRow[], n = 3): TradeRow[] {
  const move = (r: TradeRow) => Math.abs((r.selectedPos ?? 0) - (r.currentPos ?? 0));
  return rows
    .filter((r) => (r.verdict === 'better' || r.verdict === 'worse') && move(r) >= 0.02)
    .sort((a, b) => move(b) - move(a))
    .slice(0, n);
}
