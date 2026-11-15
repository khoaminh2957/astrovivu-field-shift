/**
 * The index against the crop atlas: only the crops the atlas keeps, a sheet on where each is
 * grown with the atlas's own numbers, and the names of the species it dropped. Reads the built
 * bundles (public/rag); requires `npm run rag:build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import type { CropFacts, RagBundle } from '../../src/rag/types';
import { chunkKind } from '../../src/rag/types';
import { groupDigits, renderWhere, whereLines } from '../../src/rag/facts';
import { countriesOf, readAtlasCrops, readDropped, topCountries, whereOf } from './atlas';
import { buildDropped } from './build';
import { CURATED, FORMERLY_CURATED } from './curated';

const ROOT = path.resolve(import.meta.dirname, '../..');
const bundle = (kind: 'core' | 'full') => JSON.parse(fs.readFileSync(path.join(ROOT, `public/rag/${kind}.json`), 'utf8')) as RagBundle;
const core = bundle('core');
const full = bundle('full');
const chunks = [...core.chunks, ...full.chunks];
const crops = new Map([...core.crops, ...full.crops].map((c) => [c.id, c]));
const atlas = readAtlasCrops();
// The atlas itself, for the numbers and years a sheet is checked against.
type Row = Record<string, string>;
const csv = (name: string): Row[] => Papa.parse<Row>(fs.readFileSync(path.join(ROOT, 'data/crops/atlas', name), 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
const cropCountry = csv('crop_country.csv');
const cropsCsv = csv('crops.csv');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rag/manifest.json'), 'utf8')) as {
  sources: Record<string, { documents: number; chunks: number }>;
  chunks: { core: number; total: number };
  artifacts: Record<string, { bytes: number; gzip: number }>;
  crops: { core: number; full: number };
  dropped: { inAtlas: number; named: number; names: number };
};

describe('the crop atlas as the index build reads it', () => {
  it('has the kept crops, the dropped species with one of two reasons, and the countries of a crop', () => {
    expect(atlas).toHaveLength(387);
    expect(atlas.filter((a) => a.ecocropId == null).map((a) => a.cropId)).toEqual(['tagetes-erecta']);
    const dropped = readDropped();
    expect(dropped).toHaveLength(2182);
    expect(dropped.filter((d) => d.reason === 'no-item')).toHaveLength(2158);
    expect(dropped.filter((d) => d.reason === 'group-only')).toHaveLength(24);
    expect(dropped.find((d) => d.id === 'abelmoschus-manihot')).toMatchObject({ sci: 'Abelmoschus manihot', reason: 'no-item', commonNames: expect.arrayContaining(['aibika']) });
    expect(topCountries('oryza-sativa', 3).map((c) => [c.iso3, c.rank])).toEqual([['IND', 1], ['CHN', 2], ['BGD', 3]]);
    // A group crop has no area of its own in any country.
    expect(countriesOf('durio-zibethinus')).toEqual([]);
  });

  it('every curated crop of the assistant is a crop the atlas keeps', () => {
    const kept = new Set(atlas.map((a) => a.sci));
    expect(CURATED.filter((c) => !kept.has(c.eco))).toEqual([]);
    expect(CURATED).toHaveLength(70);
    // The four taken out are in dropped.csv.
    const dropped = new Set(readDropped().map((d) => d.sci));
    for (const f of FORMERLY_CURATED) expect(dropped.has(f.eco), f.eco).toBe(true);
  });
});

describe('the built index', () => {
  it('holds only crops of the atlas: every crop id of every eco: passage is in crops.csv', () => {
    const ids = new Set(atlas.map((a) => a.cropId));
    const eco = chunks.filter((c) => c.id.startsWith('eco:'));
    expect(eco.length).toBeGreaterThan(1000);
    const strangers = eco.flatMap((c) => (c.cropIds ?? []).filter((id) => !ids.has(id)).map((id) => `${c.id}: ${id}`));
    expect(strangers).toEqual([]);
    // Wikipedia passages tied to a crop are tied to a kept crop as well.
    expect(chunks.flatMap((c) => c.cropIds ?? []).filter((id) => !ids.has(id))).toEqual([]);
    expect(new Set(crops.keys())).toEqual(ids);
  });

  it('has a fact sheet and a sheet on where it is grown, in both languages, for every crop of the atlas', () => {
    const have = new Set(chunks.map((c) => c.id));
    for (const a of atlas) for (const part of ['facts', 'where', 'where-vi']) expect(have.has(`eco:${a.cropId}:${part}`), `eco:${a.cropId}:${part}`).toBe(true);
    const where = chunks.filter((c) => chunkKind(c) === 'where');
    expect(where).toHaveLength(2 * atlas.length);
    for (const c of where) {
      expect(c.source.name).toContain('FAOSTAT');
      expect(c.source.license).toContain('CC BY 4.0');
      // The name goes into an attribute of the passage tag of the prompt: no double quote in it.
      expect(c.source.name).not.toContain('"');
    }
  });

  it('counts what the manifest says, and both files are smaller than before the corpus was cut down', () => {
    expect(manifest.sources.ecocrop.documents).toBe(atlas.filter((a) => a.ecocropId != null).length);
    expect(manifest.sources.ecocrop.documents).toBe(386);
    expect(manifest.sources['crop-atlas']).toMatchObject({ documents: 387, chunks: 774 });
    expect(manifest.crops).toEqual({ core: CURATED.length, full: atlas.length - CURATED.length });
    expect(manifest.chunks.total).toBe(chunks.length);
    // Before (data/rag/manifest.json on 13 November 2026): 6,108 passages, 4,229,368 and 16,656,684 bytes.
    expect(manifest.chunks.total).toBeLessThan(6108);
    expect(manifest.artifacts['public/rag/core.json'].bytes).toBeLessThan(4_229_368);
    expect(manifest.artifacts['public/rag/full.json'].bytes).toBeLessThan(16_656_684);
    expect(fs.statSync(path.join(ROOT, 'public/rag/core.json')).size).toBe(manifest.artifacts['public/rag/core.json'].bytes);
    expect(fs.statSync(path.join(ROOT, 'public/rag/full.json')).size).toBe(manifest.artifacts['public/rag/full.json'].bytes);
  });
});

describe('the sheet on where a crop is grown', () => {
  const rice = crops.get('oryza-sativa')!;
  const riceRow = atlas.find((a) => a.cropId === 'oryza-sativa')!.row;
  const vietNam = countriesOf('oryza-sativa').find((c) => c.iso3 === 'VNM')!;

  it('rice: 116 countries and Viet Nam with 7,089,041 ha, as crops.csv and crop_country.csv have them', () => {
    expect(riceRow.n_countries_producing).toBe('116');
    expect(vietNam.areaHa).toBe(7_089_041);
    expect(rice.prevalence).toMatchObject({ match: 'exact', countries: 116, worldAreaHa: Number(riceRow.world_area_ha), years: riceRow.data_years, faostatItem: 'Rice', sharedBy: 3 });
    expect(rice.prevalence!.top!.map((c) => c.iso3)).toEqual(['IND', 'CHN', 'BGD', 'THA', 'IDN']);
    // Viet Nam is the sixth: named beside the five largest because it is one of the app's two home countries.
    const vnmRow = cropCountry.find((r) => r.crop_id === 'oryza-sativa' && r.iso3 === 'VNM')!;
    expect(rice.prevalence!.also).toEqual(expect.arrayContaining([{ iso3: 'VNM', name: 'Viet Nam', areaHa: 7_089_041, level: 'major', rank: 6, years: `${vnmRow.year_from}-${vnmRow.year_to}` }]));
    const en = chunks.find((c) => c.id === 'eco:oryza-sativa:where')!.text;
    expect(en).toContain('116 countries report production to FAOSTAT');
    expect(en).toContain(`Viet Nam: 7,089,041 ha, mean of ${vnmRow.year_from}-${vnmRow.year_to}, the 6th largest.`);
    expect(en).toContain('These are the figures of the FAOSTAT item Rice, which the atlas ties to 3 crops');
    const vi = chunks.find((c) => c.id === 'eco:oryza-sativa:where-vi')!.text;
    expect(vi).toContain('116 nước báo cáo sản xuất với FAOSTAT');
    expect(vi).toContain(`Việt Nam: 7.089.041 ha, trung bình ${vnmRow.year_from}-${vnmRow.year_to}, lớn thứ 6.`);
    // The passage is what the renderer gives for the facts in the bundle.
    expect(en).toBe(renderWhere(rice, 'en'));
    expect(vi).toBe(renderWhere(rice, 'vi'));
  });

  it('durian, counted inside a group item: no area of any country', () => {
    const durian = crops.get('durio-zibethinus')!;
    expect(durian.prevalence).toEqual({ match: 'group', faostatItem: 'Other tropical fruits, n.e.c.', sharedBy: 31 });
    for (const id of ['eco:durio-zibethinus:where', 'eco:durio-zibethinus:where-vi']) {
      const text = chunks.find((c) => c.id === id)!.text;
      expect(text).not.toMatch(/\d ha\b/);
      expect(text).toContain('Other tropical fruits, n.e.c.');
    }
    expect(chunks.find((c) => c.id === 'eco:durio-zibethinus:where')!.text).toMatch(/^FAOSTAT has no figures for Durian \(Durio zibethinus\) alone: it is counted inside the item Other tropical fruits, n\.e\.c\., with 30 other crops of the atlas\. No area can be given for any country\./);
  });

  it('a crop no FAOSTAT item covers, and the crop EcoCrop has no record of', () => {
    const marigold = crops.get('tagetes-erecta')!;
    expect(marigold.ecocropId).toBeUndefined();
    expect(marigold.prevalence).toEqual({ match: 'none' });
    expect(whereLines(marigold, 'en')).toEqual(['The crop atlas ties no FAOSTAT item to Marigold (Tagetes erecta), so it has no figures by country for it.']);
    expect(whereLines(marigold, 'vi')).toEqual(['Atlas cây trồng chưa gắn mặt hàng FAOSTAT nào với Cúc vạn thọ (Tagetes erecta), nên không có số liệu theo nước cho cây này.']);
    const sheet = chunks.find((c) => c.id === 'eco:tagetes-erecta:facts')!;
    expect(sheet.text).toContain('FAO EcoCrop has no record of this crop');
    // The atlas is a document of the repository: named, with no link a reader could not open.
    expect(sheet.source).toMatchObject({ name: 'Astrovivu crop atlas (docs/CROP_DATA.md)', url: '' });
  });

  it('says of a crop without an item what the atlas did, not what FAOSTAT has (review of #107, point 3)', () => {
    // Banana: the atlas ties no item to Musa acuminata (and "Plantains and cooking bananas" to Musa
    // sapientum). That FAOSTAT has no item for bananas does not follow, and is not so.
    const banana = crops.get('musa-acuminata')!;
    expect(banana.prevalence).toEqual({ match: 'none' });
    expect(cropsCsv.find((r) => r.crop_id === 'musa-acuminata')).toMatchObject({ match: 'none', faostat_item: '' });
    expect(cropsCsv.find((r) => r.crop_id === 'musa-sapientum')!.faostat_item).toBe('Plantains and cooking bananas');
    expect(atlas.filter((x) => x.match === 'none')).toHaveLength(20);
    for (const a of atlas.filter((x) => x.match === 'none')) {
      for (const lang of ['en', 'vi'] as const) {
        const text = renderWhere(crops.get(a.cropId)!, lang);
        expect(text, a.cropId).not.toMatch(/FAOSTAT's crop statistics have no item|FAOSTAT không có mặt hàng/);
        expect(text, a.cropId).toMatch(lang === 'en' ? /^The crop atlas ties no FAOSTAT item to / : /^Atlas cây trồng chưa gắn mặt hàng FAOSTAT nào với /);
      }
    }
  });

  it('gives each country the years its own figure is the mean of (review of #107, point 4)', () => {
    const years = (cropId: string, iso3: string) => {
      const r = cropCountry.find((x) => x.crop_id === cropId && x.iso3 === iso3)!;
      return r.year_from === r.year_to ? r.year_from : `${r.year_from}-${r.year_to}`;
    };
    for (const a of atlas.filter((x) => x.match === 'exact')) {
      const w = crops.get(a.cropId)!.prevalence!;
      for (const c of [...(w.top ?? []), ...(w.also ?? [])]) expect(c.years, `${a.cropId} ${c.iso3}`).toBe(years(a.cropId, c.iso3));
      const text = renderWhere(crops.get(a.cropId)!, 'en');
      // The covering span is said to be that, never the years of one figure.
      if (w.years) expect(text, a.cropId).toContain(`(each country's mean of its latest three years with data, within ${w.years})`);
      expect(text, a.cropId).not.toMatch(/ha harvested in the world \(mean of/);
      // Every country named has its years: once for all when they are the same, else one by one.
      const top = w.top ?? [];
      if (top.length && top.every((c) => c.years === top[0].years)) expect(text, a.cropId).toContain(`Largest harvested areas (means of ${top[0].years}): `);
      else for (const c of top) expect(text, a.cropId).toContain(`${groupDigits(c.areaHa, 'en')} ha, mean of ${c.years}`);
      for (const c of w.also ?? []) expect(text, a.cropId).toContain(`${groupDigits(c.areaHa, 'en')} ha, mean of ${c.years}, the `);
    }
    // Rice: the world figure covers 2021-2024, Viet Nam's is of 2022-2024.
    expect(rice.prevalence!.years).toBe('2021-2024');
    expect(years('oryza-sativa', 'VNM')).toBe('2022-2024');
    // A crop whose largest growers do not share their years names them one by one.
    const mixed = atlas.find((x) => x.match === 'exact' && new Set((crops.get(x.cropId)!.prevalence!.top ?? []).map((c) => c.years)).size > 1);
    expect(mixed, 'no crop has largest growers with different years').toBeDefined();
  });

  it('names the FAOSTAT item on every sheet with figures, shared or not (review of #107, point 5)', () => {
    const exact = atlas.filter((x) => x.match === 'exact');
    expect(exact.length).toBe(165);
    for (const a of exact) {
      const w = crops.get(a.cropId)!.prevalence!;
      expect(w.faostatItem, a.cropId).toBe(a.row.faostat_item);
      const shared = Number(a.row.item_shared_by_n_crops) > 1;
      expect(renderWhere(crops.get(a.cropId)!, 'en'), a.cropId).toContain(shared ? `These are the figures of the FAOSTAT item ${w.faostatItem}, which the atlas ties to ${w.sharedBy} crops; they are not for one crop alone.` : `These are the figures of the FAOSTAT item ${w.faostatItem}.`);
      expect(renderWhere(crops.get(a.cropId)!, 'vi'), a.cropId).toContain(`Đây là số liệu của mặt hàng FAOSTAT ${w.faostatItem}`);
    }
    // Carrot: the area is that of "Carrots and turnips", and the sheet says so.
    expect(renderWhere(crops.get('daucus-carota')!, 'en')).toContain('These are the figures of the FAOSTAT item Carrots and turnips.');
  });

  it('every number of every sheet is a number of the atlas', () => {
    for (const a of atlas) {
      const w = whereOf(a);
      expect(crops.get(a.cropId)!.prevalence, a.cropId).toEqual(w);
      const allowed = new Set<string>();
      for (const v of [w.countries, w.worldAreaHa, w.sharedBy, w.sharedBy != null ? w.sharedBy - 1 : undefined]) if (v != null) allowed.add(String(v));
      for (const c of [...(w.top ?? []), ...(w.also ?? [])]) [c.areaHa, c.rank, ...(c.years ?? '').split('-').filter(Boolean)].forEach((v) => allowed.add(String(v)));
      for (const y of (w.years ?? '').split('-')) if (y) allowed.add(y);
      // The digits of the names (crop, item, country) are not figures.
      const text = renderWhere(crops.get(a.cropId)!, 'en').replace(a.sci, '').replace(w.faostatItem ?? '\u0000', '');
      const found = (text.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, ''));
      expect(found.filter((n) => !allowed.has(n)), `${a.cropId}: ${text}`).toEqual([]);
    }
  });

  it('writes whole numbers with the separators of the language', () => {
    expect(groupDigits(7089041, 'en')).toBe('7,089,041');
    expect(groupDigits(7089041, 'vi')).toBe('7.089.041');
    expect(groupDigits(999, 'vi')).toBe('999');
  });

  it('gives a crop outside the curated list the names of the atlas', () => {
    // Quinoa is not in the assistant's curated list; the atlas has an English name for it.
    const quinoa = crops.get('chenopodium-quinoa')!;
    expect(quinoa.curated).toBe(false);
    expect(quinoa.en).toBe(atlas.find((a) => a.cropId === 'chenopodium-quinoa')!.nameEn);
    const named: CropFacts[] = [...crops.values()].filter((c) => !c.curated && c.vi);
    for (const c of named) expect(c.vi, c.id).toBe(atlas.find((a) => a.cropId === c.id)!.nameVi);
  });
});

describe('the names of the species the atlas dropped', () => {
  it('are in the lazy bundle, and none of them is a name a kept crop answers to', () => {
    expect(full.dropped).toBeDefined();
    expect(core.dropped).toBeUndefined();
    const table = full.dropped!;
    expect(Object.keys(table.species).length).toBe(manifest.dropped.named);
    expect(manifest.dropped.inAtlas).toBe(2182);
    const kept = { ...core.aliases.map, ...full.aliases.map };
    expect(Object.keys(table.aliases).filter((k) => k in kept)).toEqual([]);
    expect(table.aliases.aibika).toEqual(['abelmoschus-manihot']);
    expect(table.species['abelmoschus-manihot']).toEqual(['Abelmoschus manihot', 'n']);
    // Every id a name points to has its species, and every reason is one of the two.
    for (const ids of Object.values(table.aliases)) for (const id of ids) expect(table.species[id], id).toBeDefined();
    expect(new Set(Object.values(table.species).map((s) => s[1]))).toEqual(new Set(['n', 'g']));
  });

  it('keep the names the four former curated crops were known by', () => {
    const table = full.dropped!;
    expect(table.aliases.macadamia).toEqual(['macadamia-integrifolia']);
    expect(table.aliases['dau van']).toEqual(['lablab-purpureus']);
    expect(table.aliases['white clover']).toEqual(['trifolium-repens']);
    expect(table.aliases.stylo).toEqual(['stylosanthes-guianensis-var-guianensis']);
  });

  it('leave a name to the kept crop, and one-word names that are ordinary words out', () => {
    const table = buildDropped(
      [
        { id: 'a', sci: 'Testus alpha', commonNames: ['rice', 'bush', 'alpha weed', 'zzq'], reason: 'no-item' },
        { id: 'b', sci: 'Testus beta', commonNames: ['common'], reason: 'group-only' },
      ],
      (key) => key === 'rice',
      (key) => (key === 'common' ? 9 : 0),
    );
    // "rice" is a kept crop's, "bush" a generic word, "zzq" too short; "common" is frequent in prose.
    expect(table.aliases).toEqual({ 'testus alpha': ['a'], 'alpha weed': ['a'], 'testus beta': ['b'] });
    expect(table.species).toEqual({ a: ['Testus alpha', 'n'], b: ['Testus beta', 'g'] });
  });
});
