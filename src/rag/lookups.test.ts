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
import { buildAdvisoryReport } from '@/core/advisory';
import { phPlan } from '@/core/advisory/actions';
import { buildRotations } from '@/core/advisory/rotation';
import { economicCountry, REGION_ISO3, referenceEconomics } from '@/core/economics';
import { computeScoreTimeline } from '@/core/scoring';
import { buildSoilPlan, diagnoseSoil } from '@/core/soil';
import { assessCrop } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { fileLoader, fileReader } from '../../server/loader';
import { type AtlasTables, compareCrops, cropFigures, cropsInPlace, fieldSuitability, findRegion, type LookupResult, priceAndMargin, regionKey, rotationOptions, soilPlan, whereGrown } from './lookups';
import { KnowledgeStore } from './store';
import { tableSource } from './tables';

const ROOT = path.resolve(import.meta.dirname, '../..');
type Row = Record<string, string>;
const csv = (name: string): Row[] => Papa.parse<Row>(fs.readFileSync(path.join(ROOT, 'data/crops/atlas', name), 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
const cropCountry = csv('crop_country.csv');
const regionCrops = csv('region_crops.csv');
const cropsCsv = csv('crops.csv');
const itemsCsv = csv('items.csv');
// Indexed once: the item test reads one row per crop and country (thousands of lookups in about 70,000 rows),
// which a linear search turned into more than 20 s on a Windows laptop.
const ccIndex = new Map(cropCountry.map((r) => [`${r.crop_id}|${r.iso3}`, r]));
const cc = (cropId: string, iso3: string) => ccIndex.get(`${cropId}|${iso3}`)!;

const tables = tableSource(fileReader(path.join(ROOT, 'public')));
let t: AtlasTables;
let store: KnowledgeStore;
beforeAll(async () => {
  t = { crops: await tables.crops(), countries: await tables.countries(), sources: await tables.sources(), spam: await tables.spam(), national: await tables.national(), rowItems: await tables.rowItems() };
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
    // As many rows as FAOSTAT items with a reported quantity, plus one for each crop whose figure
    // is from national statistics; every crop with a quantity is in exactly one row.
    const grown = cropCountry.filter((x) => x.iso3 === 'VNM' && ['major', 'common', 'minor', 'present'].includes(x.level));
    const fromNational = grown.filter((x) => x.match === 'national');
    // One row per set of items the atlas writes for the country's rows, as `crop_country.csv` has them.
    expect(r.rows).toHaveLength(new Set(grown.filter((x) => x.match !== 'national').map((x) => x.faostat_item_code)).size + fromNational.length);
    expect(r.rows.flatMap((x) => x.cropIds).sort()).toEqual(grown.map((x) => x.crop_id).sort());
    // Largest area first.
    const areas = r.rows.map((x) => x.areaHa ?? -1);
    expect(areas).toEqual([...areas].sort((a, b) => b - a));
    expect(r.sources[0]).toMatchObject({ licence: expect.stringContaining('CC BY 4.0'), accessed: '2026-11-15' });
    const faostat = grown.filter((x) => x.match !== 'national');
    expect(r.sources[0].year).toBe(`${Math.min(...faostat.map((x) => Number(x.year_from)))}-${Math.max(...faostat.map((x) => Number(x.year_to)))}`);
  });

  it('Viet Nam: durian, from national statistics, as a row of its own with its publication', async () => {
    const r = cropsInPlace(t, { country: await tables.country('VNM') }, 'VNM');
    sourced(r);
    const row = cc('durio-zibethinus', 'VNM');
    expect(row.match).toBe('national');
    const durian = r.rows.find((x) => x.cropIds.includes('durio-zibethinus'))!;
    // Under the crop's name, not under "Other tropical fruits, n.e.c.", the item FAOSTAT counts it in.
    expect(durian).toEqual({ cropIds: ['durio-zibethinus'], name: 'Durian', areaHa: Number(row.area_ha), productionT: Number(row.production_t), sharePct: Number(row.share_of_country_harvested_area_pct), rank: Number(row.rank_in_country), level: row.level, source: row.source });
    expect(r.rows.filter((x) => x.name.startsWith('Other tropical fruits'))).toEqual([]);
    // Its publication is a source of the result, with the table read, the address and the terms.
    const src = r.sources.find((x) => x.name.startsWith(row.source))!;
    expect(src).toMatchObject({ year: row.year_from, accessed: '2026-11-15', url: expect.stringMatching(/^https:\/\//) });
    expect(src.licence.length).toBeGreaterThan(10);
    // Every national row with a figure is a row; those without are counted and said, not listed.
    const national = cropCountry.filter((x) => x.iso3 === 'VNM' && x.match === 'national');
    const withFigure = national.filter((x) => Number(x.area_ha) > 0);
    expect(r.rows.filter((x) => x.source).map((x) => x.cropIds[0]).sort()).toEqual(withFigure.map((x) => x.crop_id).sort());
    expect(r.facts).toMatchObject({ fromNationalStatistics: withFigure.length, nationalWithoutFigure: national.length - withFigure.length });
    expect(r.caveats.some((c) => c.en.includes(`${withFigure.length} rows name a source: they are figures of national statistics`))).toBe(true);
    expect(r.caveats.some((c) => c.vi.includes(`Với ${national.length - withFigure.length} cây nữa, thống kê quốc gia đã được đọc và không có số riêng`))).toBe(true);
    const tomato = cc('lycopersicon-esculentum', 'VNM');
    expect([tomato.match, tomato.level]).toEqual(['national', 'unknown']);
    expect(r.rows.some((x) => x.cropIds.includes('lycopersicon-esculentum'))).toBe(false);
  });

  it('never gives a crop of a group item a number, and says how many there are', async () => {
    const r = cropsInPlace(t, { country: await tables.country('VNM') }, 'VNM');
    sourced(r);
    const inGroups = cropCountry.filter((x) => x.iso3 === 'VNM' && x.match === 'group' && x.item_reported === 'yes').map((x) => x.crop_id);
    const anyGroup = cropCountry.filter((x) => x.iso3 === 'VNM' && x.match === 'group').map((x) => x.crop_id);
    // Jackfruit, and African rice, which FAOSTAT counts inside "Rice": neither gets the numbers of its item.
    expect(anyGroup).toEqual(expect.arrayContaining(['artocarpus-heterophyllus', 'oryza-glaberrima']));
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
    // "Tĩnh" of Hà Tĩnh is a name, not the word for province.
    expect(cropsInPlace(t, { country, regions }, 'VNM', 'Tỉnh Hà Tĩnh')).toMatchObject({ ok: true, facts: { region: 'Ha Tinh' } });
  });

  it('never gives the figures of one region for the name of another (review of #117, point 2)', async () => {
    const place = async (iso3: string) => ({ country: await tables.country(iso3), regions: await tables.regions(iso3) });
    const region = (r: LookupResult<unknown>) => (r.ok ? r.facts?.region : r.reason);
    const first = (iso3: string, admin1: string) => regionCrops.filter((x) => x.iso3 === iso3 && x.admin1 === admin1).sort((a, b) => Number(a.rank_in_region) - Number(b.rank_in_region))[0];
    // The name as MapSPAM writes it is that region, even when another one shares its stem.
    const minsk = cropsInPlace(t, await place('BLR'), 'BLR', 'Minsk City');
    expect(region(minsk)).toBe('Minsk City');
    expect(minsk.ok && minsk.rows[0].areaHa).toBe(Number(first('BLR', 'Minsk City').harvested_area_ha));
    expect(region(cropsInPlace(t, await place('BLR'), 'BLR', 'Minsk'))).toBe('Minsk');
    const damascus = cropsInPlace(t, await place('SYR'), 'SYR', 'Damascus');
    expect(region(damascus)).toBe('Damascus');
    expect(damascus.ok && damascus.rows[0]).toMatchObject({ name: 'Barley', areaHa: Number(first('SYR', 'Damascus').harvested_area_ha) });
    // "city" in the question is on the name of one of the two: that one.
    expect(region(cropsInPlace(t, await place('SYR'), 'SYR', 'Damascus city'))).toBe('City_Damascus');
    expect(region(cropsInPlace(t, await place('KAZ'), 'KAZ', 'Almaty city'))).toBe('Almaty (city)');
    // A name that could be two regions gives neither, and names both: Niger has "DOSSO" and "Dosso".
    const either = cropsInPlace(t, await place('NER'), 'NER', 'dosso');
    expect(either).toMatchObject({ ok: false, reason: 'no-data' });
    expect(either.caveats[0].en).toContain('could be (Niger): DOSSO; Dosso');
    expect(findRegion(['DOSSO', 'Dosso'], 'dosso')).toEqual({ ambiguous: ['DOSSO', 'Dosso'] });
    expect(findRegion(['DOSSO', 'Dosso'], 'Dosso')).toEqual({ name: 'Dosso' });
    // "Mexico City" is not the state of Mexico; "Hà" is no province.
    expect(region(cropsInPlace(t, await place('MEX'), 'MEX', 'Mexico City'))).toBe('no-data');
    expect(region(cropsInPlace(t, await place('MEX'), 'MEX', 'Mexico'))).toBe('Mexico');
    expect(region(cropsInPlace(t, await place('VNM'), 'VNM', 'Hà'))).toBe('no-data');
    expect(region(cropsInPlace(t, await place('VNM'), 'VNM', 'Hà Tĩnh'))).toBe('Ha Tinh');
    // Over every region of the atlas: its own name finds it, and no other.
    const byCountry = new Map<string, string[]>();
    for (const x of regionCrops) if (x.level === 'admin1' && x.admin1) byCountry.set(x.iso3, [...new Set([...(byCountry.get(x.iso3) ?? []), x.admin1])]);
    let checked = 0;
    for (const [, names] of byCountry) for (const n of names) {
      expect(findRegion(names, n), n).toEqual({ name: n });
      checked++;
    }
    expect(checked).toBeGreaterThan(2000);
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
    const usa = whereGrown(t, file, 'glycine-max', 'USA', { country: await tables.country('USA') });
    sourced(usa);
    const rowUsa = cc('glycine-max', 'USA');
    expect(rowUsa.area_ha).toBe('34330527');
    expect(usa.rows.find((r) => r.iso3 === 'USA')).toMatchObject({ areaHa: Number(rowUsa.area_ha), level: rowUsa.level, country: 'United States of America' });
    expect(usa.facts!.askedLevel).toBe('major');
    const vnm = whereGrown(t, file, 'glycine-max', 'VNM', { country: await tables.country('VNM') });
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

  it('jackfruit in Viet Nam: counted inside a group item, so no number at all', async () => {
    const r = whereGrown(t, await tables.crop('artocarpus-heterophyllus'), 'artocarpus-heterophyllus', 'VNM', { country: await tables.country('VNM') });
    expect(r).toMatchObject({ ok: false, reason: 'group-item' });
    expect(JSON.stringify(r)).not.toMatch(/\d{3,}/);
    // The atlas has the group's numbers on jackfruit's row; they are not jackfruit's.
    expect(cc('artocarpus-heterophyllus', 'VNM').match).toBe('group');
    expect(await tables.crop('artocarpus-heterophyllus')).toBeNull();
  });

  it('durian in Viet Nam: no figure from FAOSTAT, and the figure of the national statistics with its publication', async () => {
    const row = cc('durio-zibethinus', 'VNM');
    const r = whereGrown(t, await tables.crop('durio-zibethinus'), 'durio-zibethinus', 'VNM', { country: await tables.country('VNM') });
    sourced(r);
    expect(r.rows).toEqual([{ iso3: 'VNM', country: 'Viet Nam', areaHa: Number(row.area_ha), productionT: Number(row.production_t), level: row.level, rank: null, years: [Number(row.year_from), Number(row.year_to)], source: row.source }]);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].name.startsWith(row.source)).toBe(true);
    expect(r.sources[0]).toMatchObject({ year: row.year_from, url: expect.stringMatching(/^https:\/\//) });
    expect(r.caveats[0].en).toContain('FAOSTAT has no figure for it alone, in any country');
    expect(r.caveats[1].en).toContain('is from its national statistics');
    expect(r.caveats[1].vi).toContain('lấy từ thống kê quốc gia');
    // For another country, or for none, there is nothing to give, as before.
    expect(whereGrown(t, null, 'durio-zibethinus', 'THA', { country: await tables.country('THA') })).toMatchObject({ ok: false, reason: 'group-item' });
    expect(whereGrown(t, null, 'durio-zibethinus')).toMatchObject({ ok: false, reason: 'group-item' });
  });

  it('banana, a crop the atlas ties no item to: the national figures of Viet Nam and of the United States', async () => {
    for (const iso3 of ['VNM', 'USA']) {
      const row = cc('musa-acuminata', iso3);
      const r = whereGrown(t, await tables.crop('musa-acuminata'), 'musa-acuminata', iso3, { country: await tables.country(iso3) });
      sourced(r);
      expect(r.rows[0]).toMatchObject({ iso3, areaHa: Number(row.area_ha), rank: null, source: row.source });
      expect(r.caveats[0].en).toBe('The crop atlas ties no FAOSTAT item to it, so it has no FAOSTAT figures by country for it.');
    }
    expect(whereGrown(t, null, 'musa-acuminata', 'THA', { country: await tables.country('THA') })).toMatchObject({ ok: false, reason: 'no-data' });
  });

  it('a crop with an item of its own: the largest growers from FAOSTAT, and the country asked about from its national statistics', async () => {
    // Sesame in the United States: FAOSTAT's row was replaced by the 2022 Census of Agriculture.
    const row = cc('sesamum-indicum', 'USA');
    expect(row.match).toBe('national');
    const r = whereGrown(t, await tables.crop('sesamum-indicum'), 'sesamum-indicum', 'USA', { country: await tables.country('USA') });
    sourced(r);
    expect(r.rows.slice(0, 5).every((x) => x.rank != null && !x.source)).toBe(true);
    expect(r.rows.at(-1)).toMatchObject({ iso3: 'USA', areaHa: Number(row.area_ha), rank: null, source: row.source });
    expect(r.sources.map((x) => x.name)).toEqual([expect.stringContaining('FAOSTAT'), expect.stringContaining('2022 Census of Agriculture')]);
    expect(r.caveats.some((c) => c.en.includes('not ranked among FAOSTAT\'s countries'))).toBe(true);
  });

  it('a crop the national statistics have no figure of is given as unknown, not as absent', async () => {
    // Tomato in Viet Nam: FAOSTAT has no series; the yearbook was read and does not itemise it.
    expect([cc('lycopersicon-esculentum', 'VNM').match, cc('lycopersicon-esculentum', 'VNM').level]).toEqual(['national', 'unknown']);
    const r = whereGrown(t, await tables.crop('lycopersicon-esculentum'), 'lycopersicon-esculentum', 'VNM', { country: await tables.country('VNM') });
    sourced(r);
    expect(r.rows.find((x) => x.iso3 === 'VNM')).toMatchObject({ level: 'unknown', areaHa: null, rank: null });
    expect(r.caveats.some((c) => c.vi.includes('không có số riêng cho cây này: điều đó không có nghĩa là không trồng'))).toBe(true);
    expect(r.facts!.askedLevel).toBe('unknown');
  });

  it('a crop the country reports none of is given as that, with the caution that goes with it', async () => {
    // A crop with an item of its own that Viet Nam reports nothing of to FAOSTAT, and that no national row covers.
    const absent = cropCountry.find((x) => x.iso3 === 'VNM' && x.match === 'exact' && x.level === 'absent')!;
    const r = whereGrown(t, await tables.crop(absent.crop_id), absent.crop_id, 'VNM', { country: await tables.country('VNM') });
    sourced(r);
    expect(r.rows.find((x) => x.iso3 === 'VNM')).toMatchObject({ level: 'absent', areaHa: null, rank: null });
    expect(r.caveats.some((c) => c.vi.includes('chưa chắc là cây không được trồng'))).toBe(true);
  });

  it('says when the figures are those of an item shared by several crops', async () => {
    const r = whereGrown(t, await tables.crop('oryza-sativa'), 'oryza-sativa', 'VNM', { country: await tables.country('VNM') });
    sourced(r);
    const shared = cropsCsv.find((c) => c.crop_id === 'oryza-sativa')!.item_shared_by_n_crops;
    expect(r.caveats.some((c) => c.en.includes(`is tied to ${shared} crops of the atlas`))).toBe(true);
    expect(r.facts!.countriesReporting).toBe(Number(cropsCsv.find((c) => c.crop_id === 'oryza-sativa')!.n_countries_producing));
  });

  it('names the FAOSTAT items each figure is of, as the atlas writes them for that row (review of #117, point 3)', async () => {
    const name = (code: string) => itemsCsv.find((x) => x.faostat_item_code === code)!.faostat_item;
    const names = (cropId: string, iso3: string) => cc(cropId, iso3).faostat_item_code.split(';').map(name);
    // Melons in the United States: not "Melonseed", the crop's first item, but "Cantaloupes and other melons".
    const melon = whereGrown(t, await tables.crop('cucumis-melo'), 'cucumis-melo', 'USA', { country: await tables.country('USA') });
    sourced(melon);
    expect(melon.rows.find((x) => x.iso3 === 'USA')).toMatchObject({ areaHa: Number(cc('cucumis-melo', 'USA').area_ha), items: ['Cantaloupes and other melons'] });
    expect(names('cucumis-melo', 'USA')).toEqual(['Cantaloupes and other melons']);
    expect(melon.caveats.some((c) => c.en.includes('of the FAOSTAT items Melonseed, Cantaloupes and other melons: for each country, the sum of those it reports'))).toBe(true);
    // Musa sapientum in Viet Nam: "Bananas", not "Plantains and cooking bananas".
    const banana = whereGrown(t, await tables.crop('musa-sapientum'), 'musa-sapientum', 'VNM', { country: await tables.country('VNM') });
    expect(banana.ok && banana.rows.find((x) => x.iso3 === 'VNM')!.items).toEqual(names('musa-sapientum', 'VNM'));
    expect(names('musa-sapientum', 'VNM')).toEqual(['Bananas']);
    // Maize in the United States: grain and green corn, added up, and said to be a sum.
    const maize = whereGrown(t, await tables.crop('zea-mays'), 'zea-mays', 'USA', { country: await tables.country('USA') });
    expect(maize.ok && maize.rows.find((x) => x.iso3 === 'USA')!.items).toEqual(['Maize (corn)', 'Green corn (maize)']);
    expect(maize.caveats.some((c) => c.en.startsWith('A figure given with two items or more is their sum'))).toBe(true);
    // Every row of every crop file names the items of its row in the atlas.
    for (const c of cropsCsv.filter((x) => x.match === 'exact')) {
      const r = whereGrown(t, await tables.crop(c.crop_id), c.crop_id, undefined, { top: 300 });
      if (!r.ok) continue;
      for (const row of r.rows) expect(row.items, `${c.crop_id} ${row.iso3}`).toEqual(names(c.crop_id, row.iso3));
    }
    // A country's list names the row by its items, and gives the sum as a sum.
    const usa = cropsInPlace(t, { country: await tables.country('USA') }, 'USA');
    expect(usa.ok && usa.rows.find((x) => x.cropIds.includes('zea-mays'))).toMatchObject({ name: 'Maize (corn) + Green corn (maize)', items: ['Maize (corn)', 'Green corn (maize)'], areaHa: Number(cc('zea-mays', 'USA').area_ha) });
    expect(usa.ok && usa.caveats.some((c) => c.en.startsWith('A figure given with two items or more is their sum'))).toBe(true);
    const vnm = cropsInPlace(t, { country: await tables.country('VNM') }, 'VNM');
    expect(vnm.ok && vnm.rows.find((x) => x.cropIds.includes('musa-sapientum'))).toMatchObject({ name: 'Bananas', areaHa: Number(cc('musa-sapientum', 'VNM').area_ha) });
    expect(vnm.ok && vnm.rows.some((x) => x.name === 'Plantains and cooking bananas' && x.cropIds.includes('musa-sapientum'))).toBe(false);
  });

  it('a country FAOSTAT has no row of is "not known" when its own statistics were not looked at', async () => {
    // Sesame in the United States: the atlas has it from the 2022 Census of Agriculture, not from FAOSTAT.
    expect(cc('sesamum-indicum', 'USA').match).toBe('national');
    const loose = whereGrown as (...a: unknown[]) => LookupResult<{ iso3: string; level: string }>;
    const r = loose(t, await tables.crop('sesamum-indicum'), 'sesamum-indicum', 'USA', {});
    sourced(r);
    expect(r.rows.find((x) => x.iso3 === 'USA')!.level).toBe('unknown');
    expect(r.caveats.some((c) => c.en.includes("the country's own statistics were not looked at"))).toBe(true);
    // With the country's file, the census figure.
    const full = whereGrown(t, await tables.crop('sesamum-indicum'), 'sesamum-indicum', 'USA', { country: await tables.country('USA') });
    expect(full.ok && full.rows.find((x) => x.iso3 === 'USA')).toMatchObject({ areaHa: Number(cc('sesamum-indicum', 'USA').area_ha), level: cc('sesamum-indicum', 'USA').level });
  });

  it('tells a species the atlas dropped from one it never heard of, and a crop without an item', async () => {
    const isDropped = (id: string) => Boolean(store.dropped?.species[id]);
    expect(whereGrown(t, null, 'abelmoschus-manihot', undefined, { isDropped })).toMatchObject({ ok: false, reason: 'dropped-crop' });
    expect(whereGrown(t, null, 'not-a-crop', undefined, { isDropped })).toMatchObject({ ok: false, reason: 'unknown-crop' });
    expect(whereGrown(t, await tables.crop('tagetes-erecta'), 'tagetes-erecta')).toMatchObject({ ok: false, reason: 'no-data' });
    expect(whereGrown(t, await tables.crop('glycine-max'), 'glycine-max', 'XXX', { country: null })).toMatchObject({ ok: false, reason: 'unknown-place' });
  });
});

describe('what a crop needs, and two crops side by side', () => {
  it('gives the requirements and the world figures as lines in both languages', () => {
    const r = cropFigures(t, store.crops.get('glycine-max'), 'glycine-max');
    sourced(r);
    const row = cropsCsv.find((c) => c.crop_id === 'glycine-max')!;
    expect(r.rows.find((x) => x.key === 'ph')!.line).toEqual({ en: `Soil pH: optimal ${Number(row.ph_opt_min)}-${Number(row.ph_opt_max)}, tolerated ${Number(row.ph_abs_min)}-${Number(row.ph_abs_max)}.`, vi: `pH đất: tối ưu ${Number(row.ph_opt_min)}-${Number(row.ph_opt_max)}, chịu được ${Number(row.ph_abs_min)}-${Number(row.ph_abs_max)}.` });
    expect(r.rows.find((x) => x.key === 'countries')!.line.en).toBe(`Countries reporting production: ${row.n_countries_producing}.`);
    expect(r.rows.find((x) => x.key === 'worldAreaHa')!.line.en).toBe(`Harvested area in the world: ${Number(row.world_area_ha).toLocaleString('en-US')} ha, of the FAOSTAT item ${row.faostat_item}.`);
    expect(r.rows.find((x) => x.key === 'worldAreaHa')!.line.vi).toBe(`Diện tích thu hoạch toàn thế giới: ${Number(row.world_area_ha).toLocaleString('vi-VN')} ha, của mặt hàng FAOSTAT ${row.faostat_item}.`);
    expect(r.sources.map((s) => s.year)).toEqual(['n.d.', row.data_years]);
    // EcoCrop: the species page, and what is known of the date in place of a date.
    expect(r.sources[0]).toMatchObject({ name: `FAO EcoCrop database, record ${row.ecocrop_id}`, url: `https://ecocrop.apps.fao.org/ecocrop/srv/en/cropView?id=${row.ecocrop_id}` });
    expect(r.sources[0].note).toContain('no year of publication');
    expect(r.sources[0]).not.toHaveProperty('accessed');
  });

  it('gives the world figure of a crop with several items as the sum of those items', () => {
    const row = cropsCsv.find((c) => c.crop_id === 'cucumis-melo')!;
    const r = cropFigures(t, store.crops.get('cucumis-melo'), 'cucumis-melo');
    sourced(r);
    expect(r.rows.find((x) => x.key === 'worldAreaHa')!.line.en).toBe(`Harvested area in the world: ${Number(row.world_area_ha).toLocaleString('en-US')} ha, the sum over the countries of the FAOSTAT items Melonseed, Cantaloupes and other melons each reports.`);
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
    const r = compareCrops(t, await pair('glycine-max'), await pair('zea-mays'), 'VNM', { country: await tables.country('VNM') });
    sourced(r);
    const ph = r.rows.find((x) => x.key === 'ph')!;
    expect(ph.a!.en).toMatch(/^Soil pH: optimal 5\.5-6\.5/);
    expect(ph.b!.en).toMatch(/^Soil pH: optimal 5-7/);
    const here = r.rows.find((x) => x.key === 'in:VNM')!;
    expect(here.a!.en).toBe(`minor (under 0.5 %), ${Number(cc('glycine-max', 'VNM').area_ha).toLocaleString('en-US')} ha (item Soya beans)`);
    expect(here.a!.vi).toBe(`ít (dưới 0,5 %), ${Number(cc('glycine-max', 'VNM').area_ha).toLocaleString('vi-VN')} ha (mặt hàng Soya beans)`);
    expect(here.b!.vi).toBe(`trồng nhiều (từ 5 % diện tích thu hoạch), ${Number(cc('zea-mays', 'VNM').area_ha).toLocaleString('vi-VN')} ha (mặt hàng Maize (corn))`);
    expect([cc('glycine-max', 'VNM').level, cc('zea-mays', 'VNM').level]).toEqual(['minor', 'major']);
    // No English word in the Vietnamese line but the names of the items.
    expect(here.a!.vi.replace(/\(mặt hàng [^)]*\)/, '')).not.toMatch(/\b(major|common|minor|present|absent)\b/);
    // With a group crop: its side says so, with no number.
    const withJackfruit = compareCrops(t, await pair('glycine-max'), await pair('artocarpus-heterophyllus'), 'VNM', { country: await tables.country('VNM') });
    sourced(withJackfruit);
    expect(withJackfruit.rows.find((x) => x.key === 'in:VNM')!.b!.en).toBe('counted inside a group item: no figure of its own');
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

  it('the soil plan is the one the soil module builds, the pH plan with it (review of #117, point 4)', () => {
    for (const id of ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa']) {
      const input = field(id);
      const r = soilPlan(t, input);
      sourced(r);
      const diagnosis = diagnoseSoil(input);
      expect(r.rows[0], id).toEqual({ ph: phPlan(input) ?? null, diagnosis: diagnosis.metrics, plan: buildSoilPlan(diagnosis, input, phPlan(input) ?? undefined) });
      // The same plan as the advisory report's.
      expect(r.rows[0].plan, id).toEqual(buildAdvisoryReport(input, computeScoreTimeline(input)).soilPlan);
      expect(r.sources[0].name).toContain('soil diagnosis and plan (docs/SOIL.md)');
      // Nothing says the plan is the pH part alone.
      expect(JSON.stringify(r)).not.toMatch(/pH part only|phần pH/);
    }
    // Cần Thơ: drainage, depth and salinity are in the plan, as steps to measure first.
    const cantho = soilPlan(t, field('cantho-rice'));
    expect(cantho.ok && cantho.rows[0].plan.items.map((x) => x.metric)).toEqual(expect.arrayContaining(['drainage', 'depth', 'salinity']));
    // Nevada: the pH step with sulfur, and the same figure as the pH plan.
    const nevada = soilPlan(t, field('nevada-alfalfa'));
    expect(nevada.ok && nevada.rows[0].ph?.amendment).toBe('sulfur');
    expect(soilPlan(t, null)).toMatchObject({ ok: false, reason: 'no-field' });
    expect(soilPlan(t, { ...field('iowa-corn-soy'), cropId: null })).toMatchObject({ ok: false, reason: 'no-data' });
  });

  it('price and margin are the reference record of the region and the season built on it', () => {
    const input = field('cantho-rice');
    const r = priceAndMargin(t, input, 'oryza-sativa');
    sourced(r);
    const reference = referenceEconomics('oryza-sativa', input.parcel)!;
    expect(r.rows[0].reference).toBe(reference);
    expect(r.rows[0].season).toMatchObject({ cropId: 'oryza-sativa', priceUsdPerT: reference.priceUsdPerT });
    expect(r.sources[0].year).toBe(String(reference.year));
    expect(r.caveats[0].en).toContain(`yield ${reference.quality.yield} (`);
    // In Vietnamese, the quality words are Vietnamese.
    expect(r.caveats[0].vi).not.toMatch(/\b(official|budget|press|derived)\b/);
    expect(r.caveats[0].vi).toContain('năng suất chính thức (cơ quan thống kê)');
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

  it('nor when the record has no cost and builds no season (review of #117, point 1)', () => {
    // Onion on the Cần Thơ field: the only record is of the United States, and it has no cost.
    const cantho = field('cantho-rice');
    const onion = referenceEconomics('allium-cepa', cantho.parcel)!;
    expect(onion.region).toBe('US');
    expect(onion.costUsdPerHa).toBeNull();
    expect(priceAndMargin(t, cantho, 'allium-cepa')).toMatchObject({ ok: false, reason: 'no-data' });
    // Cashew on the Iowa field: the only record is of Viet Nam.
    expect(referenceEconomics('anacardium-occidentale', field('iowa-corn-soy').parcel)!.region).toBe('VN');
    expect(priceAndMargin(t, field('iowa-corn-soy'), 'anacardium-occidentale')).toMatchObject({ ok: false, reason: 'no-data' });
    // Over every crop of the atlas on the four demo fields: a result is always of the field's own country.
    let given = 0;
    for (const id of ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa']) {
      const input = field(id);
      const score = computeScoreTimeline(input);
      for (const c of cropsCsv) {
        const r = priceAndMargin(t, input, c.crop_id, score);
        if (!r.ok) continue;
        given++;
        expect(REGION_ISO3[r.rows[0].reference.region], `${id} ${c.crop_id}`).toBe(economicCountry(input.parcel));
      }
    }
    expect(given).toBeGreaterThan(40);
  });

  it("a record of the field's own country without a cost is given, and says there is no margin", () => {
    const input = field('iowa-corn-soy');
    const noCost = cropsCsv.map((c) => c.crop_id).find((id) => {
      const ref = referenceEconomics(id, input.parcel);
      return ref && REGION_ISO3[ref.region] === 'USA' && ref.costUsdPerHa == null;
    });
    expect(noCost, 'no US record without a cost to test with').toBeDefined();
    const r = priceAndMargin(t, input, noCost!);
    sourced(r);
    expect(r.rows[0].season).toBeNull();
    expect(r.caveats.some((c) => c.en.startsWith('The record has no cost, or the model cannot place the crop on this field'))).toBe(true);
  });
});
