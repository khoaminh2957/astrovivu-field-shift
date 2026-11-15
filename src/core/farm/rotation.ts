/**
 * A rotation strategy on the farm stage (docs/FARM.md §3): which crop of the strategy stands on
 * the field in a given month, scored through the same year of weather as the field itself.
 *
 * This is a simulation and the stage labels it so: the record of the year is real, the crop on it
 * is the strategy's. Only the first year of a multi-year rotation is shown.
 */
import type { ISODate, ModelInput, RotationSeason, RotationStrategy, ScoreTimeline } from '@/contracts';
import { getCrop } from '@/core/crops';
import { computeScoreTimeline } from '@/core/scoring';
import { withChange } from './index';

export interface SeasonRun {
  season: RotationSeason;
  /** Calendar months the season covers, 1..12. */
  months: number[];
  input: ModelInput;
  score: ScoreTimeline;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Months from `start` to `end` inclusive, wrapping over the new year. */
export function seasonMonths(start: number, end: number): number[] {
  const out: number[] = [];
  for (let m = start, k = 0; k < 12; k++, m = (m % 12) + 1) {
    out.push(m);
    if (m === end) break;
  }
  return out;
}

/** The first of the season's start month, on its latest occurrence that is not after `today`. */
function sowingDateIn(today: ISODate, month: number): ISODate {
  const y = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  return `${month > tm ? y - 1 : y}-${pad(month)}-01`;
}

/** Each season of the strategy's first year, with the year scored for its crop sown in its month. */
export function seasonRuns(input: ModelInput, strategy: RotationStrategy): SeasonRun[] {
  const cache = new Map<string, { input: ModelInput; score: ScoreTimeline }>();
  const out: SeasonRun[] = [];
  for (const season of strategy.seasons) {
    if ((season.year ?? 0) > 0) continue;
    // A crop grown between the rows of another, or beside it, is not the one the field is drawn with.
    if (season.slotRole === 'inter-row' || season.slotRole === 'companion') continue;
    const crop = season.cropId === 'fallow' ? null : getCrop(season.cropId);
    const perennial = crop?.lifeSpan === 'perennial';
    const key = `${crop?.id ?? 'fallow'}@${perennial ? 0 : season.startMonth}`;
    let run = cache.get(key);
    if (!run) {
      const next = withChange(input, { cropId: crop?.id ?? null, groundTruth: { sowingDate: crop && !perennial ? sowingDateIn(input.today, season.startMonth) : undefined } });
      run = { input: next, score: computeScoreTimeline(next) };
      cache.set(key, run);
    }
    out.push({ season, months: seasonMonths(season.startMonth, season.endMonth), ...run });
  }
  return out;
}

/** The season standing on the field in the month of `day`: the one with the largest share of the parcel. */
export function runOn(runs: SeasonRun[], day: ISODate): SeasonRun | null {
  const m = Number(day.slice(5, 7));
  const hits = runs.filter((r) => r.months.includes(m));
  if (!hits.length) return null;
  return hits.reduce((a, b) => ((b.season.share ?? 1) > (a.season.share ?? 1) ? b : a));
}

/** The field with no crop on it, for a month the strategy leaves bare. */
export function bareRun(input: ModelInput): { input: ModelInput; score: ScoreTimeline } {
  const next = withChange(input, { cropId: null });
  return { input: next, score: computeScoreTimeline(next) };
}
