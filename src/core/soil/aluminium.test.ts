import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { aluminiumRisk, KAMPRATH_FACTOR, kamprathLimeTHa } from './aluminium';

const load = (id: string): FieldTelemetry =>
  JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

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

function without(input: ModelInput, ...keys: string[]): ModelInput {
  const telemetry = structuredClone(input.telemetry);
  for (const b of Object.values(telemetry.branches)) {
    if (b) b.facts = b.facts.filter((f) => !keys.includes(f.key));
  }
  return { ...input, telemetry };
}

describe('Aluminium: exchangeable Al and the lime that neutralises it (Issue #46 / S5)', () => {
  it('daklak-coffee without measurement returns status unknown and says what to measure', () => {
    const diag = aluminiumRisk(inputFor('daklak-coffee', false));

    expect(diag.exchAlCmolKg).toBeNull();
    expect(diag.alSaturationPct).toBeNull();
    expect(diag.limeRequirementTHa).toBeNull();
    expect(diag.status).toBe('unknown');
    expect(diag.recommendations.length).toBeGreaterThan(0);
    expect(diag.recommendations[0].en).toContain('1M KCl');
    expect(diag.recommendations[0].vi).toContain('1M KCl');
    expect(diag.requiredMeasurements.length).toBe(2);
    expect(diag.summary.en && diag.summary.vi).toBeTruthy();
    // No pH threshold is used to guess at aluminium: the pH is only reported.
    expect(diag.summary.en).toContain('5.7');
    expect(diag.summary.en).not.toMatch(/toxic|below pH/i);
  });

  it('states that no crop tolerance with a checkable source is held, for coffee and for every other crop', () => {
    const input = inputFor('daklak-coffee');
    expect(input.cropId).toBe('coffea-canephora');
    for (const cropId of ['coffea-canephora', 'manihot-esculenta', 'ananas-comosus', 'vigna-unguiculata']) {
      const diag = aluminiumRisk({ ...input, cropId }, { exchAlCmolKg: 1.5 });
      expect(diag.cropTolerance.hasData).toBe(false);
      expect(diag.cropTolerance.optMaxPct).toBeNull();
      expect(diag.cropTolerance.absMaxPct).toBeNull();
      expect(diag.cropTolerance.note.en).toContain('No published aluminum saturation tolerance threshold');
      expect(diag.cropTolerance.note.vi).toContain('Không tự suy diễn từ cây khác');
    }
  });

  it('Kamprath lime, hand-computed with the bulk density of the field and a depth of 0.2 m', () => {
    // Test value, not a reading of the field: 2.0 cmol(+)/kg of exchangeable Al.
    // Dak Lak sample: bulk density 1.17 g/cm3 (SoilGrids) -> 10,000 x 0.2 x 1.17 = 2,340 t of soil per ha.
    // 1.5 x 2.0 = 3.0 cmol(+) CaCO3/kg = 1.5 g/kg -> 1.5 x 2,340 / 1,000 = 3.51 t/ha.
    // 2.0 x 2.0 = 4.0 cmol(+) CaCO3/kg = 2.0 g/kg -> 2.0 x 2,340 / 1,000 = 4.68 t/ha.
    expect(KAMPRATH_FACTOR).toEqual([1.5, 2]);
    expect(kamprathLimeTHa(2, 1.5, 1.17, 0.2)).toBeCloseTo(3.51, 6);
    expect(kamprathLimeTHa(2, 2, 1.17, 0.2)).toBeCloseTo(4.68, 6);
    // A fixed 2,000 t of soil per hectare (bulk density 1.0) would have given 3.0-4.0.
    expect(kamprathLimeTHa(2, 1.5, 1.0, 0.2)).toBeCloseTo(3, 6);

    const diag = aluminiumRisk(inputFor('daklak-coffee'), { exchAlCmolKg: 2 });
    expect(diag.exchAlCmolKg).toBe(2);
    expect(diag.bulkDensityTM3).toBe(1.17);
    expect(diag.depthM).toBe(0.2);
    expect(diag.limeRequirementTHa).toEqual([3.5, 4.7]);
    expect(diag.status).toBe('potential_risk');
    expect(diag.method).toContain('Kamprath (1970)');
    expect(diag.summary.en).toContain('bulk density of 1.17 t/m3');
    expect(diag.summary.en).toContain('top 20 cm');

    const hasCaveat = diag.caveats.some((c) => c.en.toLowerCase().includes('on-site verification') && c.vi.toLowerCase().includes('kiểm tra tại chỗ'));
    expect(hasCaveat).toBe(true);
    expect(diag.needsLocalReview).toBe(true);
  });

  it('does not use the CEC of the soil map as the effective CEC: saturation needs the exchangeable bases', () => {
    const input = inputFor('daklak-coffee');
    const alone = aluminiumRisk(input, { exchAlCmolKg: 2 });
    expect(alone.alSaturationPct).toBeNull();
    expect(alone.summary.en).toContain('cannot be computed');
    expect(alone.requiredMeasurements.some((m) => m.en.includes('Exchangeable bases'))).toBe(true);

    // With the bases: 2 / (2 + 3) = 40 %. (With the map CEC of 16.9 the old code said 11.8 %.)
    const withBases = aluminiumRisk(input, { exchAlCmolKg: 2, exchBasesCmolKg: 3 });
    expect(withBases.alSaturationPct).toBe(40);
    expect(withBases.exchBasesCmolKg).toBe(3);
    // No threshold is held, so the result is never called toxic or safe on the strength of a percentage.
    expect(withBases.status).toBe('potential_risk');
    expect(withBases.summary.en).not.toMatch(/toxic/i);
  });

  it('a result "safe" recommends no lime', () => {
    const diag = aluminiumRisk(inputFor('daklak-coffee'), { exchAlCmolKg: 0, exchBasesCmolKg: 8 });
    expect(diag.status).toBe('safe');
    expect(diag.limeRequirementTHa).toBeNull();
    expect(diag.recommendations).toEqual([]);
    expect(diag.summary.en).not.toContain('t/ha');
    expect(diag.alSaturationPct).toBe(0);
  });

  it('treats a negative exchangeable Al as an invalid reading: no dose, status unknown', () => {
    const diag = aluminiumRisk(inputFor('daklak-coffee'), { exchAlCmolKg: -1 });
    expect(diag.status).toBe('unknown');
    expect(diag.exchAlCmolKg).toBeNull();
    expect(diag.limeRequirementTHa).toBeNull();
    expect(diag.summary.en).toContain('not a valid reading');
    expect(diag.summary.vi).toContain('không phải số đo hợp lệ');
    expect(diag.recommendations.some((r) => r.en.includes('t/ha'))).toBe(false);
  });

  it('gives no dose when the bulk density of the field is missing', () => {
    const diag = aluminiumRisk(without(inputFor('daklak-coffee'), 'bulk_density'), { exchAlCmolKg: 2 });
    expect(diag.status).toBe('potential_risk');
    expect(diag.bulkDensityTM3).toBeNull();
    expect(diag.limeRequirementTHa).toBeNull();
    expect(diag.summary.en).toContain('Measure first');
    expect(diag.summary.vi).toContain('Cần đo trước');
    expect(diag.requiredMeasurements.some((m) => m.en.includes('Bulk density'))).toBe(true);
    expect(diag.recommendations.some((r) => /\d t\/ha/.test(r.en))).toBe(false);
  });

  it('does not depend on the CEC of the field at all', () => {
    const input = inputFor('daklak-coffee');
    const a = aluminiumRisk(input, { exchAlCmolKg: 2, exchBasesCmolKg: 3 });
    const b = aluminiumRisk(without(input, 'cec_cmolkg'), { exchAlCmolKg: 2, exchBasesCmolKg: 3 });
    expect(b).toEqual(a);
  });
});
