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
import type { CropProfile, Lang } from '@/contracts';
import { decodeCatalog, type CatalogFile } from './codec';
import { CATALOG_META, CURATED_CROPS, CURATION_NOTES } from './curated.generated';
import { fold } from './text';

export { fold, slugify } from './text';
export { CATALOG_META } from './curated.generated';

const byId = new Map<string, CropProfile>(CURATED_CROPS.map((c) => [c.id, c]));
let full: CropProfile[] | null = null;
let loading: Promise<CropProfile[]> | null = null;

/** Curated crops, in catalogue order (cereals, pulses, oilseeds, roots, perennials, forages, covers, garden). */
export function listCrops(): CropProfile[] {
  return CURATED_CROPS;
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

async function fetchCatalog(): Promise<unknown> {
  const base = import.meta.env?.BASE_URL ?? '/';
  const res = await fetch(`${base}data/crops/ecocrop.json`);
  if (!res.ok) throw new Error(`Crop catalogue request failed: HTTP ${res.status}`);
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
      for (const p of rest) byId.set(p.id, p);
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
