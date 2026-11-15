/**
 * The crop table of one country, read from the crop atlas (data/crops/atlas/crop_country.csv) into
 * the shape the model takes as `ModelInput.country`. For scripts and tests: the app gets the same
 * table from the catalogue build (task T6).
 */
import { readFileSync } from 'node:fs';
import type { CountryCrops, CropPrevalence, PrevalenceLevel, PrevalenceMatch } from '@/contracts';
import { parseCsvObjects } from './atlas/csv';

const num = (v: string): number | undefined => (v === '' ? undefined : Number(v));

let rows: Record<string, string>[] | null = null;

export function countryCropsFromAtlas(iso3: string, dir = 'data/crops/atlas'): CountryCrops {
  rows ??= parseCsvObjects(readFileSync(`${dir}/crop_country.csv`, 'utf8'));
  const prevalence: Record<string, CropPrevalence> = {};
  for (const r of rows) {
    if (r.iso3 !== iso3) continue;
    const from = num(r.year_from);
    const to = num(r.year_to);
    prevalence[r.crop_id] = {
      level: r.level as PrevalenceLevel,
      match: r.match as PrevalenceMatch,
      sharePct: num(r.share_of_country_harvested_area_pct),
      rankInCountry: num(r.rank_in_country),
      areaHa: num(r.area_ha),
      productionT: num(r.production_t),
      years: from != null && to != null ? [from, to] : undefined,
      itemReported: r.item_reported === 'yes',
      source: r.source,
    };
  }
  if (Object.keys(prevalence).length === 0) throw new Error(`${iso3} is not a country of the crop atlas`);
  return { iso3, prevalence };
}
