/**
 * The lookup functions as the model calls them: names and schemas, how the words of the model are
 * turned into a crop and a place, what comes back, and what a wrong input does. Expected numbers
 * are read from data/crops/atlas/*.csv. Requires `npm run rag:build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Lang, ModelInput } from '../src/contracts';
import { sampleModelInput } from '../scripts/rag/sample-context';
import { assessCrop } from '../src/core/scoring';
import { KnowledgeStore } from '../src/rag/store';
import { tableSource } from '../src/rag/tables';
import { fileLoader, fileReader } from './loader';
import { type AskTool, askTools, inLanguage, MAX_ROWS, type ToolOutput } from './tools';

const ROOT = path.resolve(import.meta.dirname, '..');
type Row = Record<string, string>;
const csv = (name: string): Row[] => Papa.parse<Row>(fs.readFileSync(path.join(ROOT, 'data/crops/atlas', name), 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
const cropCountry = csv('crop_country.csv');
const area = (cropId: string, iso3: string) => Number(cropCountry.find((r) => r.crop_id === cropId && r.iso3 === iso3)!.area_ha);

const tables = tableSource(fileReader(path.join(ROOT, 'public')));
let store: KnowledgeStore;
beforeAll(async () => {
  store = new KnowledgeStore(fileLoader(path.join(ROOT, 'public/rag')));
  await store.ensureFull();
});

const tools = (lang: Lang = 'en', field: ModelInput | null = null): Record<string, AskTool> => Object.fromEntries(askTools({ store, tables, field, lang }).map((t) => [t.name, t]));
interface Found {
  ok: true;
  rows: Record<string, unknown>[];
  rowCount: number;
  rowsShown?: number;
  sources: { name: string; licence: string; year: string }[];
  caveats: string[];
  [key: string]: unknown;
}
const found = (out: ToolOutput): Found => {
  expect(out.result.ok, JSON.stringify(out.result).slice(0, 300)).toBe(true);
  expect(out.citation).toBeDefined();
  return out.result as unknown as Found;
};

describe('the tool definitions', () => {
  it('are the eight lookups, each with a description and a closed schema', () => {
    const all = askTools({ store, tables, field: null, lang: 'en' });
    expect(all.map((t) => t.name)).toEqual(['cropsInPlace', 'whereGrown', 'cropFigures', 'compareCrops', 'fieldSuitability', 'rotationOptions', 'soilPlan', 'priceAndMargin']);
    expect(all.filter((t) => t.needsField).map((t) => t.name)).toEqual(['fieldSuitability', 'rotationOptions', 'soilPlan', 'priceAndMargin']);
    for (const t of all) {
      // The name rule of both providers.
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
      expect(t.description.length).toBeGreaterThan(120);
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(t.inputSchema).not.toHaveProperty('$schema');
      // Every input says what it is.
      for (const p of Object.values((t.inputSchema.properties ?? {}) as Record<string, { description?: string }>)) expect(p.description?.length).toBeGreaterThan(20);
    }
    expect(tools().whereGrown.inputSchema).toMatchObject({ required: ['crop'], properties: { crop: { type: 'string', maxLength: 120 }, top: { type: 'integer', minimum: 1, maximum: 15 } } });
    expect(tools().rotationOptions.inputSchema).toMatchObject({ properties: {} });
  });

  it('refuse an input that does not fit the schema, before anything is looked up', async () => {
    const t = tools();
    await expect(t.whereGrown.run({})).rejects.toThrow(/Invalid input for whereGrown: crop/);
    await expect(t.whereGrown.run({ crop: 42 })).rejects.toThrow(/Invalid input for whereGrown: crop/);
    await expect(t.whereGrown.run({ crop: 'rice', top: 500 })).rejects.toThrow(/top/);
    await expect(t.whereGrown.run({ crop: 'rice', areaHa: 1 })).rejects.toThrow(/Invalid input/);
    await expect(t.cropsInPlace.run({ country: 'VNM', limit: MAX_ROWS + 1 })).rejects.toThrow(/limit/);
    await expect(t.whereGrown.run({ crop: 'x'.repeat(500) })).rejects.toThrow(/crop/);
    // A model that sends nothing where an object is due has sent an empty object.
    await expect(t.rotationOptions.run(undefined)).resolves.toMatchObject({ result: { ok: false, reason: 'no-field' } });
  });
});

describe('the words of the model become a crop and a place', () => {
  it('finds rice by its Vietnamese, English and scientific name, and by its id', async () => {
    for (const crop of ['lúa', 'rice', 'Oryza sativa', 'oryza-sativa', 'cây lúa']) {
      const r = found(await tools('vi').whereGrown.run({ crop, country: 'VNM' }));
      expect(r.crop, crop).toBe('Lúa (Oryza sativa)');
      expect(r.rows.find((x) => x.iso3 === 'VNM')?.areaHa, crop).toBe(area('oryza-sativa', 'VNM'));
    }
  });

  it('takes the longer name: sweet potato is not potato', async () => {
    expect(found(await tools().cropFigures.run({ crop: 'sweet potato' })).crop).toMatch(/Ipomoea batatas/);
  });

  it('does not take a name that only holds a crop name for that crop, and says which crop it saw', async () => {
    const out = await tools().whereGrown.run({ crop: 'moon cabbage', country: 'VNM' });
    expect(out.result).toMatchObject({ ok: false, reason: 'unknown-crop' });
    expect(out.result.message).toMatch(/has no crop named "moon cabbage"\. It has Cabbage .*ask again with that name/);
    expect(out.citation).toBeUndefined();
    expect((await tools('vi').fieldSuitability.run({ crop: 'lúa mặt trăng' })).result.message).toMatch(/không có cây nào tên "lúa mặt trăng"\. Atlas có Lúa \(Oryza sativa\)/);
    // A word that names no other plant does not change the crop.
    expect(found(await tools().cropFigures.run({ crop: 'the rice crop' })).crop).toBe('Rice (Oryza sativa)');
  });

  it('finds a country by code or by name, in either language', async () => {
    for (const country of ['VNM', 'vnm', 'Viet Nam', 'Vietnam', 'Việt Nam']) {
      const out = await tools().whereGrown.run({ crop: 'rice', country });
      expect(out.citation?.chunkId, country).toBe('table:crop-countries:oryza-sativa:VNM');
    }
    for (const country of ['USA', 'United States of America', 'United States', 'Hoa Kỳ', 'Mỹ']) expect((await tools().whereGrown.run({ crop: 'maize', country })).citation?.chunkId, country).toBe('table:crop-countries:zea-mays:USA');
    expect((await tools().whereGrown.run({ crop: 'rice', country: 'Thailand' })).citation?.chunkId).toBe('table:crop-countries:oryza-sativa:THA');
    expect((await tools().whereGrown.run({ crop: 'rice', country: 'Atlantis' })).result).toMatchObject({ ok: false, reason: 'unknown-place' });
  });

  it('says so when no crop answers to the name, and when the atlas dropped the species', async () => {
    expect((await tools().whereGrown.run({ crop: 'zzyzx' })).result).toMatchObject({ ok: false, reason: 'unknown-crop', message: 'The crop atlas has no crop by that name.' });
    const dropped = await tools('vi').whereGrown.run({ crop: 'aibika' });
    expect(dropped.result).toMatchObject({ ok: false, reason: 'dropped-crop' });
    expect(dropped.result.message).toMatch(/Atlas cây trồng không giữ loài này/);
    expect(dropped.citation).toBeUndefined();
  });
});

describe('what a lookup hands back', () => {
  it('whereGrown: the largest growers and the country asked for, with the source and its licence', async () => {
    const out = await tools().whereGrown.run({ crop: 'rice', country: 'VNM' });
    const r = found(out);
    expect(r.rows[0]).toMatchObject({ iso3: 'IND', country: 'India', areaHa: area('oryza-sativa', 'IND'), rank: 1 });
    expect(r.rows.find((x) => x.iso3 === 'VNM')).toMatchObject({ areaHa: area('oryza-sativa', 'VNM'), level: 'major' });
    expect(r.rowCount).toBe(r.rows.length);
    expect(r.sources[0].name).toMatch(/FAOSTAT/);
    expect(r.sources[0].licence).toMatch(/CC BY/);
    expect(r.caveats.join(' ')).toMatch(/item Rice, which the atlas ties to 3 crops/);
    expect(out.citation).toMatchObject({ chunkId: 'table:crop-countries:oryza-sativa:VNM', title: 'Where Rice (Oryza sativa) is grown' });
    expect(out.citation!.source).toMatch(/FAOSTAT.*20\d\d/);
    expect(out.citation!.url).toMatch(/^https:\/\//);
    expect(out.citation!.snippet).toContain(`India ${area('oryza-sativa', 'IND').toLocaleString('en-US')} ha`);
  });

  it('whereGrown: a crop counted inside a group has no figure, and no citation', async () => {
    const out = await tools().whereGrown.run({ crop: 'durian', country: 'VNM' });
    expect(out.result).toMatchObject({ ok: false, reason: 'group-item' });
    expect(out.result.message).toMatch(/there is no figure for it alone/);
    expect(JSON.stringify(out.result)).not.toMatch(/areaHa/);
    expect(out.citation).toBeUndefined();
  });

  it('cropsInPlace: the first rows of a long table, and how many there are', async () => {
    const out = await tools().cropsInPlace.run({ country: 'VNM' });
    const r = found(out);
    expect(r.rows).toHaveLength(15);
    expect(r.rowsShown).toBe(15);
    expect(r.rowCount).toBeGreaterThan(15);
    expect(r.place).toBe('Viet Nam');
    expect(r.rows[0]).toMatchObject({ name: 'Rice', areaHa: area('oryza-sativa', 'VNM'), level: 'major', rank: 1 });
    // The crops of a row are given by name, the three rice crops in one row.
    expect((r.rows[0].crops as string[]).some((c) => c.includes('Oryza sativa'))).toBe(true);
    expect(r.rows[0]).not.toHaveProperty('cropIds');
    expect(out.citation!.chunkId).toBe('table:country:VNM');
    expect((found(await tools().cropsInPlace.run({ country: 'VNM', limit: 3 })).rows).length).toBe(3);
  });

  it('cropsInPlace: a province from MapSPAM, under the name MapSPAM gives it', async () => {
    const out = await tools('vi').cropsInPlace.run({ country: 'Việt Nam', region: 'Đắk Lắk' });
    const r = found(out);
    expect(out.citation!.chunkId).toMatch(/^table:region:VNM:Dak Lak/);
    expect(r.sources[0].name).toMatch(/SPAM/);
    expect(r.caveats.join(' ')).toMatch(/Ước tính MapSPAM/);
  });

  it('cropsInPlace: the country of the locked field when none is named, and a refusal when there is neither', async () => {
    expect((await tools('en', sampleModelInput('iowa-corn-soy')).cropsInPlace.run({})).citation?.chunkId).toBe('table:country:USA');
    expect((await tools().cropsInPlace.run({})).result).toMatchObject({ ok: false, reason: 'unknown-place', message: 'No country was given and no field is locked.' });
  });

  it('cropFigures and compareCrops: lines in the language of the question', async () => {
    const vi = found(await tools('vi').cropFigures.run({ crop: 'đậu nành' }));
    expect(vi.rows.find((x) => x.key === 'ph')?.line).toMatch(/pH/);
    expect(typeof vi.rows[0].line).toBe('string');
    const cmp = await tools().compareCrops.run({ cropA: 'rice', cropB: 'maize', country: 'VNM' });
    const c = found(cmp);
    expect(c).toMatchObject({ cropA: 'Rice (Oryza sativa)', cropB: 'Maize (Zea mays)' });
    expect(c.rows.find((x) => x.key === 'in:VNM')).toMatchObject({ a: expect.stringContaining(String(area('oryza-sativa', 'VNM'))), b: expect.stringContaining(String(area('zea-mays', 'VNM'))) });
    expect(cmp.citation!.chunkId).toBe('table:compare:oryza-sativa:zea-mays');
  });
});

describe('the lookups that need the locked field', () => {
  it('answer "no field is locked" without one', async () => {
    const t = tools('vi');
    for (const out of [await t.fieldSuitability.run({ crop: 'lúa' }), await t.rotationOptions.run({}), await t.soilPlan.run({}), await t.priceAndMargin.run({ crop: 'lúa' })]) {
      expect(out.result).toMatchObject({ ok: false, reason: 'no-field', message: 'Chưa khoá thửa ruộng nào: việc này cần số liệu của một thửa ruộng.' });
      expect(out.citation).toBeUndefined();
    }
  });

  it('fieldSuitability: the crop on the field when none is named, factor by factor', async () => {
    const field = sampleModelInput('daklak-coffee');
    const out = await tools('vi', field).fieldSuitability.run({});
    const r = found(out);
    expect(r).toMatchObject({ crop: 'Cà phê vối (Coffea canephora)', field: field.parcel.name });
    const row = r.rows[0] as { suitabilityOutOf100: number; factors: { key: string; label: string; actual: unknown; scoreOutOf100: number | null; source?: string }[]; reliability: unknown };
    // The score as the app shows it, so the model converts nothing: the model's 0-to-1 value times 100, rounded.
    expect(row.suitabilityOutOf100).toBe(Math.round(assessCrop(field, 'coffea-canephora')!.compatibility * 100));
    expect(row).not.toHaveProperty('compatibility');
    expect(row.factors.find((f) => f.key === 'ph')).toMatchObject({ label: 'pH đất', actual: 5.7, scoreOutOf100: 100, source: field.telemetry.sources.soilgrids.name });
    expect(row.factors.find((f) => f.key === 'drainage')).toMatchObject({ actual: null, scoreOutOf100: null });
    // Left out: the score of each year, and what only the code needs.
    expect(row).not.toHaveProperty('yearScores');
    expect(row.factors[0]).not.toHaveProperty('weight');
    expect(row.factors[0]).not.toHaveProperty('sourceId');
    expect(out.citation!.snippet).toMatch(/^Mức phù hợp \d+\/100/);
    expect(out.citation!.chunkId).toBe('table:field-suitability:daklak-coffee:coffea-canephora');
    // Another crop on the same field.
    expect(found(await tools('en', field).fieldSuitability.run({ crop: 'soybean' })).crop).toBe('Soybean (Glycine max)');
  });

  it('rotationOptions: every rotation the advisory screen shows, with the margin and its range', async () => {
    const out = await tools('en', sampleModelInput('cantho-rice')).rotationOptions.run({});
    const r = found(out);
    expect(r.rows.length).toBeGreaterThanOrEqual(3);
    const current = r.rows[0] as { kind: string; name: string; seasons: { crop: string; startMonth: number }[]; marginUsdPerHaYr: { expected: number; low?: number; high?: number }; gaps: string[] };
    expect(current).toMatchObject({ kind: 'current', name: 'Current practice' });
    expect(typeof current.seasons[0].crop).toBe('string');
    expect(current.marginUsdPerHaYr.low).toBeLessThanOrEqual(current.marginUsdPerHaYr.expected);
    expect(current.gaps.every((g) => typeof g === 'string')).toBe(true);
    // The per-season accounts stay with priceAndMargin.
    expect(current).not.toHaveProperty('economics');
    expect(out.citation!.snippet).toContain('Current practice');
  });

  it('soilPlan and priceAndMargin: the plan and the reference record, each source named', async () => {
    const field = sampleModelInput('daklak-coffee');
    const plan = found(await tools('en', field).soilPlan.run({}));
    expect(plan.rows[0]).toMatchObject({ current: 5.7, amendment: 'none' });
    expect(plan.caveats.join(' ')).toMatch(/pH part only/);

    const out = await tools('en', field).priceAndMargin.run({});
    const price = found(out);
    const row = price.rows[0] as { reference: { priceUsdPerT: number; sources: string[] }; season: Record<string, unknown> };
    expect(row.reference.priceUsdPerT).toBeGreaterThan(0);
    expect(row.reference.sources.length).toBe(3);
    expect(row.season).not.toHaveProperty('sources');
    expect(row.season.marginUsd).toBeTypeOf('number');
    expect(out.citation!.chunkId).toBe('table:economics:coffea-canephora');
    // A crop with no reference record: no price is given, of this country or another.
    expect((await tools('en', field).priceAndMargin.run({ crop: 'quinoa' })).result).toMatchObject({ ok: false, reason: 'no-data' });
  });
});

describe('inLanguage', () => {
  it('replaces every { en, vi } pair, at any depth, and leaves the rest', () => {
    expect(inLanguage({ a: { en: 'x', vi: 'y' }, b: [{ en: 'p', vi: 'q' }, 3], c: { en: 'only' }, d: null, e: undefined }, 'vi')).toEqual({ a: 'y', b: ['q', 3], c: { en: 'only' }, d: null });
  });
});
