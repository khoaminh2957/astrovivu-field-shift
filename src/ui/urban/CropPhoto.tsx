/**
 * Crop photographs from Wikimedia Commons and FAO EcoCrop. The tile stays visible while the
 * photograph loads and provides a fallback if it is unavailable.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Bean, Carrot, Cherry, Flower, Flower2, Leaf, LeafyGreen, Sprout, Wheat } from 'lucide-react';
import type { CropCategory } from '@/contracts';
import { getCrop } from '@/core/crops';
import { cropImage, ecocropPhotoUrl, type CropImageManifest } from '@/core/urban';
import { useT } from '@/i18n';
import { cn } from '@/ui/design';
import { LOCAL_CROP_PHOTOS } from './cropPhotoCredits';
import './strings';

let manifest: CropImageManifest | null = null;
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadManifest(): void {
  request ??= fetch(`${import.meta.env.BASE_URL}data/crops/images.json`)
    .then((r) => (r.ok ? (r.json() as Promise<CropImageManifest>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((m) => {
      manifest = m;
      for (const l of listeners) l();
    })
    // No manifest means no photographs: every crop keeps its tile. Nothing else depends on it.
    .catch(() => undefined);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The photo manifest once it has loaded, else null. Fetched once, on first use. */
export function useCropImages(): CropImageManifest | null {
  useEffect(loadManifest, []);
  return useSyncExternalStore(
    subscribe,
    () => manifest,
    () => null,
  );
}

/** True when EcoCrop lists a photograph for this crop. */
export function hasEcoCropPhoto(m: CropImageManifest | null, cropId: string): boolean {
  return !LOCAL_CROP_PHOTOS[cropId] && cropImage(m, getCrop(cropId)?.ecocropId) != null;
}

const DEFAULT_GROUP = { icon: <Sprout />, tone: 'bg-surface-2 text-ink-3' };
/** Tile of a crop group: a tint, an icon and (from the caller) the crop's initial. */
const GROUP: Partial<Record<CropCategory, { icon: ReactNode; tone: string }>> = {
  vegetable: { icon: <LeafyGreen />, tone: 'bg-branch-vegetation/14 text-branch-vegetation' },
  herb: { icon: <Leaf />, tone: 'bg-nominal/12 text-nominal' },
  spice: { icon: <Leaf />, tone: 'bg-branch-soil/14 text-branch-soil' },
  fruit: { icon: <Cherry />, tone: 'bg-branch-thermal/12 text-branch-thermal' },
  ornamental: { icon: <Flower2 />, tone: 'bg-branch-risk/12 text-branch-risk' },
  pulse: { icon: <Bean />, tone: 'bg-branch-agromet/14 text-branch-agromet' },
  oilseed: { icon: <Flower />, tone: 'bg-branch-agromet/14 text-branch-agromet' },
  root: { icon: <Carrot />, tone: 'bg-branch-soil/14 text-branch-soil' },
  cereal: { icon: <Wheat />, tone: 'bg-branch-agromet/14 text-branch-agromet' },
  cover: { icon: <Sprout />, tone: 'bg-branch-terrain/16 text-branch-terrain' },
  forage: { icon: <Sprout />, tone: 'bg-branch-terrain/16 text-branch-terrain' },
};

/** Portrait boxes, 2:3, close to the 100-140 x 200 px of the originals so they are never blown up far. */
const BOX = { sm: { w: 64, h: 96 }, md: { w: 80, h: 120 }, lg: { w: 136, h: 204 } } as const;

export interface CropPhotoProps {
  cropId: string;
  /** Display name, for the alt text and the tile's initial. */
  name: string;
  size?: keyof typeof BOX;
  className?: string;
}

export function CropPhoto({ cropId, name, size = 'sm', className }: CropPhotoProps) {
  const t = useT();
  const images = useCropImages();
  const crop = getCrop(cropId);
  const entry = cropImage(images, crop?.ecocropId);
  const local = LOCAL_CROP_PHOTOS[cropId];
  const src = local
    ? `${import.meta.env.BASE_URL}urban-photos/${local.file}`
    : entry && crop?.ecocropId != null ? ecocropPhotoUrl(crop.ecocropId) : null;
  const [failedSrc, setFailedSrc] = useState<string>();
  // The large view follows the photograph's own shape when it is known, so a 92 px wide original is not stretched to 136.
  const box = size === 'lg' && !local && entry && entry !== true ? { w: Math.max(88, Math.min(BOX.lg.w, Math.round((entry.w * BOX.lg.h) / entry.h))), h: BOX.lg.h } : BOX[size];
  const group = (crop && GROUP[crop.category]) || DEFAULT_GROUP;
  const initial = name.trim().charAt(0).toLocaleUpperCase();
  return (
    <span className={cn('relative block shrink-0 overflow-hidden rounded-sm border border-line-1', group.tone, className)} style={{ width: box.w, height: box.h }}>
      {/* The tile is always underneath: it shows while the photograph loads and stays if it never does. */}
      <span aria-hidden className={cn('absolute inset-0 flex flex-col items-center justify-center gap-1', size === 'lg' ? '[&_svg]:size-8' : '[&_svg]:size-5')}>
        {group.icon}
        <span className={cn('font-medium text-ink-1', size === 'lg' ? 'text-2xl' : 'text-md')}>{initial}</span>
      </span>
      {src && src !== failedSrc && (
        <img
          src={src}
          alt={t(local ? 'urban.photoAltCommons' : 'urban.photoAlt', { name })}
          width={box.w}
          height={box.h}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}
