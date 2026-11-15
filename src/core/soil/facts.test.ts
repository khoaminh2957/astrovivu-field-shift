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
  it('keeps the four sample fact counts', () => {
    expect(['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'].map((id) => soilFacts(inputFor(id)).length)).toEqual([10, 10, 17, 17]);
  });

  it('preserves source facts, null values, and uncertainty', () => {
    const facts = soilFacts(inputFor('nevada-alfalfa'));
    const ph = facts.find((fact) => fact.key === 'ph');
    const depth = facts.find((fact) => fact.key === 'depth_cm');

    expect(ph).toMatchObject({ value: 8.8, sourceId: 'ssurgo', fromGrower: false });
    expect(ph?.uncertainty).toBeUndefined();
    expect(depth).toMatchObject({ value: null, sourceId: 'ssurgo', fromGrower: false });
  });

  it('reads Can Tho from SoilGrids with its uncertainty range and adds no row the source lacks', () => {
    const facts = soilFacts(inputFor('cantho-rice'));
    const ph = facts.find((fact) => fact.key === 'ph');

    expect(ph).toMatchObject({ value: 6.1, sourceId: 'soilgrids', uncertainty: [4.2, 8.2], fromGrower: false });
    expect(ph?.estimate).toBeUndefined();
    for (const key of ['ec_dsm', 'drainage_class', 'depth_cm', 'om_pct']) {
      expect(facts.some((fact) => fact.key === key)).toBe(false);
    }
  });

  it('keeps the source of each Nevada row, SSURGO or SoilGrids', () => {
    const soc = soilFacts(inputFor('nevada-alfalfa')).find((fact) => fact.key === 'soc_gkg');

    expect(soc).toMatchObject({ value: 18.2, unit: 'g/kg', sourceId: 'soilgrids', uncertainty: [3.1, 59.8], fromGrower: false });
  });

  it('names every row and every source in both languages', () => {
    for (const id of ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa']) {
      const facts = soilFacts(inputFor(id, { ph: 6, organicMatterPct: 2, texture: 'medium', drainage: 'well', ecDsM: 1, soilDepthCm: 80 }));
      for (const fact of facts) {
        expect(fact.label.en, `${id} ${fact.key}`).toBeTruthy();
        expect(fact.label.vi, `${id} ${fact.key}`).toBeTruthy();
        expect(fact.sourceName.en, `${id} ${fact.key}`).toBeTruthy();
        expect(fact.sourceName.vi, `${id} ${fact.key}`).toBeTruthy();
      }
    }
  });

  it('lets a grower value replace an estimate and retains the estimate', () => {
    const facts = soilFacts(inputFor('daklak-coffee', { ph: 4.5 }));
    const ph = facts.find((fact) => fact.key === 'ph');

    expect(facts).toHaveLength(10);
    expect(ph?.uncertainty).toBeUndefined();

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

    expect(facts).toHaveLength(11);
    expect(facts.at(-1)?.key).toBe('ec_dsm');
    expect(ec).toMatchObject({ value: 4, sourceId: 'ground-truth', fromGrower: true });
    expect(ec?.estimate).toBeUndefined();
    expect(facts.filter((fact) => fact.key === 'ec_dsm')).toHaveLength(1);
    expect(ec?.label.en).toBe('Electrical conductivity');
  });
});
