/**
 * The crop atlas (`data/market/atlas.csv`): 489 crops with the EcoCrop requirements the team
 * selected and, per crop, the countries FAOSTAT reports as producers. This module turns the file
 * into typed rows for the database. Every change it makes to a source value is written to the
 * row's `quality_notes`; nothing is corrected silently.
 */
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { slugify } from '@/core/crops';

export const ATLAS_FILE = 'data/market/atlas.csv';

export interface CropRow {
  id: string;
  name: string;
  scientific_name: string;
  plant_attributes: string[];
  soil_depth_opt: string | null;
  soil_depth_abs: string | null;
  temp_opt_min: number | null;
  temp_opt_max: number | null;
  temp_abs_min: number | null;
  temp_abs_max: number | null;
  soil_texture_opt: string[];
  soil_texture_abs: string[];
  rain_opt_min: number | null;
  rain_opt_max: number | null;
  rain_abs_min: number | null;
  rain_abs_max: number | null;
  soil_fertility_opt: string | null;
  soil_fertility_abs: string | null;
  lat_opt_min: number | null;
  lat_opt_max: number | null;
  lat_abs_min: number | null;
  lat_abs_max: number | null;
  altitude_abs_max: number | null;
  soil_salinity_opt: string | null;
  soil_salinity_abs: string | null;
  ph_opt_min: number | null;
  ph_opt_max: number | null;
  ph_abs_min: number | null;
  ph_abs_max: number | null;
  soil_drainage_opt: string[];
  soil_drainage_abs: string[];
  light_opt_min: string | null;
  light_opt_max: string | null;
  light_abs_min: string | null;
  light_abs_max: string | null;
  climate_zones: string[];
  cycle_min_days: number | null;
  cycle_max_days: number | null;
  quality_notes: string[];
}

export interface AtlasCrop {
  row: CropRow;
  /** FAOSTAT area names, as written in the atlas. */
  producingCountries: string[];
}

/**
 * Values that cannot be read as they stand. Keyed by crop id; each entry says what was read
 * instead and on what ground.
 */
const SOURCE_FIXES: Record<string, { column: string; value: string; note: string }> = {
  'vitellaria-paradoxa': {
    column: 'cult_cycle_max',
    value: '240',
    note: 'cycle maximum "2,4" read as 240 days: the atlas row for the same tree under its older name (Butyrospermum paradoxum ssp. parkii) has 180-240',
  },
};

const blank = (v: string | undefined): boolean => v == null || v.trim() === '' || v.trim() === '-';
const num = (v: string | undefined): number | null => {
  if (blank(v)) return null;
  const n = Number(v!.trim());
  return Number.isFinite(n) ? n : null;
};
/** "shallow (20-50 cm)" -> "shallow"; "high (>10 dS/m))" -> "high". */
const klass = (v: string | undefined): string | null => (blank(v) ? null : v!.trim().replace(/\s*\(.*$/, '').replace(/\s+/g, '-'));
/** Lists are comma-separated, and some items carry a comma-free note in brackets. */
const list = (v: string | undefined): string[] => (blank(v) ? [] : v!.split(/,\s*(?=[a-z])/).map((x) => x.trim()).filter(Boolean));
const light = (v: string | undefined): string | null => (blank(v) ? null : v!.trim());

const ordered = (absMin: number | null, optMin: number | null, optMax: number | null, absMax: number | null): boolean =>
  [absMin, optMin, optMax, absMax].filter((x): x is number => x != null).every((x, i, a) => i === 0 || a[i - 1] <= x);

export function cleanAtlasRow(src: Record<string, string>): AtlasCrop {
  const id = slugify(src.scientific_name);
  const notes: string[] = [];
  const r = { ...src };
  const fix = SOURCE_FIXES[id];
  if (fix) {
    r[fix.column] = fix.value;
    notes.push(fix.note);
  }

  let temp = [num(r.eco_temperat_requir_opt_min), num(r.eco_temperat_requir_opt_max), num(r.eco_temperat_requir_abs_min), num(r.eco_temperat_requir_abs_max)];
  let rain = [num(r.eco_rainfall_annual_opt_min), num(r.eco_rainfall_annual_opt_max), num(r.eco_rainfall_annual_abs_min), num(r.eco_rainfall_annual_abs_max)];
  // No crop grows at 100 °C: the two blocks were entered in each other's columns.
  if (temp.every((t) => t != null && t > 100) && rain.every((x) => x != null && x < 100)) {
    [temp, rain] = [rain, temp];
    notes.push('temperature and rainfall columns were swapped in the source and have been exchanged');
  }

  const lat = [num(r.eco_latitude_opt_min), num(r.eco_latitude_opt_max), num(r.eco_latitude_abs_min), num(r.eco_latitude_abs_max)];
  let altitude = num(r.eco_altitude_abs_max);
  // A "latitude" above 90 is an altitude typed into the wrong column (the same rule as scripts/crops/parse.ts).
  const stray = lat.filter((x): x is number => x != null && x > 90);
  if (stray.length) {
    const strayAltitude = Math.max(...stray);
    for (let i = 0; i < lat.length; i++) if (lat[i] != null && lat[i]! > 90) lat[i] = null;
    if (altitude != null && altitude <= 90) {
      // The altitude column then holds the latitude limit.
      lat[3] = altitude;
      altitude = strayAltitude;
      notes.push('latitude and altitude columns were swapped in the source and have been exchanged');
    } else {
      notes.push('a latitude above 90 in the source (an altitude in the wrong column) was dropped');
    }
  }

  let cycleMin = num(r.cult_cycle_min);
  let cycleMax = num(r.cult_cycle_max);
  if (cycleMin === 0 || cycleMax === 0) {
    // EcoCrop writes 0 where it has no cycle length.
    if (cycleMin === 0) cycleMin = null;
    if (cycleMax === 0) cycleMax = null;
    notes.push('growing cycle not given in the source (0)');
  }

  const ph = [num(r.eco_soil_ph_opt_min), num(r.eco_soil_ph_opt_max), num(r.eco_soil_ph_abs_min), num(r.eco_soil_ph_abs_max)];
  // Kept as published; the note tells a reader not to trust the bounds blindly.
  if (!ordered(temp[2], temp[0], temp[1], temp[3])) notes.push('temperature: the optimal range lies partly outside the absolute range in the source');
  if (!ordered(rain[2], rain[0], rain[1], rain[3])) notes.push('rainfall: the optimal range lies partly outside the absolute range in the source');
  if (!ordered(ph[2], ph[0], ph[1], ph[3])) notes.push('pH: the optimal range lies partly outside the absolute range in the source');

  const zones = list(r.clim_climate_zone).map((z) => /\(([A-Za-z]+)\)/.exec(z)?.[1] ?? z);
  const row: CropRow = {
    id,
    name: r.name.trim(),
    scientific_name: r.scientific_name.trim(),
    plant_attributes: list(r.desc_plant_attributes),
    soil_depth_opt: klass(r.eco_soil_depth_opt),
    soil_depth_abs: klass(r.eco_soil_depth_abs),
    temp_opt_min: temp[0],
    temp_opt_max: temp[1],
    temp_abs_min: temp[2],
    temp_abs_max: temp[3],
    soil_texture_opt: list(r.eco_soil_texture_opt),
    soil_texture_abs: list(r.eco_soil_texture_abs),
    rain_opt_min: rain[0],
    rain_opt_max: rain[1],
    rain_abs_min: rain[2],
    rain_abs_max: rain[3],
    soil_fertility_opt: klass(r.eco_soil_fertility_opt),
    soil_fertility_abs: klass(r.eco_soil_fertility_abs),
    lat_opt_min: lat[0],
    lat_opt_max: lat[1],
    lat_abs_min: lat[2],
    lat_abs_max: lat[3],
    altitude_abs_max: altitude,
    soil_salinity_opt: klass(r.eco_soil_salinity_opt),
    soil_salinity_abs: klass(r.eco_soil_salinity_abs),
    ph_opt_min: ph[0],
    ph_opt_max: ph[1],
    ph_abs_min: ph[2],
    ph_abs_max: ph[3],
    soil_drainage_opt: list(r.eco_soil_drainage_opt).map((d) => d.replace(/\s*\(.*$/, '')),
    soil_drainage_abs: list(r.eco_soil_drainage_abs).map((d) => d.replace(/\s*\(.*$/, '')),
    light_opt_min: light(r.eco_light_intensity_opt_min),
    light_opt_max: light(r.eco_light_intensity_opt_max),
    light_abs_min: light(r.eco_light_intensity_abs_min),
    light_abs_max: light(r.eco_light_intensity_abs_max),
    climate_zones: zones,
    cycle_min_days: cycleMin,
    cycle_max_days: cycleMax,
    quality_notes: notes,
  };
  const producingCountries = (r.faostat_cac_nuoc_san_xuat ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
  return { row, producingCountries };
}

export function readAtlas(file = ATLAS_FILE): AtlasCrop[] {
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors[0].message} (row ${parsed.errors[0].row})`);
  const crops = parsed.data.map(cleanAtlasRow);
  const ids = new Set<string>();
  for (const c of crops) {
    if (ids.has(c.row.id)) throw new Error(`${file}: two crops share the id ${c.row.id}`);
    ids.add(c.row.id);
  }
  return crops;
}
