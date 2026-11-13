/**
 * Tier 3 public API: farm economics (yield -> production -> revenue -> cost -> margin).
 * PLACEHOLDER IMPLEMENTATION (owner: Agent 2b). See docs/ECONOMICS.md once written.
 */
import type { CurrencyInfo, ModelInput, ScoreTimeline, SeasonEconomics } from '@/contracts';

export function estimateSeasonEconomics(_input: ModelInput, _score: ScoreTimeline, _cropId?: string): SeasonEconomics | null {
  return null;
}

export function getCurrency(code: 'USD' | 'VND'): CurrencyInfo {
  return code === 'VND'
    ? { code, perUsd: 25_000, asOf: 'placeholder', source: 'placeholder' }
    : { code, perUsd: 1, asOf: 'n/a', source: 'n/a' };
}
