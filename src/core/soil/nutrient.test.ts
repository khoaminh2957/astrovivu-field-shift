import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { cropNutrientRemoval, NUTRIENT_REMOVAL_COEFFICIENTS } from './nutrient';

const load = (id: string): FieldTelemetry =>
  JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, cropId?: string): ModelInput {
  const p = getSampleParcel(id)!;
  return {
    parcel: p,
    telemetry: load(id),
    cropId: cropId ?? p.defaultCropId,
    groundTruth: { ...(p.defaultGroundTruth ?? {}) },
    priorities: ['profit', 'soil', 'water'],
    today: '2026-11-14',
  };
}

describe('Crop N, P, K nutrient removal budget (Issue #49 / S8)', () => {
  it('computes nutrient removal for Iowa maize at 8.0 t/ha target yield', () => {
    const input = inputFor('iowa-corn-soy', 'zea-mays');
    const budget = cropNutrientRemoval(input, { targetYieldTHa: 8.0 });

    expect(budget.targetYieldTHa).toBe(8.0);
    // 8 t * [21, 25] kg N/t = [168, 200] kg N/ha
    expect(budget.nitrogen.totalKgHa).toEqual([168, 200]);
    // 8 t * [8, 10] kg P2O5/t = [64, 80] kg P2O5/ha
    expect(budget.phosphateP2O5.totalKgHa).toEqual([64, 80]);
    // 8 t * [18, 24] kg K2O/t = [144, 192] kg K2O/ha
    expect(budget.potashK2O.totalKgHa).toEqual([144, 192]);

    // Topsoil nitrogen stock exists from SoilGrids/SSURGO
    expect(budget.soilNitrogenStockKgHa).toBeGreaterThan(1000);
    expect(budget.seasonalEstimatedMineralizedNKgHa).not.toBeNull();
    expect(budget.seasonalEstimatedMineralizedNKgHa![0]).toBeLessThan(budget.seasonalEstimatedMineralizedNKgHa![1]);

    // Citations & caveats
    expect(budget.citation).toContain('IPNI');
    expect(budget.caveats.length).toBeGreaterThanOrEqual(2);
    expect(budget.caveats.some((c) => c.en.includes('Olsen P') && c.vi.includes('phân tích đất'))).toBe(true);
  });

  it('computes nutrient removal for Can Tho paddy rice at 6.0 t/ha default yield', () => {
    const input = inputFor('cantho-rice', 'oryza-sativa');
    const budget = cropNutrientRemoval(input);

    expect(budget.targetYieldTHa).toBe(6.0);
    // 6 t * [16, 20] = [96, 120] kg N/ha
    expect(budget.nitrogen.totalKgHa).toEqual([96, 120]);
    // 6 t * [7, 9] = [42, 54] kg P2O5/ha
    expect(budget.phosphateP2O5.totalKgHa).toEqual([42, 54]);
    // 6 t * [20, 28] = [120, 168] kg K2O/ha
    expect(budget.potashK2O.totalKgHa).toEqual([120, 168]);

    // Straw residue caveat
    expect(budget.caveats.some((c) => c.en.includes('residue') && c.vi.includes('rơm rạ'))).toBe(true);
  });

  it('includes legume atmospheric N fixation notice for soybean', () => {
    const input = inputFor('iowa-corn-soy', 'glycine-max');
    const budget = cropNutrientRemoval(input, { targetYieldTHa: 3.5 });

    expect(budget.targetYieldTHa).toBe(3.5);
    // 3.5 * [55, 65] = [192.5, 227.5]
    expect(budget.nitrogen.totalKgHa).toEqual([192.5, 227.5]);
    expect(budget.nitrogen.note?.en).toContain('fixation');
    expect(budget.nitrogen.note?.vi).toContain('cố định');
    expect(budget.caveats.some((c) => c.en.includes('rhizobia'))).toBe(true);
  });

  it('computes coffee nutrient removal for Dak Lak at 2.5 t/ha target yield', () => {
    const input = inputFor('daklak-coffee', 'coffea-canephora');
    const budget = cropNutrientRemoval(input, { targetYieldTHa: 2.5 });

    expect(budget.targetYieldTHa).toBe(2.5);
    // 2.5 * [30, 40] = [75, 100]
    expect(budget.nitrogen.totalKgHa).toEqual([75, 100]);
    // 2.5 * [6, 8] = [15, 20]
    expect(budget.phosphateP2O5.totalKgHa).toEqual([15, 20]);
    // 2.5 * [35, 50] = [87.5, 125]
    expect(budget.potashK2O.totalKgHa).toEqual([87.5, 125]);
  });

  it('ensures every user-facing string has both English and Vietnamese translations', () => {
    const input = inputFor('cantho-rice');
    const budget = cropNutrientRemoval(input);

    expect(budget.cropName.en && budget.cropName.vi).toBeTruthy();
    for (const caveat of budget.caveats) {
      expect(caveat.en).toBeTruthy();
      expect(caveat.vi).toBeTruthy();
    }
    if (budget.nitrogen.note) {
      expect(budget.nitrogen.note.en).toBeTruthy();
      expect(budget.nitrogen.note.vi).toBeTruthy();
    }
  });
});
