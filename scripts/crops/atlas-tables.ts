/**
 * Reads `crop_country.csv` and `economics.csv` from the crop atlas (`data/crops/atlas/`) for
 * `scripts/build-crop-catalog.ts` (`npm run crops:build`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CropPrevalence, Iso3, PrevalenceLevel, PrevalenceMatch } from '../../src/contracts';
import { slugify } from '../../src/core/crops/text';
import type { EconRegion, ReferenceEconomics, ReferenceTable, SourceQuality } from '../../src/core/economics/types';
import { parseCsvObjects } from './atlas/csv';
import { REFERENCE_ECONOMICS as LEGACY_REFERENCE_ECONOMICS } from './economics';
import { FIELD_CROPS } from './overlay-field';
import { GARDEN_CROPS } from './overlay-garden';
import { PERENNIAL_AND_COVER_CROPS } from './overlay-perennial';

const DEFAULT_ATLAS_DIR = 'data/crops/atlas';
const GROWN_LEVELS = new Set<string>(['major', 'common', 'minor', 'present']);
const VALID_QUALITIES = new Set<string>(['official', 'budget', 'press', 'derived', 'none']);

export const CURATED_IDS: readonly string[] = [...FIELD_CROPS, ...PERENNIAL_AND_COVER_CROPS, ...GARDEN_CROPS].map((s) =>
  slugify(s.eco ?? s.scientificName!),
);

export interface AtlasPrevalenceRow extends CropPrevalence {
  area_ha: number | null;
  share_of_country_harvested_area_pct: number | null;
  year_from: number | null;
  year_to: number | null;
}

export type AtlasPrevalenceMap = Record<string, Record<Iso3, AtlasPrevalenceRow>>;

const optNum = (v: string | undefined): number | undefined => (v == null || v === '' ? undefined : Number(v));
const nullNum = (v: string | undefined): number | null => (v == null || v === '' ? null : Number(v));

function checkCuratedInCrops(cropsRows: Record<string, string>[], curatedIds: readonly string[]): Set<string> {
  const knownIds = new Set(cropsRows.map((c) => c.crop_id));
  for (const id of curatedIds) {
    if (!knownIds.has(id)) {
      throw new Error(`Curated crop "${id}" is missing from crops.csv`);
    }
  }
  return knownIds;
}

/**
 * Strips the CSV alias properties (`area_ha`, `share_of_country_harvested_area_pct`, `year_from`,
 * `year_to`) to return a compact `CropPrevalence` record for `CropProfile.prevalence` and
 * `public/data/crops/prevalence.json`.
 */
export function toCropPrevalence(row: AtlasPrevalenceRow): CropPrevalence {
  return {
    level: row.level,
    match: row.match,
    ...(row.sharePct != null ? { sharePct: row.sharePct } : {}),
    ...(row.rankInCountry != null ? { rankInCountry: row.rankInCountry } : {}),
    ...(row.areaHa != null ? { areaHa: row.areaHa } : {}),
    ...(row.productionT != null ? { productionT: row.productionT } : {}),
    ...(row.years ? { years: row.years } : {}),
    ...(row.itemReported != null ? { itemReported: row.itemReported } : {}),
    source: row.source,
  };
}

/**
 * Reads `crop_country.csv` (and checks against `crops.csv`), returning prevalence keyed by
 * `crop_id` then `iso3`. Stops the build if a curated crop is absent from `crops.csv`, if a
 * `(crop_id, iso3)` pair is duplicated, or if a grown row (`major`, `common`, `minor`, `present`)
 * lacks `source`, `year_from` or `year_to`.
 */
export function readPrevalence(
  dir = DEFAULT_ATLAS_DIR,
  opts: { cropsCsv?: string; cropCountryCsv?: string; curatedIds?: readonly string[] } = {},
): AtlasPrevalenceMap {
  const cropsText = opts.cropsCsv ?? readFileSync(path.join(dir, 'crops.csv'), 'utf8');
  const ccText = opts.cropCountryCsv ?? readFileSync(path.join(dir, 'crop_country.csv'), 'utf8');
  const cropsRows = parseCsvObjects(cropsText);
  const knownIds = checkCuratedInCrops(cropsRows, opts.curatedIds ?? CURATED_IDS);

  const rows = parseCsvObjects(ccText);
  const out: AtlasPrevalenceMap = {};
  for (const c of cropsRows) {
    out[c.crop_id] = {};
  }
  const seen = new Set<string>();

  for (const r of rows) {
    const cropId = r.crop_id?.trim() ?? '';
    const iso3 = r.iso3?.trim() ?? '';
    if (!knownIds.has(cropId)) {
      throw new Error(`crop_country.csv: crop_id "${cropId}" is not in crops.csv`);
    }
    const key = `${cropId}:${iso3}`;
    if (seen.has(key)) {
      throw new Error(`crop_country.csv: duplicate row for (${cropId}, ${iso3})`);
    }
    seen.add(key);

    const level = r.level as PrevalenceLevel;
    const match = r.match as PrevalenceMatch;
    if (GROWN_LEVELS.has(level)) {
      if (!r.source?.trim()) {
        throw new Error(`crop_country.csv (${cropId}, ${iso3}): level=${level} row is missing source`);
      }
      if (!r.year_from?.trim() || !r.year_to?.trim()) {
        throw new Error(`crop_country.csv (${cropId}, ${iso3}): level=${level} row is missing year_from or year_to`);
      }
    }

    const from = optNum(r.year_from);
    const to = optNum(r.year_to);
    const areaHa = optNum(r.area_ha);
    const sharePct = optNum(r.share_of_country_harvested_area_pct);

    const byCountry = (out[cropId] ??= {});
    byCountry[iso3] = {
      level,
      match,
      ...(sharePct != null ? { sharePct } : {}),
      ...(optNum(r.rank_in_country) != null ? { rankInCountry: optNum(r.rank_in_country) } : {}),
      ...(areaHa != null ? { areaHa } : {}),
      ...(optNum(r.production_t) != null ? { productionT: optNum(r.production_t) } : {}),
      ...(from != null && to != null ? { years: [from, to] } : {}),
      itemReported: r.item_reported === 'yes',
      source: r.source ?? '',
      area_ha: areaHa ?? null,
      share_of_country_harvested_area_pct: sharePct ?? null,
      year_from: from ?? null,
      year_to: to ?? null,
    };
  }

  return out;
}

function toEconRegion(iso3: string, region: string): EconRegion | null {
  if (iso3 === 'VNM' && region === '') return 'VN';
  if (iso3 === 'USA' && region === '') return 'US';
  if (iso3 === 'USA' && (region === 'US-HEARTLAND' || region === 'US-WEST')) return region;
  return null;
}

/**
 * Reads `economics.csv` (and checks against `crops.csv`), returning a `ReferenceTable` for the
 * web catalogue. Stops the build if a curated crop is absent from `crops.csv`, if a
 * `(crop_id, iso3, region)` key is duplicated, or if a row with any figure lacks `source` or `year`.
 */
export function readEconomics(
  dir = DEFAULT_ATLAS_DIR,
  opts: { cropsCsv?: string; economicsCsv?: string; curatedIds?: readonly string[] } = {},
): ReferenceTable {
  const cropsText = opts.cropsCsv ?? readFileSync(path.join(dir, 'crops.csv'), 'utf8');
  const econText = opts.economicsCsv ?? readFileSync(path.join(dir, 'economics.csv'), 'utf8');
  const cropsRows = parseCsvObjects(cropsText);
  const knownIds = checkCuratedInCrops(cropsRows, opts.curatedIds ?? CURATED_IDS);

  const rows = parseCsvObjects(econText);
  const seen = new Set<string>();
  const completeCrops = new Set<string>();

  for (const r of rows) {
    const cropId = r.crop_id?.trim() ?? '';
    const iso3 = r.iso3?.trim() ?? '';
    const region = r.region?.trim() ?? '';
    if (!knownIds.has(cropId)) {
      throw new Error(`economics.csv: crop_id "${cropId}" is not in crops.csv`);
    }
    const key = `${cropId}:${iso3}:${region}`;
    if (seen.has(key)) {
      throw new Error(`economics.csv: duplicate row for (${cropId}, ${iso3}, ${region})`);
    }
    seen.add(key);

    const hasY = r.yield_t_ha !== '' && r.yield_t_ha != null;
    const hasP = r.price_usd_t !== '' && r.price_usd_t != null;
    const hasC = r.cost_usd_ha !== '' && r.cost_usd_ha != null;
    const hasAny = hasY || hasP || hasC;

    if (hasAny) {
      if (!r.source?.trim()) {
        throw new Error(`economics.csv (${cropId}, ${iso3}, ${region}): row with figure is missing source`);
      }
      if (!r.year?.trim() || !/^\d{4}$/.test(r.year.trim())) {
        throw new Error(`economics.csv (${cropId}, ${iso3}, ${region}): row with figure is missing a 4-digit year`);
      }
    }

    for (const [hasVal, qualCol] of [
      [hasY, 'quality_yield'],
      [hasP, 'quality_price'],
      [hasC, 'quality_cost'],
    ] as const) {
      const q = r[qualCol]?.trim() ?? '';
      if (!VALID_QUALITIES.has(q)) {
        throw new Error(`economics.csv (${cropId}, ${iso3}, ${region}): invalid ${qualCol}="${q}"`);
      }
      if (!hasVal && q !== 'none') {
        throw new Error(`economics.csv (${cropId}, ${iso3}, ${region}): empty figure must have ${qualCol}=none`);
      }
      if (hasVal && q === 'none') {
        throw new Error(`economics.csv (${cropId}, ${iso3}, ${region}): non-empty figure cannot have ${qualCol}=none`);
      }
    }

    if (hasY && hasP && hasC) {
      completeCrops.add(cropId);
    }
  }

  const out: ReferenceTable = {};
  // Preserve catalogue crop ordering for deterministic output in curated.generated.ts
  const orderedRows = [...rows].sort((a, b) => {
    const ia = CURATED_IDS.indexOf(a.crop_id);
    const ib = CURATED_IDS.indexOf(b.crop_id);
    if (ia !== ib && ia >= 0 && ib >= 0) return ia - ib;
    return a.crop_id.localeCompare(b.crop_id);
  });

  for (const r of orderedRows) {
    const econRegion = toEconRegion(r.iso3, r.region);
    if (!econRegion) continue;
    const y = nullNum(r.yield_t_ha);
    const p = nullNum(r.price_usd_t);
    const c = nullNum(r.cost_usd_ha);
    if (y == null && p == null && c == null) continue;

    const legacy = LEGACY_REFERENCE_ECONOMICS[r.crop_id]?.[econRegion];
    const isComplete = y != null && p != null && c != null;
    // Until K7 (#27) updates referenceEconomics() to skip costless records when a complete fallback
    // exists, do not let a newly added costless record shadow a crop's complete 3-figure record.
    if (!isComplete && !legacy && completeCrops.has(r.crop_id)) continue;

    const yieldRegion =
      legacy?.yieldRegion ??
      (r.iso3 === 'VNM'
        ? 'Viet Nam, national average'
        : r.region === 'US-HEARTLAND'
          ? 'Iowa'
          : r.region === 'US-WEST'
            ? 'Nevada'
            : 'United States, national average');

    const sources = r.source.split(' | ').map((s) => s.trim());
    const rec: ReferenceEconomics = {
      region: econRegion,
      yieldRegion,
      refYieldTHa: y,
      priceUsdPerT: p,
      costUsdPerHa: c,
      year: Number(r.year),
      quality: {
        yield: r.quality_yield as SourceQuality,
        price: r.quality_price as SourceQuality,
        cost: r.quality_cost as SourceQuality,
      },
      sources,
    };

    const byRegion = (out[r.crop_id] ??= {});
    byRegion[econRegion] = rec;
  }

  return out;
}
