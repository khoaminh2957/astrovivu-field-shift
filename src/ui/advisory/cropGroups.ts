/**
 * Crop groups of the rotation calendar: the thirteen catalogue categories folded into seven
 * colours, plus a neutral group for anything unknown and a hatched one for fallow. The colour is a
 * tint under the crop name; the name carries the identity (see `--color-crop-*` in tokens.css).
 */
import type { CropCategory } from '@/contracts';
import { getCrop } from '@/core/crops';

export type CropGroup = 'cereal' | 'legume' | 'oilseed' | 'root' | 'tree' | 'forage' | 'cover' | 'other' | 'fallow';

const BY_CATEGORY: Record<CropCategory, CropGroup> = {
  cereal: 'cereal',
  pulse: 'legume',
  oilseed: 'oilseed',
  root: 'root',
  vegetable: 'root',
  herb: 'root',
  ornamental: 'root',
  fruit: 'tree',
  spice: 'tree',
  industrial: 'tree',
  forage: 'forage',
  cover: 'cover',
  other: 'other',
};

/** Legend order: the fixed order of the palette, then the two neutral groups. */
export const GROUP_ORDER: CropGroup[] = ['cover', 'root', 'forage', 'cereal', 'oilseed', 'legume', 'tree', 'other', 'fallow'];

export const groupOfCategory = (category: CropCategory | undefined): CropGroup => (category ? BY_CATEGORY[category] : 'other');

/** Group of a season's crop id. An id the catalogue does not know is `other`, never guessed. */
export function cropGroup(cropId: string): CropGroup {
  if (cropId === 'fallow') return 'fallow';
  return groupOfCategory(getCrop(cropId)?.category);
}

/** Block fill: a tint, so the name on it stays in primary ink. Literal classes, for the Tailwind scan. */
export const GROUP_FILL: Record<CropGroup, string> = {
  cover: 'bg-crop-cover/30',
  root: 'bg-crop-root/30',
  forage: 'bg-crop-forage/30',
  cereal: 'bg-crop-cereal/35',
  oilseed: 'bg-crop-oilseed/35',
  legume: 'bg-crop-legume/25',
  tree: 'bg-crop-tree/25',
  other: 'bg-surface-3',
  fallow: 'bg-surface-2',
};

/** Solid swatch for the thin ribbon on a strategy card, where there is no room for a name. */
export const GROUP_SOLID: Record<CropGroup, string> = {
  cover: 'bg-crop-cover',
  root: 'bg-crop-root',
  forage: 'bg-crop-forage',
  cereal: 'bg-crop-cereal',
  oilseed: 'bg-crop-oilseed',
  legume: 'bg-crop-legume',
  tree: 'bg-crop-tree',
  other: 'bg-ink-4',
  fallow: 'bg-surface-3',
};

/** Hatch of a fallow block: bare ground is a texture, not a hue. */
export const FALLOW_HATCH = 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-line-3) 55%, transparent) 0 1px, transparent 1px 6px)';
