/**
 * Tier 3 public API: productivity scoring.
 *
 * PLACEHOLDER IMPLEMENTATION (owner: Agent 2b). The real pipeline is documented in
 * docs/SCORING.md; this stub only produces a plausible time-varying score from NDVI and
 * root-zone moisture so the Center Productivity Hub and the timeline can be built against it.
 */
import type { FactorScore, ModelInput, Quad, ScoreSnapshot, ScoreTimeline, SowingWindow, WhatIfResult } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { findSeries, sampleAt } from '@/lib/series';
import { eachDay } from '@/lib/time';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const norm = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));

/** EcoCrop trapezoid: 0 outside the absolute window, 1 inside the optimal one, linear in between. */
export function trapezoid(x: number, [absMin, optMin, optMax, absMax]: Quad): number {
  if (x <= absMin || x >= absMax) return 0;
  if (x < optMin) return (x - absMin) / (optMin - absMin);
  if (x <= optMax) return 1;
  return (absMax - x) / (absMax - optMax);
}

export function computeScoreTimeline(input: ModelInput): ScoreTimeline {
  const { telemetry, cropId, groundTruth } = input;
  const crop = getCrop(cropId);
  const ndvi = findSeries(telemetry.branches.vegetation, 'ndvi');
  const sm = findSeries(telemetry.branches.soilMoisture, 'sm_root');
  const phFact = telemetry.branches.soil.facts.find((f) => f.key === 'ph');
  const ph = groundTruth.ph ?? (typeof phFact?.value === 'number' ? phFact.value : null);

  const phScore = crop && ph != null ? trapezoid(ph, crop.req.ph) : null;
  const compatibility = crop ? Math.round(100 * (phScore ?? 0.8)) : null;

  const snapshots: ScoreSnapshot[] = eachDay(telemetry.window.start, telemetry.window.end, 7).map((t) => {
    const vigor = ndvi ? norm(sampleAt(ndvi, t).sample?.v ?? 0.4, 0.2, 0.85) : 0.5;
    const water = sm ? norm(sampleAt(sm, t).sample?.v ?? 0.25, 0.12, 0.36) : 0.5;
    const condition = Math.round(100 * (0.55 * vigor + 0.45 * water));
    const factors: FactorScore[] = [
      { key: 'vigor', label: tx('Vegetation vigour', 'Sức sống thảm thực vật'), score: vigor, weight: 0.55, actual: null, ideal: 'NDVI > 0.7', kind: 'fixed', branch: 'vegetation' },
      { key: 'water', label: tx('Root-zone water', 'Nước vùng rễ'), score: water, weight: 0.45, actual: null, ideal: '0.25-0.36 m³/m³', kind: 'manageable', branch: 'soilMoisture' },
    ];
    if (phScore != null) factors.push({ key: 'ph', label: tx('Soil pH', 'pH đất'), score: phScore, weight: 1, actual: ph, ideal: `${crop!.req.ph[1]}-${crop!.req.ph[2]}`, kind: 'manageable', branch: 'soil' });
    const limiting = factors.reduce((a, b) => ((a.score ?? 1) <= (b.score ?? 1) ? a : b));
    return {
      t,
      productivity: compatibility == null ? condition : Math.round((condition * compatibility) / 100),
      condition,
      compatibility,
      stage: null,
      factors,
      limiting: limiting.key,
      confidence: 0.3,
    };
  });

  const last = snapshots[snapshots.length - 1];
  const mean = snapshots.reduce((a, s) => a + s.productivity, 0) / Math.max(1, snapshots.length);
  return {
    cropId,
    stepDays: 7,
    snapshots,
    summary: {
      productivityNow: last?.productivity ?? 0,
      productivityMean: Math.round(mean),
      compatibility,
      limiting: last?.factors.find((f) => f.key === last.limiting) ?? null,
      expectedYieldFraction: compatibility == null ? null : mean / 100,
      reliability: null,
      calibration: [],
      headline: tx('Placeholder score (scoring pipeline not connected yet).', 'Điểm tạm (chưa nối pipeline chấm điểm).'),
    },
  };
}

/** Suitability of the selected crop for each sowing month. */
export function scanSowingWindows(_input: ModelInput): SowingWindow[] {
  return [];
}

/** Re-score with one factor changed (e.g. irrigation switched on, pH corrected). */
export function whatIf(_input: ModelInput, _patch: Partial<ModelInput['groundTruth']>): WhatIfResult[] {
  return [];
}
