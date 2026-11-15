import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { soilFacts } from './facts';

const load = (id: string): FieldTelemetry =>
  JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, groundTruth: ModelInput['groundTruth'] = {}): ModelInput {
  const parcel = getSampleParcel(id)!;
  return {
    parcel,
    telemetry: load(id),
    cropId: parcel.defaultCropId,
    groundTruth,
    priorities: ['soil'],
    today: '2026-11-14',
  };
}

describe('soilFacts (S0)', () => {
  it('preserves source facts, null values, and uncertainty', () => {
    const facts = soilFacts(inputFor('nevada-alfalfa'));
    const ph = facts.find((fact) => fact.key === 'ph');
    const depth = facts.find((fact) => fact.key === 'depth_cm');

    expect(ph).toMatchObject({ value: 8.8, sourceId: 'ssurgo', fromGrower: false });
    expect(ph?.uncertainty).toBeUndefined();
    expect(depth).toMatchObject({ value: null, sourceId: 'ssurgo', fromGrower: false });
  });

  it('lets a grower value replace an estimate and retains the estimate', () => {
    const facts = soilFacts(inputFor('daklak-coffee', { ph: 4.5 }));
    const ph = facts.find((fact) => fact.key === 'ph');

    expect(ph).toMatchObject({
      value: 4.5,
      estimate: 5.7,
      sourceId: 'ground-truth',
      fromGrower: true,
    });
    expect(ph?.sourceName.en).toBe('Your own measurement');
  });

  it('adds a grower-only value when telemetry has no corresponding fact', () => {
    const facts = soilFacts(inputFor('cantho-rice', { ecDsM: 4 }));
    const ec = facts.find((fact) => fact.key === 'ec_dsm');

    expect(ec).toMatchObject({ value: 4, sourceId: 'ground-truth', fromGrower: true });
    expect(facts.filter((fact) => fact.key === 'ec_dsm')).toHaveLength(1);
    expect(ec?.label.en).toBe('Electrical conductivity');
  });
});
