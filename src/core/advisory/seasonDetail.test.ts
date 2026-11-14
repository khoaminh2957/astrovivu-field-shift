import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput, RotationSeason, RotationStrategy } from '@/contracts';
import { getCrop } from '@/core/crops';
import { getSampleParcel } from '@/data/samples';
import { monthlyNormals } from '@/lib/climate';
import { buildRotations } from './rotation';
import { fallowSeasons, sumNormal } from './seasonDetail';

const IDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
const load = (id: string): FieldTelemetry => JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, gt = true): ModelInput {
  const p = getSampleParcel(id)!;
  const dgt = (p as { defaultGroundTruth?: ModelInput['groundTruth'] }).defaultGroundTruth;
  return { parcel: p, telemetry: load(id), cropId: p.defaultCropId, groundTruth: gt ? { ...(dgt ?? {}) } : {}, priorities: ['profit', 'water', 'soil'], today: '2026-11-14' };
}

const lenOf = (s: RotationSeason) => ((s.endMonth - s.startMonth + 12) % 12) + 1;
const monthsOf = (s: RotationSeason) => Array.from({ length: lenOf(s) }, (_, i) => ((s.startMonth - 1 + i) % 12) + 1);
const isFallow = (s: RotationSeason) => s.cropId === 'fallow';
/** Inter-row, companion and converted parts occupy a share of the field; the share is written in the label. */
const hasShares = (r: RotationStrategy) => r.seasons.some((s) => /% of area/.test(s.label.en));

describe.each(IDS)('per-season detail on real sample %s', (id) => {
  for (const gt of [true, false]) {
    const input = inputFor(id, gt);
    const normals = monthlyNormals(input.telemetry.climateHistory);
    const historyYears = input.telemetry.climateHistory?.length ?? 0;
    const rotations = buildRotations(input);
    const tag = `ground truth ${gt}`;

    it(`every season has a role, a 0-based year and the full crop name (${tag})`, () => {
      expect(rotations.length).toBeGreaterThanOrEqual(3);
      for (const r of rotations) {
        for (const s of r.seasons) {
          const where = `${r.id} ${s.cropId} ${s.startMonth}-${s.endMonth}`;
          expect(s.detail?.role, where).toBeTruthy();
          expect(Number.isInteger(s.year), where).toBe(true);
          expect(s.year!, where).toBeGreaterThanOrEqual(0);
          expect(s.year!, where).toBeLessThan(r.years);
          expect(s.detail!.role === 'fallow', where).toBe(isFallow(s));
          if (isFallow(s)) continue;
          const c = getCrop(s.cropId)!;
          expect(s.label.en.startsWith(c.names.en), where).toBe(true);
          expect(s.label.vi.startsWith(c.names.vi ?? c.names.en), where).toBe(true);
          expect(s.detail!.role === 'cover', where).toBe(c.category === 'cover');
          if (s.detail!.role === 'perennial') expect(c.lifeSpan, where).not.toBe('annual');
          if (s.detail!.role === 'legume') {
            expect(c.rotation?.nitrogenFixing, where).toBe(true);
            expect(s.detail!.nitrogenKgHa, where).toBeGreaterThan(0);
          }
          if (!c.rotation?.nitrogenFixing) expect(s.detail!.nitrogenKgHa, where).toBeUndefined();
        }
      }
    });

    it(`numbers are in range and rain is the sum of the monthly normals (${tag})`, () => {
      for (const r of rotations) {
        for (const s of r.seasons) {
          const d = s.detail!;
          const where = `${r.id} ${s.cropId} ${s.startMonth}-${s.endMonth}`;
          const rain = monthsOf(s).reduce((a, m) => a + normals[m - 1].rainMm!, 0);
          expect(d.rainMm, where).toBe(Math.round(rain));
          if (isFallow(s)) {
            // Nothing grows, so nothing but the rain and the sentence is stated.
            expect(Object.keys(d).sort(), where).toEqual(['rainMm', 'reason', 'role']);
            continue;
          }
          expect(d.suitability, where).toBeGreaterThanOrEqual(0);
          expect(d.suitability, where).toBeLessThanOrEqual(100);
          expect(d.waterNeedMm, where).toBeGreaterThan(0);
          if (d.metInYears) {
            expect(d.metInYears.of, where).toBe(historyYears);
            expect(d.metInYears.met, where).toBeGreaterThanOrEqual(0);
            expect(d.metInYears.met, where).toBeLessThanOrEqual(d.metInYears.of);
          }
        }
      }
    });

    it(`every season carries a one-sentence reason in English and Vietnamese (${tag})`, () => {
      for (const r of rotations) {
        for (const s of r.seasons) {
          const reason = s.detail!.reason!;
          const where = `${r.id} ${s.cropId} ${s.startMonth}-${s.endMonth}`;
          for (const text of [reason.en, reason.vi]) {
            expect(text.length, where).toBeGreaterThan(20);
            expect(text.length, where).toBeLessThan(300);
            expect(text.endsWith('.'), where).toBe(true);
            expect(text, where).not.toMatch(/undefined|NaN|null|Infinity/);
          }
          expect(reason.vi, where).not.toBe(reason.en);
          // The sentence quotes the same rain figure as the detail.
          if (s.detail!.rainMm != null) expect(reason.en, where).toContain(`${s.detail!.rainMm} mm`);
          if (s.detail!.role === 'cash' && s.detail!.waterNeedMm != null) expect(reason.en, where).toContain(`${s.detail!.waterNeedMm} mm`);
          if (s.detail!.role === 'legume') expect(reason.en, where).toContain(`${s.detail!.nitrogenKgHa} kg N/ha`);
        }
      }
    });

    it(`detail agrees with economics.seasons and the strategy metrics (${tag})`, () => {
      for (const r of rotations) {
        const crops = r.seasons.filter((s) => !isFallow(s));
        // Seasons with economics appear in economics.seasons in the same order.
        const priced = crops.filter((s) => s.detail!.marginUsdPerHa != null);
        expect(priced.map((s) => s.cropId), r.id).toEqual(r.economics.seasons.map((e) => e.cropId));
        priced.forEach((s, i) => {
          const e = r.economics.seasons[i];
          expect(s.detail!.marginUsdPerHa, r.id).toBe(Math.round(e.marginUsd / e.areaHa));
          if (s.detail!.yieldTHa != null) expect(s.detail!.yieldTHa, r.id).toBe(e.yield.expectedTHa);
          else expect(e.yield.expectedTHa, r.id).toBe(0);
        });
        // Fallow seasons are exactly the months the ground-cover metric counts as bare.
        const bare = r.seasons.filter(isFallow).reduce((a, s) => a + lenOf(s), 0);
        expect(Math.round(100 * (1 - bare / (12 * r.years))), r.id).toBe(r.metrics.groundCoverPct);
        if (hasShares(r)) continue;
        // Full-area strategies: the per-season figures add up to the strategy metrics.
        const months = crops.reduce((a, s) => a + lenOf(s), 0);
        expect(Math.round(crops.reduce((a, s) => a + s.detail!.suitability! * lenOf(s), 0) / months), r.id).toBe(r.metrics.suitability);
        expect(Math.round(crops.reduce((a, s) => a + (s.detail!.nitrogenKgHa ?? 0), 0) / r.years), r.id).toBe(r.metrics.nitrogenKgHaYr);
        // Each figure is rounded on its own, so the sums agree to within half a unit per season.
        const slack = crops.length / (2 * r.years) + 0.5;
        expect(Math.abs(crops.reduce((a, s) => a + s.detail!.waterNeedMm!, 0) / r.years - r.metrics.waterUseMm), r.id).toBeLessThanOrEqual(slack);
        if (priced.length === crops.length) expect(Math.abs(priced.reduce((a, s) => a + s.detail!.marginUsdPerHa!, 0) / r.years - r.metrics.marginUsdPerHaYr), r.id).toBeLessThanOrEqual(slack + 0.5 / input.parcel.areaHa);
      }
    });
  }
});

describe('per-season detail helpers', () => {
  const normals = monthlyNormals(load('cantho-rice').climateHistory);

  it('sums a season that wraps over December', () => {
    const expected = [11, 12, 1, 2].reduce((a, m) => a + normals[m - 1].rainMm!, 0);
    expect(sumNormal(normals, 11, 4, 'rainMm')).toBeCloseTo(expected, 9);
    expect(sumNormal(normals, 1, 12, 'rainMm')).toBeCloseTo(normals.reduce((a, m) => a + m.rainMm!, 0), 9);
  });

  it('returns null rather than a partial sum when a month has no value', () => {
    const holed = normals.map((m) => (m.month === 12 ? { ...m, rainMm: null } : m));
    expect(sumNormal(holed, 11, 4, 'rainMm')).toBeNull();
    expect(sumNormal(holed, 1, 11, 'rainMm')).not.toBeNull();
  });

  it('turns uncovered months into fallow seasons, wrapping the year end', () => {
    const fallow = fallowSeasons([new Set([5, 6, 7, 8]), new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), new Set([1, 2, 6, 7])], () => undefined, normals);
    expect(fallow.map((s) => [s.year, s.startMonth, s.endMonth])).toEqual([
      [0, 9, 4],
      [2, 3, 5],
      [2, 8, 12],
    ]);
    for (const s of fallow) expect(s.detail).toMatchObject({ role: 'fallow' });
  });
});

describe('per-season detail without a climate record', () => {
  it('leaves rain, water need and years-met undefined instead of assuming them', () => {
    const base = inputFor('cantho-rice');
    const rotations = buildRotations({ ...base, telemetry: { ...base.telemetry, climateHistory: undefined } });
    expect(rotations.length).toBeGreaterThan(0);
    for (const r of rotations) {
      for (const s of r.seasons) {
        expect(s.detail?.role).toBeTruthy();
        expect(s.detail!.rainMm).toBeUndefined();
        expect(s.detail!.waterNeedMm).toBeUndefined();
        expect(s.detail!.metInYears).toBeUndefined();
        expect(s.detail!.reason?.en).not.toMatch(/undefined|NaN|null/);
        expect(s.detail!.reason?.en).not.toMatch(/\d mm/);
      }
    }
  });
});
