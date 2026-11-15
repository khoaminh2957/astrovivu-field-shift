import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, GroundTruth, ModelInput, RotationStrategy, SeasonEconomics } from '@/contracts';
import { buildRotations } from '@/core/advisory/rotation';
import { getCrop } from '@/core/crops';
import { computeScoreTimeline } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { countryCropsFromAtlas } from '../../../scripts/crops/country-crops';
import { estimateSeasonEconomics, marginSensitivity, rankFlips, referenceEconomics, seasonEconomics, seasonSensitivity, SENSITIVITY_PCT, strategyEconomics } from './index';

const FIELDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
/** The five crop and field pairs of docs/ECONOMICS.md, section 6.2. */
const PAIRS = [
  ['coffea-canephora', 'daklak-coffee'],
  ['oryza-sativa', 'cantho-rice'],
  ['zea-mays', 'iowa-corn-soy'],
  ['glycine-max', 'iowa-corn-soy'],
  ['medicago-sativa', 'nevada-alfalfa'],
] as const;

/**
 * A demo field as the app opens it, with the grower's own numbers on top when given. The app gives
 * the model the crop table of the field's country (the atlas rows; `src/data/country.ts`), and the
 * rotation builder reads it (docs/SCORING.md, 12.5), so the tables of section 6 are built with it.
 */
function demo(id: string, own: Partial<GroundTruth> = {}): ModelInput {
  const parcel = getSampleParcel(id)!;
  const defaults = (parcel as { defaultGroundTruth?: GroundTruth }).defaultGroundTruth ?? {};
  const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
  return { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: { ...defaults, ...own }, priorities: ['profit', 'water', 'soil'], today: '2026-11-14', country: countryCropsFromAtlas(parcel.place!.iso3!) };
}

/** One hectare of a crop on a demo field, as the season card computes it. */
function season(cropId: string, field: string, own: Partial<GroundTruth> = {}): SeasonEconomics {
  const input = demo(field, own);
  return estimateSeasonEconomics(input, computeScoreTimeline(input), cropId, 1)!;
}

const rotations = new Map<string, RotationStrategy[]>();
const rotationsOf = (field: string): RotationStrategy[] => rotations.get(field) ?? rotations.set(field, buildRotations(demo(field))).get(field)!;

const usd = (v: number): string => (Math.round(v) + 0).toLocaleString('en-US');
const DOC = readFileSync('docs/ECONOMICS.md', 'utf8');

describe('margin when price, yield or cost is off', () => {
  // 2 ha at 5 t/ha and 200 USD/t, 600 USD/ha of cost: revenue 2,000, cost 1,200, margin 800.
  const base = { yieldTHa: 5, priceUsdPerT: 200, costUsdPerHa: 600, areaHa: 2 };
  const s = marginSensitivity(base);

  it('price down 20 % lowers revenue by 20 % and margin by the same amount in USD', () => {
    expect(s.pct).toBe(0.2);
    expect(SENSITIVITY_PCT).toBe(0.2);
    expect([s.revenueUsd, s.costUsd, s.marginUsd]).toEqual([2000, 1200, 800]);
    // A fifth of the revenue is 400 USD: the margin falls by exactly that, the cost does not move.
    expect(s.marginUsd - s.price.lower).toBe(0.2 * s.revenueUsd);
    expect(s.price).toEqual({ lower: 400, higher: 1200 });
    // Revenue is yield x price and the cost per hectare does not depend on the yield: a yield that is off acts like a price that is off.
    expect(s.yield).toEqual(s.price);
    // A fifth of the cost is 240 USD.
    expect(s.cost).toEqual({ lower: 1040, higher: 560 });
  });

  it('moves all three against the grower, and in their favour', () => {
    // 5 x 0.8 x 200 x 0.8 x 2 - 600 x 1.2 x 2 = 1,280 - 1,440; 5 x 1.2 x 200 x 1.2 x 2 - 600 x 0.8 x 2 = 2,880 - 960.
    expect(s.worstUsd).toBe(-160);
    expect(s.bestUsd).toBe(1920);
    expect(marginSensitivity(base, 0.1).price).toEqual({ lower: 600, higher: 1000 });
  });

  it('break-even price times yield equals cost', () => {
    expect(s.breakEvenPriceUsdPerT).toBe(120);
    expect(s.breakEvenPriceUsdPerT! * base.yieldTHa).toBe(base.costUsdPerHa);
    expect(s.breakEvenYieldTHa).toBe(3);
    expect(s.breakEvenYieldTHa! * base.priceUsdPerT).toBe(base.costUsdPerHa);
    expect(marginSensitivity({ ...base, priceUsdPerT: s.breakEvenPriceUsdPerT! }).marginUsd).toBe(0);
    // Nothing is harvested from a cover crop: no price makes up for its cost.
    expect(marginSensitivity({ yieldTHa: 0, priceUsdPerT: 0, costUsdPerHa: 90, areaHa: 1 })).toMatchObject({ marginUsd: -90, breakEvenPriceUsdPerT: null, breakEvenYieldTHa: null });
  });

  it('of a computed season starts from the margin the season shows', () => {
    for (const [crop, field] of PAIRS) {
      const e = season(crop, field);
      const of = seasonSensitivity(e)!;
      expect([of.revenueUsd, of.costUsd, of.marginUsd], `${crop} on ${field}`).toEqual([e.revenueUsd, e.costUsd, e.marginUsd]);
      expect(of.breakEvenYieldTHa).toBe(e.breakEvenYieldTHa);
      // The break-even price is rounded to the cent: times the yield it is the cost to within half a cent per tonne.
      const yieldUsed = e.revenueUsd / e.priceUsdPerT / e.areaHa;
      expect(Math.abs(of.breakEvenPriceUsdPerT! * yieldUsed - e.costUsd / e.areaHa), `${crop} on ${field}`).toBeLessThanOrEqual(0.005 * yieldUsed + 1e-9);
    }
    expect(seasonSensitivity({ ...season('oryza-sativa', 'cantho-rice'), areaHa: 0 })).toBeNull();
  });
});

describe('range of the margin over the yield range', () => {
  it('margin range brackets the expected margin', () => {
    for (const [crop, field] of PAIRS) {
      const e = season(crop, field);
      expect(e.marginLowUsd, `${crop} on ${field}`).toBeLessThanOrEqual(e.marginUsd);
      expect(e.marginHighUsd, `${crop} on ${field}`).toBeGreaterThanOrEqual(e.marginUsd);
      expect(e.marginLowUsd).toBeLessThan(e.marginHighUsd!);
    }
  });

  it('is the margin at the low and at the high yield, price and cost unchanged', () => {
    const reference = referenceEconomics('glycine-max', getSampleParcel('iowa-corn-soy')!)!;
    const e = seasonEconomics({ cropId: 'glycine-max', areaHa: 10, yieldFraction: 0.8, lowFraction: 0.5, highFraction: 0.9, reference })!;
    expect(e.marginLowUsd).toBe(Math.round(reference.refYieldTHa! * 0.5 * 10 * reference.priceUsdPerT!) - e.costUsd);
    expect(e.marginHighUsd).toBe(Math.round(reference.refYieldTHa! * 0.9 * 10 * reference.priceUsdPerT!) - e.costUsd);
    expect(e.marginUsd).toBe(e.revenueUsd - e.costUsd);
  });

  it('a farmer\'s own yield gives a +/- 15 % range and says so', () => {
    const e = season('oryza-sativa', 'cantho-rice', { lastYieldTHa: 6 });
    expect([e.yield.lowTHa, e.yield.expectedTHa, e.yield.highTHa]).toEqual([5.1, 6, 6.9]);
    expect(e.yield.basis.en).toContain('+/- 15 %');
    expect(e.yield.basis.vi).toContain('+/- 15 %');
    expect(e.marginLowUsd).toBe(Math.round(5.1 * e.priceUsdPerT) - e.costUsd);
    expect(e.marginHighUsd).toBe(Math.round(6.9 * e.priceUsdPerT) - e.costUsd);
  });

  it('says whether the range comes from the analysed years or is the default of 20 %', () => {
    // The crop the field grows is scored year by year; any other crop is not.
    const selected = season('zea-mays', 'iowa-corn-soy');
    expect(selected.yield.basis.en).toContain('tenth of the analysed years');
    expect(selected.yield.basis.vi).toContain('các năm đã phân tích');
    const other = season('glycine-max', 'iowa-corn-soy');
    expect(other.yield.basis.en).toContain('+/- 20 % by default');
    expect(other.yield.basis.vi).toContain('+/- 20 % theo mặc định');
    // 20 % below the expected yield; above it only as far as the reference yield.
    expect(other.yield.lowTHa).toBeCloseTo(other.yield.expectedTHa * 0.8, 1);
    expect(other.yield.highTHa).toBeLessThanOrEqual(other.yield.refTHa);
  });

  it('adds up to a range per hectare and year for a rotation', () => {
    const reference = referenceEconomics('glycine-max', getSampleParcel('iowa-corn-soy')!)!;
    const a = seasonEconomics({ cropId: 'glycine-max', areaHa: 10, yieldFraction: 0.8, reference })!;
    const b = seasonEconomics({ cropId: 'glycine-max', areaHa: 10, yieldFraction: 0.6, reference })!;
    const oneYear = strategyEconomics([a, b], 1, 10);
    expect(oneYear.perHaMarginLowUsd).toBe(Math.round((a.marginLowUsd! + b.marginLowUsd!) / 10));
    expect(oneYear.perHaMarginHighUsd).toBe(Math.round((a.marginHighUsd! + b.marginHighUsd!) / 10));
    expect(strategyEconomics([a, b], 2, 10).perHaMarginLowUsd).toBe(Math.round((a.marginLowUsd! + b.marginLowUsd!) / 2 / 10));
    // No season, or a season without a range: no range is made up.
    expect(strategyEconomics([], 1, 10).perHaMarginLowUsd).toBeUndefined();
    const { marginLowUsd: _low, ...unranged } = a;
    expect(strategyEconomics([unranged, b], 1, 10).perHaMarginHighUsd).toBeUndefined();
  });

  it.each(FIELDS)('every rotation of %s has a range, prints it, and names a range that crosses zero', (field) => {
    for (const r of rotationsOf(field)) {
      const { perHaMarginUsd: margin, perHaMarginLowUsd: low, perHaMarginHighUsd: high } = r.economics;
      expect(low, r.id).toBeLessThanOrEqual(margin);
      expect(high, r.id).toBeGreaterThanOrEqual(margin);
      const line = r.evidence.find((e) => typeof e.label !== 'string' && e.label.en === 'Margin per hectare and year')!;
      const value = line.value as { en: string; vi: string };
      expect(value.en).toContain(`${margin} USD; ${low} to ${high} USD over the yield range`);
      expect(value.vi).toContain(`${margin} USD; từ ${low} đến ${high} USD theo khoảng năng suất`);
      const crossesZero = low! <= 0 && high! >= 0;
      expect(r.gaps.some((g) => g.en.includes('margin range crosses zero')), r.id).toBe(crossesZero);
      expect(r.gaps.some((g) => g.vi.includes('Khoảng lãi đi qua số 0')), r.id).toBe(crossesZero);
      // Only the alfalfa pivot, where the reference margin is negative, has ranges on both sides of zero.
      expect(crossesZero, r.id).toBe(field === 'nevada-alfalfa');
    }
  });
});

describe('source quality of the reference record', () => {
  it('travels with the season', () => {
    const rice = season('oryza-sativa', 'cantho-rice');
    const record = referenceEconomics('oryza-sativa', getSampleParcel('cantho-rice')!)!;
    expect(rice.reference).toEqual({ iso3: 'VNM', year: record.year, quality: record.quality, sameCountry: true });
    expect(rice.reference!.quality).toEqual({ yield: 'official', price: 'press', cost: 'press' });
    // A record of a part of the country names it.
    expect(season('zea-mays', 'iowa-corn-soy').reference).toMatchObject({ iso3: 'USA', region: 'US-HEARTLAND', quality: { yield: 'official', price: 'official', cost: 'budget' }, sameCountry: true });
    expect(season('medicago-sativa', 'nevada-alfalfa').reference).toMatchObject({ iso3: 'USA', region: 'US-WEST', sameCountry: true });
  });

  it('says when the record is of another country than the field', () => {
    // Common bean has no Vietnamese record: the paddy field gets the one of the United States.
    const e = season('phaseolus-vulgaris', 'cantho-rice');
    expect(e.reference).toMatchObject({ iso3: 'USA', sameCountry: false });
    const borrowed = rotationsOf('cantho-rice').flatMap((r) => r.economics.seasons).filter((s) => s.reference && !s.reference.sameCountry);
    // Common bean and daikon radish, the two crops of the water-saver rotation (buckwheat was the second until the builder read the country table).
    expect(new Set(borrowed.map((s) => s.cropId))).toEqual(new Set(['phaseolus-vulgaris', 'raphanus-sativus']));
  });

  it('is left out when yield, price and cost are all the grower\'s own', () => {
    const own = season('oryza-sativa', 'cantho-rice', { lastYieldTHa: 6, pricePerT: 280, costPerHa: 900, currency: 'USD' });
    expect(own.usesReferenceValues).toBe(false);
    expect(own.reference).toBeUndefined();
    // One reference value left: the record is named again.
    expect(season('oryza-sativa', 'cantho-rice', { lastYieldTHa: 6, pricePerT: 280 }).reference).toBeDefined();
  });
});

describe('rotations that change places', () => {
  const lean = { id: 'lean', perYear: { revenueUsd: 10_000, costUsd: 4000, marginUsd: 6000 } };
  const heavy = { id: 'heavy', perYear: { revenueUsd: 20_000, costUsd: 13_000, marginUsd: 7000 } };

  it('finds the fall in prices at which the rotation with the higher cost falls behind', () => {
    // 20,000 f - 13,000 = 10,000 f - 4,000 at f = 0.9: a fall by 10 %. 20,000 - 13,000 g = 10,000 - 4,000 g at g = 1.111.
    expect(rankFlips([lean, heavy])).toEqual([
      { ahead: 'heavy', behind: 'lean', driver: 'price-or-yield', atChange: -0.1 },
      { ahead: 'heavy', behind: 'lean', driver: 'cost', atChange: 0.111 },
    ]);
  });

  it('reports nothing when the order holds within the range tried', () => {
    expect(rankFlips([lean, heavy], 0.05)).toEqual([]);
    expect(rankFlips([lean, { id: 'far', perYear: { revenueUsd: 40_000, costUsd: 13_000, marginUsd: 27_000 } }])).toEqual([]);
    expect(rankFlips([lean])).toEqual([]);
  });
});

describe('tables of docs/ECONOMICS.md, section 6', () => {
  it('sensitivity table of docs/ECONOMICS.md', () => {
    const rows = PAIRS.map(([crop, field]) => {
      const e = season(crop, field);
      const s = seasonSensitivity(e)!;
      const q = e.reference!.quality;
      return `| ${getCrop(crop)!.names.en}, ${getSampleParcel(field)!.name} | ${usd(s.marginUsd)} | ${usd(s.price.lower)} | ${usd(s.price.higher)} | ${usd(s.cost.higher)} | ${usd(s.cost.lower)} | ${usd(s.worstUsd)} | ${usd(s.bestUsd)} | ${usd(s.breakEvenPriceUsdPerT!)} (${usd(e.priceUsdPerT)}) | ${s.breakEvenYieldTHa!.toFixed(2)} (${e.yield.expectedTHa.toFixed(2)}) | ${q.yield}, ${q.price}, ${q.cost} |`;
    });
    expect(rows).toEqual([
      '| Robusta coffee, Central Highlands robusta block | 7,614 | 5,619 | 9,609 | 7,141 | 8,087 | 3,550 | 12,476 | 796 (3,359) | 0.70 (2.97) | official, press, press |',
      '| Rice, Mekong Delta paddy | 538 | 257 | 819 | 365 | 711 | -141 | 1,330 | 141 (229) | 3.79 (6.15) | official, press, press |',
      '| Maize, Story County corn-soybean field | 932 | 507 | 1,357 | 693 | 1,171 | -73 | 2,107 | 91 (161) | 7.40 (13.18) | official, official, budget |',
      '| Soybean, Story County corn-soybean field | 749 | 456 | 1,042 | 606 | 892 | 78 | 1,537 | 183 (375) | 1.91 (3.91) | official, official, budget |',
      '| Alfalfa, Diamond Valley alfalfa pivot | -182 | -382 | 18 | -419 | 55 | -780 | 496 | 212 (180) | 6.59 (5.58) | official, official, budget |',
    ]);
    for (const row of rows) expect(DOC, row).toContain(row);
  });

  it('yield ranges of the five seasons in docs/ECONOMICS.md', () => {
    const rows = PAIRS.map(([crop, field]) => {
      const e = season(crop, field);
      const origin = e.yield.basis.en.includes('analysed years') ? 'the analysed years' : 'default of 20 %';
      return `| ${getCrop(crop)!.names.en}, ${getSampleParcel(field)!.name} | ${e.yield.lowTHa.toFixed(2)} | ${e.yield.expectedTHa.toFixed(2)} | ${e.yield.highTHa.toFixed(2)} | ${usd(e.marginLowUsd!)} | ${usd(e.marginUsd)} | ${usd(e.marginHighUsd!)} | ${origin} |`;
    });
    expect(rows).toEqual([
      '| Robusta coffee, Central Highlands robusta block | 2.87 | 2.97 | 2.97 | 7,266 | 7,614 | 7,614 | the analysed years |',
      '| Rice, Mekong Delta paddy | 5.86 | 6.15 | 6.15 | 473 | 538 | 538 | the analysed years |',
      '| Maize, Story County corn-soybean field | 0.14 | 13.18 | 13.18 | -1,173 | 932 | 932 | the analysed years |',
      '| Soybean, Story County corn-soybean field | 3.13 | 3.91 | 4.27 | 456 | 749 | 883 | default of 20 % |',
      '| Alfalfa, Diamond Valley alfalfa pivot | 3.86 | 5.58 | 5.58 | -491 | -182 | -182 | the analysed years |',
    ]);
    for (const row of rows) expect(DOC, row).toContain(row);
  });

  it('margin ranges of the rotations in docs/ECONOMICS.md', () => {
    const rows = FIELDS.flatMap((field) =>
      [...rotationsOf(field)]
        .sort((a, b) => b.economics.perHaMarginUsd - a.economics.perHaMarginUsd)
        .map((r) => `| ${getSampleParcel(field)!.name} | ${r.name.en} | ${usd(r.economics.perHaMarginUsd)} | ${usd(r.economics.perHaMarginLowUsd!)} | ${usd(r.economics.perHaMarginHighUsd!)} |`),
    );
    expect(rows).toHaveLength(17);
    for (const row of rows) expect(DOC, row).toContain(row);
    // The sentence under the table: what the income rotation of the paddy field sells and spends against three rice crops.
    const paddy = new Map(rotationsOf('cantho-rice').map((r) => [r.kind, r.economics.perYear]));
    expect([paddy.get('income')!.revenueUsd, paddy.get('income')!.costUsd, paddy.get('current')!.revenueUsd, paddy.get('current')!.costUsd]).toEqual([11_577, 8494, 5691, 3510]);
  });

  it('rotations that change places in docs/ECONOMICS.md', () => {
    const lines = FIELDS.flatMap((field) => {
      const all = rotationsOf(field);
      const name = new Map(all.map((r) => [r.id, r.name.en]));
      return rankFlips(all.map((r) => ({ id: r.id, perYear: r.economics.perYear }))).map(
        (f) => `| ${getSampleParcel(field)!.name} | ${name.get(f.ahead)} | ${name.get(f.behind)} | ${f.driver === 'cost' ? 'costs' : 'prices or yields'} ${f.atChange < 0 ? 'fall' : 'rise'} by ${Math.abs(f.atChange * 100).toFixed(0)} % |`,
      );
    });
    expect(lines).toHaveLength(12);
    for (const line of lines) expect(DOC, line).toContain(line);
    // The fields whose order does not change within 20 %.
    expect(rankFlips(rotationsOf('daklak-coffee').map((r) => ({ id: r.id, perYear: r.economics.perYear })))).toEqual([]);
  });
});
