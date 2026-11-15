import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, GroundTruth, ModelInput } from '@/contracts';
import { computeScoreTimeline } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { measurementPriorities } from './measureFirst';

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

describe('measurementPriorities (S11 #52)', () => {
  it('cantho-rice: ph has changesAdvice true and ranks ahead of every factor with changesAdvice false', () => {
    const input = demo('cantho-rice');
    const score = computeScoreTimeline(input);
    const list = measurementPriorities(input, score);

    const phItem = list.find((item) => item.factor === 'ph');
    expect(phItem).toBeDefined();
    expect(phItem!.changesAdvice).toBe(true);
    expect(phItem!.scoreSpread).toBeGreaterThan(0);

    const firstFalseIdx = list.findIndex((item) => !item.changesAdvice);
    const phIdx = list.findIndex((item) => item.factor === 'ph');
    if (firstFalseIdx !== -1) {
      expect(phIdx).toBeLessThan(firstFalseIdx);
    }
  });

  it('cantho-rice: drainage, depth, and salinity are present with reason stating no reading is held ("chưa có số nào")', () => {
    const input = demo('cantho-rice');
    const list = measurementPriorities(input);

    for (const factor of ['drainage', 'depth', 'salinity'] as const) {
      const item = list.find((x) => x.factor === factor);
      expect(item, `expected ${factor} in list`).toBeDefined();
      expect(item!.reason.vi.toLowerCase()).toContain('chưa có số nào');
      expect(item!.reason.en.toLowerCase()).toContain('no reading');
    }
  });

  it('iowa-corn-soy: ph (from SSURGO, without uncertainty interval) has changesAdvice false and reason stating source does not publish an interval', () => {
    const input = demo('iowa-corn-soy');
    const list = measurementPriorities(input);

    const phItem = list.find((x) => x.factor === 'ph');
    expect(phItem).toBeDefined();
    expect(phItem!.changesAdvice).toBe(false);
    expect(phItem!.reason.vi).toContain('không công bố khoảng bất định');
    expect(phItem!.reason.en).toContain('does not publish an uncertainty interval');
  });

  it('omits ph when the grower has already entered groundTruth.ph', () => {
    const input = demo('cantho-rice', { ph: 5.8 });
    const list = measurementPriorities(input);

    expect(list.find((x) => x.factor === 'ph')).toBeUndefined();
  });

  it('every reason, method, and label has both English and Vietnamese text', () => {
    for (const id of ['cantho-rice', 'daklak-coffee', 'iowa-corn-soy', 'nevada-alfalfa'] as const) {
      const list = measurementPriorities(demo(id));
      expect(list.length).toBeGreaterThan(0);
      for (const item of list) {
        expect(item.label.en.trim().length).toBeGreaterThan(0);
        expect(item.label.vi.trim().length).toBeGreaterThan(0);
        expect(item.reason.en.trim().length).toBeGreaterThan(0);
        expect(item.reason.vi.trim().length).toBeGreaterThan(0);
        expect(item.method.en.trim().length).toBeGreaterThan(0);
        expect(item.method.vi.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
