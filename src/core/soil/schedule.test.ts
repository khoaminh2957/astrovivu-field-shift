import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, GroundTruth, ModelInput } from '@/contracts';
import { phPlan } from '@/core/advisory/actions';
import { buildRotations } from '@/core/advisory/rotation';
import { getSampleParcel } from '@/data/samples';
import { diagnoseSoil } from './diagnosis';
import { buildSoilPlan } from './plan';
import { soilSchedule } from './schedule';

const load = (id: string): FieldTelemetry =>
  JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function demo(id: string, own: Partial<GroundTruth> = {}, cropId?: string, today = '2026-11-14'): ModelInput {
  const p = getSampleParcel(id)!;
  return {
    parcel: p,
    telemetry: load(id),
    cropId: cropId ?? p.defaultCropId,
    groundTruth: { ...(p.defaultGroundTruth ?? {}), ...own },
    priorities: ['profit', 'soil', 'water'],
    today,
  };
}

describe('soilSchedule (S13 #54)', () => {
  it('daklak-coffee with groundTruth.ph = 4.2: schedules liming, shares sum to 1, and split dose ranges sum to initial rateRange', () => {
    const input = demo('daklak-coffee', { ph: 4.2 });
    const diag = diagnoseSoil(input);
    const ph = phPlan(input);
    const plan = buildSoilPlan(diag, input, ph);
    const rotations = buildRotations(input);
    const currentRotation = rotations.find((r) => r.kind === 'current') ?? rotations[0]!;

    const phItem = plan.items.find((i) => i.metric === 'ph');
    expect(phItem?.rateRange).not.toBeNull();
    const initialRange = [phItem!.rateRange!.min, phItem!.rateRange!.max];

    const sched = soilSchedule(plan, currentRotation, input.today);
    const phSteps = sched.filter((s) => s.requirementId === 'ph' && s.dose != null);
    expect(phSteps.length).toBeGreaterThanOrEqual(2);

    const shareSum = phSteps.reduce((acc, s) => acc + s.share, 0);
    expect(shareSum).toBeCloseTo(1, 5);

    const doseMinSum = phSteps.reduce((acc, s) => acc + s.dose!.range[0], 0);
    const doseMaxSum = phSteps.reduce((acc, s) => acc + s.dose!.range[1], 0);
    expect(doseMinSum).toBeCloseTo(initialRange[0]!, 5);
    expect(doseMaxSum).toBeCloseTo(initialRange[1]!, 5);

    for (const step of phSteps) {
      expect(step.basis.en).toContain('Havlin');
      expect(step.basis.en).toContain('p. 68');
    }
  });

  it('iowa-corn-soy with groundTruth.ph = 4.6: application month precedes startMonth of the next planted season in current rotation', () => {
    const input = demo('iowa-corn-soy', { ph: 4.6 });
    const plan = buildSoilPlan(diagnoseSoil(input), input, phPlan(input));
    const rotations = buildRotations(input);
    const currentRotation = rotations.find((r) => r.kind === 'current')!;
    const nextPlanted = currentRotation.seasons.find((s) => s.cropId !== 'fallow')!;

    const sched = soilSchedule(plan, currentRotation, input.today);
    const phSteps = sched.filter((s) => s.requirementId === 'ph' && s.dose != null);
    expect(phSteps.length).toBeGreaterThan(0);

    for (const step of phSteps) {
      expect(step.month).toBeLessThan(nextPlanted.startMonth);
    }
  });

  it('shifts schedule when today changes and never reads the system clock', () => {
    const inputA = demo('daklak-coffee', { ph: 4.2 }, undefined, '2026-11-14');
    const plan = buildSoilPlan(diagnoseSoil(inputA), inputA, phPlan(inputA));
    const currentRotation = buildRotations(inputA)[0]!;

    const sched2026 = soilSchedule(plan, currentRotation, '2026-11-14');
    const sched2028 = soilSchedule(plan, currentRotation, '2028-03-10');

    expect(sched2028[0]!.year).toBe(sched2026[0]!.year + 2);
    expect(sched2028[0]!.month).toBe(3);
    expect(sched2026[0]!.month).toBe(11);

    const src = readFileSync('src/core/soil/schedule.ts', 'utf8');
    const clockPattern = new RegExp(['Date\\.now', 'new Date\\s*\\('].join('|'));
    expect(src).not.toMatch(clockPattern);
  });

  it('every year in the schedule has at least one recheck entry while open requirements exist', () => {
    for (const id of ['daklak-coffee', 'iowa-corn-soy'] as const) {
      const input = demo(id, { ph: 4.5 });
      const plan = buildSoilPlan(diagnoseSoil(input), input, phPlan(input));
      const rotation = buildRotations(input).find((r) => r.kind === 'current')!;
      const sched = soilSchedule(plan, rotation, input.today);

      const years = [...new Set(sched.map((s) => s.year))];
      expect(years.length).toBeGreaterThanOrEqual(rotation.years);
      for (const y of years) {
        const yearRechecks = sched.filter(
          (s) => s.year === y && s.recheck.en.trim().length > 0 && s.recheck.vi.trim().length > 0,
        );
        expect(yearRechecks.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
