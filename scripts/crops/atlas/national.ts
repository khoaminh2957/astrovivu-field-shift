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
 * Resolves a single `(crop, country)` entry for `crop_country.csv`.
 * - Rule 3: For `group` and `none` crops (and `absent` `exact` rows), a national row with a figure
 *   writes `match = 'national'`, empty `faostat_item_code`, `year_from = year_to = year`,
 *   `share = (area_ha / totalAreaHa) * 100`, and `level = levelFor(...)`; without a figure it
 *   stays `unknown` (never inferred from a group item).
 * - Rule 4: A national row only replaces `unknown` or `absent`; it never overrides an `exact` row
 *   that already has an area.
 */
export function resolveCropCountryRow(input: CropCountryInput): ResolvedCropCountry | null {
  const { cropId, match, items, primary, iso3, countryName, totalAreaHa, itemAreas, faostat, groupItemReported, national } = input;
  const list = (xs: readonly (string | number)[]) => xs.join(';');

  // Rule 4: Never override an `exact` row that already has an area in FAOSTAT.
  if (match === 'exact' && faostat && faostat.areaHa != null && faostat.areaHa > 0) {
    const share = totalAreaHa > 0 ? (faostat.areaHa / totalAreaHa) * 100 : null;
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
        Math.round(faostat.areaHa),
        faostat.productionT != null ? Math.round(faostat.productionT) : null,
        faostat.yieldTHa != null ? round(faostat.yieldTHa, 3) : null,
        faostat.yearFrom,
        faostat.yearTo,
        share != null ? round(share, 3) : null,
        rankOf(faostat.areaHa, others),
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

  // No national row: fall back to FAOSTAT logic.
  if (match === 'exact') {
    if (!faostat) {
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
    const level = levelFor(faostat.areaHa, null, faostat.productionT);
    return {
      row: [
        cropId,
        iso3,
        countryName,
        list(faostat.codes),
        'exact',
        'yes',
        null,
        faostat.productionT != null ? Math.round(faostat.productionT) : null,
        faostat.yieldTHa != null ? round(faostat.yieldTHa, 3) : null,
        faostat.yearFrom,
        faostat.yearTo,
        null,
        null,
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
