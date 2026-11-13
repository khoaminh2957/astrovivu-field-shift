/**
 * Tier 5 public API (rule-based core): automatic commentary and actionable advisories.
 * PLACEHOLDER IMPLEMENTATION (owner: Agent 2c). Returns empty results until the engine lands;
 * UI code must render real data whenever these arrays are non-empty.
 */
import type { AdvisoryReport, Insight, ModelInput, ScoreTimeline } from '@/contracts';

/** What changed on the field, pinned to dates on the timeline (anomalies, stage changes, events). */
export function buildInsights(_input: ModelInput, _score: ScoreTimeline): Insight[] {
  return [];
}

/** Irrigation schedule, pH plan, sowing-window shift and the >= 3 rotation strategies. */
export function buildAdvisoryReport(input: ModelInput, _score: ScoreTimeline): AdvisoryReport {
  return { generatedAt: input.today, cropId: input.cropId, priorities: input.priorities, advisories: [], rotations: [] };
}
