/**
 * USDA NASS Cropland Data Layer via CropScape `GetCDLValue`. Point query in EPSG:5070 (CONUS
 * Albers). CropScape sends no CORS header (checked 2026-11-14), so this runs in Node scripts only;
 * the live browser path writes a note instead.
 */
import type { CropHistoryYear, LngLat, Parcel } from '@/contracts';
import { tx } from '@/contracts';
import { pointInPolygon } from '../harmonize/zonal';
import { cached, ck, TTL } from '../cache';
import { isNode } from '../env';
import { getText, mapLimit } from '../http';

const EPSG5070 = '+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs';

export async function toAlbers([lon, lat]: LngLat): Promise<[number, number]> {
  // Lazy: only Node scripts reach CropScape, so the browser bundle need not carry proj4 eagerly.
  const proj4 = (await import('proj4')).default;
  return proj4('EPSG:4326', EPSG5070, [lon, lat]) as [number, number];
}

/** Parse `{x: .., y: .., value: 1, category: "Corn", color: ".."}` inside the XML response. */
export function parseCdl(xml: string): { code: number; crop: string } | null {
  const code = /value:\s*(-?\d+)/.exec(xml);
  const cat = /category:\s*"([^"]*)"/.exec(xml);
  if (!code || !cat) return null;
  return { code: Number(code[1]), crop: cat[1] };
}

export const cdlBrowserSupported = (): boolean => isNode;

/**
 * Sample points: the centroid plus four points 40 % of the way from it to the bounding-box edges
 * (N, S, E, W), kept only when inside the polygon. A single centroid pixel can land on a pivot
 * tower, a farm track or an edge and misname the whole field.
 */
export function cdlSamplePoints(parcel: Pick<Parcel, 'centroid' | 'bbox' | 'polygon'>): LngLat[] {
  const [cx, cy] = parcel.centroid;
  const [w, s, e, n] = parcel.bbox;
  const cand: LngLat[] = [
    [cx, cy + 0.4 * (n - cy)],
    [cx, cy - 0.4 * (cy - s)],
    [cx + 0.4 * (e - cx), cy],
    [cx - 0.4 * (cx - w), cy],
  ];
  return [parcel.centroid, ...cand.filter((p) => pointInPolygon(p, parcel.polygon))];
}

/** Majority class per year; ties go to the class seen at the earliest point (the centroid first). */
export function majorityYear(year: number, hits: ({ code: number; crop: string } | null)[]): CropHistoryYear | null {
  const valid = hits.filter((h): h is { code: number; crop: string } => h != null);
  if (!valid.length) return null;
  const counts = new Map<number, { n: number; crop: string; first: number }>();
  valid.forEach((h, i) => {
    const c = counts.get(h.code) ?? { n: 0, crop: h.crop, first: i };
    c.n++;
    counts.set(h.code, c);
  });
  const [code, best] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)[0];
  return {
    year,
    crop: best.crop,
    code,
    sourceId: 'usda-cdl',
    note: tx(`${best.n} of ${valid.length} points inside the field agree`, `${best.n} trên ${valid.length} điểm trong ruộng trùng khớp`),
  };
}

async function cdlPoint(at: LngLat, year: number, signal?: AbortSignal): Promise<{ code: number; crop: string } | null> {
  try {
    const [x, y] = await toAlbers(at);
    const xml = await cached(`cdl:${year}:${ck(at[0], 4)},${ck(at[1], 4)}`, TTL.year, () =>
      getText(`https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`, { signal, timeoutMs: 60_000 }),
    );
    return parseCdl(xml);
  } catch {
    return null;
  }
}

/** Crop class per year: majority of the points sampled inside the parcel (one point = old behaviour). */
export async function cdlHistory(at: LngLat | LngLat[], years: number[], signal?: AbortSignal): Promise<CropHistoryYear[]> {
  const pts: LngLat[] = typeof at[0] === 'number' ? [at as LngLat] : (at as LngLat[]);
  const jobs = years.flatMap((year) => pts.map((p, k) => ({ year, p, k })));
  const hits = await mapLimit(jobs, 2, (j) => cdlPoint(j.p, j.year, signal));
  return years
    .map((year) => majorityYear(year, jobs.map((j, i) => (j.year === year ? hits[i] : undefined)).filter((h) => h !== undefined)))
    .filter((r): r is CropHistoryYear => r != null);
}
