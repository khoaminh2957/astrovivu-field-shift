/**
 * OpenTopoData SRTM GL1 30 m (api.opentopodata.org). No CORS header, 1 call/s, 100 points per
 * call, 1,000 calls/day: used only by Node scripts for the demo caches.
 */
import type { Parcel } from '@/contracts';
import { metresPerDegree } from '@/lib/geo';
import { cached, ck, TTL } from '../cache';
import { isNode } from '../env';
import { getJson, sleep } from '../http';
import { pointInPolygon } from '../harmonize/zonal';
import type { DemGrid } from '../harmonize/terrain';

export async function openTopoDem(parcel: Pick<Parcel, 'bbox' | 'polygon' | 'centroid'>, signal?: AbortSignal, spacingM = 30): Promise<DemGrid> {
  if (!isNode) throw new Error('OpenTopoData sends no CORS header; script use only');
  const m = metresPerDegree(parcel.centroid[1]);
  const [w0, s0, e0, n0] = parcel.bbox;
  // One-cell margin so Horn's 3×3 window is defined at the parcel edge.
  const w = w0 - spacingM / m.lng;
  const n = n0 + spacingM / m.lat;
  const cols = Math.max(3, Math.ceil(((e0 - w0) * m.lng) / spacingM) + 3);
  const rows = Math.max(3, Math.ceil(((n0 - s0) * m.lat) / spacingM) + 3);
  if (cols * rows > 900) throw new Error(`Parcel too large for OpenTopoData grid (${cols}×${rows})`);
  const pts: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pts.push([w + (c * spacingM) / m.lng, n - (r * spacingM) / m.lat]);
  const values: number[] = [];
  for (let i = 0; i < pts.length; i += 100) {
    const batch = pts.slice(i, i + 100);
    const loc = batch.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join('|');
    const j = await cached(`opentopo:${ck(batch[0][0], 5)},${ck(batch[0][1], 5)}:${batch.length}:${spacingM}`, TTL.year, async () => {
      const res = await getJson<{ results: { elevation: number | null }[] }>(`https://api.opentopodata.org/v1/srtm30m?locations=${loc}`, { signal, timeoutMs: 30_000 });
      await sleep(1100, signal);
      return res;
    });
    for (const r of j.results) values.push(r.elevation ?? NaN);
  }
  const inside = pts.map((p) => pointInPolygon(p, parcel.polygon));
  if (!inside.some(Boolean)) inside[Math.floor(rows / 2) * cols + Math.floor(cols / 2)] = true;
  return { width: cols, height: rows, data: values, cellX: spacingM, cellY: spacingM, inside: (c, r) => inside[r * cols + c] };
}
