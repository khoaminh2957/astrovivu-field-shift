import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getCrop } from '@/core/crops';
import { getSampleParcel } from '@/data/samples';
import { GYPSUM_G_PER_CMOLC, soilMassTHa } from './mass';
import { espFromSar, gypsumRequirementTHa, GYPSUM_FIELD_FACTOR, leachingFractionFao29, leachingRequirement, salinityClass, SODIC_ESP_PCT, TARGET_ESP_PCT } from './salinity';

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

/** The same field with some soil facts taken out of the telemetry, as if the layer had no value there. */
function without(input: ModelInput, ...keys: string[]): ModelInput {
  const telemetry = structuredClone(input.telemetry);
  for (const b of Object.values(telemetry.branches)) {
    if (b) b.facts = b.facts.filter((f) => !keys.includes(f.key));
  }
  return { ...input, telemetry };
}

describe('leaching requirement (FAO Irrigation and Drainage Paper 29 Rev. 1, section 2.4.2, equation 9)', () => {
  it('reproduces Example 3 of FAO 29 (maize, river water of ECw 1.2 dS/m) within rounding', () => {
    // Example 3, "Leaching requirement calculation": maize, ECw = 1.2 dS/m, ET = 800 mm/season.
    // ECe = 2.5 dS/m (Table 4, maize at 90 percent yield potential): LR = 1.2 / (5 x 2.5 - 1.2) = 0.106, printed 0.10.
    // ECe = 1.7 dS/m (Table 4, maize at 100 percent yield potential): LR = 1.2 / (5 x 1.7 - 1.2) = 0.164, printed 0.16.
    expect(Math.abs(leachingFractionFao29(1.2, 2.5)! - 0.1)).toBeLessThan(0.01);
    expect(Math.abs(leachingFractionFao29(1.2, 1.7)! - 0.16)).toBeLessThan(0.01);
    // Equation (7), AW = ET / (1 - LR): the example prints 890 mm for 800 mm of crop demand with LR 0.10.
    expect(Math.round(800 / (1 - 0.1) / 10) * 10).toBe(890);

    // The same numbers through the public function, the grower giving the ECe of FAO 29 Table 4.
    const maize: ModelInput = { ...inputFor('iowa-corn-soy'), cropId: 'zea-mays' };
    const at90 = leachingRequirement(maize, { waterEcDsM: 1.2, cropThresholdEcDsM: 2.5 });
    expect(at90.leaching.leachingFraction).toBe(0.106);
    expect(at90.leaching.leachingPercent).toBe(10.6);
    // 100 / (1 - 0.106) = 112 mm per 100 mm: 895 mm for the 800 mm of the example (890 with LR rounded to 0.10).
    expect(at90.leaching.appliedMmPer100MmEt).toBe(112);
    const at100 = leachingRequirement(maize, { waterEcDsM: 1.2, cropThresholdEcDsM: 1.7 });
    expect(at100.leaching.leachingFraction).toBe(0.164);

    expect(at90.leaching.method).toContain('FAO Irrigation and Drainage Paper 29');
    expect(at90.leaching.method).toContain('section 2.4.2, equation (9)');
    expect(at90.leaching.note.en).toContain('equation (9)');
    expect(at90.leaching.note.vi).toContain('phương trình 9');
  });

  it('without a threshold from the grower, uses the one of the crop\'s salinity class, as the scoring model does', () => {
    // Maize is in class "low" of the catalogue: 2.0 dS/m in MAAS_HOFFMAN_PARAMS. LR = 1.2 / (5 x 2.0 - 1.2) = 0.136.
    const maize: ModelInput = { ...inputFor('iowa-corn-soy'), cropId: 'zea-mays' };
    expect(getCrop('zea-mays')!.req.salinity!.opt).toBe('low');
    const d = leachingRequirement(maize, { waterEcDsM: 1.2 });
    expect(d.leaching.cropThresholdEcDsM).toBe(2);
    expect(d.leaching.leachingFraction).toBe(0.136);
    expect(d.leaching.note.en).toContain('salinity class');
  });

  it('gives no threshold and no leaching requirement for a crop without a salinity class', () => {
    const crop = getCrop('tagetes-erecta')!;
    expect(crop.req.salinity).toBeUndefined();
    const d = leachingRequirement({ ...inputFor('iowa-corn-soy'), cropId: crop.id }, { waterEcDsM: 1.2 });
    expect(d.leaching.cropThresholdEcDsM).toBeNull();
    expect(d.leaching.leachingFraction).toBeNull();
    expect(d.leaching.leachingPercent).toBeNull();
    expect(d.leaching.appliedMmPer100MmEt).toBeNull();
    expect(d.leaching.note.en).toContain('No salinity threshold is known');
    expect(d.leaching.note.vi).toContain('Chưa biết ngưỡng chịu mặn');
    expect(d.recommendations.some((r) => /\d+ mm/.test(r.en))).toBe(false);
  });

  it('gives no depth of water when the equation has no usable answer', () => {
    // 5 x ECe - ECw <= 0, and LR >= 1 (ECw 5, ECe 1.5: 5 / 2.5 = 2).
    expect(leachingFractionFao29(7, 1.3)).toBeNull();
    expect(leachingFractionFao29(6.5, 1.3)).toBeNull();
    expect(leachingFractionFao29(5, 1.5)).toBeNull();
    for (const [waterEcDsM, cropThresholdEcDsM] of [[7, 1.3], [5, 1.5]]) {
      const d = leachingRequirement(inputFor('nevada-alfalfa'), { waterEcDsM, cropThresholdEcDsM });
      expect(d.leaching.leachingFraction).toBeNull();
      expect(d.leaching.appliedMmPer100MmEt).toBeNull();
      expect(d.leaching.note.en).toContain('too saline');
      expect(d.leaching.note.en).not.toMatch(/\d+ mm for each/);
      expect(d.recommendations.some((r) => /mm of irrigation water/.test(r.en))).toBe(false);
      expect(d.summary.en).toContain('Leaching requirement not computed');
    }
  });

  it('cantho-rice with default values: returns no numbers and provides list of required measurements', () => {
    const diag = leachingRequirement(inputFor('cantho-rice', false));

    expect(diag.soilEcDsM).toBeNull();
    expect(diag.waterEcDsM).toBeNull();
    expect(diag.salinityStatus).toBe('unknown');
    expect(diag.sodicityStatus).toBe('unknown');
    expect(diag.leaching.leachingFraction).toBeNull();
    expect(diag.gypsum.rateRangeTHa).toBeNull();

    const hasWaterEc = diag.requiredMeasurements.some((m) => m.en.includes('ECw'));
    const hasSoilEc = diag.requiredMeasurements.some((m) => m.en.includes('ECe'));
    expect(hasWaterEc).toBe(true);
    expect(hasSoilEc).toBe(true);
  });

  it('nevada-alfalfa without irrigation water EC: leaching fraction is null and explanation is non-empty', () => {
    const diag = leachingRequirement(inputFor('nevada-alfalfa'));

    expect(diag.soilEcDsM).toBe(1.0);
    expect(diag.waterEcDsM).toBeNull();
    expect(diag.leaching.leachingFraction).toBeNull();
    expect(diag.leaching.note.en.length).toBeGreaterThan(10);
    expect(diag.leaching.note.vi.length).toBeGreaterThan(10);
    expect(diag.requiredMeasurements.some((m) => m.en.includes('ECw'))).toBe(true);
  });
});

describe('salinity and sodicity classes (FAO Soils Bulletin 39)', () => {
  it('classes the soil by Table 10: 0-2, 2-4, 4-8 and above 8 dS/m', () => {
    expect(salinityClass(null)).toBe('unknown');
    expect(salinityClass(0)).toBe('non_saline');
    expect(salinityClass(2)).toBe('non_saline');
    expect(salinityClass(2.1)).toBe('slightly_saline');
    expect(salinityClass(4)).toBe('slightly_saline');
    expect(salinityClass(4.1)).toBe('moderately_saline');
    expect(salinityClass(8)).toBe('moderately_saline');
    expect(salinityClass(8.1)).toBe('severely_saline');
  });

  it('calls a soil sodic above ESP 15 (section 4.1), and gives no gypsum dose below that', () => {
    expect(SODIC_ESP_PCT).toBe(15);
    const below = leachingRequirement(inputFor('nevada-alfalfa'), { espPct: 12 });
    expect(below.sodicityStatus).toBe('non_sodic');
    expect(below.gypsum.rateRangeTHa).toBeNull();
    expect(leachingRequirement(inputFor('nevada-alfalfa'), { espPct: 15 }).sodicityStatus).toBe('non_sodic');
    expect(leachingRequirement(inputFor('nevada-alfalfa'), { espPct: 15.1 }).sodicityStatus).toBe('sodic');
  });

  it('computes ESP from SAR with the equation of USDA Handbook 60, p. 26, and says it is not a measured ESP', () => {
    // SAR 20: ratio = -0.0126 + 0.01475 x 20 = 0.2824; ESP = 100 x 0.2824 / 1.2824 = 22.0.
    expect(espFromSar(20)).toBe(22);
    const d = leachingRequirement(inputFor('nevada-alfalfa'), { sar: 20 });
    expect(d.espPct).toBe(22);
    expect(d.sodicityStatus).toBe('sodic');
    expect(d.caveats.some((c) => c.en.includes('computed from SAR 20') && c.en.includes('p. 26'))).toBe(true);
  });
});

describe('gypsum requirement (FAO Soils Bulletin 39 section 4.4.1 iii; USDA Handbook 60 Table 6 and pp. 49-50)', () => {
  it('takes 0.86 g of gypsum per cmol(+) of sodium and the mass of soil of the layer', () => {
    expect(GYPSUM_G_PER_CMOLC).toBe(0.86);
    // FAO 39: half a cmol of calcium per kg of soil in 2.24 x 10^6 kg of soil per hectare (the 15 cm layer) is 1.93 t/ha.
    expect((GYPSUM_G_PER_CMOLC * 2240) / 1000).toBeCloseTo(1.93, 2);
    // 1 ha to 0.2 m at 1.43 t/m3 holds 10,000 x 0.2 x 1.43 = 2,860 t of soil.
    expect(soilMassTHa(0.2, 1.43)).toBeCloseTo(2860, 6);
    // HB 60 p. 49: 3 meq of sodium per 100 g in an acre-foot (4,000,000 lb = 2,000 short tons) takes 5.2 tons of gypsum.
    expect((3 * GYPSUM_G_PER_CMOLC * 2000) / 1000).toBeCloseTo(5.2, 1);
  });

  it('hand-computed case: CEC 9, ESP 22 to 10, bulk density 1.43, 0.2 m gives 2.66 t/ha, and 2.7-3.3 t/ha with the factor 1.25', () => {
    // 0.086 x 0.2 m x 1.43 t/m3 x 9 cmol(+)/kg x 12 points of ESP = 2.656 t/ha.
    expect(gypsumRequirementTHa(9, 22, 10, 1.43, 0.2)).toBeCloseTo(2.66, 2);
    expect(GYPSUM_FIELD_FACTOR).toBe(1.25);
    expect(TARGET_ESP_PCT).toBe(10);

    // The Nevada sample carries exactly these readings: CEC 9.0 cmol(+)/kg (SSURGO), bulk density 1.43 g/cm3 (SoilGrids).
    const diag = leachingRequirement(inputFor('nevada-alfalfa'), { waterEcDsM: 1.2, espPct: 22 });
    expect(diag.gypsum.cecCmolKg).toBe(9);
    expect(diag.gypsum.bulkDensityTM3).toBe(1.43);
    expect(diag.gypsum.depthM).toBe(0.2);
    expect(diag.sodicityStatus).toBe('sodic');
    // 2.656 -> 2.7; 2.656 x 1.25 = 3.32 -> 3.3. (The formula without depth and bulk density gave 10.2-12.1.)
    expect(diag.gypsum.rateRangeTHa).toEqual([2.7, 3.3]);

    // The note states the depth, the bulk density and both sources.
    expect(diag.gypsum.note.en).toContain('depth 0.2 m');
    expect(diag.gypsum.note.en).toContain('bulk density 1.43 t/m3');
    expect(diag.gypsum.note.en).toContain('FAO Soils Bulletin 39, section 4.4.1');
    expect(diag.gypsum.note.en).toContain('Handbook 60, pp. 49-50');
    expect(diag.gypsum.note.vi).toContain('độ sâu 0.2 m');
    expect(diag.gypsum.method).toContain('USDA Agriculture Handbook 60 (Richards, 1954)');
    expect(diag.caveats.some((c) => c.en.toLowerCase().includes('laboratory testing'))).toBe(true);
    expect(diag.caveats.some((c) => c.vi.includes('cần kiểm tra tại chỗ'))).toBe(true);
    expect(diag.needsLocalReview).toBe(true);
  });

  it('scales with the bulk density of the field instead of a fixed mass of soil', () => {
    const light = gypsumRequirementTHa(9, 22, 10, 1.0, 0.2);
    const dense = gypsumRequirementTHa(9, 22, 10, 1.6, 0.2);
    expect(dense / light).toBeCloseTo(1.6, 6);
  });

  it('gives no dose and asks for the measurement when CEC is missing: no default CEC', () => {
    const diag = leachingRequirement(without(inputFor('nevada-alfalfa'), 'cec_cmolkg'), { espPct: 22 });
    expect(diag.sodicityStatus).toBe('sodic');
    expect(diag.gypsum.cecCmolKg).toBeNull();
    expect(diag.gypsum.rateRangeTHa).toBeNull();
    expect(diag.gypsum.note.en).toContain('Measure first');
    expect(diag.gypsum.note.vi).toContain('Cần đo trước');
    expect(diag.requiredMeasurements.some((m) => m.en.includes('CEC'))).toBe(true);
    expect(diag.recommendations.some((r) => r.en.includes('t/ha'))).toBe(false);
    expect(diag.summary.en).not.toContain('t/ha');
  });

  it('gives no dose and asks for the measurement when bulk density is missing', () => {
    const diag = leachingRequirement(without(inputFor('nevada-alfalfa'), 'bulk_density'), { espPct: 22 });
    expect(diag.gypsum.bulkDensityTM3).toBeNull();
    expect(diag.gypsum.rateRangeTHa).toBeNull();
    expect(diag.requiredMeasurements.some((m) => m.en.includes('Bulk density'))).toBe(true);
    expect(diag.recommendations.some((r) => r.en.includes('t/ha'))).toBe(false);
  });

  it('treats a negative reading as no reading', () => {
    const diag = leachingRequirement(inputFor('nevada-alfalfa'), { waterEcDsM: -1, espPct: -5 });
    expect(diag.waterEcDsM).toBeNull();
    expect(diag.espPct).toBeNull();
    expect(diag.leaching.leachingFraction).toBeNull();
    expect(diag.gypsum.rateRangeTHa).toBeNull();
  });
});

describe('Vietnamese text of the salinity result', () => {
  it('carries no English status word', () => {
    const cases = [
      leachingRequirement(inputFor('cantho-rice', false)),
      leachingRequirement(inputFor('nevada-alfalfa'), { waterEcDsM: 1.2, espPct: 22 }),
      leachingRequirement({ ...inputFor('nevada-alfalfa'), groundTruth: { ecDsM: 9 } }, { waterEcDsM: 1.2, espPct: 5 }),
    ];
    for (const d of cases) {
      const vi = [d.summary.vi, d.salinityLabel.vi, d.sodicityLabel.vi, d.leaching.note.vi, d.gypsum.note.vi, ...d.recommendations.map((r) => r.vi), ...d.caveats.map((c) => c.vi)].join(' ');
      expect(vi).not.toMatch(/non_saline|slightly_saline|moderately_saline|severely_saline|non_sodic|unknown|_/);
      expect(d.summary.en).not.toMatch(/_/);
    }
  });
});
