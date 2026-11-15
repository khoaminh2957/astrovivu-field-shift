/**
 * Numbers looked up in tables, with their source, for the assistant: what a place grows, where a
 * crop is grown, what a crop needs, how two crops compare, how a crop suits the locked field, the
 * rotations for the field, the soil plan, and the reference price and margin. Pure: the tables and
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
 *    countries;
 *  - a figure is given with the FAOSTAT item, or the items, it is the figure of, as the atlas
 *    writes them for that row: a crop's figure in a country is the sum of the crop's items the
 *    country reports, and that is not always the crop's first item.
 */
import type { CropPrevalence, I18nText, ModelInput, PhPlan, RotationStrategy, ScoreTimeline, SeasonEconomics, SoilPlan } from '@/contracts';
import { phPlan } from '@/core/advisory/actions';
import { buildRotations } from '@/core/advisory/rotation';
import { economicCountry, estimateSeasonEconomics, REGION_ISO3, type ReferenceEconomics, referenceEconomics } from '@/core/economics';
import { assessCrop, computeScoreTimeline, type CropAssessment } from '@/core/scoring';
import { buildSoilPlan, diagnoseSoil, type SoilMetricDiagnosis } from '@/core/soil';
import type { CountryTableFile } from '@/data/countryTable';
import { factLines, groupDigits } from './facts';
import type { CountriesTable, CropCountriesFile, CropEntry, CropsTable, NationalTable, RegionFile, RowItemsTable, SourcesTable, SpamTable } from './tables';
import { fold } from './text';
import type { CropFacts } from './types';

/** Where a number comes from, with what is needed to check it. */
export interface LookupSource {
  name: string;
  licence: string;
  /** Year, or span of years, the numbers refer to; `n.d.` when the source gives none. */
  year: string;
  /** Day the source was read. */
  accessed?: string;
  url?: string;
  /** What is known of the source's date when it has no year or no day of access. */
  note?: string;
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
  rowItems: RowItemsTable;
}

const tx = (en: string, vi: string): I18nText => ({ en, vi });
const fail = (reason: LookupFailure, ...caveats: I18nText[]): { ok: false; reason: LookupFailure; caveats: I18nText[] } => ({ ok: false, reason, caveats });

function source(t: AtlasTables, id: string, year: string): LookupSource {
  const s = t.sources[id];
  return { name: s.title, licence: s.licence, year, url: s.url, ...(s.accessed ? { accessed: s.accessed } : {}) };
}

/**
 * FAO EcoCrop as a source: the species page when the crop has a record, else the database's page.
 * EcoCrop gives no year of publication for a record, and the day the file of 2,568 species was
 * downloaded was not recorded; the note says what is known instead of a date that was not.
 */
function ecocropSource(t: AtlasTables, cropId?: string): LookupSource {
  const eco = cropId ? t.crops.crops[cropId]?.eco : undefined;
  return {
    name: eco != null ? `FAO EcoCrop database, record ${eco}` : 'FAO EcoCrop database, 2,568 species',
    licence: t.sources.ecocrop.licence,
    year: 'n.d.',
    url: eco != null ? `https://ecocrop.apps.fao.org/ecocrop/srv/en/cropView?id=${eco}` : 'https://gaez.fao.org/pages/ecocrop',
    note: 'EcoCrop gives no year of publication for a record. The file has been in the repository since 2026-11-14 (data/ecocrop); the day it was downloaded was not recorded.',
  };
}

/** The FAOSTAT items of a crop's row in a country, as codes: the crop's own item unless the atlas wrote others for that row. */
function itemsOfRow(t: AtlasTables, cropId: string, iso3: string): string[] {
  const own = t.crops.crops[cropId]?.item;
  return t.rowItems[`${cropId}:${iso3}`] ?? (own ? [own] : []);
}

/** Names of FAOSTAT items, joined with " + " when a figure is their sum. */
function itemNames(t: AtlasTables, codes: string[]): string {
  return codes.map((c) => t.crops.itemNames[c] ?? t.crops.items[c]?.name ?? c).join(' + ');
}

/** The caution that goes with a figure that is the sum of several FAOSTAT items. */
const SUM_OF_ITEMS = tx(
  'A figure given with two items or more is their sum: the atlas adds up the items of a crop that a country reports, and adds tonnes of different products when it does (maize grain and green corn).',
  'Số ghi kèm hai mặt hàng trở lên là tổng của các mặt hàng đó: atlas cộng các mặt hàng của một cây mà nước đó có báo cáo, và cộng cả số tấn của các sản phẩm khác nhau (ngô hạt và ngô tươi).',
);

/** Prevalence levels in words, by the thresholds of docs/CROP_DATA.md, section 7. */
const LEVEL: Record<CropPrevalence['level'], I18nText> = {
  major: tx('major (5 % of the harvested area or more)', 'trồng nhiều (từ 5 % diện tích thu hoạch)'),
  common: tx('common (0.5 % to 5 %)', 'phổ biến (từ 0,5 % đến 5 %)'),
  minor: tx('minor (under 0.5 %)', 'ít (dưới 0,5 %)'),
  present: tx('production reported, no area', 'có báo cáo sản lượng, không có diện tích'),
  absent: tx('none reported', 'không ghi nhận'),
  unknown: tx('not known', 'không rõ'),
};

/** The quality words of the reference economics, as docs/ECONOMICS.md, section 2, defines them. */
const QUALITY: Record<string, I18nText> = {
  official: tx('official (a statistics agency)', 'chính thức (cơ quan thống kê)'),
  budget: tx('budget (a university enterprise budget)', 'dự toán (bảng chi phí của trường đại học)'),
  press: tx('press (an article quoting a farm or a demonstration)', 'báo chí (bài báo dẫn một nông hộ hay mô hình trình diễn)'),
  derived: tx('derived (computed from two published figures)', 'suy ra (tính từ hai số đã công bố)'),
  none: tx('none', 'không có'),
};
const quality = (q: string): I18nText => QUALITY[q] ?? tx(q, q);

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
  /** The FAOSTAT items a row adds up, when it is more than one; `name` then joins them with " + ". */
  items?: string[];
}

/** Words MapSPAM adds to a region's name ("Can Tho city", "City_Damascus", "Almaty (city)", "Brest Oblast"). */
const REGION_WORDS = ['city', 'province', 'state', 'region', 'oblast'];
/** Words a person puts before a Vietnamese province's name ("tỉnh Đắk Lắk", "thành phố Cần Thơ"). */
const VN_PREFIX = /^(tinh|thanh pho|tp) (?=\S)/;

/** A region's name with accents, case and punctuation taken off. */
const regionNorm = (name: string): string => fold(name).replace(/[^a-z0-9]+/g, ' ').trim();

/** What is left of a region's name without MapSPAM's words: the key two spellings of one region share. */
export function regionKey(name: string): string {
  return regionNorm(name)
    .split(' ')
    .filter((w) => !REGION_WORDS.includes(w))
    .join(' ');
}

/**
 * The region a name stands for, among the names MapSPAM gives the regions of one country; or the
 * several it could stand for; or none. Three tries, each only when the one before found nothing:
 *  1. the name exactly as written;
 *  2. the name without accents, case and punctuation, and without "tỉnh", "thành phố" in front;
 *  3. both without MapSPAM's words ("city", "province"...), where every such word the question
 *     carries is on the region's name too: "Cần Thơ" is "Can Tho city", but "Mexico City" is not
 *     the state of Mexico.
 * A try that finds two regions or more ends the search with all of them: none is picked. Nor is a
 * region found for a name that is not two letters longer than a syllable ("Hà").
 */
export function findRegion(names: string[], asked: string): { name: string } | { ambiguous: string[] } | null {
  const pick = (found: string[]) => (found.length === 1 ? { name: found[0] } : found.length > 1 ? { ambiguous: found } : null);
  const exact = pick(names.filter((n) => n === asked.trim()));
  if (exact) return exact;
  const q = regionNorm(asked).replace(VN_PREFIX, '');
  if (q.length < 3) return null;
  const same = pick(names.filter((n) => regionNorm(n) === q));
  if (same) return same;
  const key = regionKey(q);
  const qWords = q.split(' ').filter((w) => REGION_WORDS.includes(w));
  if (key.length < 3) return null;
  return pick(
    names.filter((n) => {
      const nn = regionNorm(n);
      return regionKey(nn) === key && qWords.every((w) => nn.split(' ').includes(w));
    }),
  );
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
    const found = regions ? findRegion(Object.keys(regions.regions), admin1) : null;
    if (found && 'ambiguous' in found)
      return fail(
        'no-data',
        tx(`MapSPAM has more than one region that "${admin1}" could be (${t.countries[iso3]}): ${found.ambiguous.join('; ')}. Ask again with one of these names.`, `MapSPAM có hơn một vùng có thể ứng với "${admin1}" (${t.countries[iso3]}): ${found.ambiguous.join('; ')}. Hãy hỏi lại bằng một trong các tên này.`),
      );
    const name = found?.name;
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
  // One row per set of FAOSTAT items, as the atlas writes them for this country: the three rice
  // crops share one item and one set of numbers; Musa sapientum's row in Viet Nam is the item
  // "Bananas", not its own item; maize in the United States is maize grain and green corn added
  // up. A crop whose figure is from national statistics is a row of its own, under the crop's name.
  const byItem = new Map<string, { ids: string[]; p: CropPrevalence; codes: string[] }>();
  let withoutFigure = 0;
  for (const [id, p] of Object.entries(file.prevalence)) {
    if (p.match === 'national') {
      if (hasFigure(p)) byItem.set(`national:${id}`, { ids: [id], p, codes: [] });
      else withoutFigure++;
      continue;
    }
    const codes = itemsOfRow(t, id, iso3);
    const key = codes.length ? codes.join(';') : `crop:${id}`;
    const row = byItem.get(key);
    if (row) row.ids.push(id);
    else byItem.set(key, { ids: [id], p, codes });
  }
  const cropName = (id: string) => t.crops.crops[id]?.en ?? t.crops.crops[id]?.sci ?? id;
  const summed = [...byItem.values()].some((x) => x.codes.length > 1);
  const rows = [...byItem.entries()]
    .map(([key, { ids, p, codes }]): PlaceCropRow => ({
      cropIds: ids.sort(),
      name: p.match === 'national' ? cropName(ids[0]) : codes.length ? itemNames(t, codes) : key,
      ...(codes.length > 1 ? { items: codes.map((c) => itemNames(t, [c])) } : {}),
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
      ...(summed ? [SUM_OF_ITEMS] : []),
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
  /** The FAOSTAT items the figure is of, by name: one, or several added up. Absent on a row of national statistics. */
  items?: string[];
}

interface WhereOptions {
  top?: number;
  isDropped?: (id: string) => boolean;
}

/**
 * The countries with the largest harvested area of a crop and, with `iso3`, that country's own
 * figures. `file` is the crop's file: null for a crop without an item of its own. With `iso3`,
 * `opts.country` is the file of that country (null when the atlas has none) and has to be given:
 * where the atlas has the crop there from national statistics, that figure is given, also for a
 * crop FAOSTAT has no figure of. Without it, a country FAOSTAT has no row of is `unknown`, not
 * `absent`: what its own statistics say was not read.
 */
export function whereGrown(t: AtlasTables, file: CropCountriesFile | null, cropId: string, iso3?: undefined, opts?: WhereOptions): LookupResult<CropCountryRow>;
export function whereGrown(t: AtlasTables, file: CropCountriesFile | null, cropId: string, iso3: string, opts: WhereOptions & { country: CountryTableFile | null }): LookupResult<CropCountryRow>;
export function whereGrown(t: AtlasTables, file: CropCountriesFile | null, cropId: string, iso3?: string, opts: WhereOptions & { country?: CountryTableFile | null } = {}): LookupResult<CropCountryRow> {
  return lookWhere(t, file, cropId, iso3, opts);
}

/** `whereGrown` without the rule on its types, for a caller that may not have the country's file. */
function lookWhere(
  t: AtlasTables,
  file: CropCountriesFile | null,
  cropId: string,
  iso3: string | undefined,
  opts: WhereOptions & { country?: CountryTableFile | null },
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
  const ownItem = file.item;
  const row = (r: CropCountriesFile['rows'][number]): CropCountryRow => ({
    iso3: r.iso3,
    country: t.countries[r.iso3] ?? r.iso3,
    areaHa: r.areaHa,
    productionT: r.productionT,
    level: r.level,
    rank: rankOf(r.iso3),
    years: r.years,
    items: (r.items ?? [ownItem]).map((c) => itemNames(t, [c])),
  });
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
    } else if (reported) {
      asked = row(reported);
    } else if (opts.country === undefined) {
      // The country's own table was not given: its national statistics may hold the crop.
      asked = { iso3, country: t.countries[iso3], areaHa: null, productionT: null, level: 'unknown', rank: null };
      caveats.push(tx(`FAOSTAT has no figure of it for ${t.countries[iso3]}; the country's own statistics were not looked at.`, `FAOSTAT không có số của cây này cho ${t.countries[iso3]}; thống kê riêng của nước này chưa được xem.`));
    } else {
      asked = { iso3, country: t.countries[iso3], areaHa: null, productionT: null, level: 'absent', rank: null };
      caveats.push(NOT_ITEMISED);
    }
    if (!rows.some((r) => r.iso3 === iso3)) rows.push(asked);
  }
  // Each row names its items. Where a crop has items of its own besides the first, say what that does to the figures.
  const ownItems = [ownItem, ...(crop.otherItems ?? [])];
  if (ownItems.length > 1)
    caveats.push(
      tx(
        `The figures of this crop are of the FAOSTAT items ${itemNames(t, ownItems).replace(/ \+ /g, ', ')}: for each country, the sum of those it reports, as each row says.`,
        `Số liệu của cây này là của các mặt hàng FAOSTAT ${itemNames(t, ownItems).replace(/ \+ /g, ', ')}: với mỗi nước, là tổng các mặt hàng nước đó có báo cáo, như từng dòng ghi.`,
      ),
    );
  if (rows.some((r) => (r.items?.length ?? 0) > 1)) caveats.push(SUM_OF_ITEMS);
  if (item && sharing > 1)
    caveats.push(tx(`The item ${item.name} is tied to ${sharing} crops of the atlas: its figures are not for one crop alone.`, `Mặt hàng ${item.name} được atlas gắn với ${sharing} cây: số liệu của nó không phải số riêng của một cây.`));
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
  if (facts.ecocropId != null) sources.push(ecocropSource(t, cropId));
  if (w?.match === 'exact' && w.countries != null && w.worldAreaHa != null) {
    const entry = t.crops.crops[cropId];
    const codes = [entry.item, ...(entry.otherItems ?? [])].filter((c): c is string => !!c);
    const of = itemNames(t, codes).replace(/ \+ /g, ', ');
    rows.push({ key: 'countries', line: tx(`Countries reporting production: ${w.countries}.`, `Số nước báo cáo sản xuất: ${w.countries}.`) });
    rows.push({
      key: 'worldAreaHa',
      line:
        codes.length > 1
          ? tx(`Harvested area in the world: ${groupDigits(w.worldAreaHa, 'en')} ha, the sum over the countries of the FAOSTAT items ${of} each reports.`, `Diện tích thu hoạch toàn thế giới: ${groupDigits(w.worldAreaHa, 'vi')} ha, tổng theo các nước của các mặt hàng FAOSTAT ${of} mà mỗi nước có báo cáo.`)
          : tx(`Harvested area in the world: ${groupDigits(w.worldAreaHa, 'en')} ha, of the FAOSTAT item ${of}.`, `Diện tích thu hoạch toàn thế giới: ${groupDigits(w.worldAreaHa, 'vi')} ha, của mặt hàng FAOSTAT ${of}.`),
    });
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
  /** With `iso3`, the country's file (null when the atlas has none), as `whereGrown` takes it. */
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
      const w = lookWhere(t, x.file, x.cropId, iso3, opts);
      if (!w.ok) return w.reason === 'group-item' ? tx('counted inside a group item: no figure of its own', 'tính trong mặt hàng gộp: không có số riêng') : null;
      const own = w.rows.find((r) => r.iso3 === iso3)!;
      for (const s of w.sources) if (!sources.some((x) => x.name === s.name && x.year === s.year)) sources.push(s);
      for (const c of w.caveats) if (!caveats.some((x) => x.en === c.en)) caveats.push(c);
      if (own.level === 'absent' || own.level === 'unknown') return own.source ? tx('the national statistics read have no figure', 'thống kê quốc gia đã đọc không có số riêng') : LEVEL[own.level];
      const line = (lang: 'en' | 'vi') => {
        const area = own.areaHa != null ? `, ${groupDigits(own.areaHa, lang)} ha` : '';
        const from = own.source ? (lang === 'vi' ? ' (thống kê quốc gia)' : ' (national statistics)') : own.items?.length ? (lang === 'vi' ? ` (mặt hàng ${own.items.join(' + ')})` : ` (item ${own.items.join(' + ')})`) : '';
        return `${LEVEL[own.level][lang]}${area}${from}`;
      };
      return tx(line('en'), line('vi'));
    };
    rows.push({ key: `in:${iso3}`, a: level(a), b: level(b) });
  }
  return { ok: true, rows, sources, caveats };
}

// ------------------------------------------------------------------------------------------------
// 5 to 8. The locked field: suitability, rotations, the soil plan, price and margin
// ------------------------------------------------------------------------------------------------

/** The model's own results: where they come from, for the year of the day they were computed for. */
function modelSource(t: AtlasTables, input: ModelInput, what: string, cropId?: string): LookupSource[] {
  return [
    { name: `Astrovivu ${what}, computed from the readings of the field on ${input.today}`, licence: 'MIT (project code); the readings keep the licences of their sources', year: input.today.slice(0, 4) },
    ecocropSource(t, cropId),
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
    sources: modelSource(t, input, 'suitability score (docs/SCORING.md)', cropId),
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

export interface SoilPlanRow {
  /** The pH plan: amendment and indicative rate, or none needed; null without a pH reading. */
  ph: PhPlan | null;
  /** Each soil factor of the field against what the crop needs (`diagnoseSoil`). */
  diagnosis: SoilMetricDiagnosis[];
  /** The steps that follow: measure first, correct pH, leach salts, drain (`buildSoilPlan`). */
  plan: SoilPlan;
}

/**
 * What to do about the soil of the locked field: the diagnosis and the plan of the soil module
 * (src/core/soil, docs/SOIL.md), with the pH plan they carry. Built the way the advisory report
 * builds `soilPlan`, so the two give the same steps and the same lime figure.
 */
export function soilPlan(t: AtlasTables, input: ModelInput | null | undefined): LookupResult<SoilPlanRow> {
  if (!input) return fail('no-field', NO_FIELD);
  if (!input.cropId) return fail('no-data', tx('No crop is chosen on the field: the soil plan sets each reading against what a crop needs.', 'Thửa ruộng chưa chọn cây: kế hoạch đất so từng chỉ tiêu với yêu cầu của một cây.'));
  const ph = phPlan(input);
  const diagnosis = diagnoseSoil(input);
  const plan = buildSoilPlan(diagnosis, input, ph ?? undefined);
  return {
    ok: true,
    rows: [{ ph: ph ?? null, diagnosis: diagnosis.metrics, plan }],
    sources: modelSource(t, input, 'soil diagnosis and plan (docs/SOIL.md)', input.cropId),
    caveats: [
      tx(
        'Rates are indicative ranges that a laboratory soil test and local guidance must confirm. A factor the field has no reading of gets a step to measure it, and no rate; docs/SOIL.md gives the source of every threshold and lists what was left out for lack of one.',
        'Liều lượng là khoảng tham khảo, cần phân tích đất ở phòng thí nghiệm và hướng dẫn địa phương xác nhận. Chỉ tiêu nào thửa ruộng chưa có số đo thì có bước đo trước và không có liều; docs/SOIL.md ghi nguồn của từng ngưỡng và liệt kê những gì đã bỏ vì không có nguồn.',
      ),
    ],
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
  // The country of the record itself, not of a season built on it: a record without a cost builds
  // no season, and would otherwise pass unchecked.
  const recordIso3 = REGION_ISO3[reference.region];
  const fieldIso3 = economicCountry(input.parcel);
  if (recordIso3 !== fieldIso3)
    return fail(
      'no-data',
      fieldIso3
        ? tx(`The only reference record is of another country (${recordIso3}): it is not given in place of one for this field.`, `Bản ghi tham chiếu duy nhất là của nước khác (${recordIso3}): không dùng thay cho số liệu của thửa ruộng này.`)
        : tx(`Reference records were collected for Viet Nam and the United States only; the record found is of ${recordIso3}, not of the country of this field.`, `Bản ghi tham chiếu chỉ được thu thập cho Việt Nam và Hoa Kỳ; bản ghi tìm thấy là của ${recordIso3}, không phải của nước có thửa ruộng này.`),
    );
  const season = estimateSeasonEconomics(input, score ?? computeScoreTimeline(input), cropId);
  return {
    ok: true,
    rows: [{ reference, season }],
    sources: [
      { name: `Astrovivu reference economics, region ${reference.region} (docs/ECONOMICS.md): ${reference.sources.join('; ')}`, licence: 'Each figure keeps the terms of its publisher, named in the source line', year: String(reference.year) },
    ],
    caveats: [
      tx(
        `Source quality: yield ${quality(reference.quality.yield).en}; price ${quality(reference.quality.price).en}; cost ${quality(reference.quality.cost).en}. Reference values, not this grower's figures, and not a forecast.`,
        `Chất lượng nguồn: năng suất ${quality(reference.quality.yield).vi}; giá ${quality(reference.quality.price).vi}; chi phí ${quality(reference.quality.cost).vi}. Đây là giá trị tham chiếu, không phải số của người trồng, và không phải dự báo.`,
      ),
      ...(season ? [] : [tx('The record has no cost, or the model cannot place the crop on this field: no season is built on it, and no margin is given.', 'Bản ghi không có chi phí, hoặc mô hình không xếp được cây này lên thửa ruộng: không dựng được vụ nào và không có số lãi.')]),
    ],
  };
}

export type { CropEntry };
