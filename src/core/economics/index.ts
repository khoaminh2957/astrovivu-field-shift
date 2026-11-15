/**
 * Tier 3 public API: farm economics. yield -> production -> revenue -> cost -> margin -> break-even.
 * USD is the base currency; `getCurrency('VND')` gives the rate for a dong view. Reference values
 * are reference values (docs/ECONOMICS.md); the farmer's own yield, price and cost replace them.
 */
import type { CurrencyInfo, EconomicsReference, GroundTruth, Iso3, ModelInput, Parcel, ScoreTimeline, SeasonEconomics, StrategyEconomics } from '@/contracts';
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

/** Country of each reference region. */
const REGION_ISO3: Record<EconRegion, Iso3> = { VN: 'VNM', US: 'USA', 'US-HEARTLAND': 'USA', 'US-WEST': 'USA' };

/** Country whose reference records are the parcel's own; null outside the countries of the reference table. */
export function economicCountry(parcel: Pick<Parcel, 'centroid' | 'isUS' | 'place'>): Iso3 | null {
  const region = economicRegions(parcel)[0];
  return region ? REGION_ISO3[region] : null;
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
  /**
   * Country of the parcel (`economicCountry`), null when it lies outside the countries of the
   * reference table. `referenceEconomics` falls back to a record of another country; this is how
   * the result says so. Left out, the record is taken to be of the parcel's country.
   */
  country?: Iso3 | null;
  /** The farmer's own numbers, already in USD and per tonne / per hectare. */
  own?: { yieldTHa?: number; priceUsdPerT?: number; costUsdPerHa?: number };
}

/**
 * The grower's own yield, price and cost, in the units the model computes in (t/ha, USD per tonne,
 * USD per hectare). Price and cost are entered in `groundTruth.currency`; without one they are in
 * USD. Every place that lets the grower's numbers replace a reference value goes through here, so
 * that an amount in dong is converted the same way everywhere.
 */
export function ownEconomics(gt: Pick<GroundTruth, 'lastYieldTHa' | 'pricePerT' | 'costPerHa' | 'currency'>): NonNullable<SeasonEconomicsInput['own']> {
  return {
    yieldTHa: gt.lastYieldTHa,
    priceUsdPerT: gt.pricePerT != null ? toUsd(gt.pricePerT, gt.currency) : undefined,
    costUsdPerHa: gt.costPerHa != null ? toUsd(gt.costPerHa, gt.currency) : undefined,
  };
}

/** Half-width of the yield range: around the grower's own last yield, and around the expected yield when no year-by-year range is given. */
const OWN_YIELD_SPREAD = 0.15;
const DEFAULT_YIELD_SPREAD = 0.2;

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
  // Where the yield range comes from: the grower's number, the years of the climate history, or a default.
  const fromYears = !own && i.lowFraction != null && i.highFraction != null;
  const expectedTHa = own ? refT : refT * i.yieldFraction;
  const lowTHa = own ? refT * (1 - OWN_YIELD_SPREAD) : refT * Math.min(i.lowFraction ?? i.yieldFraction * (1 - DEFAULT_YIELD_SPREAD), i.yieldFraction);
  const highTHa = own ? refT * (1 + OWN_YIELD_SPREAD) : refT * Math.max(i.highFraction ?? Math.min(1, i.yieldFraction * (1 + DEFAULT_YIELD_SPREAD)), i.yieldFraction);
  const productionT = expectedTHa * i.areaHa;
  // Rounded first so that revenue - cost = margin holds exactly on screen.
  const revenueUsd = Math.round(productionT * price);
  const costUsd = Math.round(cost * i.areaHa);
  const marginUsd = revenueUsd - costUsd;
  const usesReference = i.own?.yieldTHa == null || i.own?.priceUsdPerT == null || i.own?.costUsdPerHa == null;
  const reference: EconomicsReference | undefined =
    ref && usesReference
      ? {
          iso3: REGION_ISO3[ref.region],
          ...(ref.region === 'VN' || ref.region === 'US' ? {} : { region: ref.region }),
          year: ref.year,
          quality: { ...ref.quality },
          sameCountry: i.country === undefined || i.country === REGION_ISO3[ref.region],
        }
      : undefined;
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
        : fromYears
          ? tx(
              `Reference yield (${ref!.yieldRegion}, ${ref!.year}) x expected fraction ${Math.round(i.yieldFraction * 100)} %; range between the poorest and the best tenth of the analysed years.`,
              `Năng suất tham chiếu (${ref!.yieldRegion}, ${ref!.year}) x tỉ lệ kỳ vọng ${Math.round(i.yieldFraction * 100)} %; khoảng dao động nằm giữa 10 % năm kém nhất và 10 % năm tốt nhất trong các năm đã phân tích.`,
            )
          : tx(
              `Reference yield (${ref!.yieldRegion}, ${ref!.year}) x expected fraction ${Math.round(i.yieldFraction * 100)} %; range +/- 20 % by default, not above the reference yield: the years were not analysed one by one for this crop.`,
              `Năng suất tham chiếu (${ref!.yieldRegion}, ${ref!.year}) x tỉ lệ kỳ vọng ${Math.round(i.yieldFraction * 100)} %; khoảng dao động +/- 20 % theo mặc định, không vượt năng suất tham chiếu: chưa phân tích từng năm cho cây này.`,
            ),
    },
    productionT: r2(productionT),
    priceUsdPerT: r2(price),
    revenueUsd: Math.round(revenueUsd),
    costUsd: Math.round(costUsd),
    marginUsd: Math.round(marginUsd),
    // The same rounding as the expected margin, so that the range brackets it exactly.
    marginLowUsd: Math.round(lowTHa * i.areaHa * price) - costUsd,
    marginHighUsd: Math.round(highTHa * i.areaHa * price) - costUsd,
    marginPct: revenueUsd > 0 ? Math.round((marginUsd / revenueUsd) * 1000) / 10 : 0,
    breakEvenYieldTHa: price > 0 ? r2(cost / price) : 0,
    sources: [
      ...(ref && usesReference ? ref.sources.map((s) => `REFERENCE VALUE (${ref.region}) - ${s}`) : []),
      ...(i.own?.yieldTHa != null ? ['yield: entered by the farmer'] : []),
      ...(i.own?.priceUsdPerT != null ? ['price: entered by the farmer'] : []),
      ...(i.own?.costUsdPerHa != null ? ['cost: entered by the farmer'] : []),
    ],
    usesReferenceValues: usesReference,
    ...(reference ? { reference } : {}),
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
    country: economicCountry(input.parcel),
    // The farmer's numbers describe the crop they grow, so they apply to the selected crop only.
    own: selected ? ownEconomics(gt) : undefined,
  });
}

/** Totals for a rotation: the seasons of `years` years, averaged per year and per hectare. */
export function strategyEconomics(seasons: SeasonEconomics[], years = 1, areaHa?: number): StrategyEconomics {
  const sum = (f: (s: SeasonEconomics) => number) => seasons.reduce((a, s) => a + f(s), 0) / Math.max(1, years);
  const perYear = { revenueUsd: Math.round(sum((s) => s.revenueUsd)), costUsd: Math.round(sum((s) => s.costUsd)), marginUsd: Math.round(sum((s) => s.marginUsd)) };
  const area = areaHa ?? Math.max(0, ...seasons.map((s) => s.areaHa));
  // The ends of the range add up: every season is taken to be poor, or good, in the same year.
  const ranged = area > 0 && seasons.length > 0 && seasons.every((s) => s.marginLowUsd != null && s.marginHighUsd != null);
  return {
    perYear,
    perHaMarginUsd: area > 0 ? Math.round(perYear.marginUsd / area) : 0,
    ...(ranged ? { perHaMarginLowUsd: Math.round(sum((s) => s.marginLowUsd!) / area), perHaMarginHighUsd: Math.round(sum((s) => s.marginHighUsd!) / area) } : {}),
    seasons,
  };
}

/** The relative change the sensitivity is computed for. A level to ask "what if" with, not a measured uncertainty (docs/ECONOMICS.md, section 6). */
export const SENSITIVITY_PCT = 0.2;

export interface MarginBase {
  /** Tonnes per hectare of the marketed product. */
  yieldTHa: number;
  priceUsdPerT: number;
  /** Operating cost per hectare and season. */
  costUsdPerHa: number;
  areaHa: number;
}

/** Margins in USD for the area given, to the cent. */
export interface MarginSensitivity {
  pct: number;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  /** The margin with one input lower, or higher, by `pct`, the two others as given. */
  price: { lower: number; higher: number };
  yield: { lower: number; higher: number };
  cost: { lower: number; higher: number };
  /** Price and yield lower and cost higher at once; and the reverse. */
  worstUsd: number;
  bestUsd: number;
  /** Price at which the margin is zero with the yield and cost given (cost / yield). Null without a yield. */
  breakEvenPriceUsdPerT: number | null;
  /** Yield at which the margin is zero with the price and cost given (cost / price). Null without a price. */
  breakEvenYieldTHa: number | null;
}

/**
 * The margin of a season when its price, yield or cost is off by `pct`, one at a time and all
 * together. Margin = yield x price x area - cost x area, as in `seasonEconomics`; the cost per
 * hectare does not depend on the yield there, so a yield and a price that are off act alike.
 */
export function marginSensitivity(base: MarginBase, pct = SENSITIVITY_PCT): MarginSensitivity {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const margin = (yieldFactor: number, priceFactor: number, costFactor: number) =>
    r2(base.yieldTHa * yieldFactor * base.priceUsdPerT * priceFactor * base.areaHa - base.costUsdPerHa * costFactor * base.areaHa);
  const lo = 1 - pct;
  const hi = 1 + pct;
  return {
    pct,
    revenueUsd: r2(base.yieldTHa * base.priceUsdPerT * base.areaHa),
    costUsd: r2(base.costUsdPerHa * base.areaHa),
    marginUsd: margin(1, 1, 1),
    price: { lower: margin(1, lo, 1), higher: margin(1, hi, 1) },
    yield: { lower: margin(lo, 1, 1), higher: margin(hi, 1, 1) },
    cost: { lower: margin(1, 1, lo), higher: margin(1, 1, hi) },
    worstUsd: margin(lo, lo, hi),
    bestUsd: margin(hi, hi, lo),
    breakEvenPriceUsdPerT: base.yieldTHa > 0 ? r2(base.costUsdPerHa / base.yieldTHa) : null,
    breakEvenYieldTHa: base.priceUsdPerT > 0 ? r2(base.costUsdPerHa / base.priceUsdPerT) : null,
  };
}

/**
 * The sensitivity of a season as it was computed: its revenue, cost and area as shown, so that the
 * margin "as assumed" is the season's own margin to the dollar. Null for a season without area.
 */
export function seasonSensitivity(e: Pick<SeasonEconomics, 'areaHa' | 'priceUsdPerT' | 'revenueUsd' | 'costUsd' | 'yield'>, pct = SENSITIVITY_PCT): MarginSensitivity | null {
  if (!(e.areaHa > 0)) return null;
  // The yield behind the rounded revenue; the yield as shown when there is no price to divide by.
  const yieldTHa = e.priceUsdPerT > 0 ? e.revenueUsd / e.priceUsdPerT / e.areaHa : e.yield.expectedTHa;
  return marginSensitivity({ yieldTHa, priceUsdPerT: e.priceUsdPerT, costUsdPerHa: e.costUsd / e.areaHa, areaHa: e.areaHa }, pct);
}

export interface RankFlip {
  /** The rotation that earns more as assumed, and the one that overtakes it. */
  ahead: string;
  behind: string;
  /** What has to move, for every rotation alike: prices or yields (they act alike), or costs. */
  driver: 'price-or-yield' | 'cost';
  /** Relative change at which the two earn the same: -0.12 is a fall by 12 %. */
  atChange: number;
}

/**
 * Pairs of rotations whose order by margin turns round when the prices (or yields), or the costs,
 * of all of them move by up to `pct` in the same direction. A rotation that spends a larger share
 * of its revenue loses more from a fall in prices, so the order can change although nothing about
 * the rotations did.
 */
export function rankFlips(rotations: { id: string; perYear: { revenueUsd: number; costUsd: number; marginUsd: number } }[], pct = SENSITIVITY_PCT): RankFlip[] {
  const out: RankFlip[] = [];
  const add = (ahead: string, behind: string, driver: RankFlip['driver'], factor: number) => {
    const change = factor - 1;
    if (Number.isFinite(factor) && factor > 0 && change !== 0 && Math.abs(change) <= pct) out.push({ ahead, behind, driver, atChange: Math.round(change * 1000) / 1000 });
  };
  for (let i = 0; i < rotations.length; i++)
    for (let j = 0; j < rotations.length; j++) {
      const a = rotations[i].perYear;
      const b = rotations[j].perYear;
      if (i === j || a.marginUsd <= b.marginUsd) continue;
      // Revenue x f - cost is equal for both at f = (cost difference) / (revenue difference); the same with revenue and cost swapped.
      if (a.revenueUsd !== b.revenueUsd) add(rotations[i].id, rotations[j].id, 'price-or-yield', (a.costUsd - b.costUsd) / (a.revenueUsd - b.revenueUsd));
      if (a.costUsd !== b.costUsd) add(rotations[i].id, rotations[j].id, 'cost', (a.revenueUsd - b.revenueUsd) / (a.costUsd - b.costUsd));
    }
  return out.sort((x, y) => Math.abs(x.atChange) - Math.abs(y.atChange) || x.ahead.localeCompare(y.ahead) || x.behind.localeCompare(y.behind) || x.driver.localeCompare(y.driver));
}
