import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput, RotationSeason, RotationStrategy } from '@/contracts';
import { pick } from '@/contracts';
import { computeScoreTimeline } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { annualPlan, buildAdvisoryReport, evaluateCustomRotation, slotCropChoices, swapRotationSeason } from './index';
import { buildRotations } from './rotation';

const IDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
const load = (id: string): FieldTelemetry => JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, gt = true): ModelInput {
  const p = getSampleParcel(id)!;
  const dgt = (p as { defaultGroundTruth?: ModelInput['groundTruth'] }).defaultGroundTruth;
  return {
    parcel: p,
    telemetry: load(id),
    cropId: p.defaultCropId,
    groundTruth: gt ? { ...(dgt ?? {}) } : {},
    priorities: ['profit', 'water', 'soil'],
    today: '2026-11-14',
  };
}

const lenOf = (s: RotationSeason) => ((s.endMonth - s.startMonth + 12) % 12) + 1;
const monthsOf = (s: RotationSeason) => Array.from({ length: lenOf(s) }, (_, i) => ((s.startMonth - 1 + i) % 12) + 1);
const hasFractionalShare = (r: RotationStrategy) => r.seasons.some((s) => (s.share ?? 1) < 1 || /% of area/.test(s.label.en));

describe('non-overlapping full-area rotation seasons across all real samples', () => {
  it.each(IDS)('%s never schedules two full-area seasons on the same month in the same year', (id) => {
    for (const gt of [true, false]) {
      const rotations = buildRotations(inputFor(id, gt));
      expect(rotations.length).toBeGreaterThanOrEqual(3);
      for (const r of rotations) {
        if (hasFractionalShare(r)) continue;
        for (let y = 0; y < r.years; y++) {
          const seen = new Map<number, string>();
          for (const s of r.seasons.filter((x) => (x.year ?? 0) === y)) {
            for (const m of monthsOf(s)) {
              const prev = seen.get(m);
              expect(prev, `${id} gt=${gt} ${r.id} year=${y} month=${m}: ${s.cropId} overlaps ${prev}`).toBeUndefined();
              seen.set(m, s.cropId);
            }
          }
          expect(seen.size, `${id} gt=${gt} ${r.id} year=${y} should account for all 12 months (crops + fallow)`).toBe(12);
        }
      }
    }
  });

  it('nevada-alfalfa proposes multi-year stand + rest renewals instead of overlapping a cover crop on standing alfalfa', () => {
    const rotations = buildRotations(inputFor('nevada-alfalfa', true));
    const kinds = rotations.map((r) => r.kind);
    expect(kinds).toContain('current');
    expect(kinds).toContain('soil-health');
    expect(kinds).toContain('resilience');
    for (const r of rotations) {
      expect(r.seasons.some((s) => s.cropId !== 'medicago-sativa' && s.cropId !== 'fallow')).toBe(false);
    }
  });
});

describe('bilingual EvidenceItem.value and ActionStep.amount across all real samples', () => {
  const FORBIDDEN_EN_IN_VI = /needs met in|your measurement|modelled crop water use|reference values|\(indicative\)|moderately well|somewhat poorly|poorly drained/i;

  it.each(IDS)('%s localizes evidence values and action amounts in Vietnamese', (id) => {
    const input = inputFor(id, true);
    const report = buildAdvisoryReport(input, computeScoreTimeline(input));
    for (const r of report.rotations) {
      for (const e of r.evidence) {
        const vi = pick(e.value, 'vi');
        expect(vi, `${id} ${r.id} ${e.label.en}`).not.toMatch(FORBIDDEN_EN_IN_VI);
      }
    }
    for (const adv of report.advisories) {
      for (const e of adv.evidence) {
        expect(pick(e.value, 'vi'), `${id} ${adv.id} ${e.label.en}`).not.toMatch(FORBIDDEN_EN_IN_VI);
      }
      for (const a of adv.actions) {
        if (a.amount) expect(pick(a.amount, 'vi'), `${id} ${adv.id} action`).not.toMatch(FORBIDDEN_EN_IN_VI);
      }
    }
  });
});

describe('interactive custom season crop swap and live re-scoring', () => {
  it('swaps the 3rd rice crop on cantho-rice to mung bean and re-scores metrics, risks and annual plan', () => {
    const input = inputFor('cantho-rice', true);
    const base = buildRotations(input);
    const current = base.find((r) => r.kind === 'current')!;
    // Current is triple rice: Nov-Feb, Mar-Jun, Jul-Oct
    const thirdIdx = current.seasons.findIndex((s) => s.startMonth === 7);
    expect(thirdIdx).toBeGreaterThanOrEqual(0);

    const choices = slotCropChoices(input, current, thirdIdx);
    expect(choices[0]?.cropId).toBe('fallow');
    expect(choices.some((c) => c.cropId === 'vigna-radiata')).toBe(true);

    const res = swapRotationSeason(input, base, current, thirdIdx, 'vigna-radiata');
    expect(res).not.toBeNull();
    const custom = res!.rotations.find((r) => r.kind === 'custom')!;
    const keptCurrent = res!.rotations.find((r) => r.kind === 'current')!;
    expect(custom).toBeDefined();
    expect(keptCurrent.seasons.filter((s) => s.cropId === 'oryza-sativa')).toHaveLength(3);

    expect(custom.seasons.filter((s) => s.cropId === 'oryza-sativa')).toHaveLength(2);
    expect(custom.seasons.some((s) => s.cropId === 'vigna-radiata')).toBe(true);
    expect(custom.seasons.some((s) => s.cropId === 'fallow')).toBe(true);
    expect(custom.metrics.nitrogenKgHaYr).toBeGreaterThan(keptCurrent.metrics.nitrogenKgHaYr);
    expect(custom.metrics.pestBreak).toBeGreaterThan(keptCurrent.metrics.pestBreak);
    expect(custom.metrics.waterUseMm).toBeLessThan(keptCurrent.metrics.waterUseMm);
    // Growing an upland legume on a paddy parcel triggers the drainage / raised-bed risk warning.
    expect(custom.risks.some((x) => /paddy|ruộng lúa/i.test(x.en + ' ' + x.vi))).toBe(true);

    const plan = annualPlan(input, custom);
    expect(plan.strategyId).toBe('custom');
    expect(plan.months).toHaveLength(12);

    // Second edit on custom preserves the original baseline name and updates cleanly to fallow.
    const mungIdx = custom.seasons.findIndex((s) => s.cropId === 'vigna-radiata');
    const res2 = swapRotationSeason(input, base, custom, mungIdx, 'fallow', res!.spec);
    expect(res2).not.toBeNull();
    expect(res2!.spec.fromName).toEqual(current.name);
    const custom2 = evaluateCustomRotation(input, base, res2!.spec).find((r) => r.kind === 'custom')!;
    expect(custom2.seasons.filter((s) => s.cropId !== 'fallow')).toHaveLength(2);
  });

  it('disallows turning the sole remaining crop season into fallow', () => {
    const input = inputFor('daklak-coffee', true);
    const base = buildRotations(input);
    const current = base.find((r) => r.kind === 'current')!;
    expect(current.seasons).toHaveLength(1);
    const choices = slotCropChoices(input, current, 0);
    expect(choices.some((c) => c.cropId === 'fallow')).toBe(false);
    expect(swapRotationSeason(input, base, current, 0, 'fallow')).toBeNull();
  });

  it('supports swapping inter-row cover on daklak-coffee and planting a rest year on nevada-alfalfa', () => {
    const dkInput = inputFor('daklak-coffee', true);
    const dkBase = buildRotations(dkInput);
    const soil = dkBase.find((r) => r.kind === 'soil-health')!;
    const coverIdx = soil.seasons.findIndex((s) => (s.share ?? 1) < 1);
    expect(coverIdx).toBeGreaterThanOrEqual(0);
    const coverChoices = slotCropChoices(dkInput, soil, coverIdx);
    expect(coverChoices[0]?.cropId).toBe('fallow');
    const altCover = coverChoices.find((c) => c.cropId !== 'fallow' && c.cropId !== soil.seasons[coverIdx].cropId);
    if (altCover) {
      const swapped = swapRotationSeason(dkInput, dkBase, soil, coverIdx, altCover.cropId);
      expect(swapped).not.toBeNull();
      const custom = swapped!.rotations.find((r) => r.kind === 'custom')!;
      expect(custom.seasons.some((s) => s.cropId === altCover.cropId && (s.share ?? 1) < 1)).toBe(true);
    }

    const nvInput = inputFor('nevada-alfalfa', true);
    const nvBase = buildRotations(nvInput);
    const nvSoil = nvBase.find((r) => r.kind === 'soil-health')!;
    const fallowIdx = nvSoil.seasons.findIndex((s) => s.cropId === 'fallow');
    expect(fallowIdx).toBeGreaterThanOrEqual(0);
    const nvChoices = slotCropChoices(nvInput, nvSoil, fallowIdx);
    expect(nvChoices.some((c) => c.cropId === 'cicer-arietinum')).toBe(true);
    const planted = swapRotationSeason(nvInput, nvBase, nvSoil, fallowIdx, 'cicer-arietinum');
    expect(planted).not.toBeNull();
    const nvCustom = planted!.rotations.find((r) => r.kind === 'custom')!;
    expect(nvCustom.years).toBe(5);
    expect(nvCustom.seasons.some((s) => s.cropId === 'cicer-arietinum' && s.year === 4)).toBe(true);
  });
});
