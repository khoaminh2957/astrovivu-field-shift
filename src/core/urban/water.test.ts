import { describe, expect, it } from 'vitest';
import type { CropProfile, UrbanClimate, UrbanSite } from '@/contracts';
import { getCrop, listCrops } from '@/core/crops';
import { hargreaves } from '@/core/scoring';
import { canopyFromPot, potWater, recommendUrban } from './index';

const HCMC_CLIMATE: UrbanClimate = {
  location: [106.7, 10.78],
  months: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    tMean: 28,
    tMin: 24,
    tMax: 33,
    rainMm: 150,
    par: 8.5,
    rh: 75,
  })),
  sourceIds: ['nasa-power'],
};

describe('src/core/urban/water (D6, #19)', () => {
  it('matches the arithmetic benchmark: kc={ini:0.7, mid:1.0}, ET0=150 mm in a 30-day month (5 mm/d), 30 cm pot (0.0707 m²) -> litresMin=0.2, litresMax=0.4', () => {
    const canopyM2 = canopyFromPot(30);
    expect(canopyM2).toBeCloseTo(Math.PI * 0.15 * 0.15, 6);
    expect(canopyM2).toBeCloseTo(0.0707, 4);

    const base = getCrop('lycopersicon-esculentum')!;
    const crop: CropProfile = {
      ...base,
      water: {
        ...base.water!,
        kc: { ini: 0.7, mid: 1.0, end: 0.8 },
      },
    };
    const aprilClimate: UrbanClimate = {
      location: [106.7, 10.78],
      months: [{ month: 4, tMean: 29, tMin: 25, tMax: 34, rainMm: 50, et0Mm: 150, par: 9, rh: 70 }],
      sourceIds: ['era5'],
    };

    const res = potWater(crop, aprilClimate, { canopyM2 });
    expect(res).toEqual([
      {
        month: 4,
        et0MmDay: 5,
        et0From: 'era5',
        litresMin: 0.2,
        litresMax: 0.4,
      },
    ]);
  });

  it('uses hargreaves when et0Mm is absent and era5 when et0Mm is present', () => {
    const tomato = getCrop('lycopersicon-esculentum')!;
    const canopyM2 = canopyFromPot(30);

    const hargreavesRes = potWater(tomato, HCMC_CLIMATE, { canopyM2 });
    expect(hargreavesRes).toHaveLength(12);
    expect(hargreavesRes.every((m) => m.et0From === 'hargreaves')).toBe(true);
    // January mid-month doy = 16
    const expectedJanEt0 = Math.round(hargreaves(28, 33, 24, 10.78, 16) * 100) / 100;
    expect(hargreavesRes[0].et0MmDay).toBe(expectedJanEt0);

    const era5Climate: UrbanClimate = {
      ...HCMC_CLIMATE,
      months: HCMC_CLIMATE.months.map((m) => ({ ...m, et0Mm: 120 })),
    };
    const era5Res = potWater(tomato, era5Climate, { canopyM2 });
    expect(era5Res.every((m) => m.et0From === 'era5')).toBe(true);
    // April has 30 days -> 120 / 30 = 4 mm/day
    expect(era5Res[3].et0MmDay).toBe(4);
  });

  it('scales proportionally with canopyM2 and guarantees litresMin <= litresMax across all 32 urban crops and 12 months', () => {
    const urbanCrops = listCrops().filter((c) => c.urban?.suitable);
    expect(urbanCrops).toHaveLength(32);

    for (const crop of urbanCrops) {
      const small = potWater(crop, HCMC_CLIMATE, { canopyM2: 0.1 });
      const large = potWater(crop, HCMC_CLIMATE, { canopyM2: 1.0 });
      expect(small).toHaveLength(12);
      for (let i = 0; i < 12; i++) {
        expect(small[i].litresMin, `${crop.id} month ${i + 1}`).toBeLessThanOrEqual(small[i].litresMax);
        expect(large[i].litresMin, `${crop.id} month ${i + 1}`).toBeLessThanOrEqual(large[i].litresMax);
        expect(large[i].litresMax).toBeGreaterThanOrEqual(small[i].litresMax);
      }
    }
  });

  it('returns an empty array when a crop has no water model (never assumes a fallback Kc)', () => {
    const base = getCrop('lycopersicon-esculentum')!;
    const withoutWater: CropProfile = { ...base, water: undefined };
    expect(potWater(withoutWater, HCMC_CLIMATE, { canopyM2: 0.1 })).toEqual([]);
  });

  it('recommendUrban without potDiameterCm returns identical results, and with potDiameterCm populates waterLitres and waterBasis (flagging water-model-assumed)', () => {
    const siteWithoutPot: UrbanSite = {
      location: [106.7, 10.78],
      light: 'full',
      space: 'balcony',
    };
    const withoutPot = recommendUrban(siteWithoutPot, HCMC_CLIMATE, ['herbs', 'vegetables'], 4);
    expect(withoutPot.every((r) => r.care.waterLitres === undefined && r.care.waterBasis === undefined)).toBe(true);

    const withPot = recommendUrban({ ...siteWithoutPot, potDiameterCm: 30 }, HCMC_CLIMATE, ['herbs', 'vegetables'], 4);
    expect(withPot.length).toBe(withoutPot.length);
    for (let i = 0; i < withPot.length; i++) {
      expect(withPot[i].cropId).toBe(withoutPot[i].cropId);
      expect(withPot[i].score).toBe(withoutPot[i].score);
      expect(withPot[i].care.water).toEqual(withoutPot[i].care.water);
      expect(withPot[i].care.waterLitres).toHaveLength(12);
      expect(withPot[i].care.waterBasis?.en).toContain('30 cm round pot');
      expect(withPot[i].care.waterBasis?.vi).toContain('Chưa trừ mưa');
    }

    const assumedPick = withPot.find((p) => getCrop(p.cropId)?.flags?.includes('water-model-assumed'));
    expect(assumedPick).toBeDefined();
    expect(assumedPick!.care.waterBasis!.en).toContain('water-model-assumed');
    expect(assumedPick!.care.waterBasis!.vi).toContain('hệ số mượn của cây khác');
  });
});
