/**
 * USDA NASS Cropland Data Layer via CropScape `GetCDLValue`. Point query in EPSG:5070 (CONUS
 * Albers). CropScape sends no CORS header (checked 2026-11-14), so this runs in Node scripts only;
 * the live browser path writes a note instead.
 */
import type { CropHistoryYear, LngLat } from '@/contracts';
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

export async function cdlHistory(at: LngLat, years: number[], signal?: AbortSignal): Promise<CropHistoryYear[]> {
  const [x, y] = await toAlbers(at);
  const rows = await mapLimit(years, 2, async (year): Promise<CropHistoryYear | null> => {
    try {
      const xml = await cached(`cdl:${year}:${ck(at[0], 4)},${ck(at[1], 4)}`, TTL.year, () =>
        getText(`https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`, { signal, timeoutMs: 60_000 }),
      );
      const p = parseCdl(xml);
      return p ? { year, crop: p.crop, code: p.code, sourceId: 'usda-cdl' } : null;
    } catch {
      return null;
    }
  });
  return rows.filter((r): r is CropHistoryYear => r != null);
}
