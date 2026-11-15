/**
 * National prevalence overrides and supplements (data/crops/national/prevalence.csv).
 * Used for curated `group` and `none` crops, and for false-`absent` rows forwarded from the
 * national statistical review (T1 #8), in countries where official national crop statistics
 * were checked (starting with VNM and USA).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvObjects, round, type Cell } from './csv';
import { levelFor, rankOf } from './levels';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_NATIONAL_FILE = path.join(ROOT, 'data/crops/national/prevalence.csv');
const FAOSTAT_SOURCE = 'FAOSTAT QCL';

export interface NationalRow {
  cropId: string;
  iso3: string;
  areaHa: number | null;
  productionT: number | null;
  year: number | null;
  source: string;
  url: string;
  accessed: string;
  table: string;
  note: string;
}

export interface FaostatCropStat {
  codes: readonly number[];
  areaHa: number | null;
  productionT: number | null;
  yieldTHa: number | null;
  yearFrom: number;
  yearTo: number;
}

export interface CropCountryInput {
  cropId: string;
  match: 'exact' | 'group' | 'none';
  items: readonly number[];
  primary: number | null;
  iso3: string;
  countryName: string;
  totalAreaHa: number;
  itemAreas: ReadonlyMap<number, number>;
  faostat: FaostatCropStat | null;
  groupItemReported: boolean;
  national?: NationalRow;
}

export interface ResolvedCropCountry {
  row: Cell[];
  level: string;
  match: string;
  areaHa: number | null;
  productionT: number | null;
  inCountryCrops: boolean;
  inPossibleCrops: boolean;
  /** The national row of this crop and country was not used, because FAOSTAT reports the crop there. The build lists these. */
  nationalIgnored?: boolean;
}

function defaultCrops(): Set<string> {
  const file = path.join(ROOT, 'data/crops/atlas/crops.csv');
  const rows = parseCsvObjects(fs.readFileSync(file, 'utf8'));
  return new Set(rows.map((r) => r.crop_id));
}

function defaultCountries(): Set<string> {
  const file = path.join(ROOT, 'data/crops/atlas/country_crops.csv');
  const rows = parseCsvObjects(fs.readFileSync(file, 'utf8'));
  return new Set(rows.map((r) => r.iso3));
}

function parseOptionalNonNegative(raw: string | undefined, field: string, key: string): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`national prevalence (${key}): invalid ${field} "${trimmed}"`);
  }
  return n;
}

export function parseNational(
  text: string,
  crops: ReadonlySet<string> = defaultCrops(),
  countries: ReadonlySet<string> = defaultCountries(),
): Map<string, NationalRow> {
  const rows = parseCsvObjects(text);
  const out = new Map<string, NationalRow>();
  for (const r of rows) {
    const cropId = (r.crop_id ?? '').trim();
    const iso3 = (r.iso3 ?? '').trim();
    const key = `${cropId}|${iso3}`;
    if (!cropId || !crops.has(cropId)) {
      throw new Error(`national prevalence (${key}): crop_id "${cropId}" is not in the atlas`);
    }
    if (!iso3 || !countries.has(iso3)) {
      throw new Error(`national prevalence (${key}): iso3 "${iso3}" is not in the country list`);
    }
    if (out.has(key)) {
      throw new Error(`national prevalence (${key}): duplicate row for ${cropId} in ${iso3}`);
    }
    const areaHa = parseOptionalNonNegative(r.area_ha, 'area_ha', key);
    const productionT = parseOptionalNonNegative(r.production_t, 'production_t', key);
    const yearStr = (r.year ?? '').trim();
    let year: number | null = null;
    if (yearStr) {
      if (!/^\d{4}$/.test(yearStr)) {
        throw new Error(`national prevalence (${key}): invalid year "${yearStr}"`);
      }
      year = Number(yearStr);
    }
    const source = (r.source ?? '').trim();
    const url = (r.url ?? '').trim();
    const accessed = (r.accessed ?? '').trim();
    const table = (r.table ?? '').trim();
    const note = (r.note ?? '').trim();
    const hasFigure = areaHa != null || productionT != null;
    if (hasFigure) {
      if (!source) throw new Error(`national prevalence (${key}): row with figure is missing source`);
      if (!url) throw new Error(`national prevalence (${key}): row with figure is missing url`);
      if (!accessed) throw new Error(`national prevalence (${key}): row with figure is missing accessed`);
      if (year == null) throw new Error(`national prevalence (${key}): row with figure is missing year`);
    } else if (!note) {
      throw new Error(`national prevalence (${key}): row without figure is missing note`);
    }
    out.set(key, { cropId, iso3, areaHa, productionT, year, source, url, accessed, table, note });
  }
  return out;
}

export function readNational(
  file: string = DEFAULT_NATIONAL_FILE,
  crops?: ReadonlySet<string>,
  countries?: ReadonlySet<string>,
): Map<string, NationalRow> {
  return parseNational(fs.readFileSync(file, 'utf8'), crops, countries);
}

/**
 * One publication a national row cites, for `sources.csv`. Keyed by the URL the row gives, because
 * one publisher's census is several documents. The licence is the wording of docs/CROP_DATA.md
 * section 7.1; a URL that is not listed here stops the build rather than getting a guessed licence.
 */
export interface NationalSource {
  id: string;
  url: string;
  title: string;
  publisher: string;
  licence: string;
}

const VN_EXTENSION = 'Official agricultural extension publications (.gov.vn / Khuyến nông); public citation with attribution';
const US_PUBLIC_DOMAIN = 'Public domain of the United States federal government (17 U.S.C. § 105)';
const NASS = 'USDA National Agricultural Statistics Service (NASS)';
const CENSUS = 'https://www.nass.usda.gov/sites/default/files/publications/agcensus/2022/Full_Report';
const census = (id: string, chapter: string, file: string, table: string): NationalSource => ({
  id: `national-usa-census2022-${id}`,
  url: `${CENSUS}/${chapter}/${file}`,
  title: `2022 Census of Agriculture, Volume 1, ${table}`,
  publisher: NASS,
  licence: US_PUBLIC_DOMAIN,
});

export const NATIONAL_SOURCES: readonly NationalSource[] = [
  {
    id: 'national-vnm-nso-yearbook-2025',
    url: 'https://www.nso.gov.vn/wp-content/uploads/2026/07/NG-TOAN-QUOC-2025-1.pdf',
    title: 'Niên giám Thống kê Việt Nam năm 2025 (Statistical Yearbook of Viet Nam 2025)',
    publisher: 'Cục Thống kê (NSO, Bộ Tài chính), Nxb Thống kê',
    licence: 'Official government statistical publication of Viet Nam (Law on Statistics No. 89/2015/QH13 and Law No. 01/2021/QH15; open for public citation with source attribution)',
  },
  {
    id: 'national-vnm-fruit-vegetable-report-2025',
    url: 'https://thitruongnongsan.gov.vn/images/2013/DANGNHAP/Bao%20cao%20thuong%20nien%20rau%20qua%202025.pdf',
    title: 'Báo cáo thường niên thị trường Rau quả 2025',
    publisher: 'Bộ Nông nghiệp và Môi trường (Cục Trồng trọt và Bảo vệ thực vật / IPSARD)',
    licence: 'Official ministry/sector report of Viet Nam; public citation with attribution',
  },
  {
    id: 'national-vnm-extension-hcmc-water-spinach',
    url: 'https://khuyennongtphcm.vn/cam-nang-trong-rau-muon-nuoc-toan/',
    title: 'Cẩm nang trồng rau muống nước an toàn (water spinach of Ho Chi Minh City only; no national figure)',
    publisher: 'Trung tâm Khuyến nông TP. Hồ Chí Minh (Sở Nông nghiệp và Môi trường TP.HCM)',
    licence: VN_EXTENSION,
  },
  {
    id: 'national-vnm-extension-nghe-an-basil',
    url: 'https://khuyennongvn.gov.vn/chuong-trinh-nganh-nong-nghiep/tai-co-cau-nganh-nong-nghiep/nghe-an-hieu-qua-mo-hinh-tham-canh-cay-hung-que-gan-voi-che-bien-tinh-dau-va-tieu-thu-san-pham-19592.html',
    title: 'Article on one intensive basil model in Lạc Sơn commune, Đô Lương district, Nghệ An (one plot; no national figure)',
    publisher: 'Trung tâm Khuyến nông Quốc gia (Bộ Nông nghiệp và Môi trường)',
    licence: VN_EXTENSION,
  },
  {
    id: 'national-vnm-ntm-ha-tinh-malabar-spinach',
    url: 'https://nongthonmoi.hatinh.gov.vn/Tin-trong-nuoc/long-an-trong-mong-toi-tot-um-tum-nong-dan-o-day-khong-hai-la-ma-tuot-hat-dem-ban-200-000-dong-kg-110805.html',
    title: 'Article on Malabar spinach grown in Hưng Điền commune, Tân Hưng district, Long An (one commune; no national figure)',
    publisher: 'Văn phòng Điều phối Nông thôn mới tỉnh Hà Tĩnh',
    licence: VN_EXTENSION,
  },
  {
    id: 'national-usa-crop-production-2025',
    url: 'https://release.nass.usda.gov/reports/cropan26.txt',
    title: 'Crop Production 2025 Summary (January 2026, ISSN 1057-7823)',
    publisher: NASS,
    licence: US_PUBLIC_DOMAIN,
  },
  {
    id: 'national-usa-vegetables-2025',
    url: 'https://release.nass.usda.gov/reports/vegean26.txt',
    title: 'Vegetables 2025 Summary (February 2026, ISSN 0884-6413)',
    publisher: NASS,
    licence: US_PUBLIC_DOMAIN,
  },
  census('table36', 'Volume_1,_Chapter_1_US', 'st99_1_036_036.pdf', 'Chapter 1 (U.S. National Level Data), Table 36: Vegetables, Potatoes, and Melons Harvested for Sale'),
  census('table37', 'Volume_1,_Chapter_1_US', 'st99_1_037_037.pdf', 'Chapter 1 (U.S. National Level Data), Table 37: Specified Fruits and Nuts'),
  census('table26', 'Volume_1,_Chapter_2_US_State_Level', 'st99_2_026_026.pdf', 'Chapter 2 (U.S. State-Level Data), Table 26: Field Seeds, Grass Seeds, Forage, Hay, and Silage'),
  census('table27', 'Volume_1,_Chapter_2_US_State_Level', 'st99_2_027_027.pdf', 'Chapter 2 (U.S. State-Level Data), Table 27: Other Crops'),
];

/** A publication of `NATIONAL_SOURCES` with what the national rows took from it. */
export interface NationalSourceUse extends NationalSource {
  /** Latest access date among the rows that cite it. */
  accessed: string;
  rows: number;
  rowsWithFigure: number;
}

/** The publications the national rows cite, in the order of `NATIONAL_SOURCES`. Throws on a URL that is not registered. */
export function nationalSourcesUsed(national: ReadonlyMap<string, NationalRow>, registry: readonly NationalSource[] = NATIONAL_SOURCES): NationalSourceUse[] {
  const byUrl = new Map(registry.map((s): [string, NationalSourceUse] => [s.url, { ...s, accessed: '', rows: 0, rowsWithFigure: 0 }]));
  for (const [key, r] of national) {
    if (!r.url) continue;
    const use = byUrl.get(r.url);
    if (!use) throw new Error(`national prevalence (${key}): url ${r.url} is not in NATIONAL_SOURCES (scripts/crops/atlas/national.ts): add it with its publisher and licence`);
    use.rows++;
    if (r.areaHa != null || r.productionT != null) use.rowsWithFigure++;
    if (r.accessed > use.accessed) use.accessed = r.accessed;
  }
  return [...byUrl.values()].filter((s) => s.rows > 0);
}

/**
 * Resolves a single `(crop, country)` entry for `crop_country.csv`.
 * - Rule 3: For `group` and `none` crops (and `absent` `exact` rows), a national row with a figure
 *   writes `match = 'national'`, empty `faostat_item_code`, `year_from = year_to = year`,
 *   `share = (area_ha / totalAreaHa) * 100`, and `level = levelFor(...)`; without a figure it
 *   stays `unknown` (never inferred from a group item).
 * - Rule 4: A national row only replaces `unknown` or `absent`. An `exact` row for which FAOSTAT
 *   reports the crop in the country (an area, or production alone: `present`) is never touched,
 *   whether the national row has a figure or not: a note saying "no national figure" must not
 *   erase a quantity the country reported. The row comes back with `nationalIgnored`.
 */
export function resolveCropCountryRow(input: CropCountryInput): ResolvedCropCountry | null {
  const { cropId, match, items, primary, iso3, countryName, totalAreaHa, itemAreas, faostat, groupItemReported, national } = input;
  const list = (xs: readonly (string | number)[]) => xs.join(';');

  // Rule 4: FAOSTAT reports this crop in this country. The row is FAOSTAT's, as it was before national rows existed.
  if (match === 'exact' && faostat) {
    const share = faostat.areaHa != null && totalAreaHa > 0 ? (faostat.areaHa / totalAreaHa) * 100 : null;
    const others = [...itemAreas].filter(([code]) => !items.includes(code)).map(([, a]) => a);
    const level = levelFor(faostat.areaHa, share, faostat.productionT);
    return {
      row: [
        cropId,
        iso3,
        countryName,
        list(faostat.codes),
        'exact',
        'yes',
        faostat.areaHa != null ? Math.round(faostat.areaHa) : null,
        faostat.productionT != null ? Math.round(faostat.productionT) : null,
        faostat.yieldTHa != null ? round(faostat.yieldTHa, 3) : null,
        faostat.yearFrom,
        faostat.yearTo,
        share != null ? round(share, 3) : null,
        faostat.areaHa != null ? rankOf(faostat.areaHa, others) : null,
        level,
        FAOSTAT_SOURCE,
        '',
        '',
        '',
      ],
      level,
      match: 'exact',
      areaHa: faostat.areaHa,
      productionT: faostat.productionT,
      inCountryCrops: true,
      inPossibleCrops: false,
      ...(national ? { nationalIgnored: true } : {}),
    };
  }

  // National row with a figure (area or production) replaces `unknown` (`group`/`none`) or `absent`.
  if (national && (national.areaHa != null || national.productionT != null)) {
    const share = national.areaHa != null && totalAreaHa > 0 ? (national.areaHa / totalAreaHa) * 100 : null;
    const level = levelFor(national.areaHa, share, national.productionT);
    const yieldTHa =
      national.areaHa != null && national.areaHa > 0 && national.productionT != null
        ? round(national.productionT / national.areaHa, 3)
        : null;
    const rank = national.areaHa != null ? rankOf(national.areaHa, [...itemAreas.values()]) : null;
    return {
      row: [
        cropId,
        iso3,
        countryName,
        '',
        'national',
        'yes',
        national.areaHa != null ? Math.round(national.areaHa) : null,
        national.productionT != null ? Math.round(national.productionT) : null,
        yieldTHa,
        national.year,
        national.year,
        share != null ? round(share, 3) : null,
        rank,
        level,
        national.source,
        national.url,
        national.accessed,
        national.note,
      ],
      level,
      match: 'national',
      areaHa: national.areaHa,
      productionT: national.productionT,
      inCountryCrops: level !== 'absent',
      inPossibleCrops: false,
    };
  }

  // National row without a figure: keeps `unknown` with the documented reason in `note`.
  if (national) {
    if (match === 'group' && primary != null) {
      return {
        row: [
          cropId,
          iso3,
          countryName,
          String(primary),
          'group',
          groupItemReported ? 'yes' : 'no',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          'unknown',
          FAOSTAT_SOURCE,
          national.url,
          national.accessed,
          national.note,
        ],
        level: 'unknown',
        match: 'group',
        areaHa: null,
        productionT: null,
        inCountryCrops: false,
        inPossibleCrops: groupItemReported,
      };
    }
    return {
      row: [
        cropId,
        iso3,
        countryName,
        '',
        'national',
        'no',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'unknown',
        national.source || FAOSTAT_SOURCE,
        national.url,
        national.accessed,
        national.note,
      ],
      level: 'unknown',
      match: 'national',
      areaHa: null,
      productionT: null,
      inCountryCrops: false,
      inPossibleCrops: false,
    };
  }

  // No national row. An exact crop reaching this point has nothing above zero in FAOSTAT: absent.
  if (match === 'exact') {
    return {
      row: [cropId, iso3, countryName, list(items), 'exact', 'no', null, null, null, null, null, null, null, 'absent', FAOSTAT_SOURCE, '', '', ''],
      level: 'absent',
      match: 'exact',
      areaHa: null,
      productionT: null,
      inCountryCrops: false,
      inPossibleCrops: false,
    };
  }

  if (match === 'group' && primary != null) {
    return {
      row: [cropId, iso3, countryName, String(primary), 'group', groupItemReported ? 'yes' : 'no', null, null, null, null, null, null, null, 'unknown', FAOSTAT_SOURCE, '', '', ''],
      level: 'unknown',
      match: 'group',
      areaHa: null,
      productionT: null,
      inCountryCrops: false,
      inPossibleCrops: groupItemReported,
    };
  }

  return null;
}
