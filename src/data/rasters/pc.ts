/**
 * Microsoft Planetary Computer: STAC search (POST, CORS *) and the data API's bbox endpoint, which
 * returns each scene already cut and resampled to our lng/lat grid as an NPY array whose last
 * band is the validity mask (255 valid, 0 outside the scene). Both are key-free.
 */
import type { ISODate, LngLat } from '@/contracts';
import { cached, ck, TTL } from '../cache';
import { getBytes, getJson } from '../http';
import { parseNpy, type NpyArray, type RasterGrid, type SceneCandidate } from './pure';

const STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const DATA = 'https://planetarycomputer.microsoft.com/api/data/v1/item/bbox';

interface StacItem {
  id: string;
  properties: Record<string, unknown> & { datetime: string };
}

export interface PcScene extends SceneCandidate {
  props: Record<string, unknown>;
}

export async function searchScenes(
  collection: string,
  at: LngLat,
  start: ISODate,
  end: ISODate,
  maxCloud: number,
  signal?: AbortSignal,
  extraQuery: Record<string, unknown> = {},
): Promise<PcScene[]> {
  const key = `pcstac:${collection}:${ck(at[0])},${ck(at[1])}:${start}:${end}:${maxCloud}:${JSON.stringify(extraQuery)}`;
  return cached(key, TTL.day, async () => {
    const body = {
      collections: [collection],
      intersects: { type: 'Point', coordinates: at },
      datetime: `${start}T00:00:00Z/${end}T23:59:59Z`,
      limit: 1000,
      query: { 'eo:cloud_cover': { lt: maxCloud }, ...extraQuery },
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    };
    const res = await getJson<{ features: StacItem[] }>(STAC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      timeoutMs: 30_000,
    });
    return res.features.map((f) => ({
      id: f.id,
      t: f.properties.datetime.slice(0, 10),
      cloud: Number(f.properties['eo:cloud_cover'] ?? 100),
      props: pickProps(f.properties),
    }));
  });
}

/** Keep only what we read later, so cached searches stay small. */
const pickProps = (p: Record<string, unknown>) => ({
  baseline: p['s2:processing_baseline'],
  platform: p.platform,
});

/** Fetch `assets` for one scene on the grid; cached forever (scenes do not change). */
export async function fetchScene(collection: string, item: string, assets: string[], grid: RasterGrid, signal?: AbortSignal): Promise<NpyArray> {
  const [w, s, e, n] = grid.bbox.map((v) => v.toFixed(6));
  const qs = [`collection=${collection}`, `item=${encodeURIComponent(item)}`, ...assets.map((a) => `assets=${a}`), 'resampling=nearest'].join('&');
  const url = `${DATA}/${w},${s},${e},${n}/${grid.width}x${grid.height}.npy?${qs}`;
  const b64 = await cached(`pcnpy:${url}`, TTL.year, async () => {
    const bytes = await getBytes(url, { signal, timeoutMs: 30_000 });
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const arr = parseNpy(bytes);
  if (arr.shape.length !== 3 || arr.shape[0] !== assets.length + 1 || arr.shape[1] !== grid.height || arr.shape[2] !== grid.width)
    throw new Error(`Unexpected array shape ${arr.shape.join('x')} for ${item}`);
  return arr;
}
