/**
 * Within-field rasters (10-30 m) for a parcel: vegetation, moisture index, surface temperature,
 * terrain. PLACEHOLDER IMPLEMENTATION (owner: raster agent); the signature is the contract.
 */
import type { FieldRaster, ISODate, Parcel } from '@/contracts';

export interface RasterLoadOptions {
  signal?: AbortSignal;
  today?: ISODate;
  /** Upper bound on dated frames per raster for live loading. */
  maxFrames?: number;
  /** Called whenever a raster gains a frame, with every raster loaded so far (newest scenes first). */
  onProgress?: (rasters: FieldRaster[]) => void;
}

export async function loadFieldRasters(_parcel: Parcel, _opts: RasterLoadOptions = {}): Promise<FieldRaster[]> {
  return [];
}
