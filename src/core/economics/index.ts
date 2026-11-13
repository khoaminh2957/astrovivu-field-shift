/**
 * Tier 3 public API: farm economics. yield -> production -> revenue -> cost -> margin -> break-even.
 * USD is the base currency; `getCurrency('VND')` gives the rate for a dong view. Reference values
 * are reference values (docs/ECONOMICS.md); the farmer's own yield, price and cost replace them.
 */
import type { CurrencyInfo, ModelInput, Parcel, ScoreTimeline, SeasonEconomics, StrategyEconomics } from '@/contracts';
import { tx } from '@/contracts';
import { EXCHANGE_RATE, REFERENCE_ECONOMICS } from '@/core/crops/curated.generated';
import { assessCrop, computeScoreDetail, yieldRange } from '@/core/scoring';
import type { EconRegion, ReferenceEconomics } from './types';

export type { EconRegion, ReferenceEconomics, SourceQuality } from './types';

export function getCurrency(code: 'USD' | 'VND'): CurrencyInfo {
  return code === 'VND'
    ? { code, perUsd: EXCHANGE_RATE.vndPerUsd, asOf: EXCHANGE_RATE.asOf, source: EXCHANGE_RATE.source }
    : { code, perUsd: 1, asOf: EXCHANGE_RATE.asOf, source: 'base currency' };
}

export const fromUsd = (usd: number, code: 'USD' | 'VND'): number => usd * getCurrency(code).perUsd;
const toUsd = (amount: number, code: 'USD' | 'VND' | undefined): number => amount / getCurrency(code ?? 'USD').perUsd;

/** Reference regions for a parcel, most specific first. */
export function economicRegions(parcel: Pick<Parcel, 'centroid' | 'isUS' | 'place'>): EconRegion[] {
  const [lng, lat] = parcel.centroid;
  const vn = parcel.place?.countryCode === 'VN' || (lat > 8 && lat < 23.5 && lng > 102 && lng < 110);
  if (vn) return ['VN'];
  if (parcel.isUS || parcel.place?.countryCode === 'US') return lng < -104 ? ['US-WEST', 'US'] : lng < -80 && lat >= 36 ? ['US-HEARTLAND', 'US'] : ['US'];
  return [];
}

/**
 * Reference yield, price and operating cost for a crop near the parcel. Falls back to any region
 * that has the crop (flagged by its `region`), and returns null when there is no reference at all.
 */
export function referenceEconomics(cropId: string, parcel: Pick<Parcel, 'centroid' | 'isUS' | 'place'>): ReferenceEconomics | null {
  const byRegion = REFERENCE_ECONOMICS[cropId];
  if (!byRegion) return null;
  for (const r of economicRegions(parcel)) if (byRegion[r]) return byRegion[r]!;
  return byRegion.US ?? byRegion.VN ?? Object.values(byRegion)[0] ?? null;
}

export interface SeasonEconomicsInput {
  cropId: string;
  areaHa: number;
  /** Expected, low and high fraction of the attainable yield (0..1). */
  yieldFraction: number;
  lowFraction?: number;
  highFraction?: number;
  reference: ReferenceEconomics | null;
  /** The farmer's own numbers, already in USD and per tonne / per hectare. */
  own?: { yieldTHa?: number; priceUsdPerT?: number; costUsdPerHa?: number };
}

/**
 * Season economics for any crop and area. Returns null when yield, price or cost is known neither
 * from the farmer nor from a reference: nothing is assumed in its place.
 */
export function seasonEconomics(i: SeasonEconomicsInput): SeasonEconomics | null {
  const ref = i.reference;
  const refT = i.own?.yieldTHa ?? ref?.refYieldTHa ?? null;
  const price = i.own?.priceUsdPerT ?? ref?.priceUsdPerT ?? null;
  const cost = i.own?.costUsdPerHa ?? ref?.costUsdPerHa ?? null;
  if (refT == null || price == null || cost == null) return null;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // The farmer's own yield is what the field gave, so it is not scaled down again by the score.
  const own = i.own?.yieldTHa != null;
  const expectedTHa = own ? refT : refT * i.yieldFraction;
  const lowTHa = own ? refT * 0.85 : refT * Math.min(i.lowFraction ?? i.yieldFraction * 0.8, i.yieldFraction);
  const highTHa = own ? refT * 1.15 : refT * Math.max(i.highFraction ?? Math.min(1, i.yieldFraction * 1.2), i.yieldFraction);
  const productionT = expectedTHa * i.areaHa;
  // Rounded first so that revenue - cost = margin holds exactly on screen.
  const revenueUsd = Math.round(productionT * price);
  const costUsd = Math.round(cost * i.areaHa);
  const marginUsd = revenueUsd - costUsd;
  const usesReference = i.own?.yieldTHa == null || i.own?.priceUsdPerT == null || i.own?.costUsdPerHa == null;
  return {
    cropId: i.cropId,
    areaHa: i.areaHa,
    yield: {
      expectedTHa: r2(expectedTHa),
      lowTHa: r2(lowTHa),
      highTHa: r2(highTHa),
      refTHa: r2(refT),
      basis: own
        ? tx('Your own last yield; range +/- 15 %.', 'Năng suất vụ trước của bạn; khoảng dao động +/- 15 %.')
        : tx(
            `Reference yield (${ref!.yieldRegion}, ${ref!.year}) x expected fraction ${Math.round(i.yieldFraction * 100)} %; range from the driest and wettest tenth of the analysed years.`,
            `Năng suất tham chiếu (${ref!.yieldRegion}, ${ref!.year}) x tỉ lệ kỳ vọng ${Math.round(i.yieldFraction * 100)} %; khoảng dao động theo 10 % năm khô nhất và ẩm nhất.`,
          ),
    },
    productionT: r2(productionT),
    priceUsdPerT: r2(price),
    revenueUsd: Math.round(revenueUsd),
    costUsd: Math.round(costUsd),
    marginUsd: Math.round(marginUsd),
    marginPct: revenueUsd > 0 ? Math.round((marginUsd / revenueUsd) * 1000) / 10 : 0,
    breakEvenYieldTHa: price > 0 ? r2(cost / price) : 0,
    sources: [
      ...(ref && usesReference ? ref.sources.map((s) => `REFERENCE VALUE (${ref.region}) - ${s}`) : []),
      ...(i.own?.yieldTHa != null ? ['yield: entered by the farmer'] : []),
      ...(i.own?.priceUsdPerT != null ? ['price: entered by the farmer'] : []),
      ...(i.own?.costUsdPerHa != null ? ['cost: entered by the farmer'] : []),
    ],
    usesReferenceValues: usesReference,
  };
}

/**
 * Economics of one season on the locked parcel. For the selected crop the expected yield is the
 * season outcome of the score; for any other crop it is the climatological fit at its best window.
 */
export function estimateSeasonEconomics(input: ModelInput, score: ScoreTimeline, cropId?: string, areaHa?: number): SeasonEconomics | null {
  const id = cropId ?? score.cropId ?? input.cropId;
  if (!id) return null;
  const gt = input.groundTruth;
  const selected = id === (score.cropId ?? input.cropId);
  let fraction: number | null;
  let range: { low: number; high: number } | null = null;
  if (selected && score.summary.expectedYieldFraction != null) {
    fraction = score.summary.expectedYieldFraction;
    range = yieldRange(computeScoreDetail(input, { snapshots: false }));
  } else {
    const a = assessCrop({ ...input, groundTruth: { ...gt, sowingDate: undefined } }, id);
    fraction = a ? a.bestCompatibility : null;
  }
  if (fraction == null) return null;
  return seasonEconomics({
    cropId: id,
    areaHa: areaHa ?? input.parcel.areaHa,
    yieldFraction: fraction,
    lowFraction: range?.low,
    highFraction: range?.high,
    reference: referenceEconomics(id, input.parcel),
    // The farmer's numbers describe the crop they grow, so they apply to the selected crop only.
    own: selected
      ? {
          yieldTHa: gt.lastYieldTHa,
          priceUsdPerT: gt.pricePerT != null ? toUsd(gt.pricePerT, gt.currency) : undefined,
          costUsdPerHa: gt.costPerHa != null ? toUsd(gt.costPerHa, gt.currency) : undefined,
        }
      : undefined,
  });
}

/** Totals for a rotation: the seasons of `years` years, averaged per year and per hectare. */
export function strategyEconomics(seasons: SeasonEconomics[], years = 1, areaHa?: number): StrategyEconomics {
  const sum = (f: (s: SeasonEconomics) => number) => seasons.reduce((a, s) => a + f(s), 0) / Math.max(1, years);
  const perYear = { revenueUsd: Math.round(sum((s) => s.revenueUsd)), costUsd: Math.round(sum((s) => s.costUsd)), marginUsd: Math.round(sum((s) => s.marginUsd)) };
  const area = areaHa ?? Math.max(0, ...seasons.map((s) => s.areaHa));
  return { perYear, perHaMarginUsd: area > 0 ? Math.round(perYear.marginUsd / area) : 0, seasons };
}
