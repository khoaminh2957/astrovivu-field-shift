/**
 * The table lookups, against the crop atlas itself: every expected number is read from
 * data/crops/atlas/*.csv in the test, none is typed in. Reads the built tables
 * (public/rag/tables, public/data/crops/country); requires `npm run rag:build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FieldTelemetry, GroundTruth, ModelInput } from '@/contracts';
import { phPlan } from '@/core/advisory/actions';
import { buildRotations } from '@/core/advisory/rotation';
import { referenceEconomics } from '@/core/economics';
import { assessCrop } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { fileLoader, fileReader } from '../../server/loader';
import { type AtlasTables, compareCrops, cropFigures, cropsInPlace, fieldSuitability, type LookupResult, priceAndMargin, regionKey, rotationOptions, soilPlan, whereGrown } from './lookups';
import { KnowledgeStore } from './store';
import { tableSource } from './tables';

const ROOT = path.resolve(import.meta.dirname, '../..');
type Row = Record<string, string>;
const csv = (name: string): Row[] => Papa.parse<Row>(fs.readFileSync(path.join(ROOT, 'data/crops/atlas', name), 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
const cropCountry = csv('crop_country.csv');
const regionCrops = csv('region_crops.csv');
const cropsCsv = csv('crops.csv');
const cc = (cropId: string, iso3: string) => cropCountry.find((r) => r.crop_id === cropId && r.iso3 === iso3)!;

const tables = tableSource(fileReader(path.join(ROOT, 'public')));
let t: AtlasTables;
let store: KnowledgeStore;
beforeAll(async () => {
  t = { crops: await tables.crops(), countries: await tables.countries(), sources: await tables.sources(), spam: await tables.spam() };
  store = new KnowledgeStore(fileLoader(path.join(ROOT, 'public/rag')));
  await store.ensureFull();
});

function field(id: string, own: Partial<GroundTruth> = {}): ModelInput {
  const parcel = getSampleParcel(id)!;
  const defaults = (parcel as { defaultGroundTruth?: GroundTruth }).defaultGroundTruth ?? {};
  const telemetry = JSON.parse(fs.readFileSync(path.join(ROOT, `public/data/samples/${id}.json`), 'utf8')) as FieldTelemetry;
  return { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: { ...defaults, ...own }, priorities: ['profit', 'water', 'soil'], today: '2026-11-14' };
}

/** Every result with rows names where they come from, with a licence and a year. */
function sourced<R>(r: LookupResult<R>): asserts r is Extract<LookupResult<R>, { ok: true }> {
  expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
  if (!r.ok) return;
  expect(r.sources.length).toBeGreaterThan(0);
  expect(r.sources.some((s) => s.licence.length > 0 && s.year.length > 0)).toBe(true);
  for (const c of r.caveats) {
    expect(c.en.length).toBeGreaterThan(0);
    expect(c.vi.length).toBeGreaterThan(0);
  }
}

describe('what a place grows', () => {
  it('Viet Nam: rice first, 7,089,041 ha, major, in one row for the three rice crops', async () => {
    const r = cropsInPlace(t, { country: await tables.country('VNM') }, 'VNM');
    sourced(r);
    const rice = cc('oryza-sativa', 'VNM');
    expect(rice.area_ha).toBe('7089041');
    expect(r.rows[0]).toMatchObject({ name: 'Rice', areaHa: Number(rice.area_ha), level: rice.level, rank: Number(rice.rank_in_country), sharePct: Number(rice.share_of_country_harvested_area_pct) });
    expect(r.rows[0].level).toBe('major');
    // The item is shared: the atlas has the same numbers on three rows, the lookup has them once.
    const sharing = cropCountry.filter((x) => x.iso3 === 'VNM' && x.faostat_item_code === rice.faostat_item_code && x.match === 'exact').map((x) => x.crop_id).sort();
    expect(sharing).toHaveLength(3);
    expect(r.rows[0].cropIds).toEqual(sharing);
    expect(r.rows.filter((x) => x.name === 'Rice')).toHaveLength(1);
    // As many rows as items with a reported quantity; every crop with one is in exactly one row.
    const grown = cropCountry.filter((x) => x.iso3 === 'VNM' && ['major', 'common', 'minor', 'present'].includes(x.level));
    expect(r.rows).toHaveLength(new Set(grown.map((x) => x.faostat_item_code)).size);
    expect(r.rows.flatMap((x) => x.cropIds).sort()).toEqual(grown.map((x) => x.crop_id).sort());
    // Largest area first.
    const areas = r.rows.map((x) => x.areaHa ?? -1);
    expect(areas).toEqual([...areas].sort((a, b) => b - a));
    expect(r.sources[0]).toMatchObject({ licence: expect.stringContaining('CC BY 4.0'), accessed: '2026-11-15' });
    expect(r.sources[0].year).toBe(`${Math.min(...grown.map((x) => Number(x.year_from)))}-${Math.max(...grown.map((x) => Number(x.year_to)))}`);
  });

  it('never gives a crop of a group item a number, and says how many there are', async () => {
    const r = cropsInPlace(t, { country: await tables.country('VNM') }, 'VNM');
    sourced(r);
    const inGroups = cropCountry.filter((x) => x.iso3 === 'VNM' && x.match === 'group' && x.item_reported === 'yes').map((x) => x.crop_id);
    const anyGroup = cropCountry.filter((x) => x.iso3 === 'VNM' && x.match === 'group').map((x) => x.crop_id);
    // Durian, and African rice, which FAOSTAT counts inside "Rice": neither gets the numbers of its item.
    expect(anyGroup).toEqual(expect.arrayContaining(['durio-zibethinus', 'oryza-glaberrima']));
    expect(r.rows.flatMap((x) => x.cropIds).filter((id) => anyGroup.includes(id))).toEqual([]);
    expect(r.facts!.inGroups).toBe(inGroups.length);
    expect(r.caveats[0].en).toContain(`${inGroups.length} more crops are counted inside group items`);
    // "Not reported" is not said to be "not grown".
    expect(r.caveats.some((c) => c.en.includes('is not thereby a crop that is not grown'))).toBe(true);
  });

  it('Đắk Lắk: robusta coffee with 23,871 ha, as a MapSPAM estimate', async () => {
    const r = cropsInPlace(t, { country: await tables.country('VNM'), regions: await tables.regions('VNM') }, 'VNM', 'Đắk Lắk');
    sourced(r);
    const row = regionCrops.find((x) => x.iso3 === 'VNM' && x.admin1 === 'Dak Lak' && x.spam_crop === 'rcof')!;
    expect(row.harvested_area_ha).toBe('23871');
    const coffee = r.rows.find((x) => x.cropIds.includes('coffea-canephora'))!;
    expect(coffee).toMatchObject({ areaHa: Number(row.harvested_area_ha), rank: Number(row.rank_in_region), sharePct: Number(row.share_of_region_pct), residual: false });
    expect(r.caveats[0].en).toMatch(/^MapSPAM estimate/);
    expect(r.caveats[0].vi).toMatch(/^Ước tính MapSPAM/);
    expect(r.sources[0]).toMatchObject({ year: '2020', licence: expect.stringContaining('CC BY 4.0') });
    expect(r.rows).toHaveLength(regionCrops.filter((x) => x.iso3 === 'VNM' && x.admin1 === 'Dak Lak').length);
    // A class of several crops names none of ours.
    const vegetables = r.rows.find((x) => x.name === 'Other Vegetables')!;
    expect(vegetables).toMatchObject({ residual: true, cropIds: [] });
  });

  it('finds a region whatever way its name is written', async () => {
    const regions = await tables.regions('VNM');
    const country = await tables.country('VNM');
    for (const name of ['Dak Lak', 'đắk lắk', 'tỉnh Đắk Lắk', 'Cần Thơ', 'Thành phố Cần Thơ', 'Thừa Thiên Huế', 'Hồ Chí Minh', 'An Giang']) expect(cropsInPlace(t, { country, regions }, 'VNM', name).ok, name).toBe(true);
    expect(regionKey('Can Tho city')).toBe('can tho');
    expect(regionKey('Thua Thien - Hue')).toBe(regionKey('Thừa Thiên Huế'));
  });

  it('Nevada is not among the regions MapSPAM has for the United States: no data, not another state', async () => {
    const r = cropsInPlace(t, { country: await tables.country('USA'), regions: await tables.regions('USA') }, 'USA', 'Nevada');
    expect(r).toMatchObject({ ok: false, reason: 'no-data' });
    expect(regionCrops.some((x) => x.iso3 === 'USA' && x.admin1 === 'Nevada')).toBe(false);
    expect(cropsInPlace(t, { country: await tables.country('USA'), regions: await tables.regions('USA') }, 'USA', 'Iowa').ok).toBe(true);
  });

  it('a country the atlas does not have is an unknown place', () => {
    expect(cropsInPlace(t, { country: null }, 'XXX')).toMatchObject({ ok: false, reason: 'unknown-place' });
  });
});

describe('where a crop is grown', () => {
  it('soybean: 34,330,527 ha and major in the United States, 30,237 ha and minor in Viet Nam', async () => {
    const file = await tables.crop('glycine-max');
    const usa = whereGrown(t, file, 'glycine-max', 'USA');
    sourced(usa);
    const rowUsa = cc('glycine-max', 'USA');
    expect(rowUsa.area_ha).toBe('34330527');
    expect(usa.rows.find((r) => r.iso3 === 'USA')).toMatchObject({ areaHa: Number(rowUsa.area_ha), level: rowUsa.level, country: 'United States of America' });
    expect(usa.facts!.askedLevel).toBe('major');
    const vnm = whereGrown(t, file, 'glycine-max', 'VNM');
    sourced(vnm);
    const rowVnm = cc('glycine-max', 'VNM');
    expect(rowVnm.area_ha).toBe('30237');
    expect(vnm.rows.find((r) => r.iso3 === 'VNM')).toMatchObject({ areaHa: Number(rowVnm.area_ha), level: rowVnm.level });
    expect(vnm.facts!.askedLevel).toBe('minor');
    // The five largest come first; the country asked about follows when it is not one of them.
    const byArea = cropCountry.filter((r) => r.crop_id === 'glycine-max' && r.area_ha).sort((a, b) => Number(b.area_ha) - Number(a.area_ha));
    expect(vnm.rows.slice(0, 5).map((r) => r.iso3)).toEqual(byArea.slice(0, 5).map((r) => r.iso3));
    expect(vnm.rows).toHaveLength(6);
    expect(vnm.rows[5].rank).toBe(byArea.findIndex((r) => r.iso3 === 'VNM') + 1);
    expect(vnm.facts!.countriesWithArea).toBe(byArea.length);
  });

  it('durian in Viet Nam: counted inside a group item, so no number at all', async () => {
    const r = whereGrown(t, await tables.crop('durio-zibethinus'), 'durio-zibethinus', 'VNM');
    expect(r).toMatchObject({ ok: false, reason: 'group-item' });
    expect(JSON.stringify(r)).not.toMatch(/\d{3,}/);
    // The atlas has the group's numbers on durian's row; they are not durian's.
    expect(cc('durio-zibethinus', 'VNM').match).toBe('group');
    expect(await tables.crop('durio-zibethinus')).toBeNull();
  });

  it('a crop the country reports none of is given as that, with the caution that goes with it', async () => {
    // Tomato in Viet Nam: the atlas has it as absent (FAOSTAT has no series).
    expect(cc('lycopersicon-esculentum', 'VNM').level).toBe('absent');
    const r = whereGrown(t, await tables.crop('lycopersicon-esculentum'), 'lycopersicon-esculentum', 'VNM');
    sourced(r);
    expect(r.rows.find((x) => x.iso3 === 'VNM')).toMatchObject({ level: 'absent', areaHa: null, rank: null });
    expect(r.caveats.some((c) => c.vi.includes('chưa chắc là cây không được trồng'))).toBe(true);
  });

  it('says when the figures are those of an item shared by several crops', async () => {
    const r = whereGrown(t, await tables.crop('oryza-sativa'), 'oryza-sativa', 'VNM');
    sourced(r);
    const shared = cropsCsv.find((c) => c.crop_id === 'oryza-sativa')!.item_shared_by_n_crops;
    expect(r.caveats.some((c) => c.en.includes(`ties to ${shared} crops`))).toBe(true);
    expect(r.facts!.countriesReporting).toBe(Number(cropsCsv.find((c) => c.crop_id === 'oryza-sativa')!.n_countries_producing));
  });

  it('tells a species the atlas dropped from one it never heard of, and a crop without an item', async () => {
    const isDropped = (id: string) => Boolean(store.dropped?.species[id]);
    expect(whereGrown(t, null, 'abelmoschus-manihot', undefined, { isDropped })).toMatchObject({ ok: false, reason: 'dropped-crop' });
    expect(whereGrown(t, null, 'not-a-crop', undefined, { isDropped })).toMatchObject({ ok: false, reason: 'unknown-crop' });
    expect(whereGrown(t, await tables.crop('tagetes-erecta'), 'tagetes-erecta')).toMatchObject({ ok: false, reason: 'no-data' });
    expect(whereGrown(t, await tables.crop('glycine-max'), 'glycine-max', 'XXX')).toMatchObject({ ok: false, reason: 'unknown-place' });
  });
});

describe('what a crop needs, and two crops side by side', () => {
  it('gives the requirements and the world figures as lines in both languages', () => {
    const r = cropFigures(t, store.crops.get('glycine-max'), 'glycine-max');
    sourced(r);
    const row = cropsCsv.find((c) => c.crop_id === 'glycine-max')!;
    expect(r.rows.find((x) => x.key === 'ph')!.line).toEqual({ en: `Soil pH: optimal ${Number(row.ph_opt_min)}-${Number(row.ph_opt_max)}, tolerated ${Number(row.ph_abs_min)}-${Number(row.ph_abs_max)}.`, vi: `pH đất: tối ưu ${Number(row.ph_opt_min)}-${Number(row.ph_opt_max)}, chịu được ${Number(row.ph_abs_min)}-${Number(row.ph_abs_max)}.` });
    expect(r.rows.find((x) => x.key === 'countries')!.line.en).toBe(`Countries reporting production: ${row.n_countries_producing}.`);
    expect(r.rows.find((x) => x.key === 'worldAreaHa')!.line.en).toBe(`Harvested area in the world: ${row.world_area_ha} ha.`);
    expect(r.sources.map((s) => s.year)).toEqual(['n.d.', row.data_years]);
  });

  it('gives a group crop its requirements and no world figures', () => {
    const r = cropFigures(t, store.crops.get('durio-zibethinus'), 'durio-zibethinus');
    sourced(r);
    expect(r.rows.some((x) => x.key === 'worldAreaHa' || x.key === 'countries')).toBe(false);
    expect(r.caveats[0].en).toContain('Other tropical fruits, n.e.c.');
    // The crop EcoCrop has no record of, and that no FAOSTAT item covers: nothing to give.
    expect(cropFigures(t, store.crops.get('tagetes-erecta'), 'tagetes-erecta')).toMatchObject({ ok: false, reason: 'no-data' });
  });

  it('sets two crops line against line, and says how much of each a country grows', async () => {
    const pair = async (id: string) => ({ cropId: id, facts: store.crops.get(id), file: await tables.crop(id) });
    const r = compareCrops(t, await pair('glycine-max'), await pair('zea-mays'), 'VNM');
    sourced(r);
    const ph = r.rows.find((x) => x.key === 'ph')!;
    expect(ph.a!.en).toMatch(/^Soil pH: optimal 5\.5-6\.5/);
    expect(ph.b!.en).toMatch(/^Soil pH: optimal 5-7/);
    const here = r.rows.find((x) => x.key === 'in:VNM')!;
    expect(here.a!.en).toBe(`${cc('glycine-max', 'VNM').level}, ${cc('glycine-max', 'VNM').area_ha} ha`);
    expect(here.b!.en).toBe(`${cc('zea-mays', 'VNM').level}, ${cc('zea-mays', 'VNM').area_ha} ha`);
    // With a group crop: its side says so, with no number.
    const withDurian = compareCrops(t, await pair('glycine-max'), await pair('durio-zibethinus'), 'VNM');
    sourced(withDurian);
    expect(withDurian.rows.find((x) => x.key === 'in:VNM')!.b!.en).toBe('counted inside a group item: no figure of its own');
    expect(compareCrops(t, await pair('glycine-max'), await pair('not-a-crop'))).toMatchObject({ ok: false, reason: 'unknown-crop' });
  });
});

describe('the locked field', () => {
  it('suitability is the model\'s own assessment, to the last digit', () => {
    const input = field('daklak-coffee');
    const r = fieldSuitability(t, input, 'coffea-canephora');
    sourced(r);
    expect(r.rows).toEqual([assessCrop(input, 'coffea-canephora')]);
    expect(fieldSuitability(t, input, 'glycine-max')).toMatchObject({ ok: true, rows: [assessCrop(input, 'glycine-max')] });
    expect(r.sources[0].year).toBe('2026');
    expect(fieldSuitability(t, null, 'coffea-canephora')).toMatchObject({ ok: false, reason: 'no-field' });
    expect(fieldSuitability(t, input, 'not-a-crop')).toMatchObject({ ok: false, reason: 'unknown-crop' });
  });

  it('rotations are the ones the app builds', () => {
    const input = field('cantho-rice');
    const r = rotationOptions(t, input);
    sourced(r);
    expect(r.rows).toBe(buildRotations(input));
    expect(r.rows.some((x) => x.kind === 'current')).toBe(true);
    expect(rotationOptions(t, undefined)).toMatchObject({ ok: false, reason: 'no-field' });
  });

  it('the soil plan is the pH plan for now, and says that it is only that', () => {
    const input = field('iowa-corn-soy');
    const r = soilPlan(t, input);
    sourced(r);
    expect(r.rows).toEqual([phPlan(input)]);
    expect(r.caveats[0].en).toMatch(/^This is the pH part only/);
    expect(soilPlan(t, null)).toMatchObject({ ok: false, reason: 'no-field' });
  });

  it('price and margin are the reference record of the region and the season built on it', () => {
    const input = field('cantho-rice');
    const r = priceAndMargin(t, input, 'oryza-sativa');
    sourced(r);
    const reference = referenceEconomics('oryza-sativa', input.parcel)!;
    expect(r.rows[0].reference).toBe(reference);
    expect(r.rows[0].season).toMatchObject({ cropId: 'oryza-sativa', priceUsdPerT: reference.priceUsdPerT });
    expect(r.sources[0].year).toBe(String(reference.year));
    expect(r.caveats[0].en).toContain(`yield ${reference.quality.yield}, price ${reference.quality.price}, cost ${reference.quality.cost}`);
  });

  it('a record of another country is not given in place of a missing one', () => {
    // Common bean has no Vietnamese record: the reference table falls back to the one of the United States.
    const input = field('cantho-rice');
    expect(referenceEconomics('phaseolus-vulgaris', input.parcel)!.region).not.toBe('VN');
    const r = priceAndMargin(t, input, 'phaseolus-vulgaris');
    expect(r).toMatchObject({ ok: false, reason: 'no-data' });
    expect(JSON.stringify(r)).not.toMatch(/\d{2,}/);
    // The same crop on the Iowa field has a record of its own country.
    expect(priceAndMargin(t, field('iowa-corn-soy'), 'phaseolus-vulgaris').ok).toBe(true);
    expect(priceAndMargin(t, null, 'oryza-sativa')).toMatchObject({ ok: false, reason: 'no-field' });
    expect(priceAndMargin(t, input, 'not-a-crop')).toMatchObject({ ok: false, reason: 'unknown-crop' });
  });
});
