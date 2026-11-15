import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FarmerPriority, FieldTelemetry, GroundTruth, ModelInput } from '@/contracts';
import { buildRotations, evaluate, meetsConstraints, profitSearchFor, type Plan } from '@/core/advisory/rotation';
import { monthsFrom } from '@/core/advisory/util';
import { getCrop } from '@/core/crops';
import { getSampleParcel } from '@/data/samples';

/** A demo field, parsed afresh on every call so that nothing is shared between two runs. */
function field(id: string, priorities: FarmerPriority[] = ['profit', 'water', 'soil'], own: Partial<GroundTruth> = {}): ModelInput {
  const parcel = getSampleParcel(id)!;
  const defaults = (parcel as { defaultGroundTruth?: GroundTruth }).defaultGroundTruth ?? {};
  const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
  return { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: { ...defaults, ...own }, priorities, today: '2026-11-14' };
}

/** The two demo fields with an annual rotation. On the other two the main crop is a perennial stand, which the search does not replace. */
const ANNUAL = ['cantho-rice', 'iowa-corn-soy'] as const;

const byYear = (plans: Plan[]): Plan[][] => [0, 1].map((y) => plans.filter((p) => p.year === y).sort((a, b) => a.start - b.start)).filter((y) => y.length);

describe.each(ANNUAL)('most profitable sequence on %s', (id) => {
  const { found, current, ctx } = profitSearchFor(field(id));

  it('finds a sequence and says how many it compared', () => {
    expect(found).not.toBeNull();
    expect(found!.examined.oneYear).toBeGreaterThan(0);
    expect(found!.plans.length).toBeGreaterThan(0);
    expect([1, 2]).toContain(found!.years);
  });

  it('plans only seasons the field suits, without overlap, and no pest group twice in a row', () => {
    const years = byYear(found!.plans);
    for (const plans of years) {
      const months = plans.flatMap((p) => monthsFrom(p.start, p.len).filter((_, i) => p.start + i <= 12));
      expect(new Set(months).size, 'two seasons share a month').toBe(months.length);
      for (const p of plans) expect(ctx.fit(p.cropId).s[p.start - 1], `${p.cropId} sown in month ${p.start}`).toBeGreaterThanOrEqual(55);
    }
    const sequence = years.flat();
    for (let i = 0; i < sequence.length; i++) {
      const next = sequence[(i + 1) % sequence.length];
      if (sequence.length > 1) expect(getCrop(sequence[i].cropId)!.rotation!.pestGroup, `${sequence[i].cropId} then ${next.cropId}`).not.toBe(getCrop(next.cropId)!.rotation!.pestGroup);
    }
  });

  it('leaves soil health and water fit no worse than the current rotation', () => {
    const chosen = evaluate(ctx, { kind: 'income', plans: found!.plans, years: found!.years, why: [] }, current, 'income');
    expect(meetsConstraints(chosen, current, false)).toEqual({ soil: true, water: true, risk: true });
    expect(chosen.metrics.soilHealth).toBeGreaterThanOrEqual(current.metrics.soilHealth);
    expect(chosen.metrics.waterFit).toBeGreaterThanOrEqual(current.metrics.waterFit);
    expect(chosen.metrics.marginUsdPerHaYr).toBeCloseTo(found!.marginUsdPerHaYr, -1);
  });

  it('earns at least as much as the current rotation and as any single crop that passes', () => {
    expect(found!.marginUsdPerHaYr).toBeGreaterThanOrEqual(current.metrics.marginUsdPerHaYr);
    for (const p of found!.plans) {
      const alone = evaluate(ctx, { kind: 'income', plans: [{ ...p, year: 0 }], years: 1, why: [] }, current, 'income');
      const ok = meetsConstraints(alone, current, false);
      if (ok.soil && ok.water) expect(alone.metrics.marginUsdPerHaYr, `${p.cropId} alone`).toBeLessThanOrEqual(found!.marginUsdPerHaYr + 1);
    }
  });

  it('gives the same answer when run again', () => {
    expect(profitSearchFor(field(id)).found).toEqual(found);
    expect(buildRotations(field(id))).toEqual(buildRotations(field(id)));
  });

  it('becomes the income rotation of the report, with its reasons in both languages', () => {
    const income = buildRotations(field(id)).find((r) => r.kind === 'income')!;
    expect(income.seasons.filter((s) => s.cropId !== 'fallow').map((s) => `${s.cropId}@${s.startMonth}/${s.year}`).sort()).toEqual(found!.plans.map((p) => `${p.cropId}@${p.start}/${p.year}`).sort());
    expect(income.why.length).toBeGreaterThanOrEqual(2);
    for (const w of income.why) expect(w.en && w.vi).toBeTruthy();
    for (const k of ['evidence', 'benefits', 'gaps', 'risks'] as const) expect(income[k].length, k).toBeGreaterThan(0);
  });

  it('does not raise the risk score when the grower ranks low risk', () => {
    const cautious = profitSearchFor(field(id, ['profit', 'risk', 'soil']));
    expect(cautious.found!.riskCapped).toBe(true);
    const chosen = evaluate(cautious.ctx, { kind: 'income', plans: cautious.found!.plans, years: cautious.found!.years, why: [] }, cautious.current, 'income');
    expect(chosen.metrics.risk).toBeLessThanOrEqual(cautious.current.metrics.risk);
  });
});

describe('what the search does not do', () => {
  it('compares nothing where no crop has a price and a cost for the region, and says nothing instead of borrowing figures', () => {
    const iowa = field('iowa-corn-soy');
    // The same field moved to a country without reference economics.
    const elsewhere: ModelInput = { ...iowa, parcel: { ...iowa.parcel, isUS: false, centroid: [2.5, 47.5], place: { label: 'Centre-Val de Loire, France', country: 'France', countryCode: 'FR' } } };
    expect(profitSearchFor(elsewhere).found).toBeNull();
    const rotations = buildRotations(elsewhere);
    expect(rotations.length).toBeGreaterThanOrEqual(3);
    // The income rotation is still built, on the figures of another region, and says so.
    const income = rotations.find((r) => r.kind === 'income');
    if (income) expect(income.why.map((w) => w.en).join(' ')).toContain('figures of another region');
  });

  it('names the crops it could not compare for lack of a price or cost', () => {
    const { found } = profitSearchFor(field('cantho-rice'));
    expect(found!.noEconomics.length).toBeGreaterThan(0);
    expect(found!.noEconomics).toContain('vigna-radiata');
    const why = buildRotations(field('cantho-rice')).find((r) => r.kind === 'income')!.why.map((w) => w.en).join(' ');
    expect(why).toContain('No figure of another region was used');
  });

  it('uses the grower\'s own price for the crop they grow', () => {
    const reference = profitSearchFor(field('cantho-rice')).found!;
    // Rice at four times the reference price: every sequence with rice earns more, so the best margin rises.
    const dear = profitSearchFor(field('cantho-rice', undefined, { pricePerT: 900, currency: 'USD' })).found!;
    expect(dear.bestMarginUsdPerHaYr).toBeGreaterThan(reference.bestMarginUsdPerHaYr);
    expect(dear.plans.some((p) => p.cropId === 'oryza-sativa')).toBe(true);
  });
});
