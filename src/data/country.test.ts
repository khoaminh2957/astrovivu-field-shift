import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankCropLists } from '@/core/scoring';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { buildCountryTables } from '../../scripts/crops/country-tables';
import { countryCropsFromAtlas } from '../../scripts/crops/country-crops';
import { setCacheEnabled } from './cache';
import { loadCountryCrops } from './country';
import { type CountryIndexFile, type CountryTableFile, expandCountryTable, isCountryTableFile } from './countryTable';
import { getSampleParcel } from './samples';

const DIR = 'public/data/crops/country';
const onDisk = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}/${name}`, 'utf8')) as T;
/** As JSON carries it: a missing figure is left out, not written as undefined. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('country crop tables on disk', () => {
  const index = onDisk<CountryIndexFile>('index.json');

  it.each(['VNM', 'USA', 'IND', 'BRA'])('the file of %s gives back every record of the atlas', (iso3) => {
    const file = onDisk<CountryTableFile>(`${iso3}.json`);
    expect(isCountryTableFile(file)).toBe(true);
    expect(plain(expandCountryTable(file))).toEqual(plain(countryCropsFromAtlas(iso3)));
  });

  it('are what the build writes from the atlas today', () => {
    // The two-letter codes come from a downloaded list that is not in the repository: they are taken
    // from the index here, so the test checks every record, count and hash, and not the codes.
    const codes = new Map(Object.entries(index.countries).map(([iso2, c]) => [c.iso3, iso2]));
    const { files, index: built, withoutIso2 } = buildCountryTables(undefined, codes);
    expect(built).toEqual(index);
    expect(withoutIso2).toEqual([]);
    expect(files.size).toBe(Object.keys(index.countries).length);
    for (const [iso3, file] of files) expect(plain(file), iso3).toEqual(onDisk(`${iso3}.json`));
  });

  it('index the countries by two-letter code', () => {
    expect(index.countries.VN).toMatchObject({ iso3: 'VNM', name: 'Viet Nam' });
    expect(index.countries.US).toMatchObject({ iso3: 'USA' });
    expect(index.source).toBe('FAOSTAT QCL');
    // Rice is the largest crop of Viet Nam; chickpea is not reported there.
    const vnm = expandCountryTable(onDisk<CountryTableFile>('VNM.json'));
    expect(vnm.prevalence['oryza-sativa']).toMatchObject({ level: 'major', match: 'exact', rankInCountry: 1, years: [2022, 2024] });
    expect(vnm.prevalence['cicer-arietinum']).toEqual({ level: 'absent', match: 'exact', itemReported: false, source: 'FAOSTAT QCL' });
    expect(vnm.prevalence['raphanus-sativus']).toMatchObject({ level: 'unknown', match: 'group', itemReported: true });
  });

  it('rejects an answer that is not a country file', () => {
    expect(isCountryTableFile('<!doctype html>')).toBe(false);
    expect(isCountryTableFile({ iso3: 'VNM' })).toBe(false);
    expect(isCountryTableFile(null)).toBe(false);
  });
});

describe('loadCountryCrops', () => {
  const requested: string[] = [];
  beforeEach(() => {
    setCacheEnabled(false);
    requested.length = 0;
    // The static files, served from disk; any other path is the page of a single-page app.
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      const name = url.split('/data/crops/country/')[1];
      try {
        return new Response(readFileSync(`${DIR}/${name}`, 'utf8'), { status: 200 });
      } catch {
        return new Response('<!doctype html>', { status: 200 });
      }
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setCacheEnabled(true);
  });

  it('loads the table of a demo field from its three-letter code, and only that file', async () => {
    const r = await loadCountryCrops(getSampleParcel('cantho-rice')!);
    expect(r).toMatchObject({ status: 'ready', iso3: 'VNM', name: 'Viet Nam', source: 'FAOSTAT QCL' });
    if (r.status !== 'ready') throw new Error('unreachable');
    expect(r.country.prevalence['oryza-sativa'].level).toBe('major');
    expect(requested.filter((u) => !u.endsWith('index.json')).map((u) => u.split('/').pop())).toEqual(['VNM.json']);
  });

  it('asks the geocoder when the field has no country, and uses its two-letter code', async () => {
    const reverseGeocode = vi.fn(async () => ({ countryCode: 'us' }));
    const r = await loadCountryCrops({ centroid: [-93.6, 42.0] }, { reverseGeocode });
    expect(reverseGeocode).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ status: 'ready', iso3: 'USA' });
    // A place that names its country needs no geocoder.
    const known = await loadCountryCrops({ centroid: [105.8, 10.0], place: { label: 'Cần Thơ', countryCode: 'VN' } }, { reverseGeocode });
    expect(known).toMatchObject({ status: 'ready', iso3: 'VNM' });
    expect(reverseGeocode).toHaveBeenCalledOnce();
  });

  it('says missing, without an error, for a country that has no table or cannot be told', async () => {
    expect(await loadCountryCrops({ centroid: [0, -75], place: { label: 'Antarctica', countryCode: 'AQ' } })).toEqual({ status: 'missing', iso2: 'AQ' });
    expect(await loadCountryCrops({ centroid: [0, 0] }, { reverseGeocode: async () => null })).toEqual({ status: 'missing' });
    expect(await loadCountryCrops({ centroid: [0, 0] })).toEqual({ status: 'missing' });
  });
});

describe('the model with the table of the field', () => {
  const input = (id: string): ModelInput => {
    const parcel = getSampleParcel(id)!;
    const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
    return { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: {}, priorities: ['profit', 'soil', 'water'], today: telemetry.window.today };
  };

  it('keeps what Viet Nam does not report out of the main list of the paddy field', () => {
    const base = input('cantho-rice');
    const country = expandCountryTable(onDisk<CountryTableFile>('VNM.json'));
    const without = rankCropLists(base);
    const withTable = rankCropLists({ ...base, country });
    expect(without.gate.applied).toBe(false);
    expect(withTable.gate).toMatchObject({ applied: true, iso3: 'VNM' });
    expect(withTable.main.every((r) => r.prevalence?.status !== 'absent')).toBe(true);
    expect(withTable.main.find((r) => r.cropId === 'oryza-sativa')?.prevalence).toMatchObject({ status: 'grown', level: 'major' });
    expect(withTable.main.length).toBeLessThan(without.main.length);
  });
});
