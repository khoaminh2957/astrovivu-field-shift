/**
 * EcoCrop rows for the atlas. The cleaning mirrors scripts/crops/parse.ts where it removes a
 * defect ("-", "---" and "no input" mean no data; a latitude above 90 is an altitude typed into
 * the wrong field; a cycle of 0 means missing; a thousands separator is not a day count), but it
 * never repairs or imputes: an implausible value becomes an empty cell and the row says which.
 * The scoring catalogue may rescale or widen a window; a reference table must not.
 */
import { parseScientificName, synonymTaxa, type Taxon } from './taxa';

export type Raw = Record<string, string>;

const MISSING = new Set(['', '-', '--', '---', 'no input', 'na', 'n/a']);

export function text(v: string | undefined): string {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  return MISSING.has(s.toLowerCase()) ? '' : s;
}

/** A number inside [lo, hi], else null; `dropped` receives the raw value that was refused. */
export function numberIn(v: string | undefined, lo: number, hi: number, dropped?: (raw: string) => void): number | null {
  const s = text(v);
  if (!s) return null;
  // "1,500" is ambiguous (thousands separator or decimal comma): refused rather than guessed.
  const n = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  if (!Number.isFinite(n) || n < lo || n > hi) {
    dropped?.(s);
    return null;
  }
  return n;
}

export const RANGES = {
  temperatureC: [-60, 60],
  rainfallMm: [0, 12000],
  ph: [0, 14],
  latitudeDeg: [0, 90],
  altitudeM: [-500, 9000],
  killingTempC: [-90, 60],
  cycleDays: [1, 366],
} as const;

type Quad = [opt_min: number | null, opt_max: number | null, abs_min: number | null, abs_max: number | null];

export interface AtlasSpecies {
  ecocropId: number;
  scientificName: string;
  authority: string;
  family: string;
  synonyms: string;
  commonNames: string;
  commonNameList: string[];
  lifeForm: string;
  physiology: string;
  habit: string;
  category: string;
  lifeSpan: string;
  plantAttributes: string;
  usesMain: string;
  temp: Quad;
  rain: Quad;
  ph: Quad;
  latitude: Quad;
  altitude: Quad;
  /** Text classes exactly as EcoCrop prints them: depth, texture, fertility, salinity, drainage, Al toxicity (opt, abs). */
  soil: Record<'depth' | 'texture' | 'fertility' | 'salinity' | 'drainage' | 'alToxicity', [string, string]>;
  light: [string, string, string, string];
  climateZones: string;
  photoperiod: string;
  killingTempRest: number | null;
  killingTempEarlyGrowth: number | null;
  cycleMin: number | null;
  cycleMax: number | null;
  /** What the cleaning removed or noticed, e.g. `temperature abs max 4000 dropped`. */
  cleaning: string[];
  /** EcoCrop itself says the plant is grown on a large or a small scale. */
  cultivated: boolean;
  taxon: Taxon | null;
  synonymTaxa: Taxon[];
}

function quad(r: Raw, stem: string, label: string, range: readonly [number, number], notes: string[], ordered = true): Quad {
  const cols = ['opt_min', 'opt_max', 'abs_min', 'abs_max'] as const;
  const q = cols.map((c) => numberIn(r[`${stem}_${c}`], range[0], range[1], (raw) => notes.push(`${label} ${c.replace('_', ' ')} "${raw}" dropped (outside ${range[0]}..${range[1]})`))) as Quad;
  const [oMin, oMax, aMin, aMax] = q;
  const bad =
    (oMin != null && oMax != null && oMin > oMax) ||
    (aMin != null && aMax != null && aMin > aMax) ||
    (aMin != null && oMin != null && aMin > oMin) ||
    (oMax != null && aMax != null && oMax > aMax);
  // Reported, not repaired: which of the four numbers is wrong cannot be known from the row.
  if (bad && ordered) notes.push(`${label} limits not in order (kept as published)`);
  return q;
}

export function cleanSpecies(r: Raw): AtlasSpecies {
  const notes: string[] = [];
  const name = text(r.name);
  const cycle = (col: string, label: string) =>
    numberIn(r[col] === '0' ? '' : r[col], RANGES.cycleDays[0], RANGES.cycleDays[1], (raw) => notes.push(`${label} "${raw}" dropped (not a day count in 1..366)`));
  const commonNames = text(r.common_names);
  const attributes = text(r.desc_plant_attributes);
  return {
    ecocropId: Number(r.ecocrop_id),
    scientificName: name,
    authority: text(r.authority),
    family: text(r.family).split(':').pop()?.trim() ?? '',
    synonyms: text(r.synonyms),
    commonNames,
    commonNameList: commonNames
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    lifeForm: text(r.desc_life_form),
    physiology: text(r.desc_physiology),
    habit: text(r.desc_habit),
    category: text(r.desc_category),
    lifeSpan: text(r.desc_life_span),
    plantAttributes: attributes,
    usesMain: text(r.uses_main),
    temp: quad(r, 'eco_temperat_requir', 'temperature', RANGES.temperatureC, notes),
    rain: quad(r, 'eco_rainfall_annual', 'rainfall', RANGES.rainfallMm, notes),
    ph: quad(r, 'eco_soil_ph', 'pH', RANGES.ph, notes),
    // EcoCrop's latitude "min" and "max" are the southern and the northern limit (rice: 36 and 55), not an ordered pair.
    latitude: quad(r, 'eco_latitude', 'latitude', RANGES.latitudeDeg, notes, false),
    altitude: quad(r, 'eco_altitude', 'altitude', RANGES.altitudeM, notes),
    soil: {
      depth: [text(r.eco_soil_depth_opt), text(r.eco_soil_depth_abs)],
      texture: [text(r.eco_soil_texture_opt), text(r.eco_soil_texture_abs)],
      fertility: [text(r.eco_soil_fertility_opt), text(r.eco_soil_fertility_abs)],
      salinity: [text(r.eco_soil_salinity_opt), text(r.eco_soil_salinity_abs)],
      drainage: [text(r.eco_soil_drainage_opt), text(r.eco_soil_drainage_abs)],
      alToxicity: [text(r.eco_soil_al_tox_opt), text(r.eco_soil_al_tox_abs)],
    },
    light: [text(r.eco_light_intensity_opt_min), text(r.eco_light_intensity_opt_max), text(r.eco_light_intensity_abs_min), text(r.eco_light_intensity_abs_max)],
    climateZones: text(r.clim_climate_zone),
    photoperiod: text(r.clim_photoperiod),
    killingTempRest: numberIn(r.clim_killing_temp_during_rest, RANGES.killingTempC[0], RANGES.killingTempC[1], (raw) => notes.push(`killing temperature (rest) "${raw}" dropped`)),
    killingTempEarlyGrowth: numberIn(r.clim_killing_temp_early_growth, RANGES.killingTempC[0], RANGES.killingTempC[1], (raw) => notes.push(`killing temperature (early growth) "${raw}" dropped`)),
    cycleMin: cycle('cult_cycle_min', 'cycle min'),
    cycleMax: cycle('cult_cycle_max', 'cycle max'),
    cleaning: notes,
    cultivated: /grown on (large|small) scale/i.test(attributes),
    taxon: parseScientificName(name),
    synonymTaxa: synonymTaxa(text(r.synonyms)),
  };
}
