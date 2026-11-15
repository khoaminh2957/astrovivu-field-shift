/**
 * Local crop familiarity for the Urban Grower Companion (`docs/ADVISORY.md §4.3`).
 *
 * Boosts urban candidates that are known to be grown in the user's country or region when
 * climate suitability is comparable, while keeping `unknown`, `absent`, and multi-crop
 * shared FAOSTAT items (`shared = true`) strictly neutral (`factor = 1`).
 */
import type { I18nText, PlaceInfo } from '@/contracts';
import { tx } from '@/contracts';

export type FamiliarityLevel = 'major' | 'common' | 'minor' | 'present' | 'absent' | 'unknown';

export interface UrbanFamiliarity {
  level: FamiliarityLevel;
  scope: 'country' | 'region';
  /** True when the underlying FAOSTAT item or MapSPAM class is shared across multiple species (`item_shared_by_n_crops > 1`). */
  shared: boolean;
  source: string;
  /** Optional place name (plain string or bilingual `{ en, vi }`) used in the `why` explanation. */
  place?: string | I18nText;
}

export interface RegionFamiliarityInput {
  admin1Name: string;
  spamGroup: 'individual' | 'group';
  level: FamiliarityLevel;
  shared?: boolean;
  source: string;
  place?: string | I18nText;
}

/**
 * Multiplicative score factors by prevalence level (`docs/ADVISORY.md §4.3`).
 *
 * Calibrated against the 32 curated urban crops and 16 atlas candidates under `TROPICAL` and
 * `TEMPERATE` test climates so that locally familiar easy crops (`difficulty = 1`) outrank
 * unfamiliar crops of equal climate fit without overriding a major climate or light mismatch
 * (`light` penalty is 0.5 for 1-step deficit and 0.1 for 2-step deficit).
 */
export const FAMILIARITY_FACTOR: Readonly<Record<FamiliarityLevel, number>> = {
  major: 1.25,
  common: 1.18,
  minor: 1.1,
  present: 1.06,
  unknown: 1,
  absent: 1,
};

/**
 * Pure multiplier for a crop's local familiarity record.
 *
 * - `major`, `common`, `minor`, `present` with `shared === false`: returns `FAMILIARITY_FACTOR[level]` (> 1).
 * - `unknown`, `absent`, missing (`null`/`undefined`), or `shared === true`: returns `1` (neutral; never drops a crop).
 */
export function familiarityFactor(f: UrbanFamiliarity | null | undefined): number {
  if (!f || f.shared) return 1;
  return FAMILIARITY_FACTOR[f.level] ?? 1;
}

/**
 * Selects region-level familiarity only when the MapSPAM class is `individual` and the region name
 * matches `queryAdmin1` (case-insensitive after trimming); otherwise falls back to country-level familiarity.
 */
export function selectFamiliarity(
  country: UrbanFamiliarity | null | undefined,
  region: RegionFamiliarityInput | null | undefined,
  queryAdmin1?: string | null,
): UrbanFamiliarity | null {
  if (
    region &&
    region.spamGroup === 'individual' &&
    queryAdmin1 != null &&
    queryAdmin1.trim().length > 0 &&
    region.admin1Name.trim().toLowerCase() === queryAdmin1.trim().toLowerCase()
  ) {
    return {
      level: region.level,
      scope: 'region',
      shared: region.shared ?? false,
      source: region.source,
      ...(region.place ? { place: region.place } : {}),
    };
  }
  return country ?? null;
}

const COUNTRY_LABELS: Record<string, I18nText> = {
  VN: { en: 'Vietnam', vi: 'Việt Nam' },
  VNM: { en: 'Vietnam', vi: 'Việt Nam' },
  US: { en: 'the United States', vi: 'Hoa Kỳ' },
  USA: { en: 'the United States', vi: 'Hoa Kỳ' },
};

function resolvePlaceText(f: UrbanFamiliarity, sitePlace?: PlaceInfo): I18nText {
  if (f.place) {
    return typeof f.place === 'string' ? tx(f.place, f.place) : f.place;
  }
  if (f.scope === 'region' && sitePlace?.admin1) {
    return tx(sitePlace.admin1, sitePlace.admin1);
  }
  const code = sitePlace?.countryCode?.trim().toUpperCase();
  if (code && COUNTRY_LABELS[code]) {
    return COUNTRY_LABELS[code];
  }
  if (sitePlace?.label) {
    return tx(sitePlace.label, sitePlace.label);
  }
  return f.scope === 'region' ? tx('this region', 'vùng này') : tx('this country', 'nước này');
}

/**
 * Formats a bilingual `why` reason when `familiarityFactor(f) > 1`, naming the place and source.
 * Returns `null` when the record does not boost the crop.
 */
export function familiarityReason(f: UrbanFamiliarity | null | undefined, sitePlace?: PlaceInfo): I18nText | null {
  if (!f || familiarityFactor(f) <= 1) return null;
  const place = resolvePlaceText(f, sitePlace);
  return tx(
    `Commonly grown in ${place.en} (source: ${f.source}).`,
    `Trồng phổ biến ở ${place.vi} (nguồn: ${f.source}).`,
  );
}
