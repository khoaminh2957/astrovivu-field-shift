import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CountryCrops, CropPrevalence, FieldTelemetry, GroundTruth, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { assessCrop, LATITUDE_GATE, prevalenceStatus, rankCropLists, rankCrops, TRIAL_MIN_COMPATIBILITY } from './index';

/** A demo field as the app scores it. */
function field(id: string, country?: CountryCrops): ModelInput {
  const parcel = getSampleParcel(id)!;
  const defaults = (parcel as { defaultGroundTruth?: GroundTruth }).defaultGroundTruth ?? {};
  const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
  return { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: { ...defaults }, priorities: ['profit', 'water', 'soil'], today: '2026-11-14', country };
}

const fao = (level: CropPrevalence['level'], match: CropPrevalence['match'], sharePct?: number): CropPrevalence => ({ level, match, sharePct, source: 'FAOSTAT QCL' });

/**
 * Rows of data/crops/atlas/crop_country.csv for Viet Nam (15 Nov 2026), for crops that reach the
 * full score on the Mekong Delta paddy field. Yardlong bean has no row: no FAOSTAT item names it.
 */
const VNM: CountryCrops = {
  iso3: 'VNM',
  prevalence: {
    'oryza-sativa': fao('major', 'exact', 52.493),
    'coffea-canephora': fao('common', 'exact', 4.94),
    'saccharum-officinarum': fao('common', 'exact', 1.281),
    'piper-nigrum': fao('common', 'exact', 0.761),
    'ipomoea-batatas': fao('common', 'exact', 0.608),
    'abelmoschus-esculentus': fao('absent', 'exact'),
    'cicer-arietinum': fao('absent', 'exact'),
    'sorghum-bicolor': fao('absent', 'exact'),
    'durio-zibethinus': fao('unknown', 'group'),
  },
};
const TIED = ['abelmoschus-esculentus', 'cicer-arietinum', 'coffea-canephora', 'ipomoea-batatas', 'oryza-sativa', 'piper-nigrum', 'saccharum-officinarum', 'sorghum-bicolor', 'vigna-unguiculata-ssp-sesquipedalis'];

describe('how the ranking reads prevalence', () => {
  it('lets only a record of the crop itself say grown or absent', () => {
    expect(prevalenceStatus(fao('major', 'exact', 52.5))).toBe('grown');
    expect(prevalenceStatus(fao('present', 'national'))).toBe('grown');
    expect(prevalenceStatus(fao('absent', 'exact'))).toBe('absent');
    expect(prevalenceStatus(fao('absent', 'national'))).toBe('absent');
  });

  it('reads a group record and a missing record as unknown, never as absent', () => {
    expect(prevalenceStatus(fao('unknown', 'group'))).toBe('unknown');
    // A group item can be absent from a country without saying anything about one species in it.
    expect(prevalenceStatus(fao('absent', 'group'))).toBe('unknown');
    expect(prevalenceStatus(undefined)).toBe('unknown');
  });
});

describe('ranking without a country table', () => {
  const input = field('cantho-rice');

  it('ranks every crop on climate and soil, and says the gate was not applied', () => {
    const lists = rankCropLists(input, { cropIds: TIED });
    expect(lists.gate.applied).toBe(false);
    expect(lists.gate.note.en && lists.gate.note.vi).toBeTruthy();
    expect(lists.trial).toEqual([]);
    expect(lists.main.map((r) => r.cropId).sort()).toEqual([...TIED].sort());
    for (const r of lists.main) expect(r.prevalence).toBeUndefined();
    expect(rankCrops(input, { cropIds: TIED })).toEqual(lists.main);
  });
});

describe('ranking with the crops of the country', () => {
  const input = field('cantho-rice', VNM);
  const lists = rankCropLists(input, { cropIds: TIED });

  it('starts from a tie: these crops all reach the full score on the field', () => {
    for (const r of rankCrops(input, { cropIds: TIED, include: 'all' })) expect(r.rankScore, r.cropId).toBe(1);
  });

  it('breaks the tie by what the country grows: level, then share of its harvested area', () => {
    expect(lists.main.map((r) => r.cropId)).toEqual([
      'oryza-sativa', // major, 52.5 %
      'coffea-canephora', // common, 4.9 %
      'saccharum-officinarum', // common, 1.3 %
      'piper-nigrum', // common, 0.8 %
      'ipomoea-batatas', // common, 0.6 %
      'vigna-unguiculata-ssp-sesquipedalis', // no figure
    ]);
  });

  it('keeps a crop without a figure in the main list, marked unknown', () => {
    const yardlong = lists.main.find((r) => r.cropId === 'vigna-unguiculata-ssp-sesquipedalis');
    expect(yardlong?.prevalence).toEqual({ status: 'unknown', level: 'unknown' });
  });

  it('moves a crop without reported production to the second list, with a note in both languages', () => {
    expect(lists.trial.map((r) => r.cropId)).toEqual(['abelmoschus-esculentus', 'cicer-arietinum', 'sorghum-bicolor']);
    for (const r of lists.trial) {
      expect(r.compatibility).toBeGreaterThanOrEqual(TRIAL_MIN_COMPATIBILITY);
      expect(r.note.en).toContain('FAOSTAT QCL');
      expect(r.note.vi).toContain('FAOSTAT QCL');
    }
    expect(lists.gate).toMatchObject({ applied: true, iso3: 'VNM' });
  });

  it('gives the main list from rankCrops, and everything on request', () => {
    expect(rankCrops(input, { cropIds: TIED })).toEqual(lists.main);
    expect(rankCrops(input, { cropIds: TIED, include: 'all' }).map((r) => r.cropId).slice(-3)).toEqual(['abelmoschus-esculentus', 'cicer-arietinum', 'sorghum-bicolor']);
  });

  it('returns the same list for the same input', () => {
    expect(rankCropLists(field('cantho-rice', VNM), { cropIds: TIED })).toEqual(lists);
  });
});

describe('the cases named in the plan', () => {
  it('a crop of a group item is not dropped: durian in Đắk Lắk stays in the main list', () => {
    const lists = rankCropLists(field('daklak-coffee', VNM));
    expect(lists.main.find((r) => r.cropId === 'durio-zibethinus')?.prevalence?.status).toBe('unknown');
    expect(lists.trial.some((r) => r.cropId === 'durio-zibethinus')).toBe(false);
  });

  it('with equal scores a major crop stands above a minor one', () => {
    // Levels set by hand for this test only: the order must come from them, not from the ids.
    const country: CountryCrops = { iso3: 'VNM', prevalence: { 'saccharum-officinarum': fao('major', 'exact', 30), 'coffea-canephora': fao('minor', 'exact', 0.1) } };
    expect(rankCrops(field('cantho-rice', country), { cropIds: ['coffea-canephora', 'saccharum-officinarum'] }).map((r) => r.cropId)).toEqual(['saccharum-officinarum', 'coffea-canephora']);
  });

  it('a crop the country does not grow and the field does not suit is in neither list', () => {
    // Cashew scores 0 on the Nevada field (frost, pH 8.8) and the United States report none.
    const lists = rankCropLists(field('nevada-alfalfa', { iso3: 'USA', prevalence: { 'anacardium-occidentale': fao('absent', 'exact') } }), { cropIds: ['anacardium-occidentale', 'medicago-sativa'] });
    expect(lists.main.map((r) => r.cropId)).toEqual(['medicago-sativa']);
    expect(lists.trial).toEqual([]);
  });
});

describe('the latitude gate', () => {
  // Pigeon pea: EcoCrop gives 30° as its latitude limit; the Iowa field lies at 42°.
  const iowa = field('iowa-corn-soy');
  const factorOf = (opts: Parameters<typeof assessCrop>[2]) => assessCrop(iowa, 'cajanus-cajan', opts)?.factors.find((f) => f.key === 'latitude');

  it('is the one in use unless a comparison asks for another', () => {
    expect(LATITUDE_GATE).toEqual({ toleranceDeg: 3, factor: 0.7 });
    expect(factorOf({})?.score).toBe(0.7);
    expect(factorOf({ latitudeGate: { toleranceDeg: 3, factor: 0.4 } })?.score).toBe(0.4);
  });

  it('can be switched off, and does not apply inside its tolerance', () => {
    expect(factorOf({ latitudeGate: null })).toBeUndefined();
    expect(factorOf({ latitudeGate: { toleranceDeg: 40, factor: 0.7 } })).toBeUndefined();
  });
});
