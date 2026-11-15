import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, GroundTruth, ModelInput, RotationStrategy } from '@/contracts';
import { buildRotations } from '@/core/advisory/rotation';
import { computeScoreTimeline } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { estimateSeasonEconomics, getCurrency, ownEconomics } from './index';

const RATE = getCurrency('VND').perUsd;

/** The Cần Thơ rice field of the demo, with the grower's own numbers on top of its defaults. */
function canTho(own: Partial<GroundTruth>): ModelInput {
  const parcel = getSampleParcel('cantho-rice')!;
  const defaults = (parcel as { defaultGroundTruth?: GroundTruth }).defaultGroundTruth ?? {};
  const telemetry = JSON.parse(readFileSync('public/data/samples/cantho-rice.json', 'utf8')) as FieldTelemetry;
  return { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: { ...defaults, ...own }, priorities: ['profit', 'water', 'soil'], today: '2026-11-14' };
}

const current = (input: ModelInput): RotationStrategy => buildRotations(input).find((r) => r.kind === 'current')!;
/** Seasons of the crop the grower grows, in the rotation they have now. */
const ownSeasons = (input: ModelInput) => current(input).economics.seasons.filter((s) => s.cropId === input.cropId);

// 280 USD/t and 900 USD/ha, and the same amounts in dong at the rate the app uses.
const USD = { pricePerT: 280, costPerHa: 900, currency: 'USD' } as const;
const VND = { pricePerT: 280 * RATE, costPerHa: 900 * RATE, currency: 'VND' } as const;

describe('the grower\'s own price and cost', () => {
  it('are converted from dong, and taken as dollars when no currency is given', () => {
    expect(ownEconomics(VND)).toEqual({ yieldTHa: undefined, priceUsdPerT: 280, costUsdPerHa: 900 });
    expect(ownEconomics(USD)).toEqual({ yieldTHa: undefined, priceUsdPerT: 280, costUsdPerHa: 900 });
    expect(ownEconomics({ pricePerT: 280, lastYieldTHa: 6.1 })).toEqual({ yieldTHa: 6.1, priceUsdPerT: 280, costUsdPerHa: undefined });
    expect(ownEconomics({ currency: 'VND' })).toEqual({ yieldTHa: undefined, priceUsdPerT: undefined, costUsdPerHa: undefined });
  });

  it('give the same season economics in dollars and in dong', () => {
    const usd = canTho(USD);
    const vnd = canTho(VND);
    expect(estimateSeasonEconomics(vnd, computeScoreTimeline(vnd))).toEqual(estimateSeasonEconomics(usd, computeScoreTimeline(usd)));
  });

  it('replace the reference values in the current rotation, in dong as in dollars', () => {
    const reference = ownSeasons(canTho({}));
    const usd = ownSeasons(canTho(USD));
    const vnd = ownSeasons(canTho(VND));
    expect(usd.length).toBeGreaterThan(0);
    // Entered in dong, the numbers used to be dropped here and the reference came back.
    expect(vnd).toEqual(usd);
    for (const season of vnd) {
      expect(season.priceUsdPerT).toBe(280);
      expect(season.costUsd).toBe(Math.round(900 * season.areaHa));
      expect(season.sources).toContain('price: entered by the farmer');
    }
    expect(vnd.map((s) => s.marginUsd)).not.toEqual(reference.map((s) => s.marginUsd));
    expect(current(canTho(VND)).economics.perYear).toEqual(current(canTho(USD)).economics.perYear);
  });
});
