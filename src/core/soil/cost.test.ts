import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, GroundTruth, ModelInput } from '@/contracts';
import { phPlan } from '@/core/advisory/actions';
import { getSampleParcel } from '@/data/samples';
import { amendmentCost, type AmendmentPriceMap } from './cost';
import { diagnoseSoil } from './diagnosis';
import { buildSoilPlan } from './plan';

const load = (id: string): FieldTelemetry =>
  JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function demo(id: string, own: Partial<GroundTruth> = {}, cropId?: string): ModelInput {
  const p = getSampleParcel(id)!;
  return {
    parcel: p,
    telemetry: load(id),
    cropId: cropId ?? p.defaultCropId,
    groundTruth: { ...(p.defaultGroundTruth ?? {}), ...own },
    priorities: ['profit', 'soil', 'water'],
    today: '2026-11-14',
  };
}

describe('amendmentCost (S12 #53)', () => {
  it('computes cost range equal to [minDose * price * areaHa, maxDose * price * areaHa] using mock test prices', () => {
    const input = demo('daklak-coffee', { ph: 4.5 });
    const diag = diagnoseSoil(input);
    const ph = phPlan(input);
    const plan = buildSoilPlan(diag, input, ph);

    const phItem = plan.items.find((i) => i.metric === 'ph');
    expect(phItem?.rateRange).not.toBeNull();
    const [minDose, maxDose] = [phItem!.rateRange!.min, phItem!.rateRange!.max];

    // Mock test price only (synthetic figure for unit testing, not a real market dataset).
    const testPrices: AmendmentPriceMap = {
      lime: {
        usdPerT: 55,
        source: 'Test fixture price (synthetic, unit test only)',
        year: 2025,
      },
    };
    const areaHa = 2.5;

    const res = amendmentCost(plan, testPrices, areaHa);
    expect(res.items).toHaveLength(1);
    const item = res.items[0]!;
    expect(item.material).toBe('lime');
    expect(item.costUsd).toEqual([
      Math.round(minDose * 55 * areaHa * 100) / 100,
      Math.round(maxDose * 55 * areaHa * 100) / 100,
    ]);
    expect(item.costPerHaUsd).toEqual([
      Math.round(minDose * 55 * 100) / 100,
      Math.round(maxDose * 55 * 100) / 100,
    ]);
    expect(item.source).toBe('Test fixture price (synthetic, unit test only)');
    expect(item.year).toBe(2025);
    expect(item.paybackSeasons).toBeNull();
  });

  it('returns null cost with a bilingual reason when price is missing, and null payback when marginDelta is omitted', () => {
    const input = demo('daklak-coffee', { ph: 4.5 });
    const plan = buildSoilPlan(diagnoseSoil(input), input, phPlan(input));

    const noPriceRes = amendmentCost(plan, {}, 2.0);
    expect(noPriceRes.items).toHaveLength(1);
    expect(noPriceRes.items[0]!.costUsd).toBeNull();
    expect(noPriceRes.items[0]!.paybackSeasons).toBeNull();
    expect(noPriceRes.items[0]!.source).toBeNull();
    expect(noPriceRes.items[0]!.year).toBeNull();
    expect(noPriceRes.items[0]!.reason.en).toContain('No sourced unit price');
    expect(noPriceRes.items[0]!.reason.vi).toContain('Chưa có đơn giá có nguồn');
    expect(noPriceRes.totalCostUsd).toBeNull();
  });

  it('computes paybackSeasons range when marginDeltaUsdPerHa is provided, and marks it as a model estimate', () => {
    const input = demo('daklak-coffee', { ph: 4.5 });
    const plan = buildSoilPlan(diagnoseSoil(input), input, phPlan(input));

    // Mock test price and mock margin delta for unit test verification only.
    const testPrices: AmendmentPriceMap = {
      lime: {
        usdPerT: 50,
        source: 'Synthetic test price',
        year: 2024,
      },
    };
    const res = amendmentCost(plan, testPrices, 1.0, [100, 200]);
    const item = res.items[0]!;
    expect(item.costPerHaUsd).not.toBeNull();
    expect(item.paybackSeasons).toEqual([
      Math.round((item.costPerHaUsd![0] / 200) * 10) / 10,
      Math.round((item.costPerHaUsd![1] / 100) * 10) / 10,
    ]);
    expect(item.reason.en).toContain('model estimate');
    expect(item.reason.vi).toContain('ước tính từ mô hình');
    expect(item.caveats.some((c) => c.vi.includes('vận chuyển'))).toBe(true);
  });

  it('holds no hardcoded price numbers in src/core/soil/cost.ts', () => {
    const src = readFileSync('src/core/soil/cost.ts', 'utf8');
    expect(src).not.toMatch(/usdPerT\s*[:=]\s*\d+/);
  });
});
