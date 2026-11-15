import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CountryCrops, FieldTelemetry } from '@/contracts';
import { getSampleParcel } from '@/data';
import { type CountryTableState, toModelInput } from './mission';

const parcel = getSampleParcel('cantho-rice')!;
const telemetry = JSON.parse(readFileSync('public/data/samples/cantho-rice.json', 'utf8')) as FieldTelemetry;
const state = { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: {}, priorities: ['profit' as const] };
const country: CountryCrops = { iso3: 'VNM', prevalence: { 'oryza-sativa': { level: 'major', match: 'exact', source: 'FAOSTAT QCL' } } };

describe('toModelInput', () => {
  it('carries the crop table of the country once it is loaded', () => {
    const ready: CountryTableState = { status: 'ready', country, iso3: 'VNM', iso2: 'VN', name: 'Viet Nam', source: 'FAOSTAT QCL', grown: 1 };
    const input = toModelInput({ ...state, countryTable: ready })!;
    expect(input.country).toBe(country);
    expect(input.country!.prevalence['oryza-sativa'].level).toBe('major');
  });

  it('is the same input as before the tables existed while there is no table', () => {
    const before = toModelInput(state)!;
    expect('country' in before).toBe(false);
    for (const status of ['idle', 'loading', 'error', 'missing'] as const) expect(toModelInput({ ...state, countryTable: { status } })).toEqual(before);
  });

  it('gives nothing until the telemetry is there', () => {
    expect(toModelInput({ ...state, telemetry: null })).toBeNull();
  });
});
