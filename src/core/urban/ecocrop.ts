/**
 * Where FAO EcoCrop keeps a species' page and its one photograph. The photographs are FAO's:
 * they are linked, never copied, and shown with the credit below (docs/DATA_SOURCES.md).
 */
export const ECOCROP_HOST = 'https://ecocrop.apps.fao.org';
export const ECOCROP_TERMS_URL = 'https://www.fao.org/contact-us/terms/en/';
export const ECOCROP_CREDIT = '© FAO, EcoCrop';

/** `code` is `CropProfile.ecocropId`. */
export const ecocropPageUrl = (code: number): string => `${ECOCROP_HOST}/ecocrop/srv/en/cropView?id=${code}`;
export const ecocropPhotoUrl = (code: number): string => `${ECOCROP_HOST}/ecocrop/ec_images/${code}.jpg`;

/** Pixel size of a photograph as listed in `public/data/crops/images.json`. */
export interface CropImageSize {
  w: number;
  h: number;
}

export interface CropImageManifest {
  generatedAt: string;
  source: string;
  terms: string;
  credit?: string;
  /** Keyed by EcoCrop code. `true` when the photograph exists but its size could not be read. */
  images: Record<string, CropImageSize | true>;
}

/** The manifest entry for a crop, or null when EcoCrop has no photograph of it (or no code). */
export function cropImage(manifest: CropImageManifest | null | undefined, code: number | null | undefined): CropImageSize | true | null {
  if (!manifest || code == null) return null;
  return manifest.images[String(code)] ?? null;
}
