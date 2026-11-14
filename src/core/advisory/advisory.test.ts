import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput, UrbanClimate } from '@/contracts';
import { buildAdvisoryReport, buildInsights } from '@/core/advisory';
import { climateNormals } from '@/core/advisory/util';
import { computeScoreTimeline } from '@/core/scoring';
import { buildTracking } from '@/core/tracking';
import { recommendUrban } from '@/core/urban';
import { getSampleParcel } from '@/data/samples';

const IDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
const load = (id: string): FieldTelemetry => JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, gt = true): ModelInput {
  const p = getSampleParcel(id)!;
  const dgt = (p as { defaultGroundTruth?: ModelInput['groundTruth'] }).defaultGroundTruth;
  return { parcel: p, telemetry: load(id), cropId: p.defaultCropId, groundTruth: gt ? { ...(dgt ?? {}) } : {}, priorities: ['profit', 'water', 'soil'], today: '2026-11-14' };
}

describe.each(IDS)('advisory on real sample %s', (id) => {
  for (const gt of [true, false]) {
    const input = inputFor(id, gt);
    const score = computeScoreTimeline(input);
    it(`insights are sorted, bounded and bilingual (ground truth ${gt})`, () => {
      const ins = buildInsights(input, score);
      expect(ins.length).toBeGreaterThan(3);
      expect(ins.length).toBeLessThanOrEqual(36);
      for (let i = 1; i < ins.length; i++) expect(ins[i - 1].t <= ins[i].t).toBe(true);
      for (const i of ins) expect(i.text.en && i.text.vi).toBeTruthy();
    });
    it(`report has >= 3 rotations including current, with complete lists and metrics in range (ground truth ${gt})`, () => {
      const r = buildAdvisoryReport(input, score);
      expect(r.rotations.length).toBeGreaterThanOrEqual(3);
      expect(r.rotations.filter((s) => s.kind === 'current')).toHaveLength(1);
      for (const s of r.rotations) {
        for (const k of ['why', 'evidence', 'benefits', 'gaps', 'risks'] as const) expect(s[k].length, `${s.id}.${k}`).toBeGreaterThan(0);
        for (const k of ['suitability', 'soilHealth', 'waterFit', 'risk', 'groundCoverPct', 'pestBreak'] as const) {
          expect(s.metrics[k]).toBeGreaterThanOrEqual(0);
          expect(s.metrics[k]).toBeLessThanOrEqual(100);
        }
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
        expect(s.seasons.length).toBeGreaterThan(0);
        for (const se of s.seasons) expect(se.year).toBeLessThan(s.years);
      }
      expect(r.annualPlan?.months).toHaveLength(12);
      expect(r.sowing).toHaveLength(12);
      for (const a of r.advisories) expect(a.caveats.length + a.evidence.length).toBeGreaterThan(0);
    });
  }
  it('tracking is simulated for the demo field and empty for an own parcel', () => {
    const input = inputFor(id);
    const tr = buildTracking(input);
    expect(tr.simulated).toBe(true);
    expect(tr.seasons.length).toBeGreaterThan(0);
    expect(tr.seasons.every((s) => s.simulated)).toBe(true);
    expect(tr.soilTests.every((s) => s.simulated && s.values.length === 12)).toBe(true);
    const own = buildTracking({ ...input, parcel: { ...input.parcel, source: 'coords' as const } });
    expect(own.simulated).toBe(false);
    expect(own.seasons).toHaveLength(0);
    expect(own.soilTests).toHaveLength(0);
  });
});

function urbanClimate(id: string): UrbanClimate {
  const t = load(id);
  const n = climateNormals(t)!;
  return { location: getSampleParcel(id)!.centroid, months: n.map((m) => ({ month: m.month, tMean: m.tMean, tMin: m.tMin, tMax: m.tMax, rainMm: m.rainMm, par: null, rh: null })), sourceIds: ['era5'] };
}

describe('urban companion', () => {
  it.each([
    ['cantho-rice', 1],
    ['iowa-corn-soy', 5],
  ])('recommends plants for %s', (id, month) => {
    const recs = recommendUrban({ location: getSampleParcel(id)!.centroid, light: 'full', space: 'balcony' }, urbanClimate(id), ['vegetables', 'herbs'], month);
    expect(recs.length).toBeGreaterThan(2);
    for (const r of recs) {
      expect(r.care.sowMonths.length).toBeGreaterThan(0);
      expect(r.calendar).toHaveLength(12);
      expect(r.why.length).toBeGreaterThan(0);
    }
  });
});
