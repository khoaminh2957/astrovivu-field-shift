import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { computeScoreTimeline } from '@/core/scoring';
import { diagnoseSoil } from './diagnosis';

const IDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
const load = (id: string): FieldTelemetry => JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, groundTruth: ModelInput['groundTruth'] = {}): ModelInput {
  const parcel = getSampleParcel(id)!;
  return { parcel, telemetry: load(id), cropId: parcel.defaultCropId, groundTruth, priorities: ['soil'], today: '2026-11-14' };
}

describe('S1 soil diagnosis', () => {
  for (const id of IDS) {
    it(`diagnoses all six soil factors for ${id}`, () => {
      const input = inputFor(id);
      const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
      expect(diagnosis?.gaps.map((gap) => gap.key)).toEqual(['ph', 'texture', 'drainage', 'depth', 'salinity', 'fertility']);
      for (const gap of diagnosis?.gaps ?? []) {
        expect(gap.label.en).toBeTruthy();
        expect(gap.label.vi).toBeTruthy();
      }
    });
  }

  it('reports missing data without inventing a score', () => {
    const input = inputFor('cantho-rice');
    const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
    expect(diagnosis?.gaps.find((gap) => gap.key === 'drainage')?.status).toBe('unknown');
    expect(diagnosis?.gaps.find((gap) => gap.key === 'depth')?.status).toBe('unknown');
    expect(diagnosis?.gaps.find((gap) => gap.key === 'salinity')?.status).toBe('unknown');
  });

  it('uses crop drainage requirements instead of treating well-drained soil as universally optimal', () => {
    const input = inputFor('cantho-rice', { drainage: 'well' });
    const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
    const drainage = diagnosis?.gaps.find((gap) => gap.key === 'drainage');
    expect(drainage?.status).toBe('outside');
    expect(drainage?.limiting).toBe(false);
  });

  it('uses a grower pH measurement in the diagnosis', () => {
    const input = inputFor('daklak-coffee', { ph: 4.5 });
    const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
    const ph = diagnosis?.gaps.find((gap) => gap.key === 'ph');
    expect(ph?.facts[0].value).toBe(4.5);
    expect(ph?.status).toBe('tolerated');
  });

  it('uses the score summary for Nevada limiting and reports the organic-matter conflict', () => {
    const input = inputFor('nevada-alfalfa');
    const score = computeScoreTimeline(input);
    const diagnosis = diagnoseSoil(input, score);
    expect(diagnosis?.limitingKey).toBeNull();
    expect(diagnosis?.gaps.find((gap) => gap.key === 'ph')).toMatchObject({ status: 'tolerated', gap: { amount: 0.6, direction: 'lower' }, limiting: false });
    expect(diagnosis?.conflicts[0].en).toContain('1.5%');
    expect(diagnosis?.conflicts[0].en).toContain('3.1%');
  });

  it('reports pH uncertainty endpoints and unknown soil factors for Can Tho', () => {
    const input = inputFor('cantho-rice');
    const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
    expect(diagnosis?.limitingKey).toBeNull();
    expect(diagnosis?.gaps.find((gap) => gap.key === 'ph')?.gapAtEnds).toEqual([{ amount: 1.3, unit: 'pH', direction: 'raise' }, { amount: 1.2, unit: 'pH', direction: 'lower' }]);
    expect(diagnosis?.gaps.filter((gap) => ['drainage', 'depth', 'salinity'].includes(gap.key)).every((gap) => gap.status === 'unknown')).toBe(true);
  });
});
