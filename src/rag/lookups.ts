/**
 * Numbers looked up in tables, with their source, for the assistant: what a place grows, where a
 * crop is grown, what a crop needs, how two crops compare, how a crop suits the locked field, the
 * rotations for the field, the pH plan, and the reference price and margin. Pure: the tables and
 * the model input are given, nothing is loaded here (`tables.ts` loads). The extractive answers
 * and the language model's tools call the same functions, so both say the same numbers.
 *
 * Rules every lookup keeps (docs/RAG.md, "Looking numbers up"):
 *  - a FAOSTAT item tied to several crops is one row with all of them, not one row per crop;
 *  - a crop counted inside a group item never gets the numbers of the group;
 *  - "the statistics cannot tell" is never turned into "not grown";
 *  - a figure of another country is not given in place of a missing one;
 *  - a figure of national statistics (the atlas's `match = national` rows, for Viet Nam and the
 *    United States) is given as that, with its publication, and is not ranked among FAOSTAT's
 *    countries.
 */
import type { CropPrevalence, I18nText, ModelInput, PhPlan, RotationStrategy, ScoreTimeline, SeasonEconomics } from '@/contracts';
import { phPlan } from '@/core/advisory/actions';
import { buildRotations } from '@/core/advisory/rotation';
import { estimateSeasonEconomics, type ReferenceEconomics, referenceEconomics } from '@/core/economics';
import { assessCrop, computeScoreTimeline, type CropAssessment } from '@/core/scoring';
import type { CountryTableFile } from '@/data/countryTable';
import { factLines } from './facts';
import type { CountriesTable, CropCountriesFile, CropEntry, CropsTable, NationalTable, RegionFile, SourcesTable, SpamTable } from './tables';
import { fold } from './text';
import type { CropFacts } from './types';

/** Where a number comes from, with what is needed to check it. */
export interface LookupSource {
  name: string;
  licence: string;
  /** Year, or span of years, the numbers refer to. */
  year: string;
  /** Day the source was read. */
  accessed?: string;
  url?: string;
}

/**
 * Why a lookup has no rows: the crop is not in the atlas; it is a species the atlas dropped; the
 * place is not known; the crop is counted inside a group item, which has no number of the crop's
 * own; the tables hold nothing for the question; no field is locked.
 */
export type LookupFailure = 'unknown-crop' | 'dropped-crop' | 'unknown-place' | 'group-item' | 'no-data' | 'no-field';

export type LookupResult<Row> =
  | { ok: true; rows: Row[]; sources: LookupSource[]; /** What the reader has to know to read the rows rightly. */ caveats: I18nText[]; /** Counts and names that belong to the rows as a whole. */ facts?: Record<string, string | number> }
  | { ok: false; reason: LookupFailure; caveats: I18nText[] };

/** The tables every table lookup needs. */
export interface AtlasTables {
  crops: CropsTable;
  countries: CountriesTable;
  sources: SourcesTable;
  spam: SpamTable;
  national: NationalTable;
}

const tx = (en: string, vi: string): I18nText => ({ en, vi });
const fail = (reason: LookupFailure, ...caveats: I18nText[]): { ok: false; reason: LookupFailure; caveats: I18nText[] } => ({ ok: false, reason, caveats });

function source(t: AtlasTables, id: string, year: string): LookupSource {
  const s = t.sources[id];
  return { name: s.title, licence: s.licence, year, url: s.url, ...(s.accessed ? { accessed: s.accessed } : {}) };
}

/** First and last year over a set of spans. */
function span(years: ([number, number] | undefined)[]): string {
  const known = years.filter((y): y is [number, number] => y != null);
  if (!known.length) return 'n.d.';
  const from = Math.min(...known.map((y) => y[0]));
  const to = Math.max(...known.map((y) => y[1]));
  return from === to ? String(from) : `${from}-${to}`;
}

/** The publication behind a row of national statistics, as a source: its name with the table read, its terms, its address. */
function nationalSource(t: AtlasTables, cropId: string, iso3: string, p: CropPrevalence): LookupSource {
  const n = t.national[`${cropId}:${iso3}`];
  return { name: `${p.source}${n?.table ? `, ${n.table}` : ''}`, licence: n?.licence ?? 'not recorded', year: span([p.years]), ...(n?.accessed ? { accessed: n.accessed } : {}), ...(n?.url ? { url: n.url } : {}) };
}

/** A row of national statistics with a figure; one without says only that the publication has none. */
const hasFigure = (p: CropPrevalence): boolean => p.level !== 'unknown' && (p.areaHa != null || p.productionT != null);

const NOT_ITEMISED = tx(
  'A crop the statistics report none of is not thereby a crop that is not grown: a country that does not itemise a crop reads the same way.',
  'Cây mà thống kê không ghi nhận chưa chắc là cây không được trồng: nước nào không thống kê riêng một cây thì cũng hiện ra như vậy.',
);

/** Why a crop id cannot be answered about, or null when it is a crop of the atlas. */
function unknownCrop(t: AtlasTables, cropId: string, isDropped?: (id: string) => boolean): { ok: false; reason: LookupFailure; caveats: I18nText[] } | null {
  if (t.crops.crops[cropId]) return null;
  return isDropped?.(cropId)
    ? fail('dropped-crop', tx('The crop atlas does not keep this species: no FAOSTAT crop item names it, or only a group item does.', 'Atlas cây trồng không giữ loài này: không mặt hàng FAOSTAT nào gọi tên nó, hoặc chỉ một mặt hàng gộp.'))
    : fail('unknown-crop');
}

// ------------------------------------------------------------------------------------------------
// 1. What a place grows
// ------------------------------------------------------------------------------------------------

export interface PlaceCropRow {
  /** Every crop of the atlas the numbers stand for: one for most rows, several for a shared item or a SPAM crop. */
  cropIds: string[];
  /** FAOSTAT item, or SPAM crop for a region. */
  name: string;
  areaHa: number | null;
  productionT?: number | null;
  /** Share of the harvested area of the country or region, in percent. */
  sharePct: number | null;
  rank: number | null;
  /** For a country: major, common, minor or present. */
  level?: CropPrevalence['level'];
  /** For a region: true for a SPAM class of several crops ("Other Vegetables"), which names none of ours. */
  residual?: boolean;
  /** The national publication the row is from; absent for a row of FAOSTAT or of MapSPAM. */
  source?: string;
}

/** MapSPAM writes region names in its own way ("Can Tho city", "Thua Thien - Hue"): compare what is left when that is taken off. */
export function regionKey(name: string): string {
  return fold(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(city|province|state|tinh|thanh pho|tp)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The crops a country grows, largest harvested area first; with `admin1`, the crops of that
 * province or state as MapSPAM estimates them. `country` is the country's file (null when the
 * atlas has none), `regions` its region file (null when MapSPAM has no regions for it).
 */
export function cropsInPlace(t: AtlasTables, place: { country: CountryTableFile | null; regions?: RegionFile | null }, iso3: string, admin1?: string): LookupResult<PlaceCropRow> {
  if (!t.countries[iso3]) return fail('unknown-place');
  if (admin1) {
    const regions = place.regions;
    const key = regionKey(admin1);
    const name = regions ? Object.keys(regions.regions).find((r) => regionKey(r) === key) : undefined;
    if (!regions || !name)
      return fail('no-data', tx(`MapSPAM has no figures for ${admin1} (${t.countries[iso3]}).`, `MapSPAM không có số liệu cho ${admin1} (${t.countries[iso3]}).`));
    const rows = regions.regions[name].map(([code, areaHa, sharePct, rank]): PlaceCropRow => {
      const s = t.spam[code];
      return { cropIds: s?.crops ?? [], name: s?.name ?? code, areaHa, sharePct, rank, residual: s?.residual ?? false };
    });
    return {
      ok: true,
      rows,
      sources: [source(t, regions.source, '2020')],
      caveats: [
        tx(
          'MapSPAM estimate: a model spreads national and sub-national statistics of 2020 over a grid. It is not a census of the province, and it knows 46 crops and classes of crops.',
          'Ước tính MapSPAM: một mô hình phân bổ thống kê quốc gia và cấp vùng của năm 2020 lên lưới ô. Đây không phải số điều tra của tỉnh, và chỉ có 46 cây và nhóm cây.',
        ),
        ...(rows.some((r) => r.residual) ? [tx('A class such as "Other Vegetables" names no single crop: its area cannot be given to any one of them.', 'Một nhóm như "Other Vegetables" không chỉ cây nào cụ thể: không thể gán diện tích của nhóm cho một cây.')] : []),
      ],
      facts: { region: name, country: t.countries[iso3] },
    };
  }
  const file = place.country;
  if (!file) return fail('no-data');
  // One row per FAOSTAT item: the three rice crops share one item and one set of numbers. A crop
  // whose figure is from national statistics is a row of its own, under the crop's name.
  const byItem = new Map<string, { ids: string[]; p: CropPrevalence }>();
  let withoutFigure = 0;
  for (const [id, p] of Object.entries(file.prevalence)) {
    if (p.match === 'national') {
      if (hasFigure(p)) byItem.set(`national:${id}`, { ids: [id], p });
      else withoutFigure++;
      continue;
    }
    const item = t.crops.crops[id]?.item ?? `crop:${id}`;
    const row = byItem.get(item);
    if (row) row.ids.push(id);
    else byItem.set(item, { ids: [id], p });
  }
  const cropName = (id: string) => t.crops.crops[id]?.en ?? t.crops.crops[id]?.sci ?? id;
  const rows = [...byItem.entries()]
    .map(([item, { ids, p }]): PlaceCropRow => ({
      cropIds: ids.sort(),
      name: p.match === 'national' ? cropName(ids[0]) : (t.crops.items[item]?.name ?? item),
      areaHa: p.areaHa ?? null,
      productionT: p.productionT ?? null,
      sharePct: p.sharePct ?? null,
      rank: p.rankInCountry ?? null,
      level: p.level,
      ...(p.match === 'national' ? { source: p.source } : {}),
    }))
    .sort((a, b) => (b.areaHa ?? -1) - (a.areaHa ?? -1) || (b.productionT ?? 0) - (a.productionT ?? 0) || a.name.localeCompare(b.name));
  const grouped = file.group.reported.length;
  const national = [...byItem.values()].filter(({ p }) => p.match === 'national');
  const sources = [source(t, 'faostat-qcl', span(Object.values(file.prevalence).filter((p) => p.match !== 'national').map((p) => p.years)))];
  for (const { ids, p } of national) {
    const s = nationalSource(t, ids[0], iso3, p);
    if (!sources.some((x) => x.name === s.name && x.year === s.year)) sources.push(s);
  }
  return {
    ok: true,
    rows,
    sources,
    caveats: [
      ...(grouped
        ? [tx(`${grouped} more crops are counted inside group items the country reports ("Other vegetables" and the like): they may be grown, and have no figure of their own.`, `Còn ${grouped} cây được tính trong các mặt hàng gộp mà nước này có báo cáo ("Other vegetables" và tương tự): có thể có trồng, nhưng không có số riêng.`)]
        : []),
      ...(national.length
        ? [tx(`${national.length} rows name a source: they are figures of national statistics, of one year, where the others are FAOSTAT's means of three years. The atlas ranks them together.`, `${national.length} dòng có ghi nguồn: đó là số liệu thống kê quốc gia của một năm, còn các dòng khác là trung bình ba năm của FAOSTAT. Atlas xếp hạng chung các dòng này.`)]
        : []),
      ...(withoutFigure ? [tx(`For ${withoutFigure} more crops the national statistics were read and have no figure: that does not say they are not grown.`, `Với ${withoutFigure} cây nữa, thống kê quốc gia đã được đọc và không có số riêng: điều đó không có nghĩa là không trồng.`)] : []),
      NOT_ITEMISED,
    ],
    facts: { country: file.country, items: rows.length, crops: Object.keys(file.prevalence).length - withoutFigure, inGroups: grouped, notReported: file.absent.length, fromNationalStatistics: national.length, nationalWithoutFigure: withoutFigure },
  };
}

// ------------------------------------------------------------------------------------------------
// 2. Where a crop is grown
// ------------------------------------------------------------------------------------------------

export interface CropCountryRow {
  iso3: string;
  country: string;
  areaHa: number | null;
  productionT: number | null;
  /** `absent`: the country's statistics report none of it. */
  level: CropPrevalence['level'];
  /** Place among the countries that report an area to FAOSTAT, 1 = largest; null for a figure of national statistics. */
  rank: number | null;
  years?: [number, number];
  /** The national publication the row is from; absent for a row of FAOSTAT. */
  source?: string;
}

/**
 * The countries with the largest harvested area of a crop and, with `iso3`, that country's own
 * figures. `file` is the crop's file: null for a crop without an item of its own. `opts.country`
 * is the file of the country asked about: where the atlas has the crop there from national
 * statistics, that figure is given, also for a crop FAOSTAT has no figure of.
 */
export function whereGrown(
  t: AtlasTables,
  file: CropCountriesFile | null,
  cropId: string,
  iso3?: string,
  opts: { top?: number; isDropped?: (id: string) => boolean; country?: CountryTableFile | null } = {},
): LookupResult<CropCountryRow> {
  const unknown = unknownCrop(t, cropId, opts.isDropped);
  if (unknown) return unknown;
  const crop = t.crops.crops[cropId];
  const item = crop.item ? t.crops.items[crop.item] : undefined;
  if (iso3 && !t.countries[iso3]) return fail('unknown-place');
  // The crops the item's numbers stand for: those tied to it as their own item.
  const sharing = (item?.crops ?? []).filter((id) => t.crops.crops[id]?.match === 'exact').length;

  // What the country asked about says in its own statistics, when the atlas has read them for this crop.
  const own = iso3 && opts.country?.iso3 === iso3 ? opts.country.prevalence[cropId] : undefined;
  const national = own?.match === 'national' ? own : undefined;
  const nationalRow: CropCountryRow | undefined =
    national && iso3 && hasFigure(national)
      ? { iso3, country: t.countries[iso3], areaHa: national.areaHa ?? null, productionT: national.productionT ?? null, level: national.level, rank: null, ...(national.years ? { years: national.years } : {}), source: national.source }
      : undefined;
  const fromNational = national && iso3 ? tx(`The figure of ${t.countries[iso3]} is from its national statistics (${national.source}), not from FAOSTAT, and is not ranked among FAOSTAT's countries.`, `Số của ${t.countries[iso3]} lấy từ thống kê quốc gia (${national.source}), không phải của FAOSTAT, và không được xếp hạng chung với các nước của FAOSTAT.`) : null;
  const nationalHasNone = national && iso3 ? tx(`The national statistics read for ${t.countries[iso3]} (${national.source}) have no figure for it: that does not say it is not grown.`, `Thống kê quốc gia đã đọc cho ${t.countries[iso3]} (${national.source}) không có số riêng cho cây này: điều đó không có nghĩa là không trồng.`) : null;
  /** The answer for a crop FAOSTAT has no figure of: the national figure when there is one, else why there is none. */
  const withoutFaostat = (reason: LookupFailure, why: I18nText): LookupResult<CropCountryRow> =>
    nationalRow && national && iso3 && fromNational
      ? { ok: true, rows: [nationalRow], sources: [nationalSource(t, cropId, iso3, national)], caveats: [why, fromNational], facts: { item: item?.name ?? '', countriesReporting: 0, countriesWithArea: 0, askedLevel: nationalRow.level } }
      : fail(reason, why, ...(nationalHasNone ? [nationalHasNone] : []));

  if (crop.match === 'group')
    return withoutFaostat(
      'group-item',
      tx(`FAOSTAT counts it inside the item ${item?.name ?? 'of a group'}, with ${(item?.crops.length ?? 1) - 1} other crops of the atlas: FAOSTAT has no figure for it alone, in any country.`, `FAOSTAT tính cây này trong mặt hàng ${item?.name ?? 'gộp'}, cùng ${(item?.crops.length ?? 1) - 1} cây khác của atlas: FAOSTAT không có số riêng cho cây này, ở nước nào cũng vậy.`),
    );
  // What the atlas did, not what FAOSTAT has: FAOSTAT has an item for bananas, and the atlas ties none to Musa acuminata.
  if (crop.match === 'none' || !file)
    return withoutFaostat('no-data', tx('The crop atlas ties no FAOSTAT item to it, so it has no FAOSTAT figures by country for it.', 'Atlas cây trồng chưa gắn mặt hàng FAOSTAT nào với cây này, nên không có số liệu FAOSTAT theo nước cho cây này.'));

  const withArea = file.rows.filter((r) => r.areaHa != null);
  const rankOf = (code: string) => {
    const i = withArea.findIndex((r) => r.iso3 === code);
    return i < 0 ? null : i + 1;
  };
  const row = (r: CropCountriesFile['rows'][number]): CropCountryRow => ({ iso3: r.iso3, country: t.countries[r.iso3] ?? r.iso3, areaHa: r.areaHa, productionT: r.productionT, level: r.level, rank: rankOf(r.iso3), years: r.years });
  const rows = withArea.slice(0, opts.top ?? 5).map(row);
  const sources = [source(t, file.source, span(file.rows.map((r) => r.years)))];
  const caveats: I18nText[] = [];
  let asked: CropCountryRow | undefined;
  if (iso3) {
    const reported = file.rows.find((r) => r.iso3 === iso3);
    if (nationalRow && national && fromNational) {
      asked = nationalRow;
      caveats.push(fromNational);
      sources.push(nationalSource(t, cropId, iso3, national));
    } else if (national && nationalHasNone) {
      asked = { iso3, country: t.countries[iso3], areaHa: null, productionT: null, level: 'unknown', rank: null };
      caveats.push(nationalHasNone);
    } else {
      asked = reported ? row(reported) : { iso3, country: t.countries[iso3], areaHa: null, productionT: null, level: 'absent', rank: null };
      if (!reported) caveats.push(NOT_ITEMISED);
    }
    if (!rows.some((r) => r.iso3 === iso3)) rows.push(asked);
  }
  if (item && sharing > 1)
    caveats.push(tx(`These are the figures of the FAOSTAT item ${item.name}, which the atlas ties to ${sharing} crops; they are not for one crop alone.`, `Đây là số liệu của mặt hàng FAOSTAT ${item.name}, mặt hàng mà atlas gắn với ${sharing} cây; không phải số riêng của một cây.`));
  return {
    ok: true,
    rows,
    sources,
    caveats,
    facts: { item: item?.name ?? '', countriesReporting: file.rows.length, countriesWithArea: withArea.length, ...(asked ? { askedLevel: asked.level } : {}) },
  };
}

// ------------------------------------------------------------------------------------------------
// 3. What a crop needs, and its world figures
// ------------------------------------------------------------------------------------------------

export interface FigureRow {
  /** `temp`, `rain`, `ph`, ... as `factLines` names them; `countries` and `worldAreaHa` for the world figures. */
  key: string;
  line: I18nText;
}

/** The requirements of a crop (FAO EcoCrop) and how widely it is grown (FAOSTAT), as lines in both languages. */
export function cropFigures(t: AtlasTables, facts: CropFacts | undefined, cropId: string, opts: { isDropped?: (id: string) => boolean } = {}): LookupResult<FigureRow> {
  const unknown = unknownCrop(t, cropId, opts.isDropped);
  if (unknown) return unknown;
  if (!facts) return fail('no-data');
  const en = factLines(facts, 'en');
  const vi = new Map(factLines(facts, 'vi').map((l) => [l.key, l.line]));
  const rows: FigureRow[] = en.map((l) => ({ key: l.key, line: tx(l.line, vi.get(l.key) ?? l.line) }));
  const w = facts.prevalence;
  const sources: LookupSource[] = [];
  if (facts.ecocropId != null) sources.push(source(t, 'ecocrop', 'n.d.'));
  if (w?.match === 'exact' && w.countries != null && w.worldAreaHa != null) {
    rows.push({ key: 'countries', line: tx(`Countries reporting production: ${w.countries}.`, `Số nước báo cáo sản xuất: ${w.countries}.`) });
    rows.push({ key: 'worldAreaHa', line: tx(`Harvested area in the world: ${w.worldAreaHa} ha.`, `Diện tích thu hoạch toàn thế giới: ${w.worldAreaHa} ha.`) });
    sources.push(source(t, 'faostat-qcl', w.years ?? 'n.d.'));
  }
  if (!rows.length || !sources.length) return fail('no-data', tx('FAO EcoCrop has no record of this crop, and the crop atlas ties no FAOSTAT item to it.', 'FAO EcoCrop không có bản ghi nào về cây này, và atlas cây trồng chưa gắn mặt hàng FAOSTAT nào với nó.'));
  const caveats: I18nText[] = [];
  if (w?.match === 'group') caveats.push(tx(`FAOSTAT counts it inside the item ${w.faostatItem}: there are no world figures for it alone.`, `FAOSTAT tính cây này trong mặt hàng ${w.faostatItem}: không có số liệu thế giới riêng cho nó.`));
  if (w?.match === 'exact' && (w.sharedBy ?? 1) > 1) caveats.push(tx(`The world figures are those of the FAOSTAT item ${w.faostatItem}, tied to ${w.sharedBy} crops.`, `Số liệu thế giới là của mặt hàng FAOSTAT ${w.faostatItem}, gắn với ${w.sharedBy} cây.`));
  if (facts.ecocropId != null) caveats.push(tx('EcoCrop gives one envelope per species, not per variety, and has no year of publication for a single record.', 'EcoCrop cho một khoảng yêu cầu cho cả loài, không theo giống, và không ghi năm công bố của từng bản ghi.'));
  return { ok: true, rows, sources, caveats };
}

// ------------------------------------------------------------------------------------------------
// 4. Two crops side by side
// ------------------------------------------------------------------------------------------------

export interface CompareRow {
  key: string;
  a: I18nText | null;
  b: I18nText | null;
}

/** The requirements and the world figures of two crops, line against line; with `iso3`, how much of each that country grows. */
export function compareCrops(
  t: AtlasTables,
  a: { cropId: string; facts: CropFacts | undefined; file: CropCountriesFile | null },
  b: { cropId: string; facts: CropFacts | undefined; file: CropCountriesFile | null },
  iso3?: string,
  opts: { isDropped?: (id: string) => boolean; country?: CountryTableFile | null } = {},
): LookupResult<CompareRow> {
  const fa = cropFigures(t, a.facts, a.cropId, opts);
  if (!fa.ok) return fa;
  const fb = cropFigures(t, b.facts, b.cropId, opts);
  if (!fb.ok) return fb;
  const keys = [...new Set([...fa.rows, ...fb.rows].map((r) => r.key))];
  const rows: CompareRow[] = keys.map((key) => ({ key, a: fa.rows.find((r) => r.key === key)?.line ?? null, b: fb.rows.find((r) => r.key === key)?.line ?? null }));
  const sources = [...fa.sources, ...fb.sources].filter((s, i, all) => all.findIndex((x) => x.name === s.name && x.year === s.year) === i);
  const caveats = [...fa.caveats, ...fb.caveats].filter((c, i, all) => all.findIndex((x) => x.en === c.en) === i);
  if (iso3) {
    const level = (x: typeof a): I18nText | null => {
      const w = whereGrown(t, x.file, x.cropId, iso3, opts);
      if (!w.ok) return w.reason === 'group-item' ? tx('counted inside a group item: no figure of its own', 'tính trong mặt hàng gộp: không có số riêng') : null;
      const own = w.rows.find((r) => r.iso3 === iso3)!;
      for (const s of w.sources) if (!sources.some((x) => x.name === s.name && x.year === s.year)) sources.push(s);
      for (const c of w.caveats) if (!caveats.some((x) => x.en === c.en)) caveats.push(c);
      if (own.level === 'absent') return tx('none reported', 'không ghi nhận');
      if (own.level === 'unknown') return tx('the national statistics read have no figure', 'thống kê quốc gia đã đọc không có số riêng');
      const figure = `${own.level}${own.areaHa != null ? `, ${own.areaHa} ha` : ''}`;
      return own.source ? tx(`${figure} (national statistics)`, `${figure} (thống kê quốc gia)`) : tx(figure, figure);
    };
    rows.push({ key: `in:${iso3}`, a: level(a), b: level(b) });
  }
  return { ok: true, rows, sources, caveats };
}

// ------------------------------------------------------------------------------------------------
// 5 to 8. The locked field: suitability, rotations, the pH plan, price and margin
// ------------------------------------------------------------------------------------------------

/** The model's own results: where they come from, for the year of the day they were computed for. */
function modelSource(t: AtlasTables, input: ModelInput, what: string): LookupSource[] {
  return [
    { name: `Astrovivu ${what}, computed from the readings of the field on ${input.today}`, licence: 'MIT (project code); the readings keep the licences of their sources', year: input.today.slice(0, 4) },
    source(t, 'ecocrop', 'n.d.'),
  ];
}

const NO_FIELD = tx('No field is locked: this needs the readings of a field.', 'Chưa khoá thửa ruộng nào: việc này cần số liệu của một thửa ruộng.');

/** How a crop suits the locked field: the model's assessment, as `assessCrop` gives it. */
export function fieldSuitability(t: AtlasTables, input: ModelInput | null | undefined, cropId: string): LookupResult<CropAssessment> {
  if (!input) return fail('no-field', NO_FIELD);
  const a = assessCrop(input, cropId);
  if (!a) return fail('unknown-crop');
  return {
    ok: true,
    rows: [a],
    sources: modelSource(t, input, 'suitability score (docs/SCORING.md)'),
    caveats: [
      tx('A score of climate and soil at the field, not a yield forecast; it says nothing of markets, pests or the grower\'s means.', 'Đây là điểm về khí hậu và đất tại thửa ruộng, không phải dự báo năng suất; điểm không nói gì về thị trường, sâu bệnh hay điều kiện của người trồng.'),
      ...(a.needsLocalReview ? [tx('The crop is not one of the curated ones: its thresholds were not reviewed by hand.', 'Cây này không thuộc nhóm đã biên soạn: các ngưỡng của nó chưa được rà soát thủ công.')] : []),
    ],
  };
}

/** The rotations the app proposes for the locked field, the current practice among them. */
export function rotationOptions(t: AtlasTables, input: ModelInput | null | undefined): LookupResult<RotationStrategy> {
  if (!input) return fail('no-field', NO_FIELD);
  const rows = buildRotations(input);
  if (!rows.length) return fail('no-data');
  return {
    ok: true,
    rows,
    sources: modelSource(t, input, 'rotation planner (docs/ADVISORY.md)'),
    caveats: [tx('Margins are reference values of the region unless the grower entered their own; each rotation lists its own gaps and risks.', 'Lãi là giá trị tham chiếu của vùng trừ khi người trồng tự nhập; mỗi phương án có danh sách điều chưa biết và rủi ro riêng.')],
  };
}

/**
 * What to do about the soil of the locked field. The soil module that will diagnose and plan
 * (issue S2) is not built: until then this is the pH part alone, and it says so.
 */
export function soilPlan(t: AtlasTables, input: ModelInput | null | undefined): LookupResult<PhPlan> {
  if (!input) return fail('no-field', NO_FIELD);
  const plan = phPlan(input);
  if (!plan) return fail('no-data', tx('No pH reading or no crop on the field: no pH plan can be made.', 'Thửa ruộng chưa có số pH hoặc chưa chọn cây: chưa lập được kế hoạch pH.'));
  return {
    ok: true,
    rows: [plan],
    sources: modelSource(t, input, 'pH plan (docs/ADVISORY.md)'),
    caveats: [tx('This is the pH part only: organic matter, nutrients, salinity and compaction are not planned for yet.', 'Đây mới chỉ là phần pH: chất hữu cơ, dinh dưỡng, độ mặn và độ chặt của đất chưa có trong kế hoạch.')],
  };
}

export interface PriceMarginRow {
  reference: ReferenceEconomics;
  /** The season on the locked field with these figures; null when the model cannot place the crop on it. */
  season: SeasonEconomics | null;
}

/**
 * The reference yield, price and cost of a crop for the region of the locked field, and the margin
 * of a season with them. A record of another country is not given in place of a missing one.
 */
export function priceAndMargin(t: AtlasTables, input: ModelInput | null | undefined, cropId: string, score?: ScoreTimeline): LookupResult<PriceMarginRow> {
  if (!input) return fail('no-field', NO_FIELD);
  if (!t.crops.crops[cropId]) return fail('unknown-crop');
  const reference = referenceEconomics(cropId, input.parcel);
  if (!reference) return fail('no-data', tx('No reference price or cost was collected for this crop.', 'Chưa thu thập được giá hay chi phí tham chiếu cho cây này.'));
  const season = estimateSeasonEconomics(input, score ?? computeScoreTimeline(input), cropId);
  if (season?.reference && !season.reference.sameCountry)
    return fail('no-data', tx(`The only reference record is of another country (${season.reference.iso3}): it is not given in place of one for this field.`, `Bản ghi tham chiếu duy nhất là của nước khác (${season.reference.iso3}): không dùng thay cho số liệu của thửa ruộng này.`));
  return {
    ok: true,
    rows: [{ reference, season }],
    sources: [
      { name: `Astrovivu reference economics, region ${reference.region} (docs/ECONOMICS.md): ${reference.sources.join('; ')}`, licence: 'Each figure keeps the terms of its publisher, named in the source line', year: String(reference.year) },
    ],
    caveats: [
      tx(`Source quality: yield ${reference.quality.yield}, price ${reference.quality.price}, cost ${reference.quality.cost}. Reference values, not this grower's figures, and not a forecast.`, `Chất lượng nguồn: năng suất ${reference.quality.yield}, giá ${reference.quality.price}, chi phí ${reference.quality.cost}. Đây là giá trị tham chiếu, không phải số của người trồng, và không phải dự báo.`),
    ],
  };
}

export type { CropEntry };
