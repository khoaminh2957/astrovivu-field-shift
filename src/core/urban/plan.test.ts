import { describe, expect, it } from 'vitest';
import type { UrbanSite } from '@/contracts';
import { getCrop, listUrbanCrops } from '@/core/crops';
import { diffDays } from '@/lib/time';
import { BERLIN, HO_CHI_MINH_CITY, PHOENIX } from './__fixtures__/cities';
import { MARGINAL_FIT, evaluateUrbanCrop, planBalcony, plantCanopyM2, potWater, recommendUrban, windowFit } from './index';

describe('planBalcony (D7)', () => {
  const hcmcSite: UrbanSite = {
    location: HO_CHI_MINH_CITY.location,
    light: 'full',
    space: 'balcony',
    areaM2: 3.0,
    facingDeg: 180,
  };

  it('keeps total beds areaM2 <= areaM2 and sets usedM2 equal to that sum', () => {
    const plan = planBalcony({
      site: hcmcSite,
      climate: HO_CHI_MINH_CITY,
      cropIds: ['ipomoea-aquatica', 'basella-alba', 'ocimum-basilicum'],
      areaM2: 3.0,
      start: '2026-11-01',
    });
    expect(plan.beds).toHaveLength(3);
    const sumBeds = Math.round(plan.beds.reduce((s, b) => s + b.areaM2, 0) * 10000) / 10000;
    expect(plan.usedM2).toBe(sumBeds);
    expect(plan.usedM2).toBeLessThanOrEqual(plan.areaM2);
    expect(plan.notes.length).toBeGreaterThan(0);
    for (const n of plan.notes) {
      expect(n.en.length).toBeGreaterThan(0);
      expect(n.vi.length).toBeGreaterThan(0);
    }
  });

  it('computes plant count as floor(shareM2 / (spacingCm / 100)^2) for a crop with known spacingCm', () => {
    const radish = getCrop('raphanus-sativus')!;
    const spacingCm = radish.urban?.spacingCm!;
    expect(spacingCm).toBeGreaterThan(0);
    const plantAreaM2 = (spacingCm / 100) * (spacingCm / 100);
    const areaM2 = 1.5;
    const expectedPlants = Math.floor((areaM2 + 1e-9) / plantAreaM2);

    const plan = planBalcony({
      site: { location: PHOENIX.location, light: 'full', space: 'balcony' },
      climate: PHOENIX,
      cropIds: ['raphanus-sativus'],
      areaM2,
      start: '2026-11-01',
    });
    expect(plan.beds).toHaveLength(1);
    expect(plan.beds[0].plants).toBe(expectedPlants);
    expect(plan.beds[0].areaM2).toBeCloseTo(expectedPlants * plantAreaM2, 4);
  });

  it('schedules evenly spaced firstHarvest dates for harvestType="once" crops with >= 2 batches and never sows in months with sowFit < MARGINAL_FIT', () => {
    // raphanus-sativus (daikon) and vigna-radiata / phaseolus-vulgaris / daucus-carota
    const carrot = listUrbanCrops().find((c) => c.id === 'daucus-carota')!;
    expect(carrot).toBeDefined();

    const plan = planBalcony({
      site: { location: BERLIN.location, light: 'full', space: 'balcony' },
      climate: BERLIN,
      cropIds: ['daucus-carota', 'raphanus-sativus'],
      areaM2: 2.0,
      start: '2026-01-15',
    });
    expect(plan.beds.length).toBe(2);

    for (const bed of plan.beds) {
      const crop = listUrbanCrops().find((c) => c.id === bed.cropId)!;
      const fits = Array.from({ length: 12 }, (_, i) => windowFit(crop, BERLIN, i + 1).fit);
      expect(bed.batches.length).toBeGreaterThanOrEqual(2);
      expect(bed.batches.reduce((s, b) => s + b.plants, 0)).toBe(bed.plants);

      const intervals: number[] = [];
      for (let i = 0; i < bed.batches.length; i++) {
        const b = bed.batches[i];
        const sowMonth = Number(b.sow.slice(5, 7));
        expect(fits[sowMonth - 1]).toBeGreaterThanOrEqual(MARGINAL_FIT);
        if (i > 0) {
          intervals.push(diffDays(b.firstHarvest, bed.batches[i - 1].firstHarvest));
        }
      }
      // All consecutive firstHarvest intervals are identical
      expect(new Set(intervals).size).toBe(1);
      expect(intervals[0]).toBeGreaterThanOrEqual(7);
    }
  });

  it('places crops missing spacingCm into unplaced with bilingual en and vi reasons', () => {
    // oryza-sativa is not an urban crop; and if we temporarily test a crop without spacingCm
    const target = getCrop('ipomoea-aquatica')!;
    const savedSpacing = target.urban!.spacingCm;
    try {
      delete target.urban!.spacingCm;
      const plan = planBalcony({
        site: hcmcSite,
        climate: HO_CHI_MINH_CITY,
        cropIds: ['ipomoea-aquatica', 'basella-alba'],
        areaM2: 2.0,
        start: '2026-11-01',
      });
      expect(plan.beds.map((b) => b.cropId)).toEqual(['basella-alba']);
      expect(plan.unplaced).toHaveLength(1);
      expect(plan.unplaced[0].cropId).toBe('ipomoea-aquatica');
      expect(plan.unplaced[0].reason.en).toContain('spacingCm');
      expect(plan.unplaced[0].reason.vi).toContain('spacingCm');
    } finally {
      target.urban!.spacingCm = savedSpacing;
    }
  });

  it('is deterministic for identical inputs and shifts sowing dates when start changes', () => {
    const input1 = {
      site: hcmcSite,
      climate: HO_CHI_MINH_CITY,
      cropIds: ['ipomoea-aquatica', 'raphanus-sativus'],
      areaM2: 2.0,
      start: '2026-11-01',
    };
    const p1 = planBalcony(input1);
    const p2 = planBalcony(input1);
    expect(p1).toEqual(p2);

    const pShifted = planBalcony({ ...input1, start: '2026-11-12' });
    expect(pShifted.beds[0].batches[0].sow).toBe('2026-11-12');
    expect(pShifted.beds[0].batches[0].sow).not.toBe(p1.beds[0].batches[0].sow);
  });

  it('preserves recommendUrban order and scores after extracting evaluateUrbanCrop', () => {
    const recs = recommendUrban(hcmcSite, HO_CHI_MINH_CITY, ['vegetables'], 11);
    const manual = listUrbanCrops()
      .map((c) => evaluateUrbanCrop(c, hcmcSite, HO_CHI_MINH_CITY, ['vegetables'], 11))
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => b.score - a.score || a.difficulty - b.difficulty)
      .slice(0, 10);
    expect(recs.map((r) => [r.cropId, r.score])).toEqual(manual.map((r) => [r.cropId, r.score]));
  });

  it('sets monthly waterLitresPerDay equal to the sum of potWater across active plants in that month', () => {
    const siteWithPot: UrbanSite = { ...hcmcSite, potDiameterCm: 25 };
    const plan = planBalcony({
      site: siteWithPot,
      climate: HO_CHI_MINH_CITY,
      cropIds: ['ipomoea-aquatica', 'basella-alba'],
      areaM2: 2.0,
      start: '2026-11-01',
    });

    const c1 = getCrop('ipomoea-aquatica')!;
    const c2 = getCrop('basella-alba')!;
    const pw1 = potWater(c1, HO_CHI_MINH_CITY, { canopyM2: plantCanopyM2(c1, siteWithPot) });
    const pw2 = potWater(c2, HO_CHI_MINH_CITY, { canopyM2: plantCanopyM2(c2, siteWithPot) });

    // Both cut-and-come-again crops are sown on 2026-11-01 and active in November (month 11)
    const nov = plan.months.find((m) => m.month === 11)!;
    const p1 = plan.beds.find((b) => b.cropId === 'ipomoea-aquatica')!.plants;
    const p2 = plan.beds.find((b) => b.cropId === 'basella-alba')!.plants;
    const expectedMin = Math.round((p1 * pw1[10].litresMin + p2 * pw2[10].litresMin) * 100) / 100;
    const expectedMax = Math.round((p1 * pw1[10].litresMax + p2 * pw2[10].litresMax) * 100) / 100;
    expect(nov.waterLitresPerDay).toEqual([expectedMin, expectedMax]);
  });
});
