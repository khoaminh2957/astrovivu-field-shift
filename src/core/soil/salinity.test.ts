import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { leachingRequirement } from './salinity';

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

describe('Salinity leaching requirement & gypsum remediation (Issue #47 / S6)', () => {
  it('reproduces FAO Irrigation and Drainage Paper 29 (p. 21, Eq. 4, Example 2) calculation within rounding', () => {
    // In FAO Paper 29, p. 21 Example 2:
    // Crop tolerance ECe threshold = 4.0 dS/m, Irrigation water ECw = 2.0 dS/m
    // Formula: LR = ECw / (5 * ECe - ECw) = 2.0 / (5 * 4.0 - 2.0) = 2.0 / 18.0 = 0.111 (11.1%)
    const base = inputFor('iowa-corn-soy', true);

    const input: ModelInput = {
      ...base,
      cropId: 'glycine-max',
    };

    // Exactly reproduces FAO 29 Example 2 (p. 21) with ECe = 4.0 dS/m and ECw = 2.0 dS/m
    const diag = leachingRequirement(input, { waterEcDsM: 2.0, cropThresholdEcDsM: 4.0 });

    expect(diag.leaching.leachingFraction).not.toBeNull();
    expect(diag.leaching.leachingFraction).toBeCloseTo(0.111, 0.005);
    expect(diag.leaching.leachingPercent).toBeCloseTo(11.1, 0.5);
    expect(diag.leaching.method).toContain('FAO Irrigation and Drainage Paper 29 (Ayers & Westcot, 1985), Eq. 4, p. 21');
  });

  it('cantho-rice with default values: returns no numbers and provides list of required measurements', () => {
    const input = inputFor('cantho-rice', false); // No ground truth override
    const diag = leachingRequirement(input);

    expect(diag.soilEcDsM).toBeNull();
    expect(diag.waterEcDsM).toBeNull();
    expect(diag.salinityStatus).toBe('unknown');
    expect(diag.leaching.leachingFraction).toBeNull();
    expect(diag.gypsum.rateRangeTHa).toBeNull();

    // Must return a non-empty list of diagnostic measurements
    expect(diag.requiredMeasurements.length).toBeGreaterThan(0);
    const hasWaterEc = diag.requiredMeasurements.some(
      (m) => m.en.includes('ECw') || m.en.includes('irrigation water'),
    );
    const hasSoilEc = diag.requiredMeasurements.some(
      (m) => m.en.includes('ECe') || m.en.includes('Soil electrical conductivity'),
    );
    expect(hasWaterEc).toBe(true);
    expect(hasSoilEc).toBe(true);
  });

  it('nevada-alfalfa without irrigation water EC: leaching fraction is null and explanation is non-empty', () => {
    const input = inputFor('nevada-alfalfa', true);
    // Soil EC is 1.0 in SSURGO, but water EC is not measured
    const diag = leachingRequirement(input);

    expect(diag.soilEcDsM).toBe(1.0);
    expect(diag.waterEcDsM).toBeNull();
    expect(diag.leaching.leachingFraction).toBeNull();
    expect(diag.leaching.note.en.length).toBeGreaterThan(10);
    expect(diag.leaching.note.vi.length).toBeGreaterThan(10);

    // Required measurements includes irrigation water EC
    expect(diag.requiredMeasurements.some((m) => m.en.includes('ECw'))).toBe(true);
  });

  it('calculates Gypsum Requirement range for sodic soil when ESP is provided (USDA Handbook 60)', () => {
    const input = inputFor('nevada-alfalfa', true);

    // Test values: waterEc = 1.2 dS/m, initial ESP = 22% (sodic), CEC = 9.0 meq/100g
    const diag = leachingRequirement(input, { waterEcDsM: 1.2, espPct: 22.0 });

    expect(diag.sodicityStatus).toBe('severely_sodic');
    expect(diag.gypsum.rateRangeTHa).not.toBeNull();

    const [lo, hi] = diag.gypsum.rateRangeTHa!;
    expect(lo).toBeLessThanOrEqual(hi);

    // Base GR = 0.086 * 9.0 * (22 - 10) = 0.086 * 9.0 * 12 = 9.288 t/ha
    // With F in [1.1, 1.3]: lo = 9.288 * 1.1 = 10.2, hi = 9.288 * 1.3 = 12.1 t/ha
    expect(lo).toBeCloseTo(10.2, 0.3);
    expect(hi).toBeCloseTo(12.1, 0.3);

    expect(diag.gypsum.method).toContain('USDA Agriculture Handbook 60 (Richards, 1954)');

    // Caveat for on-site review
    expect(diag.caveats.some((c) => c.en.toLowerCase().includes('laboratory testing'))).toBe(true);
    expect(diag.needsLocalReview).toBe(true);
  });
});

