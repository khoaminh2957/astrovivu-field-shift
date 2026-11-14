/**
 * Tier 5 public API (rule-based core): automatic commentary and actionable advisories.
 * See docs/ADVISORY.md for every rule, its source and its limits.
 */
import type { AdvisoryReport, Insight, ModelInput, ScoreTimeline } from '@/contracts';
import { scanSowingWindows } from '@/core/scoring';
import { advisories, annualPlan, irrigationPlan, phPlan } from './actions';
import { computeInsights } from './insights';
import { buildRotations } from './rotation';

export { annualPlan } from './actions';
export { type CustomRotationSpec, evaluateCustomRotation, slotCropChoices, swapRotationSeason } from './customRotation';

/** What changed on the field, pinned to dates on the timeline (anomalies, stage changes, events). */
export function buildInsights(input: ModelInput, score: ScoreTimeline): Insight[] {
  return computeInsights(input, score);
}

// The report is a pure function of the input; `recompute()` calls it on every branch arrival, so
// it is memoised on the telemetry object and the value of everything else.
const memo = new WeakMap<object, Map<string, AdvisoryReport>>();

/** Irrigation schedule, pH plan, sowing-window shift and the >= 3 rotation strategies. */
export function buildAdvisoryReport(input: ModelInput, score: ScoreTimeline): AdvisoryReport {
  const key = JSON.stringify([input.cropId, input.groundTruth, input.priorities, input.parcel.id, input.parcel.areaHa, input.today, score.snapshots.length]);
  let m = memo.get(input.telemetry);
  if (!m) memo.set(input.telemetry, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const rotations = buildRotations(input);
  const irrigation = irrigationPlan(input, score);
  const ph = phPlan(input);
  const best = [...rotations].sort((a, b) => b.score - a.score)[0];
  const report: AdvisoryReport = {
    generatedAt: input.today,
    cropId: input.cropId,
    priorities: input.priorities,
    advisories: advisories(input, score, irrigation, ph, rotations),
    rotations,
    ...(irrigation ? { irrigation } : {}),
    ...(input.cropId ? { sowing: scanSowingWindows(input) } : {}),
    ...(ph ? { ph } : {}),
    ...(best ? { annualPlan: annualPlan(input, best) } : {}),
  };
  m.set(key, report);
  return report;
}
