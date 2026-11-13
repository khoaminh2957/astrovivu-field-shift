/**
 * ORNL DAAC MODIS/VIIRS land product subsets (modis.ornl.gov/rst/api/v1). At most 10 composite
 * dates per request, 13-60 s each, intermittent 502: requests are chunked by the known composite
 * calendar, run two at a time, retried, and cached per chunk so a re-run only fetches what failed.
 */
import type { ISODate, Parcel, Sample } from '@/contracts';
import { cached, ck, TTL } from '../cache';
import { getJson, mapLimit } from '../http';
import { modisDate } from '../harmonize/units';
import { pixelsInParcel, toSinusoidal } from '../harmonize/zonal';
import { addDays } from '@/lib/time';

const BASE = 'https://modis.ornl.gov/rst/api/v1';

interface SubsetResponse {
  xllcorner: string;
  yllcorner: string;
  cellsize: number;
  nrows: number;
  ncols: number;
  scale: string;
  subset: { modis_date: string; calendar_date: string; band: string; data: number[] }[];
}

/** Composite start dates of an N-day product between two dates (DOY 1, 1+N, … each year). */
export function compositeDates(start: ISODate, end: ISODate, periodDays: number): ISODate[] {
  const out: ISODate[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    for (let doy = 1; doy <= 366; doy += periodDays) {
      const t = addDays(`${y}-01-01`, doy - 1);
      if (t.slice(0, 4) !== String(y)) break;
      if (t >= start && t <= end) out.push(t);
    }
  }
  return out;
}

export interface SubsetResult {
  samples: Sample[];
  pixels: number;
  /** Composite chunks that failed after retries (their dates are missing, not zero). */
  failedChunks: number;
}

/**
 * Parcel-mean values of one band. Pixels whose centre lies in the parcel are averaged (S1); a
 * parcel smaller than one pixel reads the pixel under its centroid.
 */
export async function ornlSubset(
  product: string,
  band: string,
  parcel: Pick<Parcel, 'polygon' | 'centroid' | 'bbox'>,
  start: ISODate,
  end: ISODate,
  opts: { periodDays: number; decode: (raw: number) => number | null; signal?: AbortSignal; concurrency?: number; resolutionM: number },
): Promise<SubsetResult> {
  const [lon, lat] = parcel.centroid;
  // Half-extent of the parcel in km, so the subset grid covers every pixel the polygon touches.
  const [w, s, e, n] = parcel.bbox;
  const [x0, y0] = toSinusoidal([w, s]);
  const [x1, y1] = toSinusoidal([e, n]);
  const halfKm = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2000;
  const km = halfKm * 1000 > opts.resolutionM * 0.75 ? Math.min(4, Math.ceil(halfKm)) : 0;
  const dates = compositeDates(start, end, opts.periodDays);
  const chunks: ISODate[][] = [];
  for (let i = 0; i < dates.length; i += 10) chunks.push(dates.slice(i, i + 10));
  let failed = 0;
  let pixels = 1;
  const byDate = new Map<ISODate, number | null>();
  await mapLimit(chunks, opts.concurrency ?? 2, async (chunk, ci) => {
    // Chunks tile the window without gaps so a product whose composite phase differs from the
    // assumed calendar (e.g. VIIRS) still returns every date.
    const cStart = ci === 0 ? start : chunk[0];
    const cEnd = ci === chunks.length - 1 ? end : addDays(chunks[ci + 1][0], -1);
    const url =
      `${BASE}/${product}/subset?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}` +
      `&startDate=${modisDate(cStart)}&endDate=${modisDate(cEnd)}&kmAboveBelow=${km}&kmLeftRight=${km}&band=${band}`;
    // A chunk whose last composite is recent may still grow; cache it briefly.
    const fresh = addDays(cEnd, 40) >= end;
    try {
      const j = await cached(`ornl:${product}:${band}:${ck(lon, 4)},${ck(lat, 4)}:${km}:${cStart}:${cEnd}`, fresh ? TTL.day : TTL.year, () =>
        getJson<SubsetResponse>(url, { signal: opts.signal, timeoutMs: 90_000, retries: 3 }),
      );
      if (!Array.isArray(j.subset)) throw new Error('No subset in response');
      const idx = pixelsInParcel(
        { xll: Number(j.xllcorner), yll: Number(j.yllcorner), cell: Number(j.cellsize), nrows: j.nrows, ncols: j.ncols },
        parcel,
      );
      pixels = idx.length;
      for (const row of j.subset) {
        const vals = idx.map((i) => opts.decode(row.data[i])).filter((v): v is number => v != null);
        byDate.set(row.calendar_date, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
      }
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      failed++;
    }
  });
  const samples = [...byDate.entries()].map(([t, v]) => ({ t, v: v == null ? null : Math.round(v * 1000) / 1000 })).sort((a, b) => (a.t < b.t ? -1 : 1));
  if (samples.length === 0 && failed > 0) throw new Error(`${product} ${band}: all ${failed} subset requests failed`);
  return { samples, pixels, failedChunks: failed };
}

/** Does ORNL serve this product at this point? (SMAP products answer "No data available" for most points.) */
export async function ornlHasDates(product: string, lon: number, lat: number, signal?: AbortSignal): Promise<{ ok: boolean; last?: string; message?: string }> {
  try {
    const j = await cached(`ornldates:${product}:${ck(lon, 2)},${ck(lat, 2)}`, TTL.week, async () => {
      const r = await getJson<{ dates?: { calendar_date: string }[] } | string>(`${BASE}/${product}/dates?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`, {
        signal,
        timeoutMs: 60_000,
        retries: 1,
      });
      return r;
    });
    if (typeof j === 'string') return { ok: false, message: j };
    const d = j.dates ?? [];
    return d.length ? { ok: true, last: d[d.length - 1].calendar_date } : { ok: false, message: 'empty date list' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
