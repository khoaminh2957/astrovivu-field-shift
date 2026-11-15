import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { aluminiumRisk } from './aluminium';

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

describe('Aluminium toxicity & exchangeable Al lime requirements (Issue #46 / S5)', () => {
  it('daklak-coffee without measurement returns status unknown/potential_risk and specifies required test', () => {
    const input = inputFor('daklak-coffee', false);
    const diag = aluminiumRisk(input);

    expect(diag.exchAlCmolKg).toBeNull();
    expect(diag.limeRequirementTHa).toBeNull();
    // Issue #46 requirement: status is strictly 'unknown' when unmeasured
    expect(diag.status).toBe('unknown');
    expect(diag.recommendations.length).toBeGreaterThan(0);
    // Explicitly specifies measuring exchangeable Al in 1M KCl
    expect(diag.recommendations[0].en).toContain('1M KCl');
    expect(diag.recommendations[0].vi).toContain('1M KCl');
    expect(diag.summary.en && diag.summary.vi).toBeTruthy();
  });

  it('daklak-coffee with coffea-canephora explicitly states crop Al tolerance data is unavailable', () => {
    const input = inputFor('daklak-coffee', true);
    expect(input.cropId).toBe('coffea-canephora');

    const diag = aluminiumRisk(input);
    expect(diag.cropTolerance.hasData).toBe(false);
    expect(diag.cropTolerance.optMaxPct).toBeNull();
    expect(diag.cropTolerance.absMaxPct).toBeNull();
    // States that no data is available and not inferred from other crops
    expect(diag.cropTolerance.note.en).toContain('No published aluminum saturation tolerance threshold');
    expect(diag.cropTolerance.note.vi).toContain('Không tự suy diễn từ cây khác');
  });

  it('calculates Kamprath lime requirement range when exchangeable Al is provided', () => {
    const input: ModelInput = { ...inputFor('daklak-coffee', true), cropId: 'manihot-esculenta' };

    // Test value: 2.5 cmol(+)/kg exchangeable Al (typical acid tropical basalt topsoil)
    const testExchAl = 2.5;
    const diag = aluminiumRisk(input, { exchAlCmolKg: testExchAl, ececCmolKg: 4.0 });

    expect(diag.exchAlCmolKg).toBe(2.5);
    expect(diag.limeRequirementTHa).not.toBeNull();

    const [lo, hi] = diag.limeRequirementTHa!;
    expect(lo).toBeLessThanOrEqual(hi);

    // Kamprath factor f: 1.5 * 2.5 = 3.75 -> 3.8, 2.0 * 2.5 = 5.0
    expect(lo).toBeCloseTo(3.8, 0.1);
    expect(hi).toBeCloseTo(5.0, 0.1);

    // Cites literature source
    expect(diag.method).toContain('Kamprath (1970)');

    // Includes on-site review caveat
    const hasCaveat = diag.caveats.some(
      (c) =>
        c.en.toLowerCase().includes('on-site verification') ||
        c.vi.toLowerCase().includes('kiểm tra tại chỗ'),
    );
    expect(hasCaveat).toBe(true);
    expect(diag.needsLocalReview).toBe(true);
  });

  it('crop with known Al tolerance (e.g. cassava / manihot-esculenta) populates thresholds', () => {
    const base = inputFor('daklak-coffee', true);
    const cassavaInput: ModelInput = {
      ...base,
      cropId: 'manihot-esculenta',
    };

    const diag = aluminiumRisk(cassavaInput, { exchAlCmolKg: 1.5, ececCmolKg: 3 });
    expect(diag.cropTolerance.hasData).toBe(true);
    expect(diag.cropTolerance.absMaxPct).toBe(80);
    expect(diag.cropTolerance.optMaxPct).toBe(60);
    expect(diag.cropTolerance.note.en).toContain('Cochrane et al. 1980');
  });
});

