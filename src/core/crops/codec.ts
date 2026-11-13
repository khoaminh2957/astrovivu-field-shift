/**
 * Compact on-disk form of the full EcoCrop catalogue (`public/data/crops/ecocrop.json`).
 * One array per species keeps 2,000 species near 400 kB before gzip; `decodeCatalog` turns the
 * rows back into `CropProfile`s. The build script and the app share this file so the two cannot
 * drift apart.
 */
import type { CropCategory, CropProfile, CropRequirements, DepthClass, DrainageClass, FertilityClass, Quad, SalinityClass, TextureClass } from '@/contracts';

const CATEGORIES: CropCategory[] = ['cereal', 'pulse', 'oilseed', 'root', 'vegetable', 'fruit', 'forage', 'cover', 'industrial', 'spice', 'herb', 'ornamental', 'other'];
const TEXTURE: Record<string, TextureClass> = { h: 'heavy', m: 'medium', l: 'light', o: 'organic' };
const DRAINAGE: Record<string, DrainageClass> = { p: 'poor', w: 'well', e: 'excessive' };
const DEPTH: DepthClass[] = ['very-shallow', 'shallow', 'medium', 'deep'];
const SALINITY: SalinityClass[] = ['none', 'low', 'medium', 'high'];
const FERTILITY: FertilityClass[] = ['low', 'moderate', 'high'];
const PHOTO: Record<string, string> = { s: 'short', n: 'neutral', l: 'long' };
const LIFE: Record<string, CropProfile['lifeSpan']> = { a: 'annual', b: 'biennial', p: 'perennial' };

const letters = <T extends string>(map: Record<string, T>, values: readonly T[]): string =>
  values.map((v) => Object.keys(map).find((k) => map[k] === v) ?? '').join('');
const unletters = <T extends string>(map: Record<string, T>, s: string): T[] => [...s].map((ch) => map[ch]).filter(Boolean);

type Pair<T> = [opt: T, abs: T] | null;
export type CatalogRow = [
  id: string,
  ecocropId: number,
  scientificName: string,
  en: string,
  commonNames: string[],
  family: string,
  category: number,
  life: string,
  tempC: Quad,
  rainMm: Quad,
  ph: Quad | null,
  texture: Pair<string>,
  depth: Pair<number>,
  drainage: Pair<string>,
  salinity: Pair<number>,
  fertility: Pair<number>,
  killTempC: number | null,
  killTempRestC: number | null,
  altitudeMaxM: number | null,
  latitudeAbs: [number, number] | null,
  photoperiod: string | null,
  climateZones: string | null,
  cycleDays: [number, number],
  flags: string[] | 0,
];

export interface CatalogFile {
  version: 1;
  source: string;
  generated: string;
  count: number;
  /** Column guide for anyone opening the file by hand. */
  fields: string[];
  rows: CatalogRow[];
}

const FIELDS = [
  'id (slug of the scientific name)',
  'EcoCrop id',
  'scientific name',
  'English name',
  'common names',
  'family',
  `category index into [${CATEGORIES.join(', ')}]`,
  'life span: a annual, b biennial, p perennial',
  'temperature °C [absMin, optMin, optMax, absMax]',
  'rainfall mm [absMin, optMin, optMax, absMax] (EcoCrop publishes annual rainfall; the scorer reads it as the season total)',
  'pH [absMin, optMin, optMax, absMax] or null',
  'texture [optimal, tolerated] as letters h heavy, m medium, l light, o organic',
  `soil depth [optimal, tolerated] as index into [${DEPTH.join(', ')}]`,
  'drainage [optimal, tolerated] as letters p poor, w well, e excessive',
  `salinity [optimal, tolerated] as index into [${SALINITY.join(', ')}]`,
  `fertility [optimal, tolerated] as index into [${FERTILITY.join(', ')}]`,
  'killing temperature in early growth, °C',
  'killing temperature during rest, °C',
  'maximum altitude, m',
  'latitude limits [south, north], degrees',
  'photoperiod classes as letters s short (<12 h), n neutral (12-14 h), l long (>14 h)',
  'Köppen-Trewartha climate zones, space separated',
  'growing cycle [min, max], days',
  'data-quality flags, or 0',
];

export interface EncodeOptions {
  source: string;
  generated: string;
  commonNames: (p: CropProfile) => string[];
  family: (p: CropProfile) => string;
}

export function encodeCatalog(profiles: CropProfile[], opts: EncodeOptions): CatalogFile {
  const rows: CatalogRow[] = profiles.map((p) => {
    const r = p.req;
    return [
      p.id,
      p.ecocropId ?? 0,
      p.scientificName,
      p.names.en,
      opts.commonNames(p),
      opts.family(p),
      CATEGORIES.indexOf(p.category),
      p.lifeSpan[0],
      r.tempC,
      r.rainMm,
      p.flags?.includes('ph-missing') ? null : r.ph,
      r.texture ? [letters(TEXTURE, r.texture.opt), letters(TEXTURE, r.texture.abs)] : null,
      r.depth ? [DEPTH.indexOf(r.depth.opt), DEPTH.indexOf(r.depth.abs)] : null,
      r.drainage ? [letters(DRAINAGE, r.drainage.opt), letters(DRAINAGE, r.drainage.abs)] : null,
      r.salinity ? [SALINITY.indexOf(r.salinity.opt), SALINITY.indexOf(r.salinity.abs)] : null,
      r.fertility ? [FERTILITY.indexOf(r.fertility.opt), FERTILITY.indexOf(r.fertility.abs)] : null,
      r.killTempC ?? null,
      r.killTempRestC ?? null,
      r.altitudeMaxM ?? null,
      r.latitudeAbs ?? null,
      r.photoperiod ? letters(PHOTO, r.photoperiod) : null,
      r.climateZones ? r.climateZones.join(' ') : null,
      p.cycleDays,
      p.flags?.length ? p.flags : 0,
    ];
  });
  return { version: 1, source: opts.source, generated: opts.generated, count: rows.length, fields: FIELDS, rows };
}

/** Neutral pH window used only to satisfy the contract when EcoCrop has none; flagged `ph-missing`, never scored. */
const NEUTRAL_PH: Quad = [3, 5, 7.5, 9.5];

export function decodeCatalog(file: CatalogFile): CropProfile[] {
  if (file.version !== 1) throw new Error(`Unsupported crop catalogue version ${String(file.version)}`);
  return file.rows.map((row) => {
    const [id, ecocropId, scientificName, en, commonNames, , category, life, tempC, rainMm, ph, texture, depth, drainage, salinity, fertility, kill, killRest, altMax, lat, photo, zones, cycleDays, flags] = row;
    const req: CropRequirements = { tempC, rainMm, ph: ph ?? NEUTRAL_PH };
    if (texture) req.texture = { opt: unletters(TEXTURE, texture[0]), abs: unletters(TEXTURE, texture[1]) };
    if (depth) req.depth = { opt: DEPTH[depth[0]], abs: DEPTH[depth[1]] };
    if (drainage) req.drainage = { opt: unletters(DRAINAGE, drainage[0]), abs: unletters(DRAINAGE, drainage[1]) };
    if (salinity) req.salinity = { opt: SALINITY[salinity[0]], abs: SALINITY[salinity[1]] };
    if (fertility) req.fertility = { opt: FERTILITY[fertility[0]], abs: FERTILITY[fertility[1]] };
    if (kill != null) req.killTempC = kill;
    if (killRest != null) req.killTempRestC = killRest;
    if (altMax != null) req.altitudeMaxM = altMax;
    if (lat) req.latitudeAbs = lat;
    if (photo) req.photoperiod = unletters(PHOTO, photo);
    if (zones) req.climateZones = zones.split(' ');
    const profile: CropProfile = {
      id,
      ecocropId,
      scientificName,
      names: { en, ...(commonNames.length ? { aliases: commonNames } : {}) },
      category: CATEGORIES[category] ?? 'other',
      lifeSpan: LIFE[life] ?? 'annual',
      req,
      cycleDays,
      curated: false,
    };
    if (flags) profile.flags = flags;
    return profile;
  });
}
