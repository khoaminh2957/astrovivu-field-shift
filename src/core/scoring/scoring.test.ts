import { describe, expect, it } from 'vitest';
import type { BranchTelemetry, FieldTelemetry, GroundTruth, ModelInput, Parcel, Series, StaticFact } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop, listCrops, searchCrops } from '@/core/crops';
import { estimateSeasonEconomics, getCurrency, referenceEconomics, seasonEconomics } from '@/core/economics';
import { emptyBranch } from '@/lib/series';
import { addDays } from '@/lib/time';
import { DAKLAK_DAILY, DAKLAK_DAILY_START, DAKLAK_MONTHLY } from './__fixtures__/daklak';
import { assessCrop, climateZones, computeScoreDetail, computeScoreTimeline, rankCrops, scanSowingWindows, stageAt, trapezoid, whatIf, windowMonths } from './index';

/** Real ERA5 climate at the Đắk Lắk test point with the soil values recorded in docs/DATA_SOURCES.md. */
function daklak(cropId: string | null, groundTruth: GroundTruth = {}, opts: { soil?: boolean; history?: boolean } = {}): ModelInput {
  const parcel: Parcel = { id: 'test', name: 'test', polygon: { type: 'Polygon', coordinates: [[]] }, centroid: [108.2, 12.8], bbox: [0, 0, 0, 0], areaHa: 2.5, source: 'coords', isUS: false, place: { label: 'Đắk Lắk', countryCode: 'VN' } };
  const end = addDays(DAKLAK_DAILY_START, DAKLAK_DAILY.length - 1);
  const series = (key: string, branch: Series['branch'], col: number, f: (r: number[]) => number = (r) => r[col]): Series => ({
    key,
    branch,
    label: tx(key),
    unit: '',
    sourceId: 'era5',
    cadence: 'daily',
    samples: DAKLAK_DAILY.map((r, i) => ({ t: addDays(DAKLAK_DAILY_START, i), v: f(r) })),
  });
  const fact = (key: string, branch: StaticFact['branch'], value: number | string): StaticFact => ({ key, branch, label: tx(key), value, sourceId: 'soilgrids' });
  const ok = (b: BranchTelemetry, extra: Partial<BranchTelemetry>): BranchTelemetry => ({ ...b, status: 'ok', sources: ['era5'], confidence: { level: 'medium', score: 0.6, reasons: [] }, ...extra });
  const branches = Object.fromEntries((['soilMoisture', 'vegetation', 'thermal', 'rainfall', 'agromet', 'terrain', 'soil', 'risk'] as const).map((id) => [id, emptyBranch(id)])) as FieldTelemetry['branches'];
  branches.rainfall = ok(branches.rainfall, { series: [series('rain', 'rainfall', 0)] });
  branches.agromet = ok(branches.agromet, { series: [series('t2m_max', 'agromet', 1), series('t2m_min', 'agromet', 2), series('et0', 'agromet', 3)] });
  if (opts.soil !== false) {
    branches.soil = ok(branches.soil, { facts: [fact('ph', 'soil', 5.6), fact('clay_pct', 'soil', 34), fact('sand_pct', 'soil', 30), fact('soc_gkg', 'soil', 34.9), fact('texture_class', 'soil', 'medium')] });
    branches.terrain = ok(branches.terrain, { facts: [fact('elevation_m', 'terrain', 602), fact('slope_deg', 'terrain', 3)] });
  }
  const telemetry: FieldTelemetry = {
    parcelId: 'test',
    generatedAt: '2026-11-14T00:00:00Z',
    window: { start: DAKLAK_DAILY_START, end, today: end },
    branches,
    sources: {},
    mode: 'cached',
    ...(opts.history === false ? {} : { climateHistory: DAKLAK_MONTHLY.map(([year, ...m]) => ({ year, months: m.map(([rainMm, tMean, tMin, tMax, et0Mm], i) => ({ month: i + 1, rainMm, tMean, tMin, tMax, et0Mm })) })), climateSourceId: 'era5' }),
  };
  return { parcel, telemetry, cropId, groundTruth, priorities: ['profit'], today: end };
}
const best = (cropId: string, gt: GroundTruth = {}) => assessCrop(daklak(cropId, gt), cropId)!;

describe('trapezoid', () => {
  it('is 0 at and beyond the absolute limits, 1 in the optimum, linear between', () => {
    const q: [number, number, number, number] = [10, 20, 30, 40];
    expect(trapezoid(10, q)).toBe(0);
    expect(trapezoid(5, q)).toBe(0);
    expect(trapezoid(15, q)).toBeCloseTo(0.5);
    expect(trapezoid(20, q)).toBe(1);
    expect(trapezoid(30, q)).toBe(1);
    expect(trapezoid(35, q)).toBeCloseTo(0.5);
    expect(trapezoid(40, q)).toBe(0);
    expect(trapezoid(99, q)).toBe(0);
  });
  it('handles a window whose optimum touches the absolute limit', () => {
    expect(trapezoid(18, [12, 18, 18, 22])).toBe(1);
    expect(trapezoid(12, [12, 12, 18, 22])).toBe(1);
  });
});

describe('catalogue', () => {
  it('has at least 45 curated crops with a water model and bilingual names', () => {
    const crops = listCrops();
    expect(crops.length).toBeGreaterThanOrEqual(45);
    for (const c of crops) {
      expect(c.names.vi, c.id).toBeTruthy();
      expect(c.water, c.id).toBeTruthy();
      expect(c.water!.stages.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
      expect(c.req.tempC[0]).toBeLessThanOrEqual(c.req.tempC[1]);
    }
    for (const id of ['coffea-canephora', 'oryza-sativa', 'zea-mays', 'medicago-sativa', 'glycine-max']) expect(getCrop(id), id).toBeTruthy();
  });
  it('finds Vietnamese names without diacritics', () => {
    expect(searchCrops('dau phong', 'vi')[0].id).toBe('arachis-hypogaea');
    expect(searchCrops('ca phe', 'vi').map((c) => c.id)).toContain('coffea-canephora');
    expect(searchCrops('corn', 'en')[0].id).toBe('zea-mays');
  });
});

describe('compatibility', () => {
  it('any zero kills the score, and the limiting factor is reported', () => {
    const rice = best('oryza-sativa');
    expect(rice.bestCompatibility).toBeLessThan(0.2);
    expect(rice.limiting?.key).toBe('water');
  });
  it('missing information is skipped and flagged, never scored as zero', () => {
    const withSoil = assessCrop(daklak('sesamum-indicum'), 'sesamum-indicum')!;
    const noSoil = assessCrop(daklak('sesamum-indicum', {}, { soil: false }), 'sesamum-indicum')!;
    expect(noSoil.compatibility).toBeGreaterThan(0.8);
    expect(noSoil.factors.find((f) => f.key === 'ph')!.score).toBeNull();
    expect(noSoil.factors.find((f) => f.key === 'texture')!.score).toBeNull();
    expect(withSoil.factors.find((f) => f.key === 'ph')!.score).not.toBeNull();
    // No climate history at all: climate factors are null, the score does not collapse.
    const noClimate = assessCrop(daklak('sesamum-indicum', {}, { history: false }), 'sesamum-indicum')!;
    expect(noClimate.factors.find((f) => f.key === 'water')!.score).toBeNull();
    expect(noClimate.compatibility).toBeGreaterThan(0);
    expect(noClimate.reliability).toBeNull();
  });
  it('weights are exponents: a pH problem costs less than the same water problem', () => {
    const f = assessCrop(daklak('crotalaria-juncea'), 'crotalaria-juncea')!;
    const ph = f.factors.find((x) => x.key === 'ph')!;
    expect(ph.score).toBeCloseTo(0.6, 1);
    expect(f.compatibility).toBeCloseTo(0.6 ** 0.5, 1);
  });
  it('ground truth replaces the satellite value and is recorded', () => {
    const d = computeScoreDetail(daklak('crotalaria-juncea', { ph: 6.5 }));
    expect(d.timeline.summary.calibration.find((c) => c.key === 'ph')).toMatchObject({ satellite: 5.6, ground: 6.5 });
    expect(d.timeline.summary.compatibility!).toBeGreaterThan(computeScoreTimeline(daklak('crotalaria-juncea')).summary.compatibility!);
  });
});

describe('Đắk Lắk sanity targets (real ERA5 2005-2024, pH 5.6, clay 34 %)', () => {
  it('robusta is good but rain-limited, about 220 mm short of the optimum', () => {
    const a = best('coffea-canephora');
    expect(windowMonths(getCrop('coffea-canephora')!)).toBe(10);
    expect(a.limiting?.key).toBe('water');
    expect(a.waterNeedMm - a.waterSupplyMm!).toBeGreaterThan(190);
    expect(a.waterNeedMm - a.waterSupplyMm!).toBeLessThan(250);
    expect(a.bestCompatibility).toBeGreaterThan(0.6);
    expect(a.bestCompatibility).toBeLessThan(0.85);
  });
  it('irrigation lifts robusta to the top', () => {
    expect(best('coffea-canephora', { irrigation: 'full' }).bestCompatibility).toBeGreaterThan(0.95);
    expect(best('coffea-canephora', { irrigation: 'supplemental' }).bestCompatibility).toBeGreaterThan(0.95);
  });
  it('rainfed rice and black pepper fail on water and pass when irrigated', () => {
    for (const id of ['oryza-sativa', 'piper-nigrum']) {
      const dry = best(id);
      expect(dry.bestCompatibility, id).toBeLessThan(0.2);
      expect(dry.limiting?.key, id).toBe('water');
      expect(best(id, { irrigation: 'full' }).bestCompatibility, id).toBeGreaterThan(0.6);
    }
  });
  it('sunn hemp is held back only by pH', () => {
    const a = best('crotalaria-juncea');
    expect(a.limiting?.key).toBe('ph');
    expect(a.factors.filter((f) => f.score != null && f.score < 1 && f.weight > 0).map((f) => f.key)).toEqual(['ph']);
  });
  it('wheat is poor', () => {
    expect(best('triticum-aestivum').bestCompatibility).toBeLessThan(0.4);
    expect(best('triticum-aestivum', { irrigation: 'full' }).bestCompatibility).toBeLessThan(0.45);
  });
  it('sesame, groundnut and soybean are highly suitable, sesame the most reliable', () => {
    const rel = (id: string) => {
      const a = best(id);
      expect(a.bestCompatibility, id).toBeGreaterThanOrEqual(0.8);
      return a.reliability!.yearsOk / a.reliability!.yearsTotal;
    };
    const [sesame, groundnut, soybean] = ['sesamum-indicum', 'arachis-hypogaea', 'glycine-max'].map(rel);
    expect(sesame).toBeGreaterThanOrEqual(groundnut);
    expect(sesame).toBeGreaterThanOrEqual(soybean);
    expect(sesame).toBeGreaterThan(0.8);
  });
  it('classifies the site as tropical wet and dry', () => {
    expect(climateZones([20.4, 22.0, 24.2, 25.7, 25.5, 24.6, 23.8, 23.8, 23.4, 22.9, 22.3, 20.7], [15, 8, 21, 64, 162, 170, 236, 207, 273, 189, 113, 41], 12.8)).toEqual(['Aw']);
  });
});

describe('timeline, stages, what-if', () => {
  it('stages progress through the cycle and repeat', () => {
    const maize = getCrop('zea-mays')!;
    const ids = [0, 30, 60, 100, 124, 130, 200, 350].map((d) => stageAt(maize, d).id);
    expect(ids).toEqual(['initial', 'development', 'mid-season', 'late-season', 'late-season', 'harvest', 'fallow', 'pre-sowing']);
    expect(stageAt(maize, 60).progress).toBeGreaterThan(stageAt(maize, 30).progress);
  });
  it('covers every day of the window and stays within 0..100', () => {
    const t = computeScoreTimeline(daklak('coffea-canephora'));
    expect(t.snapshots.length).toBe(DAKLAK_DAILY.length);
    expect(t.snapshots.every((s) => s.productivity >= 0 && s.productivity <= 100 && s.condition >= 0 && s.condition <= 100)).toBe(true);
    expect(t.summary.reliability!.yearsTotal).toBeGreaterThanOrEqual(18);
    // The dry season shows: the worst day is clearly below the best one for a rainfed crop.
    const p = t.snapshots.map((s) => s.productivity);
    expect(Math.min(...p)).toBeLessThan(Math.max(...p) - 15);
  });
  it('moves when crop, pH, irrigation or sowing date change', () => {
    const base = computeScoreTimeline(daklak('coffea-canephora')).summary;
    expect(computeScoreTimeline(daklak('coffea-canephora', { irrigation: 'full' })).summary.productivityMean).toBeGreaterThan(base.productivityMean);
    expect(computeScoreTimeline(daklak('coffea-canephora', { ph: 8.5 })).summary.compatibility!).toBeLessThan(base.compatibility!);
    expect(computeScoreTimeline(daklak('glycine-max')).summary.compatibility).not.toBe(base.compatibility);
    const may = computeScoreTimeline(daklak('glycine-max', { sowingDate: '2026-05-10' })).summary;
    const dec = computeScoreTimeline(daklak('glycine-max', { sowingDate: '2025-12-10' })).summary;
    expect(may.compatibility!).toBeGreaterThan(dec.compatibility!);
  });
  it('without a crop still gives a growing-condition index', () => {
    const t = computeScoreTimeline(daklak(null));
    expect(t.summary.compatibility).toBeNull();
    expect(t.snapshots.length).toBeGreaterThan(300);
    expect(t.summary.productivityMean).toBeGreaterThan(0);
  });
  it('degrades gracefully without climate history', () => {
    const t = computeScoreTimeline(daklak('coffea-canephora', {}, { history: false }));
    expect(t.snapshots.length).toBe(DAKLAK_DAILY.length);
    expect(t.summary.reliability).toBeNull();
  });
  it('scans twelve sowing months', () => {
    const w = scanSowingWindows(daklak('glycine-max'));
    expect(w.map((x) => x.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(w[4].score).toBeGreaterThan(w[11].score);
    expect(w[4].reliability).toBeGreaterThan(0.5);
  });
  it('what-if is monotonic: irrigation and pH correction never lower the score', () => {
    const moves = whatIf(daklak('piper-nigrum'));
    const irrigation = moves.filter((m) => m.changedFactor === 'irrigation');
    expect(irrigation.length).toBe(2);
    for (const m of moves.filter((x) => x.changedFactor !== 'crop')) expect(m.delta, m.label.en).toBeGreaterThanOrEqual(0);
    expect(irrigation[1].after).toBeGreaterThanOrEqual(irrigation[0].after);
    expect(moves.some((m) => m.changedFactor === 'ph')).toBe(true);
    expect(moves.some((m) => m.changedFactor === 'crop' && m.delta > 0)).toBe(true);
    expect(whatIf(daklak('piper-nigrum'), { irrigation: 'full' })[0].delta).toBeGreaterThan(0);
  });
  it('ranks crops beyond a tie at 100', () => {
    const r = rankCrops(daklak(null), { cropIds: ['sesamum-indicum', 'oryza-sativa', 'triticum-aestivum', 'glycine-max'] });
    expect(r[r.length - 1].rankScore).toBeLessThan(r[0].rankScore);
    expect(['oryza-sativa', 'triticum-aestivum']).toContain(r[r.length - 1].cropId);
  });
  it('is fast enough to run on every override', () => {
    const input = daklak('coffea-canephora');
    computeScoreTimeline(input);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) computeScoreTimeline({ ...input, groundTruth: { ph: 5 + i * 0.2 } });
    expect((performance.now() - t0) / 5).toBeLessThan(30);
  });
});

describe('economics', () => {
  it('uses regional reference values and labels them', () => {
    const input = daklak('coffea-canephora');
    const e = estimateSeasonEconomics(input, computeScoreTimeline(input))!;
    expect(e.usesReferenceValues).toBe(true);
    expect(e.sources.some((s) => s.startsWith('REFERENCE VALUE (VN)'))).toBe(true);
    expect(e.revenueUsd - e.costUsd).toBe(e.marginUsd);
    expect(e.yield.lowTHa).toBeLessThanOrEqual(e.yield.expectedTHa);
    expect(e.yield.highTHa).toBeGreaterThanOrEqual(e.yield.expectedTHa);
    expect(e.breakEvenYieldTHa).toBeCloseTo(e.costUsd / e.areaHa / e.priceUsdPerT, 1);
    expect(referenceEconomics('zea-mays', { centroid: [-93.5, 42.1], isUS: true })!.region).toBe('US-HEARTLAND');
  });
  it("the farmer's own yield, price and cost replace the reference", () => {
    const input = daklak('coffea-canephora', { lastYieldTHa: 3.5, pricePerT: 90_000_000, costPerHa: 70_000_000, currency: 'VND' });
    const e = estimateSeasonEconomics(input, computeScoreTimeline(input))!;
    expect(e.usesReferenceValues).toBe(false);
    expect(e.yield.expectedTHa).toBe(3.5);
    expect(e.priceUsdPerT).toBeCloseTo(90_000_000 / getCurrency('VND').perUsd, 0);
    expect(e.costUsd).toBeCloseTo((70_000_000 / getCurrency('VND').perUsd) * 2.5, -1);
  });
  it('returns null instead of guessing when no cost is known', () => {
    expect(seasonEconomics({ cropId: 'sesamum-indicum', areaHa: 1, yieldFraction: 1, reference: referenceEconomics('sesamum-indicum', daklak(null).parcel) })).toBeNull();
    expect(seasonEconomics({ cropId: 'x', areaHa: 1, yieldFraction: 1, reference: null })).toBeNull();
  });
});
