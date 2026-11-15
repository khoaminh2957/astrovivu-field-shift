import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, GroundTruth, ModelInput } from '@/contracts';
import { computeScoreTimeline } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { soilAnswer } from './answer';
import { soilPlan } from './plan';

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

describe('soilAnswer (S14 #74)', () => {
  it('soybean example on cantho-rice (cropId = glycine-max, groundTruth.ph = 4.8): recommends liming [5, 8] t/ha and mentions soybean and the dose range in summary', () => {
    const input = demo('cantho-rice');
    const res = soilAnswer(input, { cropId: 'glycine-max', groundTruth: { ph: 4.8 } });

    expect(res.diagnosis).not.toBeNull();
    const phItem = res.plan.items.find((i) => i.metric === 'ph');
    expect(phItem).toBeDefined();
    expect(phItem!.title.en.toLowerCase()).toContain('lim');
    expect(phItem!.rateRange).toEqual({ min: 5, max: 8, unit: 't/ha' });

    const allEn = res.summary.map((s) => s.en).join(' ');
    const allVi = res.summary.map((s) => s.vi).join(' ');
    expect(allEn).toContain('Soybean');
    expect(allVi).toContain('Đậu nành');
    expect(allEn).toContain('5-8 t/ha');
    expect(allVi).toContain('5-8 t/ha');
    expect(allVi).toContain('cần kiểm tra tại chỗ');
  });

  it('every number appearing in summary (both en and vi) is present in JSON.stringify({ diagnosis, plan })', () => {
    const cases = [
      soilAnswer(demo('cantho-rice'), { cropId: 'glycine-max', groundTruth: { ph: 4.8 } }),
      soilAnswer(demo('daklak-coffee'), { groundTruth: { ph: 4.5 } }),
      soilAnswer(demo('iowa-corn-soy')),
      soilAnswer(demo('nevada-alfalfa')),
    ];

    for (const res of cases) {
      const blob = JSON.stringify({ diagnosis: res.diagnosis, plan: res.plan });
      expect(res.summary.length).toBeGreaterThanOrEqual(3);
      expect(res.summary.length).toBeLessThanOrEqual(6);

      for (const s of res.summary) {
        const numsEn = s.en.match(/\d+(?:\.\d+)?/g) ?? [];
        const numsVi = s.vi.match(/\d+(?:\.\d+)?/g) ?? [];
        for (const n of [...numsEn, ...numsVi]) {
          expect(blob, `expected number ${n} to exist in diagnosis/plan JSON`).toContain(n);
        }
      }
    }
  });

  it('returns a pure JSON-serializable object: JSON.parse(JSON.stringify(result)) equals result', () => {
    const res = soilAnswer(demo('cantho-rice'), { cropId: 'glycine-max', groundTruth: { ph: 4.8 } });
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });

  it('without opts, plan equals soilPlan(input, score) from S2 (#43)', () => {
    for (const id of ['cantho-rice', 'daklak-coffee', 'iowa-corn-soy', 'nevada-alfalfa'] as const) {
      const input = demo(id);
      const score = computeScoreTimeline(input);
      const res = soilAnswer(input);
      expect(res.plan).toEqual(soilPlan(input, score));
    }
  });

  it('returns diagnosis null and states no data in summary when cropId is not in the catalogue', () => {
    const input = demo('cantho-rice');
    const res = soilAnswer(input, { cropId: 'non-existent-crop-999' });

    expect(res.diagnosis).toBeNull();
    expect(res.plan.items).toEqual([]);
    expect(res.summary.length).toBeGreaterThanOrEqual(1);
    expect(res.summary[0]!.en.toLowerCase()).toContain('no data');
    expect(res.summary[0]!.vi.toLowerCase()).toContain('không có dữ liệu');
  });
});
