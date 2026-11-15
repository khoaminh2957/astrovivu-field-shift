/**
 * The lookup functions of src/rag/lookups.ts as tools a language model can call (issue C4).
 *
 * One tool per lookup, under the lookup's own name. Each has a description, an input schema built
 * from a zod schema, and a `run` that checks the model's input against that schema before anything
 * is looked up: the input is model output, so it is untrusted. A tool computes nothing: it finds
 * the crop and the place the words name, calls the lookup, and hands back the lookup's rows in the
 * language of the question with their sources and caveats. Long tables are cut to their first
 * rows, and the result says how many there are.
 *
 * Four lookups need the locked field as the model reads it (`ModelInput`): without one they
 * answer `no-field`, they do not guess. The server offers those four only when the request brings
 * the field (`needsField`), so the model is not shown a function that cannot run.
 */
import { z } from 'zod';
import type { I18nText, Lang, ModelInput, RotationStrategy } from '../src/contracts';
import { expandCountryTable } from '../src/data/countryTable';
import { detectCrops, resolveMention } from '../src/rag/aliases';
import { cropLabel, groupDigits } from '../src/rag/facts';
import { type AtlasTables, compareCrops, cropFigures, cropsInPlace, fieldSuitability, type LookupFailure, type LookupResult, type LookupSource, priceAndMargin, rotationOptions, soilPlan, whereGrown } from '../src/rag/lookups';
import type { KnowledgeStore } from '../src/rag/store';
import type { TableSource } from '../src/rag/tables';
import { clip, fold } from '../src/rag/text';

export interface ToolContext {
  store: KnowledgeStore;
  tables: TableSource;
  /** The locked field as the scoring and rotation models read it; null when the request brought none. */
  field: ModelInput | null;
  lang: Lang;
}

/** What a tool result is cited as: a `Citation` without its place in the answer. */
export interface ToolCitation {
  /** `table:<table>:<key>`. */
  chunkId: string;
  title: string;
  source: string;
  url: string;
  license: string;
  snippet: string;
}

export interface ToolOutput {
  /** What the model reads: `{ ok: true, rows, sources, caveats, ... }` or `{ ok: false, reason, message }`. */
  result: Record<string, unknown>;
  /** Present when the lookup found rows. */
  citation?: ToolCitation;
}

export interface AskTool {
  name: string;
  /** True for the lookups that read the locked field: they are offered only when the request brings one. */
  needsField: boolean;
  description: string;
  /** JSON Schema of the input, as both providers take it. */
  inputSchema: Record<string, unknown>;
  /** Checks the input and runs the lookup. Throws when the input does not fit the schema. */
  run(input: unknown): Promise<ToolOutput>;
}

export const MAX_ROWS = 40;
const DEFAULT_ROWS = 15;

const tx = (lang: Lang, en: string, vi: string) => (lang === 'vi' ? vi : en);

/** Every `{ en, vi }` pair in a value replaced by the text of one language. */
export function inLanguage(value: unknown, lang: Lang): unknown {
  if (Array.isArray(value)) return value.map((v) => inLanguage(v, lang));
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 2 && typeof o.en === 'string' && typeof o.vi === 'string') return o[lang];
    return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, inLanguage(o[k], lang)]));
  }
  return value;
}

const FAILURE: Record<LookupFailure, I18nText> = {
  'unknown-crop': { en: 'The crop atlas has no crop by that name.', vi: 'Atlas cây trồng không có cây nào tên như vậy.' },
  'dropped-crop': { en: 'The crop atlas does not keep this species.', vi: 'Atlas cây trồng không giữ loài này.' },
  'unknown-place': { en: 'The tables have no country or region by that name.', vi: 'Các bảng không có nước hay vùng nào tên như vậy.' },
  'group-item': { en: 'The statistics count this crop inside a group of crops: it has no figure of its own.', vi: 'Thống kê tính cây này trong một nhóm cây: cây không có số riêng.' },
  'no-data': { en: 'The tables hold nothing for this.', vi: 'Các bảng không có số liệu cho câu này.' },
  'no-field': { en: 'No field is locked: this needs the readings of a field.', vi: 'Chưa khoá thửa ruộng nào: việc này cần số liệu của một thửa ruộng.' },
};

/** Words around a crop name that do not change which crop it is ("cây lúa", "rice crop"). */
const FILLER = new Set(['cay', 'giong', 'crop', 'crops', 'plant', 'plants', 'tree', 'trees', 'the']);

/** The two home countries as people write them; every other country goes by its FAOSTAT name or its code. */
const COUNTRY_NAMES: Record<string, string> = { vietnam: 'VNM', 'viet nam': 'VNM', vn: 'VNM', usa: 'USA', us: 'USA', 'united states': 'USA', america: 'USA', my: 'USA', 'hoa ky': 'USA', 'nuoc my': 'USA' };

const Crop = z.string().trim().min(1).max(120).describe('The crop, by its English, Vietnamese or scientific name as the user wrote it, for example "rice", "lúa" or "Oryza sativa".');
const Country = z.string().trim().min(2).max(60).describe('A country, by its ISO 3166-1 alpha-3 code ("VNM", "USA") or its English name.');
const FieldCrop = Crop.optional().describe('The crop, by its English, Vietnamese or scientific name. Leave it out for the crop now on the locked field.');

const SCHEMAS = {
  cropsInPlace: z
    .object({
      country: Country.optional().describe('The country, by its ISO 3166-1 alpha-3 code ("VNM", "USA") or its English name. It may be left out only when a field is locked, and then means the country of that field.'),
      region: z.string().trim().min(1).max(80).optional().describe('A province or state of that country, for example "Dak Lak" or "Iowa"; give the country with it. Leave it out for the whole country.'),
      limit: z.number().int().min(1).max(MAX_ROWS).optional().describe(`How many rows to return, largest first (${DEFAULT_ROWS} when left out).`),
    })
    .strict(),
  whereGrown: z
    .object({
      crop: Crop,
      country: Country.optional().describe('A country whose own figures are wanted beside the largest growers, by its ISO 3166-1 alpha-3 code or its English name.'),
      top: z.number().int().min(1).max(15).optional().describe('How many of the largest growers to return (5 when left out).'),
    })
    .strict(),
  cropFigures: z.object({ crop: Crop }).strict(),
  compareCrops: z.object({ cropA: Crop, cropB: Crop, country: Country.optional().describe('A country whose figures for the two crops are wanted, by its ISO 3166-1 alpha-3 code or its English name.') }).strict(),
  fieldSuitability: z.object({ crop: FieldCrop }).strict(),
  rotationOptions: z.object({}).strict(),
  soilPlan: z.object({}).strict(),
  priceAndMargin: z.object({ crop: FieldCrop }).strict(),
};

const DESCRIPTIONS: Record<keyof typeof SCHEMAS, string> = {
  cropsInPlace:
    'What a country grows, largest harvested area first, from the FAOSTAT crop statistics; with `region`, what one province or state grows as MapSPAM estimates it for 2020. Use it for "what is grown here", "which crops are common in this country or province". Each row is one item of the statistics with its crops, area in hectares, share of the harvested area, rank and level (major, common, minor, present); a row that names a `source` is a figure of national statistics, not of FAOSTAT. A crop missing from the rows is not thereby a crop that is not grown: the caveats say why.',
  whereGrown:
    'The countries that harvest the largest area of one crop, from the FAOSTAT crop statistics, and, with `country`, the area, production, level and rank of that country. Use it for "where is this crop grown", "does this country grow it", "how much of it does this country grow". For Viet Nam and the United States the figure of the country can be one of its national statistics: the row then names its `source`, has no rank among the countries of FAOSTAT, and is said to be a national figure. A crop FAOSTAT counts only inside a group of crops has no figure of its own, and the result says so.',
  cropFigures:
    'What one crop needs (FAO EcoCrop: temperature, rainfall, soil pH, texture, depth, drainage, salinity, cycle length) and how widely it is grown (FAOSTAT: the number of countries reporting it and the harvested area of the world). Use it for "what does this crop need" when the knowledge passages do not already give the figures.',
  compareCrops: 'The requirements and world figures of two crops, line against line, and, with `country`, how much of each that country grows. Use it when the user asks to compare two crops.',
  fieldSuitability:
    'How a crop suits the locked field, as the suitability model of the application scores it: the suitability out of 100, each factor (temperature, water, pH, texture, drainage, salinity, depth and others) with its own score out of 100, the field reading, the source of that reading and the range the crop wants, the limiting factor, and in how many of the analysed years the needs were met. Needs a locked field. Use it for "can I grow this here", "how well does this crop fit my field".',
  rotationOptions:
    'The crop rotations the application proposes for the locked field, the current practice among them: the seasons of each with their months, its suitability, soil, water, risk and nitrogen figures, its margin per hectare and year with the range over the yield range, why it is proposed, what is not known and what needs local review. Needs a locked field. Use it for "what should I grow", "which rotation", "what after this crop".',
  soilPlan: 'What to do about the soil pH of the locked field for its crop: the pH now, the pH aimed at, and the amendment and indicative rate when one is needed. It covers pH only. Needs a locked field with a crop.',
  priceAndMargin:
    'The reference yield, farm-gate price and cost of a crop in the region of the locked field, each with the source it was taken from, and the revenue, cost and margin of one season on the field with those figures, with the range over the yield range. Reference values, not a forecast and not the grower\'s own figures. Needs a locked field.',
};

const FIELD_LOOKUPS = new Set<string>(['fieldSuitability', 'rotationOptions', 'soilPlan', 'priceAndMargin']);

/** JSON Schema of a zod schema, without the `$schema` line: a tool definition carries the schema bare. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

class Lookups {
  private atlas: Promise<AtlasTables> | null = null;
  constructor(private readonly ctx: ToolContext) {}

  private tables(): Promise<AtlasTables> {
    const t = this.ctx.tables;
    this.atlas ??= Promise.all([t.crops(), t.countries(), t.sources(), t.spam(), t.national()]).then(([crops, countries, sources, spam, national]) => ({ crops, countries, sources, spam, national }));
    return this.atlas;
  }

  private isDropped = (id: string): boolean => Boolean(this.ctx.store.dropped?.species[id]);

  /**
   * The crop a name stands for: an id of the atlas, or the id of a dropped species, or the name
   * itself when nothing answers to it (the lookup then says "unknown crop"). A name that only
   * holds a crop name among other words ("moon cabbage") is not taken for that crop: `near` says
   * which crop was seen in it, for the model to ask again if that is the one meant.
   */
  private crop(t: AtlasTables, name: string): { id: string; near?: string } {
    const asId = name.toLowerCase().replace(/\s+/g, '-');
    if (t.crops.crops[name]) return { id: name };
    if (t.crops.crops[asId]) return { id: asId };
    const { store } = this.ctx;
    const words = (name.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? []).map(fold);
    // The longest name wins: "sweet potato" is not "potato".
    const mentions = detectCrops(name, store.aliases).sort((a, b) => b.end - b.start - (a.end - a.start));
    for (const m of mentions) {
      const id = resolveMention(m, (x) => store.isCurated(x), 1)[0];
      if (!id || !t.crops.crops[id]) continue;
      const rest = words.filter((w, i) => (i < m.start || i >= m.end) && !FILLER.has(w));
      return rest.length ? { id: asId, near: id } : { id };
    }
    return { id: store.findDropped(name)[0]?.id ?? asId };
  }

  /** The answer to a name that is no crop of the atlas but holds the name of one. */
  private notThatCrop(t: AtlasTables, name: string, near: string): ToolOutput {
    const { lang } = this.ctx;
    const found = this.cropName(t, near);
    return {
      result: {
        ok: false,
        reason: 'unknown-crop',
        message: tx(lang, `The crop atlas has no crop named "${name}". It has ${found}: ask again with that name if it is the crop meant.`, `Atlas cây trồng không có cây nào tên "${name}". Atlas có ${found}: hãy hỏi lại bằng tên đó nếu đúng là cây muốn hỏi.`),
      },
    };
  }

  private cropName(t: AtlasTables, id: string): string {
    const facts = this.ctx.store.crops.get(id);
    if (facts) return cropLabel(facts, this.ctx.lang);
    const e = t.crops.crops[id];
    if (!e) return id;
    const common = this.ctx.lang === 'vi' ? (e.vi ?? e.en) : e.en;
    return common ? `${common} (${e.sci})` : e.sci;
  }

  /** ISO3 of a country given by code or name; of the locked field when none is given; null when unknown. */
  private iso3(t: AtlasTables, country: string | undefined): string | null {
    if (!country) return this.ctx.field?.parcel.place?.iso3 ?? null;
    const code = country.toUpperCase();
    if (t.countries[code]) return code;
    const key = fold(country).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (COUNTRY_NAMES[key]) return COUNTRY_NAMES[key];
    const names = Object.entries(t.countries).map(([iso, name]) => [iso, fold(name)] as const);
    return names.find(([, n]) => n === key)?.[0] ?? names.find(([, n]) => n.startsWith(`${key},`) || n.startsWith(`${key} (`))?.[0] ?? null;
  }

  /** The locked field with the crop table of its country, as the app gives it to the model. */
  private async field(): Promise<ModelInput | null> {
    const f = this.ctx.field;
    if (!f) return null;
    const iso3 = f.parcel.place?.iso3;
    const file = iso3 ? await this.ctx.tables.country(iso3) : null;
    return file ? { ...f, country: expandCountryTable(file) } : f;
  }

  private num(v: number | null | undefined): string {
    return v == null ? '' : groupDigits(v, this.ctx.lang);
  }

  /** The lookup's result as the model reads it, and what it is cited as when it has rows. */
  private output<Row>(r: LookupResult<Row>, extra: Record<string, unknown>, rows: (rows: Row[]) => unknown[], cite: { chunkId: string; title: string; snippet: (rows: Row[]) => string }, limit = MAX_ROWS): ToolOutput {
    const { lang } = this.ctx;
    if (!r.ok) {
      const caveats = r.caveats.map((c) => c[lang]);
      return { result: { ok: false, reason: r.reason, message: caveats[0] ?? FAILURE[r.reason][lang], ...(caveats.length > 1 ? { caveats: caveats.slice(1) } : {}), ...extra } };
    }
    const shown = r.rows.slice(0, limit);
    const sources = r.sources;
    return {
      result: {
        ok: true,
        ...extra,
        rows: inLanguage(rows(shown), lang),
        rowCount: r.rows.length,
        ...(shown.length < r.rows.length ? { rowsShown: shown.length } : {}),
        ...(r.facts ? { facts: r.facts } : {}),
        sources: sources.map((s) => inLanguage(s, lang)),
        caveats: r.caveats.map((c) => c[lang]),
      },
      citation: { chunkId: cite.chunkId, title: cite.title, ...citedSource(sources), snippet: clip(cite.snippet(shown), 280) },
    };
  }

  async cropsInPlace(input: z.infer<typeof SCHEMAS.cropsInPlace>): Promise<ToolOutput> {
    const t = await this.tables();
    const { lang } = this.ctx;
    const iso3 = this.iso3(t, input.country);
    if (!iso3)
      return { result: { ok: false, reason: 'unknown-place', message: input.country ? FAILURE['unknown-place'][lang] : tx(lang, 'No country was given and no field is locked.', 'Chưa nêu nước nào và chưa khoá thửa ruộng nào.') } };
    const r = cropsInPlace(t, { country: await this.ctx.tables.country(iso3), regions: input.region ? await this.ctx.tables.regions(iso3) : null }, iso3, input.region);
    const place = r.ok && r.facts?.region ? `${r.facts.region}, ${t.countries[iso3]}` : t.countries[iso3];
    return this.output(
      r,
      { place },
      (rows) => rows.map(({ cropIds, ...row }) => ({ ...row, crops: cropIds.map((id) => this.cropName(t, id)) })),
      {
        chunkId: r.ok && r.facts?.region ? `table:region:${iso3}:${r.facts.region}` : `table:country:${iso3}`,
        title: tx(lang, `Crops of ${place} by harvested area`, `Cây trồng của ${place} theo diện tích thu hoạch`),
        snippet: (rows) => rows.slice(0, 4).map((x) => `${x.name} ${this.num(x.areaHa)} ha`).join('; '),
      },
      input.limit ?? DEFAULT_ROWS,
    );
  }

  async whereGrown(input: z.infer<typeof SCHEMAS.whereGrown>): Promise<ToolOutput> {
    const t = await this.tables();
    const { lang } = this.ctx;
    const { id, near } = this.crop(t, input.crop);
    if (near) return this.notThatCrop(t, input.crop, near);
    const iso3 = input.country ? this.iso3(t, input.country) : undefined;
    if (iso3 === null) return { result: { ok: false, reason: 'unknown-place', message: FAILURE['unknown-place'][lang] } };
    // The file of the country asked about: where the atlas has the crop there from national statistics, that figure is given.
    const r = whereGrown(t, await this.ctx.tables.crop(id), id, iso3, { top: input.top, isDropped: this.isDropped, country: iso3 ? await this.ctx.tables.country(iso3) : null });
    const crop = this.cropName(t, id);
    return this.output(r, { crop }, (rows) => rows, {
      chunkId: `table:crop-countries:${id}${iso3 ? `:${iso3}` : ''}`,
      title: tx(lang, `Where ${crop} is grown`, `Nơi trồng ${crop}`),
      snippet: (rows) => rows.slice(0, 4).map((x) => (x.areaHa != null ? `${x.country} ${this.num(x.areaHa)} ha${x.source ? tx(lang, ' (national statistics)', ' (thống kê quốc gia)') : ''}` : `${x.country}: ${x.level}`)).join('; '),
    });
  }

  async cropFigures(input: z.infer<typeof SCHEMAS.cropFigures>): Promise<ToolOutput> {
    const t = await this.tables();
    const { lang } = this.ctx;
    const { id, near } = this.crop(t, input.crop);
    if (near) return this.notThatCrop(t, input.crop, near);
    const crop = this.cropName(t, id);
    return this.output(cropFigures(t, this.ctx.store.crops.get(id), id, { isDropped: this.isDropped }), { crop }, (rows) => rows, {
      chunkId: `table:crop-figures:${id}`,
      title: tx(lang, `What ${crop} needs and how widely it is grown`, `Yêu cầu của ${crop} và mức độ được trồng`),
      snippet: (rows) => rows.slice(0, 3).map((x) => x.line[lang]).join(' '),
    });
  }

  async compareCrops(input: z.infer<typeof SCHEMAS.compareCrops>): Promise<ToolOutput> {
    const t = await this.tables();
    const { lang, store, tables } = this.ctx;
    const [first, second] = [this.crop(t, input.cropA), this.crop(t, input.cropB)];
    if (first.near) return this.notThatCrop(t, input.cropA, first.near);
    if (second.near) return this.notThatCrop(t, input.cropB, second.near);
    const [a, b] = [first.id, second.id];
    const iso3 = input.country ? this.iso3(t, input.country) : undefined;
    if (iso3 === null) return { result: { ok: false, reason: 'unknown-place', message: FAILURE['unknown-place'][lang] } };
    const side = async (id: string) => ({ cropId: id, facts: store.crops.get(id), file: await tables.crop(id) });
    const r = compareCrops(t, await side(a), await side(b), iso3, { isDropped: this.isDropped, country: iso3 ? await tables.country(iso3) : null });
    const [nameA, nameB] = [this.cropName(t, a), this.cropName(t, b)];
    return this.output(r, { cropA: nameA, cropB: nameB }, (rows) => rows, {
      chunkId: `table:compare:${a}:${b}`,
      title: tx(lang, `${nameA} and ${nameB} side by side`, `So sánh ${nameA} và ${nameB}`),
      snippet: (rows) => rows.slice(0, 2).map((x) => `${x.a?.[lang] ?? '-'} | ${x.b?.[lang] ?? '-'}`).join(' '),
    });
  }

  /** The crop a field tool is about: the one named, or the one on the field. */
  private fieldCrop(t: AtlasTables, field: ModelInput | null, crop: string | undefined): { id: string | null; near?: string } {
    return crop ? this.crop(t, crop) : { id: field?.cropId ?? null };
  }

  async fieldSuitability(input: z.infer<typeof SCHEMAS.fieldSuitability>): Promise<ToolOutput> {
    const t = await this.tables();
    const { lang } = this.ctx;
    const field = await this.field();
    const { id, near } = this.fieldCrop(t, field, input.crop);
    if (near && input.crop) return this.notThatCrop(t, input.crop, near);
    if (field && !id) return { result: { ok: false, reason: 'no-data', message: tx(lang, 'No crop was named and the field has no crop chosen.', 'Chưa nêu cây nào và thửa ruộng chưa chọn cây.') } };
    const crop = id ? this.cropName(t, id) : '';
    const sources = field?.telemetry.sources ?? {};
    return this.output(
      fieldSuitability(t, field, id ?? ''),
      { crop, ...(field ? { field: field.parcel.name } : {}) },
      // Scores go out of 100, as every screen of the app shows them, so the model has no conversion
      // to make. Each factor names the source of its reading. The score of each analysed year is
      // left out: the count of years the needs were met says the same in two numbers.
      (rows) =>
        rows.map(({ yearScores: _years, cropId: _id, compatibility, bestCompatibility, factors, limiting, ...a }) => ({
          suitabilityOutOf100: outOf100(compatibility),
          bestSuitabilityOutOf100: outOf100(bestCompatibility),
          ...a,
          limiting: limiting?.key ?? null,
          factors: factors.map(({ branch: _b, sourceId, weight: _w, score, ...f }) => ({ ...f, scoreOutOf100: score == null ? null : outOf100(score), ...(sourceId ? { source: sources[sourceId]?.name ?? sourceId } : {}) })),
        })),
      {
        chunkId: `table:field-suitability:${field?.parcel.id ?? ''}:${id ?? ''}`,
        title: tx(lang, `How ${crop} suits the field`, `Mức phù hợp của ${crop} với thửa ruộng`),
        snippet: (rows) => tx(lang, `Suitability ${outOf100(rows[0].compatibility)}/100`, `Mức phù hợp ${outOf100(rows[0].compatibility)}/100`) + (rows[0].limiting ? `; ${rows[0].limiting.label[lang]}` : ''),
      },
    );
  }

  async rotationOptions(): Promise<ToolOutput> {
    const t = await this.tables();
    const { lang } = this.ctx;
    const field = await this.field();
    return this.output(rotationOptions(t, field), field ? { field: field.parcel.name } : {}, (rows) => rows.map(rotationRow), {
      chunkId: `table:rotations:${field?.parcel.id ?? ''}`,
      title: tx(lang, 'Rotations proposed for the field', 'Các phương án luân canh cho thửa ruộng'),
      snippet: (rows) => rows.map((x) => x.name[lang]).join('; '),
    });
  }

  async soilPlan(): Promise<ToolOutput> {
    const t = await this.tables();
    const { lang } = this.ctx;
    const field = await this.field();
    return this.output(soilPlan(t, field), field ? { field: field.parcel.name } : {}, (rows) => rows, {
      chunkId: `table:soil-plan:${field?.parcel.id ?? ''}`,
      title: tx(lang, 'pH plan for the field', 'Kế hoạch pH cho thửa ruộng'),
      snippet: (rows) => rows[0].basis[lang],
    });
  }

  async priceAndMargin(input: z.infer<typeof SCHEMAS.priceAndMargin>): Promise<ToolOutput> {
    const t = await this.tables();
    const { lang } = this.ctx;
    const field = await this.field();
    const { id, near } = this.fieldCrop(t, field, input.crop);
    if (near && input.crop) return this.notThatCrop(t, input.crop, near);
    if (field && !id) return { result: { ok: false, reason: 'no-data', message: tx(lang, 'No crop was named and the field has no crop chosen.', 'Chưa nêu cây nào và thửa ruộng chưa chọn cây.') } };
    const crop = id ? this.cropName(t, id) : '';
    return this.output(
      priceAndMargin(t, field, id ?? ''),
      { crop, ...(field ? { field: field.parcel.name } : {}) },
      // The season repeats the sources of the reference record: once is enough.
      (rows) => rows.map(({ reference, season }) => ({ reference, season: season ? (({ sources: _s, cropId: _c, reference: _r, ...rest }) => rest)(season) : null })),
      {
        chunkId: `table:economics:${id ?? ''}`,
        title: tx(lang, `Reference yield, price and cost of ${crop}`, `Năng suất, giá và chi phí tham chiếu của ${crop}`),
        snippet: (rows) => `${rows[0].reference.refYieldTHa} t/ha; ${rows[0].reference.priceUsdPerT} USD/t; ${rows[0].reference.costUsdPerHa} USD/ha (${rows[0].reference.yieldRegion}, ${rows[0].reference.year})`,
      },
    );
  }
}

/** A score of 0 to 1 as the app shows it: a whole number out of 100 (`score100` in src/ui/urban/parts.tsx). */
const outOf100 = (score: number): number => Math.round(score * 100);

/** One rotation as the model reads it: what the advisory screen shows, without the per-season accounts (`priceAndMargin` has those). */
function rotationRow(r: RotationStrategy): Record<string, unknown> {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    years: r.years,
    seasons: r.seasons.map((s) => ({ crop: s.label, startMonth: s.startMonth, endMonth: s.endMonth, ...(s.year != null ? { year: s.year } : {}), ...(s.share != null ? { share: s.share } : {}), ...(s.detail ?? {}) })),
    metrics: r.metrics,
    score: r.score,
    marginUsdPerHaYr: { expected: r.economics.perHaMarginUsd, ...(r.economics.perHaMarginLowUsd != null ? { low: r.economics.perHaMarginLowUsd } : {}), ...(r.economics.perHaMarginHighUsd != null ? { high: r.economics.perHaMarginHighUsd } : {}) },
    usesReferenceValues: r.economics.seasons.some((s) => s.usesReferenceValues),
    why: r.why,
    benefits: r.benefits,
    gaps: r.gaps,
    risks: r.risks,
  };
}

/** Name, licence and link of the sources of a result, as one citation shows them. */
function citedSource(sources: LookupSource[]): { source: string; url: string; license: string } {
  const year = (s: LookupSource) => (s.year && s.year !== 'n.d.' ? `, ${s.year}` : '');
  return {
    source: sources.map((s) => `${s.name}${year(s)}`).join('; '),
    url: sources.map((s) => s.url ?? '').find((u) => /^https?:\/\//.test(u)) ?? '',
    license: [...new Set(sources.map((s) => s.licence))].join('; '),
  };
}

/** The eight tools for one request. */
export function askTools(ctx: ToolContext): AskTool[] {
  const lookups = new Lookups(ctx);
  const tool = <K extends keyof typeof SCHEMAS>(name: K, run: (input: z.infer<(typeof SCHEMAS)[K]>) => Promise<ToolOutput>): AskTool => ({
    name,
    needsField: FIELD_LOOKUPS.has(name),
    description: DESCRIPTIONS[name],
    inputSchema: jsonSchema(SCHEMAS[name]),
    run: async (input) => {
      const parsed = SCHEMAS[name].safeParse(input ?? {});
      if (!parsed.success) throw new Error(`Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
      return run(parsed.data as z.infer<(typeof SCHEMAS)[K]>);
    },
  });
  return [
    tool('cropsInPlace', (i) => lookups.cropsInPlace(i)),
    tool('whereGrown', (i) => lookups.whereGrown(i)),
    tool('cropFigures', (i) => lookups.cropFigures(i)),
    tool('compareCrops', (i) => lookups.compareCrops(i)),
    tool('fieldSuitability', (i) => lookups.fieldSuitability(i)),
    tool('rotationOptions', () => lookups.rotationOptions()),
    tool('soilPlan', () => lookups.soilPlan()),
    tool('priceAndMargin', (i) => lookups.priceAndMargin(i)),
  ];
}
