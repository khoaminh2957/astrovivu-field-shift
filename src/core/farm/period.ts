/**
 * The farm by month or by quarter (docs/FARM.md §2). The stage steps through the twelve calendar
 * months that end with today's, or through the same months three at a time, so that a grower sees
 * a crop come up, ripen and be cut in a dozen steps instead of 365.
 *
 * A period is summed from the days of the record; nothing is added. The sky drawn for a period is
 * a drawing rule over those days (how many were wet, hot, overcast), not an observation.
 */
import type { FieldTelemetry, ISODate, ModelInput, ScoreTimeline } from '@/contracts';
import { addDays, diffDays } from '@/lib/time';
import { type FarmScene, type SkyKind, farmSceneAt, weatherAt } from './index';

export type FarmStep = 'month' | 'quarter';

export interface FarmPeriod {
  id: string;
  step: FarmStep;
  from: ISODate;
  to: ISODate;
  /** Calendar months the period covers, 1..12, in order. */
  months: number[];
  /** True when the period ends today and its last month is not over. */
  partial: boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const lastDay = (y: number, m: number): ISODate => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;

/** The twelve calendar months ending with today's, clipped to the window, as months or as four quarters. */
export function farmPeriods(window: { start: ISODate; today: ISODate }, step: FarmStep): FarmPeriod[] {
  const ty = Number(window.today.slice(0, 4));
  const tm = Number(window.today.slice(5, 7));
  const months: FarmPeriod[] = [];
  for (let k = 11; k >= 0; k--) {
    const idx = ty * 12 + (tm - 1) - k;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    const first = `${y}-${pad(m)}-01`;
    const end = lastDay(y, m);
    const from = first < window.start ? window.start : first;
    const to = end > window.today ? window.today : end;
    if (from > to) continue;
    months.push({ id: `${y}-${pad(m)}`, step: 'month', from, to, months: [m], partial: to < end });
  }
  if (step === 'month') return months;
  const out: FarmPeriod[] = [];
  // Three months at a time, counted back from today so that the last quarter ends now.
  for (let end = months.length; end > 0; end -= 3) {
    const part = months.slice(Math.max(0, end - 3), end);
    out.unshift({ id: `${part[0].id}_${part.at(-1)!.id}`, step: 'quarter', from: part[0].from, to: part.at(-1)!.to, months: part.map((p) => p.months[0]), partial: part.at(-1)!.partial });
  }
  return out;
}

export interface FarmPeriodSummary {
  period: FarmPeriod;
  days: number;
  /** Days of the period that have a weather reading. */
  daysRead: number;
  rainMm: number | null;
  wetDays: number;
  heavyRainDays: number;
  hotDays: number;
  frostDays: number;
  overcastDays: number;
  /** Mean of the daily maxima and of the daily minima. */
  tMaxMeanC: number | null;
  tMinMeanC: number | null;
  /** The sky the period is drawn with. A drawing rule: see `periodSky`. */
  kind: SkyKind;
  sourceIds: string[];
}

/** Shares of the days read above which a period is drawn with that sky. Rain is drawn first, as for a day. */
export const PERIOD_SKY = { heavy: 0.07, wet: 0.4, frost: 0.15, hot: 0.3, overcast: 0.5 } as const;

export function periodSky(s: Pick<FarmPeriodSummary, 'daysRead' | 'wetDays' | 'heavyRainDays' | 'hotDays' | 'frostDays' | 'overcastDays'>): SkyKind {
  if (s.daysRead === 0) return 'unknown';
  const share = (n: number): number => n / s.daysRead;
  if (s.heavyRainDays >= 2 && share(s.heavyRainDays) >= PERIOD_SKY.heavy) return 'heavy-rain';
  if (share(s.wetDays) >= PERIOD_SKY.wet) return 'rain';
  if (share(s.frostDays) >= PERIOD_SKY.frost) return 'frost';
  if (share(s.hotDays) >= PERIOD_SKY.hot) return 'hot';
  if (share(s.overcastDays) >= PERIOD_SKY.overcast) return 'cloudy';
  return 'clear';
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (v: number | null): number | null => (v == null ? null : Math.round(v * 10) / 10);

/** The weather of a period, summed from its days. */
export function periodWeather(t: FieldTelemetry, period: FarmPeriod): FarmPeriodSummary {
  const sources = new Set<string>();
  const hi: number[] = [];
  const lo: number[] = [];
  let rain: number | null = null;
  const n = { read: 0, wet: 0, heavy: 0, hot: 0, frost: 0, overcast: 0 };
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) {
    const w = weatherAt(t, d);
    if (w.kind === 'unknown') continue;
    n.read++;
    w.sourceIds.forEach((s) => sources.add(s));
    if (w.tMaxC != null) hi.push(w.tMaxC);
    if (w.tMinC != null) lo.push(w.tMinC);
    if (w.rainMm != null) rain = (rain ?? 0) + w.rainMm;
    if (w.kind === 'heavy-rain') n.heavy++;
    if (w.kind === 'rain' || w.kind === 'heavy-rain') n.wet++;
    if (w.kind === 'hot') n.hot++;
    if (w.kind === 'frost') n.frost++;
    if (w.kind === 'cloudy') n.overcast++;
  }
  const counts = { daysRead: n.read, wetDays: n.wet, heavyRainDays: n.heavy, hotDays: n.hot, frostDays: n.frost, overcastDays: n.overcast };
  return {
    period,
    days: diffDays(period.to, period.from) + 1,
    ...counts,
    rainMm: r1(rain),
    tMaxMeanC: r1(mean(hi)),
    tMinMeanC: r1(mean(lo)),
    kind: periodSky(counts),
    sourceIds: [...sources],
  };
}

/** Mean productivity score of the days of a period, 0..100; null when the timeline has none of them. */
export function periodScore(score: ScoreTimeline, period: FarmPeriod): number | null {
  const xs = score.snapshots.filter((s) => s.t >= period.from && s.t <= period.to).map((s) => s.productivity);
  const m = mean(xs);
  return m == null ? null : Math.round(m);
}

/**
 * The field at the end of a period, under the sky of the whole period: the crop and the soil are
 * those of the period's last day, the weather figures are the period's (mean temperatures, total rain).
 */
export function farmSceneOfPeriod(input: ModelInput, score: ScoreTimeline, period: FarmPeriod): { scene: FarmScene; summary: FarmPeriodSummary } {
  const summary = periodWeather(input.telemetry, period);
  const scene = farmSceneAt(input, score, period.to);
  return {
    summary,
    scene: {
      ...scene,
      weather: { t: period.to, kind: summary.kind, tMaxC: summary.tMaxMeanC, tMinC: summary.tMinMeanC, rainMm: summary.rainMm, rain7Mm: null, rhPct: null, windMs: scene.weather.windMs, forecast: false, sourceIds: summary.sourceIds },
    },
  };
}
