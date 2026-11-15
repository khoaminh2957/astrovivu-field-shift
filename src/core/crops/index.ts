/**
 * Crop catalogue public API.
 *
 * Two layers:
 *   - curated crops (staples, pulses, oilseeds, roots, perennials, forages, cover crops,
 *     vegetables, herbs, flowers): bundled, synchronous, with a FAO-56 water model, rotation and
 *     urban traits and reference economics. This is what `listCrops()` returns.
 *   - the cleaned FAO EcoCrop catalogue (2,000+ species, thresholds only): fetched on demand by
 *     `loadFullCatalog()` from `public/data/crops/ecocrop.json`.
 *
 * Both are produced by `npm run crops:build`; see docs/SCORING.md §2 and data/crops/CLEANING_LOG.md.
 */
import type { CropPrevalence, CropProfile, Iso3, Lang } from '@/contracts';
import { decodeCatalog, type CatalogFile } from './codec';
import { CATALOG_META, CURATED_CROPS, CURATION_NOTES, URBAN_CANDIDATE_CROPS } from './curated.generated';
import { fold } from './text';

export { fold, slugify } from './text';
export { CATALOG_META } from './curated.generated';

const URBAN_CROPS: CropProfile[] = [...CURATED_CROPS.filter((c) => c.urban?.suitable), ...URBAN_CANDIDATE_CROPS];
const byId = new Map<string, CropProfile>([...CURATED_CROPS, ...URBAN_CANDIDATE_CROPS].map((c) => [c.id, c]));
let full: CropProfile[] | null = null;
let loading: Promise<CropProfile[]> | null = null;
let prevalenceTable: Record<string, Record<Iso3, CropPrevalence>> | null = null;
let loadingPrevalence: Promise<Record<string, Record<Iso3, CropPrevalence>>> | null = null;

/** Curated crops, in catalogue order (cereals, pulses, oilseeds, roots, perennials, forages, covers, garden). */
export function listCrops(): CropProfile[] {
  return CURATED_CROPS;
}

/**
 * All crops eligible for the Urban Grower Companion (`urban.suitable === true`): the 32 curated
 * urban crops plus uncurated `urban_candidate = yes` atlas crops that have complete sourced
 * container data (`sun_hours_min`, `pot_depth_min`, `difficulty`) in `data/crops/atlas/urban.csv`.
 */
export function listUrbanCrops(): CropProfile[] {
  return URBAN_CROPS;
}

/** A curated crop, or any EcoCrop species once `loadFullCatalog()` has resolved. */
export function getCrop(id: string | null | undefined): CropProfile | undefined {
  return id ? byId.get(id) : undefined;
}

/** Why a curated crop's thresholds differ from EcoCrop, and where its water model comes from. */
export function curationNotes(id: string): string[] {
  return CURATION_NOTES[id] ?? [];
}

export const isFullCatalogLoaded = (): boolean => full != null;
export const isPrevalenceLoaded = (): boolean => prevalenceTable != null;

async function fetchCatalog(): Promise<unknown> {
  const base = import.meta.env?.BASE_URL ?? '/';
  const res = await fetch(`${base}data/crops/ecocrop.json`);
  if (!res.ok) throw new Error(`Crop catalogue request failed: HTTP ${res.status}`);
  return res.json();
}

async function fetchPrevalence(): Promise<unknown> {
  const base = import.meta.env?.BASE_URL ?? '/';
  const res = await fetch(`${base}data/crops/prevalence.json`);
  if (!res.ok) throw new Error(`Crop prevalence request failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * The whole catalogue: curated crops first, then every other scorable EcoCrop species
 * (`curated: false`, thresholds only). Loaded once and cached. `source` lets scripts and tests
 * supply the JSON themselves (the default fetches the public file).
 */
export function loadFullCatalog(source: () => Promise<unknown> = fetchCatalog): Promise<CropProfile[]> {
  if (full) return Promise.resolve(full);
  loading ??= source()
    .then((json) => {
      const rest = decodeCatalog(json as CatalogFile).filter((p) => !byId.has(p.id));
      for (const p of rest) {
        const prev = prevalenceTable?.[p.id];
        if (prev) p.prevalence = prev;
        byId.set(p.id, p);
      }
      full = [...CURATED_CROPS, ...rest];
      searchIndex = null;
      return full;
    })
    .catch((err: unknown) => {
      loading = null; // allow a retry after a network failure
      throw err;
    });
  return loading;
}

/**
 * Country prevalence for all 387 atlas crops (`public/data/crops/prevalence.json`).
 * Curated crops already carry `VNM` and `USA` prevalence synchronously; this loader
 * hydrates all countries and non-curated atlas species on demand.
 */
export function loadPrevalence(
  source: () => Promise<unknown> = fetchPrevalence,
): Promise<Record<string, Record<Iso3, CropPrevalence>>> {
  if (prevalenceTable) return Promise.resolve(prevalenceTable);
  loadingPrevalence ??= source()
    .then((json) => {
      const table = json as Record<string, Record<Iso3, CropPrevalence>>;
      for (const [cropId, prev] of Object.entries(table)) {
        const crop = byId.get(cropId);
        if (crop) crop.prevalence = prev;
      }
      prevalenceTable = table;
      return table;
    })
    .catch((err: unknown) => {
      loadingPrevalence = null;
      throw err;
    });
  return loadingPrevalence;
}

// ------------------------------------------------------------------------------------------------
// Search
// ------------------------------------------------------------------------------------------------

interface Entry {
  crop: CropProfile;
  /** Folded names with the language they belong to ('' = scientific or alias). */
  names: { text: string; lang: Lang | '' }[];
}
let searchIndex: Entry[] | null = null;

function index(): Entry[] {
  searchIndex ??= (full ?? CURATED_CROPS).map((crop) => ({
    crop,
    names: [
      { text: fold(crop.names.en), lang: 'en' as const },
      ...(crop.names.vi ? [{ text: fold(crop.names.vi), lang: 'vi' as const }] : []),
      { text: fold(crop.scientificName), lang: '' as const },
      ...(crop.names.aliases ?? []).map((a) => ({ text: fold(a), lang: '' as const })),
    ],
  }));
  return searchIndex;
}

function matchScore(name: string, q: string): number {
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  const at = name.indexOf(q);
  if (at < 0) return 0;
  return /[\s(,-]/.test(name[at - 1]) ? 60 : 40;
}

/**
 * Name search over English, Vietnamese (with or without diacritics: `dau phong` finds
 * `Đậu phộng`), scientific names and aliases. Curated crops rank first on ties. An empty query
 * returns the first curated crops.
 */
export function searchCrops(query: string, lang: Lang, limit = 12): CropProfile[] {
  const q = fold(query.trim()).replace(/\s+/g, ' ');
  if (!q) return CURATED_CROPS.slice(0, limit);
  const hits: { crop: CropProfile; score: number }[] = [];
  for (const e of index()) {
    let best = 0;
    for (const n of e.names) {
      const s = matchScore(n.text, q);
      if (s > 0) best = Math.max(best, s + (n.lang === lang ? 10 : 0));
    }
    if (best > 0) hits.push({ crop: e.crop, score: best + (e.crop.curated ? 5 : 0) });
  }
  hits.sort((a, b) => b.score - a.score || a.crop.names.en.localeCompare(b.crop.names.en));
  return hits.slice(0, limit).map((h) => h.crop);
}

/** Display name in the requested language, falling back to English. */
export function cropName(crop: CropProfile, lang: Lang): string {
  return (lang === 'vi' ? crop.names.vi : undefined) ?? crop.names.en;
}

/** Counts for the About / data panel. */
export const catalogMeta = () => CATALOG_META;
