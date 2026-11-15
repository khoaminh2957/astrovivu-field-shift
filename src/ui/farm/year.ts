/** The twelve months of the field's year as chart rows: rain, mean high and low, mean score. Shared by the detail sheets and the dossier. */
import { useMemo } from 'react';
import type { ModelInput, ScoreTimeline } from '@/contracts';
import { farmPeriods, periodScore, periodWeather } from '@/core/farm';
import type { MonthDatum } from './charts';

export function farmYear(input: ModelInput, score: ScoreTimeline): MonthDatum[] {
  return farmPeriods(input.telemetry.window, 'month').map((p) => {
    const w = periodWeather(input.telemetry, p);
    return { id: p.id, month: p.months[0], rainMm: w.rainMm, tMaxC: w.tMaxMeanC, tMinC: w.tMinMeanC, score: periodScore(score, p) };
  });
}

export function useFarmYear(input: ModelInput | null, score: ScoreTimeline | null): MonthDatum[] {
  return useMemo(() => (input && score ? farmYear(input, score) : []), [input, score]);
}
